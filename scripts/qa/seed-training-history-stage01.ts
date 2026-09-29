import { requireIsolatedStage01Database } from "../../src/modules/training/testing/require-isolated-database";

function readOperation(): "seed" | "cleanup" {
  const value = process.argv[2];
  if (value === "seed" || value === "cleanup") return value;
  throw new Error("Usage: tsx scripts/qa/seed-training-history-stage01.ts <seed|cleanup>");
}

const operation = readOperation();

async function main() {
  const target = requireIsolatedStage01Database(process.env.DATABASE_URL, process.env.BODYCAST_STAGE01_MODE, operation);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    await prisma.$connect();
    const persistence = await import("../../src/modules/training/testing/stage01-persistence");
    const result = operation === "seed"
      ? await persistence.seedStage01Namespace(prisma)
      : await persistence.cleanupStage01Namespace(prisma);
    console.log(JSON.stringify({ database: target.databaseName, role: target.role, operation, result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
