import { describe, expect, it } from "vitest";
import { calculateDailyEnergy, type DailyEnergyInput } from "@/model/daily-energy";

function completeDay(overrides: Partial<DailyEnergyInput> = {}): DailyEnergyInput {
  return {
    profile: { sex: "male", dateOfBirth: "1990-05-12", heightCm: 180 },
    date: "2026-08-22",
    weightKg: 80,
    macros: { proteinG: 150, carbsG: 200, fatG: 70 },
    walking: { distanceKm: 5, averageSpeedKmh: 5 },
    strength: { durationMinutes: 60 },
    ...overrides,
  };
}

describe("calculateDailyEnergy", () => {
  // Golden calculation:
  // RMR = 10×80 + 6.25×180 - 5×36 + 5 = 1750
  // TEF = 150×4×.25 + 200×4×.075 + 70×9×.02 = 222.6
  // walk = 3.8×80×1 - (1750/24)×1 = 231.083333...
  // strength = 3.5×80×1 - (1750/24)×1 = 207.083333...
  // Base TDEE = 1750 + 222.6 + 438.166666... = 2410.766666...
  it("matches a complete synthetic-day golden result", () => {
    const result = calculateDailyEnergy(completeDay());
    expect(result.rmrKcal).toBeCloseTo(1_750, 10);
    expect(result.tefKcal).toBeCloseTo(222.6, 10);
    expect(result.walkingActivityKcal).toBeCloseTo(231.0833333333, 10);
    expect(result.strengthActivityKcal).toBeCloseTo(207.0833333333, 10);
    expect(result.activityKcal).toBeCloseTo(438.1666666667, 10);
    expect(result.baseTdeeKcal).toBeCloseTo(2_410.7666666667, 10);
  });

  it("handles an explicit no-walking day", () => {
    const result = calculateDailyEnergy(completeDay({
      walking: { distanceKm: 0, averageSpeedKmh: null },
    }));
    expect(result.walkingActivityKcal).toBe(0);
    expect(result.activityKcal).toBeCloseTo(207.0833333333, 10);
  });

  it("handles an explicit no-strength day", () => {
    const result = calculateDailyEnergy(completeDay({ strength: { durationMinutes: 0 } }));
    expect(result.strengthActivityKcal).toBe(0);
    expect(result.activityKcal).toBeCloseTo(231.0833333333, 10);
  });

  it("handles a day with explicitly no tracked activity", () => {
    const result = calculateDailyEnergy(completeDay({
      walking: { distanceKm: 0, averageSpeedKmh: null },
      strength: { durationMinutes: 0 },
    }));
    expect(result.activityKcal).toBe(0);
    expect(result.baseTdeeKcal).toBeCloseTo(1_972.6, 10);
  });

  it("preserves explicit zero macros", () => {
    const result = calculateDailyEnergy(completeDay({
      macros: { proteinG: 0, carbsG: 0, fatG: 0 },
      walking: { distanceKm: 0, averageSpeedKmh: null },
      strength: { durationMinutes: 0 },
    }));
    expect(result.tefKcal).toBe(0);
    expect(result.baseTdeeKcal).toBe(1_750);
  });

  it("keeps Base TDEE unavailable when macros are incomplete", () => {
    const result = calculateDailyEnergy(completeDay({
      macros: { proteinG: null, carbsG: 200, fatG: 70 },
    }));
    expect(result.tefKcal).toBeNull();
    expect(result.baseTdeeKcal).toBeNull();
  });

  it.each([
    ["walking", { walking: { distanceKm: null, averageSpeedKmh: null } }],
    ["strength", { strength: { durationMinutes: null } }],
  ])("keeps Activity and Base TDEE unavailable when %s data is missing", (_label, override) => {
    const result = calculateDailyEnergy(completeDay(override));
    expect(result.activityKcal).toBeNull();
    expect(result.baseTdeeKcal).toBeNull();
  });

  it("supports decimal inputs without producing non-finite outputs", () => {
    const result = calculateDailyEnergy(completeDay({
      profile: { sex: "female", dateOfBirth: "1992-02-29", heightCm: 168.4 },
      weightKg: 72.5,
      macros: { proteinG: 123.4, carbsG: 210.6, fatG: 67.8 },
      walking: { distanceKm: 4.75, averageSpeedKmh: 4.75 },
      strength: { durationMinutes: 37.5 },
    }));
    for (const value of Object.values(result)) {
      expect(value).not.toBeNull();
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it.each([
    ["negative weight", { weightKg: -1 }],
    ["invalid reference date", { date: "not-a-date" }],
    ["negative macro", { macros: { proteinG: -1, carbsG: 200, fatG: 70 } }],
    ["negative walking distance", { walking: { distanceKm: -1, averageSpeedKmh: 5 } }],
    ["negative strength duration", { strength: { durationMinutes: -1 } }],
    ["NaN weight", { weightKg: Number.NaN }],
    ["infinite macro", { macros: { proteinG: Number.POSITIVE_INFINITY, carbsG: 200, fatG: 70 } }],
  ])("rejects %s", (_label, override) => {
    expect(() => calculateDailyEnergy(completeDay(override))).toThrow();
  });

  it("preserves Base TDEE invariants for valid complete inputs", () => {
    const baseline = calculateDailyEnergy(completeDay({
      walking: { distanceKm: 0, averageSpeedKmh: null },
      strength: { durationMinutes: 0 },
    }));
    const active = calculateDailyEnergy(completeDay());
    const longer = calculateDailyEnergy(completeDay({ strength: { durationMinutes: 90 } }));

    expect(active.tefKcal).toBeGreaterThanOrEqual(0);
    expect(active.activityKcal).toBeGreaterThanOrEqual(0);
    expect(active.baseTdeeKcal).toBeGreaterThanOrEqual(active.rmrKcal);
    expect(active.baseTdeeKcal).toBeGreaterThanOrEqual(baseline.baseTdeeKcal ?? Number.POSITIVE_INFINITY);
    expect(longer.baseTdeeKcal).toBeGreaterThanOrEqual(active.baseTdeeKcal ?? Number.POSITIVE_INFINITY);
    expect(Number.isFinite(active.baseTdeeKcal)).toBe(true);
  });
});
