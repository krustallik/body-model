import { describe, expect, it } from "vitest";
import {
  calculateOccupationalActivity,
  calculateHybridOccupationalActivity,
  calculateOverlapAwareActivity,
  isOccupationalCategory,
  OCCUPATIONAL_CATEGORIES,
} from "@/model/occupational-activity";

describe("occupational activity", () => {
  it("defines the four researched 2024 Compendium categories", () => {
    expect(Object.values(OCCUPATIONAL_CATEGORIES).map(({ met }) => met)).toEqual([1.8, 2.8, 3.3, 4.5]);
    expect(Object.values(OCCUPATIONAL_CATEGORIES).map(({ residualMet }) => residualMet))
      .toEqual([1.8, 2.3, 2.8, 4.5]);
    expect(Object.values(OCCUPATIONAL_CATEGORIES).map(({ compendiumCode }) => compendiumCode))
      .toEqual(["11600", "11860", "11475", "11476"]);
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

  it.each([
    ["standingLight", 0, 1.8],
    ["standingLightModerate", 0, 2.8],
    ["standingLight", 8, 1.8],
    ["manualLight", 8, 2.3],
    ["manualModerate", 2, 4.5],
    ["manualModerate", 40, 4.5],
  ] as const)("decomposes %s with %s km of reconstructed walking", (category, distance, residualMet) => {
    const result = calculateHybridOccupationalActivity({
      category,
      durationHours: 8,
      workWalkingDistanceKm: distance,
      walkingSpeedKmh: distance === 0 ? null : 5,
      weightKg: 80,
      rmrKcalPerDay: 1_800,
    });
    const walkingHours = distance / 5;
    const residualHours = 8 - walkingHours;
    const walking = distance === 0 ? 0 : 3.8 * 80 * walkingHours - 1_800 / 24 * walkingHours;
    const residual = residualMet * 80 * residualHours - 1_800 / 24 * residualHours;
    expect(result).toMatchObject({
      method: "hybrid-walking-residual",
      walkingDurationHours: walkingHours,
      residualDurationHours: residualHours,
      fallbackReason: null,
    });
    expect(result.walkingActivityKcal).toBeCloseTo(walking, 12);
    expect(result.residualActivityKcal).toBeCloseTo(residual, 12);
    expect(result.activityKcal).toBeCloseTo(walking + residual, 12);
  });

  it("regresses the 8h, 12.9km, 17,883-step light-box scenario from model equations", () => {
    const result = calculateHybridOccupationalActivity({
      category: "manualLight",
      durationHours: 8,
      workWalkingDistanceKm: 12.9,
      walkingSpeedKmh: 5,
      weightKg: 86.6,
      rmrKcalPerDay: 1_800,
    });
    const oldWholeIntervalKcal = 3.3 * 86.6 * 8 - 1_800 / 24 * 8;
    expect(oldWholeIntervalKcal).toBeCloseTo(1_686.24, 10);
    expect(result.walkingDurationHours).toBeCloseTo(2.58, 12);
    expect(result.walkingActivityKcal).toBeCloseTo(3.8 * 86.6 * 2.58 - 75 * 2.58, 12);
    expect(result.residualActivityKcal).toBeCloseTo(2.3 * 86.6 * 5.42 - 75 * 5.42, 12);
    expect(result.activityKcal).toBeCloseTo(
      result.walkingActivityKcal! + result.residualActivityKcal!, 12,
    );
    expect(result.activityKcal).toBeLessThan(oldWholeIntervalKcal);
  });

  it.each([
    { distance: null, speed: 5, reason: "work-walking-unavailable" },
    { distance: 2, speed: null, reason: "walking-speed-unavailable" },
    { distance: 10, speed: 5, durationHours: 1, reason: "walking-duration-exceeds-active-work-time" },
  ] as const)("labels category-only fallback: $reason", ({ distance, speed, durationHours = 8, reason }) => {
    const result = calculateHybridOccupationalActivity({
      category: "manualLight", durationHours, workWalkingDistanceKm: distance,
      walkingSpeedKmh: speed, weightKg: 80, rmrKcalPerDay: 1_800,
    });
    expect(result).toMatchObject({
      method: "category-only-fallback", fallbackReason: reason,
      walkingActivityKcal: null, residualActivityKcal: null,
    });
    expect(result.activityKcal).toBe(calculateOccupationalActivity({
      category: "manualLight", durationHours, weightKg: 80, rmrKcalPerDay: 1_800,
    }));
  });

  it("subtracts an explicit break from active work but leaves walking distance unchanged", () => {
    const result = calculateHybridOccupationalActivity({
      category: "manualLight",
      durationHours: 8,
      breakDurationHours: 0.5,
      workWalkingDistanceKm: 2.5,
      walkingSpeedKmh: 5,
      weightKg: 80,
      rmrKcalPerDay: 1_800,
    });
    expect(result).toMatchObject({
      breakDurationHours: 0.5,
      breakSource: "user-entered",
      activeWorkDurationHours: 7.5,
      walkingDurationHours: 0.5,
      residualDurationHours: 7,
      workWalkingDistanceKm: 2.5,
    });
  });

  it("distinguishes explicit zero from legacy unreported without changing legacy kcal", () => {
    const base = {
      category: "standingLight" as const,
      durationHours: 8,
      workWalkingDistanceKm: 0,
      walkingSpeedKmh: null,
      weightKg: 80,
      rmrKcalPerDay: 1_800,
    };
    const legacy = calculateHybridOccupationalActivity({ ...base, breakDurationHours: null });
    const explicitZero = calculateHybridOccupationalActivity({ ...base, breakDurationHours: 0 });
    expect(legacy).toMatchObject({ breakDurationHours: null, breakSource: "legacy-unreported" });
    expect(explicitZero).toMatchObject({ breakDurationHours: 0, breakSource: "user-entered" });
    expect(explicitZero.activityKcal).toBe(legacy.activityKcal);
  });

  it("applies category fallback only to active work and rejects invalid breaks", () => {
    const result = calculateHybridOccupationalActivity({
      category: "manualLight", durationHours: 8, breakDurationHours: 0.5,
      workWalkingDistanceKm: null, walkingSpeedKmh: null,
      weightKg: 80, rmrKcalPerDay: 1_800,
    });
    expect(result.activityKcal).toBe(calculateOccupationalActivity({
      category: "manualLight", durationHours: 7.5, weightKg: 80, rmrKcalPerDay: 1_800,
    }));
    const conflict = calculateHybridOccupationalActivity({
      category: "manualLight", durationHours: 8, breakDurationHours: 0.5,
      workWalkingDistanceKm: 38, walkingSpeedKmh: 5,
      weightKg: 80, rmrKcalPerDay: 1_800,
    });
    expect(conflict).toMatchObject({
      method: "category-only-fallback",
      activeWorkDurationHours: 7.5,
      fallbackReason: "walking-duration-exceeds-active-work-time",
    });
    expect(conflict.activityKcal).toBe(result.activityKcal);
    expect(() => calculateHybridOccupationalActivity({
      category: "manualLight", durationHours: 8, breakDurationHours: 8,
      workWalkingDistanceKm: 0, walkingSpeedKmh: null,
      weightKg: 80, rmrKcalPerDay: 1_800,
    })).toThrow("shorter than durationHours");
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
