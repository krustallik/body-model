import { Prisma, PrismaClient } from "@prisma/client";
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HealthDayInput } from "@/modules/health/health.types";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.DATABASE_URL);
// Application modules create the shared Prisma client from DATABASE_URL.
process.env.DATABASE_URL = databaseUrl;
process.env.IOS_SHORTCUT_API_KEY ??= "integration-test-secret";
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const { prisma: applicationPrisma } = await import("@/lib/db/prisma");
const { POST } = await import("@/app/api/v1/health/sync/route");
const { PATCH: patchDay } = await import("@/app/api/v1/days/[date]/route");
const { PrismaHealthSyncRepository } = await import("@/modules/health/health.repository");
const { claimNextHealthSyncRefreshJob, processNextHealthSyncRefreshJob } = await import("@/modules/health/health-sync-refresh-worker");
const { runWithHealthSyncRefreshWorkerLease } = await import("@/modules/health/health-sync-worker-context");
const { DailyMetricRepository } = await import("@/modules/days/day.repository");
const { MANUAL_HISTORY_SOURCE_PREFIX, MANUAL_STEPPER_SOURCE_PREFIX } = await import("@/modules/health/workout-source-identity");
const { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION } = await import("@/model/unified-experimental-physiology-v1/contracts");
const { addCalendarDays } = await import("@/modules/model-episodes/model-calendar");
const { getModelStatus, initializeNewModelEpisode, recalculateModelEpisode } = await import("@/modules/model-episodes/model-episode.service");
const { currentPhysiologyV7Versions } = await import("@/modules/model-episodes/physiology-v7-persistence");
const { PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE, PhysiologyV7PersistenceRepository } = await import("@/modules/model-episodes/physiology-v7-persistence.repository");
const { deleteDailyHealthRows } = await import("../helpers/delete-daily-health");
const { processNextTrainingRefreshJob, reconcileLegacyStepperPublicationBlocksForRecovery } = await import("@/modules/training/training-refresh-worker");
const { trainingRepository } = await import("@/modules/training/training.repository");
const { trainingService } = await import("@/modules/training/training.service");
const { ENTRY_MODE, RESISTANCE, SESSION_STATUS } = await import("@/modules/training/training.constants");
const apiKey = process.env.IOS_SHORTCUT_API_KEY ?? "integration-test-secret";
const testDates = ["2040-01-01", "2040-01-02", "2040-01-03", "2040-01-04", "2040-01-05", "2040-01-06", "2040-01-07", "2040-01-08", "2040-01-09", "2040-01-10", "2040-01-11", "2040-01-12", "2043-01-07"];

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForWorkerBarrier<T>(barrier: Promise<T>, worker: Promise<unknown>, label: string): Promise<T> {
  const outcome = await Promise.race([
    barrier.then((value) => ({ type: "barrier" as const, value })),
    worker.then(
      () => ({ type: "worker-ended" as const }),
      (error: unknown) => ({ type: "worker-failed" as const, error }),
    ),
  ]);
  if (outcome.type === "barrier") return outcome.value;
  const detail = outcome.type === "worker-failed" ? `: ${String(outcome.error)}` : "";
  throw new Error(`Health worker ${outcome.type} before reaching ${label}${detail}`);
}

async function waitForProfileAdvisoryLockWaiter(pid?: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiter = pid === undefined
      ? await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory' AND classid = ${PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE}::oid
            AND objid = 1::oid AND objsubid = 2 AND granted = false
        ) AS waiting
      `
      : await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE pid = ${pid} AND locktype = 'advisory' AND classid = ${PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE}::oid
            AND objid = 1::oid AND objsubid = 2 AND granted = false
        ) AS waiting
      `;
    if (waiter[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected transaction did not wait for the profile advisory lock.");
}

async function saveHealthState() {
  return {
    queue: await prisma.healthSyncRefreshJob.findUnique({ where: { profileId: 1 } }),
    lifecycle: await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId: 1 } }),
    blocks: await prisma.unifiedPublicationBlock.findMany({ where: { profileId: 1 } }),
  };
}

async function saveTrainingRefreshState() {
  return {
    queue: await prisma.trainingRefreshJob.findUnique({ where: { profileId: 1 } }),
    sourceChanges: await prisma.trainingSourceChange.findMany({ where: { profileId: 1 } }),
  };
}

async function restoreTrainingRefreshState(state: Awaited<ReturnType<typeof saveTrainingRefreshState>>): Promise<void> {
  await prisma.trainingSourceChange.deleteMany({ where: { profileId: 1 } });
  await prisma.trainingRefreshJob.deleteMany({ where: { profileId: 1 } });
  if (state.sourceChanges.length > 0) await prisma.trainingSourceChange.createMany({ data: state.sourceChanges.map((row) => ({
    ...row,
    oldSourceIdentity: row.oldSourceIdentity === null ? Prisma.DbNull : row.oldSourceIdentity as Prisma.InputJsonValue,
    newSourceIdentity: row.newSourceIdentity === null ? Prisma.DbNull : row.newSourceIdentity as Prisma.InputJsonValue,
    oldEventInstants: row.oldEventInstants === null ? Prisma.DbNull : row.oldEventInstants as Prisma.InputJsonValue,
    newEventInstants: row.newEventInstants === null ? Prisma.DbNull : row.newEventInstants as Prisma.InputJsonValue,
  })) });
  if (state.queue) await prisma.trainingRefreshJob.create({ data: state.queue });
}

async function restoreHealthState(state: Awaited<ReturnType<typeof saveHealthState>>): Promise<void> {
  await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId: 1 } });
  if (state.queue) await prisma.healthSyncRefreshJob.create({ data: state.queue });
  await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId: 1 } });
  if (state.blocks.length > 0) await prisma.unifiedPublicationBlock.createMany({ data: state.blocks, skipDuplicates: true });
  if (state.lifecycle) {
    await prisma.physiologyV7Lifecycle.upsert({
      where: { profileId: 1 },
      create: state.lifecycle,
      update: {
        staleFromDate: state.lifecycle.staleFromDate,
        invalidationGeneration: state.lifecycle.invalidationGeneration,
        currentThroughDate: state.lifecycle.currentThroughDate,
        productionStaleFromDate: state.lifecycle.productionStaleFromDate,
        productionPublishedGeneration: state.lifecycle.productionPublishedGeneration,
        unifiedPublishedGeneration: state.lifecycle.unifiedPublishedGeneration,
        unifiedTargetRevision: state.lifecycle.unifiedTargetRevision,
        unifiedRolloutEpoch: state.lifecycle.unifiedRolloutEpoch,
        unifiedPublishedRolloutEpoch: state.lifecycle.unifiedPublishedRolloutEpoch,
        unifiedPublicationBlockedFromDate: state.lifecycle.unifiedPublicationBlockedFromDate,
        unifiedPublicationBlockedSource: state.lifecycle.unifiedPublicationBlockedSource,
        stateVersion: state.lifecycle.stateVersion,
        sourceNormalizationVersion: state.lifecycle.sourceNormalizationVersion,
        dailyRuntimeVersion: state.lifecycle.dailyRuntimeVersion,
        rangeRebuildVersion: state.lifecycle.rangeRebuildVersion,
        rebuildServiceVersion: state.lifecycle.rebuildServiceVersion,
        createdAt: state.lifecycle.createdAt,
        updatedAt: state.lifecycle.updatedAt,
      },
    });
  } else {
    await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId: 1 } });
  }
}

async function releaseHealthState(state: Awaited<ReturnType<typeof saveHealthState>>, date: string): Promise<void> {
  await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
  await prisma.healthActivityInterval.deleteMany({ where: { date } });
  await deleteDailyHealthRows(prisma, date);
  await restoreHealthState(state);
}

async function assertTestDatabaseIdentity(): Promise<void> {
  type DatabaseIdentity = {
    databaseName: string;
    serverAddress: string | null;
    serverPort: number;
    userName: string;
  };
  const readIdentity = (client: PrismaClient) => client.$queryRaw<DatabaseIdentity[]>`
    SELECT current_database() AS "databaseName",
      inet_server_addr()::text AS "serverAddress",
      inet_server_port() AS "serverPort",
      current_user AS "userName"
  `;
  const [suiteIdentity, applicationIdentity] = await Promise.all([
    readIdentity(prisma),
    readIdentity(applicationPrisma),
  ]);
  const expectedDatabaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  expect(suiteIdentity[0]).toBeDefined();
  expect(suiteIdentity[0]?.databaseName).toBe(expectedDatabaseName);
  expect(applicationIdentity[0]).toEqual(suiteIdentity[0]);
}

async function markUnifiedV4Current(): Promise<void> {
  const lifecycle = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId: 1 } });
  const invalidationGeneration = lifecycle?.invalidationGeneration ?? 1;
  const rolloutEpoch = Math.max(1, lifecycle?.unifiedRolloutEpoch ?? 0);
  await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId: 1 } });
  await prisma.physiologyV7Lifecycle.upsert({
    where: { profileId: 1 },
    create: {
      profileId: 1,
      invalidationGeneration,
      productionStaleFromDate: null,
      productionPublishedGeneration: invalidationGeneration,
      unifiedPublishedGeneration: invalidationGeneration,
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: rolloutEpoch,
      unifiedPublishedRolloutEpoch: rolloutEpoch,
      unifiedPublicationBlockedFromDate: null,
      unifiedPublicationBlockedSource: null,
      ...currentPhysiologyV7Versions,
    },
    update: {
      productionStaleFromDate: null,
      productionPublishedGeneration: invalidationGeneration,
      unifiedPublishedGeneration: invalidationGeneration,
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: rolloutEpoch,
      unifiedPublishedRolloutEpoch: rolloutEpoch,
      unifiedPublicationBlockedFromDate: null,
      unifiedPublicationBlockedSource: null,
    },
  });
}

async function preparePublishedModelForHealthWorker(date: string): Promise<{ episodeId: number; dates: string[]; now: Date }> {
  const endDate = addCalendarDays(date, 10);
  const startDate = addCalendarDays(endDate, -99);
  const rows = Array.from({ length: 100 }, (_, index) => {
    const rowDate = addCalendarDays(startDate, index);
    const hasBodyFatAnchor = rowDate >= addCalendarDays(date, -6) && rowDate <= date;
    return {
      date: rowDate,
      weightKg: 80 + [0, 0.05, -0.04, 0.02][index % 4],
      bodyFatPercent: hasBodyFatAnchor ? 20 + [0, 0.2, -0.1][index % 3] : null,
      caloriesKcal: 2_450 + [0, 50, -50][index % 3],
      proteinG: 150,
      fatG: 75,
      carbsG: 240 + [0, 10, -10][index % 3],
      steps: 8_000,
      averageWalkingSpeedKmh: 5,
      walkingDistanceKm: 5,
      strengthTrainingMinutes: 30,
      rawPayload: { source: "health-sync-worker-integration" },
    };
  });
  await prisma.dailyHealthData.createMany({ data: rows });
  const now = new Date(`${addCalendarDays(endDate, 1)}T12:00:00.000Z`);
  const episode = await initializeNewModelEpisode({ startDate: date, now });
  // Previous Health integration cases may leave older synthetic dirty dates.
  // This helper establishes an already-current baseline before rebuilding its
  // new episode, so the fixture does not trigger an unrelated historical suffix.
  await markUnifiedV4Current();
  await prisma.physiologyV7Lifecycle.update({ where: { profileId: 1 }, data: { staleFromDate: date } });
  await recalculateModelEpisode({ episodeId: episode.id, now });
  await markUnifiedV4Current();
  return { episodeId: episode.id, dates: rows.map(({ date: rowDate }) => rowDate), now };
}

