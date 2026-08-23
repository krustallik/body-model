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

  it("maps the new decimal metrics on create and update", async () => {
    const { repository, transaction } = repositoryFixture(["2026-08-21"]);
    await repository.syncDay({
      date: "2026-08-21",
      bodyFatPercent: 18.73,
      averageWalkingSpeedKmh: null,
      walkingDistanceKm: 8.1234,
    });
    expect(transaction.dailyHealthData.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ bodyFatPercent: 18.73, averageWalkingSpeedKmh: null, walkingDistanceKm: 8.1234 }),
      update: expect.objectContaining({ bodyFatPercent: 18.73, averageWalkingSpeedKmh: null, walkingDistanceKm: 8.1234 }),
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
          },
        ],
    });
    expect(transaction.workout.deleteMany).toHaveBeenCalledWith({ where: { dailyHealthDataId: 21 } });
    expect(transaction.workout.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ externalId: "apple-1", startAt: new Date("2026-08-21T15:00:00Z") })],
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
});
