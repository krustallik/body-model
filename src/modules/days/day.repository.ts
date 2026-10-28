import { randomUUID } from "node:crypto";
import { normalizeDailyMeasurements, prepareDailyMeasurementsForWrite } from "@/modules/days/measurement-policy";
import { summarizeDayWorkouts } from "@/modules/days/day-workout-presentation";
import { TrainingDayFactRepository } from "@/modules/days/training-day-fact.repository";
import type { TrainingDayFact } from "@/modules/days/training-day-fact";
import { emptyTrainingDayFact } from "@/modules/days/training-day-fact-empty";
import { MANUAL_HISTORY_SOURCE_PREFIX, workoutFingerprint } from "@/modules/health/workout-source-identity";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { SleepRepository } from "@/modules/health/sleep.repository";
import { recordExperimentalGlycogenStateShadow } from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import { rebuildAuthoritativeRelativeMuscleTrajectory } from "@/modules/model-episodes/experimental-cessation-detraining-shadow.service";
import { recordExperimentalStepperActiveEnergyShadowsForMassWindow } from "@/modules/profile/experimental-stepper-active-energy-shadow.service";
import { recordExperimentalStepperGlycogenDemandShadowsForLocalDate } from "@/modules/profile/experimental-stepper-glycogen-demand-shadow.service";
import { recordExperimentalStrengthShadowsForWeightDate } from "@/modules/training/training.service";
import { publishActiveEnergyChangesV1 } from "@/modules/activity/active-energy-publication";
import type { ActiveEnergyPublicationStatusV1 } from "@/modules/activity/active-energy-publication";
import { logEvent } from "@/lib/logger";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import {
  invalidateStepperMassDependenciesInTransactionV1,
  invalidateWorkoutEnergyInTransactionV1,
} from "@/modules/activity/active-energy-invalidation";
import { DuplicateDayError, DuplicateWorkoutError } from "./day.errors";
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
import { requireProfileId } from "@/modules/profile/profile-scope";

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
      syncProtected: true,
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
  replayFrom(profileId: number, date: string, options?: {
    weightSourceChanged?: boolean;
    affectedWorkoutIds?: readonly number[];
  }): Promise<ActiveEnergyPublicationStatusV1>;
};

export async function replayProductionDailyMetricShadowsV1(
  profileId: number,
  date: string,
  lifecycle = new PhysiologyV7PersistenceRepository(),
  options: { weightSourceChanged?: boolean; affectedWorkoutIds?: readonly number[] } = {},
): Promise<ActiveEnergyPublicationStatusV1> {
  const blockToken = await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "day", sourceKey: date });
  let affectedSessionIds: number[] = [];
  const affectedWorkoutIds = new Set(options.affectedWorkoutIds ?? []);
  try {
    if (options.weightSourceChanged === true) {
      for (const workoutId of await recordExperimentalStepperActiveEnergyShadowsForMassWindow({ profileId, measurementDates: [date] })) {
        affectedWorkoutIds.add(workoutId);
      }
      affectedSessionIds = await recordExperimentalStrengthShadowsForWeightDate({
        profileId,
        date,
        refreshHistoricalAsOfFallback: true,
      });
    }
    await recordExperimentalStepperGlycogenDemandShadowsForLocalDate({ profileId, date });
    await recordExperimentalGlycogenStateShadow({ profileId, date });
    await rebuildAuthoritativeRelativeMuscleTrajectory({ profileId, fromDate: date });
  } catch (error) {
    await lifecycle.blockUnifiedPublication({ profileId, fromDate: date, source: "day", sourceKey: date });
    throw error;
  }
  // Only a failed dependency refresh keeps the durable blocker. A later
  // production/publication failure is retryable with these dependencies
  // already current and must not create an un-clearable day blocker.
  if (blockToken !== null && !await lifecycle.clearUnifiedPublicationBlock({
    profileId, source: "day", sourceKey: date, expectedRevision: blockToken.revision,
    expectedFromDate: blockToken.fromDate,
  })) {
    throw new Error("daily source changed during dependent-shadow refresh; Unified remains blocked");
  }
  try {
    if (await lifecycle.hasUnifiedPublicationBlocks(profileId)) return "stale";
  } catch (error) {
    // The source row may already be gone (notably after DELETE). If the
    // post-clear blocker read fails, restore this operation's durable retry
    // handle before returning stale. The profile lock and upsert preserve an
    // earlier boundary or a concurrent newer fence.
    try {
      await lifecycle.blockUnifiedPublication({
        profileId,
        fromDate: blockToken?.fromDate ?? date,
        source: "day",
        sourceKey: date,
      });
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Could not read Unified publication blocks or restore the daily retry fence.",
      );
    }
    throw error;
  }
  try {
    const hasCompleteCandidateScope = options.affectedWorkoutIds !== undefined;
    if (await publishActiveEnergyChangesV1({
      profileId,
      ...(hasCompleteCandidateScope ? { activeEnergyCandidateScope: {
        strengthSessionIds: affectedSessionIds,
        workoutIds: [...affectedWorkoutIds].sort((left, right) => left - right),
      } } : {}),
    })) return "current";
  } catch (error) {
    let anotherBlockRemains: boolean | null = null;
    try {
      anotherBlockRemains = await lifecycle.hasUnifiedPublicationBlocks(profileId);
    } catch {
      // Unknown blocker state is not evidence that another source owns a
      // retry handle. Preserve this committed day mutation's retry fence.
    }
    if (anotherBlockRemains !== true) {
      try {
        await restoreDailyPublicationRetryFenceV1(lifecycle, profileId, date, blockToken);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "Active Energy publication failed and the daily retry fence could not be restored.",
        );
      }
    }
    throw error;
  }
  let anotherBlockRemains: boolean;
  try {
    anotherBlockRemains = await lifecycle.hasUnifiedPublicationBlocks(profileId);
  } catch (error) {
    try {
      await restoreDailyPublicationRetryFenceV1(lifecycle, profileId, date, blockToken);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Could not read Unified publication blocks or restore the daily retry fence.",
      );
    }
    throw error;
  }
  if (anotherBlockRemains) return "stale";
  // The source and its dependent shadows are durable, but a failed final
  // publication must keep an exact retry fence for operations such as DELETE
  // whose source row no longer exists.
  await restoreDailyPublicationRetryFenceV1(lifecycle, profileId, date, blockToken);
  return "stale";
}

