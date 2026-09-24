import { prisma } from "@/lib/db/prisma";
import {
  estimateExperimentalLocalHypertrophyFromWeeklyAggregateV1,
  EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_REVISION,
  experimentalLocalHypertrophyResponseV1Fingerprint,
} from "@/model/physiology-v7/experimental-local-hypertrophy-response-v1";
import { buildQualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildResistanceTrainingExposureHistoryFromSourcesV7 } from "@/model/physiology-v7/resistance-training-exposure-history-sources-v7";
import { utcMondayWeekStart } from "@/model/physiology-v7/resistance-training-exposure-history-v7";
import { addCalendarDays, enumerateCalendarDates } from "@/modules/model-episodes/model-calendar";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { TrainingRepository } from "@/modules/training/training.repository";

/**
 * Isolated experimental/shadow weekly local hypertrophy response.
 * Never an input to TDEE, production physiology, forecast, or GREEN contracts.
 * Does not write skeletalMuscleKg or reuse whole-body SM delta.
 */
export async function recordExperimentalLocalHypertrophyResponseShadow(input: {
  date: string;
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  const weekStartDate = utcMondayWeekStart(input.date);
  const weekEndDate = addCalendarDays(weekStartDate, 6);
  const dates = enumerateCalendarDates(weekStartDate, weekEndDate);
  const trainingRepo = new TrainingRepository(prisma);

  const [healthDays, sessionRows, workouts] = await Promise.all([
    prisma.dailyHealthData.findMany({
      where: { date: { in: dates } },
      select: { date: true, workoutFeedObserved: true },
    }),
    prisma.strengthDiarySession.findMany({
      where: {
        profileId,
        status: "COMPLETED",
        matchedWorkout: { dailyHealthData: { date: { in: dates } } },
      },
      select: {
        id: true,
        matchedWorkout: { select: { id: true, dailyHealthData: { select: { date: true } } } },
      },
    }),
    prisma.workout.findMany({
      where: { hiddenFromHistory: false, dailyHealthData: { date: { in: dates } } },
      select: {
        id: true,
        type: true,
        dailyHealthData: { select: { date: true } },
        matchedDiarySession: { select: { id: true } },
      },
    }),
  ]);

  const healthByDate = new Map(healthDays.map((day) => [day.date, day] as const));
  const sourceDays = dates.map((date) => ({
    date,
    workoutFeedObserved: healthByDate.get(date)?.workoutFeedObserved ?? null,
  }));

  const sessions = [];
  for (const row of sessionRows) {
    const session = await trainingRepo.getSession(row.id, profileId);
    if (session === null) continue;
    const localDate = row.matchedWorkout?.dailyHealthData?.date;
    if (localDate == null) continue;
    sessions.push({
      localDate,
      strengthDiarySessionId: session.id,
      sessionRevision: session.revision,
      occurrenceStartAt: session.webStartedAt,
      matchedWorkoutId: session.matchedWorkoutId,
      program: {
        programId: session.programId,
        programVersionId: session.programVersionId,
        programVersionNumber: session.programVersionNumber,
      },
      dose: buildQualifiedResistanceTrainingDoseV7(
        buildCanonicalStrengthTrainingInputV7({ session, heartRateSamples: null }),
      ),
    });
  }

  const history = buildResistanceTrainingExposureHistoryFromSourcesV7({
    fromDate: weekStartDate,
    toDate: weekEndDate,
    days: sourceDays,
    strengthWorkouts: workouts.map((workout) => ({
      workoutId: workout.id,
      localDate: workout.dailyHealthData.date,
      type: workout.type,
      matchedStrengthDiarySessionId: workout.matchedDiarySession?.id ?? null,
    })),
    sessions,
  });
  const week = history.weeklyAggregates.find((row) => row.weekStartDate === weekStartDate);
  if (week === undefined) return;

  const result = estimateExperimentalLocalHypertrophyFromWeeklyAggregateV1(week);
  const sourceFingerprint = experimentalLocalHypertrophyResponseV1Fingerprint(result);
  await prisma.experimentalLocalHypertrophyResponseShadow.upsert({
    where: { profileId_weekStartDate: { profileId, weekStartDate } },
    create: {
      profileId,
      weekStartDate,
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_REVISION,
      features: result.features,
      result,
    },
    update: {
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_REVISION,
      features: result.features,
      result,
    },
  });
}

export async function recordExperimentalLocalHypertrophyResponseShadowForSession(input: {
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
  await recordExperimentalLocalHypertrophyResponseShadow({
    date,
    profileId: input.profileId,
  });
}
