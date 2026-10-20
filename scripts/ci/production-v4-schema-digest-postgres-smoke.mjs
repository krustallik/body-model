#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createReadStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encryptBackupStream } from "../production-backup-envelope.mjs";
import { digestEncryptedPostgresBackupSchema, restoreEncryptedPostgresBackup, runSchemaDigestFromEnvironment } from "../restore-encrypted-postgres-backup.mjs";
import { schemaDumpSha256, SCHEMA_DIGEST_CONTRACT } from "../production-v4-schema-digest.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const helperPath = path.join(repositoryRoot, "scripts/production-v4-schema-digest.mjs");
const postgresImage = process.env.BODYCAST_V4_SCHEMA_DIGEST_PG_IMAGE;
const recoveryUrl = parseTestUrl(process.env.BODYCAST_V4_SCHEMA_DIGEST_TEST_DATABASE_URL, "bodycast_v4_recovery_test");
const canonicalUrl = parseTestUrl(process.env.BODYCAST_V4_SCHEMA_DIGEST_CANONICAL_DATABASE_URL, "bodycast_v4_canonical65");

function parseTestUrl(value, expectedDatabase) {
  assert.equal(typeof value, "string", "schema digest smoke requires an explicit isolated test URL");
  const url = new URL(value);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1", "only the local PostgreSQL service is allowed");
  assert.match(url.port || "5432", /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(url.port || "5432") <= 65535);
  assert.equal(decodeURIComponent(url.username), "bodycast");
  assert.equal(decodeURIComponent(url.password), "bodycast_ci_only", "production credentials are rejected");
  assert.equal(url.pathname, `/${expectedDatabase}`, "only the named disposable CI databases are allowed");
  assert.equal(url.search, "");
  return { database: expectedDatabase, url: value, port: url.port || "5432" };
}

assert.equal(postgresImage,
  "docker.io/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24",
  "schema digest smoke must use the pinned PostgreSQL 17.11 image");
assert.equal(process.env.PGPASSWORD, "bodycast_ci_only", "test-only password must be explicit");
assert.equal(recoveryUrl.port, canonicalUrl.port, "both isolated schema databases must use the same local PostgreSQL service");

const imageVersion = execFileSync("docker", ["run", "--rm", postgresImage, "pg_dump", "--version"], { encoding: "utf8" }).trim();
assert.equal(imageVersion, "pg_dump (PostgreSQL) 17.11");

