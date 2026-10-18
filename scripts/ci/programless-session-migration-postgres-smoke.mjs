import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST } from "../production-migration-manifests.mjs";

const baseUrlText = process.env.BODYCAST_DYNAMIC_MIGRATION_TEST_DATABASE_URL;
if (!baseUrlText) throw new Error("BODYCAST_DYNAMIC_MIGRATION_TEST_DATABASE_URL must target isolated local PostgreSQL.");
const baseUrl = new URL(baseUrlText);
if (!["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname.toLowerCase())
  || !["postgres:", "postgresql:"].includes(baseUrl.protocol)) {
  throw new Error("Programless migration smoke refuses non-local PostgreSQL targets.");
}

const psqlContainer = process.env.BODYCAST_DYNAMIC_MIGRATION_PSQL_CONTAINER;
const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const databaseName = `bodycast_programless_${randomBytes(6).toString("hex")}`;
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

function runPsql(url, sql, { allowFailure = false } = {}) {
  let command;
  let args;
  if (psqlContainer) {
    command = "docker";
    args = ["exec", "--interactive", psqlContainer, "psql", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align",
      "--set=ON_ERROR_STOP=1", "--username", decodeURIComponent(url.username), "--dbname", decodeURIComponent(url.pathname.slice(1)),
      "--command", sql];
  } else {
    command = "psql";
    args = [url.toString(), "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--command", sql];
  }
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`Isolated migration PostgreSQL command failed: ${String(result.stderr ?? result.error?.message ?? result.status).trim()}`);
  }
  return { status: result.status, stdout: String(result.stdout ?? "").trim(), stderr: String(result.stderr ?? "").trim() };
}

function committedMigrationBytes(name, expectedSha256) {
  const bytes = execFileSync("git", ["cat-file", "blob", `${releaseSha}:prisma/migrations/${name}/migration.sql`], { encoding: "buffer" });
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) throw new Error(`Committed migration checksum differs from manifest for ${name}.`);
  return bytes;
}

const expectedSignatures = Object.fromEntries(Object.entries(DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.postflightSignatureEquals)
  .filter(([name]) => name.startsWith("StrengthDiarySession.program")
    || name.startsWith("StrengthDiarySession_program") && name.endsWith("_fkey")
    || name === "StrengthDiarySession_program_pair_check" || name.startsWith("HealthSyncRefreshJob")));
if (Object.keys(expectedSignatures).length !== 25) throw new Error("Reviewed migration signature contract is incomplete.");

