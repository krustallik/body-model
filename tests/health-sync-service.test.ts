import { describe, expect, it } from "vitest";
import type { HealthSyncRepository } from "@/modules/health/health.repository";
import { syncHealthData } from "@/modules/health/health.service";
import type { HealthDayInput, HealthSyncMetadata, SyncDateResult } from "@/modules/health/health.types";

class MemoryRepository implements HealthSyncRepository {
  readonly days = new Map<string, HealthDayInput>();
  readonly workouts = new Map<string, NonNullable<HealthDayInput["workouts"]>>();
  readonly snapshots: { day: HealthDayInput; rawDay: unknown; metadata: HealthSyncMetadata }[] = [];
  failOnDate?: string;

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
}

const workout = {
  type: "running",
  startAt: "2026-08-21T08:00:00Z",
  endAt: "2026-08-21T08:30:00Z",
  durationMinutes: 30,
};

describe("health synchronization service", () => {
  it("creates a new day", async () => {
    const repository = new MemoryRepository();
    await expect(syncHealthData({ days: [{ date: "2026-08-21" }] }, repository)).resolves.toMatchObject({
      received: 1,
      created: 1,
      updated: 0,
    });
  });

  it("updates an existing day", async () => {
    const repository = new MemoryRepository();
    await syncHealthData({ days: [{ date: "2026-08-21", weightKg: 80 }] }, repository);
    const result = await syncHealthData({ days: [{ date: "2026-08-21", weightKg: 79 }] }, repository);
    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(repository.days.get("2026-08-21")?.weightKg).toBe(79);
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
});
