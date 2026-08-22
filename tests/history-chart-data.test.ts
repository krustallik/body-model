import { describe, expect, it } from "vitest";
import type { DailyMetricDto } from "@/modules/days/day.types";
import {
  filterDaysByRange,
  hasChartData,
  rangeStartDate,
  sortDaysChronologically,
  sortDaysNewestFirst,
} from "@/modules/days/history-chart-data";

function day(date: string, weightKg: number | null = null): DailyMetricDto {
  return {
    date,
    weightKg,
    bodyFatPercent: null,
    caloriesKcal: null,
    proteinG: null,
    fatG: null,
    carbsG: null,
    steps: null,
    activeEnergyKcal: null,
    averageWalkingSpeedKmh: null,
    walkingDistanceKm: null,
    strengthTrainingMinutes: null,
    updatedAt: `${date}T10:00:00.000Z`,
  };
}

describe("history chart data transformations", () => {
  it("sorts chart data chronologically without mutating input", () => {
    const input = [day("2026-08-22"), day("2026-08-20"), day("2026-08-21")];
    expect(sortDaysChronologically(input).map(({ date }) => date)).toEqual([
      "2026-08-20", "2026-08-21", "2026-08-22",
    ]);
    expect(input.map(({ date }) => date)).toEqual(["2026-08-22", "2026-08-20", "2026-08-21"]);
  });

  it("sorts table data newest first", () => {
    expect(sortDaysNewestFirst([day("2026-08-20"), day("2026-08-22"), day("2026-08-21")])
      .map(({ date }) => date)).toEqual(["2026-08-22", "2026-08-21", "2026-08-20"]);
  });

  it("calculates inclusive range starts and filters calendar dates", () => {
    expect(rangeStartDate(7, "2026-08-22")).toBe("2026-08-16");
    const input = [day("2026-08-15"), day("2026-08-16"), day("2026-08-22"), day("2026-08-23")];
    expect(filterDaysByRange(input, 7, "2026-08-22").map(({ date }) => date)).toEqual([
      "2026-08-16", "2026-08-22",
    ]);
    expect(filterDaysByRange(input, "all", "2026-08-22").map(({ date }) => date)).toEqual([
      "2026-08-15", "2026-08-16", "2026-08-22",
    ]);
  });

  it("keeps null values missing instead of converting them to zero", () => {
    const input = [day("2026-08-22", null)];
    const result = filterDaysByRange(input, 30, "2026-08-22");
    expect(result[0]?.weightKg).toBeNull();
    expect(hasChartData(result, ["weightKg"])).toBe(false);
  });

  it("keeps explicit zero as real chart data", () => {
    const input = [day("2026-08-22", 0)];
    const result = sortDaysChronologically(input);
    expect(result[0]?.weightKg).toBe(0);
    expect(hasChartData(result, ["weightKg"])).toBe(true);
  });

  it("handles an empty dataset", () => {
    expect(sortDaysChronologically([])).toEqual([]);
    expect(filterDaysByRange([], 30, "2026-08-22")).toEqual([]);
    expect(hasChartData([], ["weightKg"])).toBe(false);
  });

  it("keeps a single-day dataset renderable", () => {
    const input = [day("2026-08-22", 89.4)];
    expect(sortDaysChronologically(input)).toEqual(input);
    expect(hasChartData(input, ["weightKg"])).toBe(true);
  });
});
