import { prisma } from "@/lib/db/prisma";
import { runOwnerAuthorizedFullHistoryRecalculation } from "@/modules/model-episodes/full-history-recalculation.service";
import { recoverUnifiedV4FromPersistedSourcesV1 } from "@/modules/model-episodes/unified-v4-derived-recovery.service";
import type { V4RecoveryEvidenceBindingV1 } from "@/modules/model-episodes/unified-v4-derived-recovery.service";

function args(): { profileId: number; mode: "full-history" | "derived-v4" } {
  const fullHistory = process.argv.includes("--full-history-recalculate");
  const derivedV4 = process.argv.includes("--derived-v4-recovery");
  if (fullHistory === derivedV4 || !process.argv.includes("--owner-authorized")) {
    throw new Error("Choose exactly one owner-authorized recalculation operation");
  }
  const index = process.argv.indexOf("--profile-id");
  const profileId = index < 0 ? NaN : Number(process.argv[index + 1]);
  if (!Number.isInteger(profileId) || profileId <= 0) {
    throw new Error(
      "Usage: node production-full-history-recalculate.mjs (--full-history-recalculate | --derived-v4-recovery) --owner-authorized --profile-id <positive integer>",
    );
  }
  return { profileId, mode: derivedV4 ? "derived-v4" : "full-history" };
}

async function main(): Promise<void> {
  const { profileId, mode } = args();
  if (mode === "derived-v4") {
    const serializedBinding = process.env.BODYCAST_V4_EXPECTED_EVIDENCE_BINDING;
    if (!serializedBinding || serializedBinding.length > 2048) {
      throw new Error("Derived V4 recovery requires BODYCAST_V4_EXPECTED_EVIDENCE_BINDING from its exact rehearsal");
    }
    let expectedEvidenceBinding: V4RecoveryEvidenceBindingV1;
    try {
      expectedEvidenceBinding = JSON.parse(serializedBinding) as V4RecoveryEvidenceBindingV1;
    } catch {
      throw new Error("Derived V4 recovery evidence binding is not valid JSON");
    }
    const result = await recoverUnifiedV4FromPersistedSourcesV1({
      profileId, ownerAuthorized: true, expectedEvidenceBinding,
    });
    process.stdout.write(JSON.stringify({ command: "unified-v4-derived-recovery", ...result, current: true }) + "\n");
    return;
  }
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