function signatureQuery() {
  const signatureSql = [];
  for (const [name, tableName, columnName] of [
    ["StrengthDiarySession.programId", "StrengthDiarySession", "programId"],
    ["StrengthDiarySession.programVersionId", "StrengthDiarySession", "programVersionId"],
  ]) {
    signatureSql.push(`SELECT '${name}'::text AS name, (
      SELECT format_type(a.atttypid, a.atttypmod) || '|nullable=' || (NOT a.attnotnull)::text || '|default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public."${tableName}"') AND a.attname = '${columnName}' AND a.attnum > 0 AND NOT a.attisdropped
    ) AS signature`);
  }
  for (const name of [
    "StrengthDiarySession_programId_fkey",
    "StrengthDiarySession_programVersionId_fkey",
  ]) {
    signatureSql.push(`SELECT '${name}', (
      SELECT c.contype::text || '|validated=' || c.convalidated::text || '|table=' || c.conrelid::regclass::text || '|definition=' || pg_get_constraintdef(c.oid, true)
      FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.conname = '${name}'
    )`);
  }
  signatureSql.push(`SELECT 'StrengthDiarySession_program_pair_check', (
    SELECT c.contype::text || '|validated=' || c.convalidated::text || '|table=' || c.conrelid::regclass::text || '|definition=' || pg_get_constraintdef(c.oid, true)
    FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.conname = 'StrengthDiarySession_program_pair_check'
  )`);
  signatureSql.push(`SELECT 'HealthSyncRefreshJob', (
    SELECT 'relkind=' || cl.relkind::text FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = 'HealthSyncRefreshJob'
  )`);
  for (const [name, tableName, columnName] of [
    ["HealthSyncRefreshJob.profileId", "HealthSyncRefreshJob", "profileId"],
    ["HealthSyncRefreshJob.requestedGeneration", "HealthSyncRefreshJob", "requestedGeneration"],
    ["HealthSyncRefreshJob.completedGeneration", "HealthSyncRefreshJob", "completedGeneration"],
    ["HealthSyncRefreshJob.fromDate", "HealthSyncRefreshJob", "fromDate"],
    ["HealthSyncRefreshJob.toDate", "HealthSyncRefreshJob", "toDate"],
    ["HealthSyncRefreshJob.sourceDates", "HealthSyncRefreshJob", "sourceDates"],
    ["HealthSyncRefreshJob.weightSourceChangedDates", "HealthSyncRefreshJob", "weightSourceChangedDates"],
    ["HealthSyncRefreshJob.leaseToken", "HealthSyncRefreshJob", "leaseToken"],
    ["HealthSyncRefreshJob.leaseUntil", "HealthSyncRefreshJob", "leaseUntil"],
    ["HealthSyncRefreshJob.nextAttemptAt", "HealthSyncRefreshJob", "nextAttemptAt"],
    ["HealthSyncRefreshJob.attemptCount", "HealthSyncRefreshJob", "attemptCount"],
    ["HealthSyncRefreshJob.lastAttemptAt", "HealthSyncRefreshJob", "lastAttemptAt"],
    ["HealthSyncRefreshJob.lastErrorType", "HealthSyncRefreshJob", "lastErrorType"],
    ["HealthSyncRefreshJob.lastErrorAt", "HealthSyncRefreshJob", "lastErrorAt"],
    ["HealthSyncRefreshJob.createdAt", "HealthSyncRefreshJob", "createdAt"],
    ["HealthSyncRefreshJob.updatedAt", "HealthSyncRefreshJob", "updatedAt"],
  ]) {
    signatureSql.push(`SELECT '${name}'::text, (
      SELECT format_type(a.atttypid, a.atttypmod) || '|nullable=' || (NOT a.attnotnull)::text || '|default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public."${tableName}"') AND a.attname = '${columnName}' AND a.attnum > 0 AND NOT a.attisdropped
    )`);
  }
  signatureSql.push(`SELECT 'HealthSyncRefreshJob_pkey', (
    SELECT c.contype::text || '|validated=' || c.convalidated::text || '|table=' || c.conrelid::regclass::text || '|definition=' || pg_get_constraintdef(c.oid, true)
    FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.conname = 'HealthSyncRefreshJob_pkey'
  )`);
  signatureSql.push(`SELECT 'HealthSyncRefreshJob_profileId_fkey', (
    SELECT c.contype::text || '|validated=' || c.convalidated::text || '|table=' || c.conrelid::regclass::text || '|definition=' || pg_get_constraintdef(c.oid, true)
    FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.conname = 'HealthSyncRefreshJob_profileId_fkey'
  )`);
  signatureSql.push(`SELECT 'HealthSyncRefreshJob_nextAttemptAt_leaseUntil_idx', (
    SELECT 'unique=' || i.indisunique::text || '|valid=' || i.indisvalid::text || '|definition=' || pg_get_indexdef(cl.oid)
    FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace JOIN pg_index i ON i.indexrelid = cl.oid
    WHERE n.nspname = 'public' AND cl.relname = 'HealthSyncRefreshJob_nextAttemptAt_leaseUntil_idx'
  )`);
  return `SELECT COALESCE(jsonb_object_agg(name, signature), '{}'::jsonb)::text FROM (${signatureSql.join(" UNION ALL ")}) AS signatures`;
}

