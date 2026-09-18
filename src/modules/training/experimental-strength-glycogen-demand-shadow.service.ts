import { prisma } from "@/lib/db/prisma";
import { estimateExperimentalStrengthGlycogenDemandV1, EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION, experimentalStrengthGlycogenDemandV1Fingerprint } from "@/model/physiology-v7/experimental-strength-glycogen-demand-v1";
import { buildQualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import type { StrengthSessionDto } from "./training.types";
import { TrainingRepository } from "./training.repository";

/**
 * Isolated experimental/shadow output for strength glycogen demand.
 * Never an input to TDEE, production physiology, forecast, or GREEN contracts.
 */
export async function recordExperimentalStrengthGlycogenDemandShadow(input: {
  session: StrengthSessionDto;
  profileId: number;
}): Promise<void> {
  const dose = buildQualifiedResistanceTrainingDoseV7(
    buildCanonicalStrengthTrainingInputV7({
      session: input.session,
      heartRateSamples: null,
    }),
  );
  const latestGlycogen = await prisma.dailyModelState.findFirst({
    where: {
      status: "complete",
      glycogenKg: { not: null },
      episode: { profileId: input.profileId, active: true },
    },
    orderBy: { date: "desc" },
    select: { glycogenKg: true },
  });
  const availableGlycogenKg = latestGlycogen?.glycogenKg ?? null;
  const activeEnergyKcal = input.session.matchedWorkout?.activeEnergyKcal ?? null;
  const result = estimateExperimentalStrengthGlycogenDemandV1({
    dose,
    availableGlycogenKg,
    activeEnergyKcal,
  });
  const sourceFingerprint = experimentalStrengthGlycogenDemandV1Fingerprint(result);
  await prisma.experimentalStrengthGlycogenDemandShadow.upsert({
    where: { sessionId: input.session.id },
    create: {
      sessionId: input.session.id,
      profileId: input.profileId,
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION,
      features: result.features,
      result,
    },
    update: {
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION,
      features: result.features,
      result,
    },
  });
}

export async function recordExperimentalStrengthGlycogenDemandShadowBySessionId(input: {
  sessionId: number;
  profileId: number;
}): Promise<void> {
  const session = await new TrainingRepository(prisma).getSession(input.sessionId, input.profileId);
  if (session !== null) {
    await recordExperimentalStrengthGlycogenDemandShadow({
      session,
      profileId: input.profileId,
    });
  }
}
