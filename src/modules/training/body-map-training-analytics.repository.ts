import { prisma } from "@/lib/db/prisma";
import { SleepRepository } from "@/modules/health/sleep.repository";
import {
  buildBodyMapTrainingAnalyticsV1,
  type BodyMapAnalyticsSessionIntentV1,
  type BodyMapAnalyticsWeeksV1,
  type BodyMapTrainingAnalyticsResponseV1,
} from "@/modules/training/body-map-training-analytics-v1";

/** Read-only, profile-scoped projection over immutable session exercise snapshots and actual set rows. */
export async function readBodyMapTrainingAnalyticsV1(
  profileId: number,
  weeks: BodyMapAnalyticsWeeksV1,
  now = new Date(),
): Promise<BodyMapTrainingAnalyticsResponseV1> {
  const lookback = new Date(now.getTime() - 12 * 7 * 86_400_000);
  const rows = await prisma.strengthDiarySession.findMany({
    where: {
      profileId,
      status: "COMPLETED",
      OR: [
        { effectiveAccountingAt: { gte: lookback, lte: now } },
        { matchedWorkout: { is: { startAt: { gte: lookback, lte: now } } } },
        { webStartedAt: { gte: lookback, lte: now } },
        { createdAt: { gte: lookback, lte: now } },
      ],
    },
    select: {
      id: true,
      effectiveAccountingAt: true,
      matchedWorkout: { select: { startAt: true } },
      webStartedAt: true,
      createdAt: true,
      accountingTimeZone: true,
      sessionIntent: true,
      trainingBlockLabel: true,
      trainingWeekNumber: true,
      exercises: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          snapshotExerciseName: true,
          sortOrder: true,
          plannedSets: true,
          plannedRepsMin: true,
          plannedRepsMax: true,
          plannedRir: true,
          resistanceType: true,
          muscleMappingSnapshot: true,
          sourceExerciseCatalog: { select: { stableKey: true } },
          sets: {
            orderBy: { setNumber: "asc" },
            select: {
              id: true,
              setNumber: true,
              reps: true,
              weightKg: true,
              bandNominalResistanceKg: true,
              rir: true,
              restBeforeSeconds: true,
              completedAt: true,
            },
          },
        },
      },
    },
  });

  const analytics = buildBodyMapTrainingAnalyticsV1({
    weeks,
    now,
    sessions: rows.map((row) => ({
      id: row.id,
      effectiveAccountingAt: row.effectiveAccountingAt,
      matchedWorkout: row.matchedWorkout,
      webStartedAt: row.webStartedAt,
      createdAt: row.createdAt,
      accountingTimeZone: row.accountingTimeZone,
      sessionIntent: (row.sessionIntent as BodyMapAnalyticsSessionIntentV1 | null) ?? null,
      trainingBlockLabel: row.trainingBlockLabel,
      trainingWeekNumber: row.trainingWeekNumber,
      exercises: row.exercises.map((exercise) => ({
        id: exercise.id,
        snapshotExerciseName: exercise.snapshotExerciseName,
        sortOrder: exercise.sortOrder,
        plannedSets: exercise.plannedSets,
        plannedRepsMin: exercise.plannedRepsMin,
        plannedRepsMax: exercise.plannedRepsMax,
        plannedRir: exercise.plannedRir,
        resistanceType: exercise.resistanceType,
        muscleMappingSnapshot: exercise.muscleMappingSnapshot,
        sourceExerciseCatalog: exercise.sourceExerciseCatalog,
        sets: exercise.sets.map((set) => ({
          id: set.id,
          setNumber: set.setNumber,
          reps: set.reps,
          weightKg: set.weightKg?.toNumber() ?? null,
          bandNominalResistanceKg: set.bandNominalResistanceKg?.toNumber() ?? null,
          rir: set.rir,
          restBeforeSeconds: set.restBeforeSeconds,
          completedAt: set.completedAt,
        })),
      })),
    })),
  });

  const sessionById = new Map(rows.map((row) => [row.id, row]));
  const dateSet = [...new Set(analytics.sessions.map(({ sessionDate }) => sessionDate))];
  const [healthRows, sleepByDateAndZone] = await Promise.all([
    dateSet.length > 0
      ? prisma.dailyHealthData.findMany({
        where: { profileId, date: { in: dateSet } },
        select: { date: true, caloriesKcal: true, proteinG: true, updatedAt: true },
      })
      : Promise.resolve([]),
    (async () => {
      const datesByTimeZone = new Map<string, Set<string>>();
      for (const item of analytics.sessions) {
        const source = sessionById.get(item.id);
        const timeZone = source?.accountingTimeZone || "UTC";
        const dates = datesByTimeZone.get(timeZone) ?? new Set<string>();
        dates.add(item.sessionDate);
        datesByTimeZone.set(timeZone, dates);
      }
      const entries = await Promise.all([...datesByTimeZone.entries()].map(async ([timeZone, dates]) => {
        const summaries = await new SleepRepository(profileId).summariesByDates([...dates], timeZone);
        return [...summaries.entries()].map(([date, summary]) => [`${timeZone}|${date}`, summary] as const);
      }));
      return new Map(entries.flat());
    })(),
  ]);
  const healthByDate = new Map(healthRows.map((row) => [row.date, row]));
  const sessionContexts = analytics.sessions.map((item) => {
    const session = sessionById.get(item.id);
    const timeZone = session?.accountingTimeZone ?? null;
    const sleep = sleepByDateAndZone.get(`${timeZone || "UTC"}|${item.sessionDate}`);
    const health = healthByDate.get(item.sessionDate);
    const hasNutrition = health?.caloriesKcal != null || health?.proteinG != null;
    return {
      sessionId: item.id,
      sessionDate: item.sessionDate,
      timeZone,
      sleep: sleep ? {
        status: "recorded" as const,
        sleepDate: sleep.sleepDate,
        totalSleepMinutes: sleep.totalSleepMinutes,
        segmentCount: sleep.segmentCount,
        source: sleep.sources,
        dateAttribution: sleep.sleepDateAttribution,
      } : null,
      nutrition: {
        status: hasNutrition ? "recorded" as const : "unavailable" as const,
        date: item.sessionDate,
        caloriesKcal: health?.caloriesKcal ?? null,
        proteinG: health?.proteinG ?? null,
        source: hasNutrition ? "daily-health-record" as const : null,
        updatedAt: hasNutrition ? health!.updatedAt.toISOString() : null,
      },
    };
  });

  return { ...analytics, sessionContexts };
}
