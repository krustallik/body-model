import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { encryptBackupStream, decryptBackupToWritable } from "../production-backup-envelope.mjs";
import { canonicalSha256 } from "../production-migration-authorization.mjs";
import {
  capturePreviousAppProvenance,
  previousAppProvenanceBinding,
  serializePreviousAppProvenance,
  verifyPreviousAppCaptureMatchesPreflight,
} from "../production-previous-app-provenance.mjs";
import { assertCutbackRestoredDatabaseIdentity, verifyPreviousAppMigrationCompatibility,
  verifyRecreatedPreviousAppRuntime } from "../production-database-cutback.mjs";
import { assertLiveDataMatchesBackupFingerprint } from "../production-migration-final-guard.mjs";

const IMAGE = "public.ecr.aws/docker/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";
const databaseUrl = process.env.BODYCAST_CUTBACK_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("BODYCAST_CUTBACK_TEST_DATABASE_URL is required for isolated PostgreSQL cutback integration.");
const url = new URL(databaseUrl);
const adminDatabase = decodeURIComponent(url.pathname.slice(1));
const port = url.port ? Number(url.port) : 5432;
if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(url.hostname)
  || !Number.isSafeInteger(port) || port < 1 || port > 65535 || decodeURIComponent(url.username) !== "bodycast"
  || adminDatabase !== "bodycast_cutback_test" || url.search || url.hash || !url.password) {
  throw new Error("Cutback integration accepts only a loopback PostgreSQL URL for bodycast_cutback_test and no overrides.");
}
const scratchRoot = mkdtempSync(path.join(os.tmpdir(), "bodycast-cutback-pg-"));
const suffix = randomBytes(5).toString("hex");
const target = `bodycast_cutback_live_${suffix}`;
const staging = `bodycast_cutback_stage_${suffix}_test`;
const failed = `bodycast_cutback_failed_${suffix}_test`;
const promotionId = String(BigInt(`0x${randomBytes(5).toString("hex")}`) + 1n);
const promotionLive = `bodycast_cutback_live_${randomBytes(5).toString("hex")}`;
const promotionStage = `bodycast_cutback_${promotionId}`;
const promotionFailed = `bodycast_failed_${promotionId}`;
const promotionStagePreservedId = String(BigInt(`0x${randomBytes(5).toString("hex")}`) + 1n);
const promotionLivePreserved = `bodycast_cutback_live_${randomBytes(5).toString("hex")}`;
const promotionStagePreserved = `bodycast_cutback_${promotionStagePreservedId}`;
const promotionFailedPreserved = `bodycast_failed_${promotionStagePreservedId}`;
const password = decodeURIComponent(url.password);
const user = decodeURIComponent(url.username);
const host = url.hostname;
const portText = String(port);
const key = randomBytes(32);
const encryptedPath = path.join(scratchRoot, "snapshot.pgdump.enc");
const plainPath = path.join(scratchRoot, "snapshot.pgdump");

