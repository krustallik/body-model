import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA256 = /^[a-f0-9]{64}$/;

function reject(message) {
  throw new Error(`Fresh empty-install verification blocked: ${message}`);
}

export async function readMigrationTree(migrationsRoot) {
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (directories.length === 0 || directories.some((name) => !/^\d{14}_[a-z0-9_]+$/.test(name))) {
    reject("migration directory inventory is empty or malformed");
  }

  const migrations = [];
  for (const name of directories) {
    const bytes = await readFile(path.join(migrationsRoot, name, "migration.sql"));
    migrations.push({ name, checksum: createHash("sha256").update(bytes).digest("hex") });
  }
  const digest = createHash("sha256")
    .update(migrations.map(({ name, checksum }) => `${name}\t${checksum}\n`).join(""))
    .digest("hex");
  return { migrations, digest };
}

export function verifyFreshMigrationLedger({ migrations, rows, profileCount, sourceCounts = {} } = {}) {
  if (!Array.isArray(migrations) || migrations.length === 0 || !Array.isArray(rows)) {
    reject("migration tree or database ledger is unavailable");
  }
  const expectedNames = new Set(migrations.map((entry) => entry?.name));
  if (expectedNames.size !== migrations.length || migrations.some((entry) => !SHA256.test(String(entry?.checksum ?? "")))) {
    reject("migration tree contains duplicates or malformed checksums");
  }

  const grouped = new Map();
  for (const row of rows) {
    if (!row || typeof row.name !== "string" || !row.name) reject("database migration ledger contains an invalid row");
    grouped.set(row.name, [...(grouped.get(row.name) ?? []), row]);
  }
  const unexpected = [...grouped.keys()].filter((name) => !expectedNames.has(name));
  if (unexpected.length) reject("database contains migration rows absent from the exact release tree");

  for (const migration of migrations) {
    const entries = grouped.get(migration.name) ?? [];
    if (entries.length !== 1) reject(`migration ${migration.name} is missing or duplicated`);
    const [row] = entries;
    if (row.checksum !== migration.checksum) reject(`migration ${migration.name} checksum differs from the exact release tree`);
    if (row.finishedAt == null || row.rolledBackAt != null) reject(`migration ${migration.name} is incomplete or rolled back`);
  }

  if (profileCount !== 0) reject("a supposedly fresh database already contains a user profile");
  for (const [table, count] of Object.entries(sourceCounts)) {
    if (!Number.isSafeInteger(count) || count !== 0) reject(`fresh database contains pre-existing ${table} rows`);
  }

  return {
    migrationCount: migrations.length,
    migrationTreeDigest: createHash("sha256")
      .update(migrations.map(({ name, checksum }) => `${name}\t${checksum}\n`).join(""))
      .digest("hex"),
    profileCount,
    sourceCounts,
  };
}

function assertDatabaseTarget(databaseUrl, mode) {
  let url;
  try { url = new URL(databaseUrl); } catch { reject("DATABASE_URL is malformed"); }
  if (!url || !["postgres:", "postgresql:"].includes(url.protocol)) reject("DATABASE_URL is not PostgreSQL");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (mode === "production-empty-install") {
    if (url.hostname !== "db" || url.port !== "5432" || database !== "bodycast" || decodeURIComponent(url.username) !== "bodycast") {
      reject("production verification is restricted to the fixed new-install Compose database endpoint");
    }
    if (!/^[1-9][0-9]*$/.test(String(process.env.BODYCAST_EMPTY_INSTALL_RUN_ID ?? ""))) {
      reject("owner workflow run binding is missing");
    }
    return;
  }
  if (mode !== "test" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || !database.endsWith("_test")) {
    reject("test verification requires a loopback *_test database");
  }
}

async function verifyDatabase(mode) {
  assertDatabaseTarget(process.env.DATABASE_URL, mode);
  const [{ PrismaClient }, tree] = await Promise.all([
    import("@prisma/client"),
    readMigrationTree(path.resolve("prisma/migrations")),
  ]);
  const client = new PrismaClient();
  try {
    const rows = await client.$queryRaw`
      SELECT migration_name AS "name", checksum, finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
      FROM public."_prisma_migrations"
      ORDER BY migration_name
    `;
    const profileCount = await client.profile.count();
    const sourceCounts = {
      DailyHealthData: await client.dailyHealthData.count(),
      HealthMetricSample: await client.healthMetricSample.count(),
      Workout: await client.workout.count(),
      StrengthDiarySession: await client.strengthDiarySession.count(),
      TrainingProgram: await client.trainingProgram.count(),
      WorkInterval: await client.workInterval.count(),
      ModelEpisode: await client.modelEpisode.count(),
      PhysiologyV7Lifecycle: await client.physiologyV7Lifecycle.count(),
    };
    const result = verifyFreshMigrationLedger({ migrations: tree.migrations, rows, profileCount, sourceCounts });
    process.stdout.write(`${JSON.stringify({ ...result, status: "verified" })}\n`);
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  if (mode !== "--test" && mode !== "--production-empty-install") {
    reject("expected --test or --production-empty-install");
  }
  verifyDatabase(mode === "--test" ? "test" : "production-empty-install").catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "unknown verification error"}\n`);
    process.exitCode = 1;
  });
}
