import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/db/prisma";
import { inventoryV4RecoveryRawSourcesV1 } from "@/modules/model-episodes/unified-v4-derived-recovery.service";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

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
        blocks: blocks.map((block) => ({ ...block, fromDate: block.fromDate.toISOString().slice(0, 10) })),
        sourceFingerprint: sourceFingerprint.fingerprint,
        persistedDayDates: persistedDayRows.map((row) => row.date.toISOString().slice(0, 10)),
        coveredDayDates: coveredDayRows.map((row) => row.date.toISOString().slice(0, 10)),
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
