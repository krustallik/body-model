import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withPrismaLockTimeout } from "../production-migration-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const databaseUrlText = process.env.BODYCAST_TEST_DATABASE_URL;
if (!databaseUrlText) throw new Error("BODYCAST_TEST_DATABASE_URL is required; use an isolated local PostgreSQL service.");
const databaseUrl = new URL(databaseUrlText);
if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname)) throw new Error("Prisma checksum fixture refuses non-local PostgreSQL targets.");

const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const prismaVersion = lock.packages?.["node_modules/prisma"]?.version;
if (prismaVersion !== "6.19.3") throw new Error("Pinned Prisma checksum fixture expects prisma@6.19.3; reviewed pin is " + prismaVersion + ".");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const scratch = await mkdtemp(path.join(os.tmpdir(), "bodycast-prisma-checksum-"));
const schemaName = "bodycast_v5_" + randomBytes(8).toString("hex");
const fixtureMigration = "20261005100000_prisma_checksum_fixture";
const secondMigration = "20261005110000_lock_timeout_fixture";
const schemaPath = path.join(scratch, "schema.prisma");
const migrationsPath = path.join(scratch, "migrations");
const migrationBytes = Buffer.from('CREATE TABLE "V5PrismaChecksumFixture" ("id" INTEGER NOT NULL PRIMARY KEY);\n', "utf8");
let holder;

function run(command, args, env, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error("Isolated Prisma fixture command failed: " + String(result.stderr ?? result.error?.message ?? result.status));
  return result.stdout.trim();
}

function psqlUrl(url) {
  const copy = new URL(url);
  copy.searchParams.delete("schema");
  copy.searchParams.delete("options");
  return copy.toString();
}

function prisma(url) {
  return run(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schemaPath], { ...process.env, DATABASE_URL: url });
}

try {
  const adminUrl = new URL(databaseUrl.toString());
  adminUrl.searchParams.delete("schema");
  const createSql = 'CREATE SCHEMA "' + schemaName + '"';
  run("psql", [psqlUrl(adminUrl), "--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1", "--command", createSql], process.env);

  databaseUrl.searchParams.set("schema", schemaName);
  const fixtureUrl = databaseUrl.toString();
  await writeFile(schemaPath, [
    'generator client { provider = "prisma-client-js" }',
    'datasource db { provider = "postgresql" url = env("DATABASE_URL") }',
    "",
  ].join("\n"));
  await mkdir(path.join(migrationsPath, fixtureMigration), { recursive: true });
  await writeFile(path.join(migrationsPath, "migration_lock.toml"), 'provider = "postgresql"\n');
  await writeFile(path.join(migrationsPath, fixtureMigration, "migration.sql"), migrationBytes);
  prisma(fixtureUrl);

  const checksumSql = 'SELECT checksum FROM "' + schemaName + '"."_prisma_migrations" WHERE migration_name = \'' + fixtureMigration + '\'';
  const stored = run("psql", [psqlUrl(adminUrl), "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--command", checksumSql], process.env);
  const expectedChecksum = createHash("sha256").update(migrationBytes).digest("hex");
  if (stored !== expectedChecksum) throw new Error("Prisma 6.19.3 stored checksum differs from exact migration file bytes.");

  await mkdir(path.join(migrationsPath, secondMigration), { recursive: true });
  await writeFile(path.join(migrationsPath, secondMigration, "migration.sql"), Buffer.from('ALTER TABLE "V5PrismaChecksumFixture" ADD COLUMN "value" INTEGER;\n'));
  const holderSql = 'BEGIN; LOCK TABLE "' + schemaName + '"."V5PrismaChecksumFixture" IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(8); COMMIT;';
  holder = spawn("psql", [psqlUrl(adminUrl), "--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1", "--command", holderSql], { stdio: "ignore", windowsHide: true });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const started = Date.now();
  const lockedUrl = withPrismaLockTimeout(fixtureUrl, 5000);
  const blocked = spawnSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schemaPath], {
    cwd: root, env: { ...process.env, DATABASE_URL: lockedUrl }, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024,
  });
  const elapsed = Date.now() - started;
  const output = String(blocked.stdout ?? "") + String(blocked.stderr ?? "");
  if (blocked.status === 0) throw new Error("Prisma unexpectedly acquired a DDL lock held by the integration fixture.");
  if (!/lock timeout|canceling statement due to lock timeout|Timed out trying to acquire a postgres advisory lock/i.test(output)) {
    throw new Error("Pinned Prisma did not report the expected PostgreSQL lock_timeout failure.");
  }
  if (elapsed < 4500 || elapsed > 7500) throw new Error("Prisma lock_timeout did not fail near five seconds; elapsed " + elapsed + "ms.");
  process.stdout.write(JSON.stringify({ prismaVersion, storedChecksum: stored, exactFileChecksum: expectedChecksum, lockTimeoutMs: 5000, lockWaitElapsedMs: elapsed }) + "\n");
} finally {
  if (holder && holder.exitCode === null) {
    holder.kill("SIGTERM");
    await new Promise((resolve) => holder.once("close", resolve));
  }
  const dropUrl = new URL(databaseUrlText);
  dropUrl.searchParams.delete("schema");
  dropUrl.searchParams.delete("options");
  run("psql", [psqlUrl(dropUrl), "--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1", "--command", 'DROP SCHEMA IF EXISTS "' + schemaName + '" CASCADE'], process.env);
  await rm(scratch, { recursive: true, force: true });
}

