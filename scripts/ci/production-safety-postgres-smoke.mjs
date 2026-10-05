import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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
  verifyRestoredBackup,
} from "../production-migration-preflight.mjs";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST, STAGE_02_MANIFEST } from "../production-migration-manifests.mjs";
import { renderProductionDbPreflightSql } from "../production-db-preflight.mjs";
import { assertPostgresClientCompatibility } from "../postgres-client-versions.mjs";

const source = { host: "127.0.0.1", port: Number(process.env.BODYCAST_SOURCE_PORT ?? 5432), database: "bodycast", user: "bodycast", password: "bodycast_ci_only" };
const target = { host: "127.0.0.1", port: Number(process.env.BODYCAST_RESTORE_PORT ?? 5433), database: "bodycast_restore", user: "bodycast_restore", password: "restore_ci_only" };
const POSTGRES_IMAGE = "postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";

function run(command, args, { input, env = process.env } = {}) {
  const result = spawnSync(command, args, { input, encoding: "utf8", env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.error?.message}): ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout.trim();
}

function clientArgs(db, tool) {
  return ["run", "--rm", "--interactive", "--network", "host", "--env", `PGPASSWORD=${db.password}`, POSTGRES_IMAGE, tool,
    "--host", db.host, "--port", String(db.port), "--username", db.user, "--dbname", db.database];
}

function sql(db, content) {
  return run("docker", [...clientArgs(db, "psql"), "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=verbose", "--file=-"], { input: content });
}

