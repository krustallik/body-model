import { describe, expect, it } from "vitest";
import {
  BODY_COMPARTMENT_ENERGY_DENSITY,
} from "@/model/body-composition/constants";
import { partitionEnergyBalance } from "@/model/body-composition/partition";

const balances = [-10_000, -500.5, -1, 0, 1, 450.25, 10_000];
const fatMasses = [0.1, 8.75, 20, 50.5, 250, 1_000];

describe("energy partition invariants", () => {
  it("conserves energy across representative deficits and surpluses", () => {
    for (const energyBalanceKcal of balances) {
      for (const fatMassKg of fatMasses) {
        const result = partitionEnergyBalance({ energyBalanceKcal, fatMassKg });

        expect(result.fatEnergyKcal + result.fatFreeMassEnergyKcal)
          .toBeCloseTo(energyBalanceKcal, 10);
        expect(
          result.deltaFatMassKg * BODY_COMPARTMENT_ENERGY_DENSITY.fatMassKcalPerKg
          + result.deltaFatFreeMassKg
            * BODY_COMPARTMENT_ENERGY_DENSITY.fatFreeMassKcalPerKg,
        ).toBeCloseTo(energyBalanceKcal, 10);
      }
    }
  });

  it("keeps p-ratio strictly between zero and one", () => {
    for (const fatMassKg of fatMasses) {
      const { pRatio } = partitionEnergyBalance({ energyBalanceKcal: 500, fatMassKg });
      expect(pRatio).toBeGreaterThan(0);
      expect(pRatio).toBeLessThan(1);
    }
  });

  it("preserves the sign of nonzero imbalance in both compartments", () => {
    for (const energyBalanceKcal of balances.filter((value) => value !== 0)) {
      const result = partitionEnergyBalance({ energyBalanceKcal, fatMassKg: 20 });
      expect(Math.sign(result.fatEnergyKcal)).toBe(Math.sign(energyBalanceKcal));
      expect(Math.sign(result.fatFreeMassEnergyKcal)).toBe(Math.sign(energyBalanceKcal));
      expect(Math.sign(result.deltaFatMassKg)).toBe(Math.sign(energyBalanceKcal));
      expect(Math.sign(result.deltaFatFreeMassKg)).toBe(Math.sign(energyBalanceKcal));
    }
  });

  it("never returns NaN or Infinity for supported finite boundary inputs", () => {
    const cases = [
      { energyBalanceKcal: -Number.MAX_VALUE, fatMassKg: Number.MIN_VALUE },
      { energyBalanceKcal: Number.MAX_VALUE, fatMassKg: 1_000 },
    ];

    for (const input of cases) {
      const result = partitionEnergyBalance(input);
      for (const value of Object.values(result)) expect(Number.isFinite(value)).toBe(true);
    }
  });
});
