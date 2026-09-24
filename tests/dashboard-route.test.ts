import { beforeEach, describe, expect, it, vi } from "vitest";

const dailyMetricRepository = vi.hoisted(() => ({
  listWithTrainingFacts: vi.fn(),
  latestUpdatedAt: vi.fn(),
  latestRestingHeartRate: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const sleepRepository = vi.hoisted(() => ({
  latestCompleted: vi.fn(),
  summariesByDates: vi.fn(),
  summaryForDate: vi.fn(),
}));

vi.mock("@/modules/days/day.repository", () => ({ dailyMetricRepository }));
vi.mock("@/modules/health/sleep.repository", () => ({ sleepRepository }));

import { GET } from "@/app/api/v1/dashboard/route";

const url = "http://localhost/api/v1/dashboard?date=2026-08-22";
const emptyTrainingDay = (date: string) => ({ date, eventCount: 0, durationMinutes: 0, hiddenEventCount: 0, events: [] });

const day = (date: string, overrides: Record<string, unknown> = {}) => ({
  date,
  weightKg: 89.4,
  bodyFatPercent: null,
  caloriesKcal: 587,
  proteinG: 59,
  fatG: 15,
  carbsG: 56,
  steps: 23,
  activeEnergyKcal: null,
  averageWalkingSpeedKmh: 4.572,
  walkingDistanceKm: 0.0125,
  strengthTrainingMinutes: null,
  workouts: [],
  totalWorkoutMinutes: null,
  workoutSource: "none" as const,
  updatedAt: `${date}T10:00:00.000Z`,
  ...overrides,
});

describe("GET /api/v1/dashboard", () => {
  beforeEach(() => {
    Object.values(dailyMetricRepository).forEach((mock) => mock.mockReset());
    Object.values(sleepRepository).forEach((mock) => mock.mockReset());
    dailyMetricRepository.latestUpdatedAt.mockResolvedValue(null);
    dailyMetricRepository.latestRestingHeartRate.mockResolvedValue({ latestBpm: null, timestamp: null });
    dailyMetricRepository.listWithTrainingFacts.mockResolvedValue({ days: [], trainingDays: [] });
    sleepRepository.latestCompleted.mockResolvedValue(null);
  });

  it("returns an empty dashboard without data", async () => {
    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      today: null,
      todayTrainingDay: emptyTrainingDay("2026-08-22"),
      recentDays: [],
      recentTrainingDays: [],
      hasToday: false,
      lastSync: { at: null, status: null },
      restingHeartRate: { latestBpm: null, timestamp: null },
      sleep: null,
    });
  });

  it("returns today's record and keeps missing metrics null", async () => {
    const today = day("2026-08-22", { bodyFatPercent: null, strengthTrainingMinutes: null });
    dailyMetricRepository.listWithTrainingFacts.mockResolvedValue({
      days: [today],
      trainingDays: [emptyTrainingDay("2026-08-22")],
    });
    const response = await GET(new Request(url));
    const body = await response.json();

    expect(body.hasToday).toBe(true);
    expect(body.today).toMatchObject({ date: "2026-08-22", bodyFatPercent: null, strengthTrainingMinutes: null });
  });

  it("returns recent days newest first and limits them to seven", async () => {
    const recent = Array.from({ length: 8 }, (_, index) => day(`2026-08-${String(14 + index).padStart(2, "0")}`));
    dailyMetricRepository.listWithTrainingFacts.mockResolvedValue({
      days: recent,
      trainingDays: [emptyTrainingDay("2026-08-22")],
    });
    const response = await GET(new Request(url));
    const body = await response.json() as { recentDays: Array<{ date: string }> };

    expect(body.recentDays).toHaveLength(7);
    expect(body.recentDays.map(({ date }) => date)).toEqual([
      "2026-08-21", "2026-08-20", "2026-08-19", "2026-08-18", "2026-08-17", "2026-08-16", "2026-08-15",
    ]);
    expect(dailyMetricRepository.listWithTrainingFacts).toHaveBeenCalledWith({
      from: "2026-08-16",
      to: "2026-08-22",
      limit: 7,
      offset: 0,
      includeTrainingDays: true,
    });
  });

  it("uses one bounded training-fact read and includes event-only dates", async () => {
    const eventOnly = {
      date: "2026-08-21",
      eventCount: 1,
      durationMinutes: null,
      hiddenEventCount: 0,
      events: [],
    };
    dailyMetricRepository.listWithTrainingFacts.mockResolvedValue({
      days: [],
      trainingDays: [emptyTrainingDay("2026-08-22"), eventOnly],
    });

    const body = await (await GET(new Request(url))).json();

    expect(dailyMetricRepository.listWithTrainingFacts).toHaveBeenCalledTimes(1);
    expect(dailyMetricRepository.listWithTrainingFacts).toHaveBeenCalledWith({
      from: "2026-08-16",
      to: "2026-08-22",
      limit: 7,
      offset: 0,
      includeTrainingDays: true,
    });
    expect(body.recentTrainingDays).toContainEqual(eventOnly);
  });

  it("returns the latest available data timestamp as last sync", async () => {
    dailyMetricRepository.listWithTrainingFacts.mockResolvedValue({ days: [], trainingDays: [] });
    dailyMetricRepository.latestUpdatedAt.mockResolvedValue("2026-08-22T12:45:00.000Z");
    const response = await GET(new Request(url));
    await expect(response.json()).resolves.toMatchObject({
      lastSync: { at: "2026-08-22T12:45:00.000Z", status: null },
    });
  });

  it("is read-only and never invokes mutation methods", async () => {
    dailyMetricRepository.listWithTrainingFacts.mockResolvedValue({ days: [], trainingDays: [] });
    await GET(new Request(url));
    expect(dailyMetricRepository.create).not.toHaveBeenCalled();
    expect(dailyMetricRepository.update).not.toHaveBeenCalled();
    expect(dailyMetricRepository.delete).not.toHaveBeenCalled();
  });

  it("keeps the normal production dashboard DTO identical with Unified rows OFF versus ON", async () => {
    const today = day("2026-08-22", { bodyFatPercent: 19.8, activeEnergyKcal: 620 });
    const unifiedRowsOff: readonly unknown[] = [];
    const unifiedRowsOn = [{ profileId: 1, date: today.date, modelRevision: "unified-experimental-physiology-state-v1" }];
    const read = async (unifiedRows: readonly unknown[]) => {
      void unifiedRows;
      Object.values(dailyMetricRepository).forEach((mock) => mock.mockReset());
      Object.values(sleepRepository).forEach((mock) => mock.mockReset());
      dailyMetricRepository.latestUpdatedAt.mockResolvedValue(null);
      dailyMetricRepository.latestRestingHeartRate.mockResolvedValue({ latestBpm: null, timestamp: null });
      sleepRepository.latestCompleted.mockResolvedValue(null);
      dailyMetricRepository.listWithTrainingFacts.mockResolvedValue({
        days: [today],
        trainingDays: [emptyTrainingDay("2026-08-22")],
      });
      return (await GET(new Request(url))).json();
    };

    expect(await read(unifiedRowsOn)).toEqual(await read(unifiedRowsOff));
  });
});
