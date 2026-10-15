import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/health/sync/route";
import { PrismaHealthSyncRepository } from "@/modules/health/health.repository";
import { claimNextHealthSyncRefreshJob, processNextHealthSyncRefreshJob } from "@/modules/health/health-sync-refresh-worker";
import { runWithHealthSyncRefreshWorkerLease } from "@/modules/health/health-sync-worker-context";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION } from "@/model/unified-experimental-physiology-v1/contracts";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { initializeNewModelEpisode, recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";
import { currentPhysiologyV7Versions } from "@/modules/model-episodes/physiology-v7-persistence";
import { PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE, PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import type { HealthDayInput } from "@/modules/health/health.types";

const prisma = new PrismaClient();
const apiKey = process.env.IOS_SHORTCUT_API_KEY ?? "integration-test-secret";
const testDates = ["2040-01-01", "2040-01-02", "2040-01-03", "2040-01-04", "2040-01-05", "2040-01-06", "2040-01-07", "2040-01-08", "2040-01-09", "2040-01-10", "2040-01-11", "2040-01-12"];

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
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
  await recalculateModelEpisode({ episodeId: episode.id, now });
  await markUnifiedV4Current();
  return { episodeId: episode.id, dates: rows.map(({ date: rowDate }) => rowDate), now };
}

async function removePublishedModelForHealthWorker(fixture: { episodeId: number; dates: string[] }): Promise<void> {
  const range = { gte: fixture.dates[0], lte: fixture.dates.at(-1) };
  await prisma.unifiedExperimentalPhysiologyStateV2.deleteMany({ where: { modelEpisodeId: fixture.episodeId } });
  await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({ where: { profileId: 1, date: range } });
  await prisma.experimentalCessationDetrainingShadow.deleteMany({ where: { profileId: 1, date: range } });
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

import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

async function cleanTestRows(): Promise<void> {
  await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId: 1 } });
  await prisma.healthSyncSnapshot.deleteMany({ where: { date: { in: testDates } } });
  await prisma.healthActivityInterval.deleteMany({ where: { date: { in: testDates } } });
  await deleteDailyHealthRows(prisma, testDates);
}

describe("Apple Health sync with PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.profile.upsert({
      where: { id: 1 },
      create: { id: 1, sex: "male", dateOfBirth: new Date("1990-01-01T00:00:00.000Z"), heightCm: 180 },
      update: {},
    });
    await cleanTestRows();
  });
  afterAll(async () => {
    await cleanTestRows();
    await prisma.$disconnect();
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

      const currentnessRead = deferred();
      oldWorker = processNextHealthSyncRefreshJob({
        afterCurrentnessCheck: async (_job, alreadyCurrent) => {
          expect(alreadyCurrent).toBe(true);
          currentnessRead.resolve();
          await releaseOldWorker.promise;
        },
      });
      await currentnessRead.promise;

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
      const staleWorkerCurrent = deferred();
      staleWorker = processNextHealthSyncRefreshJob({
        afterCurrentnessCheck: async (_job, alreadyCurrent) => {
          expect(alreadyCurrent).toBe(true);
          staleWorkerCurrent.resolve();
          await releaseStaleWorker.promise;
        },
      });
      await staleWorkerCurrent.promise;
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
});
