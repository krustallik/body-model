import { describe, expect, it, vi } from "vitest";

const { afterHealthSyncMatch } = vi.hoisted(() => ({
  afterHealthSyncMatch: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/modules/training/training.service", () => ({
  trainingService: { afterHealthSyncMatch },
}));

import type { HealthSyncRepository } from "@/modules/health/health.repository";
import { reconcileHealthUnifiedPublicationBlocksV1, syncHealthData } from "@/modules/health/health.service";
import type { HealthDayInput, HealthSyncMetadata, SyncDateResult } from "@/modules/health/health.types";

class MemoryRepository implements HealthSyncRepository {
  readonly days = new Map<string, HealthDayInput>();
  readonly workouts = new Map<string, NonNullable<HealthDayInput["workouts"]>>();
  readonly snapshots: { day: HealthDayInput; rawDay: unknown; metadata: HealthSyncMetadata }[] = [];
  readonly prunedCutoffs: string[] = [];
  failOnDate?: string;
  pruneFail = false;

  async syncDay(
    day: HealthDayInput,
    rawDay: unknown,
    metadata: HealthSyncMetadata,
  ): Promise<SyncDateResult> {
    const nextDays = new Map(this.days);
    const nextWorkouts = new Map(this.workouts);
    if (day.date === this.failOnDate) throw new Error("simulated transaction failure");
    const action = nextDays.has(day.date) ? "updated" : "created";
    const previous = nextDays.get(day.date);
    nextDays.set(day.date, { ...previous, ...day });
    nextWorkouts.set(day.date, day.workouts ?? []);

    this.days.clear();
    nextDays.forEach((value, key) => this.days.set(key, value));
    this.workouts.clear();
    nextWorkouts.forEach((value, key) => this.workouts.set(key, value));
    this.snapshots.push({ day, rawDay, metadata });
    return { date: day.date, action };
  }

  async pruneOlderThan(cutoffDate: string) {
    this.prunedCutoffs.push(cutoffDate);
    if (this.pruneFail) throw new Error("simulated prune failure");
    // Durable sources are never deleted by retention (days, workouts, snapshots).
    return { cutoffDate, deletedDays: 0, deletedSnapshots: 0 };
  }
}

const workout = {
  type: "running",
  startAt: "2026-08-21T08:00:00Z",
  endAt: "2026-08-21T08:30:00Z",
  durationMinutes: 30,
};

