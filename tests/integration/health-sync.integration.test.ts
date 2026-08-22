import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/health/sync/route";
import { PrismaHealthSyncRepository } from "@/modules/health/health.repository";
import type { HealthDayInput } from "@/modules/health/health.types";

const prisma = new PrismaClient();
const apiKey = process.env.IOS_SHORTCUT_API_KEY ?? "integration-test-secret";
const testDates = ["2040-01-01", "2040-01-02", "2040-01-03", "2040-01-04", "2040-01-05", "2040-01-06", "2040-01-07"];

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
  await prisma.dailyHealthData.deleteMany({ where: { date: { in: testDates } } });
}

describe("Apple Health sync with PostgreSQL", () => {
  beforeAll(cleanTestRows);
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
    await expect(first.json()).resolves.toMatchObject({ created: 0, updated: 1 });
    await expect(retry.json()).resolves.toMatchObject({ created: 0, updated: 1 });

    const records = await prisma.dailyHealthData.findMany({
      where: { date: testDates[0] },
      include: { workouts: true },
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.steps).toBe(13000);
    expect(records[0]?.workouts.map(({ externalId }) => externalId)).toEqual(["replacement-workout"]);
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
    expect(records[0]?.walkingDistanceKm?.toString()).toBe("8.1234");
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

  it("handles overlapping old/new batches", async () => {
    await POST(syncRequest([{ date: testDates[1], steps: 100 }, { date: testDates[2], steps: 100 }]));
    const response = await POST(
      syncRequest([{ date: testDates[2], steps: 200 }, { date: testDates[3], steps: 200 }]),
    );
    await expect(response.json()).resolves.toMatchObject({ created: 1, updated: 1 });
    expect(await prisma.dailyHealthData.count({ where: { date: { in: testDates.slice(1, 4) } } })).toBe(3);
    expect((await prisma.dailyHealthData.findUnique({ where: { date: testDates[2] } }))?.steps).toBe(200);
  });

  it("does not create duplicate rows during concurrent retries", async () => {
    const date = testDates[3];
    await prisma.dailyHealthData.deleteMany({ where: { date } });
    const responses = await Promise.all([
      POST(syncRequest([{ date, steps: 111 }])),
      POST(syncRequest([{ date, steps: 222 }])),
    ]);
    expect(responses.every(({ status }) => status === 200)).toBe(true);
    expect(await prisma.dailyHealthData.count({ where: { date } })).toBe(1);
    expect([111, 222]).toContain((await prisma.dailyHealthData.findUnique({ where: { date } }))?.steps);
  });

  it("rolls back an earlier day when a later database constraint fails", async () => {
    const repository = new PrismaHealthSyncRepository(prisma);
    const invalidBatch = [
      { date: testDates[1], steps: 999 },
      { date: "not-a-date" },
    ] as HealthDayInput[];
    await prisma.dailyHealthData.deleteMany({ where: { date: testDates[1] } });

    await expect(repository.syncBatch(invalidBatch)).rejects.toThrow();
    expect(await prisma.dailyHealthData.findUnique({ where: { date: testDates[1] } })).toBeNull();
  });
});
