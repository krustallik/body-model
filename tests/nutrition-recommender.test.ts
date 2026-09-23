import { describe, expect, it } from "vitest";
import {
  ADULT_MAX_PROTEIN_ENERGY_FRACTION,
  ADULT_MAX_CARBOHYDRATE_ENERGY_FRACTION,
  ADULT_MIN_CARBOHYDRATE_ENERGY_FRACTION,
  ADULT_MIN_PROTEIN_ENERGY_FRACTION,
  APPROXIMATE_UNTRAINED_PROTEIN_PER_KG_G,
  DEFAULT_STARTING_CALORIES_KCAL,
  GAIN_PACE_REVIEW_LIMIT_PER_WEEK,
  MIN_FAT_ENERGY_FRACTION,
  LOSS_PACE_REVIEW_LIMIT_PER_WEEK,
  MACRO_ENERGY_KCAL_PER_GRAM,
  recommendNutrition,
  recommendNutritionAtCalories,
  type NutritionRecommendationInput,
} from "@/modules/nutrition-recommender/nutrition-recommender";

const supported: NutritionRecommendationInput = {
  currentWeightKg: 80,
  modeledTdeeKcalPerDay: 2500,
  modelEnergyStatus: "available",
  calibrationStatus: "fully-calibrated",
  ageYears: 35,
  sex: "female",
  heightCm: 170,
  strengthSessionsPerWeek: 3,
  otherTrainingSessionsPerWeek: 0,
  averageStepsPerDay: 8000,
  targetWeightKg: 80,
  targetDate: "2026-11-22",
  latestModeledDate: "2026-08-24",
};

function energy(nutrition: ReturnType<typeof recommendNutrition>["nutrition"]): number {
  return nutrition.proteinG * MACRO_ENERGY_KCAL_PER_GRAM.protein
    + nutrition.fatG * MACRO_ENERGY_KCAL_PER_GRAM.fat
    + nutrition.carbsG * MACRO_ENERGY_KCAL_PER_GRAM.carbohydrate;
}

