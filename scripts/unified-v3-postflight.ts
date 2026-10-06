import { prisma } from "@/lib/db/prisma";
import { verifyAndPublishUnifiedV3Postflight } from "@/modules/model-episodes/unified-rollout-v4.service";

function profileIdArg(): number {
  const index = process.argv.indexOf("--profile-id");
  const value = index < 0 ? undefined : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value! <= 0) throw new Error("Usage: tsx scripts/unified-v3-postflight.ts --profile-id <positive integer>");
  return value!;
}

async function main(): Promise<void> {
  const result = await verifyAndPublishUnifiedV3Postflight({ profileId: profileIdArg() });
  process.stdout.write(JSON.stringify({ command: "unified-v3-postflight", ...result, publishedEpoch: 0 }) + "\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`Unified V3 postflight failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
