import { describe, expect, it } from "vitest";
import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import { createGlycogenParameters, stepGlycogenOneDay } from "@/model/body-composition/glycogen";
import {
  deriveEnergyHomeostasisReference,
  glycogenInitialStateInfluence,
  summarizeOffsetSensitivity,
  detectInitializationRegimeChange,
  detectPersistentWaterDisturbance,
} from "@/modules/model-episodes/initialization-bootstrap";

describe("v5 initialization references", () => {
  it("uses grams at the boundary and performs the 4 kcal/g conversion exactly once", () => {
    const parameters = createGlycogenParameters({ baselineCarbIntakeG: 250 });
    expect(parameters.baselineCarbEnergyKcalPerDay).toBe(1_000);
    const transition = stepGlycogenOneDay({
      currentGlycogenKg: 0.5, carbIntakeG: 250, parameters,
    })!;
    expect(transition.deltaGlycogenKg).toBeCloseTo(0, 14);
  });

  it("constructs an E0 whose ordinary simulator expenditure equals intake", () => {
    const observed = { caloriesKcal: 2_400, proteinG: 150, fatG: 80, carbsG: 240 };
    const reference = deriveEnergyHomeostasisReference({
      rmrKcalPerDay: 1_700,
      referenceActivityKcalPerDay: 500,
      personalOffsetKcalPerDay: 120,
      observedReferenceNutrition: observed,
    });
    const result = calculateDynamicDailyExpenditure({
      bodyComposition: {
        fatMassKg: 20, leanTissueKg: 55, glycogenKg: 0.5,
        baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0,
      },
      rmrParameters: {
        fatMassKcalPerKgPerDay: 0, leanTissueKcalPerKgPerDay: 0,
        calibrationOffsetKcalPerDay: 1_700,
      },
      macros: reference.referenceNutrition,
      outsideWorkWalking: { distanceKm: 0, averageSpeedKmh: null },
      strength: { durationMinutes: 0 },
      occupational: { category: null, durationHours: 0 },
      adaptiveThermogenesisKcalPerDay: 0,
      personalization: { personalOffsetKcalPerDay: 120, activityCalibration: 1 },
    });
    // The direct day has zero Activity, so add the separately defined reference schedule.
    expect(result.personalizedTdeeKcalPerDay! + 500)
      .toBeCloseTo(reference.energyKcalPerDay, 10);
  });

  it("uses simulator convergence rather than the AT horizon for glycogen", () => {
    const parameters = createGlycogenParameters({ baselineCarbIntakeG: 250 });
    const sevenDays = glycogenInitialStateInfluence({ parameters, carbsG: Array(7).fill(80) });
    expect(sevenDays.converged).toBe(true);
    expect(sevenDays.associatedMassDifferenceKg).toBeLessThan(0.05);
  });

  it("applies the explicit 25/50 kcal initialization sensitivity gate", () => {
    expect(summarizeOffsetSensitivity(100, [{ id: "near", offsetKcalPerDay: 124 }])
      .confidenceCap).toBe("strong");
    expect(summarizeOffsetSensitivity(100, [{ id: "medium", offsetKcalPerDay: 140 }])
      .confidenceCap).toBe("weak");
    expect(summarizeOffsetSensitivity(100, [{ id: "wide", offsetKcalPerDay: 151 }])
      .confidenceCap).toBe("insufficient");
    expect(summarizeOffsetSensitivity(100, [{ id: "unavailable", offsetKcalPerDay: null }])
      .complete).toBe(false);
  });

  it("classifies diet and activity interventions deterministically", () => {
    const classify = (beforeCalories: number[], afterCalories: number[], beforeActivity: number[], afterActivity: number[]) =>
      detectInitializationRegimeChange({ beforeNutritionKcal: beforeCalories, afterNutritionKcal: afterCalories,
        beforeActivityKcal: beforeActivity, afterActivityKcal: afterActivity,
        beforeCarbsG: [200, 205], afterCarbsG: [200, 205] }).classification;
    expect(classify([2400, 2420], [1900, 1880], [300, 310], [500, 520])).toBe("simultaneous");
    expect(classify([2400, 2420], [2400, 2390], [300, 310], [500, 520])).toBe("activity-only");
    expect(classify([2400, 2420], [1900, 1880], [300, 310], [320, 330])).toBe("nutrition-only");
    expect(classify([2400, 2420], [2410, 2390], [300, 310], [325, 290])).toBe("none");
    expect(detectInitializationRegimeChange({
      beforeNutritionKcal: [2400, 2420], afterNutritionKcal: [2410, 2390],
      beforeActivityKcal: [300, 310], afterActivityKcal: [325, 290],
      beforeCarbsG: [220, 225], afterCarbsG: [70, 75],
    }).classification).toBe("carb-only");
  });

  it("downgrades coherent multi-day unexplained scale shifts", () => {
    expect(detectPersistentWaterDisturbance({ measuredWeightKg: [80, 80, 81, 81, 81, 81],
      predictedWeightKg: [80, 80, 80, 80, 80, 80] }).detected).toBe(true);
    expect(detectPersistentWaterDisturbance({ measuredWeightKg: [80, 80.2, 79.9, 80.1],
      predictedWeightKg: [80, 80, 80, 80] }).detected).toBe(false);
    expect(detectPersistentWaterDisturbance({ measuredWeightKg: [80, 80, 80.2, 80.4, 80.6, 80.8, 81, 81],
      predictedWeightKg: Array(8).fill(80) }).detected).toBe(true);
    expect(detectPersistentWaterDisturbance({ measuredWeightKg: [80, 80.03, 80.06, 80.09, 80.12, 80.15],
      predictedWeightKg: Array(6).fill(80) }).detected).toBe(false);
  });
});
