import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaHealthSyncRepository } from "@/modules/health/health.repository";

function repositoryFixture(existingDates: string[] = []) {
  const transaction = {
    dailyHealthData: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { date: string } }) =>
        Promise.resolve(existingDates.includes(where.date) ? { date: where.date } : null),
      ),
      upsert: vi.fn().mockImplementation(({ where }: { where: { date: string } }) =>
        Promise.resolve({ id: where.date === "2026-08-21" ? 21 : 22 }),
      ),
    },
    workout: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    heartRateSample: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    restingHeartRateSample: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    sleepSegment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    healthSyncSnapshot: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
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

  it("creates workouts with normalized instants", async () => {
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
    expect(transaction.workout.deleteMany).toHaveBeenCalledWith({ where: { dailyHealthDataId: 21 } });
    expect(transaction.workout.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        externalId: "apple-1",
        startAt: new Date("2026-08-21T15:00:00Z"),
        activeEnergyKcal: 340,
        energyKcal: null,
      })],
    });
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
    expect(transaction.workout.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ activeEnergyKcal: null })],
    });
  });

  it("drops other-calendar-day workouts before createMany", async () => {
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
    expect(transaction.workout.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ externalId: "same-day", activeEnergyKcal: 154 })],
    });
  });

  it("replaces workouts with an empty list when omitted", async () => {
    const { repository, transaction } = repositoryFixture(["2026-08-21"]);
    await repository.syncDay({ date: "2026-08-21" });
    expect(transaction.workout.deleteMany).toHaveBeenCalledOnce();
    expect(transaction.workout.createMany).not.toHaveBeenCalled();
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
