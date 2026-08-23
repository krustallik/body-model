import { describe, expect, it } from "vitest";
import { calculateWalkingActivity } from "@/model/activity/walking";
import type { BodyCompositionState } from "@/model/body-composition/state";
import {
  calculateDynamicDailyExpenditure,
  type DynamicDailyExpenditureInput,
} from "@/model/dynamic-daily-expenditure";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";

const INITIAL_FAT_KG = 20;
const INITIAL_LEAN_KG = 40;
const INITIAL_RMR = 1_600;

const rmrParameters = createDynamicRmrParameters({
  initialRmrKcalPerDay: INITIAL_RMR,
  initialFatMassKg: INITIAL_FAT_KG,
  initialLeanTissueKg: INITIAL_LEAN_KG,
});

const bodyComposition: BodyCompositionState = {
  fatMassKg: INITIAL_FAT_KG,
  leanTissueKg: INITIAL_LEAN_KG,
  glycogenKg: 0.5,
  baselineExtracellularFluidLiters: 15,
  extracellularFluidDeviationLiters: 0,
};

const completeInput: DynamicDailyExpenditureInput = {
  bodyComposition,
  rmrParameters,
  macros: { proteinG: 150, carbsG: 200, fatG: 70 },
  outsideWorkWalking: { distanceKm: 5, averageSpeedKmh: 5 },
  strength: { durationMinutes: 60 },
  occupational: { category: "standingLightModerate", durationHours: 4 },
  adaptiveThermogenesisKcalPerDay: -40,
};

const calculate = (override: Partial<DynamicDailyExpenditureInput> = {}) => (
  calculateDynamicDailyExpenditure({ ...completeInput, ...override })
);

