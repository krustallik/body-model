import { describe, expect, it } from "vitest";
import {
  BODY_COMPARTMENT_ENERGY_DENSITY,
} from "@/model/body-composition/constants";
import { partitionEnergyBalance } from "@/model/body-composition/partition";

const balances = [-10_000, -500.5, -1, 0, 1, 450.25, 10_000];
const fatMasses = [0.1, 8.75, 20, 50.5, 250, 1_000];

describe("energy partition invariants", () => {
  it("conserves energy across representative deficits and surpluses", () => {
    for (const partitionableEnergyKcal of balances) {
      for (const fatMassKg of fatMasses) {
        const result = partitionEnergyBalance({ partitionableEnergyKcal, fatMassKg });

        expect(result.fatEnergyKcal + result.leanTissueEnergyKcal)
          .toBeCloseTo(partitionableEnergyKcal, 10);
        expect(
          result.deltaFatMassKg * BODY_COMPARTMENT_ENERGY_DENSITY.fatMassKcalPerKg
          + result.deltaLeanTissueKg
            * BODY_COMPARTMENT_ENERGY_DENSITY.leanTissueKcalPerKg,
        ).toBeCloseTo(partitionableEnergyKcal, 10);
      }
    }
  });

  it("keeps p-ratio strictly between zero and one", () => {
    for (const fatMassKg of fatMasses) {
      const { pRatio } = partitionEnergyBalance({ partitionableEnergyKcal: 500, fatMassKg });
      expect(pRatio).toBeGreaterThan(0);
      expect(pRatio).toBeLessThan(1);
    }
  });

  it("preserves the sign of nonzero imbalance in both compartments", () => {
    for (const partitionableEnergyKcal of balances.filter((value) => value !== 0)) {
      const result = partitionEnergyBalance({ partitionableEnergyKcal, fatMassKg: 20 });
      expect(Math.sign(result.fatEnergyKcal)).toBe(Math.sign(partitionableEnergyKcal));
      expect(Math.sign(result.leanTissueEnergyKcal)).toBe(Math.sign(partitionableEnergyKcal));
      expect(Math.sign(result.deltaFatMassKg)).toBe(Math.sign(partitionableEnergyKcal));
      expect(Math.sign(result.deltaLeanTissueKg)).toBe(Math.sign(partitionableEnergyKcal));
    }
  });

  it("never returns NaN or Infinity for supported finite boundary inputs", () => {
    const cases = [
      { partitionableEnergyKcal: -Number.MAX_VALUE, fatMassKg: Number.MIN_VALUE },
      { partitionableEnergyKcal: Number.MAX_VALUE, fatMassKg: 1_000 },
    ];

    for (const input of cases) {
      const result = partitionEnergyBalance(input);
      for (const value of Object.values(result)) expect(Number.isFinite(value)).toBe(true);
    }
  });
});
