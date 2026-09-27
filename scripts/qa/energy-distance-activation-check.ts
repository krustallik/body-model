import { PrismaClient } from "@prisma/client";
import { rollbackVisibilityGenerationV1 } from "@/modules/model-episodes/activation-rollback-v1";
import { prismaVisibilityStoreV1 } from "@/modules/model-episodes/activation-rollback-store";

const prisma = new PrismaClient();
const generationId = "browser-qa-activation-r2";

async function main() {
  const mode = process.argv[2] ?? "inspect";
  if (mode === "rollback") {
    await rollbackVisibilityGenerationV1({
      store: prismaVisibilityStoreV1(prisma),
      generationId,
    });
  }
  const rows = await prisma.workout.findMany({
    where: { id: { in: [337, 338] } },
    select: {
      id: true,
      sourceIdentity: true,
      hiddenFromHistory: true,
      syncProtected: true,
      supersededByWorkoutId: true,
      supersessionReason: true,
    },
    orderBy: { id: "asc" },
  });
  const journal = await prisma.activationRollbackEntry.findMany({
    where: { generationId },
    orderBy: { id: "asc" },
  });
  console.log(JSON.stringify({ mode, rows, journalCount: journal.length, journal }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
