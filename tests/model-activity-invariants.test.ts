import { describe, expect, it } from "vitest";
import { calculateStrengthActivity } from "@/model/activity/strength";
import { calculateWalkingActivity } from "@/model/activity/walking";

describe("Activity Engine invariants", () => {
  it("produces finite nonnegative walking values for valid inputs", () => {
    for (const weightKg of [45, 72.5, 120]) {
      for (const averageSpeedKmh of [2, 3.2, 5, 6.4, 8.9]) {
        const value = calculateWalkingActivity({ weightKg, rmrKcalPerDay: 1_800, distanceKm: 5, averageSpeedKmh });
        expect(value).not.toBeNull();
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("does not reduce kcal when distance increases at identical speed and weight", () => {
    const shorter = calculateWalkingActivity({ weightKg: 80, rmrKcalPerDay: 1_800, distanceKm: 2, averageSpeedKmh: 5 });
    const longer = calculateWalkingActivity({ weightKg: 80, rmrKcalPerDay: 1_800, distanceKm: 4, averageSpeedKmh: 5 });
    expect(longer).toBeGreaterThanOrEqual(shorter ?? Number.POSITIVE_INFINITY);
  });

  it("does not reduce walking kcal when body weight increases", () => {
    const lighter = calculateWalkingActivity({ weightKg: 60, rmrKcalPerDay: 1_800, distanceKm: 5, averageSpeedKmh: 5 });
    const heavier = calculateWalkingActivity({ weightKg: 90, rmrKcalPerDay: 1_800, distanceKm: 5, averageSpeedKmh: 5 });
    expect(heavier).toBeGreaterThanOrEqual(lighter ?? Number.POSITIVE_INFINITY);
  });

  it("does not reduce strength kcal with longer duration or greater weight", () => {
    const baseline = calculateStrengthActivity({ weightKg: 60, rmrKcalPerDay: 1_800, durationMinutes: 30 });
    const longer = calculateStrengthActivity({ weightKg: 60, rmrKcalPerDay: 1_800, durationMinutes: 60 });
    const heavier = calculateStrengthActivity({ weightKg: 90, rmrKcalPerDay: 1_800, durationMinutes: 30 });
    expect(longer).toBeGreaterThanOrEqual(baseline ?? Number.POSITIVE_INFINITY);
    expect(heavier).toBeGreaterThanOrEqual(baseline ?? Number.POSITIVE_INFINITY);
  });
});