let fixtureUrl;
try {
  runPsql(baseUrl, `CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  fixtureUrl = new URL(baseUrl.toString());
  fixtureUrl.pathname = `/${databaseName}`;
  runPsql(fixtureUrl, `
    CREATE TABLE public."Profile" (id integer PRIMARY KEY);
    CREATE TABLE public."TrainingProgram" (id integer PRIMARY KEY);
    CREATE TABLE public."TrainingProgramVersion" (id integer PRIMARY KEY);
    CREATE TABLE public."StrengthDiarySession" (
      id integer PRIMARY KEY,
      "programId" integer NOT NULL CONSTRAINT "StrengthDiarySession_programId_fkey" REFERENCES public."TrainingProgram"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      "programVersionId" integer NOT NULL CONSTRAINT "StrengthDiarySession_programVersionId_fkey" REFERENCES public."TrainingProgramVersion"(id) ON UPDATE CASCADE ON DELETE RESTRICT
    );
    INSERT INTO public."Profile" (id) VALUES (1);
    INSERT INTO public."TrainingProgram" (id) VALUES (41);
    INSERT INTO public."TrainingProgramVersion" (id) VALUES (73);
    INSERT INTO public."StrengthDiarySession" (id, "programId", "programVersionId") VALUES (9001, 41, 73);
  `);

  for (const migration of DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.migrations) {
    runPsql(fixtureUrl, committedMigrationBytes(migration.name, migration.sha256).toString("utf8"));
  }

  runPsql(fixtureUrl, `INSERT INTO public."StrengthDiarySession" (id, "programId", "programVersionId") VALUES (9002, NULL, NULL)`);
  const rejectedHalfPair = runPsql(fixtureUrl,
    `INSERT INTO public."StrengthDiarySession" (id, "programId", "programVersionId") VALUES (9003, NULL, 73)`, { allowFailure: true });
  if (rejectedHalfPair.status === 0 || !/StrengthDiarySession_program_pair_check/.test(rejectedHalfPair.stderr)) {
    throw new Error("The program relation pair constraint did not reject a half-null session.");
  }

  const persisted = runPsql(fixtureUrl, `SELECT jsonb_build_object(
    'programmed', (SELECT jsonb_build_object('programId', "programId", 'programVersionId', "programVersionId") FROM public."StrengthDiarySession" WHERE id = 9001),
    'programless', (SELECT jsonb_build_object('programId', "programId", 'programVersionId', "programVersionId") FROM public."StrengthDiarySession" WHERE id = 9002),
    'programlessCount', (SELECT count(*) FROM public."StrengthDiarySession" WHERE "programId" IS NULL OR "programVersionId" IS NULL)
  )::text`);
  const persistedContract = JSON.parse(persisted.stdout);
  if (persistedContract.programmed.programId !== 41 || persistedContract.programmed.programVersionId !== 73
    || persistedContract.programless.programId !== null || persistedContract.programless.programVersionId !== null
    || persistedContract.programlessCount !== 1) {
    throw new Error("Programmed session history changed or the programless session did not persist exactly.");
  }

  const actualSignatures = JSON.parse(runPsql(fixtureUrl, signatureQuery()).stdout);
  for (const [name, expected] of Object.entries(expectedSignatures)) {
    if (actualSignatures[name] !== expected) {
      throw new Error(`PostgreSQL 17 signature mismatch for ${name}: ${String(actualSignatures[name])}`);
    }
  }
  if (Object.keys(actualSignatures).length !== Object.keys(expectedSignatures).length) {
    throw new Error("PostgreSQL signature inventory contains missing or extra migration objects.");
  }

  process.stdout.write(JSON.stringify({
    postgresVersionNum: runPsql(fixtureUrl, "SHOW server_version_num").stdout,
    migrationChecksumsVerified: DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.migrations.length,
    postgresSignaturesVerified: Object.keys(actualSignatures).length,
    programmedSessionPreserved: true,
    programlessSessionPersisted: true,
    halfNullPairRejected: true,
  }) + "\n");
} finally {
  runPsql(baseUrl, `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`);
}
