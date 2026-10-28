import { prepareDailyMeasurementsForWrite } from "@/modules/days/measurement-policy";
import {
  hasWorkoutFeedPayload,
  resolveWorkoutFeedObserved,
} from "@/modules/health/workout-feed-coverage";
import { planDayWorkoutReconciliation } from "@/modules/health/reconcile-day-workouts";
import { offsetMinutesFromIso } from "@/modules/health/sleep-summary";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { MANUAL_HISTORY_SOURCE_PREFIX, MANUAL_STEPPER_SOURCE_PREFIX, workoutFingerprint } from "@/modules/health/workout-source-identity";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { selectedHealthSyncStepSnapshotBracketV7 } from "@/model/activity/workout-stepper-v7";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logEvent } from "@/lib/logger";
import { instantToLocalDateTime } from "@/model/time-zone";
import { rebaseCurrentAccountingSnapshotTimestamp } from "@/modules/training/rebase-current-accounting-snapshot";
import { enqueueTrainingSourceChangeInTransaction } from "@/modules/training/training-refresh-queue";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import {
  invalidateStepperMassDependenciesInTransactionV1,
  invalidateWorkoutEnergyInTransactionV1,
} from "@/modules/activity/active-energy-invalidation";
import type {
  HealthDayInput,
  HealthMetricSampleInput,
  HealthRetentionPruneResult,
  HealthSyncMetadata,
  SyncDateResult,
  WorkoutInput,
} from "./health.types";

export const APPLE_HEALTH_SHORTCUT_SOURCE = "apple-health-shortcut" as const;

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
  readonly profileId: number;
  syncDay(
    day: HealthDayInput,
    rawDay: unknown,
    metadata: HealthSyncMetadata,
    metricSamples?: readonly HealthMetricSampleInput[],
  ): Promise<SyncDateResult>;
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
  profileId: number,
) {
  return (series?.values ?? []).flatMap((value, index) => {
    const startAt = new Date(series!.starts[index]!);
    const endAt = new Date(series!.ends[index]!);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) return [];
    return [{
      profileId,
      date: instantToLocalDateTime(startAt, timezone).date,
      metric,
      startAt,
      endAt,
      value,
      sourceFingerprint: `${metric}|${startAt.toISOString()}|${endAt.toISOString()}|${value}`,
    }];
  });
}