async function restoreDailyPublicationRetryFenceV1(
  lifecycle: Pick<PhysiologyV7PersistenceRepository, "blockUnifiedPublication">,
  profileId: number,
  date: string,
  blockToken: { revision: number; fromDate: string } | null,
): Promise<void> {
  await lifecycle.blockUnifiedPublication({
    profileId,
    fromDate: blockToken?.fromDate ?? date,
    source: "day",
    sourceKey: date,
  });
}

const productionShadowReplayer: DailyMetricShadowReplayer = {
  replayFrom: (profileId, date, options) => replayProductionDailyMetricShadowsV1(profileId, date, undefined, options),
};

function workoutCreateData(workouts: NonNullable<CreateDailyMetricInput["workouts"]>, profileId: number) {
  const unique = new Map<string, {
    profileId: number;
    type: string;
    startAt: Date;
    endAt: Date;
    durationMinutes: number;
    activeEnergyKcal: number | null;
    sourceIdentity: string;
    syncProtected: boolean;
  }>();
  for (const workout of workouts) {
    const startAt = new Date(workout.startAt);
    const endAt = new Date(startAt.getTime() + workout.durationMinutes * 60_000);
    const fields = {
      profileId,
      type: workout.type,
      startAt,
      endAt,
      durationMinutes: workout.durationMinutes,
      activeEnergyKcal: workout.activeEnergyKcal ?? null,
      sourceIdentity: `${MANUAL_HISTORY_SOURCE_PREFIX}${randomUUID()}`,
      syncProtected: true,
    };
    unique.set(workoutFingerprint(fields), fields);
  }
  return [...unique.values()];
}

function sameEditableWorkoutInputs(
  existing: { type: string; startAt: Date; endAt: Date; durationMinutes: number | null; activeEnergyKcal: number | null },
  submitted: { type: string; startAt: Date; endAt: Date; durationMinutes: number; activeEnergyKcal: number | null },
): boolean {
  return existing.type === submitted.type
    && existing.startAt.getTime() === submitted.startAt.getTime()
    && existing.endAt.getTime() === submitted.endAt.getTime()
    && existing.durationMinutes === submitted.durationMinutes
    && existing.activeEnergyKcal === submitted.activeEnergyKcal;
}

