import { describe, expect, it } from "vitest";
import {
  BODY_COMPARTMENT_ENERGY_DENSITY,
  FORBES_ENERGY_PARTITION_CONSTANT_KG,
} from "@/model/body-composition/constants";
import { partitionEnergyBalance } from "@/model/body-composition/partition";

describe("partitionEnergyBalance", () => {
  it("exposes literature-derived constants without a 7,700 kcal/kg shortcut", () => {
    expect(BODY_COMPARTMENT_ENERGY_DENSITY.fatMassMjPerKg).toBe(39.5);
    expect(BODY_COMPARTMENT_ENERGY_DENSITY.fatFreeMassMjPerKg).toBe(7.6);
    expect(BODY_COMPARTMENT_ENERGY_DENSITY.fatMassKcalPerKg)
      .toBeCloseTo(9_440.726577437857, 10);
    expect(BODY_COMPARTMENT_ENERGY_DENSITY.fatFreeMassKcalPerKg)
      .toBeCloseTo(1_816.4435946462715, 10);
    expect(FORBES_ENERGY_PARTITION_CONSTANT_KG).toBeCloseTo(2.001012658227848, 14);
  });

  it("matches a manually verified 500 kcal deficit golden case", () => {
    const result = partitionEnergyBalance({ energyBalanceKcal: -500, fatMassKg: 20 });

    expect(result.pRatio).toBeCloseTo(0.09095093436435607, 14);
    expect(result.fatEnergyKcal).toBeCloseTo(-454.524532817822, 10);
    expect(result.fatFreeMassEnergyKcal).toBeCloseTo(-45.475467182178036, 10);
    expect(result.deltaFatMassKg).toBeCloseTo(-0.048145079628095375, 12);
    expect(result.deltaFatFreeMassKg).toBeCloseTo(-0.025035441406609592, 12);
  });

  it("uses the same local relation for a moderate surplus", () => {
    const result = partitionEnergyBalance({ energyBalanceKcal: 500, fatMassKg: 20 });

    expect(result.fatEnergyKcal).toBeCloseTo(454.524532817822, 10);
    expect(result.fatFreeMassEnergyKcal).toBeCloseTo(45.475467182178036, 10);
    expect(result.deltaFatMassKg).toBeCloseTo(0.048145079628095375, 12);
    expect(result.deltaFatFreeMassKg).toBeCloseTo(0.025035441406609592, 12);
  });

  it("returns canonical zeros for zero balance, including negative zero", () => {
    for (const energyBalanceKcal of [0, -0]) {
      const result = partitionEnergyBalance({ energyBalanceKcal, fatMassKg: 20.25 });
      expect(result.energyBalanceKcal).toBe(0);
      expect(result.fatEnergyKcal).toBe(0);
      expect(result.fatFreeMassEnergyKcal).toBe(0);
      expect(result.deltaFatMassKg).toBe(0);
      expect(result.deltaFatFreeMassKg).toBe(0);
    }
  });

  it("accepts decimal fat mass", () => {
    const result = partitionEnergyBalance({ energyBalanceKcal: -321.75, fatMassKg: 18.375 });
    expect(result.pRatio).toBeGreaterThan(0);
    expect(result.pRatio).toBeLessThan(1);
    expect(result.fatEnergyKcal + result.fatFreeMassEnergyKcal).toBeCloseTo(-321.75, 12);
  });

  it("assigns a larger energy fraction to fat at higher fat mass", () => {
    const leaner = partitionEnergyBalance({ energyBalanceKcal: -500, fatMassKg: 10 });
    const higherFat = partitionEnergyBalance({ energyBalanceKcal: -500, fatMassKg: 40 });

    expect(higherFat.pRatio).toBeLessThan(leaner.pRatio);
    expect(Math.abs(higherFat.fatEnergyKcal)).toBeGreaterThan(Math.abs(leaner.fatEnergyKcal));
    expect(Math.abs(higherFat.fatFreeMassEnergyKcal))
      .toBeLessThan(Math.abs(leaner.fatFreeMassEnergyKcal));
  });

  it.each([0, -1, 1_000.01])("rejects unsupported fat mass %s", (fatMassKg) => {
    expect(() => partitionEnergyBalance({ energyBalanceKcal: -500, fatMassKg }))
      .toThrow(RangeError);
  });

  it.each([
    { energyBalanceKcal: Number.NaN, fatMassKg: 20 },
    { energyBalanceKcal: Number.POSITIVE_INFINITY, fatMassKg: 20 },
    { energyBalanceKcal: -500, fatMassKg: Number.NaN },
    { energyBalanceKcal: -500, fatMassKg: Number.NEGATIVE_INFINITY },
  ])("rejects non-finite inputs", (input) => {
    expect(() => partitionEnergyBalance(input)).toThrow(TypeError);
  });
});
