import { normalizeDailyMeasurements, prepareDailyMeasurementsForWrite } from "@/modules/days/measurement-policy";
import { summarizeDayWorkouts } from "@/modules/days/day-workout-presentation";
import { TrainingDayFactRepository } from "@/modules/days/training-day-fact.repository";
import { emptyTrainingDayFact, type TrainingDayFact } from "@/modules/days/training-day-fact";
import { workoutSourceIdentity } from "@/modules/health/workout-source-identity";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { SleepRepository } from "@/modules/health/sleep.repository";
import { recordExperimentalGlycogenStateShadow } from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import { rebuildAuthoritativeRelativeMuscleTrajectory } from "@/modules/model-episodes/experimental-cessation-detraining-shadow.service";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import { DuplicateDayError } from "./day.errors";
import {
  addCalendarDays,
  inclusiveCalendarDayCount,
  MAX_MATERIALIZED_TRAINING_DAY_RANGE_DAYS,
} from "./calendar-range";
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
    where: { hiddenFromHistory: false },
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
    const latest = await prisma.dailyHealthData.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
    if (latest !== null) await rebuildUnifiedExperimentalPhysiologyStateV1({ fromDate: date, toDate: latest.date });
  },
};

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

function rawWorkoutEvents(fact: TrainingDayFact) {
  return fact.events.map((event) => ({
    id: event.workoutId ?? undefined,
    type: event.type,
    startAt: new Date(event.occurrenceAt),
    endAt: event.endAt === null ? null : new Date(event.endAt),
    durationMinutes: event.durationMinutes,
    activeEnergyKcal: event.activeEnergyKcal,
    energySource: event.energySource,
    diaryOnly: event.diaryOnly,
    executionStatus: event.executionStatus,
    matchedDiarySession: event.diarySessionId === null ? null : {
      id: event.diarySessionId,
      program: event.diaryProgramName === null ? null : { name: event.diaryProgramName },
    },
    exerciseDetailAvailability: event.exerciseDetailAvailability,
    loggedSetCount: event.loggedSetCount,
  }));
}

