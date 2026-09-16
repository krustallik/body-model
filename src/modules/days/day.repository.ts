import { normalizeDailyMeasurements } from "@/modules/days/measurement-policy";
import { summarizeDayWorkouts } from "@/modules/days/day-workout-presentation";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { DuplicateDayError } from "./day.errors";
import type {
  CreateDailyMetricInput,
  DailyMetricListQuery,
  UpdateDailyMetricInput,
} from "./day.schema";
import type { DailyMetricDto } from "./day.types";

const dailyMetricSelect = {
  date: true,
  weightKg: true,
  bodyFatPercent: true,
  caloriesKcal: true,
  proteinG: true,
  fatG: true,
  carbsG: true,
  steps: true,
  activeEnergyKcal: true,
  averageWalkingSpeedKmh: true,
  walkingDistanceKm: true,
  strengthTrainingMinutes: true,
  updatedAt: true,
  workouts: {
    select: {
      type: true,
      startAt: true,
      endAt: true,
      durationMinutes: true,
      activeEnergyKcal: true,
    },
    orderBy: { startAt: "asc" as const },
  },
} satisfies Prisma.DailyHealthDataSelect;

type DailyMetricRecord = Prisma.DailyHealthDataGetPayload<{ select: typeof dailyMetricSelect }>;

function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function toDto(record: DailyMetricRecord): DailyMetricDto {
  record = normalizeDailyMeasurements(record);
  const strengthTrainingMinutes = decimalToNumber(record.strengthTrainingMinutes);
  const summary = summarizeDayWorkouts({
    workouts: record.workouts ?? [],
    legacyStrengthTrainingMinutes: strengthTrainingMinutes,
  });
  return {
    date: record.date,
    weightKg: record.weightKg,
    bodyFatPercent: decimalToNumber(record.bodyFatPercent),
    caloriesKcal: record.caloriesKcal,
    proteinG: record.proteinG,
    fatG: record.fatG,
    carbsG: record.carbsG,
    steps: record.steps,
    activeEnergyKcal: record.activeEnergyKcal,
    averageWalkingSpeedKmh: decimalToNumber(record.averageWalkingSpeedKmh),
    walkingDistanceKm: decimalToNumber(record.walkingDistanceKm),
    strengthTrainingMinutes,
    updatedAt: record.updatedAt.toISOString(),
    workouts: summary.workouts,
    totalWorkoutMinutes: summary.totalWorkoutMinutes,
    workoutSource: summary.workoutSource,
  };
}

function isPrismaError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export class DailyMetricRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async list(query: DailyMetricListQuery): Promise<DailyMetricDto[]> {
    const records = await this.client.dailyHealthData.findMany({
      where: {
        date: {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        },
      },
      orderBy: { date: "desc" },
      take: query.limit,
      skip: query.offset,
      select: dailyMetricSelect,
    });

    return records.map(toDto);
  }

  async latestUpdatedAt(): Promise<string | null> {
    const record = await this.client.dailyHealthData.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    return record?.updatedAt.toISOString() ?? null;
  }

  async create(input: CreateDailyMetricInput): Promise<DailyMetricDto> {
    try {
      const record = await this.client.dailyHealthData.create({
        data: {
          ...normalizeDailyMeasurements(input),
          rawPayload: { source: "manual" },
        },
        select: dailyMetricSelect,
      });
      return toDto(record);
    } catch (error) {
      if (isPrismaError(error, "P2002")) throw new DuplicateDayError();
      throw error;
    }
  }

  async update(date: string, input: UpdateDailyMetricInput): Promise<DailyMetricDto | null> {
    try {
      const record = await this.client.dailyHealthData.update({
        where: { date },
        data: normalizeDailyMeasurements(input),
        select: dailyMetricSelect,
      });
      return toDto(record);
    } catch (error) {
      if (isPrismaError(error, "P2025")) return null;
      throw error;
    }
  }

  async delete(date: string): Promise<boolean> {
    const result = await this.client.dailyHealthData.deleteMany({ where: { date } });
    return result.count > 0;
  }
}

export const dailyMetricRepository = new DailyMetricRepository();
