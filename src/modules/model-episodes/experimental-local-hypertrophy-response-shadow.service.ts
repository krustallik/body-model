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
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { episodeTimeContextForInstantV1 } from "./episode-time-context-v1";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { TrainingRepository } from "@/modules/training/training.repository";
import { persistUnifiedShadowCandidateV1, readUnifiedSourceFenceV1 } from "./physiology-v7-persistence.repository";

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
  const sourceFence = await readUnifiedSourceFenceV1(prisma, profileId);
  const weekStartDate = utcMondayWeekStart(input.date);
  const weekEndDate = addCalendarDays(weekStartDate, 6);
  const dates = enumerateCalendarDates(weekStartDate, weekEndDate);
  const trainingRepo = new TrainingRepository(prisma);

  const [healthDays, sessionRows, workouts] = await Promise.all([
    prisma.dailyHealthData.findMany({
      where: { date: { in: dates } },
      select: { date: true, workoutFeedObserved: true },
      orderBy: { date: "asc" },
    }),
    prisma.strengthDiarySession.findMany({
      where: {
        profileId,
        status: "COMPLETED",
        OR: [
          { matchedWorkout: { dailyHealthData: { date: { in: dates } } } },
          {
            matchedWorkoutId: null,
            OR: [
              { effectiveAccountingAt: { gte: new Date(`${addCalendarDays(weekStartDate, -2)}T00:00:00.000Z`), lt: new Date(`${addCalendarDays(weekEndDate, 3)}T00:00:00.000Z`) } },
              { effectiveAccountingAt: null, webStartedAt: { gte: new Date(`${addCalendarDays(weekStartDate, -2)}T00:00:00.000Z`), lt: new Date(`${addCalendarDays(weekEndDate, 3)}T00:00:00.000Z`) } },
              { effectiveAccountingAt: null, webStartedAt: null, createdAt: { gte: new Date(`${addCalendarDays(weekStartDate, -2)}T00:00:00.000Z`), lt: new Date(`${addCalendarDays(weekEndDate, 3)}T00:00:00.000Z`) } },
            ],
          },
        ],
      },
      select: {
        id: true,
        effectiveAccountingAt: true,
        accountingTimeZone: true,
        webStartedAt: true,
        createdAt: true,
        matchedWorkout: { select: { id: true, startAt: true, dailyHealthData: { select: { date: true } } } },
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
  const episodes = await prisma.modelEpisode.findMany({
    where: { profileId },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { startDate: true, timezone: true, active: true },
  });

  const healthByDate = new Map(healthDays.map((day) => [day.date, day] as const));
  const sourceDays = dates.map((date) => ({
    date,
    workoutFeedObserved: healthByDate.get(date)?.workoutFeedObserved ?? null,
  }));

  const sessions = [];
  for (const row of sessionRows) {
    const session = await trainingRepo.getSession(row.id, profileId);
    if (session === null) continue;
    const eventAt = row.matchedWorkout?.startAt
      ?? row.effectiveAccountingAt
      ?? row.webStartedAt
      ?? row.createdAt;
    const localDate = episodeTimeContextForInstantV1(episodes, eventAt, row.accountingTimeZone ?? DEFAULT_TIME_ZONE).date;
    if (!dates.includes(localDate)) continue;
    sessions.push({
      localDate,
      strengthDiarySessionId: session.id,
      sessionRevision: session.revision,
      occurrenceStartAt: session.webStartedAt,
      matchedWorkoutId: session.matchedWorkoutId,
      program: session.programId === null
        || session.programVersionId === null
        || session.programVersionNumber === null
        ? null
        : {
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
  await persistUnifiedShadowCandidateV1({
    client: prisma,
    profileId,
    expectedFence: sourceFence,
    persist: async (tx) => {
      const currentDays = await tx.dailyHealthData.findMany({
        where: { date: { in: dates } },
        select: { date: true, workoutFeedObserved: true },
        orderBy: { date: "asc" },
      });
      const currentToken = currentDays.map((day) => [day.date, day.workoutFeedObserved]);
      const computedToken = healthDays.map((day) => [day.date, day.workoutFeedObserved]);
      if (JSON.stringify(currentToken) !== JSON.stringify(computedToken)) {
        throw new Error("local hypertrophy health coverage changed before persistence");
      }
      await tx.experimentalLocalHypertrophyResponseShadow.upsert({
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
      return true;
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
