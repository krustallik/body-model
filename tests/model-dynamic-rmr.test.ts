import { describe, expect, it } from "vitest";
import {
  calculateDynamicRmr,
  createDynamicRmrParameters,
  DYNAMIC_RMR_COEFFICIENTS,
  type DynamicRmrParameters,
} from "@/model/dynamic-rmr";

const INITIAL = {
  initialRmrKcalPerDay: 1_600,
  initialFatMassKg: 20,
  initialLeanTissueKg: 40,
};

const PARAMETERS = createDynamicRmrParameters(INITIAL);

const calculate = (fatMassKg: number, leanTissueKg: number) => calculateDynamicRmr({
  fatMassKg,
  leanTissueKg,
  parameters: PARAMETERS,
});

describe("dynamic body-composition RMR", () => {
  it("uses the independently verified Hall-style kcal coefficients", () => {
    expect(DYNAMIC_RMR_COEFFICIENTS).toEqual({
      fatMassKcalPerKgPerDay: 3.2,
      leanTissueKcalPerKgPerDay: 22,
    });
  });

  it("calibrates the structural equation exactly to initialized RMR", () => {
    // Structural day-1 RMR = 3.2*20 + 22*40 = 944; offset = 1600-944 = 656.
    expect(PARAMETERS.calibrationOffsetKcalPerDay).toBe(656);
    expect(calculate(20, 40)).toBe(1_600);
  });

  it("matches manually worked fat and lean changes", () => {
    expect(calculate(15, 40)).toBe(1_584);
    expect(calculate(20, 35)).toBe(1_490);
    expect(calculate(25, 40)).toBe(1_616);
    expect(calculate(20, 45)).toBe(1_710);
  });

  it("accepts decimal body composition", () => {
    expect(calculate(19.25, 40.125)).toBeCloseTo(1_600.35, 12);
  });

  it("does not accept glycogen or water inputs, so water cannot directly alter RMR", () => {
    const base = calculate(20, 40);
    const waterChangedState = { fatMassKg: 20, leanTissueKg: 40 };
    expect(calculate(
      waterChangedState.fatMassKg,
      waterChangedState.leanTissueKg,
    )).toBe(base);
  });

  it.each([
    { initialRmrKcalPerDay: 0 },
    { initialRmrKcalPerDay: Number.NaN },
    { initialRmrKcalPerDay: Number.POSITIVE_INFINITY },
    { initialFatMassKg: 0 },
    { initialFatMassKg: -1 },
    { initialFatMassKg: Number.NaN },
    { initialLeanTissueKg: 0 },
    { initialLeanTissueKg: Number.NEGATIVE_INFINITY },
    { initialFatMassKg: 1e308, initialLeanTissueKg: 1e308 },
  ])("rejects invalid initialization: $initialRmrKcalPerDay/$initialFatMassKg/$initialLeanTissueKg", (override) => {
    expect(() => createDynamicRmrParameters({ ...INITIAL, ...override })).toThrow();
  });

  it.each([
    { fatMassKg: 0 },
    { fatMassKg: Number.NaN },
    { leanTissueKg: -1 },
    { leanTissueKg: Number.POSITIVE_INFINITY },
  ])("rejects invalid current composition", (override) => {
    expect(() => calculateDynamicRmr({
      fatMassKg: 20,
      leanTissueKg: 40,
      parameters: PARAMETERS,
      ...override,
    })).toThrow();
  });

  it.each([
    { fatMassKcalPerKgPerDay: -1 },
    { leanTissueKcalPerKgPerDay: -1 },
    { fatMassKcalPerKgPerDay: Number.NaN },
    { leanTissueKcalPerKgPerDay: Number.POSITIVE_INFINITY },
    { calibrationOffsetKcalPerDay: Number.NaN },
  ])("rejects invalid parameters", (override) => {
    expect(() => calculateDynamicRmr({
      fatMassKg: 20,
      leanTissueKg: 40,
      parameters: { ...PARAMETERS, ...override },
    })).toThrow();
  });

  it("rejects a calibrated equation that becomes nonpositive", () => {
    const parameters: DynamicRmrParameters = {
      ...DYNAMIC_RMR_COEFFICIENTS,
      calibrationOffsetKcalPerDay: -1_000,
    };
    expect(() => calculateDynamicRmr({
      fatMassKg: 1,
      leanTissueKg: 1,
      parameters,
    })).toThrow(/remain positive/);
  });

  it("rejects numeric overflow and never emits NaN or Infinity", () => {
    expect(() => calculateDynamicRmr({
      fatMassKg: 1e308,
      leanTissueKg: 1e308,
      parameters: PARAMETERS,
    })).toThrow(/finite/);
    expect(() => calculateDynamicRmr({
      fatMassKg: 1,
      leanTissueKg: 1,
      parameters: {
        fatMassKcalPerKgPerDay: 1e308,
        leanTissueKcalPerKgPerDay: 0,
        calibrationOffsetKcalPerDay: 1e308,
      },
    })).toThrow(/exceeds finite/);
    for (let fat = 1; fat <= 100; fat += 1.25) {
      const result = calculate(fat, 40 + fat / 10);
      expect(Number.isFinite(result)).toBe(true);
    }
  });
});
