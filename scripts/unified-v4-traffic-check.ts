import { createInterface } from "node:readline";
import { prisma } from "@/lib/db/prisma";
import { verifyUnifiedV4ReadyForTraffic } from "@/modules/model-episodes/unified-rollout-v4.service";

function profileIdArg(): number {
  const index = process.argv.indexOf("--profile-id");
  const value = index < 0 ? undefined : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value! <= 0) throw new Error("Usage: node unified-v4-traffic-check.mjs --profile-id <positive integer>");
  return value!;
}

const profileId = profileIdArg();
const holdCurrentnessFence = process.argv.includes("--hold-currentness-fence");
const preTrainingMigration = process.argv.includes("--pre-training-migration");
if (holdCurrentnessFence && preTrainingMigration) {
  throw new Error("A held serve fence cannot skip the durable Training refresh queue.");
}

async function waitForRouteCommit(timeoutMs: number): Promise<string> {
  const readline = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      new Promise<string>((resolve, reject) => {
        readline.once("line", resolve);
        readline.once("close", () => reject(new Error("SSH route did not acknowledge the fenced publication.")));
      }),
      new Promise<string>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("SSH route acknowledgment exceeded the bounded currentness fence.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    readline.close();
  }
}

const verify = async () => {
  if (!holdCurrentnessFence) {
    if (preTrainingMigration && profileId !== 1) {
      throw new Error("Pre-Training-migration readiness is restricted to production profile 1.");
    }
    const result = await verifyUnifiedV4ReadyForTraffic({
      profileId,
      checkTrainingRefreshQueue: !preTrainingMigration,
    });
    process.stdout.write(JSON.stringify({ command: "unified-v4-traffic-check", ...result, ready: true }) + "\n");
    return;
  }
  if (profileId !== 1) throw new Error("The held production currentness fence is restricted to profile 1.");
  const fenceStartedAt = Date.now();
  const transactionTimeoutMs = 90_000;
  const routeSafetyMarginMs = 5_000;
  const minimumRouteBudgetMs = 75_000;
  const result = await prisma.$transaction(async (tx) => {
    const readiness = await verifyUnifiedV4ReadyForTraffic({ profileId, client: tx });
    const routeBudgetMs = transactionTimeoutMs - (Date.now() - fenceStartedAt) - routeSafetyMarginMs;
    if (routeBudgetMs < minimumRouteBudgetMs) {
      throw new Error("Unified V4 verification left too little transaction time for a bounded SSH route commit.");
    }
    process.stdout.write(`BODYCAST_UNIFIED_V4_FENCE_READY ${routeBudgetMs}\n`);
    const decision = await waitForRouteCommit(routeBudgetMs);
    if (decision !== "route-committed") throw new Error("SSH route did not commit while Unified V4 currentness was fenced.");
    return readiness;
  }, { maxWait: 5_000, timeout: transactionTimeoutMs });
  process.stdout.write("BODYCAST_UNIFIED_V4_FENCE_COMMITTED " + JSON.stringify(result) + "\n");
};

verify()
  .catch((error: unknown) => {
    process.stderr.write("Forecast V2 serving blocked: " + (error instanceof Error ? error.message : "unknown error") + "\n");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