function toDto(
  record: DailyMetricRecord,
  samples?: {
    heartRate: Array<{ timestamp: Date; bpm: number }>;
    restingHeartRate: Array<{ timestamp: Date; bpm: number }>;
  },
  sleep?: NightlySleepSummaryDto | null,
  trainingDayFact: TrainingDayFact = emptyTrainingDayFact(record.date),
): DailyMetricDto {
  record = normalizeDailyMeasurements(record);
  const strengthTrainingMinutes = decimalToNumber(record.strengthTrainingMinutes);
  const summary = summarizeDayWorkouts({
    workouts: rawWorkoutEvents(trainingDayFact),
    legacyStrengthTrainingMinutes: strengthTrainingMinutes,
    trainingDayFact,
  });
  const restingHeartRate = heartRateSummary(samples?.restingHeartRate ?? record.restingHeartRateSamples);
  return {
    date: record.date,
    hasHealthRecord: true,
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
    trainingDayFact,
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
  private readonly trainingFacts: TrainingDayFactRepository;

  constructor(
    private readonly client: PrismaClient = prisma,
    private readonly shadowReplayer: DailyMetricShadowReplayer | null = client === prisma
      ? productionShadowReplayer
      : null,
  ) {
    this.trainingFacts = new TrainingDayFactRepository(client);
  }

  async list(query: DailyMetricListQuery): Promise<DailyMetricDto[]> {
    return (await this.listWithTrainingFacts(query)).days;
  }

  async listWithTrainingFacts(query: DailyMetricListQuery): Promise<{
    days: DailyMetricDto[];
    trainingDays: TrainingDayFact[];
  }> {
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
    const pageDates = records.map(({ date }) => date).sort();
    const factsRange = query.includeTrainingDays === false && pageDates.length > 0
      ? { from: pageDates[0], to: pageDates.at(-1) }
      : { from: query.from, to: query.to };
    const eventFacts = query.includeTrainingDays === false && pageDates.length === 0
      ? []
      : await this.trainingFacts.list(factsRange);
    const factByDate = new Map(eventFacts.map((fact) => [fact.date, fact]));
    const trainingDaysByDate = new Map<string, TrainingDayFact>();
    if (query.includeTrainingDays !== false) {
      for (const fact of eventFacts) trainingDaysByDate.set(fact.date, fact);
      for (const date of dates) {
        if (!trainingDaysByDate.has(date)) trainingDaysByDate.set(date, emptyTrainingDayFact(date));
      }
      // Explicit calendar ranges return an explicit zero fact for every date.
      if (query.from && query.to) {
        for (let date = query.from; date <= query.to; date = addCalendarDays(date, 1)) {
          if (!trainingDaysByDate.has(date)) trainingDaysByDate.set(date, emptyTrainingDayFact(date));
        }
      }
    }
    const trainingDays = [...trainingDaysByDate.values()].sort((left, right) => right.date.localeCompare(left.date));

    const readClient = this.client as unknown as {
      heartRateSample?: { findMany(args: unknown): Promise<Array<{ date: string; timestamp: Date; bpm: number }>> };
      restingHeartRateSample?: { findMany(args: unknown): Promise<Array<{ date: string; timestamp: Date; bpm: number }>> };
    };
    if (dates.length === 0) {
      return { days: [], trainingDays };
    }

    const [heartRateRows, restingRows, sleepByDate] = await Promise.all([
      readClient.heartRateSample
        ? readClient.heartRateSample.findMany({ where: { date: { in: dates } }, select: { date: true, timestamp: true, bpm: true }, orderBy: { timestamp: "asc" } })
        : Promise.resolve([] as Array<{ date: string; timestamp: Date; bpm: number }>),
      readClient.restingHeartRateSample
        ? readClient.restingHeartRateSample.findMany({ where: { date: { in: dates } }, select: { date: true, timestamp: true, bpm: true }, orderBy: { timestamp: "asc" } })
        : Promise.resolve([] as Array<{ date: string; timestamp: Date; bpm: number }>),
      new SleepRepository(this.client).summariesByDates(dates),
    ]);
    const group = (rows: Array<{ date: string; timestamp: Date; bpm: number }>) => rows.reduce<Map<string, Array<{ timestamp: Date; bpm: number }>>>((result, row) => {
      result.set(row.date, [...(result.get(row.date) ?? []), { timestamp: row.timestamp, bpm: row.bpm }]);
      return result;
    }, new Map());
    const heartRate = group(heartRateRows);
    const restingHeartRate = group(restingRows);
    const days = records.map((record) => toDto(
      record,
      { heartRate: heartRate.get(record.date) ?? [], restingHeartRate: restingHeartRate.get(record.date) ?? [] },
      sleepByDate.get(record.date) ?? null,
      factByDate.get(record.date) ?? emptyTrainingDayFact(record.date),
    ));
    return { days, trainingDays };
  }

  async trainingDayFactForDate(date: string): Promise<TrainingDayFact> {
    return this.trainingFacts.forDate(date);
  }

  async trainingDayFactsForRange(from: string, to: string): Promise<TrainingDayFact[]> {
    const dayCount = inclusiveCalendarDayCount(from, to);
    if (dayCount === null || dayCount > MAX_MATERIALIZED_TRAINING_DAY_RANGE_DAYS) {
      throw new RangeError(`training-day fact ranges must not exceed ${MAX_MATERIALIZED_TRAINING_DAY_RANGE_DAYS} calendar days`);
    }
    const facts = new Map((await this.trainingFacts.list({ from, to })).map((fact) => [fact.date, fact]));
    const result: TrainingDayFact[] = [];
    for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
      result.push(facts.get(date) ?? emptyTrainingDayFact(date));
    }
    return result;
  }

  private async dtoForRecord(record: DailyMetricRecord): Promise<DailyMetricDto> {
    return toDto(record, undefined, null, await this.trainingFacts.forDate(record.date));
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
      return await this.dtoForRecord(record);
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
            workouts: { deleteMany: { hiddenFromHistory: false }, create: workoutCreateData(workouts) },
            strengthTrainingMinutes: null,
            activeEnergyKcal: null,
          } : {}),
        },
        select: dailyMetricSelect,
      });
      await this.shadowReplayer?.replayFrom(date);
      return await this.dtoForRecord(record);
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
