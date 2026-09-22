import { normalizeDailyMeasurements, prepareDailyMeasurementsForWrite } from "@/modules/days/measurement-policy";
import { summarizeDayWorkouts } from "@/modules/days/day-workout-presentation";
import { workoutSourceIdentity } from "@/modules/health/workout-source-identity";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { SleepRepository } from "@/modules/health/sleep.repository";
import { recordExperimentalGlycogenStateShadow } from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import { rebuildAuthoritativeRelativeMuscleTrajectory } from "@/modules/model-episodes/experimental-cessation-detraining-shadow.service";
import { DuplicateDayError } from "./day.errors";
import type {
  CreateDailyMetricInput,
  DailyMetricListQuery,
  UpdateDailyMetricInput,
} from "./day.schema";
import type { DailyMetricDto, NightlySleepSummaryDto } from "./day.types";

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
  workoutFeedObserved: true,
  updatedAt: true,
  workouts: {
    select: {
      id: true,
      type: true,
      startAt: true,
      endAt: true,
      durationMinutes: true,
      activeEnergyKcal: true,
      matchedDiarySession: {
        select: {
          id: true,
          program: { select: { name: true } },
        },
      },
    },
    orderBy: { startAt: "asc" as const },
  },
  heartRateSamples: { select: { timestamp: true, bpm: true }, orderBy: { timestamp: "asc" as const } },
  restingHeartRateSamples: { select: { timestamp: true, bpm: true }, orderBy: { timestamp: "asc" as const } },
} satisfies Prisma.DailyHealthDataSelect;

type DailyMetricRecord = Prisma.DailyHealthDataGetPayload<{ select: typeof dailyMetricSelect }>;

type DailyMetricShadowReplayer = {
  replayFrom(date: string): Promise<void>;
};

const productionShadowReplayer: DailyMetricShadowReplayer = {
  async replayFrom(date) {
    await recordExperimentalGlycogenStateShadow({ date });
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: date });
  },
};

type DiaryShadowWorkout = {
  type: "Traditional Strength Training";
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  activeEnergyKcal: number | null;
  energySource: "shadow-diary-estimate" | "unavailable";
  diaryOnly: true;
  matchedDiarySession: { id: number; program: { name: string } };
};

function shadowResolutionKcal(result: unknown): number | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return null;
  const resolution = (result as { activeEnergyResolution?: unknown }).activeEnergyResolution;
  if (typeof resolution !== "object" || resolution === null || Array.isArray(resolution)) return null;
  const value = (resolution as { estimatedActiveKcal?: unknown }).estimatedActiveKcal;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function workoutCreateData(workouts: NonNullable<CreateDailyMetricInput["workouts"]>) {
  return workouts.map((workout) => {
    const startAt = new Date(workout.startAt);
    const endAt = new Date(startAt.getTime() + workout.durationMinutes * 60_000);
    return {
      type: workout.type,
      startAt,
      endAt,
      durationMinutes: workout.durationMinutes,
      activeEnergyKcal: workout.activeEnergyKcal ?? null,
      sourceIdentity: workoutSourceIdentity({
        type: workout.type,
        startAt,
        endAt,
      }),
    };
  });
}

function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function heartRateSummary(samples: Array<{ timestamp: Date; bpm: number }> | undefined) {
  const observedSamples = samples ?? [];
  const values = observedSamples.map(({ bpm }) => bpm);
  const latest = observedSamples.at(-1) ?? null;
  return {
    sampleCount: observedSamples.length,
    minBpm: values.length ? Math.min(...values) : null,
    maxBpm: values.length ? Math.max(...values) : null,
    avgBpm: values.length ? values.reduce((sum, bpm) => sum + bpm, 0) / values.length : null,
    latestBpm: latest?.bpm ?? null,
    latestTimestamp: latest?.timestamp.toISOString() ?? null,
    samples: observedSamples.map((sample) => ({ timestamp: sample.timestamp.toISOString(), bpm: sample.bpm })),
  };
}

