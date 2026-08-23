import { describe, expect, it } from "vitest";
import {
  BODY_COMPARTMENT_ENERGY_DENSITY,
} from "@/model/body-composition/constants";
import { partitionEnergyBalance } from "@/model/body-composition/partition";

const balances = [-10_000, -500.5, -1, 0, 1, 450.25, 10_000];
const fatMasses = [0.1, 8.75, 20, 50.5, 250, 1_000];

describe("energy partition invariants", () => {
  it("conserves energy across representative deficits and surpluses", () => {
    for (const availableEnergyKcal of balances) {
      for (const fatMassKg of fatMasses) {
        const result = partitionEnergyBalance({ availableEnergyKcal, fatMassKg });

        expect(result.fatStorageEnergyKcal + result.leanTissueStorageEnergyKcal)
          .toBeCloseTo(result.partitionableEnergyKcal, 10);
        expect(
          result.deltaFatMassKg * BODY_COMPARTMENT_ENERGY_DENSITY.fatMassKcalPerKg
          + result.deltaLeanTissueKg
            * BODY_COMPARTMENT_ENERGY_DENSITY.leanTissueKcalPerKg,
        ).toBeCloseTo(result.partitionableEnergyKcal, 10);
        expect(result.fatStorageEnergyKcal + result.leanTissueStorageEnergyKcal
          + result.totalRemodelingEnergyKcal).toBeCloseTo(availableEnergyKcal, 10);
        expect(result.fatRemodelingEnergyKcal + result.leanTissueRemodelingEnergyKcal)
          .toBeCloseTo(result.totalRemodelingEnergyKcal, 12);
      }
    }
  });

  it("keeps p-ratio strictly between zero and one", () => {
    for (const fatMassKg of fatMasses) {
      const { pRatio } = partitionEnergyBalance({ availableEnergyKcal: 500, fatMassKg });
      expect(pRatio).toBeGreaterThan(0);
      expect(pRatio).toBeLessThan(1);
    }
  });

  it("preserves the sign of nonzero imbalance in both compartments", () => {
    for (const availableEnergyKcal of balances.filter((value) => value !== 0)) {
      const result = partitionEnergyBalance({ availableEnergyKcal, fatMassKg: 20 });
      expect(Math.sign(result.fatStorageEnergyKcal)).toBe(Math.sign(availableEnergyKcal));
      expect(Math.sign(result.leanTissueStorageEnergyKcal)).toBe(Math.sign(availableEnergyKcal));
      expect(Math.sign(result.deltaFatMassKg)).toBe(Math.sign(availableEnergyKcal));
      expect(Math.sign(result.deltaLeanTissueKg)).toBe(Math.sign(availableEnergyKcal));
      expect(Math.sign(result.totalRemodelingEnergyKcal)).toBe(Math.sign(availableEnergyKcal));
    }
  });

  it("keeps stored tissue energy monotonic with the available balance", () => {
    const deficits = [-1_000, -500, -100].map((availableEnergyKcal) => (
      partitionEnergyBalance({ availableEnergyKcal, fatMassKg: 20 }).partitionableEnergyKcal
    ));
    const surpluses = [100, 500, 1_000].map((availableEnergyKcal) => (
      partitionEnergyBalance({ availableEnergyKcal, fatMassKg: 20 }).partitionableEnergyKcal
    ));
    expect(deficits[0]).toBeLessThan(deficits[1]);
    expect(deficits[1]).toBeLessThan(deficits[2]);
    expect(deficits.every((value) => value < 0)).toBe(true);
    expect(surpluses[0]).toBeLessThan(surpluses[1]);
    expect(surpluses[1]).toBeLessThan(surpluses[2]);
    expect(surpluses.every((value) => value > 0)).toBe(true);
  });

  it("never returns NaN or Infinity for supported finite boundary inputs", () => {
    const cases = [
      { availableEnergyKcal: -Number.MAX_VALUE, fatMassKg: Number.MIN_VALUE },
      { availableEnergyKcal: Number.MAX_VALUE, fatMassKg: 1_000 },
    ];

    for (const input of cases) {
      const result = partitionEnergyBalance(input);
      for (const value of Object.values(result)) expect(Number.isFinite(value)).toBe(true);
    }
  });
});
