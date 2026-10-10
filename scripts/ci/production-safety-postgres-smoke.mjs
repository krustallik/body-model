import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import { decryptBackupToWritable, encryptBackupStream } from "../production-backup-envelope.mjs";
import { restoreEncryptedPostgresBackup } from "../restore-encrypted-postgres-backup.mjs";
import {
  evaluateProductionPreflight,
  assertProductionDatabaseIdentityMatches,
  EXPECTED_MIGRATION_OBJECTS,
  EXPECTED_PENDING_MIGRATIONS,
  evaluateProductionPostflight,
  verifyRestoredBackup,
} from "../production-migration-preflight.mjs";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST, STAGE_02_MANIFEST } from "../production-migration-manifests.mjs";
import { renderProductionDbPreflightSql } from "../production-db-preflight.mjs";
import { PRODUCTION_WRITER_TOPOLOGY_CONTRACT } from "../production-writer-drain.mjs";
import { assertPostgresClientCompatibility } from "../postgres-client-versions.mjs";
import { canonicalSha256, createAuthorizationEnvelope } from "../production-migration-authorization.mjs";
import { executionProofAudience, verifyGitHubExecutionProof } from "../production-migration-execution-attestation.mjs";
import { readPrismaDatabaseIdentity, startPrismaMigrationAtDdlBoundary } from "../run-prisma-migrate-with-lock-timeout.mjs";
import { withPrismaLockTimeout } from "../production-migration-release.mjs";
import { readCommittedGitBlob } from "../production-migration-integrity.mjs";
import {
  assertPreviousAppCompatibilitySnapshot,
  capturePreviousAppProvenance,
  PREVIOUS_APP_COMPATIBILITY_SNAPSHOT_CONTRACT,
  verifyPreviousAppCaptureMatchesPreflight,
} from "../production-previous-app-provenance.mjs";

const source = { host: "127.0.0.1", port: Number(process.env.BODYCAST_SOURCE_PORT ?? 5432), database: "bodycast", user: "bodycast", password: "bodycast_ci_only" };
const target = { host: "127.0.0.1", port: Number(process.env.BODYCAST_RESTORE_PORT ?? 5433), database: "bodycast_restore", user: "bodycast_restore", password: "restore_ci_only" };
const POSTGRES_IMAGE = "public.ecr.aws/docker/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";

function run(command, args, { input, env = process.env } = {}) {
  const result = spawnSync(command, args, { input, encoding: "utf8", env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.error?.message}): ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout.trim();
}

function clientArgs(db, tool) {
  return ["run", "--rm", "--interactive", "--network", "host", "--env", `PGPASSWORD=${db.password}`, "--env", "PGAPPNAME=bodycast-production-preflight", POSTGRES_IMAGE, tool,
    "--host", db.host, "--port", String(db.port), "--username", db.user, "--dbname", db.database];
}

function sql(db, content, { writerTopology } = {}) {
  const args = [...clientArgs(db, "psql"), "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=verbose"];
  if (writerTopology !== undefined) args.push(`--set=BODYCAST_WRITER_TOPOLOGY_JSON=${JSON.stringify(writerTopology)}`);
  args.push("--file=-");
  return run("docker", args, { input: content });
}

