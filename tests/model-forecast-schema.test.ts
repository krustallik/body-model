import { describe, expect, it } from "vitest";
import { ForecastModelRequestSchema } from "@/modules/model-forecast/model-forecast.schema";

const day = {
  nutrition: { caloriesKcal: 2_200, proteinG: 170, fatG: 70, carbsG: 230 },
  outsideWorkWalkingDistanceKm: 0,
  averageWalkingSpeedKmh: 5,
  strengthTrainingMinutes: 0,
  occupation: [],
};

describe("forecast request schema", () => {
  it("distinguishes explicit zeros from missing required fixed inputs", () => {
    expect(ForecastModelRequestSchema.safeParse({
      horizonDays: 30, scenario: { mode: "fixed", schedule: { defaultDay: day } },
    }).success).toBe(true);
    const missing = { ...day } as Partial<typeof day>;
    delete missing.outsideWorkWalkingDistanceKm;
    expect(ForecastModelRequestSchema.safeParse({
      horizonDays: 30, scenario: { mode: "fixed", schedule: { defaultDay: missing } },
    }).success).toBe(false);
  });

  it("rejects invalid horizons, macros, occupations, unknown fields, and unordered quantiles", () => {
    expect(ForecastModelRequestSchema.safeParse({
      horizonDays: 0, scenario: { mode: "fixed", schedule: { defaultDay: day } },
    }).success).toBe(false);
    expect(ForecastModelRequestSchema.safeParse({
      horizonDays: 30,
      scenario: { mode: "fixed", schedule: { defaultDay: {
        ...day, nutrition: { ...day.nutrition, proteinG: -1 },
      } } },
    }).success).toBe(false);
    expect(ForecastModelRequestSchema.safeParse({
      horizonDays: 30,
      scenario: { mode: "fixed", schedule: { defaultDay: {
        ...day, occupation: [{ category: "invented", durationHours: 8 }],
      } } },
    }).success).toBe(false);
    expect(ForecastModelRequestSchema.safeParse({
      horizonDays: 30, scenario: { mode: "fixed", schedule: { defaultDay: day } }, surprise: true,
    }).success).toBe(false);
  });

  it("accepts recent-behavior and target-centered contracts", () => {
    expect(ForecastModelRequestSchema.safeParse({
      horizonDays: 90, scenario: { mode: "recent-behavior", blockLengthDays: 7 },
    }).success).toBe(true);
    expect(ForecastModelRequestSchema.safeParse({
      horizonDays: 90,
      scenario: {
        mode: "target-centered", schedule: { defaultDay: day },
        variability: { nutritionLogStandardDeviation: 0.2, strengthAdherenceProbability: 0.8 },
      },
    }).success).toBe(true);
  });

  it("validates long-horizon numerical-quality controls", () => {
    expect(ForecastModelRequestSchema.safeParse({
      horizonDays: 365,
      scenario: { mode: "fixed", schedule: { defaultDay: day } },
      config: { longHorizonThresholdDays: 180, longHorizonRecommendedPathCount: 1_024 },
    }).success).toBe(true);
    for (const config of [
      { longHorizonThresholdDays: 0 },
      { longHorizonThresholdDays: 30.5 },
      { longHorizonRecommendedPathCount: 0 },
      { longHorizonRecommendedPathCount: 100.5 },
    ]) expect(ForecastModelRequestSchema.safeParse({
      horizonDays: 365,
      scenario: { mode: "fixed", schedule: { defaultDay: day } },
      config,
    }).success).toBe(false);
  });
});
