import { prisma } from "@/lib/db/prisma";
import { verifyUnifiedV4ReadyForTraffic } from "@/modules/model-episodes/unified-rollout-v4.service";

function profileIdArg(): number {
  const index = process.argv.indexOf("--profile-id");
  const value = index < 0 ? undefined : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value! <= 0) throw new Error("Usage: node unified-v4-traffic-check.mjs --profile-id <positive integer>");
  return value!;
}

verifyUnifiedV4ReadyForTraffic({ profileId: profileIdArg() })
  .then((result) => process.stdout.write(JSON.stringify({ command: "unified-v4-traffic-check", ...result, ready: true }) + "\n"))
  .catch((error: unknown) => {
    process.stderr.write(`Forecast V2 serving blocked: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
