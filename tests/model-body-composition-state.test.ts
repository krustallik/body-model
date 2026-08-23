import { describe, expect, it } from "vitest";
import {
  calculateExtracellularFluidLiters,
  calculateExtracellularFluidMassKg,
  calculateGlycogenAssociatedMassKg,
  calculateGlycogenAssociatedWaterKg,
  reconstructBodyWeightKg,
} from "@/model/body-composition/state";
import { initializeBodyComposition } from "@/model/body-composition/initialization";

describe("Hall body-composition mass state", () => {
  it("derives glycogen-associated water at 2.7 kg per kg", () => {
    expect(calculateGlycogenAssociatedWaterKg(0.5)).toBeCloseTo(1.35, 12);
    expect(calculateGlycogenAssociatedMassKg(0.5)).toBeCloseTo(1.85, 12);
  });

  it("reconstructs BW = F + L + G + 2.7G + ECF", () => {
    expect(reconstructBodyWeightKg({
      fatMassKg: 16,
      leanTissueKg: 47.15,
      glycogenKg: 0.5,
      baselineExtracellularFluidLiters: 15,
      extracellularFluidDeviationLiters: 0,
    })).toBeCloseTo(80, 12);
  });

  it("converts explicit ECF liters to mass using documented water density", () => {
    const fluidState = {
      baselineExtracellularFluidLiters: 15,
      extracellularFluidDeviationLiters: -0.25,
    };
    expect(calculateExtracellularFluidLiters(fluidState)).toBe(14.75);
    expect(calculateExtracellularFluidMassKg(14.75)).toBe(14.75);
  });

  it("demonstrates why observed FFM cannot be combined with explicit fluid compartments", () => {
    const observed = initializeBodyComposition({ weightKg: 80, estimatedBodyFatPercent: 20 });
    const glycogenKg = 0.5;
    const glycogenWaterKg = calculateGlycogenAssociatedWaterKg(glycogenKg);
    const extracellularFluidLiters = 15;

    expect(observed.observedFatMassKg + observed.observedFatFreeMassKg).toBe(80);
    expect(
      observed.observedFatMassKg
      + observed.observedFatFreeMassKg
      + glycogenKg
      + glycogenWaterKg
      + extracellularFluidLiters,
    ).toBeGreaterThan(observed.bodyWeightKg);

    const leanTissueKg = observed.observedFatFreeMassKg
      - glycogenKg
      - glycogenWaterKg
      - extracellularFluidLiters;
    expect(reconstructBodyWeightKg({
      fatMassKg: observed.observedFatMassKg,
      leanTissueKg,
      glycogenKg,
      baselineExtracellularFluidLiters: extracellularFluidLiters,
      extracellularFluidDeviationLiters: 0,
    })).toBeCloseTo(observed.bodyWeightKg, 12);
  });

  it.each([
    {
      fatMassKg: 0, leanTissueKg: 50, glycogenKg: 0.5,
      baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0,
    },
    {
      fatMassKg: 20, leanTissueKg: 0, glycogenKg: 0.5,
      baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0,
    },
  ])("rejects a degenerate energy-bearing compartment", (state) => {
    expect(() => reconstructBodyWeightKg(state)).toThrow(RangeError);
  });

  it.each([
    {
      fatMassKg: -1, leanTissueKg: 50, glycogenKg: 0.5,
      baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0,
    },
    {
      fatMassKg: 20, leanTissueKg: -1, glycogenKg: 0.5,
      baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0,
    },
    {
      fatMassKg: 20, leanTissueKg: 50, glycogenKg: -1,
      baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0,
    },
    {
      fatMassKg: 20, leanTissueKg: 50, glycogenKg: 0.5,
      baselineExtracellularFluidLiters: -1, extracellularFluidDeviationLiters: 0,
    },
  ])("rejects a negative compartment", (state) => {
    expect(() => reconstructBodyWeightKg(state)).toThrow(RangeError);
  });

  it.each([
    {
      fatMassKg: Number.NaN, leanTissueKg: 50, glycogenKg: 0.5,
      baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0,
    },
    {
      fatMassKg: 20, leanTissueKg: Number.POSITIVE_INFINITY, glycogenKg: 0.5,
      baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0,
    },
    {
      fatMassKg: 20, leanTissueKg: 50, glycogenKg: Number.NaN,
      baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0,
    },
    {
      fatMassKg: 20, leanTissueKg: 50, glycogenKg: 0.5,
      baselineExtracellularFluidLiters: 15,
      extracellularFluidDeviationLiters: Number.NEGATIVE_INFINITY,
    },
  ])("rejects a non-finite compartment", (state) => {
    expect(() => reconstructBodyWeightKg(state)).toThrow(TypeError);
  });

  it("rejects finite compartments whose reconstructed mass would overflow", () => {
    expect(() => reconstructBodyWeightKg({
      fatMassKg: Number.MAX_VALUE,
      leanTissueKg: Number.MAX_VALUE,
      glycogenKg: 0,
      baselineExtracellularFluidLiters: 15,
      extracellularFluidDeviationLiters: 0,
    })).toThrow(RangeError);
    expect(() => calculateGlycogenAssociatedWaterKg(Number.MAX_VALUE)).toThrow(RangeError);
    expect(() => calculateGlycogenAssociatedMassKg(Number.MAX_VALUE / 3)).toThrow(RangeError);
  });

  it("rejects a deviation that makes absolute ECF nonpositive", () => {
    expect(() => reconstructBodyWeightKg({
      fatMassKg: 20,
      leanTissueKg: 50,
      glycogenKg: 0.5,
      baselineExtracellularFluidLiters: 15,
      extracellularFluidDeviationLiters: -15,
    })).toThrow(RangeError);
  });

  it("rejects overflowing or invalid direct ECF conversions", () => {
    expect(() => calculateExtracellularFluidLiters({
      baselineExtracellularFluidLiters: Number.MAX_VALUE,
      extracellularFluidDeviationLiters: Number.MAX_VALUE,
    })).toThrow(RangeError);
    expect(() => calculateExtracellularFluidMassKg(-1)).toThrow(RangeError);
    expect(() => calculateExtracellularFluidMassKg(Number.NaN)).toThrow(TypeError);
  });
});
