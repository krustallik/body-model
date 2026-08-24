import { describe, expect, it } from "vitest";
import { latestCompletedLocalDate } from "@/modules/model-episodes/model-calendar";
import { goalHorizonDays } from "@/modules/model-target-solver/goal-date";
import {
  nutritionConstraintViolation,
  proportionalNutrition,
  scenarioWithNutrition,
} from "@/modules/model-target-solver/nutrition-control";
import { TargetSolverRequestSchema } from "@/modules/model-target-solver/target-solver.schema";
import {
  classifyTargetDirection,
  empiricalTargetAttainment,
  wilsonScoreInterval,
} from "@/modules/model-target-solver/target-probability";

const nutrition = { caloriesKcal: 2_000, proteinG: 150, fatG: 70, carbsG: 200 };
const scenario = {
  mode: "fixed" as const,
  schedule: {
    defaultDay: {
      nutrition,
      outsideWorkWalkingDistanceKm: 5,
      averageWalkingSpeedKmh: 5,
      strengthTrainingMinutes: 30,
      occupation: [{ category: "manualLight" as const, durationHours: 8, breakDurationHours: 0.5,
        workWalkingDistanceKm: 3, averageWalkingSpeedKmh: 4.5 }],
    },
  },
};

describe("target solver support", () => {
  it("scales a complete nutrition vector proportionally", () => {
    expect(proportionalNutrition(nutrition, 1_000)).toEqual({ caloriesKcal: 1_000, proteinG: 75, fatG: 35, carbsG: 100 });
  });

  it("preserves all activity assumptions while replacing nutrition", () => {
    const result = scenarioWithNutrition(scenario, proportionalNutrition(nutrition, 1_800));
    expect(result.schedule.defaultDay.nutrition.caloriesKcal).toBe(1_800);
    expect(result.schedule.defaultDay.occupation).toEqual(scenario.schedule.defaultDay.occupation);
    expect(result.schedule.defaultDay.outsideWorkWalkingDistanceKm).toBe(5);
    expect(result.schedule.defaultDay.strengthTrainingMinutes).toBe(30);
    expect(result).not.toBe(scenario);
  });

  it.each([
    [{ minCaloriesKcal: 1, maxCaloriesKcal: 3_000, minProteinG: 160 }, "protein-below-minimum"],
    [{ minCaloriesKcal: 1, maxCaloriesKcal: 3_000, maxProteinG: 140 }, "protein-above-maximum"],
    [{ minCaloriesKcal: 1, maxCaloriesKcal: 3_000, minFatG: 80 }, "fat-below-minimum"],
    [{ minCaloriesKcal: 1, maxCaloriesKcal: 3_000, maxFatG: 60 }, "fat-above-maximum"],
    [{ minCaloriesKcal: 1, maxCaloriesKcal: 3_000, minCarbsG: 250 }, "carbs-below-minimum"],
    [{ minCaloriesKcal: 1, maxCaloriesKcal: 3_000, maxCarbsG: 190 }, "carbs-above-maximum"],
  ] as const)("rejects explicit macro constraint violations", (constraints, reason) => {
    expect(nutritionConstraintViolation(nutrition, constraints)).toBe(reason);
  });

  it("uses calendar-day arithmetic across CET to CEST", () => {
    const latest = latestCompletedLocalDate(new Date("2026-03-29T12:00:00Z"), "Europe/Bratislava");
    expect(latest).toBe("2026-03-28");
    expect(goalHorizonDays(latest, "2026-03-30")).toBe(2);
  });

  it("uses calendar-day arithmetic across CEST to CET", () => {
    const latest = latestCompletedLocalDate(new Date("2026-10-25T12:00:00Z"), "Europe/Bratislava");
    expect(latest).toBe("2026-10-24");
    expect(goalHorizonDays(latest, "2026-10-27")).toBe(3);
  });

  it("rejects past, zero-horizon, and invalid dates", () => {
    expect(() => goalHorizonDays("2026-08-24", "2026-08-24")).toThrow(/after/);
    expect(() => goalHorizonDays("2026-08-24", "2026-08-23")).toThrow(/after/);
    expect(() => goalHorizonDays("2026-08-24", "2026-02-30")).toThrow(/real calendar date/);
  });

  it("uses empirical terminal paths and direction-specific attainment", () => {
    const loss = empiricalTargetAttainment({
      samplesKg: [77, 79, 80, 81], initialWeightKg: 85, targetWeightKg: 80, maintenanceToleranceKg: 0.5,
    });
    expect(loss).toMatchObject({ direction: "loss", definition: "at-or-below-target", probability: 0.75,
      successes: 3, sampleCount: 4 });
    expect(classifyTargetDirection({ initialWeightKg: 80, targetWeightKg: 80.2,
      maintenanceToleranceKg: 0.5 })).toBe("maintenance");
    expect(empiricalTargetAttainment({ samplesKg: [79.6, 80.2, 81], initialWeightKg: 80,
      targetWeightKg: 80, maintenanceToleranceKg: 0.5 }).probability).toBeCloseTo(2 / 3);
    expect(empiricalTargetAttainment({ samplesKg: [81, 82], initialWeightKg: 78,
      targetWeightKg: 81, maintenanceToleranceKg: 0.5 }).definition).toBe("at-or-above-target");
    expect(empiricalTargetAttainment({ samplesKg: [79, 79, 81, 81], initialWeightKg: 85,
      targetWeightKg: 80, maintenanceToleranceKg: 0.5 }).probability).toBe(0.5);
    expect(empiricalTargetAttainment({ samplesKg: [80, 80.1], initialWeightKg: 80,
      targetWeightKg: 80, maintenanceToleranceKg: 0 })).toMatchObject({ probability: 0.5, successes: 1 });
    expect(empiricalTargetAttainment({ samplesKg: [70, 71], initialWeightKg: 80,
      targetWeightKg: 75, maintenanceToleranceKg: 0.5 }).probability).toBe(1);
    expect(empiricalTargetAttainment({ samplesKg: [80, 81], initialWeightKg: 85,
      targetWeightKg: 75, maintenanceToleranceKg: 0.5 }).probability).toBe(0);
  });

  it("reports Wilson Monte Carlo uncertainty, including boundary counts", () => {
    expect(wilsonScoreInterval(0, 10)).toMatchObject({ lower: 0, method: "wilson-score" });
    expect(wilsonScoreInterval(10, 10).upper).toBe(1);
    expect(wilsonScoreInterval(0, 1)).toMatchObject({ lower: 0, upper: 0.7934506856227626 });
    expect(wilsonScoreInterval(1, 1)).toMatchObject({ lower: 0.20654931437723745, upper: 1 });
    expect(wilsonScoreInterval(256, 512)).toMatchObject({ confidenceLevel: 0.95, method: "wilson-score" });
    const interval = wilsonScoreInterval(50, 100);
    expect(interval.lower).toBeCloseTo(0.4038, 3);
    expect(interval.upper).toBeCloseTo(0.5962, 3);
    expect(() => wilsonScoreInterval(-1, 10)).toThrow(/binomial/);
    expect(() => wilsonScoreInterval(11, 10)).toThrow(/binomial/);
    expect(() => wilsonScoreInterval(0, 0)).toThrow(/binomial/);
    expect(() => empiricalTargetAttainment({ samplesKg: [], initialWeightKg: 80,
      targetWeightKg: 79, maintenanceToleranceKg: 0.5 })).toThrow(/terminal samples/);
    expect(() => empiricalTargetAttainment({ samplesKg: [Number.NaN], initialWeightKg: 80,
      targetWeightKg: 79, maintenanceToleranceKg: 0.5 })).toThrow(/terminal samples/);
    expect(classifyTargetDirection({ initialWeightKg: 80, targetWeightKg: 80,
      maintenanceToleranceKg: 0 })).toBe("maintenance");
    expect(() => classifyTargetDirection({ initialWeightKg: Number.NaN, targetWeightKg: 80,
      maintenanceToleranceKg: 0 })).toThrow(/finite/);
    expect(() => classifyTargetDirection({ initialWeightKg: 80, targetWeightKg: 80,
      maintenanceToleranceKg: -1 })).toThrow(/non-negative/);
  });

  it.each([
    ["protein-heavy", { caloriesKcal: 2_400, proteinG: 300, fatG: 60, carbsG: 165 }],
    ["fat-heavy", { caloriesKcal: 2_400, proteinG: 120, fatG: 180, carbsG: 75 }],
    ["carbohydrate-heavy", { caloriesKcal: 2_400, proteinG: 120, fatG: 40, carbsG: 390 }],
    ["low-carbohydrate", { caloriesKcal: 2_400, proteinG: 180, fatG: 140, carbsG: 105 }],
  ] as const)("preserves and validates the %s proportional template", (_name, reference) => {
    const low = proportionalNutrition(reference, 1_500);
    const high = proportionalNutrition(reference, 3_300);
    expect(nutritionConstraintViolation(low, { minCaloriesKcal: 1_500, maxCaloriesKcal: 3_300 })).toBeNull();
    expect(nutritionConstraintViolation(high, { minCaloriesKcal: 1_500, maxCaloriesKcal: 3_300 })).toBeNull();
    expect(low.proteinG / low.caloriesKcal).toBeCloseTo(reference.proteinG / reference.caloriesKcal);
    expect(high.fatG / high.caloriesKcal).toBeCloseTo(reference.fatG / reference.caloriesKcal);
  });

  it("rejects invalid nutrition vectors and preserves optional scheduled activity", () => {
    expect(nutritionConstraintViolation({ ...nutrition, proteinG: Number.NaN },
      { minCaloriesKcal: 1, maxCaloriesKcal: 3_000 })).toBe("invalid-nutrition-vector");
    expect(nutritionConstraintViolation({ caloriesKcal: 2_000, proteinG: 0, fatG: 0, carbsG: 0 },
      { minCaloriesKcal: 1, maxCaloriesKcal: 3_000 })).toBe("invalid-nutrition-vector");
    const scheduled = { ...scenario, schedule: { ...scenario.schedule,
      byDate: { "2026-09-01": { outsideWorkWalkingDistanceKm: 10,
        occupation: scenario.schedule.defaultDay.occupation } }, strengthByWeekday: { 1: 60 as const } } };
    const result = scenarioWithNutrition(scheduled, proportionalNutrition(nutrition, 1_900));
    expect(result.schedule.byDate?.["2026-09-01"]?.occupation).toEqual(scenario.schedule.defaultDay.occupation);
    expect(result.schedule.strengthByWeekday).toEqual({ 1: 60 });
  });

  it("rejects recent-behavior and ambiguous by-date nutrition", () => {
    const base = {
      goal: { metric: "weightKg", targetValueKg: 75, goalDate: "2026-10-01" },
      control: { type: "daily-calorie-center", constraints: { minCaloriesKcal: 1_500, maxCaloriesKcal: 3_000 },
        nutritionAdjustmentPolicy: { type: "proportional-template" } },
      seed: 1,
    };
    expect(TargetSolverRequestSchema.safeParse({ ...base, scenarioTemplate: { mode: "recent-behavior" } }).success).toBe(false);
    expect(TargetSolverRequestSchema.safeParse({ ...base, scenarioTemplate: {
      ...scenario, schedule: { ...scenario.schedule, byDate: { "2026-09-01": { nutrition } } },
    } }).success).toBe(false);
  });
});