async function createSourceFixture(db = source) {
  const migrationDirectories = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const applied = migrationDirectories.filter((name) => !EXPECTED_PENDING_MIGRATIONS.includes(name));
  const rows = await Promise.all(applied.map(async (name, index) => {
    const migrationSql = await readFile(path.join("prisma/migrations", name, "migration.sql"));
    const checksum = createHash("sha256").update(migrationSql).digest("hex");
    const started = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    const finished = new Date(Date.UTC(2026, 0, 1, 0, 0, index + 1)).toISOString();
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    return `(${quote(`ci-migration-${index}`)}, ${quote(checksum)}, ${quote(started)}, ${quote(finished)}, ${quote(name)}, ${quote("CI synthetic applied migration")}, 1)`;
  }));

  const createSql = `
    CREATE TABLE public."_prisma_migrations" (
      id text PRIMARY KEY, checksum text NOT NULL, started_at timestamp NOT NULL,
      finished_at timestamp, migration_name text NOT NULL, logs text,
      rolled_back_at timestamp, applied_steps_count integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Workout" (id text PRIMARY KEY);
    CREATE TABLE public."Profile" (id text PRIMARY KEY);
    CREATE TABLE public."ModelEpisode" (id text PRIMARY KEY);
    CREATE TABLE public."PhysiologyV7Lifecycle" (id text PRIMARY KEY);
    CREATE TABLE public."DailyModelState" (id text PRIMARY KEY);
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
  `;
  sql(db, createSql);
  for (const { name } of STAGE_02_MANIFEST.migrations) {
    sql(db, await readFile(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
  }
  return migrationDirectories;
}

function readSourceReport(db = source) {
  const report = sql(db, renderProductionDbPreflightSql(requireSql("scripts/production-db-preflight.sql")));
  return JSON.parse(report);
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

async function withPreparedLockPostgres(work) {
  const containerName = `bodycast-ci-prepared-lock-${randomBytes(6).toString("hex")}`;
  let created = false;
  try {
    run("docker", [
      "create", "--name", containerName, "--publish", "127.0.0.1::5432",
      "--env", "POSTGRES_DB=bodycast", "--env", "POSTGRES_USER=bodycast", "--env", "POSTGRES_PASSWORD=prepared_lock_ci_only",
      "--label", "bodycast.safety-test=prepared-lock", POSTGRES_IMAGE,
      "postgres", "-c", "max_prepared_transactions=10",
    ]);
    created = true;
    run("docker", ["start", containerName]);
    const publishedPort = run("docker", ["port", containerName, "5432/tcp"]);
    const match = publishedPort.match(/:(\d+)\s*$/);
    if (!match) throw new Error("Could not identify the host port for prepared-lock disposable PostgreSQL.");
    const db = {
      host: "127.0.0.1", port: Number(match[1]), database: "bodycast",
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
    "HealthMetricSample", "StrengthDiarySession", "DailyModelState", "Workout", "Profile", "ModelEpisode", "BodycastUnrelatedLockProbe",
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

async function withShortGrantedRelationLock(tableName, work) {
  const alterTargets = new Set([
    "ExerciseCatalog", "ProgramExercise", "StrengthSessionExercise", "StrengthSet",
    "HealthMetricSample", "StrengthDiarySession", "DailyModelState", "Workout", "Profile", "ModelEpisode", "BodycastUnrelatedLockProbe",
  ]);
  if (!alterTargets.has(tableName)) throw new Error("Refusing to test an unreviewed relation lock target.");

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
  child.stdin.write(`BEGIN;\nSELECT count(*) FROM public."${tableName}";\n\\echo BODYCAST_SHORT_LOCK_HELD\n`);
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
    const evaluated = evaluateProductionPreflight(sourceReport, migrationDirectories);
    if (!evaluated.readyForOwnerAuthorization || JSON.stringify(evaluated.pending) !== JSON.stringify([...EXPECTED_PENDING_MIGRATIONS].sort())) {
      throw new Error(`Synthetic preflight did not recognize the exact pending pair: ${JSON.stringify(evaluated.blockers)}`);
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

    const ddlLockTargets = ["Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState"];
    const shortGrantedLocksRejected = [];
    for (const tableName of ddlLockTargets) {
      await withShortGrantedRelationLock(tableName, () => {
        const report = readSourceReport();
        const observed = report.conflictingLocks.some((lock) => (
          Number.isInteger(lock.pid)
          && lock.blockerType === "backend"
          && lock.relation === tableName
          && lock.mode === "AccessShareLock"
          && lock.granted === true
        ));
        if (!observed) throw new Error(`Preflight missed the actively held short ACCESS SHARE relation lock on ${tableName}.`);
        const decision = evaluateProductionPreflight(report, migrationDirectories);
        if (decision.readyForOwnerAuthorization
          || !decision.blockers.some((blocker) => blocker.includes("lock(s) conflict with the exact migration DDL operations"))) {
          throw new Error(`Preflight did not block the short granted ${tableName} lock referenced by migration DDL.`);
        }
      });
      shortGrantedLocksRejected.push(tableName);
    }
    let unrelatedShortLockIgnored = false;
    await withShortGrantedRelationLock("BodycastUnrelatedLockProbe", () => {
      const report = readSourceReport();
      if (report.conflictingLocks.some((lock) => lock.relation === "BodycastUnrelatedLockProbe")) {
        throw new Error("An unrelated granted relation lock was incorrectly added to the DDL blocker inventory.");
      }
      if (!evaluateProductionPreflight(report, migrationDirectories).readyForOwnerAuthorization) {
        throw new Error("An unrelated granted relation lock incorrectly blocked production preflight.");
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
    if (metadata.size <= 36 || encrypted.inputBytes === 0 || (metadata.mode & 0o777) !== 0o600) {
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
      backupFormat: "custom-format pg_dump encrypted with authenticated AES-256-GCM",
      encryptedBytes: metadata.size,
      verifierPositivePath: true,
      restoredMigrationRows: restored.migrationCount,
      restoredStrengthDiarySessionRows: restoredReport.readability.StrengthDiarySession.rowCount,
      restoredExerciseCatalogRows: restoredReport.readability.ExerciseCatalog.rowCount,
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
      alternateDatabaseBlocked,
      mixedSshKeysFiltered,
      blockersChecked: [
        "partial object", "failed migration", "long transaction diagnostic",
        ...shortGrantedLocksRejected.map((tableName) => `short granted DDL lock: ${tableName}`),
        "unrelated short lock ignored", "prepared transaction DDL-conflicting relation lock", "alternate database endpoint blocked",
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
