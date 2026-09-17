import { describe, expect, it, vi } from "vitest";
import { PrismaHealthSyncRepository } from "@/modules/health/health.repository";

describe("sleep segment persistence", () => {
  it("creates sleep segments with skipDuplicates and ignores outer sync date for attribution", async () => {
    const createMany = vi.fn(async () => ({ count: 2 }));
    const transaction = {
      dailyHealthData: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({ id: 11 })),
      },
      healthSyncSnapshot: { create: vi.fn(async () => ({})) },
      workout: {
        findMany: vi.fn(async () => []),
        update: vi.fn(async () => ({})),
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      heartRateSample: { createMany: vi.fn(async () => ({ count: 0 })) },
      restingHeartRateSample: { createMany: vi.fn(async () => ({ count: 0 })) },
      sleepSegment: { createMany },
    };
    const client = {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };

    const repository = new PrismaHealthSyncRepository(client as never);
    await repository.syncDay(
      {
        date: "2026-09-17",
        sleepSegments: [
          {
            startAt: "2026-09-16T22:41:00+02:00",
            endAt: "2026-09-16T23:10:00+02:00",
            state: "core",
            rawState: "Повільний",
          },
          {
            startAt: "2026-09-16T23:10:00+02:00",
            endAt: "2026-09-16T23:46:00+02:00",
            state: "deep",
            rawState: "Глибокий",
          },
        ],
      } as never,
      { date: "2026-09-17" },
      { timezone: "Europe/Bratislava", receivedAt: new Date("2026-09-17T08:00:00Z"), syncedAt: null },
    );

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          startAt: new Date("2026-09-16T22:41:00+02:00"),
          endAt: new Date("2026-09-16T23:10:00+02:00"),
          startOffsetMinutes: 120,
          endOffsetMinutes: 120,
          state: "core",
          rawState: "Повільний",
          source: "shortcut",
        },
        {
          startAt: new Date("2026-09-16T23:10:00+02:00"),
          endAt: new Date("2026-09-16T23:46:00+02:00"),
          startOffsetMinutes: 120,
          endOffsetMinutes: 120,
          state: "deep",
          rawState: "Глибокий",
          source: "shortcut",
        },
      ],
      skipDuplicates: true,
    });
  });
});