function docker(args, input) {
  return execFileSync("docker", args, { input, maxBuffer: 128 * 1024 * 1024, encoding: "buffer", stdio: ["pipe", "pipe", "pipe"] });
}
function runRenameFailureInjection({ live, stage, retained, failRestore, markerPath, lifecycleCalls }) {
  const script = path.resolve("scripts/ci/production-database-cutback-promotion-failure-injection.sh");
  let result;
  try {
    execFileSync("bash", [script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: {
      ...process.env,
      PROMOTION_HELPER: path.resolve("scripts/production-database-cutback-promotion.sh"),
      LIFECYCLE_HELPER: path.resolve("scripts/production-database-cutback-lifecycle.sh"),
      STAGE_DB: stage, FAILED_DB: retained, LIVE_DB: live, FAIL_RESTORE: failRestore ? "1" : "0",
      MARKER_PATH: markerPath, LIFECYCLE_DOCKER_CALLS: lifecycleCalls,
      PGPASSWORD: password, PGUSER: user, PGHOST: host, PGPORT: portText, POSTGRES_IMAGE: IMAGE,
    } });
    result = { status: 0, output: "" };
  } catch (error) {
    result = { status: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
  return result;
}
function psql(database, sql) {
  return docker(["run", "--rm", "--network", "host", "--env", `PGPASSWORD=${password}`, IMAGE, "psql",
    "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1",
    "--host", host, "--port", portText, "--username", user, "--dbname", database, "--command", sql]).toString("utf8").trim();
}
function sqlLiteral(value) { return `'${value.replaceAll("'", "''")}'`; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function queryRows(database) { return psql(database, "SELECT id::text || ':' || value FROM cutback_probe ORDER BY id;"); }
function querySchema(database) { return psql(database, "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='cutback_probe';"); }
function queryJson(database, sql) { return JSON.parse(psql(database, sql)); }
function queryReport(database) {
  return {
    identity: queryJson(database, `SELECT json_build_object(
      'database', current_database(), 'databaseOid', (SELECT oid::bigint FROM pg_database WHERE datname=current_database()),
      'clusterSystemIdentifier', (SELECT system_identifier::text FROM pg_control_system()), 'role', current_user,
      'serverVersion', current_setting('server_version'), 'serverAddress', inet_server_addr()::text, 'serverPort', inet_server_port()
    )::text;`),
    migrations: queryJson(database, `SELECT COALESCE(json_agg(json_build_object(
      'name', migration_name, 'checksum', checksum, 'startedAt', started_at, 'finishedAt', finished_at,
      'rolledBackAt', rolled_back_at, 'hasLogs', logs IS NOT NULL, 'logsFingerprint', md5(COALESCE(logs, ''))
    ) ORDER BY migration_name, started_at), '[]'::json)::text FROM public._prisma_migrations;`),
    objects: queryJson(database, `SELECT COALESCE(json_agg(json_build_object('name', table_name, 'present', true, 'kind', 'table', 'signature', signature)
      ORDER BY table_name), '[]'::json)::text FROM (
        SELECT table_name, string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) AS signature
        FROM information_schema.columns WHERE table_schema='public'
        GROUP BY table_name
      ) inventory;`),
  };
}
function queryReadability(database) {
  const tables = ["Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog"];
  const result = {};
  for (const table of tables) result[table] = { rowCount: Number(psql(database, `SELECT count(*) FROM public."${table}";`)) };
  return result;
}
function dataFingerprint(database = target) {
  const databaseUrlForFingerprint = new URL(databaseUrl);
  databaseUrlForFingerprint.pathname = `/${database}`;
  return execFileSync("bash", ["scripts/production-db-data-fingerprint.sh", "--test-url"], {
    encoding: "utf8", env: { ...process.env, BODYCAST_TEST_DATABASE_URL: databaseUrlForFingerprint.toString() },
  }).trim();
}
function appContainer(releaseSha) {
  return {
    Id: "d".repeat(64), Image: `sha256:${"e".repeat(64)}`,
    Config: {
      Labels: releaseSha ? { "org.bodycast.release-sha": releaseSha } : {},
      Env: ["NODE_ENV=production", "DATABASE_URL=postgresql://bodycast:masked@bodycast-db-prod/bodycast"],
      Entrypoint: ["node"], Cmd: ["server.js"], User: "node", WorkingDir: "/app",
      Healthcheck: { Test: ["CMD", "wget", "http://127.0.0.1:3000/api/readiness"] }, ExposedPorts: { "3000/tcp": {} },
    },
    HostConfig: { Binds: [], Mounts: [], PortBindings: {}, RestartPolicy: { Name: "unless-stopped" } },
    Mounts: [], NetworkSettings: { Networks: { "bodycast-backend-prod": {} } }, State: { Health: { Status: "healthy" } },
  };
}
function expectBlocked(action, message) {
  let rejected = false;
  try { action(); } catch { rejected = true; }
  assert(rejected, message);
}
function attemptRestore(database, bytes) {
  try {
    docker(["run", "--rm", "--interactive", "--network", "host", "--env", `PGPASSWORD=${password}`, "--entrypoint", "pg_restore", IMAGE,
      "--host", host, "--port", portText, "--username", user, "--dbname", database, "--exit-on-error", "--no-owner", "--no-privileges", "--single-transaction"], bytes);
    return true;
  } catch { return false; }
}

try {
  const existing = psql("postgres", `SELECT count(*) FROM pg_database WHERE datname IN (${sqlLiteral(target)}, ${sqlLiteral(staging)}, ${sqlLiteral(failed)});`);
  assert(existing === "0", "Generated cutback databases unexpectedly already exist.");
  psql("postgres", `CREATE DATABASE ${target} OWNER ${user};`);
  const migrationSql = "-- trusted previous migration fixture\n";
  const migrationChecksum = createHash("sha256").update(migrationSql).digest("hex");
  psql(target, `CREATE TABLE cutback_probe(id integer PRIMARY KEY, value text NOT NULL);
    INSERT INTO cutback_probe VALUES (1, 'pre-ddl');
    CREATE TABLE "Workout"(id integer PRIMARY KEY, value text NOT NULL);
    CREATE TABLE "Profile"(id integer PRIMARY KEY, value text NOT NULL);
    CREATE TABLE "ModelEpisode"(id integer PRIMARY KEY, value text NOT NULL);
    CREATE TABLE "PhysiologyV7Lifecycle"(id integer PRIMARY KEY, value text NOT NULL);
    CREATE TABLE "DailyModelState"(id integer PRIMARY KEY, value text NOT NULL);
    CREATE TABLE "StrengthDiarySession"(id integer PRIMARY KEY, value text NOT NULL);
    CREATE TABLE "ExerciseCatalog"(id integer PRIMARY KEY, value text NOT NULL);
    INSERT INTO "Workout" SELECT n, 'snapshot-' || n FROM generate_series(1, 4) n;
    INSERT INTO "Profile" SELECT n, 'snapshot-' || n FROM generate_series(1, 4) n;
    INSERT INTO "ModelEpisode" SELECT n, 'snapshot-' || n FROM generate_series(1, 4) n;
    INSERT INTO "PhysiologyV7Lifecycle" SELECT n, 'snapshot-' || n FROM generate_series(1, 4) n;
    INSERT INTO "DailyModelState" SELECT n, 'snapshot-' || n FROM generate_series(1, 4) n;
    INSERT INTO "StrengthDiarySession" SELECT n, 'snapshot-' || n FROM generate_series(1, 4) n;
    INSERT INTO "ExerciseCatalog" SELECT n, 'snapshot-' || n FROM generate_series(1, 4) n;
    CREATE TABLE _prisma_migrations(id text PRIMARY KEY, checksum text NOT NULL, migration_name text NOT NULL,
      started_at timestamptz NOT NULL, finished_at timestamptz, rolled_back_at timestamptz, logs text, applied_steps_count integer NOT NULL DEFAULT 1);
    INSERT INTO _prisma_migrations(id, checksum, migration_name, started_at, finished_at)
      VALUES ('cutback-baseline', '${migrationChecksum}', '20261001_baseline', now(), now());`);
  const baselineRows = queryRows(target);
  const baselineSchema = querySchema(target);
  const sourceReport = queryReport(target);
  sourceReport.logicalDataFingerprint = dataFingerprint();
  assert(/^[a-f0-9]{64}$/.test(sourceReport.logicalDataFingerprint), "The isolated live DB content fingerprint is malformed.");
  const preflightResultBase = { readyForOwnerAuthorization: true, blockers: [], pendingExactlyExpected: true, ...sourceReport };
  const restoreResult = { readability: queryReadability(target), logicalDataFingerprint: sourceReport.logicalDataFingerprint };
  const targetSha = "f".repeat(40);
  const previousSourceRepo = path.join(scratchRoot, "previous-source");
  const previousMigrationDir = path.join(previousSourceRepo, "prisma", "migrations", "20261001_baseline");
  mkdirSync(previousMigrationDir, { recursive: true });
  writeFileSync(path.join(previousMigrationDir, "migration.sql"), migrationSql);
  execFileSync("git", ["init", "--quiet", previousSourceRepo]);
  execFileSync("git", ["-C", previousSourceRepo, "add", "."]);
  execFileSync("git", ["-C", previousSourceRepo, "-c", "user.name=BodyCast CI", "-c", "user.email=ci@bodycast.invalid", "commit", "--quiet", "-m", "previous release"]);
  const previousSha = execFileSync("git", ["-C", previousSourceRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const legacyCapture = capturePreviousAppProvenance({ container: appContainer(), databaseReport: sourceReport, targetSha });
  const labeledCapture = capturePreviousAppProvenance({ container: appContainer(previousSha), databaseReport: sourceReport, targetSha });
  assert(legacyCapture.provenanceKind === "legacy-unlabeled-v1" && legacyCapture.previousSha === "unavailable",
    "Legacy provenance assigned or misclassified a source commit SHA.");
  assert(labeledCapture.provenanceKind === "release-sha-v1" && labeledCapture.previousSha === previousSha,
    "Labeled provenance did not preserve its exact source SHA.");
  const legacyRecreated = structuredClone(appContainer());
  legacyRecreated.Id = "f".repeat(64);
  legacyRecreated.Config.Labels = { "org.bodycast.release-sha": "unknown" };
  const labeledRecreated = structuredClone(appContainer(previousSha));
  labeledRecreated.Id = "9".repeat(64);
  assert(verifyRecreatedPreviousAppRuntime({ recordText: serializePreviousAppProvenance(legacyCapture), container: legacyRecreated }).verified
    && verifyRecreatedPreviousAppRuntime({ recordText: serializePreviousAppProvenance(labeledCapture), container: labeledRecreated }).verified,
  "Previous app recreation did not preserve exact image/runtime identity, health, and mode-specific label.");
  const alteredLegacyRuntime = structuredClone(legacyRecreated);
  alteredLegacyRuntime.Config.Env.push("NODE_ENV=changed");
  expectBlocked(() => verifyRecreatedPreviousAppRuntime({ recordText: serializePreviousAppProvenance(legacyCapture), container: alteredLegacyRuntime }),
    "Legacy app recreation passed with a changed runtime configuration.");
  assert(verifyPreviousAppCaptureMatchesPreflight(legacyCapture, preflightResultBase, targetSha).verified
    && verifyPreviousAppCaptureMatchesPreflight(labeledCapture, preflightResultBase, targetSha).verified,
  "Previous-app capture did not bind to the exact PostgreSQL baseline.");
  const dump = docker(["run", "--rm", "--network", "host", "--env", `PGPASSWORD=${password}`, IMAGE, "pg_dump",
    "--host", host, "--port", port, "--username", user, "--dbname", target, "--format=custom", "--no-owner", "--no-privileges"]);
  await encryptBackupStream(Readable.from([dump]), encryptedPath, key);
  const ciphertext = readFileSync(encryptedPath);
  const ciphertextDigest = createHash("sha256").update(ciphertext).digest("hex");
  assert(/^[a-f0-9]{64}$/.test(ciphertextDigest), "Encrypted backup digest is invalid.");

  psql(target, "UPDATE public.\"Workout\" SET value='mutated-after-backup' WHERE id=1;");
  const changedDataFingerprint = dataFingerprint();
  assert(changedDataFingerprint !== sourceReport.logicalDataFingerprint,
    "A post-backup row update with unchanged row count was not reflected in the full logical data fingerprint.");
  expectBlocked(() => assertLiveDataMatchesBackupFingerprint(
    { logicalDataFingerprint: sourceReport.logicalDataFingerprint },
    { logicalDataFingerprint: sourceReport.logicalDataFingerprint },
    { logicalDataFingerprint: sourceReport.logicalDataFingerprint },
    { logicalDataFingerprint: changedDataFingerprint },
  ), "A same-row-count post-backup data mutation passed the final migration gate.");
  psql(target, "UPDATE public.\"Workout\" SET value='snapshot-1' WHERE id=1;");
  assert(dataFingerprint() === sourceReport.logicalDataFingerprint, "Restoring the fixture row did not restore the exact source fingerprint.");

  psql(target, `ALTER TABLE cutback_probe ADD COLUMN migration_partial text;
    UPDATE cutback_probe SET value='partially-migrated', migration_partial='ddl-ran';
    INSERT INTO _prisma_migrations(id, checksum, migration_name, started_at, logs)
      VALUES ('cutback-partial', '${"f".repeat(64)}', '20261002_partial_migration', now(), 'DDL interrupted');`);
  assert(queryRows(target).includes("partially-migrated"), "The fixture did not enter its partial-DDL state.");

  const tampered = Buffer.from(ciphertext); tampered[Math.floor(tampered.length / 2)] ^= 1;
  let tamperRejected = false;
  try { await decryptBackupToWritable(encryptedPath, new Writable({ write(_chunk, _enc, cb) { cb(); } }), Buffer.alloc(32, 9)); }
  catch { tamperRejected = true; }
  assert(tamperRejected && queryRows(target).includes("partially-migrated"), "Wrong-key rejection changed the migration target.");
  writeFileSync(path.join(scratchRoot, "tampered.enc"), tampered);
  let corruptRejected = false;
  try { await decryptBackupToWritable(path.join(scratchRoot, "tampered.enc"), new Writable({ write(_chunk, _enc, cb) { cb(); } }), key); }
  catch { corruptRejected = true; }
  assert(corruptRejected && queryRows(target).includes("partially-migrated"), "Corrupt-ciphertext rejection changed the migration target.");

  // A failed rehearsal restore is isolated to staging; it cannot mutate the target.
  psql("postgres", `CREATE DATABASE ${staging} OWNER ${user};`);
  psql(staging, "CREATE TABLE cutback_probe(id integer PRIMARY KEY, value text NOT NULL);");
  assert(!attemptRestore(staging, dump), "A conflicting staging schema should reject the restore transaction.");
  assert(queryRows(target).includes("partially-migrated"), "A failed staging restore changed the migration target.");
  psql("postgres", `DROP DATABASE ${staging};`);
  psql("postgres", `CREATE DATABASE ${staging} OWNER ${user};`);
  await decryptBackupToWritable(encryptedPath, createWriteStream(plainPath, { mode: 0o600, flags: "wx" }), key);
  const archive = readFileSync(plainPath);
  assert(attemptRestore(staging, archive), "The authenticated pre-DDL archive failed to restore into isolated staging PostgreSQL.");
  assert(queryRows(staging) === baselineRows && querySchema(staging) === baselineSchema, "Staged restore schema/data differs from the pre-DDL snapshot.");
  assert(psql(staging, "SELECT count(*) FROM information_schema.columns WHERE table_name='cutback_probe' AND column_name='migration_partial';") === "0", "Staged restore retained partial-DDL schema.");
  assert(psql(staging, "SELECT count(*) FROM _prisma_migrations WHERE migration_name='20261001_baseline' AND checksum='" + migrationChecksum + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;") === "1"
    && psql(staging, "SELECT count(*) FROM _prisma_migrations;") === "1", "Staged Prisma migration history differs from the pre-DDL baseline.");

  const stagingReport = queryReport(staging);
  stagingReport.logicalDataFingerprint = dataFingerprint(staging);
  const stagingReadability = { migrationHistory: stagingReport.migrations, readability: queryReadability(staging) };
  assert(assertCutbackRestoredDatabaseIdentity({ sourceIdentity: sourceReport.identity, restoredReport: stagingReport,
    expectedDatabase: staging }).verified, "The real PostgreSQL restored baseline did not remain on the exact source cluster.");
  const legacyPreflightResult = { ...preflightResultBase, previousAppProvenance: previousAppProvenanceBinding(legacyCapture) };
  const labeledPreflightResult = { ...preflightResultBase, previousAppProvenance: previousAppProvenanceBinding(labeledCapture) };
  const compatibilityArgs = {
    targetSha, contextVerified: true, preflightResultDigest: canonicalSha256(legacyPreflightResult),
    preflightResult: legacyPreflightResult, restoredReport: stagingReport,
    restoreResult, readabilityReport: stagingReadability, repositoryPath: previousSourceRepo,
  };
  const legacyCompatibility = verifyPreviousAppMigrationCompatibility({ recordText: serializePreviousAppProvenance(legacyCapture), ...compatibilityArgs });
  const labeledCompatibility = verifyPreviousAppMigrationCompatibility({ recordText: serializePreviousAppProvenance(labeledCapture),
    ...compatibilityArgs, preflightResultDigest: canonicalSha256(labeledPreflightResult), preflightResult: labeledPreflightResult });
  assert(legacyCompatibility.provenanceKind === "legacy-unlabeled-v1" && labeledCompatibility.provenanceKind === "release-sha-v1",
    "Legacy and labeled previous-image paths did not both verify against the real restored PostgreSQL snapshot.");
  psql(staging, "ALTER TABLE cutback_probe ADD COLUMN incompatible_schema text;");
  const incompatibleReport = queryReport(staging);
  expectBlocked(() => verifyPreviousAppMigrationCompatibility({
    recordText: serializePreviousAppProvenance(legacyCapture), ...compatibilityArgs, restoredReport: incompatibleReport,
  }), "Legacy rollback passed despite a schema mismatch in the restored database.");
  expectBlocked(() => verifyPreviousAppMigrationCompatibility({
    recordText: serializePreviousAppProvenance(labeledCapture), ...compatibilityArgs, preflightResultDigest: canonicalSha256(labeledPreflightResult),
    preflightResult: labeledPreflightResult, restoredReport: incompatibleReport,
  }), "Labeled rollback passed despite a schema mismatch in the restored database.");
  assert(queryRows(target).includes("partially-migrated"), "Failed compatibility checks changed the migrated target.");
  psql(staging, "ALTER TABLE cutback_probe DROP COLUMN incompatible_schema;");

  // Exercise the production rename/EXIT-trap shell orchestration against real
  // PostgreSQL. A failed second rename must either restore the original live
  // name, or preserve both physical databases for operator intervention.
  const markerPath = path.join(scratchRoot, "release-marker");
  const routePath = path.join(scratchRoot, "maintenance-route.caddy");
  const lifecycleCalls = path.join(scratchRoot, "lifecycle-docker-calls");
  const markerBytes = "schemaVersion=2\nstate=ddl-started\n";
  const routeBytes = "bodycast.test { respond 503 }\n";
  writeFileSync(markerPath, markerBytes, { mode: 0o600 });
  writeFileSync(routePath, routeBytes, { mode: 0o600 });
  const liveBeforeFailure = queryRows(target);
  const stageBeforeFailure = queryRows(staging);
  for (const [liveName, stageName, failedName] of [
    [promotionLive, promotionStage, promotionFailed],
    [promotionLivePreserved, promotionStagePreserved, promotionFailedPreserved],
  ]) {
    psql("postgres", `CREATE DATABASE ${liveName} WITH TEMPLATE ${target} OWNER ${user};`);
    psql("postgres", `CREATE DATABASE ${stageName} WITH TEMPLATE ${staging} OWNER ${user};`);
    assert(queryRows(liveName) === liveBeforeFailure && queryRows(stageName) === stageBeforeFailure,
      "The real PostgreSQL rename fixture differs from the current live/staged data before failure injection.");
    const failRestore = stageName === promotionStagePreserved;
    const injected = runRenameFailureInjection({ live: liveName, stage: stageName, retained: failedName, failRestore,
      markerPath, lifecycleCalls });
    assert(injected.status === (failRestore ? 42 : 41),
      `Production cutback rename failure returned an unexpected status (${injected.status}).`);
    assert(readFileSync(markerPath, "utf8") === markerBytes && readFileSync(routePath, "utf8") === routeBytes,
      "Cutback failure cleanup changed the durable marker or maintenance route.");
    assert(!existsSync(lifecycleCalls), "The failure path attempted an app/Compose restart or lifecycle mutation.");
    if (!failRestore) {
      assert(queryRows(liveName) === liveBeforeFailure, "Failure of the second rename did not restore the original live database contents.");
      assert(psql("postgres", `SELECT count(*) FROM pg_database WHERE datname=${sqlLiteral(stageName)};`) === "0",
        "Cleanup did not remove the unpromoted disposable stage after the original live DB was restored.");
      assert(psql("postgres", `SELECT count(*) FROM pg_database WHERE datname=${sqlLiteral(failedName)};`) === "0",
        "A failed second rename left the live DB stranded under its failed name after successful restoration.");
    } else {
      assert(queryRows(failedName) === liveBeforeFailure && queryRows(stageName) === stageBeforeFailure,
        "When the second rename and restoration both failed, the current live and verified staging databases were not both preserved.");
      assert(psql("postgres", `SELECT count(*) FROM pg_database WHERE datname=${sqlLiteral(liveName)};`) === "0",
        "The fail-closed double-rename failure unexpectedly published a live database name.");
    }
  }

  // Destructive name swap is reached only after authenticated restore and exact checks above.
  psql("postgres", `ALTER DATABASE ${target} RENAME TO ${failed};`);
  psql("postgres", `ALTER DATABASE ${staging} RENAME TO ${target};`);
  assert(queryRows(target) === baselineRows && querySchema(target) === baselineSchema, "Cutback swap did not install the verified baseline database.");
  assert(queryRows(failed).includes("partially-migrated"), "Cutback did not retain the failed migrated database for review.");
  console.log("Isolated PostgreSQL cutback PASS: authenticated restore, previous-app compatibility, failure of the second DB rename, failed restoration, EXIT cleanup, maintenance/marker preservation, no app restart, and DB retention were verified against real PostgreSQL.");
} finally {
  const databases = [target, staging, failed, promotionLive, promotionStage, promotionFailed,
    promotionLivePreserved, promotionStagePreserved, promotionFailedPreserved];
  try { psql("postgres", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN (${databases.map(sqlLiteral).join(",")}) AND pid <> pg_backend_pid();`); } catch {}
  for (const name of databases) { try { psql("postgres", `DROP DATABASE IF EXISTS ${name};`); } catch {} }
  key.fill(0);
  rmSync(scratchRoot, { recursive: true, force: true });
}