async function assertPublishedModelRangeIsEmpty(startDate: string, endDate: string): Promise<void> {
  // removePublishedModelForHealthWorker deletes profile-wide derived rows by
  // date. Refuse to seed the fixture if this range contains data that cleanup
  // could not restore; this keeps a reused isolated database fail-closed.
  const range = { gte: startDate, lte: endDate };
  const [healthRows, activeEnergy, fatWeight, glycogenRepletion, glycogenWater, glycogenState,
    localHypertrophy, ffmRetention, unifiedState, v7DailyResult] = await Promise.all([
    prisma.dailyHealthData.count({ where: { date: range } }),
    prisma.activeEnergyCanonicalEvent.count({ where: { profileId: 1, modelDate: range } }),
    prisma.experimentalFatWeightUncertaintyShadow.count({ where: { profileId: 1, date: range } }),
    prisma.experimentalGlycogenRepletionShadow.count({ where: { profileId: 1, date: range } }),
    prisma.experimentalGlycogenAssociatedWaterShadow.count({ where: { profileId: 1, date: range } }),
    prisma.experimentalGlycogenStateShadow.count({ where: { profileId: 1, date: range } }),
    prisma.experimentalLocalHypertrophyResponseShadow.count({ where: { profileId: 1, weekStartDate: range } }),
    prisma.experimentalFfmRetentionShadow.count({ where: { profileId: 1, date: range } }),
    prisma.unifiedExperimentalPhysiologyState.count({ where: { profileId: 1, date: range } }),
    prisma.physiologyV7DailyResult.count({ where: { profileId: 1, date: range } }),
  ]);
  const existing = { healthRows, activeEnergy, fatWeight, glycogenRepletion, glycogenWater, glycogenState,
    localHypertrophy, ffmRetention, unifiedState, v7DailyResult };
  if (Object.values(existing).some((count) => count !== 0)) {
    throw new Error(`Refusing to run health worker fixture over existing rows in ${startDate}..${endDate}: ${JSON.stringify(existing)}`);
  }
}

async function removePublishedModelForHealthWorker(fixture: { episodeId: number; dates: string[] }): Promise<void> {
  const range = { gte: fixture.dates[0], lte: fixture.dates.at(-1) };
  await prisma.unifiedExperimentalPhysiologyStateV2.deleteMany({ where: { modelEpisodeId: fixture.episodeId } });
  await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({ where: { profileId: 1, modelEpisodeId: fixture.episodeId } });
  await prisma.experimentalCessationDetrainingShadow.deleteMany({ where: { profileId: 1, modelEpisodeId: fixture.episodeId } });
  await prisma.activeEnergyCanonicalEvent.deleteMany({ where: { profileId: 1, modelDate: range } });
  await prisma.experimentalFatWeightUncertaintyShadow.deleteMany({ where: { profileId: 1, date: range } });
  await prisma.experimentalGlycogenRepletionShadow.deleteMany({ where: { profileId: 1, date: range } });
  await prisma.experimentalGlycogenAssociatedWaterShadow.deleteMany({ where: { profileId: 1, date: range } });
  await prisma.experimentalGlycogenStateShadow.deleteMany({ where: { profileId: 1, date: range } });
  await prisma.experimentalLocalHypertrophyResponseShadow.deleteMany({ where: { profileId: 1, weekStartDate: range } });
  await prisma.experimentalFfmRetentionShadow.deleteMany({ where: { profileId: 1, date: range } });
  await prisma.unifiedExperimentalPhysiologyState.deleteMany({ where: { profileId: 1, date: range } });
  await prisma.physiologyV7DailyResult.deleteMany({ where: { profileId: 1, date: range } });
  await prisma.modelEpisode.deleteMany({ where: { id: fixture.episodeId } });
  await prisma.dailyHealthData.deleteMany({ where: { date: { in: fixture.dates }, rawPayload: { path: ["source"], equals: "health-sync-worker-integration" } } });
}

async function seedPendingJob(
  date: string,
  { requestedGeneration = 1, completedGeneration = 0, fromDate = date }: {
    requestedGeneration?: number;
    completedGeneration?: number;
    fromDate?: string | null;
  } = {},
) {
  return prisma.healthSyncRefreshJob.upsert({
    where: { profileId: 1 },
    create: {
      profileId: 1,
      requestedGeneration,
      completedGeneration,
      fromDate,
      toDate: fromDate === null ? null : date,
      sourceDates: [date],
      weightSourceChangedDates: [],
      leaseToken: null,
      leaseUntil: null,
      nextAttemptAt: new Date(0),
      attemptCount: 0,
      lastErrorType: null,
      lastErrorAt: null,
    },
    update: {
      requestedGeneration,
      completedGeneration,
      fromDate,
      toDate: fromDate === null ? null : date,
      sourceDates: [date],
      weightSourceChangedDates: [],
      leaseToken: null,
      leaseUntil: null,
      nextAttemptAt: new Date(0),
      attemptCount: 0,
      lastErrorType: null,
      lastErrorAt: null,
    },
  });
}

function syncRequest(days: unknown[]): Request {
  return new Request("http://localhost/api/v1/health/sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ days }),
  });
}

function rawSyncRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/health/sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
}

async function cleanTestRows(): Promise<void> {
  await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId: 1 } });
  await prisma.healthSyncSnapshot.deleteMany({ where: { date: { in: testDates } } });
  await prisma.healthActivityInterval.deleteMany({ where: { date: { in: testDates } } });
  await deleteDailyHealthRows(prisma, testDates);
}