function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function sameStoredMetricValue(current: unknown, next: unknown): boolean {
  if (next === undefined) return true;
  if (current === null || current === undefined || next === null) return current === next;
  if (typeof current === "number") return current === next;
  return typeof current === "object" && current !== null
    && "equals" in current && typeof current.equals === "function"
    && current.equals(next);
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
    syncProtected: event.syncProtected,
    manualEditable: event.manualEditable,
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
  private readonly profileId: number;
  private readonly shadowReplayer: DailyMetricShadowReplayer | null;

  constructor(
    profileId: number,
    private readonly client: PrismaClient = prisma,
    shadowReplayer?: DailyMetricShadowReplayer | null,
  ) {
    this.profileId = requireProfileId(profileId);
    this.shadowReplayer = shadowReplayer === undefined ? client === prisma ? productionShadowReplayer : null : shadowReplayer;
    this.trainingFacts = new TrainingDayFactRepository(this.profileId, client);
  }

  private async replayAndReadPublicationStatus(
    date: string,
    options: { weightSourceChanged?: boolean; affectedWorkoutIds?: readonly number[] } = {},
  ): Promise<ActiveEnergyPublicationStatusV1> {
    if (this.shadowReplayer === null) return "not-run";
    try {
      return await this.shadowReplayer.replayFrom(this.profileId, date, options);
    } catch (error) {
      logEvent("warn", "daily_metric_publication_failed_after_source_write", {
        date,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return "stale";
    }
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
        profileId: this.profileId,
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
        ? readClient.heartRateSample.findMany({ where: { profileId: this.profileId, date: { in: dates } }, select: { date: true, timestamp: true, bpm: true }, orderBy: { timestamp: "asc" } })
        : Promise.resolve([] as Array<{ date: string; timestamp: Date; bpm: number }>),
      readClient.restingHeartRateSample
        ? readClient.restingHeartRateSample.findMany({ where: { profileId: this.profileId, date: { in: dates } }, select: { date: true, timestamp: true, bpm: true }, orderBy: { timestamp: "asc" } })
        : Promise.resolve([] as Array<{ date: string; timestamp: Date; bpm: number }>),
      new SleepRepository(this.profileId, this.client).summariesByDates(dates),
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
      where: { profileId: this.profileId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    return record?.updatedAt.toISOString() ?? null;
  }

  async latestRestingHeartRate(): Promise<{ latestBpm: number | null; timestamp: string | null }> {
    const sample = await this.client.restingHeartRateSample.findFirst({
      where: { profileId: this.profileId },
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
      where: { profileId: this.profileId, date },
      select: { timestamp: true, bpm: true },
      orderBy: { timestamp: "asc" },
    });
    return heartRateSummary(samples);
  }

  async create(input: CreateDailyMetricInput): Promise<DailyMetricDto> {
    try {
      const { workouts, ...metrics } = input;
      const record = await this.client.$transaction(async (tx) => {
        const lifecycle = new PhysiologyV7PersistenceRepository(tx);
        await lifecycle.lockProfile(this.profileId);
        await lifecycle.blockUnifiedPublication({ profileId: this.profileId, fromDate: metrics.date, source: "day", sourceKey: metrics.date });
        const created = await tx.dailyHealthData.create({
          data: {
            profileId: this.profileId,
            ...prepareDailyMeasurementsForWrite(metrics),
            ...(workouts !== undefined ? {
              workouts: { create: workoutCreateData(workouts, this.profileId).map(({ profileId, ...workout }) => {
                void profileId;
                return workout;
              }) },
              strengthTrainingMinutes: null,
              activeEnergyKcal: null,
            } : {}),
            rawPayload: { source: "manual" },
          },
          select: dailyMetricSelect,
        });
        await invalidateWorkoutEnergyInTransactionV1({
          tx, profileId: this.profileId,
          workoutIds: created.workouts.map((workout) => workout.id),
          affectedInstants: created.workouts.flatMap((workout) => [workout.startAt, workout.endAt]),
          affectedModelDates: [created.date],
          staleMatchingAliasesOnly: true,
        });
        if (created.weightKg !== null) {
          await invalidateStepperMassDependenciesInTransactionV1({
            tx, profileId: this.profileId, measurementDates: [created.date],
          });
        }
        return created;
      });
      const modelPublicationStatus = await this.replayAndReadPublicationStatus(record.date, {
        weightSourceChanged: record.weightKg !== null,
        affectedWorkoutIds: record.workouts.map(({ id }) => id),
      });
      return { ...(await this.dtoForRecord(record)), modelPublicationStatus };
    } catch (error) {
      if (isPrismaError(error, "P2002")) throw new DuplicateDayError();
      throw error;
    }
  }

  async update(date: string, input: UpdateDailyMetricInput): Promise<DailyMetricDto | null> {
    try {
      const { workouts, ...metrics } = input;
      const outcome = await this.client.$transaction(async (tx) => {
        const lifecycle = new PhysiologyV7PersistenceRepository(tx);
        await lifecycle.lockProfile(this.profileId);
        const before = await tx.dailyHealthData.findUniqueOrThrow({
          where: { profileId_date: { profileId: this.profileId, date } },
          select: { id: true, weightKg: true, bodyFatPercent: true, caloriesKcal: true, proteinG: true, fatG: true, carbsG: true, steps: true, activeEnergyKcal: true, averageWalkingSpeedKmh: true, walkingDistanceKm: true, strengthTrainingMinutes: true, workoutFeedObserved: true, workouts: { where: { hiddenFromHistory: false }, select: { id: true, externalId: true, type: true, startAt: true, endAt: true, durationMinutes: true, activeEnergyKcal: true, sourceIdentity: true, syncProtected: true, matchedDiarySession: { select: { id: true } } } } },
        });
        const metricData = prepareDailyMeasurementsForWrite(metrics);
        const changedMetricData = { ...metricData };
        for (const field of Object.keys(changedMetricData) as Array<keyof typeof changedMetricData>) {
          if (sameStoredMetricValue(before[field], changedMetricData[field])) delete changedMetricData[field];
        }
        let workoutSourceChanged = false;
        const affectedWorkoutIds = new Set<number>();
        const affectedWorkoutRows: Array<{ id: number; startAt: Date; endAt: Date }> = [];
        const workoutUpdates: Array<{ id: number; data: ReturnType<typeof workoutCreateData>[number] & { sourceIdentity: string } }> = [];
        const workoutCreates: Array<ReturnType<typeof workoutCreateData>[number]> = [];
        let removedManualIds: number[] = [];
        if (workouts !== undefined) {
          const isHistoryManaged = (workout: typeof before.workouts[number]) => (
            !workout.matchedDiarySession && (
              workout.sourceIdentity.startsWith(MANUAL_HISTORY_SOURCE_PREFIX)
            )
          );
          const existingManual = before.workouts.filter(isHistoryManaged);
          const protectedFingerprints = new Set(before.workouts
            .filter((workout) => !isHistoryManaged(workout))
            .map((workout) => workoutFingerprint({ type: workout.type, startAt: workout.startAt, endAt: workout.endAt })));
          const retainedManualIds = new Set<number>();
          const seenFingerprints = new Set<string>();
          for (const workout of workouts) {
            const fields = workoutCreateData([workout], this.profileId)[0]!;
            const fingerprint = workoutFingerprint({ type: fields.type, startAt: fields.startAt, endAt: fields.endAt });
            if (seenFingerprints.has(fingerprint)) continue;
            seenFingerprints.add(fingerprint);
            const submittedId = "id" in workout ? workout.id : undefined;
            if (submittedId !== undefined) {
              const existing = existingManual.find((candidate) => candidate.id === submittedId);
              if (!existing) throw new Error("workout edit id is not a manual workout for this day");
              if (protectedFingerprints.has(fingerprint)) throw new DuplicateWorkoutError();
              if (!sameEditableWorkoutInputs(existing, fields)) {
                workoutUpdates.push({ id: existing.id, data: { ...fields, sourceIdentity: existing.sourceIdentity } });
                affectedWorkoutIds.add(existing.id);
                affectedWorkoutRows.push({ id: existing.id, startAt: existing.startAt, endAt: existing.endAt });
                affectedWorkoutRows.push({ id: existing.id, startAt: fields.startAt, endAt: fields.endAt });
              }
              retainedManualIds.add(submittedId);
              continue;
            }
            const matchingManual = existingManual.find((candidate) => !retainedManualIds.has(candidate.id)
              && (candidate.sourceIdentity === fields.sourceIdentity
                || workoutFingerprint({ type: candidate.type, startAt: candidate.startAt, endAt: candidate.endAt }) === fingerprint));
            if (matchingManual) {
              if (protectedFingerprints.has(fingerprint)) throw new DuplicateWorkoutError();
              if (!sameEditableWorkoutInputs(matchingManual, fields)) {
                workoutUpdates.push({ id: matchingManual.id, data: { ...fields, sourceIdentity: matchingManual.sourceIdentity } });
                affectedWorkoutIds.add(matchingManual.id);
                affectedWorkoutRows.push({ id: matchingManual.id, startAt: matchingManual.startAt, endAt: matchingManual.endAt });
                affectedWorkoutRows.push({ id: matchingManual.id, startAt: fields.startAt, endAt: fields.endAt });
              }
              retainedManualIds.add(matchingManual.id);
              continue;
            }
            // Older clients submitted every displayed workout. Preserve the synced row
            // and do not clone it into a manual row when its exact identity is present.
            if (protectedFingerprints.has(fingerprint)) continue;
            workoutCreates.push(fields);
          }
          removedManualIds = existingManual.filter((workout) => !retainedManualIds.has(workout.id)).map(({ id }) => id);
          if (removedManualIds.length > 0) {
            const removed = existingManual.filter(({ id }) => removedManualIds.includes(id));
            for (const workout of removed) {
              affectedWorkoutIds.add(workout.id);
              affectedWorkoutRows.push({ id: workout.id, startAt: workout.startAt, endAt: workout.endAt });
            }
          }
          workoutSourceChanged = workoutUpdates.length > 0 || workoutCreates.length > 0 || removedManualIds.length > 0;
        }
        const hasMetricChanges = Object.keys(changedMetricData).length > 0;
        if (!hasMetricChanges && !workoutSourceChanged) {
          const hasPendingPublication = (await lifecycle.readUnifiedPublicationBlockToken({
            profileId: this.profileId, source: "day", sourceKey: date,
          })) !== null;
          return {
            record: await tx.dailyHealthData.findUniqueOrThrow({ where: { profileId_id: { profileId: this.profileId, id: before.id } }, select: dailyMetricSelect }),
            shouldReplay: hasPendingPublication,
            weightSourceChanged: hasPendingPublication,
            // The durable fence does not retain affected IDs, so retry with
            // the existing full candidate fallback when a prior replay failed.
            affectedWorkoutIds: hasPendingPublication ? undefined : [] as number[],
          };
        }

        await lifecycle.blockUnifiedPublication({ profileId: this.profileId, fromDate: date, source: "day", sourceKey: date });
        for (const update of workoutUpdates) {
          await tx.workout.update({ where: { profileId_id: { profileId: this.profileId, id: update.id } }, data: update.data });
        }
        for (const data of workoutCreates) {
          const created = await tx.workout.create({
            data: { ...data, profileId: this.profileId, dailyHealthDataId: before.id },
            select: { id: true },
          });
          affectedWorkoutIds.add(created.id);
          affectedWorkoutRows.push({ id: created.id, startAt: data.startAt, endAt: data.endAt });
        }
        if (removedManualIds.length > 0) {
          await tx.workout.deleteMany({ where: { profileId: this.profileId, id: { in: removedManualIds }, hiddenFromHistory: false } });
        }
        const updated = await tx.dailyHealthData.update({
          where: { profileId_id: { profileId: this.profileId, id: before.id } },
          data: {
            ...changedMetricData,
            ...(workoutSourceChanged ? { strengthTrainingMinutes: null, activeEnergyKcal: null } : {}),
          },
          select: dailyMetricSelect,
        });
        const weightSourceChanged = !sameStoredMetricValue(before.weightKg, updated.weightKg);
        if (workoutSourceChanged) {
          await invalidateWorkoutEnergyInTransactionV1({
            tx, profileId: this.profileId,
            workoutIds: [...affectedWorkoutIds],
            affectedInstants: affectedWorkoutRows.flatMap((workout) => [workout.startAt, workout.endAt]),
            affectedModelDates: [date],
            staleMatchingAliasesOnly: true,
          });
        }
        if (weightSourceChanged) {
          await invalidateStepperMassDependenciesInTransactionV1({
            tx, profileId: this.profileId, measurementDates: [date],
          });
        }
        const record = workouts === undefined
          ? updated
          : await tx.dailyHealthData.findUniqueOrThrow({
            where: { profileId_id: { profileId: this.profileId, id: before.id } },
            select: dailyMetricSelect,
          });
        return { record, shouldReplay: true, weightSourceChanged, affectedWorkoutIds: [...affectedWorkoutIds] };
      });
      if (!outcome.shouldReplay) return this.dtoForRecord(outcome.record);
      const modelPublicationStatus = await this.replayAndReadPublicationStatus(date, {
        weightSourceChanged: outcome.weightSourceChanged,
        affectedWorkoutIds: outcome.affectedWorkoutIds,
      });
      return { ...(await this.dtoForRecord(outcome.record)), modelPublicationStatus };
    } catch (error) {
      if (isPrismaError(error, "P2025")) return null;
      throw error;
    }
  }

  async delete(date: string): Promise<{ deleted: boolean; modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
    // Explicit application delete: remove workouts first so Restrict FK cannot
    // leave orphan intent — accidental raw day deletes without this path fail.
    const outcome = await this.client.$transaction(async (transaction) => {
      const lifecycle = new PhysiologyV7PersistenceRepository(transaction);
      await lifecycle.lockProfile(this.profileId);
      const day = await transaction.dailyHealthData.findUnique({
        where: { profileId_date: { profileId: this.profileId, date } },
        select: { id: true, weightKg: true, workouts: { where: { hiddenFromHistory: false }, select: { id: true, startAt: true, endAt: true } } },
      });
      if (!day) {
        const token = await lifecycle.readUnifiedPublicationBlockToken({ profileId: this.profileId, source: "day", sourceKey: date });
        // A prior DELETE may have committed the raw removal and failed during
        // derived refresh. Retrying the same idempotent DELETE repairs that
        // durable block without recreating the source row.
        // The durable day fence does not retain whether the committed delete
        // removed a weight. Re-run weight-dependent shadows conservatively so
        // a failed first attempt cannot publish candidates using the old mass.
        return { deleted: token !== null, needsPublication: token !== null, weightSourceChanged: token !== null, affectedWorkoutIds: undefined };
      }
      const weightSampleCount = await transaction.healthMetricSample.count({
        where: { profileId: this.profileId, date, metric: "weight-kg", source: "apple-health-shortcut" },
      });
      await lifecycle.blockUnifiedPublication({ profileId: this.profileId, fromDate: date, source: "day", sourceKey: date });
      await invalidateWorkoutEnergyInTransactionV1({
        tx: transaction, profileId: this.profileId,
        workoutIds: day.workouts.map((workout) => workout.id),
        affectedInstants: day.workouts.flatMap((workout) => [workout.startAt, workout.endAt]),
        affectedModelDates: [date],
        staleMatchingAliasesOnly: true,
      });
      if (day.weightKg !== null) {
        await invalidateStepperMassDependenciesInTransactionV1({
          tx: transaction, profileId: this.profileId, measurementDates: [date],
        });
      }
      await transaction.workout.deleteMany({ where: { profileId: this.profileId, dailyHealthDataId: day.id } });
      // Keep immutable sync evidence and detach only its optional daily-row pointer.
      await transaction.healthSyncSnapshot.updateMany({
        where: { profileId: this.profileId, dailyHealthDataId: day.id },
        data: { dailyHealthDataId: null },
      });
      // Keep immutable Health observations while detaching their optional
      // daily projection pointer. The tenant-scoped composite FKs are RESTRICT.
      await transaction.healthMetricSample.updateMany({
        where: { profileId: this.profileId, dailyHealthDataId: day.id },
        data: { dailyHealthDataId: null },
      });
      await transaction.heartRateSample.updateMany({
        where: { profileId: this.profileId, dailyHealthDataId: day.id },
        data: { dailyHealthDataId: null },
      });
      await transaction.restingHeartRateSample.updateMany({
        where: { profileId: this.profileId, dailyHealthDataId: day.id },
        data: { dailyHealthDataId: null },
      });
      await transaction.dailyHealthData.delete({ where: { profileId_id: { profileId: this.profileId, id: day.id } } });
      return {
        deleted: true,
        needsPublication: true,
        weightSourceChanged: day.weightKg !== null || weightSampleCount > 0,
        affectedWorkoutIds: day.workouts.map(({ id }) => id),
      };
    });
    if (!outcome.needsPublication) return { deleted: false };
    return {
      deleted: true,
      modelPublicationStatus: await this.replayAndReadPublicationStatus(date, {
        weightSourceChanged: outcome.weightSourceChanged,
        ...(outcome.affectedWorkoutIds === undefined ? {} : { affectedWorkoutIds: outcome.affectedWorkoutIds }),
      }),
    };
  }
}
