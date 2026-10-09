import { prisma } from "@/lib/db/prisma";
import { estimateExperimentalStrengthGlycogenDemandV1, EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION, experimentalStrengthGlycogenDemandV1Fingerprint } from "@/model/physiology-v7/experimental-strength-glycogen-demand-v1";
import { buildQualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import type { StrengthSessionDto } from "./training.types";
import { TrainingRepository } from "./training.repository";
import { persistUnifiedShadowCandidateV1, readUnifiedSourceFenceV1 } from "@/modules/model-episodes/physiology-v7-persistence.repository";

/**
 * Isolated experimental/shadow output for strength glycogen demand.
 * Never an input to TDEE, production physiology, forecast, or GREEN contracts.
 */
export async function recordExperimentalStrengthGlycogenDemandShadow(input: {
  session: StrengthSessionDto;
  profileId: number;
}): Promise<void> {
  const sourceFence = await readUnifiedSourceFenceV1(prisma, input.profileId);
  const dose = buildQualifiedResistanceTrainingDoseV7(
    buildCanonicalStrengthTrainingInputV7({
      session: input.session,
      heartRateSamples: null,
    }),
  );
  // The daily relative-debt trajectory owns the single shared depletion cap.
  // Per-workout shadows must not independently clamp against the same store.
  const availableGlycogenKg = null;
  const activeEnergyKcal = input.session.matchedWorkout?.activeEnergyKcal ?? null;
  const result = estimateExperimentalStrengthGlycogenDemandV1({
    dose,
    availableGlycogenKg,
    activeEnergyKcal,
  });
  const sourceFingerprint = experimentalStrengthGlycogenDemandV1Fingerprint(result);
  await persistUnifiedShadowCandidateV1({
    client: prisma,
    profileId: input.profileId,
    expectedFence: sourceFence,
    persist: async (tx) => {
      const sessions = await TrainingRepository.listCompletedTransientWaterSourcesV2FromClient(tx, input.profileId);
      const current = sessions.find(({ session }) => session.id === input.session.id)?.session;
      if (current === undefined) return false;
      const currentDose = buildQualifiedResistanceTrainingDoseV7(
        buildCanonicalStrengthTrainingInputV7({ session: current, heartRateSamples: null }),
      );
      const currentResult = estimateExperimentalStrengthGlycogenDemandV1({
        dose: currentDose,
        availableGlycogenKg: null,
        activeEnergyKcal: current.matchedWorkout?.activeEnergyKcal ?? null,
      });
      const currentFingerprint = experimentalStrengthGlycogenDemandV1Fingerprint(currentResult);
      if (currentFingerprint !== sourceFingerprint) {
        throw new Error("strength glycogen candidate sources changed before persistence");
      }
      const existing = await tx.experimentalStrengthGlycogenDemandShadow.findUnique({
        where: { sessionId: input.session.id }, select: { sourceFingerprint: true, modelRevision: true },
      });
      if (existing?.sourceFingerprint === sourceFingerprint
          && existing.modelRevision === EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION) return false;
      await tx.experimentalStrengthGlycogenDemandShadow.upsert({
        where: { sessionId: input.session.id },
        create: { sessionId: input.session.id, profileId: input.profileId, sourceFingerprint, modelRevision: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION, features: result.features, result },
        update: { sourceFingerprint, modelRevision: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION, features: result.features, result },
      });
      return true;
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
