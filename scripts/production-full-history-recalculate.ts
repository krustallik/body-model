import { prisma } from "@/lib/db/prisma";
import { runOwnerAuthorizedFullHistoryRecalculation } from "@/modules/model-episodes/full-history-recalculation.service";

function args(): { profileId: number } {
  if (!process.argv.includes("--full-history-recalculate") || !process.argv.includes("--owner-authorized")) {
    throw new Error(
      "Full-history recalculation requires explicit --full-history-recalculate --owner-authorized flags",
    );
  }
  const index = process.argv.indexOf("--profile-id");
  const profileId = index < 0 ? NaN : Number(process.argv[index + 1]);
  if (!Number.isInteger(profileId) || profileId <= 0) {
    throw new Error(
      "Usage: node production-full-history-recalculate.mjs --full-history-recalculate --owner-authorized --profile-id <positive integer>",
    );
  }
  return { profileId };
}

async function main(): Promise<void> {
  const { profileId } = args();
  const result = await runOwnerAuthorizedFullHistoryRecalculation({
    profileId,
    ownerAuthorized: true,
  });
  const {
    recalculation: _recalculation,
    ...summary
  } = result;
  void _recalculation;
  process.stdout.write(JSON.stringify({
    command: "production-full-history-recalculate",
    ...summary,
    current: true,
  }) + "\n");
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Production full-history recalculation failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
