import { describe, expect, it } from "vitest";
import { calculateStrengthActivity } from "@/model/activity/strength";

describe("calculateStrengthActivity", () => {
  // Scientific regression: 3.5 gross MET for multiple resistance exercises;
  // the individualized resting expenditure for the same interval is removed.
  // https://pacompendium.com/wp-content/uploads/2024/02/1_2024-adult-compendium_1_2024.pdf
  it("returns zero for zero workout minutes", () => {
    expect(calculateStrengthActivity({ weightKg: 80, rmrKcalPerDay: 1_920, durationMinutes: 0 })).toBe(0);
  });

  it("calculates a representative 30-minute workout", () => {
    expect(calculateStrengthActivity({ weightKg: 80, rmrKcalPerDay: 1_920, durationMinutes: 30 })).toBeCloseTo(100, 10);
  });

  it("calculates a representative 60-minute workout", () => {
    expect(calculateStrengthActivity({ weightKg: 80, rmrKcalPerDay: 1_920, durationMinutes: 60 })).toBeCloseTo(200, 10);
  });

  it("preserves decimal body weight and duration", () => {
    expect(calculateStrengthActivity({ weightKg: 72.5, rmrKcalPerDay: 1_740, durationMinutes: 37.5 })).toBeCloseTo(113.28125, 10);
  });

  it.each([null, undefined])("returns unavailable for missing duration %s", (durationMinutes) => {
    expect(calculateStrengthActivity({ weightKg: 80, rmrKcalPerDay: 1_920, durationMinutes })).toBeNull();
  });

  it.each([
    ["negative duration", { weightKg: 80, rmrKcalPerDay: 1_920, durationMinutes: -1 }],
    ["zero weight", { weightKg: 0, rmrKcalPerDay: 1_920, durationMinutes: 30 }],
    ["negative weight", { weightKg: -1, rmrKcalPerDay: 1_920, durationMinutes: 30 }],
    ["invalid RMR", { weightKg: 80, rmrKcalPerDay: 0, durationMinutes: 0 }],
  ])("rejects %s", (_label, input) => {
    expect(() => calculateStrengthActivity(input)).toThrow(RangeError);
  });

  it.each([
    ["weightKg", Number.NaN],
    ["weightKg", Number.POSITIVE_INFINITY],
    ["durationMinutes", Number.NaN],
    ["durationMinutes", Number.NEGATIVE_INFINITY],
  ])("rejects non-finite %s", (field, value) => {
    expect(() => calculateStrengthActivity({
      weightKg: field === "weightKg" ? value : 80,
      rmrKcalPerDay: 1_920,
      durationMinutes: field === "durationMinutes" ? value : 30,
    })).toThrow(TypeError);
  });
});
