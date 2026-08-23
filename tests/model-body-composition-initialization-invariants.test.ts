import { describe, expect, it } from "vitest";
import { initializeBodyComposition } from "@/model/body-composition/initialization";
import { partitionEnergyBalance } from "@/model/body-composition/partition";

const weights = [0.1, 50.25, 80, 250.75, 1_000];
const percentages = [0.000001, 0.01, 18.7, 50, 99.99, 99.999999];

describe("body-composition initialization invariants", () => {
  it("conserves body weight and reconstructs the estimated percentage", () => {
    for (const weightKg of weights) {
      for (const estimatedBodyFatPercent of percentages) {
        const result = initializeBodyComposition({ weightKg, estimatedBodyFatPercent });

        expect(result.observedFatMassKg).toBeGreaterThan(0);
        expect(result.observedFatFreeMassKg).toBeGreaterThan(0);
        expect(result.observedFatMassKg + result.observedFatFreeMassKg)
          .toBeCloseTo(weightKg, 12);
        expect(result.observedFatMassKg / result.bodyWeightKg * 100)
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

  it("always produces fat mass accepted by the Phase 4 partition model", () => {
    for (const weightKg of weights) {
      for (const estimatedBodyFatPercent of percentages) {
        const initialized = initializeBodyComposition({ weightKg, estimatedBodyFatPercent });
        const partition = partitionEnergyBalance({
          availableEnergyKcal: -500,
          fatMassKg: initialized.observedFatMassKg,
        });

        expect(partition.inputEnergyKcal).toBe(-500);
        expect(Object.values(partition).every(Number.isFinite)).toBe(true);
      }
    }
  });
});