describe("health synchronization service", () => {
  it("clears successful dates but leaves an already armed failed-date fence unchanged", async () => {
    const lifecycle = {
      blockUnifiedPublication: vi.fn().mockResolvedValue(undefined),
      clearUnifiedPublicationBlock: vi.fn().mockResolvedValue(true),
    };
    const dates = ["2026-08-21", "2026-08-22"];
    const firstAttemptReady = await reconcileHealthUnifiedPublicationBlocksV1({
      dates,
      tokens: new Map([
        [dates[0]!, { revision: 4, fromDate: dates[0]! }],
        [dates[1]!, { revision: 7, fromDate: dates[1]! }],
      ]),
      failedDates: new Set([dates[1]!]),
      lifecycle,
    });

    expect(firstAttemptReady).toBe(false);
    expect(lifecycle.clearUnifiedPublicationBlock).toHaveBeenCalledTimes(1);
    expect(lifecycle.clearUnifiedPublicationBlock).toHaveBeenCalledWith({
      profileId: 1, source: "health", sourceKey: dates[0], expectedRevision: 4,
      expectedFromDate: dates[0],
    });
    expect(lifecycle.blockUnifiedPublication).not.toHaveBeenCalled();

    lifecycle.blockUnifiedPublication.mockClear();
    lifecycle.clearUnifiedPublicationBlock.mockClear();
    const retryReady = await reconcileHealthUnifiedPublicationBlocksV1({
      dates: [dates[1]!],
      tokens: new Map([[dates[1]!, { revision: 8, fromDate: dates[1]! }]]),
      failedDates: new Set(),
      lifecycle,
    });

    expect(retryReady).toBe(true);
    expect(lifecycle.blockUnifiedPublication).not.toHaveBeenCalled();
    expect(lifecycle.clearUnifiedPublicationBlock).toHaveBeenCalledWith({
      profileId: 1, source: "health", sourceKey: dates[1], expectedRevision: 8,
      expectedFromDate: dates[1],
    });
  });

  it("creates a new day", async () => {
    const repository = new MemoryRepository();
    await expect(syncHealthData({ days: [{ date: "2026-08-21" }] }, repository)).resolves.toMatchObject({
      received: 1,
      created: 1,
      updated: 0,
      modelPublicationStatus: "not-run",
    });
  });

  it("updates an existing day", async () => {
    const repository = new MemoryRepository();
    await syncHealthData({ days: [{ date: "2026-08-21", weightKg: 80 }] }, repository);
    const result = await syncHealthData({ days: [{ date: "2026-08-21", weightKg: 79 }] }, repository);
    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(repository.days.get("2026-08-21")?.weightKg).toBe(79);
  });

  it("syncs all three supplied days and runs post-sync matching for each", async () => {
    const repository = new MemoryRepository();
    afterHealthSyncMatch.mockClear();
    const result = await syncHealthData({
      days: [{ date: "2026-08-21" }, { date: "2026-08-22" }, { date: "2026-08-23" }],
      timezone: "Europe/Bratislava",
    }, repository);
    expect(result).toMatchObject({ received: 3, created: 3, updated: 0 });
    expect(repository.days.size).toBe(3);
    expect(afterHealthSyncMatch).toHaveBeenCalledTimes(3);
    expect(afterHealthSyncMatch).toHaveBeenNthCalledWith(2, "2026-08-22", { timezone: "Europe/Bratislava" });
  });

  it("creates and updates body composition and walking metrics without duplicating the day", async () => {
    const repository = new MemoryRepository();
    await syncHealthData({ days: [{
      date: "2026-08-21",
      bodyFatPercent: 18.73,
      averageWalkingSpeedKmh: 5.2,
      walkingDistanceKm: 6.7,
    }] }, repository);
    const result = await syncHealthData({ days: [{
      date: "2026-08-21",
      bodyFatPercent: 18.6,
      averageWalkingSpeedKmh: null,
      walkingDistanceKm: 8.1,
    }] }, repository);

    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(repository.days.size).toBe(1);
    expect(repository.days.get("2026-08-21")).toMatchObject({
      bodyFatPercent: 18.6,
      averageWalkingSpeedKmh: null,
      walkingDistanceKm: 8.1,
    });
  });

  it("allows the new metrics to be missing", async () => {
    const repository = new MemoryRepository();
    await syncHealthData({ days: [{ date: "2026-08-21" }] }, repository);
    expect(repository.days.get("2026-08-21")).toEqual({ date: "2026-08-21" });
  });

  it("is idempotent when the same request is retried", async () => {
    const repository = new MemoryRepository();
    const payload = { days: [{ date: "2026-08-21", steps: 100 }] };
    await syncHealthData(payload, repository);
    const second = await syncHealthData(payload, repository);
    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect(repository.days.size).toBe(1);
    expect(repository.snapshots).toHaveLength(2);
  });

  it("returns after durable persistence while dependent refresh is still slow", async () => {
    const repository = new MemoryRepository();
    const pendingRefresh = new Promise<boolean>(() => undefined);
    afterHealthSyncMatch.mockReturnValue(pendingRefresh);

    const response = await Promise.race([
      syncHealthData({ days: [{ date: "2026-08-21", steps: 100 }] }, repository, undefined, undefined, undefined, {
        deferDependentRefresh: true,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("response waited for dependent refresh")), 100)),
    ]);

    expect(response).toMatchObject({ status: "ok", modelPublicationStatus: "stale", received: 1, created: 1 });
    expect(repository.days.get("2026-08-21")?.steps).toBe(100);
    expect(repository.snapshots).toHaveLength(1);
    expect(repository.snapshots[0]?.metadata.deferDependentRefresh).toBe(true);
    expect(afterHealthSyncMatch).not.toHaveBeenCalled();
    expect(repository.prunedCutoffs).toHaveLength(0);
    afterHealthSyncMatch.mockReset().mockResolvedValue(true);
  });

  it("refreshes already persisted dates without replaying raw writes", async () => {
    const repository = new MemoryRepository();
    afterHealthSyncMatch.mockClear();
    const result = await syncHealthData({ days: [{ date: "2026-08-21" }] }, repository, undefined, undefined, undefined, {
      persistedDates: [{ date: "2026-08-21", action: "updated" }],
    });

    expect(result).toMatchObject({ status: "ok", received: 1 });
    expect(repository.days.size).toBe(0);
    expect(repository.snapshots).toHaveLength(0);
    expect(afterHealthSyncMatch).toHaveBeenCalledWith("2026-08-21", { timezone: "Europe/Bratislava" });
  });

  it("passes explicit sync metadata and preserves the raw snapshot", async () => {
    const repository = new MemoryRepository();
    const receivedAt = new Date("2026-08-23T08:00:00Z");
    const rawDay = { Date: "2026-08-23", Steps: 0 };
    await syncHealthData({
      days: [{ date: "2026-08-23", steps: 0 }],
      timezone: "Europe/Bratislava",
      syncedAt: "2026-08-23T10:00:00+02:00",
    }, repository, [rawDay], receivedAt);
    expect(repository.snapshots[0]).toEqual({
      day: { date: "2026-08-23", steps: 0 },
      rawDay,
      metadata: {
        timezone: "Europe/Bratislava",
        receivedAt,
        syncedAt: "2026-08-23T10:00:00+02:00",
      },
    });
  });

  it("creates, updates, clears and allows missing strengthTrainingMinutes", async () => {
    const repository = new MemoryRepository();
    await syncHealthData({ days: [{ date: "2026-08-21", strengthTrainingMinutes: 60 }] }, repository);
    await syncHealthData({ days: [{ date: "2026-08-21", strengthTrainingMinutes: 75.5 }] }, repository);
    expect(repository.days.get("2026-08-21")?.strengthTrainingMinutes).toBe(75.5);
    await syncHealthData({ days: [{ date: "2026-08-21", strengthTrainingMinutes: null }] }, repository);
    expect(repository.days.get("2026-08-21")?.strengthTrainingMinutes).toBeNull();
    await syncHealthData({ days: [{ date: "2026-08-22" }] }, repository);
    expect(repository.days.get("2026-08-22")).toEqual({ date: "2026-08-22" });
  });

  it("creates multiple workouts and replaces old workouts on retry", async () => {
    const repository = new MemoryRepository();
    await syncHealthData({ days: [{ date: "2026-08-21", workouts: [workout, { ...workout, type: "cycling" }] }] }, repository);
    expect(repository.workouts.get("2026-08-21")).toHaveLength(2);
    await syncHealthData({ days: [{ date: "2026-08-21", workouts: [{ ...workout, type: "strength" }] }] }, repository);
    expect(repository.workouts.get("2026-08-21")).toEqual([{ ...workout, type: "strength" }]);
  });

  it("does not double-count or derive workout and active energy", async () => {
    const repository = new MemoryRepository();
    await syncHealthData({ days: [{ date: "2026-08-21", activeEnergyKcal: 500, workouts: [{ ...workout, energyKcal: 300 }] }] }, repository);
    expect(repository.days.get("2026-08-21")?.activeEnergyKcal).toBe(500);
    expect(repository.workouts.get("2026-08-21")?.[0]?.energyKcal).toBe(300);
  });

  it("does not modify stored data when today's sync fails", async () => {
    const repository = new MemoryRepository();
    repository.failOnDate = "2026-08-22";
    await expect(
      syncHealthData({ days: [{ date: "2026-08-22" }] }, repository),
    ).rejects.toThrow("simulated transaction failure");
    expect(repository.days.size).toBe(0);
  });

  it("invokes retention after sync but does not delete durable source rows", async () => {
    const repository = new MemoryRepository();
    await syncHealthData({ days: [{ date: "2026-07-20" }] }, repository);
    await syncHealthData({ days: [{ date: "2026-08-21" }] }, repository);
    expect(repository.prunedCutoffs).toEqual(["2026-06-20", "2026-07-22"]);
    expect(repository.days.has("2026-07-20")).toBe(true);
    expect(repository.days.has("2026-08-21")).toBe(true);
  });

  it("still returns ok when retention prune fails", async () => {
    const repository = new MemoryRepository();
    repository.pruneFail = true;
    await expect(syncHealthData({ days: [{ date: "2026-08-21" }] }, repository)).resolves.toMatchObject({
      status: "ok",
      prunedDays: 0,
      prunedSnapshots: 0,
      retentionCutoffDate: "2026-07-22",
    });
    expect(repository.days.has("2026-08-21")).toBe(true);
  });

  it("invokes training diary matcher after syncDay and tolerates matcher failure", async () => {
    const repository = new MemoryRepository();
    afterHealthSyncMatch.mockClear();
    await syncHealthData({ days: [{ date: "2026-08-21" }], timezone: "Europe/Kyiv" }, repository);
    expect(afterHealthSyncMatch).toHaveBeenCalledWith("2026-08-21", { timezone: "Europe/Kyiv" });

    afterHealthSyncMatch.mockRejectedValueOnce(new Error("matcher boom"));
    await expect(syncHealthData({ days: [{ date: "2026-08-22" }] }, repository)).resolves.toMatchObject({
      status: "ok",
      dates: [{ date: "2026-08-22" }],
    });
  });
});
