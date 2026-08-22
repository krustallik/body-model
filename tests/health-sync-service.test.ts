import { describe, expect, it } from "vitest";
import type { HealthSyncRepository } from "@/modules/health/health.repository";
import { syncHealthData } from "@/modules/health/health.service";
import type { HealthDayInput, SyncDateResult } from "@/modules/health/health.types";

class MemoryRepository implements HealthSyncRepository {
  readonly days = new Map<string, HealthDayInput>();
  readonly workouts = new Map<string, NonNullable<HealthDayInput["workouts"]>>();
  failOnDate?: string;

  async syncBatch(days: HealthDayInput[]): Promise<SyncDateResult[]> {
    const nextDays = new Map(this.days);
    const nextWorkouts = new Map(this.workouts);
    const results: SyncDateResult[] = [];

    for (const day of days) {
      if (day.date === this.failOnDate) throw new Error("simulated transaction failure");
      const action = nextDays.has(day.date) ? "updated" : "created";
      const previous = nextDays.get(day.date);
      nextDays.set(day.date, { ...previous, ...day });
      nextWorkouts.set(day.date, day.workouts ?? []);
      results.push({ date: day.date, action });
    }

    this.days.clear();
    nextDays.forEach((value, key) => this.days.set(key, value));
    this.workouts.clear();
    nextWorkouts.forEach((value, key) => this.workouts.set(key, value));
    return results;
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
  });

  it("handles overlapping seven-day syncs without duplicates", async () => {
    const repository = new MemoryRepository();
    const first = Array.from({ length: 7 }, (_, index) => ({
      date: `2026-08-${10 + index}`,
      steps: 100,
      strengthTrainingMinutes: 60,
    }));
    const second = Array.from({ length: 7 }, (_, index) => ({
      date: `2026-08-${13 + index}`,
      steps: 200,
      strengthTrainingMinutes: 75.5,
    }));
    await syncHealthData({ days: first }, repository);
    const result = await syncHealthData({ days: second }, repository);
    expect(result).toMatchObject({ created: 3, updated: 4 });
    expect(repository.days.size).toBe(10);
    expect(repository.days.get("2026-08-13")?.steps).toBe(200);
    expect(repository.days.get("2026-08-13")?.strengthTrainingMinutes).toBe(75.5);
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

  it("rolls back the complete batch on a later-day failure", async () => {
    const repository = new MemoryRepository();
    repository.failOnDate = "2026-08-22";
    await expect(
      syncHealthData({ days: [{ date: "2026-08-21" }, { date: "2026-08-22" }] }, repository),
    ).rejects.toThrow("simulated transaction failure");
    expect(repository.days.size).toBe(0);
  });
});