describe("one-day dynamic expenditure composition", () => {
  it("matches the manually verified full-day golden example", () => {
    const result = calculate();
    // BW = 20 F + 40 L + .5 G + 1.35 glycogen water + 15 ECF = 76.85 kg.
    expect(result.currentPredictedWeightKg).toBeCloseTo(76.85, 12);
    expect(result.dynamicRmrKcalPerDay).toBe(1_600);
    // TEF = 150*4*.25 + 200*4*.075 + 70*9*.02 = 222.6 kcal.
    expect(result.tefKcalPerDay).toBeCloseTo(222.6, 12);
    // All net MET costs subtract current RMR/24 for their respective duration.
    expect(result.outsideWorkWalkingActivityKcalPerDay).toBeCloseTo(225.36333333333334, 12);
    expect(result.strengthActivityKcalPerDay).toBeCloseTo(202.30833333333334, 12);
    expect(result.occupationalActivityKcalPerDay).toBeCloseTo(747.7533333333333, 12);
    expect(result.activityKcalPerDay).toBeCloseTo(1_175.425, 12);
    expect(result.adaptiveThermogenesisKcalPerDay).toBe(-40);
    expect(result.modelTdeeBeforePersonalizationKcalPerDay).toBeCloseTo(2_958.025, 12);
  });

  it("recalculates identical walking behavior from current weight exactly once", () => {
    const at80 = calculate({
      bodyComposition: {
        fatMassKg: 20,
        leanTissueKg: 40,
        glycogenKg: 0,
        baselineExtracellularFluidLiters: 20,
        extracellularFluidDeviationLiters: 0,
      },
    });
    const at72 = calculate({
      bodyComposition: {
        fatMassKg: 15,
        leanTissueKg: 37,
        glycogenKg: 0,
        baselineExtracellularFluidLiters: 20,
        extracellularFluidDeviationLiters: 0,
      },
    });
    expect(at80.currentPredictedWeightKg).toBe(80);
    expect(at72.currentPredictedWeightKg).toBe(72);
    expect(at72.outsideWorkWalkingActivityKcalPerDay).toBeLessThan(
      at80.outsideWorkWalkingActivityKcalPerDay!,
    );
    const directAt72 = calculateWalkingActivity({
      weightKg: 72,
      rmrKcalPerDay: at72.dynamicRmrKcalPerDay,
      distanceKm: 5,
      averageSpeedKmh: 5,
    });
    expect(at72.outsideWorkWalkingActivityKcalPerDay).toBe(directAt72);
    expect(at72.outsideWorkWalkingActivityKcalPerDay).not.toBeCloseTo(
      directAt72! * (72 / 80),
      10,
    );
  });

  it("keeps RMR water-independent while total-mass activity responds to water", () => {
    const dry = calculate({
      bodyComposition: {
        ...bodyComposition,
        glycogenKg: 0.25,
        extracellularFluidDeviationLiters: -1,
      },
    });
    const waterRich = calculate({
      bodyComposition: {
        ...bodyComposition,
        glycogenKg: 0.75,
        extracellularFluidDeviationLiters: 1,
      },
    });
    expect(waterRich.dynamicRmrKcalPerDay).toBe(dry.dynamicRmrKcalPerDay);
    expect(waterRich.currentPredictedWeightKg).toBeGreaterThan(dry.currentPredictedWeightKg);
    expect(waterRich.outsideWorkWalkingActivityKcalPerDay).toBeGreaterThan(
      dry.outsideWorkWalkingActivityKcalPerDay!,
    );
  });

  it("passes current dynamic RMR into the resting subtraction", () => {
    const lowerLean = calculate({
      bodyComposition: { ...bodyComposition, leanTissueKg: 35 },
    });
    expect(lowerLean.dynamicRmrKcalPerDay).toBe(1_490);
    expect(lowerLean.outsideWorkWalkingActivityKcalPerDay).toBeCloseTo(
      3.8 * lowerLean.currentPredictedWeightKg - 1_490 / 24,
      12,
    );
  });

  it("treats explicit no activity and zero macros as known zero", () => {
    const result = calculate({
      macros: { proteinG: 0, carbsG: 0, fatG: 0 },
      outsideWorkWalking: { distanceKm: 0, averageSpeedKmh: null },
      strength: { durationMinutes: 0 },
      occupational: { category: null, durationHours: 0 },
      adaptiveThermogenesisKcalPerDay: 0,
    });
    expect(result).toMatchObject({
      tefKcalPerDay: 0,
      outsideWorkWalkingActivityKcalPerDay: 0,
      strengthActivityKcalPerDay: 0,
      occupationalActivityKcalPerDay: 0,
      activityKcalPerDay: 0,
      adaptiveThermogenesisKcalPerDay: 0,
      modelTdeeBeforePersonalizationKcalPerDay: 1_600,
    });
  });

  it.each([
    { macros: { proteinG: null, carbsG: 200, fatG: 70 } },
    { outsideWorkWalking: { distanceKm: null, averageSpeedKmh: 5 } },
    { strength: { durationMinutes: null } },
    { occupational: { category: "standingLight" as const, durationHours: null } },
    { occupational: { category: null, durationHours: 4 } },
    { adaptiveThermogenesisKcalPerDay: null },
  ])("keeps missing input unavailable rather than manufacturing zero", (override) => {
    const result = calculate(override);
    expect(result.modelTdeeBeforePersonalizationKcalPerDay).toBeNull();
  });

  it("keeps activity unavailable when one activity component is missing", () => {
    const result = calculate({ strength: { durationMinutes: undefined } });
    expect(result.strengthActivityKcalPerDay).toBeNull();
    expect(result.activityKcalPerDay).toBeNull();
  });

  it("accepts decimal behavior and positive AT", () => {
    const result = calculate({
      outsideWorkWalking: { distanceKm: 4.25, averageSpeedKmh: 4.75 },
      strength: { durationMinutes: 42.5 },
      occupational: { category: "manualLight", durationHours: 3.25 },
      adaptiveThermogenesisKcalPerDay: 12.75,
    });
    expect(result.modelTdeeBeforePersonalizationKcalPerDay).toBeGreaterThan(0);
    expect(Object.values(result).every((value) => value === null || Number.isFinite(value))).toBe(true);
  });

  it.each([
    { adaptiveThermogenesisKcalPerDay: Number.NaN },
    { adaptiveThermogenesisKcalPerDay: Number.POSITIVE_INFINITY },
    { occupational: { category: "manualLight" as const, durationHours: Number.NaN } },
    { occupational: { category: "manualLight" as const, durationHours: -1 } },
    { occupational: { category: "manualLight" as const, durationHours: 25 } },
    { occupational: { category: "invalid" as "manualLight", durationHours: 1 } },
  ])("rejects invalid daily input", (override) => {
    expect(() => calculate(override)).toThrow();
  });

  it("rejects a nonpositive completed total caused by an impossible AT state", () => {
    expect(() => calculate({
      adaptiveThermogenesisKcalPerDay: -10_000,
    })).toThrow(/positive and finite/);
  });

  it("rejects a nonfinite completed total rather than emitting Infinity", () => {
    expect(() => calculate({
      macros: { proteinG: 1e308, carbsG: 1e308, fatG: 1e308 },
    })).toThrow(/positive and finite/);
  });
});
