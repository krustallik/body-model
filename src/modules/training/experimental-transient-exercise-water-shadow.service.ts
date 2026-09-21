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
import { calendarDayIndex } from "@/modules/model-episodes/model-calendar";

/**
 * ENGINEERING exposure-context prior for V1 shadow only.
 * ≥2 other completed sessions in the prior 14 days → accustomed domain;
 * otherwise novel-or-unknown. Affects resolution horizon only — not amplitude.
 */
const EXPOSURE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const ACCUSTOMED_PRIOR_SESSION_FLOOR = 2;

function localSessionDate(session: StrengthSessionDto): string | null {
  const value = session.matchedWorkout?.startAt ?? session.webStartedAt ?? session.createdAt;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function transientWaterFromResult(result: unknown): number | null {
  const point = result && typeof result === "object"
    ? (result as { resultingTransientWaterKg?: { point?: number | null } }).resultingTransientWaterKg?.point
    : null;
  return typeof point === "number" && Number.isFinite(point) && point >= 0 ? point : null;
}

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
  const targetDate = localSessionDate(input.session);
  const dose = buildQualifiedResistanceTrainingDoseV7(
    buildCanonicalStrengthTrainingInputV7({
      session: input.session,
      heartRateSamples: null,
    }),
  );
  const [priorRows, exposureContext] = await Promise.all([
    prisma.experimentalTransientExerciseWaterShadow.findMany({
      where: { profileId: input.profileId, sessionId: { not: input.session.id } },
      select: {
        result: true,
        session: { select: { webStartedAt: true, createdAt: true, matchedWorkout: { select: { startAt: true } } } },
      },
    }),
    resolveExposureContext(input),
  ]);
  // Select a predecessor only as-of the target workout.  A later V7 row or
  // future diary session must never alter historical transient-water output.
  const predecessor = targetDate === null ? null : priorRows
    .map((row) => ({ row, date: row.session.matchedWorkout?.startAt ?? row.session.webStartedAt ?? row.session.createdAt }))
    .map(({ row, date }) => ({ row, date: date.toISOString().slice(0, 10) }))
    .filter((item) => item.date < targetDate)
    .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
  const priorTransient = transientWaterFromResult(predecessor?.row.result);
  const daysElapsed = predecessor === null || targetDate === null
    ? 0
    : Math.max(0, calendarDayIndex(targetDate) - calendarDayIndex(predecessor.date));
  const result = estimateExperimentalTransientExerciseWaterV1({
    priorTransientWaterKg: priorTransient ?? 0,
    daysElapsed,
    resistanceSession: dose.availability === "available"
      ? {
        qualifiedHardSetCount: dose.qualifiedHardSetCount,
        exposureContext,
      }
      : null,
    skeletalMuscleKg: null,
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
