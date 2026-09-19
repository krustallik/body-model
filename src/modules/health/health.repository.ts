import { prepareDailyMeasurementsForWrite } from "@/modules/days/measurement-policy";
import { resolveWorkoutFeedObserved } from "@/modules/health/workout-feed-coverage";
import { planDayWorkoutReconciliation } from "@/modules/health/reconcile-day-workouts";
import { offsetMinutesFromIso } from "@/modules/health/sleep-summary";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { instantToLocalDateTime } from "@/model/time-zone";
import type {
  HealthDayInput,
  HealthRetentionPruneResult,
  HealthSyncMetadata,
  SyncDateResult,
  WorkoutInput,
} from "./health.types";

/** Persist only workouts whose startAt falls on the synced calendar day. */
export function filterWorkoutsForSyncedDay(
  workouts: readonly WorkoutInput[],
  dayDate: string,
  timezone: string,
): WorkoutInput[] {
  return workouts.filter((workout) => {
    const start = new Date(workout.startAt);
    if (!Number.isFinite(start.getTime())) return false;
    return instantToLocalDateTime(start, timezone).date === dayDate;
  });
}

export interface HealthSyncRepository {
  syncDay(day: HealthDayInput, rawDay: unknown, metadata: HealthSyncMetadata): Promise<SyncDateResult>;
  pruneOlderThan(cutoffDate: string): Promise<HealthRetentionPruneResult>;
}

function jsonValue(day: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(day)) as Prisma.InputJsonValue;
}

function optionalUpdate<T>(value: T | null | undefined): T | null | undefined {
  return value === undefined ? undefined : value;
}

type ActivityMetric = "steps" | "walking-distance-km";

function activityRows(
  metric: ActivityMetric,
  series: { starts: string[]; ends: string[]; values: number[] } | undefined,
  timezone: string,
) {
  return (series?.values ?? []).map((value, index) => {
    const startAt = new Date(series!.starts[index]!);
    const endAt = new Date(series!.ends[index]!);
    return {
      date: instantToLocalDateTime(startAt, timezone).date,
      metric,
      startAt,
      endAt,
      value,
      sourceFingerprint: `${metric}|${startAt.toISOString()}|${endAt.toISOString()}|${value}`,
    };
  });
}

async function persistActivityIntervals(
  transaction: Prisma.TransactionClient,
  day: HealthDayInput,
  timezone: string,
): Promise<void> {
  const rows = [
    ...activityRows("steps", day.stepIntervals, timezone),
    ...activityRows("walking-distance-km", day.walkingDistanceIntervals, timezone),
  ];
  if (rows.length === 0) return;

  await transaction.healthActivityInterval.createMany({ data: rows, skipDuplicates: true });
  const dates = [...new Set(rows.map(({ date }) => date))];
  for (const date of dates) {
    const [steps, distance] = await Promise.all([
      transaction.healthActivityInterval.aggregate({
        where: { date, metric: "steps" }, _sum: { value: true },
      }),
      transaction.healthActivityInterval.aggregate({
        where: { date, metric: "walking-distance-km" }, _sum: { value: true },
      }),
    ]);
    const stepTotal = steps._sum.value === null ? undefined : steps._sum.value.toNumber();
    const distanceTotal = distance._sum.value === null ? undefined : distance._sum.value;
    await transaction.dailyHealthData.upsert({
      where: { date },
      create: {
        date,
        steps: stepTotal === undefined ? null : Math.round(stepTotal),
        walkingDistanceKm: distanceTotal ?? null,
        rawPayload: {},
      },
      update: {
        ...(stepTotal === undefined ? {} : { steps: Math.round(stepTotal) }),
        ...(distanceTotal === undefined ? {} : { walkingDistanceKm: distanceTotal }),
      },
    });
  }
}

function sampleRows(
  dailyHealthDataId: number,
  _date: string,
  samples: { timestamps: string[]; bpm: number[] } | undefined,
) {
  return (samples?.timestamps ?? []).map((timestamp, index) => ({
    dailyHealthDataId: timestamp.slice(0, 10) === _date ? dailyHealthDataId : null,
    date: timestamp.slice(0, 10),
    timestamp: new Date(timestamp),
    bpm: samples!.bpm[index]!,
    source: "shortcut",
  }));
}

