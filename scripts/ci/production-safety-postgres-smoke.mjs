import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import { decryptBackupToWritable, encryptBackupStream } from "../production-backup-envelope.mjs";
import {
  evaluateProductionPreflight,
  EXPECTED_MIGRATION_OBJECTS,
  EXPECTED_PENDING_MIGRATIONS,
  verifyRestoredBackup,
} from "../production-migration-preflight.mjs";

const source = { host: "127.0.0.1", port: Number(process.env.BODYCAST_SOURCE_PORT ?? 5432), database: "bodycast", user: "bodycast", password: "bodycast_ci_only" };
const target = { host: "127.0.0.1", port: Number(process.env.BODYCAST_RESTORE_PORT ?? 5433), database: "bodycast_restore", user: "bodycast_restore", password: "restore_ci_only" };

function run(command, args, { input, env = process.env } = {}) {
  const result = spawnSync(command, args, { input, encoding: "utf8", env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.error?.message}): ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout.trim();
}

function clientArgs(db, tool) {
  return ["run", "--rm", "--interactive", "--network", "host", "--env", `PGPASSWORD=${db.password}`, "postgres:17-alpine", tool,
    "--host", db.host, "--port", String(db.port), "--username", db.user, "--dbname", db.database];
}

function sql(db, content) {
  return run("docker", [...clientArgs(db, "psql"), "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--file=-"], { input: content });
}

async function createSourceFixture() {
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
    CREATE TABLE public."StrengthDiarySession" (id text PRIMARY KEY);
    CREATE TABLE public."ExerciseCatalog" (id text PRIMARY KEY);
    INSERT INTO public."_prisma_migrations" (id, checksum, started_at, finished_at, migration_name, logs, applied_steps_count)
    VALUES ${rows.join(",\n")};
    INSERT INTO public."StrengthDiarySession" VALUES ('session-ci-1'), ('session-ci-2');
    INSERT INTO public."ExerciseCatalog" VALUES ('exercise-ci-1'), ('exercise-ci-2'), ('exercise-ci-3');
  `;
  sql(source, createSql);
  return migrationDirectories;
}

function readSourceReport() {
  const report = sql(source, requireSql("scripts/production-db-preflight.sql"));
  return JSON.parse(report);
}

async function withShortGrantedRelationLock(tableName, work) {
  const alterTargets = new Set([
    "ExerciseCatalog", "ProgramExercise", "StrengthSessionExercise", "StrengthSet",
    "HealthMetricSample", "StrengthDiarySession",
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
    "run", "--rm", "--network", "host", "--env", `PGPASSWORD=${db.password}`, "postgres:17-alpine", "pg_dump",
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
  const child = spawn("docker", [
    "run", "--rm", "--interactive", "--network", "host", "--env", `PGPASSWORD=${db.password}`, "postgres:17-alpine", "pg_restore",
    "--host", db.host, "--port", String(db.port), "--username", db.user, "--dbname", db.database,
    "--exit-on-error", "--no-owner", "--no-privileges", "--single-transaction",
  ], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`pg_restore failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`)));
  });
  exited.catch(() => {});
  await decryptBackupToWritable(archive, child.stdin, key);
  await exited;
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
  const scratch = await mkdtemp(path.join(os.tmpdir(), "bodycast-safety-ci-"));
  const archive = path.join(scratch, "synthetic.pgdump.enc");
  try {
    const mixedSshKeysFiltered = verifyMixedSshKeyFiltering(scratch);
    const migrationDirectories = await createSourceFixture();
    const sourceReport = readSourceReport();
    const evaluated = evaluateProductionPreflight(sourceReport, migrationDirectories);
    if (!evaluated.readyForOwnerAuthorization || JSON.stringify(evaluated.pending) !== JSON.stringify([...EXPECTED_PENDING_MIGRATIONS].sort())) {
      throw new Error(`Synthetic preflight did not recognize the exact pending pair: ${JSON.stringify(evaluated.blockers)}`);
    }
    if (sourceReport.objects.some((object) => object.present)) throw new Error("Synthetic Stage 02 object inventory was unexpectedly nonempty.");

    assertBlocked(sourceReport, migrationDirectories,
      (report) => { report.objects.find((object) => object.name === EXPECTED_MIGRATION_OBJECTS[0]).present = true; }, "already exist");
    assertBlocked(sourceReport, migrationDirectories,
      (report) => { report.migrations.push({ name: migrationDirectories[0], startedAt: "2026-01-02T00:00:00Z", finishedAt: null, rolledBackAt: null }); }, "Incomplete/failed migration");
    assertBlocked(sourceReport, migrationDirectories,
      (report) => { report.longTransactions.push({ pid: 123, xactAgeSeconds: 400 }); }, "transaction(s)");
    assertBlocked(sourceReport, migrationDirectories,
      (report) => { report.relevantLocks.push({ pid: 123, relation: "StrengthDiarySession", blockerCount: 1 }); }, "relevant DDL-conflicting relation lock(s)");

    let shortLockReport;
    await withShortGrantedRelationLock("ExerciseCatalog", () => {
      shortLockReport = readSourceReport();
      const observed = shortLockReport.relevantLocks.some((lock) => (
        lock.relation === "ExerciseCatalog" && lock.mode === "AccessShareLock" && lock.granted === true
      ));
      if (!observed) throw new Error("Preflight missed the actively held short ACCESS SHARE relation lock.");
      const lockDecision = evaluateProductionPreflight(shortLockReport, migrationDirectories);
      if (lockDecision.readyForOwnerAuthorization
        || !lockDecision.blockers.some((blocker) => blocker.includes("relevant DDL-conflicting relation lock(s)"))) {
        throw new Error("Preflight did not block a short granted lock conflicting with Stage 02 ALTER TABLE.");
      }
    });
    const releasedLockReport = readSourceReport();
    if (releasedLockReport.relevantLocks.some((lock) => lock.relation === "ExerciseCatalog" && lock.mode === "AccessShareLock")) {
      throw new Error("The short relation lock was not released after its deterministic lock test.");
    }
    if (!evaluateProductionPreflight(releasedLockReport, migrationDirectories).readyForOwnerAuthorization) {
      throw new Error("Preflight did not return to ready after the short granted lock was released.");
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

    run("docker", ["create", "--name", "bodycast-ci-unmarked-target", "postgres:17-alpine"]);
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
      postgres: "17-alpine",
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
      shortGrantedAlterTableLockRejected: true,
      mixedSshKeysFiltered,
      blockersChecked: ["partial object", "failed migration", "long transaction", "short granted DDL-conflicting relation lock"],
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
