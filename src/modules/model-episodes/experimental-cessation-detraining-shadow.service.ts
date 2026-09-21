import { prisma } from "@/lib/db/prisma";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
  initialExperimentalCessationStateV1,
  transitionExperimentalCessationDetrainingV1,
  type ExperimentalCessationStateV1,
} from "@/model/physiology-v7/experimental-cessation-detraining-v1";
import type { ExperimentalTrainingExposureKindV1 } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";
import { addCalendarDays } from "./model-calendar";
import { recordExperimentalSkeletalMuscleDeltaShadow } from "./experimental-skeletal-muscle-delta-shadow.service";
import {
  transitionExperimentalDataGapContextV1,
  type ExperimentalDataGapContextV1,
} from "@/model/physiology-v7/experimental-data-gap-context-v1";

/**
 * Isolated experimental/shadow cessation-detraining transition.
 * Never an input to TDEE, production physiology, forecast, or GREEN contracts.
 */
export async function recordExperimentalCessationDetrainingShadow(input: {
  date: string;
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  const [smShadow, priorCessation, priorSm] = await Promise.all([
    prisma.experimentalSkeletalMuscleDeltaShadow.findUnique({
      where: { profileId_date: { profileId, date: input.date } },
      select: { result: true },
    }),
    prisma.experimentalCessationDetrainingShadow.findFirst({
      where: { profileId, date: { lt: input.date } },
      orderBy: { date: "desc" },
      select: { result: true },
    }),
    prisma.experimentalSkeletalMuscleDeltaShadow.findFirst({
      where: { profileId, date: { lt: input.date } },
      orderBy: { date: "desc" },
      select: { result: true },
    }),
  ]);

  const sm = smShadow?.result as {
    features?: { trainingExposureKind?: ExperimentalTrainingExposureKindV1 };
    estimatedSkeletalMuscleDeltaKg?: number | null;
    state?: { relativeCumulativeDeltaKg?: number | null };
  } | null;

  const exposureKind = sm?.features?.trainingExposureKind;
  if (
    exposureKind !== "qualified-mapped-training"
    && exposureKind !== "verified-no-exposure"
    && exposureKind !== "unresolved-missing-training"
  ) {
    return;
  }

  const priorSmCumulative = (
    priorSm?.result as { state?: { relativeCumulativeDeltaKg?: number | null } } | null
  )?.state?.relativeCumulativeDeltaKg;

  const priorState = (priorCessation?.result as { state?: ExperimentalCessationStateV1 } | null)?.state
    ?? initialExperimentalCessationStateV1(
      typeof priorSmCumulative === "number" ? priorSmCumulative : 0,
    );
  const priorGapContext = (priorCessation?.result as { gapContext?: ExperimentalDataGapContextV1 } | null)?.gapContext ?? null;

  const trainingDelta = exposureKind === "qualified-mapped-training"
    ? (sm?.estimatedSkeletalMuscleDeltaKg ?? 0)
    : null;

  const transition = transitionExperimentalCessationDetrainingV1({
    exposureKind,
    prior: priorState,
    trainingSkeletalMuscleDeltaKg: trainingDelta,
  });
  const gapContext = transitionExperimentalDataGapContextV1({
    date: input.date,
    sources: {
      training: exposureKind === "unresolved-missing-training" ? "unresolved" : "observed",
    },
    prior: priorGapContext,
  });
  const result = { ...transition, gapContext };
  const sourceFingerprint = stableSha256(result);
  await prisma.experimentalCessationDetrainingShadow.upsert({
    where: { profileId_date: { profileId, date: input.date } },
    create: {
      profileId,
      date: input.date,
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
      features: { ...result.features, gapContext },
      result,
    },
    update: {
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
      features: { ...result.features, gapContext },
      result,
    },
  });
}

export async function recordExperimentalCessationDetrainingShadowForSession(input: {
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
  await recordExperimentalCessationDetrainingShadow({
    date,
    profileId: input.profileId,
  });
}

/**
 * Replays the one authoritative relative-muscle trajectory in calendar order.
 * A historical diary correction therefore replaces every dependent suffix,
 * rather than leaving a mixed training-only/cessation history behind.
 */
export async function rebuildAuthoritativeRelativeMuscleTrajectory(input: {
  fromDate: string;
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  const last = await prisma.dailyHealthData.findFirst({
    where: { date: { gte: input.fromDate } }, orderBy: { date: "desc" }, select: { date: true },
  });
  if (last === null) return;
  for (let date = input.fromDate; date <= last.date; date = addCalendarDays(date, 1)) {
    await recordExperimentalSkeletalMuscleDeltaShadow({ date, profileId });
    await recordExperimentalCessationDetrainingShadow({ date, profileId });
  }
}
