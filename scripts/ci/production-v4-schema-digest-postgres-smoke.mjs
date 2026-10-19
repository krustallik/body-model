#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function digestPipeline(databaseName) {
  const command = `${pgDumpCommand(databaseName)} | node ${shellQuote(helperPath)}`;
  const result = spawnSync("bash", ["-Eeuo", "pipefail", "-c", command], { encoding: "utf8", env: process.env });
  assert.equal(result.status, 0, `schema digest pipeline failed: ${result.stderr}`);
  assert.match(result.stdout, /^[a-f0-9]{64}\n$/);
  return result.stdout.trim();
}

function pgDumpRaw(databaseName) {
  return execFileSync("docker", ["run", "--rm", "--network", "host", "--env", "PGPASSWORD", "--entrypoint", "pg_dump",
    postgresImage, "--schema-only", "--no-owner", "--no-privileges", "--host=127.0.0.1", `--port=${recoveryUrl.port}`, "--username=bodycast", `--dbname=${databaseName}`], {
    encoding: "buffer",
    env: process.env,
  });
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
let driftCreated = false;
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

  process.stdout.write(`PASS PostgreSQL 17.11 schema digest pipeline; repeated=${firstDigest}; canonical65=${canonicalDigest}; SQL-drift=${driftDigest}\n`);
} finally {
  if (driftCreated) psql(recoveryUrl, `DROP DATABASE IF EXISTS ${driftDatabase} WITH (FORCE)`);
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
