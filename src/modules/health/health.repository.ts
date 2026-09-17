import { normalizeDailyMeasurements } from "@/modules/days/measurement-policy";
import { resolveWorkoutFeedObserved } from "@/modules/health/workout-feed-coverage";
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

function sampleRows(
  dailyHealthDataId: number,
  date: string,
  samples: { timestamps: string[]; bpm: number[] } | undefined,
) {
  return (samples?.timestamps ?? []).map((timestamp, index) => ({
    dailyHealthDataId,
    date,
    timestamp: new Date(timestamp),
    bpm: samples!.bpm[index]!,
    source: "shortcut",
  }));
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
    day = normalizeDailyMeasurements(day);
    // Coverage is decided from the raw sync observation for THIS calendar day only.
    const workoutFeedObserved = resolveWorkoutFeedObserved(rawDay);
    // Latest state, immutable snapshot, and workout replacement are one atomic sync.
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

      await transaction.workout.deleteMany({ where: { dailyHealthDataId: daily.id } });
      const workouts = filterWorkoutsForSyncedDay(
        day.workouts ?? [],
        day.date,
        metadata.timezone,
      );
      if (workouts.length > 0) {
        await transaction.workout.createMany({
          data: workouts.map((workout) => ({
            dailyHealthDataId: daily.id,
            externalId: workout.externalId ?? null,
            type: workout.type,
            startAt: new Date(workout.startAt),
            endAt: new Date(workout.endAt),
            durationMinutes: workout.durationMinutes ?? null,
            energyKcal: workout.energyKcal ?? null,
            activeEnergyKcal: workout.activeEnergyKcal ?? null,
          })),
        });
      }

      const heartRateSamples = sampleRows(daily.id, day.date, day.bpm);
      if (heartRateSamples.length > 0) {
        await transaction.heartRateSample.createMany({ data: heartRateSamples, skipDuplicates: true });
      }
      const restingHeartRateSamples = (day.bpminpeace?.timestamps ?? []).map((timestamp, index) => ({
        dailyHealthDataId: daily.id,
        date: day.date,
        timestamp: new Date(timestamp),
        bpm: day.bpminpeace!.bpminpeace[index]!,
        source: "shortcut",
      }));
      if (restingHeartRateSamples.length > 0) {
        await transaction.restingHeartRateSample.createMany({ data: restingHeartRateSamples, skipDuplicates: true });
      }

      return { date: day.date, action: existing ? "updated" : "created" };
    });
  }

  /**
   * Delete daily health rows (and cascaded workouts) plus sync snapshots older
   * than the retention cutoff calendar date.
   */
  async pruneOlderThan(cutoffDate: string): Promise<HealthRetentionPruneResult> {
    const [snapshots, days] = await this.client.$transaction([
      this.client.healthSyncSnapshot.deleteMany({ where: { date: { lt: cutoffDate } } }),
      this.client.dailyHealthData.deleteMany({ where: { date: { lt: cutoffDate } } }),
    ]);

    return {
      cutoffDate,
      deletedDays: days.count,
      deletedSnapshots: snapshots.count,
    };
  }
}

export const healthSyncRepository = new PrismaHealthSyncRepository();
