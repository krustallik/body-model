import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { requireIsolatedStage01Database } from "@/modules/training/testing/require-isolated-database";
import { SleepRepository } from "@/modules/health/sleep.repository";

const profileId = 1;
const offsetSleepDate = "2099-11-01";
const fallbackSleepDate = "2188-03-01";
const fallbackSnapshotDate = "2188-02-28";
const offsetStarts = [
  new Date("2099-10-31T21:00:00.000Z"),
  new Date("2099-10-31T22:00:00.000Z"),
];
// 2188 is a leap year: Tokyo midnight on March 1 is February 29 at 15:00 UTC.
const fallbackStarts = [new Date("2188-02-29T15:00:00.000Z")];

describe("SleepRepository PostgreSQL date attribution", () => {
  let prisma: PrismaClient | undefined;
  let repository: SleepRepository;

  async function cleanFixtures() {
    if (!prisma) return;
    await prisma.sleepSegment.deleteMany({
      where: {
        profileId,
        startAt: { in: [...offsetStarts, ...fallbackStarts] },
      },
    });
    await prisma.healthSyncSnapshot.deleteMany({
      where: { date: fallbackSnapshotDate, receivedAt: new Date("2188-02-28T20:00:00.000Z") },
    });
  }

  beforeAll(async () => {
    requireIsolatedStage01Database(process.env.DATABASE_URL, process.env.BODYCAST_STAGE01_MODE, "test");
    const { PrismaClient: Client } = await import("@prisma/client");
    prisma = new Client({ datasourceUrl: process.env.DATABASE_URL });
    await prisma.$connect();
    repository = new SleepRepository(prisma);
    await cleanFixtures();
  }, 60_000);

  beforeEach(async () => {
    await cleanFixtures();
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      await cleanFixtures();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("retrieves previous-UTC-day segments and attributes the night by persisted wake offset", async () => {
    await prisma!.sleepSegment.createMany({
      data: [
        {
          profileId,
          startAt: offsetStarts[0]!,
          endAt: new Date("2099-11-01T05:00:00.000Z"),
          startOffsetMinutes: 120,
          endOffsetMinutes: 60,
          state: "inBed",
          rawState: "In Bed",
          source: "sleep-repository-integration",
        },
        {
          profileId,
          startAt: offsetStarts[1]!,
          endAt: new Date("2099-11-01T05:00:00.000Z"),
          startOffsetMinutes: 120,
          endOffsetMinutes: 60,
          state: "asleepUnspecified",
          rawState: "Asleep",
          source: "sleep-repository-integration",
        },
      ],
    });

    const summary = await repository.summaryForDate(offsetSleepDate, "UTC");

    expect(summary).toMatchObject({
      sleepDate: offsetSleepDate,
      sleepDateAttribution: "segment-offset",
      wakeOffsetMinutes: 60,
      totalSleepMinutes: 420,
      timeInBedMinutes: 480,
      efficiencyPercent: 87.5,
    });
  });

  it("uses the latest persisted sync timezone for an offsetless overnight segment", async () => {
    await prisma!.healthSyncSnapshot.create({
      data: {
        date: fallbackSnapshotDate,
        receivedAt: new Date("2188-02-28T20:00:00.000Z"),
        timezone: "Asia/Tokyo",
        rawPayload: { source: "sleep-repository-integration" },
      },
    });
    await prisma!.sleepSegment.create({
      data: {
        profileId,
        startAt: fallbackStarts[0]!,
        endAt: new Date("2188-02-29T16:00:00.000Z"),
        state: "deep",
        rawState: "Deep",
        source: "sleep-repository-integration",
      },
    });

    const summary = await repository.summaryForDate(fallbackSleepDate);

    expect(summary).toMatchObject({
      sleepDate: fallbackSleepDate,
      sleepDateAttribution: "fallback-timezone",
      wakeOffsetMinutes: null,
      totalSleepMinutes: 60,
      timeInBedMinutes: 60,
      timeInBedProvenance: "session-span-fallback",
      efficiencyPercent: null,
    });
  });
});
