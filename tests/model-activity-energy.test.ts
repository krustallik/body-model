import { describe, expect, it } from "vitest";
import { RESTING_MET } from "@/model/activity/constants";
import { calculateIndividualizedNetMetActivity } from "@/model/activity/energy";

describe("calculateIndividualizedNetMetActivity", () => {
  // Regression against the Phase 2 standard-MET subtraction. Standard MET
  // assumes 80 kg × 1 kcal/kg/h = 80 resting kcal/h, while individualized
  // Mifflin RMR 1750 kcal/day implies 72.9167 resting kcal/h.
  it("uses individualized RMR instead of the conventional resting 1 MET", () => {
    const individualized = calculateIndividualizedNetMetActivity({
      grossMet: 3.8,
      weightKg: 80,
      durationHours: 1,
      rmrKcalPerDay: 1_750,
    });
    const standardMetSubtraction = (3.8 - RESTING_MET) * 80 * 1;

    expect(standardMetSubtraction).toBeCloseTo(224, 10);
    expect(individualized).toBeCloseTo(231.0833333333, 10);
    expect(individualized).not.toBeCloseTo(standardMetSubtraction, 5);
  });

  it("returns zero for a zero-duration activity", () => {
    expect(calculateIndividualizedNetMetActivity({
      grossMet: 3.8,
      weightKg: 80,
      durationHours: 0,
      rmrKcalPerDay: 1_750,
    })).toBe(0);
  });

  it.each([
    ["negative MET", { grossMet: -1, weightKg: 80, durationHours: 1, rmrKcalPerDay: 1_750 }],
    ["negative duration", { grossMet: 3.8, weightKg: 80, durationHours: -1, rmrKcalPerDay: 1_750 }],
    ["zero RMR", { grossMet: 3.8, weightKg: 80, durationHours: 1, rmrKcalPerDay: 0 }],
    ["net-negative combination", { grossMet: 0.5, weightKg: 40, durationHours: 1, rmrKcalPerDay: 2_400 }],
  ])("rejects %s", (_label, input) => {
    expect(() => calculateIndividualizedNetMetActivity(input)).toThrow(RangeError);
  });

  it.each([
    ["grossMet", Number.NaN],
    ["durationHours", Number.POSITIVE_INFINITY],
    ["rmrKcalPerDay", Number.NaN],
  ])("rejects non-finite %s", (field, value) => {
    expect(() => calculateIndividualizedNetMetActivity({
      grossMet: field === "grossMet" ? value : 3.8,
      weightKg: 80,
      durationHours: field === "durationHours" ? value : 1,
      rmrKcalPerDay: field === "rmrKcalPerDay" ? value : 1_750,
    })).toThrow(TypeError);
  });
});
