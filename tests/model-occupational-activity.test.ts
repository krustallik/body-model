import { describe, expect, it } from "vitest";
import {
  calculateOccupationalActivity,
  calculateOverlapAwareActivity,
  isOccupationalCategory,
  OCCUPATIONAL_CATEGORIES,
} from "@/model/occupational-activity";

describe("occupational activity", () => {
  it("defines the four researched 2024 Compendium categories", () => {
    expect(Object.values(OCCUPATIONAL_CATEGORIES).map(({ met }) => met)).toEqual([1.8, 2.8, 3.3, 4.5]);
    expect(Object.values(OCCUPATIONAL_CATEGORIES).map(({ compendiumCode }) => compendiumCode))
      .toEqual(["11600", "11475", "11610", "11476"]);
    expect(isOccupationalCategory("standingLight")).toBe(true);
    expect(isOccupationalCategory("unknown")).toBe(false);
  });

  it.each(Object.keys(OCCUPATIONAL_CATEGORIES) as (keyof typeof OCCUPATIONAL_CATEGORIES)[])(
    "calculates individualized net kcal for %s",
    (category) => {
      const result = calculateOccupationalActivity({
        category, weightKg: 80, rmrKcalPerDay: 1_800, durationHours: 4,
      });
      expect(result).toBeCloseTo(
        OCCUPATIONAL_CATEGORIES[category].met * 80 * 4 - 1_800 / 24 * 4,
        12,
      );
    },
  );

  it("accepts zero duration", () => {
    expect(calculateOccupationalActivity({
      category: "standingLight", weightKg: 80, rmrKcalPerDay: 1_800, durationHours: 0,
    })).toBe(0);
  });

  it("rejects invalid duration, category, and physiological inputs", () => {
    expect(() => calculateOccupationalActivity({
      category: "standingLight", weightKg: 80, rmrKcalPerDay: 1_800, durationHours: -1,
    })).toThrow(RangeError);
    expect(() => calculateOccupationalActivity({
      category: "standingLight", weightKg: 80, rmrKcalPerDay: 1_800, durationHours: 25,
    })).toThrow(RangeError);
    expect(() => calculateOccupationalActivity({
      category: "unknown" as "standingLight", weightKg: 80, rmrKcalPerDay: 1_800, durationHours: 1,
    })).toThrow(RangeError);
  });

  it("counts occupation, outside-work walking, and strength exactly once", () => {
    const result = calculateOverlapAwareActivity({
      occupationalActivityKcal: 276,
      outsideWorkWalkingDistanceKm: 2.6,
      dailyAverageWalkingSpeedKmh: 5.2,
      strengthTrainingMinutes: 30,
      weightKg: 80,
      rmrKcalPerDay: 1_800,
    })!;
    expect(result.totalActivityKcal).toBeCloseTo(
      result.occupationalActivityKcal
      + result.outsideWorkWalkingActivityKcal
      + result.strengthActivityKcal,
      12,
    );
    const wronglyDoubleCounted = calculateOverlapAwareActivity({
      occupationalActivityKcal: 276,
      outsideWorkWalkingDistanceKm: 5.1,
      dailyAverageWalkingSpeedKmh: 5.2,
      strengthTrainingMinutes: 30,
      weightKg: 80,
      rmrKcalPerDay: 1_800,
    })!;
    expect(result.totalActivityKcal).toBeLessThan(wronglyDoubleCounted.totalActivityKcal);
  });

  it("preserves missing component semantics", () => {
    expect(calculateOverlapAwareActivity({
      occupationalActivityKcal: null,
      outsideWorkWalkingDistanceKm: 0,
      dailyAverageWalkingSpeedKmh: null,
      strengthTrainingMinutes: 0,
      weightKg: 80,
      rmrKcalPerDay: 1_800,
    })).toBeNull();
    expect(calculateOverlapAwareActivity({
      occupationalActivityKcal: 0,
      outsideWorkWalkingDistanceKm: null,
      dailyAverageWalkingSpeedKmh: 5,
      strengthTrainingMinutes: 0,
      weightKg: 80,
      rmrKcalPerDay: 1_800,
    })).toBeNull();
    expect(calculateOverlapAwareActivity({
      occupationalActivityKcal: 0,
      outsideWorkWalkingDistanceKm: 0,
      dailyAverageWalkingSpeedKmh: null,
      strengthTrainingMinutes: null,
      weightKg: 80,
      rmrKcalPerDay: 1_800,
    })).toBeNull();
  });

  it("rejects invalid occupational kcal and overflowing totals", () => {
    expect(() => calculateOverlapAwareActivity({
      occupationalActivityKcal: -1,
      outsideWorkWalkingDistanceKm: 0,
      dailyAverageWalkingSpeedKmh: null,
      strengthTrainingMinutes: 0,
      weightKg: 80,
      rmrKcalPerDay: 1_800,
    })).toThrow(RangeError);
    expect(() => calculateOverlapAwareActivity({
      occupationalActivityKcal: Number.MAX_VALUE,
      outsideWorkWalkingDistanceKm: Number.MAX_VALUE / 1_000,
      dailyAverageWalkingSpeedKmh: 5,
      strengthTrainingMinutes: 0,
      weightKg: 1_000,
      rmrKcalPerDay: 1_800,
    })).toThrow(RangeError);
  });
});
