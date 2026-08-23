import { describe, expect, it } from "vitest";
import { simulateDays, type CompleteSimulationDay, type PhysiologicalDailyInput } from "@/model/physiological-simulator";
import { calculateEpisodeHistory } from "@/modules/model-episodes/episode-calculation";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import type { BuiltSimulationDay, PersistedEpisode } from "@/modules/model-episodes/model-episode.types";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { persistedEpisodeFixture, sourceDay } from "./model-episode-fixtures";
import { observedNutritionProvenance } from "@/modules/model-episodes/nutrition-gap-bridge";

function modelDay(date: string, index: number, varied: boolean): PhysiologicalDailyInput {
  const distance = varied ? 1 + index * 0.08 : 5;
  const durationHours = varied ? Math.min(9, 1 + index * 0.05) : 4;
  return {
    date,
    caloriesKcal: 2_300,
    proteinG: 150,
    fatG: 70,
    carbsG: 200,
    outsideWorkWalkingDistanceKm: distance,
    averageWalkingSpeedKmh: 5,
    strengthTrainingMinutes: varied ? Math.min(120, index * 0.75) : 45,
    occupationalActivity: {
      category: null,
      durationHours: 0,
      intervals: [{ category: varied ? "manualModerate" : "standingLight", durationHours }],
    },
    sodiumChangeMgPerDay: null,
    measuredWeightKg: null,
  };
}

function complete(result: ReturnType<typeof simulateDays>[number]): CompleteSimulationDay {
  if (result.status !== "complete") throw new Error(`unexpected ${result.status}`);
  return result;
}

function builtHistory(input: {
  episode: PersistedEpisode;
  count: number;
  varied: boolean;
  personalOffsetKcalPerDay: number;
  activityCalibration: number;
}): BuiltSimulationDay[] {
  const rawDays = Array.from({ length: input.count }, (_, index) => (
    modelDay(addCalendarDays(input.episode.startDate, index), index, input.varied)
  ));
  const generated = simulateDays({
    initialState: input.episode.initialState,
    parameters: input.episode.simulatorParameters,
    days: rawDays,
    options: { ecfPolicy: input.episode.ecfPolicy },
    personalization: {
      personalOffsetKcalPerDay: input.personalOffsetKcalPerDay,
      activityCalibration: input.activityCalibration,
    },
  }).map(complete);
  return rawDays.map((day, index) => ({
    input: {
      ...day,
      occupationalActivity: {
        ...day.occupationalActivity,
        intervals: day.occupationalActivity.intervals?.map((interval) => ({ ...interval })),
      },
      measuredWeightKg: generated[index].calculations.endWeightKg
        + [0, 0.05, -0.04, 0.02][index % 4],
    },
    sourceQuality: {
      status: "complete",
      issues: [],
      workIntervalCount: 1,
      workWalkingDistanceKm: 2,
      outsideWorkWalkingDistanceKm: day.outsideWorkWalkingDistanceKm ?? null,
      nutrition: observedNutritionProvenance(),
    },
  }));
}