async function createSourceFixture(db = source) {
  const migrationDirectories = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const releaseSha = run("git", ["rev-parse", "HEAD"]);
  const applied = migrationDirectories.filter((name) => !EXPECTED_PENDING_MIGRATIONS.includes(name));
  const stage02Checksums = new Map(STAGE_02_MANIFEST.migrations.map(({ name, sha256 }) => [name, sha256]));
  const rows = applied.map((name, index) => {
    const migrationSql = readCommittedGitBlob({
      repositoryPath: process.cwd(), releaseSha, relativePath: `prisma/migrations/${name}/migration.sql`,
    });
    const checksum = stage02Checksums.get(name) ?? createHash("sha256").update(migrationSql).digest("hex");
    const started = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    const finished = new Date(Date.UTC(2026, 0, 1, 0, 0, index + 1)).toISOString();
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    return `(${quote(`ci-migration-${index}`)}, ${quote(checksum)}, ${quote(started)}, ${quote(finished)}, ${quote(name)}, ${quote("CI synthetic applied migration")}, 1)`;
  });

  const createSql = `
    CREATE TABLE public."_prisma_migrations" (
      id text PRIMARY KEY, checksum text NOT NULL, started_at timestamp NOT NULL,
      finished_at timestamp, migration_name text NOT NULL, logs text,
      rolled_back_at timestamp, applied_steps_count integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Workout" (id integer PRIMARY KEY);
    CREATE TABLE public."Profile" (id integer PRIMARY KEY);
    CREATE TABLE public."ModelEpisode" (id integer PRIMARY KEY, "profileId" integer NOT NULL);
    CREATE TABLE public."PhysiologyV7Lifecycle" (id text PRIMARY KEY);
    CREATE TABLE public."DailyModelState" (id text PRIMARY KEY);
    CREATE TABLE public."ExperimentalSkeletalMuscleDeltaShadow" (
      id serial PRIMARY KEY, "profileId" integer NOT NULL, date varchar(10) NOT NULL,
      "sourceFingerprint" varchar(64) NOT NULL, "modelRevision" varchar(100) NOT NULL,
      features jsonb NOT NULL, result jsonb NOT NULL,
      "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "updatedAt" timestamptz(3) NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX "ExperimentalSkeletalMuscleDeltaShadow_profileId_date_key"
      ON public."ExperimentalSkeletalMuscleDeltaShadow" ("profileId", date);
    CREATE TABLE public."ExperimentalCessationDetrainingShadow" (
      id serial PRIMARY KEY, "profileId" integer NOT NULL, date varchar(10) NOT NULL,
      "sourceFingerprint" varchar(64) NOT NULL, "modelRevision" varchar(100) NOT NULL,
      features jsonb NOT NULL, result jsonb NOT NULL,
      "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "updatedAt" timestamptz(3) NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX "ExperimentalCessationDetrainingShadow_profileId_date_key"
      ON public."ExperimentalCessationDetrainingShadow" ("profileId", date);
    CREATE TABLE public."StrengthDiarySession" (id integer PRIMARY KEY);
    CREATE TABLE public."ExerciseCatalog" (id integer PRIMARY KEY);
    CREATE TABLE public."ProgramExercise" (id integer PRIMARY KEY);
    CREATE TABLE public."StrengthSessionExercise" (id integer PRIMARY KEY);
    CREATE TABLE public."StrengthSet" (id integer PRIMARY KEY);
    CREATE TABLE public."HealthMetricSample" (id integer PRIMARY KEY);
    CREATE TABLE public."BodycastUnrelatedLockProbe" (id integer PRIMARY KEY);
    INSERT INTO public."_prisma_migrations" (id, checksum, started_at, finished_at, migration_name, logs, applied_steps_count)
    VALUES ${rows.join(",\n")};
    INSERT INTO public."StrengthDiarySession" VALUES (1), (2);
    INSERT INTO public."ExerciseCatalog" VALUES (1), (2), (3);
    INSERT INTO public."Profile" VALUES (1);
    INSERT INTO public."ExperimentalSkeletalMuscleDeltaShadow"
      ("profileId", date, "sourceFingerprint", "modelRevision", features, result) VALUES
      (1, '2026-01-01', repeat('a', 64), 'relative-muscle-v3', '{}'::jsonb, '{"legacy":"delta"}'::jsonb);
    INSERT INTO public."ExperimentalCessationDetrainingShadow"
      ("profileId", date, "sourceFingerprint", "modelRevision", features, result) VALUES
      (1, '2026-01-01', repeat('b', 64), 'relative-muscle-v3', '{}'::jsonb, '{"legacy":"cessation"}'::jsonb);
  `;
  sql(db, createSql);
  for (const { name } of STAGE_02_MANIFEST.migrations) {
    sql(db, await readFile(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
  }
  for (const tableName of ["ExperimentalSkeletalMuscleDeltaShadow", "ExperimentalCessationDetrainingShadow"]) {
    sql(db, `INSERT INTO public."${tableName}" ("profileId", date, "sourceFingerprint", "modelRevision", features, result)
      VALUES (1, '2026-01-01', repeat('f', 64), 'relative-muscle-v3', '{}'::jsonb, '{"legacy":"updated"}'::jsonb)
      ON CONFLICT ("profileId", date) DO UPDATE SET result = EXCLUDED.result;`);
  }
  return migrationDirectories;
}

function readSourceReport(db = source) {
  const report = sql(db, renderProductionDbPreflightSql(requireSql("scripts/production-db-preflight.sql")));
  const parsed = JSON.parse(report);
  parsed.logicalDataFingerprint = logicalDataFingerprint(db);
  const observedAt = new Date().toISOString();
  parsed.writerDrain.observerApplicationName = "bodycast-production-preflight";
  parsed.writerDrain.identityPolicy = "no-other-client-backends";
  parsed.writerDrain.topology = {
    schemaVersion: 1,
    contract: PRODUCTION_WRITER_TOPOLOGY_CONTRACT,
    ready: true,
    blockers: [],
    observedAt,
    app: { name: "bodycast-app-prod", state: "absent", restartPolicy: null },
    database: { name: "bodycast-db-prod", state: "running", health: "healthy", publishedPostgresPort: false, networks: ["bodycast-backend-prod"] },
    backendNetwork: { name: "bodycast-backend-prod", containers: ["bodycast-db-prod"] },
    caddy: { name: "gymbeam-caddy", state: "running", configValidated: true },
    routeFile: { verified: true, maintenanceResponse: true, containsReverseProxy: false, sha256: "a".repeat(64) },
  };
  return parsed;
}

function verifyPinnedPostgresClientVersions() {
  const pgDumpVersion = run("docker", ["run", "--rm", POSTGRES_IMAGE, "pg_dump", "--version"]);
  const pgRestoreVersion = run("docker", ["run", "--rm", POSTGRES_IMAGE, "pg_restore", "--version"]);
  assertPostgresClientCompatibility(pgDumpVersion, pgRestoreVersion);
  console.log(`pg_dump --version: ${pgDumpVersion}`);
  console.log(`pg_restore --version: ${pgRestoreVersion}`);
}

async function waitForPostgres(db) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = spawnSync("docker", clientArgs(db, "pg_isready"), { encoding: "utf8", env: process.env, windowsHide: true });
    if (!result.error && result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Prepared-lock disposable PostgreSQL did not become ready.");
}

async function withClientBackend(db, applicationName, work) {
  const containerName = `bodycast-ci-client-${randomBytes(6).toString("hex")}`;
  const pgArgs = [
    "run", "--detach", "--name", containerName, "--network", "host",
    "--env", `PGPASSWORD=${db.password}`, "--env", `PGAPPNAME=${applicationName}`,
    POSTGRES_IMAGE, "psql", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1",
    "--host", db.host, "--port", String(db.port), "--username", db.user, "--dbname", db.database,
    "--command", "SELECT pg_sleep(45);",
  ];
  try {
    run("docker", pgArgs);
    const deadline = Date.now() + 10_000;
    let report = null;
    while (Date.now() < deadline) {
      const state = run("docker", ["inspect", "--format", "{{.State.Status}}", containerName]);
      if (state !== "running") throw new Error(`Isolated PostgreSQL writer fixture exited before registration (${state}).`);
      report = readSourceReport(db);
      if (report.writerDrain.activeClientBackends.length > 0) {
        const serializedDrain = JSON.stringify(report.writerDrain.activeClientBackends);
        if (serializedDrain.includes(applicationName)
          || /"(?:pid|user|applicationName|clientAddress|clientPort|backendType|state|backendStart|transactionStart)"/.test(serializedDrain)) {
          throw new Error("PostgreSQL writer-drain diagnostics exposed client identity instead of sanitized backend-presence facts.");
        }
        return await work(report);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`PostgreSQL did not report the ${applicationName || "unknown"} client backend before the deterministic barrier expired.`);
  } finally {
    const removed = spawnSync("docker", ["rm", "--force", containerName], { encoding: "utf8", windowsHide: true });
    if (removed.error || (removed.status !== 0 && !String(removed.stderr ?? "").includes("No such container"))) {
      throw new Error(`Could not remove isolated PostgreSQL client fixture: ${removed.stderr || removed.error?.message || removed.status}`);
    }
    const escapedApplicationName = applicationName.replaceAll("'", "''");
    sql(db, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = '${escapedApplicationName}' AND pid <> pg_backend_pid();`);
    const deadline = Date.now() + 5_000;
    let writerDisconnected = false;
    while (Date.now() < deadline) {
      const remaining = sql(db, `SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = '${escapedApplicationName}' AND pid <> pg_backend_pid();`);
      if (remaining === "0") { writerDisconnected = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!writerDisconnected) throw new Error(`Isolated PostgreSQL writer fixture ${applicationName} remained connected after cleanup.`);
  }
}

async function withPreparedLockPostgres(work) {
  const containerName = `bodycast-ci-prepared-lock-${randomBytes(6).toString("hex")}`;
  const requestedPort = process.env.BODYCAST_PREPARED_PORT ? Number(process.env.BODYCAST_PREPARED_PORT) : null;
  if (requestedPort !== null && (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)) {
    throw new Error("BODYCAST_PREPARED_PORT must be an available TCP port between 1024 and 65535.");
  }
  let created = false;
  try {
    const publishArgs = requestedPort === null
      ? ["--publish", "127.0.0.1::5432"]
      : ["--publish", `127.0.0.1:${requestedPort}:5432`];
    run("docker", [
      "create", "--name", containerName, ...publishArgs,
      "--env", "POSTGRES_DB=bodycast", "--env", "POSTGRES_USER=bodycast", "--env", "POSTGRES_PASSWORD=prepared_lock_ci_only",
      "--label", "bodycast.safety-test=prepared-lock", POSTGRES_IMAGE,
      "postgres", "-c", "max_prepared_transactions=10",
    ]);
    created = true;
    run("docker", ["start", containerName]);
    const publishedPort = requestedPort === null ? run("docker", ["port", containerName, "5432/tcp"]) : "";
    const match = publishedPort.match(/:(\d+)\s*$/);
    if (requestedPort === null && !match) throw new Error("Could not identify the host port for prepared-lock disposable PostgreSQL.");
    const db = {
      host: process.env.BODYCAST_PREPARED_HOST ?? "127.0.0.1", port: requestedPort ?? Number(match[1]), database: "bodycast",
      user: "bodycast", password: "prepared_lock_ci_only",
    };
    await waitForPostgres(db);
    return await work(db);
  } finally {
    if (created) run("docker", ["rm", "--force", containerName]);
  }
}

async function withPreparedTransactionRelationLock(db, tableName, work) {
  const alterTargets = new Set([
    "ExerciseCatalog", "ProgramExercise", "StrengthSessionExercise", "StrengthSet",
    "HealthMetricSample", "StrengthDiarySession", "DailyModelState", "PhysiologyV7Lifecycle",
    "Workout", "Profile", "ModelEpisode", "BodycastUnrelatedLockProbe",
  ]);
  if (!alterTargets.has(tableName)) throw new Error("Refusing to prepare a lock outside the reviewed Stage 02 targets and explicit unrelated-lock probe.");

  const gid = `bodycast-ci-prepared-lock-${randomBytes(6).toString("hex")}`;
  try {
    sql(db, `BEGIN; LOCK TABLE public."${tableName}" IN ROW EXCLUSIVE MODE; PREPARE TRANSACTION '${gid}';`);
    return await work(gid);
  } finally {
    const exists = sql(db, `SELECT EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE gid = '${gid}');`);
    if (exists === "t") sql(db, `ROLLBACK PREPARED '${gid}';`);
  }
}

async function withShortGrantedRelationLock(tableName, lockMode, work) {
  const alterTargets = new Set([
    "ExerciseCatalog", "ProgramExercise", "StrengthSessionExercise", "StrengthSet",
    "HealthMetricSample", "StrengthDiarySession", "DailyModelState", "PhysiologyV7Lifecycle",
    "Workout", "Profile", "ModelEpisode", "BodycastUnrelatedLockProbe",
  ]);
  if (!alterTargets.has(tableName)) throw new Error("Refusing to test an unreviewed relation lock target.");
  if (!["ACCESS SHARE", "ROW EXCLUSIVE"].includes(lockMode)) throw new Error("Refusing to test an unreviewed PostgreSQL lock mode.");

  const child = spawn("docker", [
    ...clientArgs(source, "psql"), "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1",
  ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let readyResolve;
  let readyReject;
  let output = "";
  let readyReached = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  exited.catch(() => {});
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
    if (!readyReached && output.includes("BODYCAST_SHORT_LOCK_HELD")) {
      readyReached = true;
      readyResolve();
    }
  });
  child.once("error", readyReject);
  child.once("close", (code) => {
    if (!readyReached) readyReject(new Error(`Short-lock PostgreSQL session exited before acquiring its lock (${code}).`));
  });
  child.stdin.write(`BEGIN;\nLOCK TABLE public."${tableName}" IN ${lockMode} MODE;\n\\echo BODYCAST_SHORT_LOCK_HELD\n`);
  await ready;
  try {
    return await work();
  } finally {
    child.stdin.write("COMMIT;\n\\q\n");
    child.stdin.end();
    const exitCode = await exited;
    if (exitCode !== 0) throw new Error(`Short-lock PostgreSQL session failed to release cleanly (${exitCode}).`);
  }
}

function verifyMixedSshKeyFiltering(scratch) {
  const correctKey = path.join(scratch, "pinned-host");
  const unmatchedKey = path.join(scratch, "unmatched-host");
  for (const keyPath of [correctKey, unmatchedKey]) {
    run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath]);
  }
  const correctPublicKey = readFileSync(`${correctKey}.pub`, "utf8").trim();
  const unmatchedPublicKey = readFileSync(`${unmatchedKey}.pub`, "utf8").trim();
  const fingerprint = run("ssh-keygen", ["-lf", `${correctKey}.pub`, "-E", "sha256"]).split(/\s+/)[1];
  if (!fingerprint) throw new Error("Could not obtain the disposable test SSH key fingerprint.");

  const candidatePath = path.join(scratch, "mixed-known-hosts");
  const trustedPath = path.join(scratch, "trusted-known-hosts");
  writeFileSync(candidatePath, [
    `production.example ${correctPublicKey}`,
    `production.example ${unmatchedPublicKey}`,
  ].join("\n") + "\n", { mode: 0o600 });
  const filtered = spawnSync(process.execPath, ["scripts/filter-ssh-known-hosts.mjs", candidatePath, trustedPath], {
    encoding: "utf8", env: { ...process.env, SSH_HOST_FINGERPRINT: fingerprint }, windowsHide: true,
  });
  if (filtered.status !== 0) throw new Error(`Mixed-key SSH fingerprint filtering failed: ${filtered.stderr || filtered.stdout}`);
  const trusted = readFileSync(trustedPath, "utf8");
  if (trusted !== `production.example ${correctPublicKey}\n` || trusted.includes(unmatchedPublicKey)) {
    throw new Error("The trusted known_hosts output retained an unmatched SSH key.");
  }
  return true;
}

function requireSql(file) {
  return readFileSync(file, "utf8");
}

function logicalDataFingerprint(db = source) {
  const digest = createHash("sha256");
  const tables = sql(db, "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename;")
    .split("\n").filter(Boolean);
  const script = ["\\set QUIET 1", "\\echo bodycast-logical-data-fingerprint-v1"];
  for (const table of tables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error("Isolated public table inventory contains an unsupported identifier.");
    script.push(`\\echo table:${table}`);
    script.push(`\\copy (SELECT row_to_json(row_value)::text FROM public."${table}" AS row_value ORDER BY row_to_json(row_value)::text) TO STDOUT`);
    script.push("\\echo");
  }
  script.push("\\echo sequence-state");
  script.push("\\copy (SELECT schemaname || '.' || sequencename || ':' || COALESCE(last_value::text, 'null') FROM pg_catalog.pg_sequences WHERE schemaname='public' ORDER BY sequencename) TO STDOUT");
  const result = spawnSync("docker", [
    ...clientArgs(db, "psql"), "--no-psqlrc", "--quiet", "--tuples-only", "--no-align",
    "--set=ON_ERROR_STOP=1", "--file=-",
  ], { input: `${script.join("\n")}\n`, encoding: null, env: process.env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Isolated database fingerprint query failed (${result.status ?? result.error?.message}).`);
  digest.update(result.stdout);
  return digest.digest("hex");
}

function captureDump(db) {
  const child = spawn("docker", [
    "run", "--rm", "--network", "host", "--env", `PGPASSWORD=${db.password}`, POSTGRES_IMAGE, "pg_dump",
    "--host", db.host, "--port", String(db.port), "--username", db.user, "--dbname", db.database,
    "--format=custom", "--no-owner", "--no-privileges",
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`pg_dump failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`)));
  });
  exited.catch(() => {});
  return { stream: child.stdout, exited };
}

