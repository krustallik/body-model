import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaHealthSyncRepository } from "@/modules/health/health.repository";

function repositoryFixture(existingDates: string[] = [], existingWorkouts: Array<{
  id: number;
  sourceIdentity: string | null;
  externalId: string | null;
  type: string;
  startAt: Date;
  endAt: Date;
  matchedDiarySession: { id: number } | null;
}> = []) {
  const transaction = {
    dailyHealthData: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { date: string } }) =>
        Promise.resolve(existingDates.includes(where.date) ? { date: where.date } : null),
      ),
      upsert: vi.fn().mockImplementation(({ where }: { where: { date: string } }) =>
        Promise.resolve({ id: where.date === "2026-08-21" ? 21 : 22 }),
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    workout: {
      findMany: vi.fn().mockResolvedValue(existingWorkouts),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    heartRateSample: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    restingHeartRateSample: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    sleepSegment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    healthSyncSnapshot: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
    },
    healthMetricSample: {
      upsert: vi.fn().mockResolvedValue({ id: 1 }),
    },
    healthActivityInterval: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      aggregate: vi.fn().mockImplementation(({ where }: { where: { metric: string } }) => Promise.resolve({
        _sum: { value: where.metric === "steps" ? { toNumber: () => 60 } : 0.5 },
      })),
    },
  };
  const client = {
    $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;
  return { repository: new PrismaHealthSyncRepository(client), transaction };
}