async function persistActivityIntervals(
  transaction: Prisma.TransactionClient,
  day: HealthDayInput,
  timezone: string,
  profileId: number,
): Promise<number[]> {
  const seriesByMetric: Array<{
    metric: ActivityMetric;
    series: { starts: string[]; ends: string[]; values: number[] } | undefined;
  }> = [
    { metric: "steps", series: day.stepIntervals },
    { metric: "walking-distance-km", series: day.walkingDistanceIntervals },
  ];

  const changedStepIntervals: Array<{ startAt: Date; endAt: Date }> = [];
  for (const { metric, series } of seriesByMetric) {
    if (series === undefined) continue;
    // A latest-N Shortcut dump can land in multiple generated daily records.
    // It is authoritative only for a calendar day that it actually contains;
    // an empty subset must never clear that day's historical total.
    const rows = activityRows(metric, series, timezone, profileId).filter((row) => row.date === day.date);
    if (rows.length === 0) continue;
    const existing = await transaction.healthActivityInterval.findMany({
      where: { profileId, date: day.date, metric },
      select: { startAt: true, endAt: true, value: true, sourceFingerprint: true },
      orderBy: [{ startAt: "asc" }, { endAt: "asc" }, { id: "asc" }],
    });
    const sortFingerprint = (rows: string[][]) => rows.sort((left, right) => left.join("|").localeCompare(right.join("|")));
    const existingFingerprint = sortFingerprint(existing.map((row) => [
      row.startAt.toISOString(), row.endAt.toISOString(), row.value.toString(), row.sourceFingerprint,
    ]));
    const nextFingerprint = sortFingerprint(rows.map((row) => [
      row.startAt.toISOString(), row.endAt.toISOString(), row.value.toString(), row.sourceFingerprint,
    ]));
    const intervalsUnchanged = JSON.stringify(existingFingerprint) === JSON.stringify(nextFingerprint);
    if (!intervalsUnchanged && metric === "steps") {
      changedStepIntervals.push(...existing.map(({ startAt, endAt }) => ({ startAt, endAt })));
      changedStepIntervals.push(...rows.map(({ startAt, endAt }) => ({ startAt, endAt })));
    }
    if (!intervalsUnchanged) {
      await transaction.healthActivityInterval.deleteMany({ where: { profileId, date: day.date, metric } });
      if (rows.length > 0) {
        await transaction.healthActivityInterval.createMany({ data: rows, skipDuplicates: true });
      }
    }
    const aggregated = await transaction.healthActivityInterval.aggregate({
      where: { profileId, date: day.date, metric },
      _sum: { value: true },
    });
    const total = aggregated._sum.value;
    await transaction.dailyHealthData.update({
      where: { profileId_date: { profileId, date: day.date } },
      data: metric === "steps"
        ? { steps: total === null ? 0 : Math.round(total.toNumber()) }
        : { walkingDistanceKm: total ?? 0 },
    });
  }
  if (changedStepIntervals.length === 0) return [];
  const starts = changedStepIntervals.map(({ startAt }) => startAt.getTime());
  const ends = changedStepIntervals.map(({ endAt }) => endAt.getTime());
  const workouts = await transaction.workout.findMany({
    where: {
      profileId,
      hiddenFromHistory: false,
      type: { equals: "Stair Climbing", mode: "insensitive" },
      startAt: { lt: new Date(Math.max(...ends)) },
      endAt: { gt: new Date(Math.min(...starts)) },
    },
    select: { id: true, startAt: true, endAt: true },
  });
  return workouts.filter((workout) => changedStepIntervals.some((interval) => (
    interval.startAt < workout.endAt && interval.endAt > workout.startAt
  ))).map(({ id }) => id).sort((left, right) => left - right);
}

async function persistMetricSamples(
  transaction: Prisma.TransactionClient,
  profileId: number,
  dailyHealthDataId: number,
  dayDate: string,
  samples: readonly HealthMetricSampleInput[],
): Promise<void> {
  // A corrected series can repeat a metric/timestamp in one payload. Keep its
  // final occurrence before issuing upserts, so the outcome is deterministic.
  const rowsByIdentity = new Map<string, {
    profileId: number;
    dailyHealthDataId: number;
    date: string;
    metric: HealthMetricSampleInput["metric"];
    source: typeof APPLE_HEALTH_SHORTCUT_SOURCE;
    timestamp: Date;
    value: number;
  }>();
  for (const sample of samples) {
    if (sample.date !== dayDate) continue;
    const timestamp = new Date(sample.timestamp);
    rowsByIdentity.set(`${sample.metric}|${timestamp.toISOString()}`, {
      profileId,
      dailyHealthDataId,
      date: sample.date,
      metric: sample.metric,
      source: APPLE_HEALTH_SHORTCUT_SOURCE,
      timestamp,
      value: sample.value,
    });
  }
  const rows = [...rowsByIdentity.values()];
  if (rows.length === 0) return;
  await Promise.all(rows.map((row) => transaction.healthMetricSample.upsert({
    where: { profileId_metric_timestamp: { profileId, metric: row.metric, timestamp: row.timestamp } },
    create: row,
    update: {
      dailyHealthDataId: row.dailyHealthDataId,
      date: row.date,
      source: row.source,
      value: row.value,
    },
  })));
}

function sampleRows(
  profileId: number,
  dailyHealthDataId: number,
  _date: string,
  samples: { timestamps: string[]; bpm: number[] } | undefined,
) {
  return (samples?.timestamps ?? []).map((timestamp, index) => ({
    profileId,
    dailyHealthDataId: timestamp.slice(0, 10) === _date ? dailyHealthDataId : null,
    date: timestamp.slice(0, 10),
    timestamp: new Date(timestamp),
    bpm: samples!.bpm[index]!,
    source: "shortcut",
  }));
}