function psql(database, sql) {
  return execFileSync("docker", ["run", "--rm", "--network", "host", "--env", "PGPASSWORD", "--entrypoint", "psql", postgresImage,
    database.url, "--no-psqlrc", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", `--command=${sql}`], {
    encoding: "utf8",
    env: process.env,
  }).trim();
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function pgDumpCommand(databaseName) {
  return ["docker run --rm --network host --env PGPASSWORD --entrypoint pg_dump", shellQuote(postgresImage),
    "--schema-only --no-owner --no-privileges --host=127.0.0.1",
    `--port=${shellQuote(recoveryUrl.port)}`, `--username=${shellQuote("bodycast")}`, `--dbname=${shellQuote(databaseName)}`].join(" ");
}

function normalizeWindowsDockerBytes(bytes) {
  if (process.platform !== "win32") return bytes;
  // Windows Docker CLI capture adds CR before LF in its binary stdout stream.
  // Normalize only this local transport artifact; production workflow runs on
  // Linux and hashes the original pg_dump bytes without this adapter.
  const text = bytes.toString("utf8");
  assert.equal(text.replaceAll("\r\n", "").includes("\r"), false, "Windows Docker stdout contains a bare CR");
  return Buffer.from(text.replaceAll("\r\n", "\n"), "utf8");
}

function schemaDigestForCapturedDockerBytes(bytes) {
  return schemaDumpSha256(normalizeWindowsDockerBytes(bytes));
}

function digestPipeline(databaseName) {
  // Git Bash pipes Windows Docker CLI stdout through text-mode handling. Keep
  // the Linux CI path as the literal shell pipeline; on Windows hash the raw
  // pg_dump Buffer so platform newline translation cannot alter schema bytes.
  if (process.platform === "win32") {
    const dump = execFileSync("docker", ["run", "--rm", "--network", "host", "--env", "PGPASSWORD", "--entrypoint", "pg_dump",
      postgresImage, "--schema-only", "--no-owner", "--no-privileges", "--host=127.0.0.1", `--port=${recoveryUrl.port}`,
      "--username=bodycast", `--dbname=${databaseName}`], { encoding: "buffer", env: process.env });
    return schemaDigestForCapturedDockerBytes(dump);
  }
  const command = `${pgDumpCommand(databaseName)} | node ${shellQuote(helperPath)}`;
  const result = spawnSync("bash", ["-Eeuo", "pipefail", "-c", command], { encoding: "utf8", env: process.env });
  assert.equal(result.status, 0, `schema digest pipeline failed: ${result.stderr}`);
  assert.match(result.stdout, /^[a-f0-9]{64}\n$/);
  return result.stdout.trim();
}

function pgDumpRaw(databaseName) {
  const dump = execFileSync("docker", ["run", "--rm", "--network", "host", "--env", "PGPASSWORD", "--entrypoint", "pg_dump",
    postgresImage, "--schema-only", "--no-owner", "--no-privileges", "--host=127.0.0.1", `--port=${recoveryUrl.port}`, "--username=bodycast", `--dbname=${databaseName}`], {
    encoding: "buffer",
    env: process.env,
  });
  return normalizeWindowsDockerBytes(dump);
}

function markerPair(dump) {
  const lines = dump.toString("utf8").split("\n");
  const restrict = lines.filter((line) => line.startsWith("\\restrict"));
  const unrestrict = lines.filter((line) => line.startsWith("\\unrestrict"));
  assert.equal(restrict.length, 1, "pg_dump must emit one restrict marker");
  assert.equal(unrestrict.length, 1, "pg_dump must emit one unrestrict marker");
  const restrictMatch = /^\\restrict ([A-Za-z0-9]{63})$/.exec(restrict[0]);
  const unrestrictMatch = /^\\unrestrict ([A-Za-z0-9]{63})$/.exec(unrestrict[0]);
  assert.ok(restrictMatch && unrestrictMatch, "pg_dump marker format differs from the reviewed contract");
  assert.equal(restrictMatch[1], unrestrictMatch[1], "restrict/unrestrict tokens must pair");
  return restrictMatch[1];
}

function fixturePipeline(tempDirectory, name, bytes) {
  const fixturePath = path.join(tempDirectory, `${name}.sql`);
  writeFileSync(fixturePath, bytes, { flag: "wx", mode: 0o600 });
  const command = `cat ${shellQuote(fixturePath)} | node ${shellQuote(helperPath)}`;
  return spawnSync("bash", ["-Eeuo", "pipefail", "-c", command], { encoding: "utf8", env: process.env });
}

const appliedCount = "SELECT count(*) FROM public.\"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL";
assert.equal(psql(recoveryUrl, "SHOW server_version"), "17.11");
assert.equal(psql(canonicalUrl, "SHOW server_version"), "17.11");
assert.equal(psql(recoveryUrl, appliedCount), "65", "production-equivalent recovery schema must have exactly 65 applied migrations");
assert.equal(psql(canonicalUrl, appliedCount), "65", "independently migrated canonical schema must have exactly 65 applied migrations");

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "bodycast-v4-schema-digest-"));
const driftDatabase = "bodycast_v4_schema_drift_test";
const archiveRestoreDatabase = `bodycast_v4_arc_${randomBytes(4).toString("hex")}`;
let driftCreated = false;
let archiveRestoreCreated = false;
try {
  const firstDump = pgDumpRaw(recoveryUrl.database);
  const secondDump = pgDumpRaw(recoveryUrl.database);
  const firstToken = markerPair(firstDump);
  const secondToken = markerPair(secondDump);
  assert.notEqual(firstToken, secondToken, "repeated PostgreSQL 17.11 dumps should carry distinct random marker tokens");
  assert.notDeepEqual(firstDump, secondDump, "raw pg_dump streams should differ when marker tokens differ");

  const firstDigest = digestPipeline(recoveryUrl.database);
  const secondDigest = digestPipeline(recoveryUrl.database);
  assert.equal(firstDigest, secondDigest, "repeated pg_dump shell pipelines must produce the same normalized digest");
  const canonicalDigest = digestPipeline(canonicalUrl.database);
  assert.equal(firstDigest, canonicalDigest, "restored/production-equivalent and canonical 65-migration schemas must match");

  // Reproduce the recovery workflow's full custom backup -> isolated restore
  // path. PostgreSQL 17.11 may deparse CHECK casts differently after
  // pg_restore; the archive's own schema DDL remains a stable comparison.
  const archivePath = path.join(temporaryDirectory, "canonical65-full.pgdump");
  const encryptedArchivePath = path.join(temporaryDirectory, "canonical65-full.pgdump.enc");
  const archiveResult = spawnSync("docker", ["run", "--rm", "--network", "host", "--env", "PGPASSWORD", "--entrypoint", "pg_dump",
    postgresImage, "--format=custom", "--no-owner", "--no-privileges", "--host=127.0.0.1",
    `--port=${canonicalUrl.port}`, "--username=bodycast", `--dbname=${canonicalUrl.database}`], {
    encoding: "buffer", env: process.env, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(archiveResult.status, 0, `pinned pg_dump custom archive failed: ${archiveResult.stderr.toString("utf8")}`);
  writeFileSync(archivePath, archiveResult.stdout, { flag: "wx", mode: 0o600 });
  const backupKey = randomBytes(32);
  await encryptBackupStream(createReadStream(archivePath), encryptedArchivePath, backupKey);
  const helperBytes = readFileSync(helperPath);
  const backupSchemaDigest = await runSchemaDigestFromEnvironment({ env: {
    BACKUP_FILE: encryptedArchivePath,
    PRODUCTION_BACKUP_ENCRYPTION_KEY: backupKey.toString("base64"),
    POSTGRES_IMAGE: postgresImage,
    SCHEMA_DIGEST_CONTRACT,
    SCHEMA_DIGEST_HELPER_SHA256: createHash("sha256").update(helperBytes).digest("hex"),
  }, digestBackupSchema: (options) => digestEncryptedPostgresBackupSchema({
    ...options,
    digest: schemaDigestForCapturedDockerBytes,
  }) });
  assert.equal(backupSchemaDigest, canonicalDigest, "offline archive schema digest must match canonical 65 migrations");

  psql(recoveryUrl, `CREATE DATABASE ${archiveRestoreDatabase}`);
  archiveRestoreCreated = true;
  const archiveRestoreUrl = `postgresql://bodycast:bodycast_ci_only@127.0.0.1:${recoveryUrl.port}/${archiveRestoreDatabase}`;
  await restoreEncryptedPostgresBackup({
    inputPath: encryptedArchivePath,
    key: backupKey,
    args: ["run", "--rm", "--interactive", "--network", "host", "--env", "PGPASSWORD=bodycast_ci_only",
      "--entrypoint", "pg_restore", postgresImage, "--exit-on-error", "--no-owner", "--no-privileges",
      "--single-transaction", `--dbname=${archiveRestoreUrl}`],
    env: { ...process.env, PGPASSWORD: "bodycast_ci_only" },
    redactValues: ["bodycast_ci_only", archiveRestoreUrl],
    log: () => {},
  });
  const restoredAfterDigest = digestPipeline(archiveRestoreDatabase);
  assert.notEqual(restoredAfterDigest, canonicalDigest,
    "pinned PostgreSQL 17.11 must reproduce equivalent CHECK-constraint cast deparser changes after restore");

  const replacementToken = firstToken === "A".repeat(63) ? "B".repeat(63) : "A".repeat(63);
  const changedTokenDump = Buffer.from(firstDump.toString("utf8").replaceAll(firstToken, replacementToken));
  const changedTokenResult = fixturePipeline(temporaryDirectory, "different-token", changedTokenDump);
  assert.equal(changedTokenResult.status, 0, changedTokenResult.stderr);
  assert.equal(changedTokenResult.stdout.trim(), firstDigest, "a different valid marker token must not affect the digest");

  psql(recoveryUrl, `CREATE DATABASE ${driftDatabase} TEMPLATE ${canonicalUrl.database}`);
  driftCreated = true;
  psql({ ...canonicalUrl, database: driftDatabase, url: canonicalUrl.url.replace(`/${canonicalUrl.database}`, `/${driftDatabase}`) },
    "CREATE TABLE public.__bodycast_schema_digest_drift_test (id integer PRIMARY KEY)");
  const driftDigest = digestPipeline(driftDatabase);
  assert.notEqual(driftDigest, canonicalDigest, "a SQL schema change must change the digest");

  const malformedFixtures = [
    ["truncated-marker", firstDump.toString("utf8").replace(`\\restrict ${firstToken}`, `\\restrict ${firstToken.slice(1)}`)],
    ["mismatched-pair", firstDump.toString("utf8").replace(`\\unrestrict ${firstToken}`, `\\unrestrict ${"B".repeat(63)}`)],
    ["unknown-marker", firstDump.toString("utf8").replace(`\\restrict ${firstToken}`, `\\connect ${firstToken}`)],
    ["malformed-version-banner", firstDump.toString("utf8").replace("-- Dumped by pg_dump version 17.11", "-- Dumped by pg_dump version unknown")],
  ];
  for (const [name, fixture] of malformedFixtures) {
    const result = fixturePipeline(temporaryDirectory, name, Buffer.from(fixture));
    assert.notEqual(result.status, 0, `${name} must fail closed`);
    assert.equal(result.stdout, "", `${name} must not yield an accepted digest`);
  }

  const failedDumpCommand = `${pgDumpCommand("bodycast_v4_schema_digest_missing_test")} | node ${shellQuote(helperPath)}`;
  const failedDump = spawnSync("bash", ["-Eeuo", "pipefail", "-c", failedDumpCommand], { encoding: "utf8", env: process.env });
  assert.notEqual(failedDump.status, 0, "pg_dump failure must fail the full shell pipeline");
  assert.equal(failedDump.stdout, "", "pg_dump failure must not yield an accepted digest");

  process.stdout.write(`PASS PostgreSQL 17.11 schema digest pipeline; repeated=${firstDigest}; canonical65=${canonicalDigest}; backup-archive=${backupSchemaDigest}; restored-text=${restoredAfterDigest}; SQL-drift=${driftDigest}\n`);
} finally {
  if (archiveRestoreCreated) psql(recoveryUrl, `DROP DATABASE IF EXISTS ${archiveRestoreDatabase} WITH (FORCE)`);
  if (driftCreated) psql(recoveryUrl, `DROP DATABASE IF EXISTS ${driftDatabase} WITH (FORCE)`);
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
