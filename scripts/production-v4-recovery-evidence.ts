import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/db/prisma";

// Keep this exact allowlist aligned with the audited legacy recovery source.
// It is repeated here because this evidence wrapper must also typecheck on
// current main, which intentionally does not carry the legacy recovery service.
const RECOVERY_RAW_INPUT_TABLES = [
  "Profile",
  "ModelEpisode",
  "StepperEquipmentAssignment",
  "DailyHealthData",
  "HealthMetricSample",
  "HeartRateSample",
  "RestingHeartRateSample",
  "SleepSegment",
  "HealthSyncSnapshot",
  "HealthSyncAudit",
  "HealthActivityInterval",
  "Workout",
  "ExerciseCatalog",
  "ExerciseLoadConfiguration",
  "TrainingProgram",
  "TrainingProgramVersion",
  "ProgramExercise",
  "StrengthDiarySession",
  "StrengthDiaryProgramChange",
  "StrengthSessionExercise",
  "StrengthSet",
  "WorkInterval",
  "StepperReconciliationGroup",
  "StepperReconciliationCandidate",
] as const;

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function inventoryV4RecoveryRawSourcesV1(client: typeof prisma): Promise<string> {
  const digest = createHash("sha256").update("bodycast-v4-recovery-raw-sources-v1\0");
  for (const table of RECOVERY_RAW_INPUT_TABLES) {
    const rawRowExpression = table === "ModelEpisode"
      ? `to_jsonb(source_row) - ARRAY['personalOffsetKcalPerDay', 'activityCalibration', 'calibrationStatus', 'calibrationDiagnostics', 'latestModeledDate', 'updatedAt']::text[]`
      : "to_jsonb(source_row)";
    const rows = await client.$queryRawUnsafe<Array<{ id: number; raw_row: string }>>(
      `SELECT source_row.id, (${rawRowExpression})::text AS raw_row
       FROM public."${table}" AS source_row
       ORDER BY source_row.id`,
    );
    const tableDigest = createHash("sha256").update(`${table}\0${rows.length}\0`);
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || typeof row.raw_row !== "string") {
        throw new Error(`V4 strict source fingerprint returned invalid ${table} row`);
      }
      tableDigest.update(`${row.id}:${Buffer.byteLength(row.raw_row, "utf8")}:${row.raw_row}\n`);
    }
    digest.update(`${table}\0${tableDigest.digest("hex")}\0`);
  }
  return digest.digest("hex");
}

function dateKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

async function migrationManifest() {
  const root = "/app/prisma/migrations";
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const rows = [];
  for (const name of names) {
    const sql = await readFile(join(root, name, "migration.sql"));
    rows.push({ name, checksum: sha256(sql) });
  }
  const treeDigest = sha256(rows.map((row) => `${row.name}\t${row.checksum}\n`).join(""));
  return { rows, treeDigest };
}

async function main() {
  const [manifest, result] = await Promise.all([
    migrationManifest(),
    prisma.$transaction(async (tx) => {
      const [identity] = await tx.$queryRawUnsafe<Array<{
        database: string; version: string; serverAddress: string; serverPort: number;
      }>>(`SELECT current_database() AS database, current_setting('server_version') AS version,
        inet_server_addr()::text AS "serverAddress", inet_server_port() AS "serverPort"`);
      const migrations = await tx.$queryRawUnsafe<Array<{
        name: string; checksum: string; finishedAt: Date | null; rolledBackAt: Date | null;
      }>>(`SELECT migration_name AS name, checksum, finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
        FROM public."_prisma_migrations" ORDER BY migration_name`);
      const lifecycle = await tx.physiologyV7Lifecycle.findUnique({
        where: { profileId: 1 },
        select: { profileId: true, invalidationGeneration: true, productionPublishedGeneration: true,
          productionStaleFromDate: true, unifiedTargetRevision: true, unifiedRolloutEpoch: true,
          unifiedPublishedGeneration: true, unifiedPublishedRolloutEpoch: true },
      });
      const blocks = await tx.unifiedPublicationBlock.findMany({
        where: { profileId: 1 }, orderBy: [{ source: "asc" }, { sourceKey: "asc" }],
        select: { source: true, sourceKey: true, fromDate: true, revision: true },
      });
      // The audited inventory helper only needs $queryRawUnsafe; Prisma's
      // transaction client shares that API while intentionally omitting
      // $transaction itself from its static type.
      const sourceFingerprint = await inventoryV4RecoveryRawSourcesV1(tx as unknown as typeof prisma);
      const [persistedDayRows, coveredDayRows] = lifecycle ? await Promise.all([
        tx.dailyModelState.findMany({ where: { episode: { profileId: 1, active: true } },
          select: { date: true }, orderBy: { date: "asc" } }),
        tx.unifiedExperimentalPhysiologyStateV2.findMany({
          where: { profileId: 1, modelRevision: lifecycle.unifiedTargetRevision },
          select: { date: true }, orderBy: { date: "asc" },
        }),
      ]) : [[], []];
      return {
        database: identity,
        migrationRows: migrations,
        lifecycle,
        blocks: blocks.map((block) => ({ ...block, fromDate: dateKey(block.fromDate) })),
        sourceFingerprint,
        persistedDayDates: persistedDayRows.map((row) => dateKey(row.date)),
        coveredDayDates: coveredDayRows.map((row) => dateKey(row.date)),
        persistedDayCount: persistedDayRows.length,
        coveredDayCount: coveredDayRows.length,
      };
    }, { isolationLevel: "RepeatableRead" }),
  ]);
  const output = { ...result, expectedMigrationRows: manifest.rows, expectedLedgerDigest: manifest.treeDigest };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`V4 recovery read-only evidence failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