describe("Apple Health sync with PostgreSQL", () => {
  beforeAll(async () => {
    await assertTestDatabaseIdentity();
    await prisma.profile.upsert({
      where: { id: 1 },
      create: { id: 1, sex: "male", dateOfBirth: new Date("1990-01-01T00:00:00.000Z"), heightCm: 180 },
      update: {},
    });
    await cleanTestRows();
  });
  afterAll(async () => {
    try {
      await cleanTestRows();
    } finally {
      await Promise.all([prisma.$disconnect(), applicationPrisma.$disconnect()]);
    }
  });

  it("creates partial data, persists raw payload and creates workouts", async () => {
    const day = {
      date: testDates[0],
      weightKg: null,
      steps: 12345,
      workouts: [
        {
          externalId: "integration-workout-1",
          type: "strength_training",
          startAt: "2040-01-01T17:00:00+02:00",
          endAt: "2040-01-01T18:00:00+02:00",
          durationMinutes: 60,
          energyKcal: 300,
        },
      ],
    };

    const response = await POST(syncRequest([day]));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ created: 1, updated: 0 });

    const stored = await prisma.dailyHealthData.findUniqueOrThrow({
      where: { date: testDates[0] },
      include: { workouts: true },
    });
    expect(stored.rawPayload).toEqual(day);
    expect(stored.workouts).toHaveLength(1);
    expect(stored.workouts[0]?.startAt.toISOString()).toBe("2040-01-01T15:00:00.000Z");
  });

  it("journals linked Health edits with episode-local dates from the canonical workout instant", async () => {
    const date = "2044-01-07";
    const sourceId = `health-journal-boundary-${Date.now()}`;
    const oldStartAt = new Date("2044-01-06T23:30:00.000Z");
    const newStartAt = new Date("2044-01-07T00:30:00.000Z");
    const repository = new PrismaHealthSyncRepository(prisma);
    const healthState = await saveHealthState();
    const trainingJobBefore = await prisma.trainingRefreshJob.findUnique({ where: { profileId: 1 } });
    let workoutId: number | null = null;
    let sessionId: number | null = null;
    let episodeId: number | null = null;
    try {
      const episode = await prisma.modelEpisode.create({
        data: {
          profileId: 1,
          startDate: "2044-01-01",
          timezone: "UTC",
          modelVersion: "health-journal-boundary-integration",
          active: true,
          ecfPolicy: "hold-ecf",
          baselineEnergyIntakeKcalPerDay: 2_400,
          baselineCarbIntakeG: 220,
          baselineWindowStartDate: "2044-01-01",
          baselineWindowEndDate: "2044-01-01",
          baselineNutritionDayCount: 1,
          baselineWeightObservationCount: 1,
          baselineWeightTrendKgPerWeek: 0,
          baselineWeightTrendPercentPerWeek: 0,
          baselineDerivationMethod: sourceId,
          initialFatMassKg: 16,
          initialLeanTissueKg: 55,
          initialGlycogenKg: 0.5,
          baselineExtracellularFluidLiters: 18,
          initialExtracellularFluidDeviationLiters: 0,
          initialAdaptiveThermogenesisKcalPerDay: 0,
          initialFilteredWeightKg: 80,
          initialWeightFilterVarianceKg2: 1,
          initialRmrKcalPerDay: 1_700,
          dynamicRmrFatCoefficient: 3.2,
          dynamicRmrLeanCoefficient: 22,
          dynamicRmrCalibrationOffsetKcalPerDay: 0,
          adaptiveThermogenesisBeta: 0.14,
          adaptiveThermogenesisTimeConstantDays: 14,
          weightProcessNoiseVarianceKg2PerDay: 0.01,
          weightMeasurementNoiseVarianceKg2: 0.25,
          calibrationDiagnostics: {},
        },
        select: { id: true },
      });
      episodeId = episode.id;

      const oldWorkout = {
        externalId: sourceId,
        type: "strength_training",
        startAt: oldStartAt.toISOString(),
        endAt: new Date(oldStartAt.getTime() + 60 * 60_000).toISOString(),
        durationMinutes: 60,
        energyKcal: 300,
      };
      await repository.syncDay(
        { date, workouts: [oldWorkout] },
        { date, workouts: [oldWorkout] },
        { timezone: "Europe/Bratislava", receivedAt: new Date(), syncedAt: null },
      );
      const workout = await prisma.workout.findFirstOrThrow({
        where: { externalId: sourceId }, select: { id: true },
      });
      workoutId = workout.id;
      const session = await prisma.strengthDiarySession.create({
        data: {
          profileId: 1,
          status: "COMPLETED",
          entryMode: "RETROSPECTIVE",
          // Deliberately diverge the session accounting override from the
          // linked source instant; the Training journal must use Workout.startAt.
          effectiveAccountingAt: new Date("2044-01-05T18:30:00.000Z"),
          accountingTimeZone: "America/Los_Angeles",
          accountingTimeZoneProvenance: "integration-fixture",
          matchedWorkoutId: workout.id,
          matchStatus: "MATCHED",
          matchMethod: "MANUAL",
          matchedAt: new Date(),
        },
        select: { id: true },
      });
      sessionId = session.id;

      const updatedWorkout = {
        ...oldWorkout,
        startAt: newStartAt.toISOString(),
        endAt: new Date(newStartAt.getTime() + 60 * 60_000).toISOString(),
      };
      await repository.syncDay(
        { date, workouts: [updatedWorkout] },
        { date, workouts: [updatedWorkout] },
        { timezone: "Europe/Bratislava", receivedAt: new Date(), syncedAt: null },
      );

      const journal = await prisma.trainingSourceChange.findFirstOrThrow({
        where: { profileId: 1, affectedSessionIds: { has: session.id }, operationKind: "health-linked-workout-reconciled" },
        orderBy: { createdAt: "desc" },
      });
      expect(journal.oldEventInstants).toMatchObject({ workoutStartAt: oldStartAt.toISOString() });
      expect(journal.newEventInstants).toMatchObject({ workoutStartAt: newStartAt.toISOString() });
      expect(journal.oldModelDates).toEqual(["2044-01-06"]);
      expect(journal.newModelDates).toEqual(["2044-01-07"]);

      // Same-start corrections still affect model inputs and must be journaled;
      // the unchanged accounting instant must not take an early-continue path.
      const correctedWorkout = {
        ...updatedWorkout,
        endAt: new Date(newStartAt.getTime() + 45 * 60_000).toISOString(),
        durationMinutes: 45,
        energyKcal: 420,
      };
      await repository.syncDay(
        { date, workouts: [correctedWorkout] },
        { date, workouts: [correctedWorkout] },
        { timezone: "Europe/Bratislava", receivedAt: new Date(), syncedAt: null },
      );
      const changes = await prisma.trainingSourceChange.findMany({
        where: { profileId: 1, affectedSessionIds: { has: session.id }, operationKind: "health-linked-workout-reconciled" },
        orderBy: { generation: "asc" },
      });
      expect(changes).toHaveLength(2);
      expect(changes[1]?.oldModelDates).toEqual(["2044-01-07"]);
      expect(changes[1]?.newModelDates).toEqual(["2044-01-07"]);
      expect(changes[1]?.oldEventInstants).toMatchObject({ workoutStartAt: newStartAt.toISOString() });
      expect(changes[1]?.newEventInstants).toMatchObject({ workoutStartAt: newStartAt.toISOString() });
      const correctedStoredWorkout = await prisma.workout.findUniqueOrThrow({ where: { id: workout.id } });
      expect(Number(correctedStoredWorkout.energyKcal)).toBe(420);
      expect(correctedStoredWorkout.durationMinutes).toBe(45);
      const correctedJob = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(correctedJob.requestedGeneration).toBeGreaterThanOrEqual(2);
    } finally {
      if (sessionId !== null) await prisma.strengthDiarySession.deleteMany({ where: { id: sessionId } });
      if (workoutId !== null) await prisma.workout.deleteMany({ where: { id: workoutId } });
      if (episodeId !== null) await prisma.modelEpisode.deleteMany({ where: { id: episodeId } });
      if (sessionId !== null) {
        await prisma.trainingSourceChange.deleteMany({ where: { profileId: 1, affectedSessionIds: { has: sessionId } } });
      }
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId: 1 } });
      if (trainingJobBefore) await prisma.trainingRefreshJob.create({ data: trainingJobBefore });
      await releaseHealthState(healthState, date);
    }
  });

  it("retries idempotently and replaces rather than duplicates workouts", async () => {
    const queuedBefore = await prisma.healthSyncRefreshJob.findUnique({ where: { profileId: 1 } });
    const day = {
      date: testDates[0],
      steps: 13000,
      workouts: [
        {
          externalId: "replacement-workout",
          type: "cycling",
          startAt: "2040-01-01T08:00:00Z",
          endAt: "2040-01-01T08:30:00Z",
        },
      ],
    };
    const first = await POST(syncRequest([day]));
    const retry = await POST(syncRequest([day]));
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      status: "ok", modelPublicationStatus: "stale", created: 0, updated: 1,
    });
    await expect(retry.json()).resolves.toMatchObject({
      status: "ok", modelPublicationStatus: "stale", created: 0, updated: 1,
    });

    const records = await prisma.dailyHealthData.findMany({
      where: { date: testDates[0] },
      include: { workouts: true },
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.steps).toBe(13000);
    expect(records[0]?.workouts.map(({ externalId }) => externalId)).toEqual(["replacement-workout"]);

    const queuedAfter = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(queuedAfter.requestedGeneration - (queuedBefore?.requestedGeneration ?? 0)).toBe(2);
    expect(queuedAfter.completedGeneration).toBeLessThan(queuedAfter.requestedGeneration);
    expect(queuedAfter.fromDate).toBe(testDates[0]);
    expect(queuedAfter.toDate).toBe(testDates[0]);
  });

  it("coalesces overlapping Shortcut retries while keeping one canonical daily row and workout", async () => {
    const date = testDates[1];
    const queuedBefore = await prisma.healthSyncRefreshJob.findUnique({ where: { profileId: 1 } });
    const day = {
      date,
      steps: 9000,
      workouts: [{
        externalId: "overlapping-sync-workout",
        type: "running",
        startAt: "2040-01-02T08:00:00Z",
        endAt: "2040-01-02T08:30:00Z",
      }],
    };

    const responses = await Promise.all([POST(syncRequest([day])), POST(syncRequest([day]))]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    await expect(responses[0]!.json()).resolves.toMatchObject({ status: "ok", modelPublicationStatus: "stale" });
    await expect(responses[1]!.json()).resolves.toMatchObject({ status: "ok", modelPublicationStatus: "stale" });

    const rows = await prisma.dailyHealthData.findMany({
      where: { date },
      include: { workouts: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workouts).toHaveLength(1);
    const snapshots = await prisma.healthSyncSnapshot.count({ where: { date } });
    expect(snapshots).toBe(2);

    const queuedAfter = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(queuedAfter.requestedGeneration - (queuedBefore?.requestedGeneration ?? 0)).toBe(2);
    expect(queuedAfter.sourceDates).toContain(date);
    expect(queuedAfter.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(Date.now());
  });

  it("keeps one latest daily row but appends immutable snapshots for every successful sync", async () => {
    const date = testDates[8];
    const firstRaw = {
      Date: date,
      Steps: 0,
      Walkingdistancekm: "",
    };
    const secondRaw = {
      Date: date,
      Steps: 500,
      Walkingdistancekm: "0,25",
    };
    const first = await POST(rawSyncRequest({
      Timezone: "Europe/Bratislava",
      SyncedAt: "2040-01-09T08:05:00+01:00",
      Days: [firstRaw],
    }));
    const second = await POST(rawSyncRequest({
      Timezone: "Europe/Bratislava",
      SyncedAt: "2040-01-09T12:10:00+01:00",
      Days: [secondRaw],
    }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const rows = await prisma.dailyHealthData.findMany({ where: { date } });
    const snapshots = await prisma.healthSyncSnapshot.findMany({
      where: { date }, orderBy: { id: "asc" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ steps: 500 });
    expect(rows[0]?.walkingDistanceKm?.toString()).toBe("0.25");
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      steps: 0,
      walkingDistanceKm: null,
      timezone: "Europe/Bratislava",
      rawPayload: firstRaw,
    });
    expect(snapshots[0]?.syncedAt?.toISOString()).toBe("2040-01-09T07:05:00.000Z");
    expect(snapshots[1]).toMatchObject({ steps: 500, rawPayload: secondRaw });
    expect(snapshots[1]?.walkingDistanceKm?.toString()).toBe("0.25");

    await prisma.dailyHealthData.delete({ where: { date } });
    const retained = await prisma.healthSyncSnapshot.findMany({ where: { date } });
    expect(retained).toHaveLength(2);
    expect(retained.every(({ dailyHealthDataId }) => dailyHealthDataId === null)).toBe(true);
  });

  it("retries normalized Shortcut payloads idempotently and retains their original raw casing", async () => {
    const originalDay = { Date: testDates[4], Weightkg: 89, Steps: 10000 };
    const first = await POST(rawSyncRequest({ Days: [originalDay] }));
    const retry = await POST(rawSyncRequest({ DAYS: [{ DATE: testDates[4], WEIGHTKG: 90, STEPS: 11000 }] }));

    await expect(first.json()).resolves.toMatchObject({ created: 1, updated: 0 });
    await expect(retry.json()).resolves.toMatchObject({ created: 0, updated: 1 });

    const records = await prisma.dailyHealthData.findMany({ where: { date: testDates[4] } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ weightKg: 90, steps: 11000 });
    expect(records[0]?.rawPayload).toEqual({ DATE: testDates[4], WEIGHTKG: 90, STEPS: 11000 });
  });

  it("creates and updates precise decimal health metrics without duplicate rows", async () => {
    const date = testDates[5];
    const first = await POST(syncRequest([{
      date,
      bodyFatPercent: 18.73,
      averageWalkingSpeedKmh: 5.2345,
      walkingDistanceKm: 6.7891,
    }]));
    const second = await POST(syncRequest([{
      date,
      bodyFatPercent: 18.6,
      averageWalkingSpeedKmh: null,
      walkingDistanceKm: 8.1234,
    }]));

    await expect(first.json()).resolves.toMatchObject({ created: 1, updated: 0 });
    await expect(second.json()).resolves.toMatchObject({ created: 0, updated: 1 });

    const records = await prisma.dailyHealthData.findMany({ where: { date } });
    expect(records).toHaveLength(1);
    expect(records[0]?.bodyFatPercent?.toString()).toBe("18.6");
    expect(records[0]?.averageWalkingSpeedKmh).toBeNull();
    expect(records[0]?.walkingDistanceKm?.toString()).toBe("8.12");
  });

  it("persists decimal-comma strings as precise numbers while retaining the original raw payload", async () => {
    const originalDay = {
      Date: testDates[6],
      Weightkg: "89,4",
      Bodyfatpercent: "27,4",
      Steps: "10234",
      Averagewalkingspeedkmh: "4,72",
      Walkingdistancekm: "7,35",
    };
    const response = await POST(rawSyncRequest({ Days: [originalDay] }));
    expect(response.status).toBe(200);

    const stored = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: testDates[6] } });
    expect(stored.weightKg).toBe(89.4);
    expect(stored.bodyFatPercent?.toString()).toBe("27.4");
    expect(stored.steps).toBe(10234);
    expect(stored.averageWalkingSpeedKmh?.toString()).toBe("4.72");
    expect(stored.walkingDistanceKm?.toString()).toBe("7.35");
    expect(stored.rawPayload).toEqual(originalDay);
  });

  it("creates and updates precise strength training minutes without duplicating the daily row", async () => {
    const date = testDates[7];
    const firstDay = { Date: date, Strengthtrainingminutes: "60" };
    const secondDay = { DATE: date, STRENGTHTRAININGMINUTES: "75,125" };
    const first = await POST(rawSyncRequest({ Days: [firstDay] }));
    const second = await POST(rawSyncRequest({ DAYS: [secondDay] }));

    await expect(first.json()).resolves.toMatchObject({ created: 1, updated: 0 });
    await expect(second.json()).resolves.toMatchObject({ created: 0, updated: 1 });

    const records = await prisma.dailyHealthData.findMany({ where: { date } });
    expect(records).toHaveLength(1);
    expect(records[0]?.strengthTrainingMinutes?.toString()).toBe("75.13");
    expect(records[0]?.rawPayload).toEqual(secondDay);
  });

  it("derives workout minutes from raw Shortcut dates and preserves the raw text", async () => {
    const rawWorkout = "8. 1. 2040, 13:01 8. 1. 2040, 14:16";
    const originalDay = { Date: testDates[7], Strengthtrainingminutes: rawWorkout };
    const response = await POST(rawSyncRequest({ Days: [originalDay] }));
    expect(response.status).toBe(200);

    const stored = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: testDates[7] } });
    expect(stored.strengthTrainingMinutes?.toString()).toBe("75");
    expect(stored.rawPayload).toEqual(originalDay);
  });

  it("accepts a multi-day sync payload for the recent three-day window", async () => {
    const response = await POST(
      syncRequest([{ date: testDates[2], steps: 200 }, { date: testDates[3], steps: 200 }]),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ received: 2, created: 2, updated: 0 });
    expect(await prisma.dailyHealthData.count({ where: { date: { in: testDates.slice(2, 4) } } })).toBe(2);
  });

  it("persists 167 singleton-array step intervals and recomputes their daily total", async () => {
    const date = testDates[8]!;
    const base = new Date(`${date}T00:00:00.000Z`).getTime();
    const starts = Array.from({ length: 167 }, (_, index) => new Date(base + index * 2).toISOString());
    const ends = Array.from({ length: 167 }, (_, index) => new Date(base + index * 2 + 1).toISOString());
    const response = await POST(syncRequest([{
      date,
      steps: [{
        stepCounts: Array.from({ length: 167 }, () => "1").join("\n"),
        timeStampsStart: starts.join("\n"),
        timeStampsEnd: ends.join("\n"),
      }],
    }]));
    expect(response.status).toBe(200);
    expect(await prisma.healthActivityInterval.count({ where: { date, metric: "steps" } })).toBe(167);
    expect((await prisma.dailyHealthData.findUniqueOrThrow({ where: { date } })).steps).toBe(167);
    expect((await prisma.healthSyncSnapshot.findFirstOrThrow({
      where: { date }, orderBy: { id: "desc" }, select: { rawPayload: true },
    })).rawPayload).toMatchObject({ steps: [expect.objectContaining({ stepCounts: expect.any(String) })] });
    const audit = await prisma.healthSyncAudit.findFirstOrThrow({
      where: { outcome: "success", rawBody: { contains: date } },
      orderBy: { id: "desc" },
      select: { rawBody: true },
    });
    expect(JSON.parse(audit.rawBody!)).toMatchObject({
      days: [expect.objectContaining({
        steps: [expect.objectContaining({ stepCounts: expect.any(String) })],
      })],
    });
  });

  it("does not create duplicate rows during concurrent retries", async () => {
    const date = testDates[3];
    await deleteDailyHealthRows(prisma, date!);
    const responses = await Promise.all([
      POST(syncRequest([{ date, steps: 111 }])),
      POST(syncRequest([{ date, steps: 222 }])),
    ]);
    expect(responses.every(({ status }) => status === 200)).toBe(true);
    expect(await prisma.dailyHealthData.count({ where: { date } })).toBe(1);
    expect([111, 222]).toContain((await prisma.dailyHealthData.findUnique({ where: { date } }))?.steps);
  });

  it("preserves observed walking zero and workout-feed coverage when a later payload omits the feed", async () => {
    const date = "2040-01-10";
    await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
    await deleteDailyHealthRows(prisma, date);

    const withEmptyFeed = await POST(syncRequest([{
      date,
      walkingDistanceKm: 0,
      workouts: [],
    }]));
    expect(withEmptyFeed.status).toBe(200);

    const observed = await prisma.dailyHealthData.findUniqueOrThrow({
      where: { date },
      include: { workouts: true },
    });
    expect(observed.walkingDistanceKm?.toString()).toBe("0");
    expect(observed.workoutFeedObserved).toBe(true);
    expect(observed.workouts).toHaveLength(0);

    const withoutFeed = await POST(syncRequest([{
      date,
      walkingDistanceKm: 0,
    }]));
    expect(withoutFeed.status).toBe(200);
    const unknown = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date } });
    expect(unknown.walkingDistanceKm?.toString()).toBe("0");
    // Missing feed coverage is unknown, not an observed negative; preserve the
    // earlier explicit empty-feed observation instead of erasing it.
    expect(unknown.workoutFeedObserved).toBe(true);

    await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
    await deleteDailyHealthRows(prisma, date);
  });

  it("rolls back today's record when a database constraint fails", async () => {
    const repository = new PrismaHealthSyncRepository(prisma);
    const invalidDay = { date: "not-a-date" } as HealthDayInput;

    await expect(repository.syncDay(invalidDay)).rejects.toThrow();
    expect(await prisma.dailyHealthData.findUnique({ where: { date: "not-a-date" } })).toBeNull();
    expect(await prisma.healthSyncSnapshot.count({ where: { date: "not-a-date" } })).toBe(0);
  });

  it("recovers an expired durable lease with one PostgreSQL worker after HTTP 200 without replaying raw input", async () => {
    const date = testDates[8]!;
    await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
    await prisma.healthActivityInterval.deleteMany({ where: { date } });
    await deleteDailyHealthRows(prisma, date);

    const priorQueue = await prisma.healthSyncRefreshJob.findUnique({ where: { profileId: 1 } });
    const priorLifecycle = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId: 1 } });
    const priorBlocks = await prisma.unifiedPublicationBlock.findMany({ where: { profileId: 1 } });
    const syntheticDay = { date, steps: 777 };
    const auditStartedAt = new Date();
    try {
      const response = await POST(syncRequest([syntheticDay]));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "ok", modelPublicationStatus: "stale", received: 1,
      });

      const rawSnapshotCount = await prisma.healthSyncSnapshot.count({ where: { date } });
      const rawPayload = (await prisma.healthSyncSnapshot.findFirstOrThrow({
        where: { date }, orderBy: { id: "desc" }, select: { rawPayload: true },
      })).rawPayload;
      const queued = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      const queuedLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });

      await prisma.healthSyncRefreshJob.update({
        where: { profileId: 1 },
        data: {
          completedGeneration: queued.requestedGeneration - 1,
          fromDate: date,
          toDate: date,
          sourceDates: [date],
          weightSourceChangedDates: [],
          leaseToken: "00000000-0000-4000-8000-000000000000",
          leaseUntil: new Date(Date.now() - 1_000),
          nextAttemptAt: new Date(Date.now() - 1_000),
          attemptCount: 4,
        },
      });

      // Model a prior worker that completed publication and crashed before
      // acknowledging the durable queue row. Its lease is now reclaimable.
      await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId: 1 } });
      await prisma.physiologyV7Lifecycle.update({
        where: { profileId: 1 },
        data: {
          productionStaleFromDate: null,
          productionPublishedGeneration: queuedLifecycle.invalidationGeneration,
          unifiedPublishedGeneration: queuedLifecycle.invalidationGeneration,
          unifiedPublishedRolloutEpoch: queuedLifecycle.unifiedRolloutEpoch,
          unifiedPublicationBlockedFromDate: null,
        },
      });
      await prisma.healthSyncRefreshJob.update({
        where: { profileId: 1 },
        data: {
          leaseToken: "00000000-0000-4000-8000-000000000000",
          leaseUntil: new Date(Date.now() - 1_000),
          nextAttemptAt: new Date(Date.now() - 1_000),
        },
      });

      const claims = await Promise.all([
        processNextHealthSyncRefreshJob(),
        processNextHealthSyncRefreshJob(),
      ]);
      expect(claims.sort()).toEqual([false, true]);

      const recovered = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(recovered.completedGeneration).toBe(recovered.requestedGeneration);
      expect(recovered.leaseToken).toBeNull();
      expect(recovered.leaseUntil).toBeNull();
      expect(recovered.sourceDates).toEqual([]);
      expect(recovered.attemptCount).toBe(5);
      expect(await prisma.healthSyncSnapshot.count({ where: { date } })).toBe(rawSnapshotCount);
      await expect(prisma.healthSyncSnapshot.findFirstOrThrow({
        where: { date }, orderBy: { id: "desc" }, select: { rawPayload: true },
      })).resolves.toMatchObject({ rawPayload });
    } finally {
      const testAudit = await prisma.healthSyncAudit.findFirst({
        where: { rawBody: JSON.stringify({ days: [syntheticDay] }), receivedAt: { gte: auditStartedAt } },
        orderBy: { id: "desc" },
        select: { id: true },
      });
      if (testAudit) await prisma.healthSyncAudit.deleteMany({ where: { id: testAudit.id } });
      await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
      await prisma.healthActivityInterval.deleteMany({ where: { date } });
      await deleteDailyHealthRows(prisma, date);
      await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId: 1 } });
      if (priorQueue) await prisma.healthSyncRefreshJob.create({ data: priorQueue });
      await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId: 1 } });
      if (priorBlocks.length > 0) {
        await prisma.unifiedPublicationBlock.createMany({ data: priorBlocks, skipDuplicates: true });
      }
      if (priorLifecycle) {
        await prisma.physiologyV7Lifecycle.update({
          where: { profileId: 1 },
          data: {
            staleFromDate: priorLifecycle.staleFromDate,
            invalidationGeneration: priorLifecycle.invalidationGeneration,
            currentThroughDate: priorLifecycle.currentThroughDate,
            productionStaleFromDate: priorLifecycle.productionStaleFromDate,
            productionPublishedGeneration: priorLifecycle.productionPublishedGeneration,
            unifiedPublishedGeneration: priorLifecycle.unifiedPublishedGeneration,
            unifiedTargetRevision: priorLifecycle.unifiedTargetRevision,
            unifiedRolloutEpoch: priorLifecycle.unifiedRolloutEpoch,
            unifiedPublishedRolloutEpoch: priorLifecycle.unifiedPublishedRolloutEpoch,
            unifiedPublicationBlockedFromDate: priorLifecycle.unifiedPublicationBlockedFromDate,
            unifiedPublicationBlockedSource: priorLifecycle.unifiedPublicationBlockedSource,
            stateVersion: priorLifecycle.stateVersion,
            sourceNormalizationVersion: priorLifecycle.sourceNormalizationVersion,
            dailyRuntimeVersion: priorLifecycle.dailyRuntimeVersion,
            rangeRebuildVersion: priorLifecycle.rangeRebuildVersion,
            rebuildServiceVersion: priorLifecycle.rebuildServiceVersion,
            createdAt: priorLifecycle.createdAt,
            updatedAt: priorLifecycle.updatedAt,
          },
        });
      } else {
        await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId: 1 } });
      }
    }
  });

  it("uses PostgreSQL SKIP LOCKED, serializes two workers, and does not republish an already-current generation", async () => {
    const date = testDates[9]!;
    const prior = await saveHealthState();
    const releaseRowLock = deferred();
    const releaseFirst = deferred();
    let rowLockTransaction: Promise<void> | null = null;
    let firstWorker: Promise<boolean> | null = null;
    try {
      await markUnifiedV4Current();
      await seedPendingJob(date);

      const rowLocked = deferred();
      rowLockTransaction = prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "profileId" FROM "HealthSyncRefreshJob" WHERE "profileId" = 1 FOR UPDATE`;
        rowLocked.resolve();
        await releaseRowLock.promise;
      }, { maxWait: 5_000, timeout: 10_000 });
      await rowLocked.promise;
      await expect(claimNextHealthSyncRefreshJob()).resolves.toBeNull();
      releaseRowLock.resolve();
      await rowLockTransaction;

      const firstClaimed = deferred();
      firstWorker = processNextHealthSyncRefreshJob({
        afterClaim: async () => {
          firstClaimed.resolve();
          await releaseFirst.promise;
        },
      });
      await firstClaimed.promise;
      await expect(processNextHealthSyncRefreshJob()).resolves.toBe(false);
      releaseFirst.resolve();
      await expect(firstWorker).resolves.toBe(true);

      const completed = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(completed.completedGeneration).toBe(completed.requestedGeneration);
      expect(completed.attemptCount).toBe(1);
      expect(completed.leaseToken).toBeNull();
      expect(lifecycle.unifiedPublishedGeneration).toBe(lifecycle.invalidationGeneration);
      expect(lifecycle.productionPublishedGeneration).toBe(lifecycle.invalidationGeneration);
      await expect(processNextHealthSyncRefreshJob()).resolves.toBe(false);
      await expect(prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } }))
        .resolves.toMatchObject({ attemptCount: 1, completedGeneration: completed.requestedGeneration });
    } finally {
      releaseRowLock.resolve();
      releaseFirst.resolve();
      await Promise.allSettled([
        ...(rowLockTransaction ? [rowLockTransaction] : []),
        ...(firstWorker ? [firstWorker] : []),
      ]);
      await releaseHealthState(prior, date);
    }
  });

  it("holds the exact worker lease row through lifecycle mutation so expired takeover cannot race validation", async () => {
    const date = testDates[11]!;
    const prior = await saveHealthState();
    const locked = deferred();
    const releaseMutation = deferred();
    let mutation: Promise<void> | null = null;
    let fakeTime = false;
    try {
      await markUnifiedV4Current();
      await seedPendingJob(date);
      const oldLease = await claimNextHealthSyncRefreshJob();
      expect(oldLease).not.toBeNull();
      const oldQueue = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      const oldLeaseUntil = oldQueue.leaseUntil;
      if (!oldLeaseUntil) throw new Error("The claimed Health worker lease must have a database expiry.");
      const oldLastAttemptAt = oldQueue.lastAttemptAt;
      if (!oldLastAttemptAt) throw new Error("The claimed Health worker lease must record its claim time.");
      vi.useFakeTimers({ toFake: ["Date"] });
      fakeTime = true;
      vi.setSystemTime(oldLastAttemptAt);

      mutation = runWithHealthSyncRefreshWorkerLease(oldLease!, () => prisma.$transaction(async (transaction) => {
        const lifecycle = new PhysiologyV7PersistenceRepository(transaction);
        await lifecycle.lockProfile(1);
        await lifecycle.invalidateUnifiedPublication(1);
        locked.resolve();
        await releaseMutation.promise;
      }, { maxWait: 5_000, timeout: 10_000 }));
      await locked.promise;

      vi.setSystemTime(new Date(oldLeaseUntil.getTime() + 1));
      await expect(claimNextHealthSyncRefreshJob()).resolves.toBeNull();

      releaseMutation.resolve();
      await mutation;
      const afterMutation = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(afterMutation.unifiedPublishedGeneration).toBeNull();

      const newLease = await claimNextHealthSyncRefreshJob();
      expect(newLease).not.toBeNull();
      expect(newLease!.leaseToken).not.toBe(oldLease!.leaseToken);
      await expect(runWithHealthSyncRefreshWorkerLease(oldLease!, () => prisma.$transaction(async (transaction) => {
        await new PhysiologyV7PersistenceRepository(transaction).invalidateUnifiedPublication(1);
      }))).rejects.toMatchObject({ name: "HealthSyncRefreshWorkerLeaseLostError" });
      await expect(prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } }))
        .resolves.toMatchObject({
          stateVersion: afterMutation.stateVersion,
          unifiedPublishedGeneration: afterMutation.unifiedPublishedGeneration,
          updatedAt: afterMutation.updatedAt,
        });
    } finally {
      releaseMutation.resolve();
      if (mutation) await Promise.allSettled([mutation]);
      if (fakeTime) vi.useRealTimers();
      await releaseHealthState(prior, date);
    }
  });

  it("fences an old worker after a new sync and preserves the newer durable generation", async () => {
    const date = testDates[10]!;
    const prior = await saveHealthState();
    const firstBody = { date, steps: 701 };
    const secondBody = { date, steps: 702 };
    const auditStartedAt = new Date();
    const releaseOldWorker = deferred();
    const releaseStaleWorker = deferred();
    let oldWorker: Promise<boolean> | null = null;
    let staleWorker: Promise<boolean> | null = null;
    try {
      await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId: 1 } });
      expect((await POST(syncRequest([firstBody]))).status).toBe(200);
      const firstGeneration = (await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } })).requestedGeneration;
      await prisma.healthSyncRefreshJob.update({ where: { profileId: 1 }, data: { nextAttemptAt: new Date(0) } });
      await markUnifiedV4Current();

      const currentnessRead = deferred<boolean>();
      const oldWorkerRun = processNextHealthSyncRefreshJob({
        afterCurrentnessCheck: async (_job, alreadyCurrent) => {
          currentnessRead.resolve(alreadyCurrent);
          await releaseOldWorker.promise;
          if (!alreadyCurrent) throw new Error("Expected the stale-worker fixture to reach an already-current read.");
        },
      });
      oldWorker = oldWorkerRun;
      await expect(waitForWorkerBarrier(currentnessRead.promise, oldWorkerRun, "currentness hook")).resolves.toBe(true);

      expect((await POST(syncRequest([secondBody]))).status).toBe(200);
      const afterNewSync = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(afterNewSync.requestedGeneration).toBe(firstGeneration + 1);
      releaseOldWorker.resolve();
      await expect(oldWorker).resolves.toBe(true);

      const fenced = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(fenced.requestedGeneration).toBe(firstGeneration + 1);
      expect(fenced.completedGeneration).toBeLessThan(fenced.requestedGeneration);
      expect(fenced.leaseToken).toBeNull();
      expect(fenced.sourceDates).toContain(date);
      await expect(prisma.healthSyncSnapshot.findFirstOrThrow({
        where: { date }, orderBy: { id: "desc" }, select: { rawPayload: true },
      })).resolves.toMatchObject({ rawPayload: secondBody });

      // The fixture marks the new generation published; worker claim/ack below
      // is still real PostgreSQL logic and must not re-ingest or publish twice.
      await markUnifiedV4Current();
      await prisma.healthSyncRefreshJob.update({ where: { profileId: 1 }, data: { nextAttemptAt: new Date(0) } });
      const beforeGeneration = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
      const beforeAttemptCount = (await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } })).attemptCount;
      const staleWorkerCurrent = deferred<boolean>();
      const staleWorkerRun = processNextHealthSyncRefreshJob({
        afterCurrentnessCheck: async (_job, alreadyCurrent) => {
          staleWorkerCurrent.resolve(alreadyCurrent);
          await releaseStaleWorker.promise;
          if (!alreadyCurrent) throw new Error("Expected the stale-worker fixture to reach an already-current recovery read.");
        },
      });
      staleWorker = staleWorkerRun;
      await expect(waitForWorkerBarrier(staleWorkerCurrent.promise, staleWorkerRun, "recovery currentness hook")).resolves.toBe(true);
      await prisma.healthSyncRefreshJob.update({ where: { profileId: 1 }, data: {
        leaseUntil: new Date(Date.now() - 1_000), nextAttemptAt: new Date(0),
      } });
      await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);
      const afterTakeover = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(afterTakeover.completedGeneration).toBe(afterTakeover.requestedGeneration);
      expect(afterTakeover.attemptCount).toBe(beforeAttemptCount + 2);
      releaseStaleWorker.resolve();
      await expect(staleWorker).resolves.toBe(true);
      const recovered = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(recovered.completedGeneration).toBe(recovered.requestedGeneration);
      expect(recovered.attemptCount).toBe(beforeAttemptCount + 2);
      expect(recovered.leaseToken).toBeNull();
      await expect(processNextHealthSyncRefreshJob()).resolves.toBe(false);
      await expect(prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } }))
        .resolves.toMatchObject({ attemptCount: beforeAttemptCount + 2, completedGeneration: recovered.requestedGeneration });
      const afterGeneration = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(afterGeneration.invalidationGeneration).toBe(beforeGeneration.invalidationGeneration);
      expect(afterGeneration.unifiedPublishedGeneration).toBe(beforeGeneration.unifiedPublishedGeneration);
      await expect(prisma.healthSyncSnapshot.findFirstOrThrow({
        where: { date }, orderBy: { id: "desc" }, select: { rawPayload: true },
      })).resolves.toMatchObject({ rawPayload: secondBody });
    } finally {
      releaseOldWorker.resolve();
      releaseStaleWorker.resolve();
      await Promise.allSettled([
        ...(oldWorker ? [oldWorker] : []),
        ...(staleWorker ? [staleWorker] : []),
      ]);
      const audit = await prisma.healthSyncAudit.findFirst({
        where: { rawBody: JSON.stringify({ days: [secondBody] }), receivedAt: { gte: auditStartedAt } },
        orderBy: { id: "desc" }, select: { id: true },
      });
      if (audit) await prisma.healthSyncAudit.deleteMany({ where: { id: audit.id } });
      await releaseHealthState(prior, date);
    }
  });

  it("recovers crash and transient DB failure, publishes once, and fences a stale worker after takeover", async () => {
    const date = "2050-01-01";
    const prior = await saveHealthState();
    const priorActiveEpisodes = await prisma.modelEpisode.findMany({ where: { active: true }, select: { id: true, deactivatedAt: true } });
    const syntheticDay = { date, steps: 888 };
    const auditStartedAt = new Date();
    let modelFixture: Awaited<ReturnType<typeof preparePublishedModelForHealthWorker>> | null = null;
    let fakeTime = false;
    const sequenceName = "health_sync_retry_once_seq";
    const functionName = "health_sync_retry_once_fn";
    const triggerName = "health_sync_retry_once_trigger";
    const publicationSequenceName = "health_sync_publication_witness_seq";
    const publicationFunctionName = "health_sync_publication_witness_fn";
    const publicationTriggerName = "health_sync_publication_witness_trigger";
    const publicationCompleted = deferred();
    const releasePublishedWorker = deferred();
    let publishedWorker: Promise<boolean> | null = null;
    let publishedCurrentness: boolean | null = null;
    try {
      await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId: 1 } });
      modelFixture = await preparePublishedModelForHealthWorker(date);
      vi.useFakeTimers({ toFake: ["Date"] });
      fakeTime = true;
      vi.setSystemTime(modelFixture.now);
      const initiallyPublished = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(initiallyPublished).toMatchObject({ unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        productionStaleFromDate: null, productionPublishedGeneration: initiallyPublished.invalidationGeneration,
        unifiedPublishedGeneration: initiallyPublished.invalidationGeneration,
        unifiedPublishedRolloutEpoch: initiallyPublished.unifiedRolloutEpoch });
      const response = await POST(syncRequest([syntheticDay]));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: "ok", modelPublicationStatus: "stale", received: 1 });
      const persistedRawPayload = (await prisma.healthSyncSnapshot.findFirstOrThrow({
        where: { date }, orderBy: { id: "desc" }, select: { rawPayload: true },
      })).rawPayload;
      expect(persistedRawPayload).toEqual(syntheticDay);

      // A one-shot PostgreSQL serialization failure exercises durable retry.
      // Sequence values survive the failed worker transaction, so the retry passes.
      await prisma.$executeRawUnsafe(`CREATE SEQUENCE "${sequenceName}"`);
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF nextval('${sequenceName}') = 1 THEN
            RAISE EXCEPTION 'synthetic transient lifecycle refresh failure' USING ERRCODE = '40001';
          END IF;
          RETURN NEW;
        END;
      $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON "PhysiologyV7Lifecycle"
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
      await prisma.$executeRawUnsafe(`CREATE SEQUENCE "${publicationSequenceName}"`);
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "${publicationFunctionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM nextval('${publicationSequenceName}');
          RETURN NEW;
        END;
      $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${publicationTriggerName}" AFTER INSERT OR UPDATE ON "UnifiedExperimentalPhysiologyStateV2"
        FOR EACH ROW EXECUTE FUNCTION "${publicationFunctionName}"()`);

      // Persist a claim without running worker logic, modeling process crash.
      // Health sync intentionally debounces refresh work for three seconds;
      // make the durable job eligible now so this test exercises claim/recovery.
      await prisma.healthSyncRefreshJob.update({ where: { profileId: 1 }, data: { nextAttemptAt: new Date(0) } });
      const crashedOwner = await claimNextHealthSyncRefreshJob();
      expect(crashedOwner).not.toBeNull();
      const persistedLease = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(persistedLease.leaseToken).toBe(crashedOwner!.leaseToken);
      expect(persistedLease.completedGeneration).toBeLessThan(persistedLease.requestedGeneration);
      await prisma.healthSyncRefreshJob.update({ where: { profileId: 1 }, data: {
        leaseUntil: new Date(Date.now() - 1_000), nextAttemptAt: new Date(0),
      } });
      await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);
      let retry = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(retry.completedGeneration).toBeLessThan(retry.requestedGeneration);
      expect(retry.leaseToken).toBeNull();
      expect(retry.lastErrorType).not.toBeNull();
      expect(retry.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

      await prisma.healthSyncRefreshJob.update({ where: { profileId: 1 }, data: { nextAttemptAt: new Date(0) } });
      publishedWorker = processNextHealthSyncRefreshJob({
        afterCurrentnessCheck: async (_job, alreadyCurrent) => { publishedCurrentness = alreadyCurrent; },
        afterPublicationBeforeAcknowledge: async () => {
          publicationCompleted.resolve();
          await releasePublishedWorker.promise;
        },
      });
      const reachedPublication = await Promise.race([
        publicationCompleted.promise.then(() => true),
        publishedWorker.then(() => false),
      ]);
      if (!reachedPublication) {
        const queue = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
        const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
        const healthBlocks = await prisma.unifiedPublicationBlock.count({ where: { profileId: 1, source: "health" } });
        throw new Error(`Health worker skipped publication: alreadyCurrent=${publishedCurrentness}, `
          + `completedGeneration=${queue.completedGeneration}, requestedGeneration=${queue.requestedGeneration}, `
          + `lastErrorType=${queue.lastErrorType}, healthBlocks=${healthBlocks}, `
          + `publishedGeneration=${lifecycle.unifiedPublishedGeneration}, invalidationGeneration=${lifecycle.invalidationGeneration}.`);
      }
      const publishedQueue = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      const publishedLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(publishedQueue.completedGeneration).toBeLessThan(publishedQueue.requestedGeneration);
      expect(publishedQueue.leaseToken).not.toBeNull();
      expect(publishedLifecycle.unifiedTargetRevision).toBe(UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION);
      expect(publishedLifecycle.productionStaleFromDate).toBeNull();
      expect(publishedLifecycle.productionPublishedGeneration).toBe(publishedLifecycle.invalidationGeneration);
      expect(publishedLifecycle.unifiedPublishedGeneration).toBe(publishedLifecycle.invalidationGeneration);
      expect(publishedLifecycle.unifiedPublishedRolloutEpoch).toBe(publishedLifecycle.unifiedRolloutEpoch);
      expect(await prisma.unifiedPublicationBlock.count({ where: { profileId: 1 } })).toBe(0);
      const firstPublicationWrites = await prisma.$queryRawUnsafe<Array<{ last_value: bigint }>>(
        `SELECT last_value FROM "${publicationSequenceName}"`);
      expect(Number(firstPublicationWrites[0]?.last_value ?? 0)).toBeGreaterThan(0);

      // Crash after publication and before acknowledgement. The takeover sees
      // fresh currentness and acknowledges without repeating publication.
      await prisma.healthSyncRefreshJob.update({ where: { profileId: 1 }, data: {
        leaseUntil: new Date(Date.now() - 1_000), nextAttemptAt: new Date(0),
      } });
      await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);
      const acknowledged = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      const afterTakeoverLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(acknowledged.completedGeneration).toBe(acknowledged.requestedGeneration);
      expect(acknowledged.leaseToken).toBeNull();
      expect(acknowledged.attemptCount).toBe(4);
      expect(afterTakeoverLifecycle.invalidationGeneration).toBe(publishedLifecycle.invalidationGeneration);
      expect(afterTakeoverLifecycle.unifiedPublishedGeneration).toBe(publishedLifecycle.unifiedPublishedGeneration);
      const takeoverPublicationWrites = await prisma.$queryRawUnsafe<Array<{ last_value: bigint }>>(
        `SELECT last_value FROM "${publicationSequenceName}"`);
      expect(takeoverPublicationWrites[0]?.last_value).toBe(firstPublicationWrites[0]?.last_value);
      releasePublishedWorker.resolve();
      await expect(publishedWorker).resolves.toBe(true);
      await expect(processNextHealthSyncRefreshJob()).resolves.toBe(false);
      retry = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(retry).toMatchObject({ requestedGeneration: acknowledged.requestedGeneration,
        completedGeneration: acknowledged.completedGeneration, attemptCount: acknowledged.attemptCount,
        leaseToken: null, lastErrorType: null });
      expect((await prisma.healthSyncSnapshot.findFirstOrThrow({
        where: { date }, orderBy: { id: "desc" }, select: { rawPayload: true },
      })).rawPayload).toEqual(persistedRawPayload);
    } finally {
      releasePublishedWorker.resolve();
      await Promise.allSettled([...(publishedWorker ? [publishedWorker] : [])]);
      try {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${publicationTriggerName}" ON "UnifiedExperimentalPhysiologyStateV2"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${publicationFunctionName}"()`);
        await prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS "${publicationSequenceName}"`);
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "PhysiologyV7Lifecycle"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
        await prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS "${sequenceName}"`);
        const audit = await prisma.healthSyncAudit.findFirst({
          where: { rawBody: JSON.stringify({ days: [syntheticDay] }), receivedAt: { gte: auditStartedAt } },
          orderBy: { id: "desc" }, select: { id: true },
        });
        if (audit) await prisma.healthSyncAudit.deleteMany({ where: { id: audit.id } });
        if (modelFixture) await removePublishedModelForHealthWorker(modelFixture);
        for (const episode of priorActiveEpisodes) {
          await prisma.modelEpisode.update({ where: { id: episode.id }, data: { active: true, deactivatedAt: episode.deactivatedAt } });
        }
      } finally {
        await releaseHealthState(prior, date);
        if (fakeTime) vi.useRealTimers();
      }
    }
  }, 60_000);

  it("completes Training edits through Health coordination, stale-worker fencing, and restart recovery", async () => {
    const date = "2026-10-01";
    const priorHealth = await saveHealthState();
    const priorTraining = await saveTrainingRefreshState();
    const priorActiveEpisodes = await prisma.modelEpisode.findMany({
      where: { active: true }, select: { id: true, deactivatedAt: true },
    });
    let modelFixture: Awaited<ReturnType<typeof preparePublishedModelForHealthWorker>> | null = null;
    let sessionId: number | null = null;
    let activeSessionId: number | null = null;
    const operationId = randomUUID();
    try {
      await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId: 1 } });
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId: 1 } });
      await prisma.trainingSourceChange.deleteMany({ where: { profileId: 1 } });
      await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId: 1 } });
      await assertPublishedModelRangeIsEmpty(addCalendarDays(date, -89), addCalendarDays(date, 10));
      modelFixture = await preparePublishedModelForHealthWorker(date);

      const session = await trainingRepository.createSessionSnapshot({
        profileId: 1,
        programId: null,
        programVersionId: null,
        status: SESSION_STATUS.COMPLETED,
        entryMode: ENTRY_MODE.RETROSPECTIVE,
        webStartedAt: null,
        webEndedAt: null,
        effectiveAccountingAt: new Date(`${date}T15:00:00.000Z`),
        accountingTimeZone: "Europe/Bratislava",
        accountingTimeZoneProvenance: "integration-test",
        exercises: [{
          sourceExerciseCatalogId: null,
          snapshotExerciseName: "Synthetic Bodyweight Press",
          sortOrder: 0,
          plannedSets: 1,
          resistanceType: RESISTANCE.BODYWEIGHT,
          origin: "EXTRA",
          muscleMappingSnapshot: Prisma.JsonNull,
          loadAccountingConfigSnapshot: null,
        }],
      });
      sessionId = session.id;
      const exerciseId = session.exercises[0]!.id;
      const createdSet = await trainingService.createSet(session.id, exerciseId, { reps: 10 }, 1, operationId);
      const initialRawSet = await prisma.strengthSet.findUniqueOrThrow({ where: { id: createdSet.id } });

      await trainingService.updateSet(session.id, createdSet.id, { reps: 2 }, 1);
      const primaryCommit = await prisma.strengthSet.findUniqueOrThrow({ where: { id: createdSet.id } });
      expect(primaryCommit.reps).toBe(2);
      expect(primaryCommit.weightKg).toEqual(initialRawSet.weightKg);
      expect(primaryCommit.loadAccountingOverride).toEqual(initialRawSet.loadAccountingOverride);
      const pendingSessionRead = await trainingRepository.getSession(session.id, 1);
      expect(pendingSessionRead?.selectedActiveEnergy).toMatchObject({
        kcal: null,
        source: "unavailable",
        fullCoverage: false,
        resolutionRevision: null,
      });
      // This fixture has never materialized a load-accounting snapshot, so its
      // correct snapshot state is missing; the pending Training generation is
      // asserted separately below. Both derived load DTOs remain unavailable.
      expect(pendingSessionRead?.materializationState).toBe("missing");
      expect(pendingSessionRead?.loadAccountingV1).toBeUndefined();
      expect(pendingSessionRead?.loadAccountingBreakdown).toBeUndefined();
      expect(pendingSessionRead?.activeEnergyMassReference).toBeNull();
      let trainingQueue = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(trainingQueue.requestedGeneration).toBeGreaterThan(trainingQueue.completedGeneration);
      expect(trainingQueue.dueAt?.getTime()).toBeGreaterThan(Date.now() + 100_000);
      expect(await getModelStatus(modelFixture.episodeId)).toMatchObject({ productionCurrent: false, latestModeledDate: null });
      const trainingDueAtBeforeHealth = trainingQueue.dueAt;

      // Health can finish its own dependencies while Training owns final
      // publication, avoiding a mutual wait on their durable source blocks.
      const healthResponse = await POST(syncRequest([{ date, steps: 9_321 }]));
      expect(healthResponse.status).toBe(200);
      await prisma.healthSyncRefreshJob.update({ where: { profileId: 1 }, data: { nextAttemptAt: new Date(0) } });
      await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);
      const completedHealthQueue = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(completedHealthQueue.completedGeneration).toBe(completedHealthQueue.requestedGeneration);
      expect(await prisma.unifiedPublicationBlock.count({ where: { profileId: 1, source: "health" } })).toBe(0);
      trainingQueue = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(trainingQueue.completedGeneration).toBeLessThan(trainingQueue.requestedGeneration);
      expect(trainingQueue.dueAt).toEqual(trainingDueAtBeforeHealth);

      const activeSession = await trainingRepository.createSessionSnapshot({
        profileId: 1,
        programId: null,
        programVersionId: null,
        status: SESSION_STATUS.ACTIVE,
        entryMode: ENTRY_MODE.LIVE,
        webStartedAt: new Date(`${date}T16:00:00.000Z`),
        webEndedAt: null,
        effectiveAccountingAt: new Date(`${date}T16:00:00.000Z`),
        accountingTimeZone: "Europe/Bratislava",
        accountingTimeZoneProvenance: "integration-test",
        exercises: [{
          sourceExerciseCatalogId: null,
          snapshotExerciseName: "Synthetic Active Bodyweight Press",
          sortOrder: 0,
          plannedSets: 1,
          resistanceType: RESISTANCE.BODYWEIGHT,
          origin: "EXTRA",
          muscleMappingSnapshot: Prisma.JsonNull,
          loadAccountingConfigSnapshot: null,
        }],
      });
      activeSessionId = activeSession.id;
      trainingQueue = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      const pendingActiveSessionRead = await trainingRepository.getActiveSession(1);
      expect(pendingActiveSessionRead?.id).toBe(activeSession.id);
      expect(pendingActiveSessionRead?.selectedActiveEnergy?.source).toBe("unavailable");
      // This active session also has no accounting snapshot yet; its snapshot
      // state is missing while shared model-derived energy is gated separately.
      expect(pendingActiveSessionRead?.materializationState).toBe("missing");

      await prisma.trainingRefreshJob.update({ where: { profileId: 1 }, data: {
        dueAt: new Date(0), nextAttemptAt: new Date(0),
      } });
      const claimReached = deferred<void>();
      const releaseClaim = deferred<void>();
      const staleAttempt = processNextTrainingRefreshJob({
        afterClaim: async () => {
          claimReached.resolve();
          await releaseClaim.promise;
        },
      });
      await claimReached.promise;
      await trainingService.updateSet(session.id, createdSet.id, { reps: 3 }, 1);
      releaseClaim.resolve();
      await expect(staleAttempt).resolves.toBe(true);
      trainingQueue = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(trainingQueue.completedGeneration).toBeLessThan(trainingQueue.requestedGeneration);
      expect(trainingQueue.leaseToken).toBeNull();
      expect(await getModelStatus(modelFixture.episodeId)).toMatchObject({ productionCurrent: false, latestModeledDate: null });
      let currentTrainingQueue = trainingQueue;

      // A crash after claim leaves the overdue dueAt intact. Lease expiry lets
      // a restarted poller reclaim it immediately without a fresh debounce.
      await trainingService.updateSet(session.id, createdSet.id, { reps: 4 }, 1);
      await prisma.trainingRefreshJob.update({ where: { profileId: 1 }, data: {
        dueAt: new Date(0), nextAttemptAt: new Date(0),
      } });
      await expect(processNextTrainingRefreshJob({
        afterClaim: async () => { throw new Error("synthetic process crash after claim"); },
      })).rejects.toThrow("synthetic process crash after claim");
      const crashedLease = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(crashedLease.completedGeneration).toBeLessThan(crashedLease.requestedGeneration);
      expect(crashedLease.dueAt?.getTime()).toBe(0);
      await prisma.trainingRefreshJob.update({ where: { profileId: 1 }, data: {
        leaseUntil: new Date(Date.now() - 1_000), nextAttemptAt: new Date(0),
      } });
      await expect(processNextTrainingRefreshJob()).resolves.toBe(true);
      currentTrainingQueue = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      for (let recoveryAttempt = 0;
          recoveryAttempt < 3 && currentTrainingQueue.completedGeneration < currentTrainingQueue.requestedGeneration;
          recoveryAttempt += 1) {
        await prisma.trainingRefreshJob.update({ where: { profileId: 1 }, data: {
          dueAt: new Date(0), nextAttemptAt: new Date(0), leaseUntil: new Date(0),
        } });
        await expect(processNextTrainingRefreshJob()).resolves.toBe(true);
        currentTrainingQueue = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      }
      expect(currentTrainingQueue.completedGeneration, JSON.stringify({
        requestedGeneration: currentTrainingQueue.requestedGeneration,
        lastProgressStage: currentTrainingQueue.lastProgressStage,
        lastErrorType: currentTrainingQueue.lastErrorType,
        lastErrorAt: currentTrainingQueue.lastErrorAt,
      })).toBe(currentTrainingQueue.requestedGeneration);
      expect(currentTrainingQueue.completedGeneration).toBe(currentTrainingQueue.requestedGeneration);
      expect((await prisma.strengthSet.findUniqueOrThrow({ where: { id: createdSet.id } })).reps).toBe(4);
      expect(await getModelStatus(modelFixture.episodeId)).toMatchObject({ productionCurrent: true });
      expect(await prisma.unifiedPublicationBlock.count({ where: { profileId: 1 } })).toBe(0);
    } finally {
      if (activeSessionId !== null) await prisma.strengthDiarySession.deleteMany({ where: { id: activeSessionId, profileId: 1 } });
      if (sessionId !== null) await prisma.strengthDiarySession.deleteMany({ where: { id: sessionId, profileId: 1 } });
      await prisma.trainingSetCreateOperation.deleteMany({ where: { profileId: 1, operationId } });
      if (modelFixture) await removePublishedModelForHealthWorker(modelFixture);
      for (const episode of priorActiveEpisodes) {
        await prisma.modelEpisode.update({ where: { id: episode.id }, data: { active: true, deactivatedAt: episode.deactivatedAt } });
      }
      await releaseHealthState(priorHealth, date);
      await restoreTrainingRefreshState(priorTraining);
    }
  }, 900_000);

  it("rejects a stale worker mutation after recovery currentness passes under the profile fence", async () => {
    const date = "2050-02-01";
    const prior = await saveHealthState();
    const priorActiveEpisodes = await prisma.modelEpisode.findMany({ where: { active: true }, select: { id: true, deactivatedAt: true } });
    const firstDay = { date, steps: 1_101 };
    const newerDay = { date, steps: 1_102 };
    const auditStartedAt = new Date();
    let modelFixture: Awaited<ReturnType<typeof preparePublishedModelForHealthWorker>> | null = null;
    let fakeTime = false;
    const leaseChecked = deferred();
    const releaseStaleWorker = deferred();
    const recoveryLockHeld = deferred();
    const releaseRecoveryLock = deferred();
    let staleWorker: Promise<boolean> | null = null;
    let recoveryFence: Promise<void> | null = null;
    try {
      await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId: 1 } });
      modelFixture = await preparePublishedModelForHealthWorker(date);
      vi.useFakeTimers({ toFake: ["Date"] });
      fakeTime = true;
      vi.setSystemTime(modelFixture.now);

      expect((await POST(syncRequest([firstDay]))).status).toBe(200);
      const firstGeneration = (await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } })).requestedGeneration;
      await prisma.healthSyncRefreshJob.update({ where: { profileId: 1 }, data: { nextAttemptAt: new Date(0) } });
      staleWorker = processNextHealthSyncRefreshJob({
        beforeDependentRefresh: async () => {
          // This hook runs after the stale lease was renewed, immediately
          // before the worker's first lifecycle-locked mutation.
          leaseChecked.resolve();
          await releaseStaleWorker.promise;
        },
      });
      await leaseChecked.promise;

      expect((await POST(syncRequest([newerDay]))).status).toBe(200);
      const afterNewSync = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(afterNewSync.requestedGeneration).toBe(firstGeneration + 1);
      await prisma.healthSyncRefreshJob.update({ where: { profileId: 1 }, data: {
        leaseUntil: new Date(Date.now() - 1_000), nextAttemptAt: new Date(0),
      } });
      await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);

      const recoveryQueue = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      const recoveryLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(recoveryQueue.lastErrorType).toBeNull();
      expect(recoveryQueue.completedGeneration).toBe(recoveryQueue.requestedGeneration);
      expect(recoveryQueue.leaseToken).toBeNull();
      expect(recoveryLifecycle).toMatchObject({ productionStaleFromDate: null,
        productionPublishedGeneration: recoveryLifecycle.invalidationGeneration,
        unifiedPublishedGeneration: recoveryLifecycle.invalidationGeneration,
        unifiedPublishedRolloutEpoch: recoveryLifecycle.unifiedRolloutEpoch,
        unifiedPublicationBlockedFromDate: null });

      recoveryFence = prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`WITH acquired AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(${PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE}::integer, 1::integer)
        ) SELECT 1::integer FROM acquired`;
        const [queue, lifecycle] = await Promise.all([
          transaction.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } }),
          transaction.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } }),
        ]);
        expect(queue.completedGeneration).toBe(queue.requestedGeneration);
        expect(queue.leaseToken).toBeNull();
        expect(lifecycle.productionStaleFromDate).toBeNull();
        expect(lifecycle.productionPublishedGeneration).toBe(lifecycle.invalidationGeneration);
        expect(lifecycle.unifiedPublishedGeneration).toBe(lifecycle.invalidationGeneration);
        expect(lifecycle.unifiedPublishedRolloutEpoch).toBe(lifecycle.unifiedRolloutEpoch);
        expect(lifecycle.unifiedPublicationBlockedFromDate).toBeNull();
        recoveryLockHeld.resolve();
        await releaseRecoveryLock.promise;
      }, { maxWait: 5_000, timeout: 10_000 });
      await recoveryLockHeld.promise;
      releaseRecoveryLock.resolve();
      await recoveryFence;

      // The old worker resumes only after the recovery gate released the
      // profile lock. Its exact generation/token is checked after reacquiring it,
      // inside the same transaction that would have changed lifecycle state.
      const lifecycleBeforeStaleResume = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
      releaseStaleWorker.resolve();
      await expect(staleWorker).resolves.toBe(true);
      const finalQueue = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      const finalLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(finalQueue).toMatchObject({ requestedGeneration: recoveryQueue.requestedGeneration,
        completedGeneration: recoveryQueue.completedGeneration, leaseToken: null, lastErrorType: null });
      expect(finalLifecycle.updatedAt).toEqual(lifecycleBeforeStaleResume.updatedAt);
      expect(await prisma.unifiedPublicationBlock.count({ where: { profileId: 1, source: "health" } })).toBe(0);
      await expect(prisma.healthSyncSnapshot.findFirstOrThrow({
        where: { date }, orderBy: { id: "desc" }, select: { rawPayload: true },
      })).resolves.toMatchObject({ rawPayload: newerDay });
    } finally {
      releaseStaleWorker.resolve();
      releaseRecoveryLock.resolve();
      await Promise.allSettled([
        ...(staleWorker ? [staleWorker] : []),
        ...(recoveryFence ? [recoveryFence] : []),
      ]);
      try {
        const audit = await prisma.healthSyncAudit.findFirst({
          where: { rawBody: JSON.stringify({ days: [newerDay] }), receivedAt: { gte: auditStartedAt } },
          orderBy: { id: "desc" }, select: { id: true },
        });
        if (audit) await prisma.healthSyncAudit.deleteMany({ where: { id: audit.id } });
        if (modelFixture) await removePublishedModelForHealthWorker(modelFixture);
        for (const episode of priorActiveEpisodes) {
          await prisma.modelEpisode.update({ where: { id: episode.id }, data: { active: true, deactivatedAt: episode.deactivatedAt } });
        }
      } finally {
        await releaseHealthState(prior, date);
        if (fakeTime) vi.useRealTimers();
      }
    }
  }, 60_000);

  it("blocks a Health sync source transaction behind the recovery exclusive fence", async () => {
    const date = testDates[9]!;
    const prior = await saveHealthState();
    const lockHeld = deferred();
    const releaseLock = deferred();
    let responseSettled = false;
    const recoveryFence = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`WITH acquired AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(${PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE}::integer, 1::integer)
      ) SELECT 1::integer FROM acquired`;
      lockHeld.resolve();
      await releaseLock.promise;
    }, { maxWait: 5_000, timeout: 10_000 });
    try {
      await lockHeld.promise;
      const responsePromise = POST(syncRequest([{ date, steps: 909 }])).then((response) => {
        responseSettled = true;
        return response;
      });
      await waitForProfileAdvisoryLockWaiter();
      expect(responseSettled).toBe(false);
      releaseLock.resolve();
      await recoveryFence;
      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(await prisma.healthSyncSnapshot.count({ where: { date } })).toBeGreaterThan(0);
    } finally {
      releaseLock.resolve();
      await recoveryFence.catch(() => undefined);
      await releaseHealthState(prior, date);
    }
  });

  it("holds V4 source invalidation behind the recovery currentness fence", async () => {
    const date = testDates[11]!;
    const prior = await saveHealthState();
    await markUnifiedV4Current();
    const before = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    const lockHeld = deferred();
    const releaseLock = deferred();
    const recoveryFence = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`WITH acquired AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(${PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE}::integer, 1::integer)
      ) SELECT 1::integer FROM acquired`;
      lockHeld.resolve();
      await releaseLock.promise;
    }, { maxWait: 5_000, timeout: 10_000 });
    try {
      await lockHeld.promise;
      const invalidationStarted = deferred<number>();
      let invalidationSettled = false;
      const invalidation = prisma.$transaction(async (transaction) => {
        const backend = await transaction.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        invalidationStarted.resolve(backend[0]!.pid);
        return new PhysiologyV7PersistenceRepository(transaction).invalidate(1, date);
      }).then((result) => { invalidationSettled = true; return result; });
      const invalidationPid = await invalidationStarted.promise;
      await waitForProfileAdvisoryLockWaiter(invalidationPid);
      expect(invalidationSettled).toBe(false);
      releaseLock.resolve();
      await recoveryFence;
      const result = await invalidation;
      expect(result.invalidationGeneration).toBe(before.invalidationGeneration + 1);
      expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } }))
        .invalidationGeneration).toBe(before.invalidationGeneration + 1);
    } finally {
      releaseLock.resolve();
      await recoveryFence.catch(() => undefined);
      await releaseHealthState(prior, date);
    }
  });

  it("preserves Garmin workout identity while History edits metrics and adds, updates, or removes a manual workout", async () => {
    const date = testDates[12]!;
    const prior = await saveHealthState();
    const externalId = "garmin-history-preservation-2043-01-07";
    const garminStart = new Date(`${date}T07:00:00.000Z`);
    const garminEnd = new Date(`${date}T07:30:00.000Z`);
    const repository = new DailyMetricRepository(prisma);
    try {
      await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
      await prisma.healthActivityInterval.deleteMany({ where: { date } });
      await deleteDailyHealthRows(prisma, date);
      const sourceDay = {
        date,
        steps: 11_000,
        strengthTrainingMinutes: 15,
        activeEnergyKcal: 100,
        workouts: [{
          externalId,
          type: "Running",
          startAt: garminStart.toISOString(),
          endAt: garminEnd.toISOString(),
          durationMinutes: 30,
          activeEnergyKcal: 280,
        }],
      };
      const sourceResponse = await POST(syncRequest([sourceDay]));
      expect(sourceResponse.status).toBe(200);
      const healthDay = await prisma.dailyHealthData.findUniqueOrThrow({
        where: { date },
        select: { id: true, updatedAt: true, workouts: { select: { id: true, createdAt: true, updatedAt: true, sourceIdentity: true, externalId: true, syncProtected: true } } },
      });
      const garmin = healthDay.workouts[0]!;
      expect(garmin).toMatchObject({ externalId, syncProtected: false });

      const stepper = await prisma.workout.create({
        data: {
          dailyHealthDataId: healthDay.id,
          sourceIdentity: `${MANUAL_STEPPER_SOURCE_PREFIX}history-preservation-2043-01-07`,
          type: "Stair climbing",
          startAt: new Date(`${date}T09:00:00.000Z`),
          endAt: new Date(`${date}T09:20:00.000Z`),
          durationMinutes: 20,
          manualStepCount: 1_200,
          manualActiveEnergyKcal: 70,
        },
      });
      const stepperBefore = await prisma.workout.findUniqueOrThrow({ where: { id: stepper.id } });

      await repository.update(date, { steps: 12_345 });
      const afterMetricEdit = await prisma.workout.findUniqueOrThrow({ where: { id: garmin.id } });
      expect(afterMetricEdit).toMatchObject({
        id: garmin.id,
        externalId,
        sourceIdentity: garmin.sourceIdentity,
        startAt: garminStart,
        endAt: garminEnd,
        activeEnergyKcal: 280,
        syncProtected: false,
        createdAt: garmin.createdAt,
        updatedAt: garmin.updatedAt,
      });

      const manualStartAt = `${date}T17:00:00.000Z`;
      const initialRead = await repository.listWithTrainingFacts({ from: date, to: date, limit: 30, offset: 0, includeTrainingDays: true });
      const syncedProjection = initialRead.days[0]!.workouts.find((workout) => workout.id === garmin.id);
      expect(syncedProjection).toMatchObject({ id: garmin.id, syncProtected: false, manualEditable: false });
      expect(initialRead.days[0]!.workouts.find((workout) => workout.id === stepper.id)).toMatchObject({ manualEditable: false });
      const savedWithManual = await repository.update(date, {
        steps: 13_000,
        // Simulate the History editor re-posting the visible feed projection beside a new manual row.
        workouts: [
          { type: "Running", startAt: garminStart.toISOString(), durationMinutes: 30, activeEnergyKcal: 280 },
          { type: "Strength training", startAt: manualStartAt, durationMinutes: 45, activeEnergyKcal: 190 },
        ],
      });
      expect(savedWithManual?.workouts).toHaveLength(3);
      expect(savedWithManual?.workouts.find((workout) => workout.id === garmin.id)).toMatchObject({ syncProtected: false, manualEditable: false });
      expect(savedWithManual?.workouts.find((workout) => workout.id === stepper.id)).toMatchObject({ manualEditable: false });
      const manualProjection = savedWithManual?.workouts.find((workout) => workout.type === "Strength training");
      expect(manualProjection).toMatchObject({ manualEditable: true, syncProtected: true });
      expect(savedWithManual?.strengthTrainingMinutes).toBeNull();
      expect(savedWithManual?.activeEnergyKcal).toBeNull();
      const manual = await prisma.workout.findFirstOrThrow({ where: { dailyHealthDataId: healthDay.id, sourceIdentity: { startsWith: MANUAL_HISTORY_SOURCE_PREFIX } } });
      const manualCreatedAt = manual.createdAt;
      const manualIdentity = manual.sourceIdentity;

      await POST(syncRequest([sourceDay]));
      expect(await prisma.workout.findUnique({ where: { id: manual.id } })).toMatchObject({ id: manual.id, sourceIdentity: manualIdentity });
      expect(await prisma.workout.findUnique({ where: { id: garmin.id } })).toMatchObject({
        id: garmin.id, externalId, sourceIdentity: garmin.sourceIdentity, startAt: garminStart, endAt: garminEnd,
      });

      await repository.update(date, {
        workouts: [{ id: manual.id, type: "Strength training", startAt: manualStartAt, durationMinutes: 45, activeEnergyKcal: 220 }],
      });
      const updatedManual = await prisma.workout.findUniqueOrThrow({ where: { id: manual.id } });
      expect(updatedManual).toMatchObject({ id: manual.id, activeEnergyKcal: 220, createdAt: manualCreatedAt, sourceIdentity: manualIdentity });
      expect(await prisma.workout.count({ where: { dailyHealthDataId: healthDay.id } })).toBe(3);

      await repository.update(date, { workouts: [] });
      expect(await prisma.workout.findMany({ where: { dailyHealthDataId: healthDay.id }, orderBy: { id: "asc" }, select: { id: true, externalId: true, sourceIdentity: true, syncProtected: true } }))
        .toEqual([
          { id: garmin.id, externalId, sourceIdentity: garmin.sourceIdentity, syncProtected: false },
          { id: stepper.id, externalId: null, sourceIdentity: stepperBefore.sourceIdentity, syncProtected: false },
        ]);
      expect(await prisma.workout.findUnique({ where: { id: stepper.id } })).toMatchObject({
        id: stepper.id,
        sourceIdentity: stepperBefore.sourceIdentity,
        manualStepCount: 1_200,
        manualActiveEnergyKcal: 70,
        updatedAt: stepperBefore.updatedAt,
      });
      const historyRead = await repository.listWithTrainingFacts({ from: date, to: date, limit: 30, offset: 0, includeTrainingDays: true });
      expect(historyRead.days[0]?.workouts.find((workout) => workout.id === garmin.id)).toMatchObject({ id: garmin.id, syncProtected: false });
    } finally {
      await releaseHealthState(prior, date);
    }
  });

  it("fails closed for ambiguous legacy fingerprint workouts and preserves them through History and the next feed", async () => {
    const date = testDates[9]!;
    const prior = await saveHealthState();
    const startAt = `${date}T07:00:00.000Z`;
    const endAt = `${date}T07:30:00.000Z`;
    const repository = new DailyMetricRepository(prisma);
    const sourceDay = {
      date,
      steps: 8_000,
      workouts: [{ type: "Running", startAt, endAt, durationMinutes: 30, activeEnergyKcal: 280 }],
    };
    const exactFeedWithExternalId = {
      ...sourceDay,
      workouts: [{ ...sourceDay.workouts[0]!, externalId: "legacy-fingerprint-feed-2040-01-10" }],
    };
    try {
    const firstSync = await POST(syncRequest([sourceDay]));
    expect(firstSync.status).toBe(200);
    const legacy = await prisma.workout.findFirstOrThrow({
      where: { dailyHealthData: { date } },
      select: { id: true, sourceIdentity: true, externalId: true, startAt: true, endAt: true, activeEnergyKcal: true, syncProtected: true, createdAt: true, updatedAt: true },
    });
    expect(legacy).toMatchObject({ sourceIdentity: expect.stringMatching(/^fp:/), externalId: null, activeEnergyKcal: 280, syncProtected: false });
    await prisma.dailyHealthData.update({ where: { date }, data: { workoutFeedObserved: null } });

    const beforeEdit = await new DailyMetricRepository(prisma).listWithTrainingFacts({ from: date, to: date, limit: 30, offset: 0, includeTrainingDays: false });
    expect(beforeEdit.days[0]?.workouts.find(({ id }) => id === legacy.id)).toMatchObject({ manualEditable: false });
    await repository.update(date, { steps: 8_123, workouts: [] });
    const afterRemovalAttempt = await prisma.workout.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(afterRemovalAttempt).toMatchObject({
      id: legacy.id,
      sourceIdentity: legacy.sourceIdentity,
      externalId: null,
      startAt: legacy.startAt,
      endAt: legacy.endAt,
      activeEnergyKcal: 280,
      syncProtected: false,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
    });

    const nextSync = await POST(syncRequest([exactFeedWithExternalId]));
    expect(nextSync.status).toBe(200);
    const afterSync = await prisma.workout.findMany({ where: { dailyHealthData: { date } } });
    expect(afterSync).toHaveLength(1);
    expect(afterSync[0]).toMatchObject({ id: legacy.id, externalId: "legacy-fingerprint-feed-2040-01-10", sourceIdentity: "ext:legacy-fingerprint-feed-2040-01-10" });
    const afterSyncRead = await repository.listWithTrainingFacts({ from: date, to: date, limit: 30, offset: 0, includeTrainingDays: false });
    expect(afterSyncRead.days[0]?.workouts).toHaveLength(1);
    expect(afterSyncRead.days[0]?.workouts[0]?.manualEditable).toBe(false);
    } finally {
      await releaseHealthState(prior, date);
    }
  });

  it("deduplicates exact History occurrences and keeps manual provenance when a later Health feed matches", async () => {
    const date = testDates[10]!;
    const prior = await saveHealthState();
    const startAt = `${date}T17:00:00.000Z`;
    const repository = new DailyMetricRepository(prisma);
    try {
    const manual = await repository.create({
      date,
      steps: 9_000,
      workouts: [
        { type: "Strength training", startAt, durationMinutes: 45, activeEnergyKcal: 180 },
        { type: "Strength training", startAt, durationMinutes: 45, activeEnergyKcal: 190 },
      ],
    });
    expect(manual.workouts).toHaveLength(1);
    const persistedManual = await prisma.workout.findFirstOrThrow({ where: { dailyHealthData: { date } } });
    expect(persistedManual).toMatchObject({ sourceIdentity: expect.stringMatching(/^manual:history:/), activeEnergyKcal: 190, syncProtected: true });
    const manualUpdatedAt = persistedManual.updatedAt;

    const sourceDay = {
      date,
      steps: 9_100,
      workouts: [{
        externalId: "garmin-exact-manual-match-2040-01-11",
        type: "Strength training",
        startAt,
        endAt: new Date(new Date(startAt).getTime() + 45 * 60_000).toISOString(),
        durationMinutes: 45,
        activeEnergyKcal: 300,
      }],
    };
    const response = await POST(syncRequest([sourceDay]));
    expect(response.status).toBe(200);
    const afterSync = await prisma.workout.findMany({ where: { dailyHealthData: { date } } });
    expect(afterSync).toHaveLength(1);
    expect(afterSync[0]).toMatchObject({
      id: persistedManual.id,
      sourceIdentity: persistedManual.sourceIdentity,
      externalId: null,
      activeEnergyKcal: 190,
      syncProtected: true,
      updatedAt: manualUpdatedAt,
    });
    const persistedSnapshot = await prisma.healthSyncSnapshot.findFirstOrThrow({
      where: { date }, orderBy: { id: "desc" }, select: { rawPayload: true },
    });
    expect(persistedSnapshot.rawPayload).toEqual(sourceDay);

    const edited = await repository.update(date, {
      workouts: [{ id: persistedManual.id, type: "Strength training", startAt, durationMinutes: 45, activeEnergyKcal: 220 }],
    });
    expect(edited?.workouts).toHaveLength(1);
    expect(edited?.workouts[0]).toMatchObject({ id: persistedManual.id, activeEnergyKcal: 220, manualEditable: true });
    expect(await prisma.workout.count({ where: { dailyHealthData: { date } } })).toBe(1);
    } finally {
      await releaseHealthState(prior, date);
    }
  });

  it("returns a conflict instead of a server error when a manual edit collides with a synced occurrence", async () => {
    const date = testDates[11]!;
    const day = await prisma.dailyHealthData.create({ data: { date, steps: 100, rawPayload: { source: "synthetic-integration" } } });
    const garminStart = new Date(`${date}T07:00:00.000Z`);
    const garminEnd = new Date(`${date}T07:30:00.000Z`);
    await prisma.workout.create({ data: {
      dailyHealthDataId: day.id,
      type: "Running",
      externalId: "garmin-existing-conflict-2040-01-12",
      sourceIdentity: "ext:garmin-existing-conflict-2040-01-12",
      startAt: garminStart,
      endAt: garminEnd,
      durationMinutes: 30,
    } });
    const manual = await prisma.workout.create({ data: {
      dailyHealthDataId: day.id,
      type: "Running",
      sourceIdentity: `${MANUAL_HISTORY_SOURCE_PREFIX}legacy-conflict-test`,
      startAt: new Date(`${date}T09:00:00.000Z`),
      endAt: new Date(`${date}T09:30:00.000Z`),
      durationMinutes: 30,
      syncProtected: true,
    } });
    const response = await patchDay(new Request(`http://localhost/api/v1/days/${date}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workouts: [{ id: manual.id, type: "Running", startAt: garminStart.toISOString(), durationMinutes: 30, activeEnergyKcal: null }] }),
    }), { params: Promise.resolve({ date }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "workout_conflict" });
    expect(await prisma.workout.count({ where: { dailyHealthDataId: day.id } })).toBe(2);
  });

  it("rebuilds and clears an acknowledged legacy Stepper block only after stable publication", async () => {
    const date = "2026-10-01";
    const oldDate = date;
    const sourceKey = String(1_950_000_000 + randomInt(1, 40_000_000));
    const journalId = randomUUID();
    const priorHealth = await saveHealthState();
    const priorTraining = await saveTrainingRefreshState();
    const priorActiveEpisodes = await prisma.modelEpisode.findMany({
      where: { active: true }, select: { id: true, deactivatedAt: true },
    });
    let modelFixture: Awaited<ReturnType<typeof preparePublishedModelForHealthWorker>> | null = null;
    let durableSessionId: number | null = null;
    try {
      await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId: 1 } });
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId: 1 } });
      await prisma.trainingSourceChange.deleteMany({ where: { profileId: 1 } });
      await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId: 1 } });
      await assertPublishedModelRangeIsEmpty(addCalendarDays(date, -89), addCalendarDays(date, 10));
      modelFixture = await preparePublishedModelForHealthWorker(date);

      const durableSession = await prisma.strengthDiarySession.create({
        data: { profileId: 1, status: "CANCELLED", entryMode: "RETROSPECTIVE", matchStatus: "UNMATCHED" },
        select: { id: true },
      });
      durableSessionId = durableSession.id;
      await prisma.unifiedPublicationBlock.create({
        data: { profileId: 1, source: "stepper", sourceKey, fromDate: oldDate },
      });
      await prisma.trainingSourceChange.create({
        data: {
          sourceChangeId: journalId,
          profileId: 1,
          generation: 1,
          operationKind: "stepper_workout_legacy_history",
          publicationBlockSourceKeys: [sourceKey],
          affectedWorkoutIds: [Number(sourceKey)],
          affectedSessionIds: [durableSession.id],
          oldModelDates: [oldDate],
          newModelDates: [],
          acknowledgedAt: new Date(),
        },
      });

      await expect(getModelStatus(modelFixture.episodeId)).resolves.toMatchObject({ productionCurrent: true });
      await reconcileLegacyStepperPublicationBlocksForRecovery();
      const recoveredQueue = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(recoveredQueue).toMatchObject({
        completedGeneration: 0,
        dirtyFromDate: oldDate,
        affectedSessionIds: [durableSession.id],
      });
      await expect(getModelStatus(modelFixture.episodeId)).resolves.toMatchObject({ productionCurrent: false });
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId: 1, source: "stepper", sourceKey } },
      })).not.toBeNull();

      await prisma.trainingRefreshJob.update({ where: { profileId: 1 }, data: { dueAt: new Date(0), nextAttemptAt: new Date(0) } });
      await expect(processNextTrainingRefreshJob()).resolves.toBe(true);

      const completedQueue = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(completedQueue.completedGeneration).toBe(completedQueue.requestedGeneration);
      expect(completedQueue.leaseToken).toBeNull();
      expect(await prisma.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId: 1, source: "stepper", sourceKey } },
      })).toBeNull();
      expect(await prisma.trainingSourceChange.findUniqueOrThrow({
        where: { sourceChangeId: journalId }, select: { acknowledgedAt: true },
      })).toEqual({ acknowledgedAt: expect.any(Date) });
      await expect(getModelStatus(modelFixture.episodeId)).resolves.toMatchObject({ productionCurrent: true });
    } finally {
      if (durableSessionId !== null) await prisma.strengthDiarySession.deleteMany({ where: { id: durableSessionId } });
      await prisma.trainingSourceChange.deleteMany({ where: { profileId: 1 } });
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId: 1 } });
      if (modelFixture) await removePublishedModelForHealthWorker(modelFixture);
      else await prisma.dailyHealthData.deleteMany({ where: { date: { gte: addCalendarDays(date, -89), lte: addCalendarDays(date, 10) }, rawPayload: { path: ["source"], equals: "health-sync-worker-integration" } } });
      for (const episode of priorActiveEpisodes) {
        await prisma.modelEpisode.update({ where: { id: episode.id }, data: { active: true, deactivatedAt: episode.deactivatedAt } });
      }
      await releaseHealthState(priorHealth, date);
      await restoreTrainingRefreshState(priorTraining);
    }
  }, 900_000);
});