async function reconcileDayWorkouts(
  transaction: Prisma.TransactionClient,
  dailyHealthDataId: number,
  incoming: readonly WorkoutInput[],
): Promise<void> {
  const existing = await transaction.workout.findMany({
    where: { dailyHealthDataId },
    select: {
      id: true,
      sourceIdentity: true,
      externalId: true,
      type: true,
      startAt: true,
      endAt: true,
      matchedDiarySession: { select: { id: true } },
    },
  });

  const plan = planDayWorkoutReconciliation(
    existing.map((row) => ({
      id: row.id,
      sourceIdentity: row.sourceIdentity,
      externalId: row.externalId,
      type: row.type,
      startAt: row.startAt,
      endAt: row.endAt,
      linkedToDiary: row.matchedDiarySession !== null,
    })),
    incoming,
  );

  for (const update of plan.updates) {
    await transaction.workout.update({
      where: { id: update.id },
      data: {
        externalId: update.fields.externalId,
        sourceIdentity: update.fields.sourceIdentity,
        type: update.fields.type,
        startAt: update.fields.startAt,
        endAt: update.fields.endAt,
        durationMinutes: update.fields.durationMinutes,
        energyKcal: update.fields.energyKcal,
        activeEnergyKcal: update.fields.activeEnergyKcal,
      },
    });
  }

  if (plan.creates.length > 0) {
    await transaction.workout.createMany({
      data: plan.creates.map((fields) => ({
        dailyHealthDataId,
        externalId: fields.externalId,
        sourceIdentity: fields.sourceIdentity,
        type: fields.type,
        startAt: fields.startAt,
        endAt: fields.endAt,
        durationMinutes: fields.durationMinutes,
        energyKcal: fields.energyKcal,
        activeEnergyKcal: fields.activeEnergyKcal,
      })),
    });
  }

  if (plan.deletes.length > 0) {
    await transaction.workout.deleteMany({
      where: { id: { in: plan.deletes } },
    });
  }
}

