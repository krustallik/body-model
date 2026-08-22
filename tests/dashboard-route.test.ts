import { beforeEach, describe, expect, it, vi } from "vitest";

const dailyMetricRepository = vi.hoisted(() => ({
  list: vi.fn(),
  latestUpdatedAt: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/modules/days/day.repository", () => ({ dailyMetricRepository }));

import { GET } from "@/app/api/v1/dashboard/route";

const url = "http://localhost/api/v1/dashboard?date=2026-08-22";

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
  updatedAt: `${date}T10:00:00.000Z`,
  ...overrides,
});

describe("GET /api/v1/dashboard", () => {
  beforeEach(() => {
    Object.values(dailyMetricRepository).forEach((mock) => mock.mockReset());
    dailyMetricRepository.latestUpdatedAt.mockResolvedValue(null);
  });

  it("returns an empty dashboard without data", async () => {
    dailyMetricRepository.list.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      today: null,
      recentDays: [],
      hasToday: false,
      lastSync: { at: null, status: null },
    });
  });

  it("returns today's record and keeps missing metrics null", async () => {
    const today = day("2026-08-22", { bodyFatPercent: null, strengthTrainingMinutes: null });
    dailyMetricRepository.list.mockResolvedValueOnce([today]).mockResolvedValueOnce([today]);
    const response = await GET(new Request(url));
    const body = await response.json();

    expect(body.hasToday).toBe(true);
    expect(body.today).toMatchObject({ date: "2026-08-22", bodyFatPercent: null, strengthTrainingMinutes: null });
  });

  it("returns recent days newest first and limits them to seven", async () => {
    const recent = Array.from({ length: 8 }, (_, index) => day(`2026-08-${String(14 + index).padStart(2, "0")}`));
    dailyMetricRepository.list.mockResolvedValueOnce([]).mockResolvedValueOnce(recent);
    const response = await GET(new Request(url));
    const body = await response.json() as { recentDays: Array<{ date: string }> };

    expect(body.recentDays).toHaveLength(7);
    expect(body.recentDays.map(({ date }) => date)).toEqual([
      "2026-08-21", "2026-08-20", "2026-08-19", "2026-08-18", "2026-08-17", "2026-08-16", "2026-08-15",
    ]);
    expect(dailyMetricRepository.list).toHaveBeenNthCalledWith(2, { to: "2026-08-22", limit: 7, offset: 0 });
  });

  it("returns the latest available data timestamp as last sync", async () => {
    dailyMetricRepository.list.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    dailyMetricRepository.latestUpdatedAt.mockResolvedValue("2026-08-22T12:45:00.000Z");
    const response = await GET(new Request(url));
    await expect(response.json()).resolves.toMatchObject({
      lastSync: { at: "2026-08-22T12:45:00.000Z", status: null },
    });
  });

  it("is read-only and never invokes mutation methods", async () => {
    dailyMetricRepository.list.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await GET(new Request(url));
    expect(dailyMetricRepository.create).not.toHaveBeenCalled();
    expect(dailyMetricRepository.update).not.toHaveBeenCalled();
    expect(dailyMetricRepository.delete).not.toHaveBeenCalled();
  });
});
