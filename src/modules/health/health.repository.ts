import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { HealthDayInput, SyncDateResult } from "./health.types";

export interface HealthSyncRepository {
  syncBatch(days: HealthDayInput[]): Promise<SyncDateResult[]>;
}

function jsonValue(day: HealthDayInput): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(day)) as Prisma.InputJsonValue;
}

function optionalUpdate<T>(value: T | null | undefined): T | null | undefined {
  return value === undefined ? undefined : value;
}

export class PrismaHealthSyncRepository implements HealthSyncRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async syncBatch(days: HealthDayInput[]): Promise<SyncDateResult[]> {
    // A single transaction makes the complete 1–7 day batch atomic, including workout replacement.
    return this.client.$transaction(async (transaction) => {
      const existing = await transaction.dailyHealthData.findMany({
        where: { date: { in: days.map((day) => day.date) } },
        select: { date: true },
      });
      const existingDates = new Set(existing.map(({ date }) => date));
      const results: SyncDateResult[] = [];

      for (const day of days) {
        const daily = await transaction.dailyHealthData.upsert({
          where: { date: day.date },
          create: {
            date: day.date,
            weightKg: day.weightKg ?? null,
            caloriesKcal: day.caloriesKcal ?? null,
            proteinG: day.proteinG ?? null,
            fatG: day.fatG ?? null,
            carbsG: day.carbsG ?? null,
            steps: day.steps ?? null,
            activeEnergyKcal: day.activeEnergyKcal ?? null,
            rawPayload: jsonValue(day),
          },
          update: {
            weightKg: optionalUpdate(day.weightKg),
            caloriesKcal: optionalUpdate(day.caloriesKcal),
            proteinG: optionalUpdate(day.proteinG),
            fatG: optionalUpdate(day.fatG),
            carbsG: optionalUpdate(day.carbsG),
            steps: optionalUpdate(day.steps),
            activeEnergyKcal: optionalUpdate(day.activeEnergyKcal),
            rawPayload: jsonValue(day),
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

        results.push({
          date: day.date,
          action: existingDates.has(day.date) ? "updated" : "created",
        });
      }

      return results;
    });
  }
}

export const healthSyncRepository = new PrismaHealthSyncRepository();
