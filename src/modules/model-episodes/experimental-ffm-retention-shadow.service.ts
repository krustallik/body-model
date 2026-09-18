import { prisma } from "@/lib/db/prisma";
import {
  EXPERIMENTAL_FFM_RETENTION_V1_REVISION,
  estimateExperimentalFfmRetentionV1,
  experimentalFfmRetentionV1Fingerprint,
} from "@/model/physiology-v7/experimental-ffm-retention-v1";
import type { ExperimentalTrainingExposureKindV1 } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";

/**
 * Isolated experimental/shadow FFM / slow-nonfat retention.
 * Never an input to TDEE, production physiology, forecast, GREEN, or
 * FatWeightShadowV1 / Hall-Forbes production state.
 */
export async function recordExperimentalFfmRetentionShadow(input: {
  date: string;
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  const [health, modelState, smShadow, priorFat] = await Promise.all([
    prisma.dailyHealthData.findUnique({
      where: { date: input.date },
      select: { proteinG: true, weightKg: true },
    }),
    prisma.dailyModelState.findFirst({
      where: {
        date: input.date,
        status: "complete",
        episode: { profileId, active: true },
      },
      select: { energyBalanceKcal: true },
    }),
    prisma.experimentalSkeletalMuscleDeltaShadow.findUnique({
      where: { profileId_date: { profileId, date: input.date } },
      select: { result: true },
    }),
    prisma.fatWeightShadowV1Result.findFirst({
      where: { profileId, date: { lt: input.date } },
      orderBy: { date: "desc" },
      select: { result: true },
    }),
  ]);

  const sm = smShadow?.result as {
    features?: { trainingExposureKind?: ExperimentalTrainingExposureKindV1 };
  } | null;
  const exposureKind = sm?.features?.trainingExposureKind ?? null;
  const bodyMassKg = health?.weightKg ?? null;
  const proteinGPerKg = health?.proteinG != null && bodyMassKg != null && bodyMassKg > 0
    ? health.proteinG / bodyMassKg
    : null;
  const priorFatMassKg = (
    priorFat?.result as { state?: { fatMassKg?: number | null } } | null
  )?.state?.fatMassKg ?? null;

  const result = estimateExperimentalFfmRetentionV1({
    energyBalanceKcal: modelState?.energyBalanceKcal ?? null,
    proteinGPerKg,
    trainingExposureKind: exposureKind,
    hallForbesReferenceFatMassKg: typeof priorFatMassKg === "number" ? priorFatMassKg : null,
  });
  const sourceFingerprint = experimentalFfmRetentionV1Fingerprint(result);
  await prisma.experimentalFfmRetentionShadow.upsert({
    where: { profileId_date: { profileId, date: input.date } },
    create: {
      profileId,
      date: input.date,
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_FFM_RETENTION_V1_REVISION,
      features: result.features,
      result,
    },
    update: {
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_FFM_RETENTION_V1_REVISION,
      features: result.features,
      result,
    },
  });
}

export async function recordExperimentalFfmRetentionShadowForSession(input: {
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
  await recordExperimentalFfmRetentionShadow({
    date,
    profileId: input.profileId,
  });
}