async function restoreDump(db, archive, key) {
  await restoreEncryptedPostgresBackup({
    inputPath: archive,
    key,
    args: [
      "run", "--rm", "--interactive", "--network", "host", "--env", `PGPASSWORD=${db.password}`,
      "--entrypoint", "pg_restore", POSTGRES_IMAGE,
      "--host", db.host, "--port", String(db.port), "--username", db.user, "--dbname", db.database,
      "--exit-on-error", "--no-owner", "--no-privileges", "--single-transaction",
    ],
    redactValues: [db.password],
  });
}

function assertBlocked(report, migrations, mutate, expected) {
  const blocked = structuredClone(report);
  mutate(blocked);
  const result = evaluateProductionPreflight(blocked, migrations);
  if (result.readyForOwnerAuthorization || !result.blockers.some((blocker) => blocker.includes(expected))) {
    throw new Error(`Expected preflight blocker was not detected: ${expected}`);
  }
}

async function createTargetBindingAuthorization(identity, now = Date.now()) {
  const keyPair = generateKeyPairSync("ed25519");
  const keyId = "disposable-target-binding-test";
  const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const allowlist = { schemaVersion: 1, keys: [{ keyId, status: "active", publicKeyPem }] };
  const releaseSha = "a".repeat(40);
  const pendingMigrationNames = ["20261002100000_active_energy_canonical_resolution"];
  const claims = {
    repository: "krustallik/body-model",
    workflowId: "77",
    workflowPath: ".github/workflows/production-migrate.yml",
    workflowRunId: "99001",
    workflowRunAttempt: 1,
    actorId: "126446430",
    releaseSha,
    currentMainSha: releaseSha,
    manifestId: "active-energy-unified-v2",
    pendingMigrationNames,
    pendingSetDigest: canonicalSha256(pendingMigrationNames),
    preflightRunId: "88001",
    preflightRunAttempt: 2,
    preflightRunStartedAt: new Date(now - 120_000).toISOString(),
    preflightResultDigest: "b".repeat(64),
    backupArtifactId: "77001",
    backupArtifactDigest: "c".repeat(64),
    backupSnapshotAt: new Date(now - 10_000).toISOString(),
    restoreResultDigest: "d".repeat(64),
    productionIdentityDigest: canonicalSha256(identity),
    snapshotDataFingerprint: "d".repeat(64),
    writerDrainDigest: "1".repeat(64),
    writerTopologyDigest: "2".repeat(64),
    issuedAt: new Date(now - 5_000).toISOString(),
    expiresAt: new Date(now + 55 * 60_000).toISOString(),
    authorizationId: randomUUID(),
    nonce: randomUUID(),
  };
  const authorizationEnvelope = createAuthorizationEnvelope(claims, { keyId, privateKeyPem, allowlist });
  const latestPreflight = {
    repository: "krustallik/body-model",
    workflowPath: ".github/workflows/production-migration-preflight.yml",
    workflowId: "88",
    event: "workflow_dispatch",
    headBranch: "main",
    headSha: releaseSha,
    displayTitle: `Preflight ${releaseSha} ${claims.manifestId}`,
    id: claims.preflightRunId,
    runAttempt: claims.preflightRunAttempt,
    createdAt: new Date(now - 60_000).toISOString(),
    runStartedAt: claims.preflightRunStartedAt,
    status: "completed",
    conclusion: "success",
  };
  const migrationRun = {
    repository: claims.repository,
    workflowPath: claims.workflowPath,
    workflowId: claims.workflowId,
    event: "workflow_dispatch",
    headBranch: "main",
    headSha: claims.releaseSha,
    id: claims.workflowRunId,
    runAttempt: claims.workflowRunAttempt,
    runStartedAt: new Date(now - 30_000).toISOString(),
    status: "in_progress",
  };
  const executionChallenge = randomBytes(32).toString("hex");
  const oidcPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const oidcJwk = { ...oidcPair.publicKey.export({ format: "jwk" }), kid: "fixture-github-oidc-key", use: "sig", alg: "RS256" };
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: oidcJwk.kid, typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://token.actions.githubusercontent.com",
    aud: executionProofAudience(authorizationEnvelope, executionChallenge, allowlist, now),
    jti: randomUUID(), iat: Math.floor(now / 1000), nbf: Math.floor(now / 1000), exp: Math.floor((now + 4 * 60_000) / 1000),
    repository: "krustallik/body-model",
    sub: "repo:krustallik/body-model:environment:production",
    environment: "production",
    workflow_ref: "krustallik/body-model/.github/workflows/production-migrate.yml@refs/heads/main",
    workflow_sha: releaseSha,
    ref: "refs/heads/main",
    sha: releaseSha,
    event_name: "workflow_dispatch",
    actor_id: claims.actorId,
    repository_owner_id: claims.actorId,
    run_id: claims.workflowRunId,
    run_attempt: claims.workflowRunAttempt,
  })).toString("base64url");
  const signingInput = header + "." + payload;
  const executionProof = signingInput + "." + sign("RSA-SHA256", Buffer.from(signingInput), oidcPair.privateKey).toString("base64url");
  const verifiedExecutionProof = await verifyGitHubExecutionProof(executionProof, {
    authorizationEnvelope, allowlist, expectedChallenge: executionChallenge, now, jwks: [oidcJwk],
  });
  const currentRun = {
    repository: { full_name: "krustallik/body-model" },
    path: ".github/workflows/production-migrate.yml@refs/heads/main",
    workflow_id: Number(claims.workflowId), event: "workflow_dispatch", head_branch: "main", head_sha: releaseSha,
    id: Number(claims.workflowRunId), run_attempt: claims.workflowRunAttempt,
    actor: { id: Number(claims.actorId), login: "krustallik" },
    run_started_at: migrationRun.runStartedAt, status: "in_progress", conclusion: null,
  };
  return { allowlist, authorizationEnvelope, latestPreflight, executionProof, verifiedExecutionProof, oidcJwk, currentRun, executionChallenge, claims };
}

