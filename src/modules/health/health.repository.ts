import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { HealthDayInput, SyncDateResult } from "./health.types";

export interface HealthSyncRepository {
  syncDay(day: HealthDayInput, rawDay?: unknown): Promise<SyncDateResult>;
}

function jsonValue(day: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(day)) as Prisma.InputJsonValue;
}

function optionalUpdate<T>(value: T | null | undefined): T | null | undefined {
  return value === undefined ? undefined : value;
}

export class PrismaHealthSyncRepository implements HealthSyncRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async syncDay(day: HealthDayInput, rawDay: unknown = day): Promise<SyncDateResult> {
    // A transaction keeps today's daily record and its workout replacement atomic.
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
          rawPayload: jsonValue(rawDay),
        },
        select: { id: true },
      });

      await transaction.workout.deleteMany({ where: { dailyHealthDataId: daily.id } });
      const workouts = day.workouts ?? [];
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
          })),
        });
      }

      return { date: day.date, action: existing ? "updated" : "created" };
    });
  }
}

export const healthSyncRepository = new PrismaHealthSyncRepository();
