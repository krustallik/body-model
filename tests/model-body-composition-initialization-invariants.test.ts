import { describe, expect, it } from "vitest";
import { initializeBodyComposition } from "@/model/body-composition/initialization";

const weights = [0.1, 50.25, 80, 250.75, 1_000];
const percentages = [0, 0.01, 18.7, 50, 99.99, 100];

describe("body-composition initialization invariants", () => {
  it("conserves body weight and reconstructs the estimated percentage", () => {
    for (const weightKg of weights) {
      for (const estimatedBodyFatPercent of percentages) {
        const result = initializeBodyComposition({ weightKg, estimatedBodyFatPercent });

        expect(result.fatMassKg).toBeGreaterThanOrEqual(0);
        expect(result.fatFreeMassKg).toBeGreaterThanOrEqual(0);
        expect(result.fatMassKg + result.fatFreeMassKg).toBeCloseTo(weightKg, 12);
        expect(result.fatMassKg / result.bodyWeightKg * 100)
          .toBeCloseTo(estimatedBodyFatPercent, 12);
      }
    }
  });

  it("never returns NaN or Infinity for supported boundary values", () => {
    for (const weightKg of weights) {
      for (const estimatedBodyFatPercent of percentages) {
        const result = initializeBodyComposition({ weightKg, estimatedBodyFatPercent });
        for (const value of Object.values(result)) expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