function toDto(
  record: DailyMetricRecord,
  samples?: {
    heartRate: Array<{ timestamp: Date; bpm: number }>;
    restingHeartRate: Array<{ timestamp: Date; bpm: number }>;
  },
  sleep?: NightlySleepSummaryDto | null,
  diaryShadowWorkouts: readonly DiaryShadowWorkout[] = [],
): DailyMetricDto {
  record = normalizeDailyMeasurements(record);
  const strengthTrainingMinutes = decimalToNumber(record.strengthTrainingMinutes);
  const summary = summarizeDayWorkouts({
    workouts: [...(record.workouts ?? []), ...diaryShadowWorkouts],
    legacyStrengthTrainingMinutes: strengthTrainingMinutes,
  });
  const restingHeartRate = heartRateSummary(samples?.restingHeartRate ?? record.restingHeartRateSamples);
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
    workoutFeedObserved: record.workoutFeedObserved ?? null,
    heartRate: heartRateSummary(samples?.heartRate ?? record.heartRateSamples),
    restingHeartRate,
    restingHeartRateBpm: restingHeartRate.latestBpm,
    sleepMinutes: sleep?.totalSleepMinutes ?? null,
    sleep: sleep ?? null,
  };
}

function isPrismaError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export class DailyMetricRepository {
  constructor(
    private readonly client: PrismaClient = prisma,
    private readonly shadowReplayer: DailyMetricShadowReplayer | null = client === prisma
      ? productionShadowReplayer
      : null,
  ) {}

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

    const dates = records.map(({ date }) => date);
    const readClient = this.client as unknown as {
      heartRateSample?: { findMany(args: unknown): Promise<Array<{ date: string; timestamp: Date; bpm: number }>> };
      restingHeartRateSample?: { findMany(args: unknown): Promise<Array<{ date: string; timestamp: Date; bpm: number }>> };
      strengthDiarySession?: {
        findMany(args: unknown): Promise<Array<{
          id: number;
          webStartedAt: Date | null;
          webEndedAt: Date | null;
          program: { name: string };
          experimentalStrengthEnergyShadow: { result: unknown } | null;
        }>>;
      };
    };
    if (dates.length === 0) {
      return records.map((record) => toDto(record));
    }

    const [heartRateRows, restingRows, sleepByDate, diarySessions] = await Promise.all([
      readClient.heartRateSample
        ? readClient.heartRateSample.findMany({ where: { date: { in: dates } }, select: { date: true, timestamp: true, bpm: true }, orderBy: { timestamp: "asc" } })
        : Promise.resolve([] as Array<{ date: string; timestamp: Date; bpm: number }>),
      readClient.restingHeartRateSample
        ? readClient.restingHeartRateSample.findMany({ where: { date: { in: dates } }, select: { date: true, timestamp: true, bpm: true }, orderBy: { timestamp: "asc" } })
        : Promise.resolve([] as Array<{ date: string; timestamp: Date; bpm: number }>),
      new SleepRepository(this.client).summariesByDates(dates),
      readClient.strengthDiarySession
        ? readClient.strengthDiarySession.findMany({
          where: {
            status: "COMPLETED",
            matchedWorkoutId: null,
            webStartedAt: { not: null },
            webEndedAt: { not: null },
          },
          select: {
            id: true,
            webStartedAt: true,
            webEndedAt: true,
            program: { select: { name: true } },
            experimentalStrengthEnergyShadow: { select: { result: true } },
          },
        })
        : Promise.resolve([] as Array<{
          id: number;
          webStartedAt: Date | null;
          webEndedAt: Date | null;
          program: { name: string };
          experimentalStrengthEnergyShadow: { result: unknown } | null;
        }>),
    ]);
    const group = (rows: Array<{ date: string; timestamp: Date; bpm: number }>) => rows.reduce<Map<string, Array<{ timestamp: Date; bpm: number }>>>((result, row) => {
      result.set(row.date, [...(result.get(row.date) ?? []), { timestamp: row.timestamp, bpm: row.bpm }]);
      return result;
    }, new Map());
    const heartRate = group(heartRateRows);
    const restingHeartRate = group(restingRows);
    const diaryShadowByDate = new Map<string, DiaryShadowWorkout[]>();
    for (const session of diarySessions) {
      if (session.webStartedAt === null || session.webEndedAt === null || !(session.webEndedAt > session.webStartedAt)) continue;
      const date = instantToLocalDateTime(session.webStartedAt, DEFAULT_TIME_ZONE).date;
      if (!dates.includes(date)) continue;
      const kcal = shadowResolutionKcal(session.experimentalStrengthEnergyShadow?.result);
      const event: DiaryShadowWorkout = {
        type: "Traditional Strength Training",
        startAt: session.webStartedAt,
        endAt: session.webEndedAt,
        durationMinutes: (session.webEndedAt.getTime() - session.webStartedAt.getTime()) / 60_000,
        activeEnergyKcal: kcal,
        energySource: kcal === null ? "unavailable" : "shadow-diary-estimate",
        diaryOnly: true,
        matchedDiarySession: { id: session.id, program: session.program },
      };
      diaryShadowByDate.set(date, [...(diaryShadowByDate.get(date) ?? []), event]);
    }
    return records.map((record) => toDto(
      record,
      { heartRate: heartRate.get(record.date) ?? [], restingHeartRate: restingHeartRate.get(record.date) ?? [] },
      sleepByDate.get(record.date) ?? null,
      diaryShadowByDate.get(record.date) ?? [],
    ));
  }

  async latestUpdatedAt(): Promise<string | null> {
    const record = await this.client.dailyHealthData.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    return record?.updatedAt.toISOString() ?? null;
  }

  async latestRestingHeartRate(): Promise<{ latestBpm: number | null; timestamp: string | null }> {
    const sample = await this.client.restingHeartRateSample.findFirst({
      orderBy: { timestamp: "desc" },
      select: { bpm: true, timestamp: true },
    });
    return { latestBpm: sample?.bpm ?? null, timestamp: sample?.timestamp.toISOString() ?? null };
  }

  async heartRateByDate(date: string): Promise<DailyMetricDto["heartRate"]> {
    const readClient = this.client as unknown as {
      heartRateSample?: { findMany(args: unknown): Promise<Array<{ timestamp: Date; bpm: number }>> };
    };
    if (!readClient.heartRateSample) {
      return heartRateSummary([]);
    }
    const samples = await readClient.heartRateSample.findMany({
      where: { date },
      select: { timestamp: true, bpm: true },
      orderBy: { timestamp: "asc" },
    });
    return heartRateSummary(samples);
  }

  async create(input: CreateDailyMetricInput): Promise<DailyMetricDto> {
    try {
      const { workouts, ...metrics } = input;
      const record = await this.client.dailyHealthData.create({
        data: {
          ...prepareDailyMeasurementsForWrite(metrics),
          ...(workouts !== undefined ? {
            workouts: { create: workoutCreateData(workouts) },
            strengthTrainingMinutes: null,
            activeEnergyKcal: null,
          } : {}),
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
      const { workouts, ...metrics } = input;
      const record = await this.client.dailyHealthData.update({
        where: { date },
        data: {
          ...prepareDailyMeasurementsForWrite(metrics),
          ...(workouts !== undefined ? {
            workouts: { deleteMany: {}, create: workoutCreateData(workouts) },
            strengthTrainingMinutes: null,
            activeEnergyKcal: null,
          } : {}),
        },
        select: dailyMetricSelect,
      });
      await this.shadowReplayer?.replayFrom(date);
      return toDto(record);
    } catch (error) {
      if (isPrismaError(error, "P2025")) return null;
      throw error;
    }
  }

  async delete(date: string): Promise<boolean> {
    // Explicit application delete: remove workouts first so Restrict FK cannot
    // leave orphan intent — accidental raw day deletes without this path fail.
    const deleted = await this.client.$transaction(async (transaction) => {
      const day = await transaction.dailyHealthData.findUnique({
        where: { date },
        select: { id: true },
      });
      if (!day) return false;
      await transaction.workout.deleteMany({ where: { dailyHealthDataId: day.id } });
      await transaction.dailyHealthData.delete({ where: { id: day.id } });
      return true;
    });
    if (deleted) await this.shadowReplayer?.replayFrom(date);
    return deleted;
  }
}

export const dailyMetricRepository = new DailyMetricRepository();