describe("two-pass episode calculation", () => {
  it("retains defaults for short history and is bit-for-bit deterministic", () => {
    const episode = persistedEpisodeFixture("2026-01-01");
    const days = builtHistory({
      episode, count: 14, varied: true,
      personalOffsetKcalPerDay: 0, activityCalibration: 1,
    });
    const before = structuredClone(days);
    const first = calculateEpisodeHistory({ episode, days });
    const second = calculateEpisodeHistory({ episode, days });
    expect(first).toEqual(second);
    expect(first.calibration.status).toBe("insufficient-history");
    expect(first.calibration.parameters).toEqual({
      personalOffsetKcalPerDay: 0, activityCalibration: 1,
    });
    expect(first.dailyStates).toHaveLength(14);
    expect(first.dailyStates.every(({ status }) => status === "complete")).toBe(true);
    expect(days).toEqual(before);
  });

  it("performs accepted offset-only calibration before the persisted pass", () => {
    const episode = persistedEpisodeFixture("2026-01-01");
    const result = calculateEpisodeHistory({
      episode,
      days: builtHistory({
        episode, count: 42, varied: true,
        personalOffsetKcalPerDay: 140, activityCalibration: 1,
      }),
    });
    expect(result.calibration.status).toBe("offset-only");
    expect(result.calibration.parameters.personalOffsetKcalPerDay).toBeCloseTo(140, -1);
    expect(result.dailyStates.at(-1)?.energyExpenditureKcal).toBeGreaterThan(0);
  });

  it("performs fully calibrated two-parameter application history", () => {
    const episode = persistedEpisodeFixture("2026-01-01");
    const result = calculateEpisodeHistory({
      episode,
      days: builtHistory({
        episode, count: 180, varied: true,
        personalOffsetKcalPerDay: 120, activityCalibration: 0.88,
      }),
    });
    expect(result.calibration.status).toBe("fully-calibrated");
    expect(Math.abs(result.calibration.parameters.personalOffsetKcalPerDay - 120))
      .toBeLessThan(25);
    expect(Math.abs(result.calibration.parameters.activityCalibration - 0.88))
      .toBeLessThan(0.03);
    expect(result.dailyStates.at(-1)).toMatchObject({
      status: "complete",
      date: addCalendarDays(episode.startDate, 179),
      modelVersion: "bodycast-physiology-v1",
    });
  });

  it("persists explicit incomplete and blocked states", () => {
    const episode = persistedEpisodeFixture("2026-01-01");
    const days = builtHistory({
      episode, count: 3, varied: false,
      personalOffsetKcalPerDay: 0, activityCalibration: 1,
    });
    days[1].input.caloriesKcal = null;
    days[1].sourceQuality = {
      ...days[1].sourceQuality,
      status: "missing-nutrition",
      issues: ["caloriesKcal"],
    };
    const result = calculateEpisodeHistory({ episode, days });
    expect(result.calibration.status).toBe("invalid-history");
    expect(result.dailyStates.map(({ status }) => status))
      .toEqual(["complete", "incomplete", "blocked"]);
    expect(result.dailyStates[1].missingFields).toContain("caloriesKcal");
    expect(result.dailyStates[2].missingFields[0]).toContain(days[1].input.date);
    expect(result.latestModeledDate).toBe(days[0].input.date);
  });

  it("recomputes later state when an earlier historical source value changes", () => {
    const episode = persistedEpisodeFixture("2026-01-01");
    const days = builtHistory({
      episode, count: 10, varied: false,
      personalOffsetKcalPerDay: 0, activityCalibration: 1,
    });
    const original = calculateEpisodeHistory({ episode, days });
    const changed = structuredClone(days);
    changed[0].input.caloriesKcal! += 500;
    const recalculated = calculateEpisodeHistory({ episode, days: changed });
    expect(recalculated.dailyStates.at(-1)?.endWeightKg)
      .not.toBe(original.dailyStates.at(-1)?.endWeightKg);
  });

  it("advances across an imputed gap but excludes the dependent suffix from calibration", () => {
    const episode = persistedEpisodeFixture("2026-01-01");
    const sources = Array.from({ length: 35 }, (_, index) => sourceDay(
      addCalendarDays(episode.startDate, index),
      index === 12
        ? { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
        : { weightKg: 80 + index * 0.01 },
    ));
    const days = buildSimulationDays({
      from: episode.startDate,
      to: addCalendarDays(episode.startDate, 34),
      sources: { days: sources, snapshots: [], workIntervals: [] },
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
    });
    const result = calculateEpisodeHistory({ episode, days });
    expect(result.dailyStates.every(({ status }) => status === "complete")).toBe(true);
    expect(result.dailyStates[12]).toMatchObject({
      dataQuality: "estimated",
      nutrition: { source: "imputed-local", dependency: "imputed-direct" },
    });
    expect(result.dailyStates[13]).toMatchObject({
      dataQuality: "estimated",
      nutrition: { source: "observed", dependency: "imputed-downstream" },
    });
    expect(result.calibrationNutritionDiagnostics).toMatchObject({
      imputedNutritionDays: 1,
      calibrationEligibleObservedDays: 12,
      calibrationExcludedDependentDays: 23,
      firstImputedNutritionDate: addCalendarDays(episode.startDate, 12),
    });
    expect(result.calibration.diagnostics.historyDays).toBe(12);
  });

  it("replaces an imputed trajectory when the real nutrition later arrives", () => {
    const episode = persistedEpisodeFixture("2026-01-01");
    const dates = Array.from({ length: 6 }, (_, index) => addCalendarDays(episode.startDate, index));
    const missingSources = dates.map((date, index) => sourceDay(date, index === 2 ? {
      caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
    } : {}));
    const build = (sources: typeof missingSources) => buildSimulationDays({
      from: dates[0], to: dates.at(-1)!,
      sources: { days: sources, snapshots: [], workIntervals: [] },
      baselineNutritionFallback: episode.baselineNutritionFallback,
    });
    const estimated = calculateEpisodeHistory({ episode, days: build(missingSources) });
    const observedSources = structuredClone(missingSources);
    observedSources[2] = sourceDay(dates[2], {
      caloriesKcal: 3_000, proteinG: 180, fatG: 100, carbsG: 330,
    });
    const observed = calculateEpisodeHistory({ episode, days: build(observedSources) });
    expect(estimated.dailyStates[2].nutrition.source).toBe("imputed-local");
    expect(observed.dailyStates[2].nutrition.source).toBe("observed");
    expect(observed.dailyStates.at(-1)?.endWeightKg)
      .not.toBe(estimated.dailyStates.at(-1)?.endWeightKg);
  });
});
