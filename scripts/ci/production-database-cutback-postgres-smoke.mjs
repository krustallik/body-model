import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { encryptBackupStream, decryptBackupToWritable } from "../production-backup-envelope.mjs";

const IMAGE = "postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";
const databaseUrl = process.env.BODYCAST_CUTBACK_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("BODYCAST_CUTBACK_TEST_DATABASE_URL is required for isolated PostgreSQL cutback integration.");
const url = new URL(databaseUrl);
const target = decodeURIComponent(url.pathname.slice(1));
if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(url.hostname)
  || (url.port && url.port !== "5432") || decodeURIComponent(url.username) !== "bodycast"
  || target !== "bodycast_cutback_test" || url.search || url.hash || !url.password) {
  throw new Error("Cutback integration accepts only a loopback PostgreSQL URL with a database name ending in _test and no overrides.");
}
const scratchRoot = mkdtempSync(path.join(os.tmpdir(), "bodycast-cutback-pg-"));
const suffix = randomBytes(5).toString("hex");
const staging = `bodycast_cutback_stage_${suffix}_test`;
const failed = `bodycast_cutback_failed_${suffix}_test`;
const password = decodeURIComponent(url.password);
const user = decodeURIComponent(url.username);
const host = url.hostname;
const port = url.port || "5432";
const key = randomBytes(32);
const encryptedPath = path.join(scratchRoot, "snapshot.pgdump.enc");
const plainPath = path.join(scratchRoot, "snapshot.pgdump");

function docker(args, input) {
  return execFileSync("docker", args, { input, maxBuffer: 128 * 1024 * 1024, encoding: "buffer", stdio: ["pipe", "pipe", "pipe"] });
}
function psql(database, sql) {
  return docker(["run", "--rm", "--network", "host", "--env", `PGPASSWORD=${password}`, IMAGE, "psql",
    "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1",
    "--host", host, "--port", port, "--username", user, "--dbname", database, "--command", sql]).toString("utf8").trim();
}
function sqlLiteral(value) { return `'${value.replaceAll("'", "''")}'`; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function queryRows(database) { return psql(database, "SELECT id::text || ':' || value FROM cutback_probe ORDER BY id;"); }
function querySchema(database) { return psql(database, "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='cutback_probe';"); }
function attemptRestore(database, bytes) {
  try {
    docker(["run", "--rm", "--interactive", "--network", "host", "--env", `PGPASSWORD=${password}`, "--entrypoint", "pg_restore", IMAGE,
      "--host", host, "--port", port, "--username", user, "--dbname", database, "--exit-on-error", "--no-owner", "--no-privileges", "--single-transaction"], bytes);
    return true;
  } catch { return false; }
}

try {
  const existing = psql("postgres", `SELECT count(*) FROM pg_database WHERE datname IN (${sqlLiteral(target)}, ${sqlLiteral(staging)}, ${sqlLiteral(failed)});`);
  assert(existing === "0", "Generated cutback databases unexpectedly already exist.");
  psql("postgres", `CREATE DATABASE ${target} OWNER ${user};`);
  psql(target, `CREATE TABLE cutback_probe(id integer PRIMARY KEY, value text NOT NULL);
    INSERT INTO cutback_probe VALUES (1, 'pre-ddl');
    CREATE TABLE _prisma_migrations(id text PRIMARY KEY, checksum text NOT NULL, migration_name text NOT NULL,
      started_at timestamptz NOT NULL, finished_at timestamptz, rolled_back_at timestamptz, logs text, applied_steps_count integer NOT NULL DEFAULT 1);
    INSERT INTO _prisma_migrations(id, checksum, migration_name, started_at, finished_at)
      VALUES ('cutback-baseline', '${"a".repeat(64)}', '20261001_baseline', now(), now());`);
  const baselineRows = queryRows(target);
  const baselineSchema = querySchema(target);
  const dump = docker(["run", "--rm", "--network", "host", "--env", `PGPASSWORD=${password}`, IMAGE, "pg_dump",
    "--host", host, "--port", port, "--username", user, "--dbname", target, "--format=custom", "--no-owner", "--no-privileges"]);
  await encryptBackupStream(Readable.from([dump]), encryptedPath, key);
  const ciphertext = readFileSync(encryptedPath);
  const ciphertextDigest = createHash("sha256").update(ciphertext).digest("hex");
  assert(/^[a-f0-9]{64}$/.test(ciphertextDigest), "Encrypted backup digest is invalid.");

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
  assert(psql(staging, "SELECT count(*) FROM _prisma_migrations WHERE migration_name='20261001_baseline' AND checksum='" + "a".repeat(64) + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;") === "1"
    && psql(staging, "SELECT count(*) FROM _prisma_migrations;") === "1", "Staged Prisma migration history differs from the pre-DDL baseline.");

  // Destructive name swap is reached only after authenticated restore and exact checks above.
  psql("postgres", `ALTER DATABASE ${target} RENAME TO ${failed};`);
  psql("postgres", `ALTER DATABASE ${staging} RENAME TO ${target};`);
  assert(queryRows(target) === baselineRows && querySchema(target) === baselineSchema, "Cutback swap did not install the verified baseline database.");
  assert(queryRows(failed).includes("partially-migrated"), "Cutback did not retain the failed migrated database for review.");
  console.log("Isolated PostgreSQL cutback PASS: wrong key/ciphertext and failed restore preserved target; authenticated snapshot restored schema/history/data; atomic-name cutback retained failed DB.");
} finally {
  try { psql("postgres", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN (${sqlLiteral(target)}, ${sqlLiteral(staging)}, ${sqlLiteral(failed)}) AND pid <> pg_backend_pid();`); } catch {}
  for (const name of [target, staging, failed]) { try { psql("postgres", `DROP DATABASE IF EXISTS ${name};`); } catch {} }
  key.fill(0);
  rmSync(scratchRoot, { recursive: true, force: true });
}
