import { prisma } from "@/lib/db/prisma";
import {
  estimateExperimentalSkeletalMuscleDeltaV1,
  EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
  experimentalSkeletalMuscleDeltaV1Fingerprint,
  type ExperimentalTrainingStatusV1,
} from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";
import { buildQualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { TrainingRepository } from "@/modules/training/training.repository";

/**
 * Isolated experimental/shadow daily skeletal-muscle delta.
 * Never an input to TDEE, production physiology, forecast, or GREEN contracts.
 */
export async function recordExperimentalSkeletalMuscleDeltaShadow(input: {
  date: string;
  profileId?: number;
  trainingStatus?: ExperimentalTrainingStatusV1;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  const trainingRepo = new TrainingRepository(prisma);

  const [health, modelState, priorShadow, sessionRows] = await Promise.all([
    prisma.dailyHealthData.findUnique({
      where: { date: input.date },
      select: {
        proteinG: true,
        weightKg: true,
        workoutFeedObserved: true,
      },
    }),
    prisma.dailyModelState.findFirst({
      where: {
        date: input.date,
        status: "complete",
        episode: { profileId, active: true },
      },
      select: { energyBalanceKcal: true },
    }),
    prisma.experimentalSkeletalMuscleDeltaShadow.findFirst({
      where: { profileId, date: { lt: input.date } },
      orderBy: { date: "desc" },
      select: { result: true },
    }),
    prisma.strengthDiarySession.findMany({
      where: {
        profileId,
        status: "COMPLETED",
        matchedWorkout: { dailyHealthData: { date: input.date } },
      },
      select: { id: true },
    }),
  ]);

  let qualifiedHardSetCount = 0;
  const muscleGroups = new Set<string>();
  let sawQualified = false;
  for (const row of sessionRows) {
    const session = await trainingRepo.getSession(row.id, profileId);
    if (session === null) continue;
    const dose = buildQualifiedResistanceTrainingDoseV7(
      buildCanonicalStrengthTrainingInputV7({ session, heartRateSamples: null }),
    );
    if (dose.availability !== "available") continue;
    sawQualified = true;
    qualifiedHardSetCount += dose.qualifiedHardSetCount;
    for (const bucket of dose.muscleGroups) {
      if (bucket.directMappedSetCount > 0) muscleGroups.add(bucket.muscleGroup);
    }
  }

  let trainingExposureKind: "qualified-mapped-training" | "verified-no-exposure" | "unresolved-missing-training";
  let hardSets: number | null;
  if (sawQualified && qualifiedHardSetCount > 0) {
    trainingExposureKind = "qualified-mapped-training";
    hardSets = qualifiedHardSetCount;
  } else if (health?.workoutFeedObserved === true) {
    trainingExposureKind = "verified-no-exposure";
    hardSets = 0;
  } else {
    trainingExposureKind = "unresolved-missing-training";
    hardSets = null;
  }

  const bodyMassKg = health?.weightKg ?? null;
  const proteinGPerKg = health?.proteinG != null && bodyMassKg != null && bodyMassKg > 0
    ? health.proteinG / bodyMassKg
    : null;

  const priorCumulative = (
    priorShadow?.result as { state?: { relativeCumulativeDeltaKg?: number | null } } | null
  )?.state?.relativeCumulativeDeltaKg ?? 0;

  const result = estimateExperimentalSkeletalMuscleDeltaV1({
    qualifiedHardSetCount: hardSets,
    mappedMuscleGroupCount: muscleGroups.size > 0 ? muscleGroups.size : null,
    trainingExposureKind,
    trainingStatus: input.trainingStatus ?? "unknown",
    proteinGPerKg,
    energyBalanceKcal: modelState?.energyBalanceKcal ?? null,
    bodyMassKg,
    priorRelativeCumulativeDeltaKg: typeof priorCumulative === "number" ? priorCumulative : 0,
  });
  const sourceFingerprint = experimentalSkeletalMuscleDeltaV1Fingerprint(result);
  await prisma.experimentalSkeletalMuscleDeltaShadow.upsert({
    where: { profileId_date: { profileId, date: input.date } },
    create: {
      profileId,
      date: input.date,
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
      features: result.features,
      result,
    },
    update: {
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
      features: result.features,
      result,
    },
  });
}

export async function recordExperimentalSkeletalMuscleDeltaShadowForSession(input: {
  sessionId: number;
  profileId: number;
}): Promise<void> {
  const row = await prisma.strengthDiarySession.findFirst({
    where: { id: input.sessionId, profileId: input.profileId },
    select: {
      matchedWorkout: { select: { dailyHealthData: { select: { date: true } }, startAt: true } },
      webStartedAt: true,
    },
  });
  const date = row?.matchedWorkout?.dailyHealthData?.date
    ?? (row?.matchedWorkout?.startAt instanceof Date
      ? row.matchedWorkout.startAt.toISOString().slice(0, 10)
      : null)
    ?? (row?.webStartedAt instanceof Date
      ? row.webStartedAt.toISOString().slice(0, 10)
      : null);
  if (date === null) return;
  await recordExperimentalSkeletalMuscleDeltaShadow({
    date,
    profileId: input.profileId,
  });
}
