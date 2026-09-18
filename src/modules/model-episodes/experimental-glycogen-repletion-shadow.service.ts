import { prisma } from "@/lib/db/prisma";
import {
  estimateExperimentalGlycogenRepletionV1,
  EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION,
  experimentalGlycogenRepletionV1Fingerprint,
  storeHeadroomFromExerciseDepletionKgV1,
} from "@/model/physiology-v7/experimental-glycogen-repletion-v1";

type GlycogenShadowResult = {
  availability?: string;
  estimatedGlycogenDeltaKg?: number | null;
};

function depletionFromShadowResult(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  const row = result as GlycogenShadowResult;
  if (row.availability !== "available") return null;
  const delta = row.estimatedGlycogenDeltaKg;
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
  return delta;
}

/**
 * Isolated experimental/shadow daily glycogen repletion.
 * Never an input to TDEE, production physiology, forecast, or GREEN contracts.
 */
export async function recordExperimentalGlycogenRepletionShadow(input: {
  date: string;
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;

  const [health, latestGlycogen, strengthShadows, stepperShadows] = await Promise.all([
    prisma.dailyHealthData.findUnique({
      where: { date: input.date },
      select: { carbsG: true, proteinG: true, activeEnergyKcal: true },
    }),
    prisma.dailyModelState.findFirst({
      where: {
        status: "complete",
        glycogenKg: { not: null },
        episode: { profileId, active: true },
        date: { lte: input.date },
      },
      orderBy: { date: "desc" },
      select: { glycogenKg: true },
    }),
    prisma.experimentalStrengthGlycogenDemandShadow.findMany({
      where: {
        profileId,
        session: { matchedWorkout: { dailyHealthData: { date: input.date } } },
      },
      select: { result: true },
    }),
    prisma.experimentalStepperGlycogenDemandShadow.findMany({
      where: {
        profileId,
        workout: { dailyHealthData: { date: input.date } },
      },
      select: { result: true },
    }),
  ]);

  const depletionDeltas = [
    ...strengthShadows.map((row) => depletionFromShadowResult(row.result)),
    ...stepperShadows.map((row) => depletionFromShadowResult(row.result)),
  ];
  const storeHeadroomKg = storeHeadroomFromExerciseDepletionKgV1(depletionDeltas);
  const result = estimateExperimentalGlycogenRepletionV1({
    carbsG: health?.carbsG ?? null,
    proteinG: health?.proteinG ?? null,
    currentGlycogenKg: latestGlycogen?.glycogenKg ?? null,
    storeHeadroomKg,
    headroomSource: storeHeadroomKg === null ? "unavailable" : "exercise-depletion-refill",
    activeEnergyKcal: health?.activeEnergyKcal ?? null,
  });
  const sourceFingerprint = experimentalGlycogenRepletionV1Fingerprint(result);
  await prisma.experimentalGlycogenRepletionShadow.upsert({
    where: { profileId_date: { profileId, date: input.date } },
    create: {
      profileId,
      date: input.date,
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION,
      features: result.features,
      result,
    },
    update: {
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION,
      features: result.features,
      result,
    },
  });
}
