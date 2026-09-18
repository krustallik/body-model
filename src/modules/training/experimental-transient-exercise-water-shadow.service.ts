import { prisma } from "@/lib/db/prisma";
import {
  estimateExperimentalTransientExerciseWaterV1,
  EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_REVISION,
  experimentalTransientExerciseWaterV1Fingerprint,
  type ExperimentalExposureContextV1,
} from "@/model/physiology-v7/experimental-transient-exercise-water-v1";
import { buildQualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import type { StrengthSessionDto } from "./training.types";
import { TrainingRepository } from "./training.repository";

/**
 * ENGINEERING exposure-context prior for V1 shadow only.
 * ≥2 other completed sessions in the prior 14 days → accustomed domain;
 * otherwise novel-or-unknown. Affects resolution horizon only — not amplitude.
 */
const EXPOSURE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const ACCUSTOMED_PRIOR_SESSION_FLOOR = 2;

async function resolveExposureContext(input: {
  session: StrengthSessionDto;
  profileId: number;
}): Promise<Exclude<ExperimentalExposureContextV1, "unavailable">> {
  const anchor = input.session.matchedWorkout?.startAt
    ?? input.session.webStartedAt
    ?? input.session.createdAt;
  const anchorMs = Date.parse(anchor);
  if (!Number.isFinite(anchorMs)) return "novel-or-unknown";
  const priorCount = await prisma.strengthDiarySession.count({
    where: {
      profileId: input.profileId,
      status: "COMPLETED",
      id: { not: input.session.id },
      OR: [
        {
          matchedWorkout: {
            startAt: {
              gte: new Date(anchorMs - EXPOSURE_LOOKBACK_MS),
              lt: new Date(anchorMs),
            },
          },
        },
        {
          matchedWorkoutId: null,
          webStartedAt: {
            gte: new Date(anchorMs - EXPOSURE_LOOKBACK_MS),
            lt: new Date(anchorMs),
          },
        },
        {
          matchedWorkoutId: null,
          webStartedAt: null,
          createdAt: {
            gte: new Date(anchorMs - EXPOSURE_LOOKBACK_MS),
            lt: new Date(anchorMs),
          },
        },
      ],
    },
  });
  return priorCount >= ACCUSTOMED_PRIOR_SESSION_FLOOR
    ? "accustomed"
    : "novel-or-unknown";
}

/**
 * Isolated experimental/shadow output for resistance transient water.
 * Never an input to TDEE, production physiology, forecast, or GREEN contracts.
 */
export async function recordExperimentalTransientExerciseWaterShadow(input: {
  session: StrengthSessionDto;
  profileId: number;
}): Promise<void> {
  const dose = buildQualifiedResistanceTrainingDoseV7(
    buildCanonicalStrengthTrainingInputV7({
      session: input.session,
      heartRateSamples: null,
    }),
  );
  const latestV7 = await prisma.physiologyV7DailyResult.findFirst({
    where: { profileId: input.profileId },
    orderBy: { date: "desc" },
    select: { result: true },
  });
  const compartments = (
    latestV7?.result as {
      resultingState?: {
        compartments?: {
          transientExerciseWaterKg?: { availability?: string; valueKg?: number | null };
          skeletalMuscleKg?: { availability?: string; valueKg?: number | null };
        };
      };
    } | null
  )?.resultingState?.compartments;
  const priorTransient = compartments?.transientExerciseWaterKg;
  const priorSm = compartments?.skeletalMuscleKg;
  const exposureContext = await resolveExposureContext(input);
  const result = estimateExperimentalTransientExerciseWaterV1({
    priorTransientWaterKg: priorTransient?.availability === "available"
      && typeof priorTransient.valueKg === "number"
      ? priorTransient.valueKg
      : 0,
    daysElapsed: 0,
    resistanceSession: dose.availability === "available"
      ? {
        qualifiedHardSetCount: dose.qualifiedHardSetCount,
        exposureContext,
      }
      : null,
    skeletalMuscleKg: priorSm?.availability === "available"
      && typeof priorSm.valueKg === "number"
      ? priorSm.valueKg
      : null,
  });
  const sourceFingerprint = experimentalTransientExerciseWaterV1Fingerprint(result);
  await prisma.experimentalTransientExerciseWaterShadow.upsert({
    where: { sessionId: input.session.id },
    create: {
      sessionId: input.session.id,
      profileId: input.profileId,
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_REVISION,
      features: result.features,
      result,
    },
    update: {
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_REVISION,
      features: result.features,
      result,
    },
  });
}

export async function recordExperimentalTransientExerciseWaterShadowBySessionId(input: {
  sessionId: number;
  profileId: number;
}): Promise<void> {
  const session = await new TrainingRepository(prisma).getSession(input.sessionId, input.profileId);
  if (session !== null) {
    await recordExperimentalTransientExerciseWaterShadow({
      session,
      profileId: input.profileId,
    });
  }
}
