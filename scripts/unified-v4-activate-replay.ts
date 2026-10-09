import { prisma } from "@/lib/db/prisma";
import { activateAndReplayUnifiedV4 } from "@/modules/model-episodes/unified-rollout-v4.service";

function args(): { profileId: number } {
  if (!process.argv.includes("--activate-v4") || !process.argv.includes("--owner-authorized")) {
    throw new Error("V4 activation requires explicit --activate-v4 --owner-authorized flags");
  }
  const index = process.argv.indexOf("--profile-id");
  const profileId = index < 0 ? NaN : Number(process.argv[index + 1]);
  if (!Number.isInteger(profileId) || profileId <= 0) {
    throw new Error("Usage: tsx scripts/unified-v4-activate-replay.ts --activate-v4 --owner-authorized --profile-id <positive integer>");
  }
  return { profileId };
}

async function main(): Promise<void> {
  const result = await activateAndReplayUnifiedV4(args());
  process.stdout.write(JSON.stringify({ command: "unified-v4-activate-replay", ...result, current: true }) + "\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`Unified V4 activation/replay failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