export class PrismaHealthSyncRepository implements HealthSyncRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async syncDay(
    day: HealthDayInput,
    rawDay: unknown = day,
    metadata: HealthSyncMetadata = {
      timezone: "Europe/Bratislava",
      receivedAt: new Date(),
      syncedAt: null,
    },
  ): Promise<SyncDateResult> {
    day = prepareDailyMeasurementsForWrite(day);
    // Coverage is decided from the raw sync observation for THIS calendar day only.
    const workoutFeedObserved = resolveWorkoutFeedObserved(rawDay);
    // Latest state, immutable snapshot, and workout reconciliation are one atomic sync.
    return this.client.$transaction(async (transaction) => {
      const existing = await transaction.dailyHealthData.findUnique({
        where: { date: day.date },
        select: { date: true },
      });

      const daily = await transaction.dailyHealthData.upsert({
        where: { date: day.date },
        create: {
          date: day.date,
          weightKg: day.weightKg ?? null,
          bodyFatPercent: day.bodyFatPercent ?? null,
          caloriesKcal: day.caloriesKcal ?? null,
          proteinG: day.proteinG ?? null,
          fatG: day.fatG ?? null,
          carbsG: day.carbsG ?? null,
          steps: day.steps ?? null,
          activeEnergyKcal: day.activeEnergyKcal ?? null,
          averageWalkingSpeedKmh: day.averageWalkingSpeedKmh ?? null,
          walkingDistanceKm: day.walkingDistanceKm ?? null,
          strengthTrainingMinutes: day.strengthTrainingMinutes ?? null,
          workoutFeedObserved,
          rawPayload: jsonValue(rawDay),
        },
        update: {
          weightKg: optionalUpdate(day.weightKg),
          bodyFatPercent: optionalUpdate(day.bodyFatPercent),
          caloriesKcal: optionalUpdate(day.caloriesKcal),
          proteinG: optionalUpdate(day.proteinG),
          fatG: optionalUpdate(day.fatG),
          carbsG: optionalUpdate(day.carbsG),
          steps: optionalUpdate(day.steps),
          activeEnergyKcal: optionalUpdate(day.activeEnergyKcal),
          averageWalkingSpeedKmh: optionalUpdate(day.averageWalkingSpeedKmh),
          walkingDistanceKm: optionalUpdate(day.walkingDistanceKm),
          strengthTrainingMinutes: optionalUpdate(day.strengthTrainingMinutes),
          workoutFeedObserved,
          rawPayload: jsonValue(rawDay),
        },
        select: { id: true },
      });

      await transaction.healthSyncSnapshot.create({
        data: {
          dailyHealthDataId: daily.id,
          date: day.date,
          receivedAt: metadata.receivedAt,
          syncedAt: metadata.syncedAt ? new Date(metadata.syncedAt) : null,
          timezone: metadata.timezone,
          weightKg: day.weightKg ?? null,
          bodyFatPercent: day.bodyFatPercent ?? null,
          caloriesKcal: day.caloriesKcal ?? null,
          proteinG: day.proteinG ?? null,
          fatG: day.fatG ?? null,
          carbsG: day.carbsG ?? null,
          steps: day.steps ?? null,
          activeEnergyKcal: day.activeEnergyKcal ?? null,
          averageWalkingSpeedKmh: day.averageWalkingSpeedKmh ?? null,
          walkingDistanceKm: day.walkingDistanceKm ?? null,
          strengthTrainingMinutes: day.strengthTrainingMinutes ?? null,
          rawPayload: jsonValue(rawDay),
        },
      });

      await persistActivityIntervals(transaction, day, metadata.timezone);

      const workouts = filterWorkoutsForSyncedDay(
        day.workouts ?? [],
        day.date,
        metadata.timezone,
      );
      await reconcileDayWorkouts(transaction, daily.id, workouts);

      const heartRateSamples = sampleRows(daily.id, day.date, day.bpm);
      if (heartRateSamples.length > 0) {
        await transaction.heartRateSample.createMany({ data: heartRateSamples, skipDuplicates: true });
      }
      const restingHeartRateSamples = (day.bpminpeace?.timestamps ?? []).map((timestamp, index) => ({
        dailyHealthDataId: timestamp.slice(0, 10) === day.date ? daily.id : null,
        date: timestamp.slice(0, 10),
        timestamp: new Date(timestamp),
        bpm: day.bpminpeace!.bpminpeace[index]!,
        source: "shortcut",
      }));
      if (restingHeartRateSamples.length > 0) {
        await transaction.restingHeartRateSample.createMany({ data: restingHeartRateSamples, skipDuplicates: true });
      }

      const sleepSegments = (day.sleepSegments ?? []).map((segment) => ({
        startAt: new Date(segment.startAt),
        endAt: new Date(segment.endAt),
        startOffsetMinutes: offsetMinutesFromIso(segment.startAt),
        endOffsetMinutes: offsetMinutesFromIso(segment.endAt),
        state: segment.state,
        rawState: segment.rawState,
        source: "shortcut",
      }));
      if (sleepSegments.length > 0) {
        const sleepClient = transaction as unknown as {
          sleepSegment?: { createMany(args: unknown): Promise<unknown> };
        };
        if (sleepClient.sleepSegment) {
          await sleepClient.sleepSegment.createMany({ data: sleepSegments, skipDuplicates: true });
        }
      }

      return { date: day.date, action: existing ? "updated" : "created" };
    });
  }

  /**
   * Legacy retention hook invoked after sync.
   *
   * Durable canonical sources (DailyHealthData, Workout, HealthSyncSnapshot, HealthActivityInterval,
   * HR, resting HR, SleepSegment, WorkInterval, training diary tables) are
   * never deleted here — snapshots are required for identical work-walk /
   * stair-overlap rebuild.
   */
  async pruneOlderThan(cutoffDate: string): Promise<HealthRetentionPruneResult> {
    return {
      cutoffDate,
      deletedDays: 0,
      deletedSnapshots: 0,
    };
  }
}

export const healthSyncRepository = new PrismaHealthSyncRepository();
