import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/health/sync/route";
import { prisma as appPrisma } from "@/lib/db/prisma";
import { PrismaHealthSyncRepository } from "@/modules/health/health.repository";
import { processNextHealthSyncRefreshJob } from "@/modules/health/health-sync-refresh-worker";
import type { HealthDayInput } from "@/modules/health/health.types";

const prisma = new PrismaClient();
const apiKey = process.env.IOS_SHORTCUT_API_KEY ?? "integration-test-secret";
const testDates = ["2040-01-01", "2040-01-02", "2040-01-03", "2040-01-04", "2040-01-05", "2040-01-06", "2040-01-07", "2040-01-08", "2040-01-09"];

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

      // The isolated database has no published V7 generation, so recovery
      // must retain the durable job and Health fence for a later retry.
      const snapshotRead = vi.spyOn(appPrisma.healthSyncSnapshot, "findMany")
        .mockRejectedValueOnce(new Error("synthetic persisted-snapshot read failure"));
      try {
        await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);
      } finally {
        snapshotRead.mockRestore();
      }
      const retryable = await prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId: 1 } });
      expect(retryable.completedGeneration).toBeLessThan(retryable.requestedGeneration);
      expect(retryable.attemptCount).toBe(5);
      expect(retryable.leaseToken).toBeNull();
      expect(retryable.leaseUntil).toBeNull();
      expect(retryable.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 15_000);
      expect(retryable.lastErrorType).not.toBeNull();
      await expect(prisma.unifiedPublicationBlock.findFirst({
        where: { profileId: 1, source: "health", sourceKey: date },
        select: { fromDate: true },
      })).resolves.toMatchObject({ fromDate: date });
      expect(await prisma.healthSyncSnapshot.count({ where: { date } })).toBe(rawSnapshotCount);
      await expect(prisma.healthSyncSnapshot.findFirstOrThrow({
        where: { date }, orderBy: { id: "desc" }, select: { rawPayload: true },
      })).resolves.toMatchObject({ rawPayload });

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
      expect(recovered.attemptCount).toBe(6);
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
});