describe("Prisma health synchronization repository", () => {
  it("inserts raw and resting samples with idempotent dedupe semantics", async () => {
    const { repository, transaction } = repositoryFixture();
    await repository.syncDay({
      date: "2026-08-21",
      bpm: { timestamps: ["2026-08-21T08:00:00+02:00"], bpm: [61] },
      bpminpeace: { timestamps: ["2026-08-21T00:00:00+02:00"], bpminpeace: [57] },
    });
    expect(transaction.heartRateSample.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: [expect.objectContaining({ date: "2026-08-21", bpm: 61, source: "shortcut" })],
    }));
    expect(transaction.restingHeartRateSample.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: [expect.objectContaining({ date: "2026-08-21", bpm: 57, source: "shortcut" })],
    }));
  });
  it("stores the original parsed day as rawPayload", async () => {
    const { repository, transaction } = repositoryFixture();
    const day = { date: "2026-08-21", weightKg: null, steps: 1234 };
    await repository.syncDay(day);
    expect(transaction.dailyHealthData.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ rawPayload: day }) }),
    );
  });

  it("stores the original iPhone casing as rawPayload", async () => {
    const { repository, transaction } = repositoryFixture();
    const normalized = { date: "2026-08-21", weightKg: 89 };
    const original = { Date: "2026-08-21", Weightkg: 89 };
    await repository.syncDay(normalized, original);
    expect(transaction.dailyHealthData.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ rawPayload: original }) }),
    );
  });

  it("keeps one current timestamped sample per metric and instant", async () => {
    const { repository, transaction } = repositoryFixture();
    await repository.syncDay(
      { date: "2026-09-17", weightKg: 81.1 },
      { date: "2026-09-17", weightKg: 81.1 },
      undefined,
      [
        { metric: "weight-kg", date: "2026-09-17", timestamp: "2026-09-17T07:00:00+02:00", value: 81.4 },
        { metric: "weight-kg", date: "2026-09-17", timestamp: "2026-09-17T20:00:00+02:00", value: 81.1 },
      ],
    );
    expect(transaction.healthMetricSample.upsert).toHaveBeenCalledTimes(2);
    expect(transaction.healthMetricSample.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { metric_timestamp: { metric: "weight-kg", timestamp: new Date("2026-09-17T05:00:00.000Z") } },
      create: expect.objectContaining({ dailyHealthDataId: 22, date: "2026-09-17", value: 81.4 }),
      update: expect.objectContaining({ value: 81.4 }),
    }));
  });

  it("deduplicates interval step and distance records and derives the daily totals", async () => {
    const { repository, transaction } = repositoryFixture();
    await repository.syncDay({
      date: "2026-09-19",
      stepIntervals: {
        starts: ["2026-09-19T08:00:00+02:00"],
        ends: ["2026-09-19T08:15:00+02:00"],
        values: [60],
      },
      walkingDistanceIntervals: {
        starts: ["2026-09-19T08:00:00+02:00"],
        ends: ["2026-09-19T08:15:00+02:00"],
        values: [0.5],
      },
    });
    expect(transaction.healthActivityInterval.deleteMany).toHaveBeenCalledWith({
      where: { date: "2026-09-19", metric: "walking-distance-km" },
    });
    expect(transaction.healthActivityInterval.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ metric: "steps", value: 60, sourceFingerprint: expect.stringContaining("steps|") })],
      skipDuplicates: true,
    });
    expect(transaction.healthActivityInterval.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ metric: "walking-distance-km", value: 0.5 })],
      skipDuplicates: true,
    });
    expect(transaction.dailyHealthData.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { date: "2026-09-19" },
      data: { steps: 60 },
    }));
    expect(transaction.dailyHealthData.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { date: "2026-09-19" },
      data: { walkingDistanceKm: 0.5 },
    }));
  });

  it("keeps only the synced day's walking intervals and replaces prior rows", async () => {
    const { repository, transaction } = repositoryFixture();
    await repository.syncDay({
      date: "2026-09-19",
      walkingDistanceIntervals: {
        starts: ["2026-09-17T08:00:00+02:00", "2026-09-19T09:00:00+02:00"],
        ends: ["2026-09-17T08:15:00+02:00", "2026-09-19T09:15:00+02:00"],
        values: [12.4, 8.1],
      },
    });
    expect(transaction.healthActivityInterval.deleteMany).toHaveBeenCalledWith({
      where: { date: "2026-09-19", metric: "walking-distance-km" },
    });
    expect(transaction.healthActivityInterval.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        date: "2026-09-19",
        metric: "walking-distance-km",
        value: 8.1,
      })],
      skipDuplicates: true,
    });
    expect(transaction.dailyHealthData.upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { date: "2026-09-17" },
    }));
  });

  it("does not clear step or distance history when a latest-N interval feed has no rows for this date", async () => {
    const { repository, transaction } = repositoryFixture(["2026-09-19"]);
    await repository.syncDay({
      date: "2026-09-19",
      stepIntervals: {
        starts: ["2026-09-20T08:00:00+02:00"],
        ends: ["2026-09-20T08:15:00+02:00"],
        values: [120],
      },
      walkingDistanceIntervals: {
        starts: ["2026-09-20T08:00:00+02:00"],
        ends: ["2026-09-20T08:15:00+02:00"],
        values: [0.8],
      },
    });
    expect(transaction.healthActivityInterval.deleteMany).not.toHaveBeenCalled();
    expect(transaction.healthActivityInterval.createMany).not.toHaveBeenCalled();
    expect(transaction.dailyHealthData.update).not.toHaveBeenCalled();
  });

  it("appends an immutable cumulative snapshot with timezone metadata", async () => {
    const { repository, transaction } = repositoryFixture();
    const receivedAt = new Date("2026-08-23T08:00:00Z");
    await repository.syncDay(
      { date: "2026-08-23", steps: 0, walkingDistanceKm: null },
      { Date: "2026-08-23", Steps: 0, Walkingdistancekm: "" },
      { timezone: "Europe/Bratislava", receivedAt, syncedAt: "2026-08-23T10:00:00+02:00" },
    );
    expect(transaction.healthSyncSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dailyHealthDataId: 22,
        date: "2026-08-23",
        receivedAt,
        syncedAt: new Date("2026-08-23T08:00:00Z"),
        timezone: "Europe/Bratislava",
        steps: 0,
        walkingDistanceKm: null,
        rawPayload: { Date: "2026-08-23", Steps: 0, Walkingdistancekm: "" },
      }),
    });
  });

  it("persists workoutFeedObserved=true for valid empty workouts on the sync day", async () => {
    const { repository, transaction } = repositoryFixture();
    await repository.syncDay(
      { date: "2026-09-16", walkingDistanceKm: 0, workouts: [] },
      { date: "2026-09-16", walkingDistanceKm: 0, workouts: [] },
    );
    expect(transaction.dailyHealthData.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          walkingDistanceKm: 0,
          workoutFeedObserved: true,
        }),
        update: expect.objectContaining({
          walkingDistanceKm: 0,
          workoutFeedObserved: true,
        }),
      }),
    );
  });

  it("persists workoutFeedObserved=false when the workout feed is absent", async () => {
    const { repository, transaction } = repositoryFixture();
    await repository.syncDay(
      { date: "2026-09-16", walkingDistanceKm: 3 },
      { date: "2026-09-16", walkingDistanceKm: 3 },
    );
    expect(transaction.dailyHealthData.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ workoutFeedObserved: false }),
      }),
    );
  });

  it("maps the new decimal metrics on create and update", async () => {
    const { repository, transaction } = repositoryFixture(["2026-08-21"]);
    await repository.syncDay({
      date: "2026-08-21",
      bodyFatPercent: 18.73,
      averageWalkingSpeedKmh: null,
      walkingDistanceKm: 8.1234,
    });
    expect(transaction.dailyHealthData.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ bodyFatPercent: 18.73, averageWalkingSpeedKmh: null, walkingDistanceKm: 8.12 }),
      update: expect.objectContaining({ bodyFatPercent: 18.73, averageWalkingSpeedKmh: null, walkingDistanceKm: 8.12 }),
    }));
  });

  it("maps strengthTrainingMinutes on create and update", async () => {
    const { repository, transaction } = repositoryFixture(["2026-08-21"]);
    await repository.syncDay({ date: "2026-08-21", strengthTrainingMinutes: 65.5 });
    expect(transaction.dailyHealthData.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ strengthTrainingMinutes: 65.5 }),
      update: expect.objectContaining({ strengthTrainingMinutes: 65.5 }),
    }));
  });

  it("creates workouts with stable sourceIdentity instead of wipe-replace", async () => {
    const { repository, transaction } = repositoryFixture();
    await repository.syncDay({
        date: "2026-08-21",
        workouts: [
          {
            externalId: "apple-1",
            type: "strength",
            startAt: "2026-08-21T17:00:00+02:00",
            endAt: "2026-08-21T18:00:00+02:00",
            activeEnergyKcal: 340,
          },
        ],
    });
    expect(transaction.workout.findMany).toHaveBeenCalledWith({
      where: { dailyHealthDataId: 21 },
      select: expect.objectContaining({
        id: true,
        sourceIdentity: true,
        matchedDiarySession: { select: { id: true } },
      }),
    });
    expect(transaction.workout.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        externalId: "apple-1",
        sourceIdentity: "ext:apple-1",
        startAt: new Date("2026-08-21T15:00:00Z"),
        activeEnergyKcal: 340,
        energyKcal: null,
      }),
    }));
    expect(transaction.workout.deleteMany).not.toHaveBeenCalled();
  });

  it("persists null activeEnergyKcal when workout energy is omitted", async () => {
    const { repository, transaction } = repositoryFixture();
    await repository.syncDay({
      date: "2026-08-21",
      workouts: [{
        type: "strength",
        startAt: "2026-08-21T17:00:00+02:00",
        endAt: "2026-08-21T18:00:00+02:00",
      }],
    });
    expect(transaction.workout.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        activeEnergyKcal: null,
        sourceIdentity: "fp:strength|2026-08-21T15:00:00.000Z|2026-08-21T16:00:00.000Z",
      }),
    }));
  });

  it("drops other-calendar-day workouts before reconciliation", async () => {
    const { repository, transaction } = repositoryFixture();
    await repository.syncDay(
      {
        date: "2026-08-22",
        workouts: [
          {
            externalId: "same-day",
            type: "Stair Climbing",
            startAt: "2026-08-22T07:00:00+02:00",
            endAt: "2026-08-22T07:12:00+02:00",
            activeEnergyKcal: 154,
          },
          {
            externalId: "other-day",
            type: "Traditional Strength Training",
            startAt: "2026-08-21T23:30:00+02:00",
            endAt: "2026-08-22T00:30:00+02:00",
            activeEnergyKcal: 300,
          },
        ],
      },
      undefined,
      {
        timezone: "Europe/Bratislava",
        receivedAt: new Date("2026-08-22T10:00:00Z"),
        syncedAt: null,
      },
    );
    expect(transaction.workout.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ externalId: "same-day", activeEnergyKcal: 154, sourceIdentity: "ext:same-day" }),
    }));
  });

  it("updates existing workouts in place and preserves ids", async () => {
    const { repository, transaction } = repositoryFixture(["2026-08-21"], [{
      id: 77,
      sourceIdentity: "ext:apple-1",
      externalId: "apple-1",
      type: "strength",
      startAt: new Date("2026-08-21T15:00:00Z"),
      endAt: new Date("2026-08-21T16:00:00Z"),
      matchedDiarySession: { id: 1 },
    }]);
    await repository.syncDay({
      date: "2026-08-21",
      workouts: [{
        externalId: "apple-1",
        type: "strength",
        startAt: "2026-08-21T17:00:00+02:00",
        endAt: "2026-08-21T18:10:00+02:00",
        activeEnergyKcal: 360,
      }],
    });
    expect(transaction.workout.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: expect.objectContaining({
        sourceIdentity: "ext:apple-1",
        activeEnergyKcal: 360,
        endAt: new Date("2026-08-21T16:10:00Z"),
      }),
    });
    expect(transaction.workout.createMany).not.toHaveBeenCalled();
    expect(transaction.workout.deleteMany).not.toHaveBeenCalled();
  });

  it("does not delete workouts when the workout feed is absent", async () => {
    const { repository, transaction } = repositoryFixture(["2026-08-21"], [
      {
        id: 10,
        sourceIdentity: "ext:linked",
        externalId: "linked",
        type: "Traditional Strength Training",
        startAt: new Date("2026-08-21T15:00:00Z"),
        endAt: new Date("2026-08-21T16:00:00Z"),
        matchedDiarySession: { id: 5 },
      },
      {
        id: 11,
        sourceIdentity: "ext:unlinked",
        externalId: "unlinked",
        type: "Stair Climbing",
        startAt: new Date("2026-08-21T06:00:00Z"),
        endAt: new Date("2026-08-21T06:12:00Z"),
        matchedDiarySession: null,
      },
    ]);
    await repository.syncDay({ date: "2026-08-21" });
    expect(transaction.workout.findMany).not.toHaveBeenCalled();
    expect(transaction.workout.deleteMany).not.toHaveBeenCalled();
    expect(transaction.workout.createMany).not.toHaveBeenCalled();
  });

  it("does not delete this day's workouts from a latest-N workout list for other dates", async () => {
    const { repository, transaction } = repositoryFixture(["2026-08-21"], [{
      id: 11,
      sourceIdentity: "ext:historical",
      externalId: "historical",
      type: "Stair Climbing",
      startAt: new Date("2026-08-21T06:00:00Z"),
      endAt: new Date("2026-08-21T06:12:00Z"),
      matchedDiarySession: null,
    }]);
    await repository.syncDay(
      { date: "2026-08-21", workouts: [] },
      {
        date: "2026-08-21",
        workouts: [{
          type: "Stair Climbing",
          startAt: "2026-08-22T08:00:00.000Z",
          endAt: "2026-08-22T08:12:00.000Z",
          durationMinutes: 12,
        }],
      },
    );
    expect(transaction.workout.findMany).not.toHaveBeenCalled();
    expect(transaction.workout.deleteMany).not.toHaveBeenCalled();
  });

  it("reports whether today's date was updated", async () => {
    const { repository } = repositoryFixture(["2026-08-21"]);
    await expect(repository.syncDay({ date: "2026-08-21" })).resolves.toEqual(
      { date: "2026-08-21", action: "updated" },
    );
  });

  it("propagates transaction failures", async () => {
    const client = { $transaction: vi.fn().mockRejectedValue(new Error("rollback")) } as unknown as PrismaClient;
    const repository = new PrismaHealthSyncRepository(client);
    await expect(repository.syncDay({ date: "2026-08-21" })).rejects.toThrow("rollback");
  });

  it("does not prune daily rows or snapshots (durable sources)", async () => {
    const healthSyncSnapshot = { deleteMany: vi.fn() };
    const dailyHealthData = { deleteMany: vi.fn() };
    const client = {
      healthSyncSnapshot,
      dailyHealthData,
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaClient;
    const repository = new PrismaHealthSyncRepository(client);
    await expect(repository.pruneOlderThan("2026-08-17")).resolves.toEqual({
      cutoffDate: "2026-08-17",
      deletedDays: 0,
      deletedSnapshots: 0,
    });
    expect(healthSyncSnapshot.deleteMany).not.toHaveBeenCalled();
    expect(dailyHealthData.deleteMany).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