function databaseUrl(db) {
  return `postgresql://${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}@${db.host}:${db.port}/${db.database}?schema=public`;
}

async function deployPendingPrismaMigrations(db, scratch) {
  const cli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
  const schemaRoot = path.join(scratch, "prisma");
  const migrationsRoot = path.join(schemaRoot, "migrations");
  await mkdir(migrationsRoot, { recursive: true });
  await writeFile(path.join(schemaRoot, "schema.prisma"), await readFile("prisma/schema.prisma"));
  await writeFile(path.join(migrationsRoot, "migration_lock.toml"), await readFile("prisma/migrations/migration_lock.toml"));
  const releaseSha = run("git", ["rev-parse", "HEAD"]);
  const directories = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const name of directories) {
    const targetDirectory = path.join(migrationsRoot, name);
    await mkdir(targetDirectory, { recursive: true });
    const sqlBytes = readCommittedGitBlob({
      repositoryPath: process.cwd(), releaseSha, relativePath: `prisma/migrations/${name}/migration.sql`,
    });
    await writeFile(path.join(targetDirectory, "migration.sql"), sqlBytes);
  }
  const result = spawnSync(process.execPath, [cli, "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: scratch,
    env: { ...process.env, DATABASE_URL: withPrismaLockTimeout(databaseUrl(db), 5000) },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Full isolated PostgreSQL migration sequence failed: ${result.stderr || result.stdout || result.error?.message || result.status}`);
  }
  return result.stdout;
}

function assertLegacyRelativeMuscleUpsertsRejected(db) {
  const tables = ["ExperimentalSkeletalMuscleDeltaShadow", "ExperimentalCessationDetrainingShadow"];
  for (const tableName of tables) {
    const oldClientUpsert = `INSERT INTO public."${tableName}" ("profileId", date, "sourceFingerprint", "modelRevision", features, result)
      VALUES (1, '2026-01-01', repeat('e', 64), 'old-profile-date-client', '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT ("profileId", date) DO UPDATE SET result = EXCLUDED.result;`;
    const result = spawnSync("docker", [...clientArgs(db, "psql"), "--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1", "--command", oldClientUpsert], {
      encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024,
    });
    const output = String(result.stdout ?? "") + String(result.stderr ?? "");
    if (result.status === 0 || !/no unique or exclusion constraint matching the ON CONFLICT specification/i.test(output)) {
      throw new Error(`Migrated PostgreSQL schema did not reject the old ${tableName} profileId_date upsert target.`);
    }
    const legacyRow = sql(db, `SELECT count(*) = 1 AND bool_and("modelEpisodeId" IS NULL AND "isStale" = TRUE)
      FROM public."${tableName}" WHERE "profileId" = 1 AND date = '2026-01-01';`);
    if (legacyRow !== "t") throw new Error(`The populated legacy ${tableName} row was not retained as stale/unassigned evidence.`);
  }
}

async function verifyPrismaTargetBinding({ sourceUrl, alternateUrl, signedIdentity, scratch }) {
  const now = Date.now();
  const fixture = await createTargetBindingAuthorization(signedIdentity, now);
  const nonceDirectory = path.join(scratch, "consumed-execution-attestations");
  const makeAuthorized = (targetUrl, authorizationFixture = fixture) => {
    const claims = authorizationFixture.claims;
    const observedAt = new Date(now).toISOString();
    const receipt = {
      schemaVersion: 1,
      ready: true,
      authorizationId: claims.authorizationId,
      manifestId: claims.manifestId,
      releaseSha: claims.releaseSha,
      currentMainSha: claims.currentMainSha,
      workflowId: claims.workflowId,
      workflowRunId: claims.workflowRunId,
      workflowRunAttempt: claims.workflowRunAttempt,
      actorId: claims.actorId,
      pending: claims.pendingMigrationNames,
      pendingSetDigest: claims.pendingSetDigest,
      preflightRunId: claims.preflightRunId,
      preflightRunAttempt: claims.preflightRunAttempt,
      preflightResultDigest: claims.preflightResultDigest,
      backupArtifactId: claims.backupArtifactId,
      backupArtifactDigest: claims.backupArtifactDigest,
      backupSnapshotAt: claims.backupSnapshotAt,
      restoreResultDigest: claims.restoreResultDigest,
      productionIdentityDigest: claims.productionIdentityDigest,
      preflightWriterDrainDigest: claims.writerDrainDigest,
      preflightWriterTopologyDigest: claims.writerTopologyDigest,
      finalWriterDrainDigest: "1".repeat(64),
      finalWriterTopologyDigest: "2".repeat(64),
      finalWriterDrainObservedAt: observedAt,
      finalTopologyObservedAt: observedAt,
      postSchemaDigest: "3".repeat(64),
      snapshotDataFingerprint: claims.snapshotDataFingerprint,
      verifiedAt: observedAt,
    };
    return {
      databaseUrl: targetUrl,
      receipt,
      envelope: authorizationFixture.authorizationEnvelope,
      allowlist: authorizationFixture.allowlist,
      currentWorkflowId: claims.workflowId,
      currentWorkflowRunId: claims.workflowRunId,
      currentWorkflowRunAttempt: claims.workflowRunAttempt,
      currentMainSha: claims.currentMainSha,
      releaseSha: claims.releaseSha,
    };
  };
  let spawnCount = 0;
  const spawn = (_command, _args, options) => {
    spawnCount += 1;
    if (options.env.DATABASE_URL !== withPrismaLockTimeout(sourceUrl, 5000)) {
      throw new Error("Prisma spawn did not receive the exact target URL that the identity probe checked.");
    }
    const child = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => { child.emit("spawn"); setImmediate(() => child.emit("close", 0, null)); });
    return child;
  };
  let mismatchBlocked = false;
  let mismatchFailure = "";
  try {
    await startPrismaMigrationAtDdlBoundary({
      authorized: makeAuthorized(alternateUrl),
      environment: { BODYCAST_DDL_ATTESTATION_NONCE_DIR: nonceDirectory, BODYCAST_RELEASE_MARKER_DIRECTORY: "/run/bodycast-release-marker" },
      identityProbe: readPrismaDatabaseIdentity,
      latestPreflightProbe: async () => fixture.latestPreflight,
      currentMigrationRunProbe: async () => fixture.currentRun,
      executionProofVerifier: (proof, options) => verifyGitHubExecutionProof(proof, { ...options, jwks: [fixture.oidcJwk] }),
      spawn,
      markerWriter: async () => ({ markerPath: "/marker", digest: "a".repeat(64) }),
      spawnAcknowledger: async () => {},
      now: () => Date.now(),
      nonceDirectory,
    });
  } catch (error) {
    mismatchFailure = String(error?.message ?? error);
    mismatchBlocked = mismatchFailure.includes("differs from the verified production identity");
  }
  if (!mismatchBlocked || spawnCount !== 0) {
    throw new Error(`Final Prisma URL for another database was not blocked by the signed identity predicate before spawn (spawnCount=${spawnCount}; reason=${mismatchFailure || "none"}).`);
  }
  // Use a fresh run-bound signature for the independent matching-target assertion.
  const matchingFixture = await createTargetBindingAuthorization(signedIdentity, Date.now());
  await startPrismaMigrationAtDdlBoundary({
    authorized: makeAuthorized(sourceUrl, matchingFixture),
    environment: { BODYCAST_DDL_ATTESTATION_NONCE_DIR: nonceDirectory, BODYCAST_RELEASE_MARKER_DIRECTORY: "/run/bodycast-release-marker" },
    identityProbe: readPrismaDatabaseIdentity,
    latestPreflightProbe: async () => matchingFixture.latestPreflight,
    currentMigrationRunProbe: async () => matchingFixture.currentRun,
    executionProofVerifier: (proof, options) => verifyGitHubExecutionProof(proof, { ...options, jwks: [matchingFixture.oidcJwk] }),
    spawn,
    markerWriter: async () => ({ markerPath: "/marker", digest: "a".repeat(64) }),
    spawnAcknowledger: async () => {},
    now: () => Date.now(),
    nonceDirectory,
  });
  if (spawnCount !== 1) throw new Error("Matching final Prisma target did not reach the spawn boundary exactly once.");
  return { alternateDatabaseBlocked: mismatchBlocked, matchingTargetReachedSpawnBoundary: spawnCount === 1 };
}

