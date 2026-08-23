import { describe, expect, it } from "vitest";
import {
  BODY_COMPARTMENT_ENERGY_DENSITY,
  FORBES_ENERGY_PARTITION_CONSTANT_KG,
  TISSUE_REMODELING_ENERGY,
} from "@/model/body-composition/constants";
import { partitionEnergyBalance } from "@/model/body-composition/partition";

describe("remodeling-aware tissue energy partition", () => {
  it("exposes independently verified rho and exact eta conversions", () => {
    expect(BODY_COMPARTMENT_ENERGY_DENSITY.fatMassMjPerKg).toBe(39.5);
    expect(BODY_COMPARTMENT_ENERGY_DENSITY.leanTissueMjPerKg).toBe(7.6);
    expect(TISSUE_REMODELING_ENERGY.fatMassKjPerKg).toBe(750);
    expect(TISSUE_REMODELING_ENERGY.leanTissueKjPerKg).toBe(960);
    expect(TISSUE_REMODELING_ENERGY.fatMassKcalPerKg)
      .toBeCloseTo(179.25430210325048, 12);
    expect(TISSUE_REMODELING_ENERGY.leanTissueKcalPerKg)
      .toBeCloseTo(229.4455066921606, 12);
    expect(FORBES_ENERGY_PARTITION_CONSTANT_KG).toBeCloseTo(2.001012658227848, 14);
  });

  it.each([500, -500])("matches the manually verified closed-form golden case for R=%s", (availableEnergyKcal) => {
    const result = partitionEnergyBalance({ availableEnergyKcal, fatMassKg: 20 });
    const sign = Math.sign(availableEnergyKcal);

    expect(result.pRatio).toBeCloseTo(0.09095093436435607, 14);
    expect(result.remodelingDenominator).toBeCloseTo(1.0287489643744823, 14);
    expect(result.partitionableEnergyKcal).toBeCloseTo(sign * 486.0272207457518, 10);
    expect(result.fatStorageEnergyKcal).toBeCloseTo(sign * 441.8225908924145, 10);
    expect(result.leanTissueStorageEnergyKcal).toBeCloseTo(sign * 44.204629853337266, 10);
    expect(result.deltaFatMassKg).toBeCloseTo(sign * 0.046799638488452214, 12);
    expect(result.deltaLeanTissueKg).toBeCloseTo(sign * 0.024335812013995147, 12);
    expect(result.fatRemodelingEnergyKcal).toBeCloseTo(sign * 8.389036535931922, 12);
    expect(result.leanTissueRemodelingEnergyKcal).toBeCloseTo(
      sign * 5.5837427183162855,
      12,
    );
    expect(result.totalRemodelingEnergyKcal).toBeCloseTo(
      sign * 13.972779254248207,
      12,
    );
  });

  it("documents the intentional difference from the old eta-free partition", () => {
    const result = partitionEnergyBalance({ availableEnergyKcal: 500, fatMassKg: 20 });
    const oldDeltaFatKg = 454.524532817822
      / BODY_COMPARTMENT_ENERGY_DENSITY.fatMassKcalPerKg;
    expect(result.partitionableEnergyKcal).toBeLessThan(500);
    expect(result.deltaFatMassKg).toBeLessThan(oldDeltaFatKg);
    expect(result.totalRemodelingEnergyKcal).toBeGreaterThan(0);
  });

  it("returns canonical zeros for zero balance, including negative zero", () => {
    for (const availableEnergyKcal of [0, -0]) {
      const result = partitionEnergyBalance({ availableEnergyKcal, fatMassKg: 20.25 });
      expect(result.inputEnergyKcal).toBe(0);
      expect(result.partitionableEnergyKcal).toBe(0);
      expect(result.fatStorageEnergyKcal).toBe(0);
      expect(result.leanTissueStorageEnergyKcal).toBe(0);
      expect(result.deltaFatMassKg).toBe(0);
      expect(result.deltaLeanTissueKg).toBe(0);
      expect(result.fatRemodelingEnergyKcal).toBe(0);
      expect(result.leanTissueRemodelingEnergyKcal).toBe(0);
      expect(result.totalRemodelingEnergyKcal).toBe(0);
    }
  });

  it("accepts decimal energy and fat mass", () => {
    const result = partitionEnergyBalance({
      availableEnergyKcal: -321.75,
      fatMassKg: 18.375,
    });
    expect(result.pRatio).toBeGreaterThan(0);
    expect(result.pRatio).toBeLessThan(1);
    expect(result.fatStorageEnergyKcal + result.leanTissueStorageEnergyKcal)
      .toBeCloseTo(result.partitionableEnergyKcal, 12);
  });

  it("assigns a larger stored-energy fraction to fat at higher fat mass", () => {
    const leaner = partitionEnergyBalance({ availableEnergyKcal: -500, fatMassKg: 0.1 });
    const higherFat = partitionEnergyBalance({ availableEnergyKcal: -500, fatMassKg: 100 });

    expect(higherFat.pRatio).toBeLessThan(leaner.pRatio);
    expect(Math.abs(higherFat.fatStorageEnergyKcal))
      .toBeGreaterThan(Math.abs(leaner.fatStorageEnergyKcal));
    expect(Math.abs(higherFat.leanTissueStorageEnergyKcal))
      .toBeLessThan(Math.abs(leaner.leanTissueStorageEnergyKcal));
  });

  it.each([0, -1, 1_000.01])("rejects unsupported fat mass %s", (fatMassKg) => {
    expect(() => partitionEnergyBalance({ availableEnergyKcal: -500, fatMassKg }))
      .toThrow(RangeError);
  });

  it.each([
    { availableEnergyKcal: Number.NaN, fatMassKg: 20 },
    { availableEnergyKcal: Number.POSITIVE_INFINITY, fatMassKg: 20 },
    { availableEnergyKcal: -500, fatMassKg: Number.NaN },
    { availableEnergyKcal: -500, fatMassKg: Number.NEGATIVE_INFINITY },
  ])("rejects non-finite inputs", (input) => {
    expect(() => partitionEnergyBalance(input)).toThrow(TypeError);
  });
});