describe("deterministic nutrition recommender", () => {
  it("returns deterministic output for identical input", () => {
    expect(recommendNutrition(supported)).toEqual(recommendNutrition(supported));
  });

  it("uses calibrated model TDEE as maintenance energy and uses resistance training for a protein starting point", () => {
    const result = recommendNutrition(supported);
    expect(result.nutrition.caloriesKcal).toBe(2500);
    expect(result.nutrition.proteinG).toBe(128);
    expect(result.basis).toBe("model-tdee");
    expect(result.confidence).toBe("model-anchored");
  });

  it("rebuilds macros at the solver-selected calories instead of scaling the reference template", () => {
    const result = recommendNutritionAtCalories(supported, 2100.5);
    expect(result.basis).toBe("solver-selected-calories");
    expect(result.nutrition.caloriesKcal).toBe(2100.5);
    expect(result.nutrition.proteinG).toBe(128);
    expect(Math.abs(energy(result.nutrition) - 2100.5)).toBeLessThan(0.001);
    expect(result.nutrition.fatG * 9 / 2100.5).toBeCloseTo(0.25, 4);
    expect(result.nutrition.carbsG * 4 / 2100.5).toBeGreaterThanOrEqual(ADULT_MIN_CARBOHYDRATE_ENERGY_FRACTION - 0.001);
    expect(result.nutrition.carbsG * 4 / 2100.5).toBeLessThanOrEqual(ADULT_MAX_CARBOHYDRATE_ENERGY_FRACTION + 0.001);
  });

  it("rejects a missing or invalid solver calorie center instead of applying the old template", () => {
    expect(() => recommendNutritionAtCalories(supported, 0)).toThrow(/finite and positive/i);
    expect(() => recommendNutritionAtCalories(supported, Number.NaN)).toThrow(/finite and positive/i);
  });

  it("does not translate loss/gain weight and dates into a calorie deficit or surplus", () => {
    const maintenance = recommendNutrition(supported);
    const loss = recommendNutrition({ ...supported, targetWeightKg: 70 });
    const gain = recommendNutrition({ ...supported, targetWeightKg: 82 });
    expect(loss.nutrition).toEqual(maintenance.nutrition);
    expect(gain.nutrition).toEqual(maintenance.nutrition);
    expect(gain.limitations).not.toContain("target-rate-review");
  });

  it("flags an aggressive rate as a review limitation while keeping the bounded maintenance template", () => {
    const ordinary = recommendNutrition({
      ...supported, currentWeightKg: 70, targetWeightKg: 69.31,
      latestModeledDate: "2026-08-24", targetDate: "2026-08-31",
    });
    const fast = recommendNutrition({
      ...supported, currentWeightKg: 70, targetWeightKg: 69.29,
      latestModeledDate: "2026-08-24", targetDate: "2026-08-31",
    });
    expect(ordinary.limitations).not.toContain("target-rate-review");
    expect(fast.limitations).toContain("target-rate-review");
    expect(fast.nutrition.caloriesKcal).toBe(2500);
  });

  it("flags rapid gain using an athlete-derived product review threshold without creating a surplus", () => {
    const atBoundary = recommendNutrition({
      ...supported, currentWeightKg: 100, targetWeightKg: 100.5,
      latestModeledDate: "2026-08-24", targetDate: "2026-08-31",
    });
    const aboveBoundary = recommendNutrition({
      ...supported, currentWeightKg: 100, targetWeightKg: 100.51,
      latestModeledDate: "2026-08-24", targetDate: "2026-08-31",
    });
    expect(atBoundary.limitations).not.toContain("target-rate-review");
    expect(aboveBoundary.limitations).toContain("target-rate-review");
    expect(aboveBoundary.nutrition.caloriesKcal).toBe(2500);
  });

  it("works without target date or target weight", () => {
    const result = recommendNutrition({ ...supported, targetDate: null, targetWeightKg: null });
    expect(result.nutrition.caloriesKcal).toBe(2500);
    expect(result.limitations).not.toContain("target-date-or-weight-incomplete");
  });

  it("reports incomplete target context without blocking an otherwise valid template", () => {
    const result = recommendNutrition({ ...supported, targetDate: null, targetWeightKg: 75 });
    expect(result.limitations).toContain("target-date-or-weight-incomplete");
    expect(result.nutrition.caloriesKcal).toBe(2500);
  });

  it("reports a missing target weight when the caller supplied only a date", () => {
    const result = recommendNutrition({ ...supported, targetWeightKg: null, targetDate: "2026-11-22" });
    expect(result.limitations).toContain("target-date-or-weight-incomplete");
  });

  it.each([
    { modelEnergyStatus: "limited" as const, modeledTdeeKcalPerDay: 2500 },
    { modelEnergyStatus: "available" as const, modeledTdeeKcalPerDay: null },
    { modelEnergyStatus: "available" as const, modeledTdeeKcalPerDay: Number.NaN },
    { modelEnergyStatus: "available" as const, modeledTdeeKcalPerDay: Number.POSITIVE_INFINITY },
    { modelEnergyStatus: "available" as const, modeledTdeeKcalPerDay: -1 },
  ])("falls back and identifies unavailable or invalid model expenditure %#", (energyInput) => {
    const result = recommendNutrition({ ...supported, ...energyInput });
    expect(result.nutrition.caloriesKcal).toBe(DEFAULT_STARTING_CALORIES_KCAL);
    expect(result.basis).toBe("product-fallback");
    expect(result.confidence).toBe("fallback");
    expect(result.limitations).toContain("model-expenditure-unavailable");
  });

  it("uses the non-resistance branch when strength training is zero", () => {
    const noStrength = recommendNutrition({ ...supported, strengthSessionsPerWeek: 0 });
    expect(noStrength.nutrition.proteinG).toBe(64);
    const strength = recommendNutrition(supported);
    expect(strength.nutrition.proteinG).toBeGreaterThan(noStrength.nutrition.proteinG);
  });

  it("applies the exercising protein starting point for other training", () => {
    const result = recommendNutrition({ ...supported, strengthSessionsPerWeek: 0, otherTrainingSessionsPerWeek: 3 });
    expect(result.nutrition.proteinG).toBe(112);
  });

  it("does not add steps or work calories a second time on top of model TDEE", () => {
    const quiet = recommendNutrition({ ...supported, averageStepsPerDay: 0, workActivity: { planned: false } });
    const active = recommendNutrition({
      ...supported, averageStepsPerDay: 30_000, workActivity: { planned: true, daysPerWeek: 6 },
    });
    expect(active.nutrition).toEqual(quiet.nutrition);
  });

  it("keeps macros energy-consistent and enforces the literature-derived protein/fat distribution bounds", () => {
    for (const result of [
      recommendNutrition(supported),
      recommendNutrition({ ...supported, modeledTdeeKcalPerDay: 1100, currentWeightKg: 180, strengthSessionsPerWeek: 7 }),
      recommendNutrition({ ...supported, modeledTdeeKcalPerDay: 4300, currentWeightKg: 45, strengthSessionsPerWeek: 0 }),
      recommendNutrition({ ...supported, modeledTdeeKcalPerDay: 1, currentWeightKg: 2000 }),
    ]) {
      const macros = result.nutrition;
      expect(Object.values(macros).every(Number.isFinite)).toBe(true);
      expect(macros.proteinG).toBeGreaterThanOrEqual(0);
      expect(macros.fatG).toBeGreaterThanOrEqual(0);
      expect(macros.carbsG).toBeGreaterThanOrEqual(0);
      expect(Math.abs(energy(macros) - macros.caloriesKcal)).toBeLessThan(2);
      const proteinFraction = macros.proteinG * 4 / macros.caloriesKcal;
      expect(proteinFraction).toBeGreaterThanOrEqual(ADULT_MIN_PROTEIN_ENERGY_FRACTION - 0.001);
      expect(proteinFraction).toBeLessThanOrEqual(ADULT_MAX_PROTEIN_ENERGY_FRACTION + 0.001);
      const fatFraction = macros.fatG * 9 / macros.caloriesKcal;
      const carbFraction = macros.carbsG * 4 / macros.caloriesKcal;
      expect(fatFraction).toBeGreaterThanOrEqual(MIN_FAT_ENERGY_FRACTION - 0.001);
      expect(fatFraction).toBeLessThanOrEqual(0.35 + 0.001);
      expect(carbFraction).toBeGreaterThanOrEqual(ADULT_MIN_CARBOHYDRATE_ENERGY_FRACTION - 0.001);
      expect(carbFraction).toBeLessThanOrEqual(ADULT_MAX_CARBOHYDRATE_ENERGY_FRACTION + 0.001);
      expect(macros.carbsG).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns a structured limitation when the evidence-based per-kg protein target meets the adult AMDR cap", () => {
    const result = recommendNutrition({ ...supported, modeledTdeeKcalPerDay: 1200, currentWeightKg: 180 });
    expect(result.nutrition.proteinG).toBeCloseTo(1200 * ADULT_MAX_PROTEIN_ENERGY_FRACTION / 4, 6);
    expect(result.limitations).toContain("protein-energy-bound");
    expect(result.nutrition.carbsG).toBeGreaterThanOrEqual(0);
  });

  it("marks missing weight and low-confidence model data as approximate/fallback", () => {
    const missingWeight = recommendNutrition({ ...supported, currentWeightKg: null });
    const limitedCalibration = recommendNutrition({ ...supported, calibrationStatus: "defaults-retained" });
    expect(missingWeight.limitations).toContain("current-weight-unavailable");
    expect(missingWeight.confidence).toBe("approximate");
    expect(limitedCalibration.confidence).toBe("approximate");
  });

  it("surfaces invalid numeric input and invalid target dates", () => {
    const invalidNumber = recommendNutrition({ ...supported, averageStepsPerDay: Number.NaN });
    const invalidDate = recommendNutrition({ ...supported, targetDate: "2026-02-30" });
    expect(invalidNumber.limitations).toContain("invalid-input");
    expect(invalidDate.limitations).toContain("target-date-invalid");
  });

  it("keeps adult recommendations independent of sex and height metadata", () => {
    const base = recommendNutrition(supported);
    const metadataChanged = recommendNutrition({ ...supported, sex: "male", heightCm: 195 });
    expect(metadataChanged.nutrition).toEqual(base.nutrition);
  });

  it("labels 0.8 g/kg as a product-rounded approximation of EFSA 0.83 and states missing context", () => {
    expect(APPROXIMATE_UNTRAINED_PROTEIN_PER_KG_G).toBe(0.8);
    const result = recommendNutrition({ ...supported, bodyCompositionAvailable: true, strengthSessionsPerWeek: 0, otherTrainingSessionsPerWeek: 0 });
    expect(result.nutrition.proteinG).toBe(64);
    expect(result.limitations).toContain("body-composition-and-clinical-context-not-modeled");
  });

  it("labels under-18 input outside this adult recommendation domain", () => {
    const result = recommendNutrition({ ...supported, ageYears: 17 });
    expect(result.limitations).toContain("adult-guidance-only");
    expect(result.confidence).toBe("approximate");
  });

  it("surfaces older-adult protein guidance as an unmodeled limitation instead of silently applying a tailored rule", () => {
    const result = recommendNutrition({ ...supported, ageYears: 65 });
    expect(result.limitations).toContain("older-adult-guidance-not-modeled");
    expect(result.confidence).toBe("approximate");
  });

  it("keeps the target-rate product guardrail exactly at one percent per week", () => {
    expect(LOSS_PACE_REVIEW_LIMIT_PER_WEEK).toBe(0.01);
    expect(GAIN_PACE_REVIEW_LIMIT_PER_WEEK).toBe(0.005);
  });
});