async function main() {
  const key = randomBytes(32);
  const encodedKey = key.toString("base64");
  let alternateDatabaseBlocked = false;
  const scratch = await mkdtemp(path.join(os.tmpdir(), "bodycast-safety-ci-"));
  const archive = path.join(scratch, "synthetic.pgdump.enc");
  try {
    verifyPinnedPostgresClientVersions();
    const mixedSshKeysFiltered = verifyMixedSshKeyFiltering(scratch);
    const migrationDirectories = await createSourceFixture();
    const sourceReport = readSourceReport();
    if (typeof sourceReport.identity?.databaseOid !== "number" || typeof sourceReport.identity?.serverPort !== "number") {
      throw new Error("Production preflight identity JSON must preserve numeric database OID and server port values for Prisma target binding.");
    }
    const prismaTargetResult = await verifyPrismaTargetBinding({
      sourceUrl: databaseUrl(source),
      alternateUrl: databaseUrl(target),
      signedIdentity: sourceReport.identity,
      scratch,
    });
    const evaluated = evaluateProductionPreflight(sourceReport, migrationDirectories);
    if (!evaluated.readyForOwnerAuthorization || JSON.stringify(evaluated.pending) !== JSON.stringify([...EXPECTED_PENDING_MIGRATIONS].sort())) {
      throw new Error(`Synthetic preflight did not recognize the exact reviewed pending set: ${JSON.stringify(evaluated.blockers)}`);
    }
    const compatibilityOnlyTopology = {
      schemaVersion: 1,
      contract: PREVIOUS_APP_COMPATIBILITY_SNAPSHOT_CONTRACT,
      ready: false,
      blockers: ["writer drain is not asserted by a previous-app compatibility snapshot"],
    };
    const previousAppSnapshot = JSON.parse(sql(source,
      renderProductionDbPreflightSql(requireSql("scripts/production-db-preflight.sql")),
      { writerTopology: compatibilityOnlyTopology }));
    previousAppSnapshot.logicalDataFingerprint = logicalDataFingerprint(source);
    assertPreviousAppCompatibilitySnapshot(previousAppSnapshot);
    const snapshotAdmission = evaluateProductionPreflight(previousAppSnapshot, migrationDirectories);
    if (snapshotAdmission.readyForOwnerAuthorization || snapshotAdmission.writerDrainReady) {
      throw new Error("The pre-stop compatibility snapshot was incorrectly admitted as migration-ready writer-drain evidence.");
    }
    const previousAppContainer = {
      Id: "d".repeat(64), Image: `sha256:${"e".repeat(64)}`,
      Config: { Labels: {}, Env: ["NODE_ENV=production", "DATABASE_URL=postgresql://bodycast:fixture@db/bodycast"],
        Entrypoint: ["node"], Cmd: ["server.js"], User: "node", WorkingDir: "/app",
        Healthcheck: { Test: ["CMD", "true"] }, ExposedPorts: { "3000/tcp": {} } },
      HostConfig: { Binds: [], Mounts: [], PortBindings: {}, RestartPolicy: { Name: "unless-stopped" } },
      Mounts: [], NetworkSettings: { Networks: { "bodycast-backend-prod": {} } }, State: { Health: { Status: "healthy" } },
    };
    const previousAppRecord = capturePreviousAppProvenance({
      container: previousAppContainer,
      databaseReport: previousAppSnapshot,
      targetSha: "a".repeat(40),
    });
    const previousAppBinding = verifyPreviousAppCaptureMatchesPreflight(previousAppRecord, evaluated, "a".repeat(40));
    if (!previousAppBinding.verified || previousAppBinding.provenanceKind !== "legacy-unlabeled-v1") {
      throw new Error("Read-only previous-app schema/history snapshot did not bind to the later drained preflight.");
    }
    if (sourceReport.writerDrain?.observerApplicationName !== "bodycast-production-preflight"
      || sourceReport.writerDrain?.activeClientBackends?.length !== 0) {
      throw new Error("Expected the isolated preflight observer to be the only PostgreSQL client backend.");
    }
    const signedWriterDrainDigest = canonicalSha256(sourceReport.writerDrain);
    let oldWriterBlocked = false;
    let reconnectBetweenPreflightAndFinalGuardBlocked = false;
    await withClientBackend(source, "bodycast-old-relative-muscle-writer", async (reconnectedReport) => {
      if (reconnectedReport.writerDrain.activeClientBackends.length !== 1
        || reconnectedReport.writerDrain.activeClientBackends[0]?.present !== true) {
        throw new Error("The reconnected old application writer was not represented by one sanitized live PostgreSQL backend fact.");
      }
      const finalDecision = evaluateProductionPreflight(reconnectedReport, migrationDirectories);
      if (finalDecision.readyForOwnerAuthorization || !finalDecision.blockers.some((blocker) => blocker.includes("client backend(s)"))) {
        throw new Error("A reconnected old Relative Muscle writer did not block the final pre-DDL readiness check.");
      }
      if (canonicalSha256(reconnectedReport.writerDrain) === signedWriterDrainDigest) {
        throw new Error("A writer reconnect did not change the signed-versus-final writer-drain observation.");
      }
      oldWriterBlocked = true;
      reconnectBetweenPreflightAndFinalGuardBlocked = true;
    });
    const unknownClientReport = structuredClone(sourceReport);
    unknownClientReport.writerDrain.activeClientBackends = [{ present: true }];
    const unknownClientDecision = evaluateProductionPreflight(unknownClientReport, migrationDirectories);
    if (unknownClientDecision.readyForOwnerAuthorization || !unknownClientDecision.blockers.some((blocker) => blocker.includes("client backend(s)"))) {
      throw new Error("An unknown/proxied PostgreSQL client identity was not blocked.");
    }
    const ambiguousTopologyReport = structuredClone(sourceReport);
    ambiguousTopologyReport.writerDrain.topology.database.publishedPostgresPort = true;
    const ambiguousTopologyDecision = evaluateProductionPreflight(ambiguousTopologyReport, migrationDirectories);
    if (ambiguousTopologyDecision.readyForOwnerAuthorization || !ambiguousTopologyDecision.blockers.some((blocker) => blocker.includes("topology drain evidence"))) {
      throw new Error("A published/NAT-ambiguous PostgreSQL topology was not blocked.");
    }
    const missingStage02Objects = EXPECTED_MIGRATION_OBJECTS.filter((name) => (
      !sourceReport.objects.some((object) => object.name === name && object.present)
    ));
    if (missingStage02Objects.length) throw new Error(`Synthetic baseline is missing applied Stage 02 objects: ${missingStage02Objects.join(", " )}.`);

    assertBlocked(sourceReport, migrationDirectories,
      (report) => { report.objects.find((object) => object.name === ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects[0]).present = true; }, "already exist");
    assertBlocked(sourceReport, migrationDirectories,
      (report) => { report.migrations.push({ name: migrationDirectories[0], startedAt: "2026-01-02T00:00:00Z", finishedAt: null, rolledBackAt: null }); }, "Incomplete/failed migration");
    const longTransactionReport = structuredClone(sourceReport);
    longTransactionReport.longTransactions.push({ pid: 123, xactAgeSeconds: 400 });
    const longTransactionDecision = evaluateProductionPreflight(longTransactionReport, migrationDirectories);
    if (!longTransactionDecision.readyForOwnerAuthorization
      || !longTransactionDecision.diagnostics.longTransactions.some((item) => item.pid === 123 && item.xactAgeSeconds === 400)) {
      throw new Error("Preflight did not preserve the long-transaction diagnostic without treating it as a readiness blocker.");
    }
    assertBlocked(sourceReport, migrationDirectories,
      (report) => { report.conflictingLocks.push({ pid: 123, relation: "StrengthDiarySession", blockerCount: 1 }); }, "lock(s) conflict with the exact migration DDL operations");

    const ddlLockCases = [
      { tableName: "Workout", lockMode: "ROW EXCLUSIVE", pgMode: "RowExclusiveLock" },
      { tableName: "Profile", lockMode: "ROW EXCLUSIVE", pgMode: "RowExclusiveLock" },
      { tableName: "ModelEpisode", lockMode: "ROW EXCLUSIVE", pgMode: "RowExclusiveLock" },
      { tableName: "PhysiologyV7Lifecycle", lockMode: "ACCESS SHARE", pgMode: "AccessShareLock" },
      { tableName: "DailyModelState", lockMode: "ACCESS SHARE", pgMode: "AccessShareLock" },
    ];
    const ddlLockTargets = ddlLockCases.map((item) => item.tableName);
    const shortGrantedLocksRejected = [];
    for (const { tableName, lockMode, pgMode } of ddlLockCases) {
      await withShortGrantedRelationLock(tableName, lockMode, () => {
        const report = readSourceReport();
        const observed = report.conflictingLocks.some((lock) => (
          Number.isInteger(lock.pid)
          && lock.blockerType === "backend"
          && lock.relation === tableName
          && lock.mode === pgMode
          && lock.granted === true
        ));
        if (!observed) throw new Error(`Preflight missed the actively held short ${lockMode} relation lock on ${tableName}.`);
        const decision = evaluateProductionPreflight(report, migrationDirectories);
        if (decision.readyForOwnerAuthorization
          || !decision.blockers.some((blocker) => blocker.includes("lock(s) conflict with the exact migration DDL operations"))) {
          throw new Error(`Preflight did not block the conflicting ${lockMode} lock on ${tableName}.`);
        }
      });
      shortGrantedLocksRejected.push(`${tableName}:${pgMode}`);
    }
    const compatibleLockIgnored = [];
    for (const tableName of ["Workout", "Profile", "ModelEpisode"]) {
      await withShortGrantedRelationLock(tableName, "ACCESS SHARE", () => {
        const report = readSourceReport();
        if (report.conflictingLocks.some((lock) => lock.relation === tableName && lock.mode === "AccessShareLock")) {
          throw new Error(`A compatible ACCESS SHARE lock on FK-only parent ${tableName} was reported as a DDL blocker.`);
        }
        const decision = evaluateProductionPreflight(report, migrationDirectories);
        if (decision.blockers.some((blocker) => blocker.includes("lock(s) conflict with the exact migration DDL operations"))) {
          throw new Error(`A compatible ACCESS SHARE lock on FK-only parent ${tableName} became a DDL lock blocker.`);
        }
        if (decision.blockers.length !== 1 || !decision.blockers[0].includes("client backend(s)")) {
          throw new Error(`Compatible-lock observation had an unexpected blocker set: ${decision.blockers.join(" ")}`);
        }
      });
      compatibleLockIgnored.push(`${tableName}:AccessShareLock`);
    }
    let unrelatedShortLockIgnored = false;
    await withShortGrantedRelationLock("BodycastUnrelatedLockProbe", "ACCESS SHARE", () => {
      const report = readSourceReport();
      if (report.conflictingLocks.some((lock) => lock.relation === "BodycastUnrelatedLockProbe")) {
        throw new Error("An unrelated granted relation lock was incorrectly added to the DDL blocker inventory.");
      }
      const decision = evaluateProductionPreflight(report, migrationDirectories);
      if (decision.blockers.some((blocker) => blocker.includes("lock(s) conflict with the exact migration DDL operations"))) {
        throw new Error("An unrelated granted relation lock incorrectly became a DDL blocker.");
      }
      if (decision.blockers.length !== 1 || !decision.blockers[0].includes("client backend(s)")) {
        throw new Error(`Unrelated-lock observation had an unexpected blocker set: ${decision.blockers.join(" ")}`);
      }
      unrelatedShortLockIgnored = true;
    });
    const releasedLockReport = readSourceReport();
    if (releasedLockReport.conflictingLocks.some((lock) => ddlLockTargets.includes(lock.relation) && lock.mode === "AccessShareLock")) {
      throw new Error("A short relation lock was not released after its deterministic lock test.");
    }
    if (!evaluateProductionPreflight(releasedLockReport, migrationDirectories).readyForOwnerAuthorization) {
      throw new Error("Preflight did not return to ready after short granted locks were released.");
    }

    let preparedLockRejected = false;
    let preparedLockCleanupRestoredReadiness = false;
    let unrelatedPreparedLockIgnored = false;
    await withPreparedLockPostgres(async (preparedDb) => {
      const preparedMigrations = await createSourceFixture(preparedDb);
      const cleanReport = readSourceReport(preparedDb);
      if (!evaluateProductionPreflight(cleanReport, preparedMigrations).readyForOwnerAuthorization) {
        throw new Error("Prepared-lock PostgreSQL baseline was not ready before the prepared transaction test.");
      }
      await withPreparedTransactionRelationLock(preparedDb, "BodycastUnrelatedLockProbe", async (gid) => {
        const report = readSourceReport(preparedDb);
        if (!report.preparedTransactions.some((item) => item.gid === gid && item.transaction && item.preparedAt)) {
          throw new Error("The unrelated prepared transaction was not visible in separate prepared-transaction diagnostics.");
        }
        if (report.conflictingLocks.some((item) => item.relation === "BodycastUnrelatedLockProbe")) {
          throw new Error("An unrelated prepared relation lock was incorrectly treated as a Stage 02 DDL blocker.");
        }
        if (!evaluateProductionPreflight(report, preparedMigrations).readyForOwnerAuthorization) {
          throw new Error("An unrelated prepared transaction incorrectly blocked production preflight readiness.");
        }
        unrelatedPreparedLockIgnored = true;
      });

      await withPreparedTransactionRelationLock(preparedDb, "DailyModelState", async (gid) => {
        if (sql(preparedDb, `SELECT EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE gid = '${gid}');`) !== "t") {
          throw new Error("The test prepared transaction was not present in pg_prepared_xacts.");
        }
        const report = readSourceReport(preparedDb);
        const lock = report.conflictingLocks.find((item) => (
          item.pid === null
          && item.blockerType === "prepared-transaction"
          && item.relation === "DailyModelState"
          && item.mode === "RowExclusiveLock"
          && item.granted === true
        ));
        if (!lock) {
          throw new Error(`Preflight lost the prepared transaction's granted DailyModelState relation lock. Diagnostic: ${JSON.stringify({ preparedTransactions: report.preparedTransactions, conflictingLocks: report.conflictingLocks })}`);
        }
        if (Object.hasOwn(lock, "preparedTransactionId") || lock.xactAgeSeconds !== null) {
          throw new Error("Preflight made an unverified per-lock prepared GID or age attribution.");
        }
        if (!report.preparedTransactions.some((item) => item.gid === gid && item.transaction && item.preparedAt)) {
          throw new Error("Preflight did not report prepared transaction metadata separately from per-lock attribution.");
        }
        const decision = evaluateProductionPreflight(report, preparedMigrations);
        if (decision.readyForOwnerAuthorization
          || !decision.blockers.some((blocker) => blocker.includes("lock(s) conflict with the exact migration DDL operations"))) {
          throw new Error("Preflight did not block the prepared transaction relation lock conflicting with Stage 02 ALTER TABLE.");
        }
        preparedLockRejected = true;
      });

      const afterCleanup = readSourceReport(preparedDb);
      if (afterCleanup.conflictingLocks.some((item) => item.blockerType === "prepared-transaction")) {
        throw new Error("The prepared transaction lock remained after ROLLBACK PREPARED cleanup.");
      }
      if (afterCleanup.preparedTransactions.some((item) => item.gid.startsWith("bodycast-ci-prepared-lock-"))) {
        throw new Error("A smoke prepared transaction remained after its guaranteed ROLLBACK PREPARED cleanup.");
      }
      if (!evaluateProductionPreflight(afterCleanup, preparedMigrations).readyForOwnerAuthorization) {
        throw new Error("Preflight did not return to ready after prepared transaction cleanup.");
      }
      preparedLockCleanupRestoredReadiness = true;
    });
    if (!preparedLockRejected || !preparedLockCleanupRestoredReadiness || !unrelatedPreparedLockIgnored) {
      throw new Error("Prepared-transaction lock smoke did not prove blocker detection, unrelated-lock handling, and cleanup/readiness restoration.");
    }

    const dump = captureDump(source);
    const encrypted = await encryptBackupStream(dump.stream, archive, key);
    await dump.exited;
    const metadata = await stat(archive);
    if (metadata.size <= 36 || encrypted.inputBytes === 0 || (process.platform !== "win32" && (metadata.mode & 0o777) !== 0o600)) {
      throw new Error("Synthetic encrypted custom-format backup is empty or lacks restrictive permissions.");
    }

    const disposableContainer = run("docker", ["ps", "--quiet", "--filter", "label=bodycast.environment=nonproduction", "--filter", "label=bodycast.disposable=true"])
      .split("\n")[0];
    if (!disposableContainer) throw new Error("Could not identify the explicitly labelled disposable PostgreSQL target service.");
    const verifiedRestore = spawnSync(process.execPath, ["scripts/verify-postgres-restore.mjs", "--container", disposableContainer, "--user", target.user, "--backup", archive, "--confirm-disposable-target", "nonproduction-disposable"], {
      encoding: "utf8", env: { ...process.env, PRODUCTION_BACKUP_ENCRYPTION_KEY: encodedKey }, windowsHide: true,
    });
    if (verifiedRestore.status !== 0 || !verifiedRestore.stdout.includes("Disposable restore verified: ")) {
      throw new Error(`The restore verifier's labeled disposable-target path failed: ${verifiedRestore.stderr || verifiedRestore.stdout}`);
    }

    await restoreDump(target, archive, key);
    const restoredReport = JSON.parse(sql(target, requireSql("scripts/verify-restored-backup.sql")));
    restoredReport.logicalDataFingerprint = logicalDataFingerprint(target);
    const fingerprintUrl = new URL(databaseUrl(target));
    fingerprintUrl.search = "";
    const standaloneFingerprint = execFileSync("bash", ["scripts/production-db-data-fingerprint.sh", "--test-url"], {
      encoding: "utf8", env: { ...process.env, BODYCAST_TEST_DATABASE_URL: fingerprintUrl.toString() },
    }).trim();
    if (standaloneFingerprint !== restoredReport.logicalDataFingerprint) {
      throw new Error("The isolated safety fixture fingerprint differs from the standalone production data-fingerprint contract.");
    }
    const alternateDatabasePreflight = readSourceReport(target);
    try {
      assertProductionDatabaseIdentityMatches(sourceReport.identity, alternateDatabasePreflight.identity);
    } catch (error) {
      if (!String(error?.message ?? error).includes("differs from the signed preflight target")) throw error;
      alternateDatabaseBlocked = true;
    }
    if (!alternateDatabaseBlocked) throw new Error("Signed preflight identity accepted a different isolated PostgreSQL database endpoint.");
    const alternateDatabaseDecision = evaluateProductionPreflight(alternateDatabasePreflight, migrationDirectories);
    if (alternateDatabaseDecision.readyForOwnerAuthorization
      || !alternateDatabaseDecision.blockers.some((blocker) => blocker.includes("Connected database/role identity differs"))) {
      throw new Error("Production preflight did not block the alternate isolated PostgreSQL endpoint.");
    }
    const restored = verifyRestoredBackup(sourceReport, restoredReport);
    if (!restored.verified) throw new Error(`Restored database verification failed: ${restored.blockers.join(" ")}`);
    if (restoredReport.readability.StrengthDiarySession.rowCount !== 2 || restoredReport.readability.ExerciseCatalog.rowCount !== 3) {
      throw new Error("Restored fixture tables did not return the expected rows.");
    }

    await deployPendingPrismaMigrations(target, scratch);
    const migratedReport = readSourceReport(target);
    const migratedDecision = evaluateProductionPostflight(migratedReport, migrationDirectories, ACTIVE_ENERGY_UNIFIED_MANIFEST.id, {
      expectedDatabase: target.database,
      expectedRole: target.user,
    });
    if (!migratedDecision.ready) {
      throw new Error(`Full populated Relative Muscle + glycogen migration postflight failed: ${migratedDecision.blockers.join(" ")}`);
    }
    assertLegacyRelativeMuscleUpsertsRejected(target);

    const corruptedArchive = await readFile(archive);
    corruptedArchive[corruptedArchive.length - 17] ^= 0x20;
    const tamperedPath = path.join(scratch, "tampered.pgdump.enc");
    await writeFile(tamperedPath, corruptedArchive, { mode: 0o600 });
    let tamperRejected = false;
    try {
      await decryptBackupToWritable(tamperedPath, new Writable({ write(_chunk, _encoding, callback) { callback(); } }), key);
    } catch { tamperRejected = true; }
    if (!tamperRejected) throw new Error("Tampered authenticated backup was accepted.");

    const guarded = spawnSync(process.execPath, ["scripts/verify-postgres-restore.mjs", "--container", "bodycast-db-prod", "--user", "bodycast", "--backup", archive, "--confirm-disposable-target", "nonproduction-disposable"], {
      encoding: "utf8", env: { ...process.env, PRODUCTION_BACKUP_ENCRYPTION_KEY: encodedKey }, windowsHide: true,
    });
    if (guarded.status === 0 || !guarded.stderr.includes("production-like container names are forbidden")) {
      throw new Error("Restore script did not fail closed for a production-like target name.");
    }

    run("docker", ["create", "--name", "bodycast-ci-unmarked-target", POSTGRES_IMAGE]);
    try {
      const unmarked = spawnSync(process.execPath, ["scripts/verify-postgres-restore.mjs", "--container", "bodycast-ci-unmarked-target", "--user", target.user, "--backup", archive, "--confirm-disposable-target", "nonproduction-disposable"], {
        encoding: "utf8", env: { ...process.env, PRODUCTION_BACKUP_ENCRYPTION_KEY: encodedKey }, windowsHide: true,
      });
      if (unmarked.status === 0 || !unmarked.stderr.includes("require a non-production container labelled")) {
        throw new Error("Restore script did not fail closed for a target without explicit disposable labels.");
      }
    } finally {
      run("docker", ["rm", "--force", "bodycast-ci-unmarked-target"]);
    }

    run("docker", ["context", "create", "bodycast-production-ci", "--docker", "host=unix:///var/run/docker.sock"]);
    try {
      const productionContext = spawnSync(process.execPath, ["scripts/verify-postgres-restore.mjs", "--container", disposableContainer, "--user", target.user, "--backup", archive, "--confirm-disposable-target", "nonproduction-disposable"], {
        encoding: "utf8", env: { ...process.env, DOCKER_CONTEXT: "bodycast-production-ci", PRODUCTION_BACKUP_ENCRYPTION_KEY: encodedKey }, windowsHide: true,
      });
      if (productionContext.status === 0 || !productionContext.stderr.includes("production-like Docker contexts are forbidden")) {
        throw new Error("Restore script did not fail closed for a production-like Docker context.");
      }
    } finally {
      run("docker", ["context", "rm", "--force", "bodycast-production-ci"]);
    }

    const remoteDocker = spawnSync(process.execPath, ["scripts/verify-postgres-restore.mjs", "--container", "bodycast-ci-restore", "--user", target.user, "--backup", archive, "--confirm-disposable-target", "nonproduction-disposable"], {
      encoding: "utf8", env: { ...process.env, DOCKER_HOST: "ssh://production.example/docker.sock", PRODUCTION_BACKUP_ENCRYPTION_KEY: encodedKey }, windowsHide: true,
    });
    if (remoteDocker.status === 0 || !remoteDocker.stderr.includes("local daemon")) {
      throw new Error("Restore script did not fail closed for a remote/production Docker endpoint.");
    }

    const conflictingDockerTarget = spawnSync(process.execPath, ["scripts/verify-postgres-restore.mjs", "--container", "bodycast-ci-restore", "--user", target.user, "--backup", archive, "--confirm-disposable-target", "nonproduction-disposable"], {
      encoding: "utf8", env: {
        ...process.env,
        DOCKER_CONTEXT: "remote-context",
        DOCKER_HOST: "unix:///var/run/docker.sock",
        PRODUCTION_BACKUP_ENCRYPTION_KEY: encodedKey,
      }, windowsHide: true,
    });
    if (conflictingDockerTarget.status === 0 || !conflictingDockerTarget.stderr.includes("DOCKER_CONTEXT and DOCKER_HOST conflict")) {
      throw new Error("Restore script accepted a remote Docker context combined with a local-looking Docker host.");
    }

    process.stdout.write(JSON.stringify({
      result: "passed",
      postgresImage: POSTGRES_IMAGE,
      syntheticMigrations: migrationDirectories.length,
      exactPending: evaluated.pending,
      allowedSinglePreflightConnection: true,
      previousAppCompatibilitySnapshotNonAdmission: !snapshotAdmission.readyForOwnerAuthorization,
      previousAppCompatibilityBoundToDrainedPreflight: previousAppBinding.verified,
      oldWriterBlocked,
      unknownClientBlocked: true,
      ambiguousPostgresTopologyBlocked: true,
      reconnectBetweenPreflightAndFinalGuardBlocked,
      backupFormat: "custom-format pg_dump encrypted with authenticated AES-256-GCM",
      encryptedBytes: metadata.size,
      verifierPositivePath: true,
      restoredMigrationRows: restored.migrationCount,
      restoredStrengthDiarySessionRows: restoredReport.readability.StrengthDiarySession.rowCount,
      restoredExerciseCatalogRows: restoredReport.readability.ExerciseCatalog.rowCount,
      populatedSixMigrationSequence: true,
      relativeMuscleOldClientUpsertsRejected: ["ExperimentalSkeletalMuscleDeltaShadow", "ExperimentalCessationDetrainingShadow"],
      tamperRejected,
      productionContainerNameRejected: true,
      productionDockerContextRejected: true,
      missingDisposableMarkerRejected: true,
      remoteDockerEndpointRejected: true,
      dockerContextHostConflictRejected: true,
      shortGrantedDdlLockTargetsRejected: shortGrantedLocksRejected,
      preparedTransactionRelationLockRejected: preparedLockRejected,
      preparedTransactionCleanupRestoredReadiness: preparedLockCleanupRestoredReadiness,
      unrelatedPreparedLockIgnored,
      unrelatedShortLockIgnored,
      shortGrantedLocksRejected,
      compatibleLockIgnored,
      alternateDatabaseBlocked,
      finalPrismaTarget: prismaTargetResult,
      mixedSshKeysFiltered,
      blockersChecked: [
        "partial object", "failed migration", "long transaction diagnostic",
        ...shortGrantedLocksRejected.map((tableName) => `short granted DDL lock: ${tableName}`),
        ...compatibleLockIgnored.map((relation) => `compatible lock ignored: ${relation}`),
        "unrelated short lock ignored", "prepared transaction DDL-conflicting relation lock",
        "alternate database endpoint blocked", "matching final Prisma endpoint reached spawn boundary",
      ],
    }, null, 2) + "\n");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
