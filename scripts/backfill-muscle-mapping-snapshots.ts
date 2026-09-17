/**
 * Dry-run / apply backfill for null StrengthSessionExercise.muscleMappingSnapshot.
 *
 * Usage:
 *   npx tsx scripts/backfill-muscle-mapping-snapshots.ts
 *   npx tsx scripts/backfill-muscle-mapping-snapshots.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import {
  applyNullMuscleMappingSnapshotBackfill,
  reportNullMuscleMappingSnapshotBackfill,
} from "@/modules/training/exercise-mapping-snapshot";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    const report = apply
      ? await applyNullMuscleMappingSnapshotBackfill(prisma, { dryRun: false })
      : {
          ...(await reportNullMuscleMappingSnapshotBackfill(prisma)),
          updatedRows: 0,
          dryRun: true,
        };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