async function reconcileDayWorkouts(
  transaction: Prisma.TransactionClient,
  profileId: number,
  dailyHealthDataId: number,
  incoming: readonly WorkoutInput[],
): Promise<number[]> {
  const existing = await transaction.workout.findMany({
    where: { profileId, dailyHealthDataId },
    select: {
      id: true,
      sourceIdentity: true,
      externalId: true,
      type: true,
      startAt: true,
      endAt: true,
      durationMinutes: true,
      energyKcal: true,
      activeEnergyKcal: true,
      syncProtected: true,
      hiddenFromHistory: true,
      matchedDiarySession: { select: { id: true } },
    },
  });

  const historyFingerprints = new Set(existing
    .filter((row) => row.sourceIdentity?.startsWith(MANUAL_HISTORY_SOURCE_PREFIX))
    .map((row) => workoutFingerprint({ type: row.type, startAt: row.startAt, endAt: row.endAt })));
  const reconciledIncoming = incoming.filter((workout) => !historyFingerprints.has(workoutFingerprint(workout)));
  const plan = planDayWorkoutReconciliation(
    existing.filter((row) => !row.sourceIdentity?.startsWith(MANUAL_STEPPER_SOURCE_PREFIX)
      && !row.sourceIdentity?.startsWith(MANUAL_HISTORY_SOURCE_PREFIX)).map((row) => ({
      id: row.id,
      sourceIdentity: row.sourceIdentity,
      externalId: row.externalId,
      type: row.type,
      startAt: row.startAt,
      endAt: row.endAt,
      linkedToDiary: row.matchedDiarySession !== null,
      syncProtected: row.syncProtected,
      hiddenFromHistory: row.hiddenFromHistory,
    })),
    reconciledIncoming,
  );
  const affectedWorkoutIds = new Set<number>();
  const unmatchedStrengthChanges: Array<{
    workoutId: number;
    previous: typeof existing[number] | null;
    next: typeof plan.creates[number];
  }> = [];

  for (const update of plan.updates) {
    const previousWorkout = existing.find((row) => row.id === update.id);
    const workoutInputsChanged = previousWorkout === undefined
      || previousWorkout.sourceIdentity !== update.fields.sourceIdentity
      || previousWorkout.externalId !== update.fields.externalId
      || previousWorkout.type !== update.fields.type
      || previousWorkout.startAt.getTime() !== update.fields.startAt.getTime()
      || previousWorkout.endAt.getTime() !== update.fields.endAt.getTime()
      || previousWorkout.durationMinutes !== update.fields.durationMinutes
      || (previousWorkout.energyKcal === null ? null : Number(previousWorkout.energyKcal)) !== update.fields.energyKcal
      || (previousWorkout.activeEnergyKcal === null ? null : Number(previousWorkout.activeEnergyKcal)) !== update.fields.activeEnergyKcal;
    // Prisma advances @updatedAt even for an identical update. That timestamp
    // participates in the source fingerprint, so a repeated Health payload
    // must not write the Workout row or trigger its linked side effects.
    if (!workoutInputsChanged) continue;
    affectedWorkoutIds.add(update.id);
    await transaction.workout.update({
      where: { profileId_id: { profileId, id: update.id } },
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
    const linked = await transaction.strengthDiarySession.findFirst({
      where: { profileId, matchedWorkoutId: update.id },
      select: { id: true, profileId: true, status: true, effectiveAccountingAt: true, accountingTimeZone: true, accountingTimeZoneProvenance: true, webStartedAt: true, createdAt: true },
    });
    if (linked) {
      if (linked.status === "COMPLETED") {
        await new PhysiologyV7PersistenceRepository(transaction).invalidateUnifiedPublication(linked.profileId);
      }
      const previousEffectiveAt = linked.effectiveAccountingAt ?? linked.webStartedAt ?? linked.createdAt;
      if (previousEffectiveAt.getTime() !== update.fields.startAt.getTime()) {
        const timeZone = linked.accountingTimeZone ?? DEFAULT_TIME_ZONE;
        const timeZoneProvenance = linked.accountingTimeZoneProvenance ?? "legacy-default";
        const previousLocalDate = instantToLocalDateTime(previousEffectiveAt, timeZone).date;
        const nextLocalDate = instantToLocalDateTime(update.fields.startAt, timeZone).date;
        await transaction.strengthDiarySession.update({
          where: { profileId_id: { profileId, id: linked.id } },
          data: {
            effectiveAccountingAt: update.fields.startAt,
            ...(previousLocalDate === nextLocalDate ? {} : {
              accountingInputRevision: { increment: 1 },
              currentSnapshotRevision: null,
            }),
          },
        });
        if (previousLocalDate === nextLocalDate) {
          await rebaseCurrentAccountingSnapshotTimestamp(transaction, {
            sessionId: linked.id,
            effectiveAccountingAt: update.fields.startAt,
            effectiveLocalDate: nextLocalDate,
            timeZone,
            timeZoneProvenance,
          });
        }
      }
      if (linked.status === "COMPLETED" && workoutInputsChanged) {
        const previousWorkout = existing.find((row) => row.id === update.id);
        const priorSourceInstant = previousWorkout?.startAt ?? previousEffectiveAt;
        const nextSourceInstant = update.fields.startAt;
        const episodes = await transaction.modelEpisode.findMany({
          where: { profileId: linked.profileId },
          orderBy: [{ startDate: "asc" }, { id: "asc" }],
          select: { id: true, startDate: true, timezone: true, active: true },
        });
        const oldModelDate = episodeTimeContextForInstantV1(episodes, priorSourceInstant).date;
        const newModelDate = episodeTimeContextForInstantV1(episodes, nextSourceInstant).date;
        await enqueueTrainingSourceChangeInTransaction(transaction, {
          profileId: linked.profileId,
          operationKind: "health-linked-workout-reconciled",
          affectedSessionIds: [linked.id],
          affectedWorkoutIds: [update.id],
          oldSourceIdentity: {
            kind: "health-workout",
            workoutId: update.id,
            sourceIdentity: previousWorkout?.sourceIdentity ?? null,
            externalId: previousWorkout?.externalId ?? null,
            type: previousWorkout?.type ?? null,
          },
          newSourceIdentity: {
            kind: "health-workout",
            workoutId: update.id,
            sourceIdentity: update.fields.sourceIdentity,
            externalId: update.fields.externalId,
            type: update.fields.type,
          },
          oldEventInstants: {
            trainingEffectiveAt: priorSourceInstant.toISOString(),
            workoutStartAt: previousWorkout?.startAt.toISOString() ?? null,
            workoutEndAt: previousWorkout?.endAt.toISOString() ?? null,
          },
          newEventInstants: {
            trainingEffectiveAt: nextSourceInstant.toISOString(),
            workoutStartAt: nextSourceInstant.toISOString(),
            workoutEndAt: update.fields.endAt.toISOString(),
          },
          oldModelDates: [oldModelDate],
          newModelDates: [newModelDate],
          deadlineMode: "health-fast",
        });
      }
    } else if (workoutInputsChanged
        && previousWorkout?.matchedDiarySession === null
        && canonicalizeWorkoutType(update.fields.type).classification === "traditional-strength-training") {
      unmatchedStrengthChanges.push({ workoutId: update.id, previous: previousWorkout ?? null, next: update.fields });
    }
  }

  // Use the composite unique identity for creates so concurrent retries
  // converge on one Workout row instead of racing through createMany().
  const createdWorkouts = await Promise.all(plan.creates.map((fields) => transaction.workout.upsert({
    where: {
      profileId_dailyHealthDataId_sourceIdentity: {
        profileId,
        dailyHealthDataId,
        sourceIdentity: fields.sourceIdentity,
      },
    },
    create: {
      profileId,
      dailyHealthDataId,
      externalId: fields.externalId,
      sourceIdentity: fields.sourceIdentity,
      type: fields.type,
      startAt: fields.startAt,
      endAt: fields.endAt,
      durationMinutes: fields.durationMinutes,
      energyKcal: fields.energyKcal,
      activeEnergyKcal: fields.activeEnergyKcal,
    },
    update: {
      externalId: fields.externalId,
      type: fields.type,
      startAt: fields.startAt,
      endAt: fields.endAt,
      durationMinutes: fields.durationMinutes,
      energyKcal: fields.energyKcal,
      activeEnergyKcal: fields.activeEnergyKcal,
    },
    select: { id: true },
  })));
  for (const [index, workout] of createdWorkouts.entries()) {
    affectedWorkoutIds.add(workout.id);
    const fields = plan.creates[index]!;
    if (canonicalizeWorkoutType(fields.type).classification === "traditional-strength-training") {
      unmatchedStrengthChanges.push({ workoutId: workout.id, previous: null, next: fields });
    }
  }

  if (unmatchedStrengthChanges.length > 0) {
    const episodes = await transaction.modelEpisode.findMany({
      where: { profileId },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      select: { id: true, startDate: true, timezone: true, active: true },
    });
    const oldRows = unmatchedStrengthChanges.flatMap(({ workoutId, previous }) => previous ? [{
      workoutId,
      sourceIdentity: previous.sourceIdentity,
      externalId: previous.externalId,
      type: previous.type,
      startAt: previous.startAt.toISOString(),
      endAt: previous.endAt.toISOString(),
      durationMinutes: previous.durationMinutes,
      energyKcal: previous.energyKcal === null ? null : Number(previous.energyKcal),
      activeEnergyKcal: previous.activeEnergyKcal === null ? null : Number(previous.activeEnergyKcal),
    }] : []);
    const newRows = unmatchedStrengthChanges.map(({ workoutId, next }) => ({
      workoutId,
      sourceIdentity: next.sourceIdentity,
      externalId: next.externalId,
      type: next.type,
      startAt: next.startAt.toISOString(),
      endAt: next.endAt.toISOString(),
      durationMinutes: next.durationMinutes,
      energyKcal: next.energyKcal,
      activeEnergyKcal: next.activeEnergyKcal,
    }));
    await enqueueTrainingSourceChangeInTransaction(transaction, {
      profileId,
      operationKind: "health-unmatched-strength-workout-reconciled",
      affectedSessionIds: [],
      affectedWorkoutIds: unmatchedStrengthChanges.map(({ workoutId }) => workoutId),
      oldSourceIdentity: { kind: "health-workout", rows: oldRows },
      newSourceIdentity: { kind: "health-workout", rows: newRows },
      oldEventInstants: oldRows.flatMap(({ startAt, endAt }) => [startAt, endAt]),
      newEventInstants: newRows.flatMap(({ startAt, endAt }) => [startAt, endAt]),
      oldModelDates: oldRows.map(({ startAt }) => episodeTimeContextForInstantV1(episodes, new Date(startAt)).date),
      newModelDates: newRows.map(({ startAt }) => episodeTimeContextForInstantV1(episodes, new Date(startAt)).date),
      deadlineMode: "health-fast",
    });
  }

  if (plan.deletes.length > 0) {
    for (const workoutId of plan.deletes) affectedWorkoutIds.add(workoutId);
    const linkedSessions = await transaction.strengthDiarySession.findMany({
      where: { profileId, matchedWorkoutId: { in: plan.deletes }, status: "COMPLETED" },
      select: { id: true, profileId: true },
    });
    for (const session of linkedSessions) {
      await new PhysiologyV7PersistenceRepository(transaction).invalidateUnifiedPublication(session.profileId);
    }
    await transaction.workout.deleteMany({
      where: { profileId, id: { in: plan.deletes } },
    });
  }
  return [...affectedWorkoutIds].sort((left, right) => left - right);
}

export class PrismaHealthSyncRepository implements HealthSyncRepository {
  constructor(readonly profileId: number, private readonly client: PrismaClient = prisma) {
    if (!Number.isSafeInteger(profileId) || profileId < 1) throw new Error("A trusted Profile ID is required for Health sync");
  }

  async syncDay(
    day: HealthDayInput,
    rawDay: unknown = day,
    metadata: HealthSyncMetadata = {
      timezone: "Europe/Bratislava",
      receivedAt: new Date(),
      syncedAt: null,
    },
    metricSamples: readonly HealthMetricSampleInput[] = [],
  ): Promise<SyncDateResult> {
    day = prepareDailyMeasurementsForWrite(day);
    // Coverage is decided from the raw sync observation for THIS calendar day only.
    const workoutFeedObserved = resolveWorkoutFeedObserved(rawDay, metadata.timezone);
    const workoutFeedPresent = hasWorkoutFeedPayload(rawDay);
    // Latest state, immutable snapshot, and workout reconciliation are one atomic sync.
    const transactionStartedAt = performance.now();
    let result!: SyncDateResult;
    let affectedWorkoutIds: number[] = [];
    try {
      result = await this.client.$transaction(async (transaction) => {
      const lifecycle = new PhysiologyV7PersistenceRepository(transaction);
      const profileLockStartedAt = performance.now();
      await lifecycle.lockProfile(this.profileId);
      logEvent("info", "health_sync_stage_timing", {
        stage: "persistence-profile-lock",
        durationMs: Math.round(performance.now() - profileLockStartedAt),
        calls: 1,
      });
      // A first-ever sync can reach this transaction before any model write has
      // bootstrapped the lifecycle row. Ensure it exists before arming the
      // durable fence; blockUnifiedPublication intentionally no-ops without it.
      await lifecycle.ensureLifecycle(this.profileId, day.date);
      // Arm before the raw Health snapshot commits. A process failure while
      // refreshing dependent reconciliation/shadows must leave publication
      // blocked until this exact calendar-day chain is retried successfully.
      await lifecycle.blockUnifiedPublication({ profileId: this.profileId, fromDate: day.date, source: "health", sourceKey: day.date });
      const existing = await transaction.dailyHealthData.findUnique({
        where: { profileId_date: { profileId: this.profileId, date: day.date } },
        select: { date: true, weightKg: true },
      });

      const daily = await transaction.dailyHealthData.upsert({
        where: { profileId_date: { profileId: this.profileId, date: day.date } },
        create: {
          profileId: this.profileId,
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
          // Missing feed coverage must not overwrite an earlier observed state.
          workoutFeedObserved: workoutFeedPresent ? workoutFeedObserved : undefined,
          rawPayload: jsonValue(rawDay),
        },
        select: { id: true, weightKg: true },
      });
      const metricWeightsBefore = await transaction.healthMetricSample.findMany({
        where: { profileId: this.profileId, date: day.date, metric: "weight-kg", source: APPLE_HEALTH_SHORTCUT_SOURCE },
        select: { id: true, timestamp: true, value: true },
        orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      });
      const workoutsBefore = workoutFeedObserved ? await transaction.workout.findMany({
        where: { profileId: this.profileId, dailyHealthDataId: daily.id },
        select: { id: true, startAt: true, endAt: true },
      }) : [];
      const snapshotsBefore = await transaction.healthSyncSnapshot.findMany({
        where: { profileId: this.profileId },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: { id: true, date: true, receivedAt: true, syncedAt: true, steps: true },
      });
      const stepperWorkouts = await transaction.workout.findMany({
        where: { profileId: this.profileId, hiddenFromHistory: false, type: { equals: "Stair Climbing", mode: "insensitive" } },
        select: { id: true, startAt: true, endAt: true },
      });

      const createdSnapshot = await transaction.healthSyncSnapshot.create({
        data: {
          profileId: this.profileId,
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
        select: { id: true, date: true, receivedAt: true, syncedAt: true, steps: true },
      });
      const snapshotsAfter = [...snapshotsBefore, createdSnapshot]
        .sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id)
        .map((snapshot) => ({
          id: snapshot.id,
          receivedAt: snapshot.receivedAt.toISOString(),
          syncedAt: snapshot.syncedAt?.toISOString() ?? null,
          steps: snapshot.steps,
        }));
      const snapshotsBeforeForSelection = snapshotsBefore.map((snapshot) => ({
        id: snapshot.id,
        receivedAt: snapshot.receivedAt.toISOString(),
        syncedAt: snapshot.syncedAt?.toISOString() ?? null,
        steps: snapshot.steps,
      }));
      const snapshotBracketChangedWorkouts = stepperWorkouts.filter((workout) => {
        const previous = selectedHealthSyncStepSnapshotBracketV7({
          startAt: workout.startAt.toISOString(), endAt: workout.endAt.toISOString(), snapshots: snapshotsBeforeForSelection,
        });
        const next = selectedHealthSyncStepSnapshotBracketV7({
          startAt: workout.startAt.toISOString(), endAt: workout.endAt.toISOString(), snapshots: snapshotsAfter,
        });
        return previous.before?.snapshotId !== next.before?.snapshotId
          || previous.after?.snapshotId !== next.after?.snapshotId;
      });
      const stepIntervalsForChangedBrackets = snapshotBracketChangedWorkouts.length > 0
        ? await transaction.healthActivityInterval.findMany({
          where: {
            profileId: this.profileId,
            metric: "steps",
            OR: snapshotBracketChangedWorkouts.map((workout) => ({
              startAt: { lt: workout.endAt },
              endAt: { gt: workout.startAt },
            })),
          },
          select: { startAt: true, endAt: true },
        })
        : [];
      const snapshotDependentStepperIds = snapshotBracketChangedWorkouts
        .filter((workout) => !stepIntervalsForChangedBrackets.some((interval) => (
          interval.startAt < workout.endAt && interval.endAt > workout.startAt
        )))
        .map(({ id }) => id);

      await persistMetricSamples(transaction, this.profileId, daily.id, day.date, metricSamples);

      const metricWeightsAfter = await transaction.healthMetricSample.findMany({
        where: { profileId: this.profileId, date: day.date, metric: "weight-kg", source: APPLE_HEALTH_SHORTCUT_SOURCE },
        select: { id: true, timestamp: true, value: true },
        orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      });
      const beforeWeightById = new Map(metricWeightsBefore.map((row) => [row.id, `${row.timestamp.toISOString()}|${row.value.toString()}`]));
      const afterWeightById = new Map(metricWeightsAfter.map((row) => [row.id, `${row.timestamp.toISOString()}|${row.value.toString()}`]));
      const changedWeightRows = [
        ...metricWeightsBefore.filter((row) => beforeWeightById.get(row.id) !== afterWeightById.get(row.id)),
        ...metricWeightsAfter.filter((row) => beforeWeightById.get(row.id) !== afterWeightById.get(row.id)),
      ];
      const dailyWeightChanged = existing?.weightKg !== daily.weightKg;

      const intervalDependentStepperIds = await persistActivityIntervals(transaction, day, metadata.timezone, this.profileId);

      // Reconciliation deletes workouts absent from the incoming feed, so it is
      // safe only when this calendar date was explicitly observed. Missing or
      // latest-N-only payloads leave historical workouts untouched.
      if (workoutFeedObserved) {
        const workouts = filterWorkoutsForSyncedDay(
          day.workouts ?? [],
          day.date,
          metadata.timezone,
        );
        affectedWorkoutIds = await reconcileDayWorkouts(transaction, this.profileId, daily.id, workouts);
      }
      affectedWorkoutIds = [...new Set([
        ...affectedWorkoutIds,
        ...snapshotDependentStepperIds,
        ...intervalDependentStepperIds,
      ])]
        .sort((left, right) => left - right);
      const workoutsAfter = workoutFeedObserved ? await transaction.workout.findMany({
        where: { profileId: this.profileId, dailyHealthDataId: daily.id },
        select: { id: true, startAt: true, endAt: true },
      }) : [];
      const affectedIds = affectedWorkoutIds;
      const affectedIdSet = new Set(affectedIds);
      const affectedRows = [...workoutsBefore, ...workoutsAfter, ...stepperWorkouts]
        .filter((row) => affectedIdSet.has(row.id));
      await invalidateWorkoutEnergyInTransactionV1({
        tx: transaction,
        profileId: this.profileId,
        workoutIds: affectedIds,
        affectedInstants: affectedRows.flatMap((row) => [row.startAt, row.endAt]),
        affectedModelDates: [day.date],
        staleMatchingAliasesOnly: true,
      });
      const weightSourceChanged = dailyWeightChanged || changedWeightRows.length > 0;
      if (weightSourceChanged) {
        await invalidateStepperMassDependenciesInTransactionV1({
          tx: transaction,
          profileId: this.profileId,
          measurementDates: dailyWeightChanged ? [day.date] : [],
          measurementInstants: changedWeightRows.map((row) => row.timestamp),
        });
      }

      const heartRateSamples = sampleRows(this.profileId, daily.id, day.date, day.bpm);
      if (heartRateSamples.length > 0) {
        await transaction.heartRateSample.createMany({ data: heartRateSamples, skipDuplicates: true });
      }
      const restingHeartRateSamples = (day.bpminpeace?.timestamps ?? []).map((timestamp, index) => ({
        profileId: this.profileId,
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
        profileId: this.profileId,
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

      if (metadata.deferDependentRefresh) {
        const previousJob = await transaction.healthSyncRefreshJob.findUnique({
          where: { profileId: this.profileId },
          select: { fromDate: true, toDate: true, sourceDates: true, weightSourceChangedDates: true },
        });
        const sourceDates = new Set(previousJob?.sourceDates ?? []);
        sourceDates.add(day.date);
        const changedWeightDates = new Set(previousJob?.weightSourceChangedDates ?? []);
        if (weightSourceChanged) changedWeightDates.add(day.date);
        const fromDate = previousJob?.fromDate && previousJob.fromDate < day.date
          ? previousJob.fromDate
          : day.date;
        const toDate = previousJob?.toDate && previousJob.toDate > day.date
          ? previousJob.toDate
          : day.date;
        await transaction.healthSyncRefreshJob.upsert({
          where: { profileId: this.profileId },
          create: {
            profileId: this.profileId,
            requestedGeneration: 1,
            completedGeneration: 0,
            fromDate,
            toDate,
            sourceDates: [...sourceDates].sort(),
            weightSourceChangedDates: [...changedWeightDates].sort(),
            nextAttemptAt: new Date(Date.now() + 3_000),
            updatedAt: new Date(),
          },
          update: {
            requestedGeneration: { increment: 1 },
            fromDate,
            toDate,
            sourceDates: [...sourceDates].sort(),
            weightSourceChangedDates: [...changedWeightDates].sort(),
            nextAttemptAt: new Date(Date.now() + 3_000),
            lastErrorType: null,
            lastErrorAt: null,
          },
        });
      }

      return {
        date: day.date,
        action: existing ? "updated" : "created",
        ...(weightSourceChanged ? { weightSourceChanged: true } : {}),
        ...(affectedWorkoutIds.length > 0 ? { affectedWorkoutIds } : {}),
      };
      });
    } finally {
      logEvent("info", "health_sync_stage_timing", {
        stage: "persistence-transaction",
        durationMs: Math.round(performance.now() - transactionStartedAt),
        calls: 1,
      });
    }
    return result;
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

export function healthSyncRepositoryForProfile(profileId: number, client: PrismaClient = prisma): HealthSyncRepository {
  return new PrismaHealthSyncRepository(profileId, client);
}
