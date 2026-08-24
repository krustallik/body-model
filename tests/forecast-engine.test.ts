import { describe, expect, it } from "vitest";
import { reconstructBodyWeightKg } from "@/model/body-composition/state";
import { simulateOneDay } from "@/model/physiological-simulator";
import {
  empiricalPredictiveSummary,
  runForecast,
  sampleForecastBehaviorPath,
  stratifiedResampleIndices,
} from "@/modules/model-forecast/forecast-engine";
import {
  type ForecastBehaviorDay,
  type ForecastScenario,
  type RunForecastInput,
} from "@/modules/model-forecast/forecast.types";
import { SeededRandom } from "@/modules/model-recovery/recovery-math";
import { persistedEpisodeFixture } from "./model-episode-fixtures";

const episode = persistedEpisodeFixture("2026-08-22");

const centralDay: ForecastBehaviorDay = {
  nutrition: { caloriesKcal: 2_200, proteinG: 170, fatG: 70, carbsG: 230 },
  outsideWorkWalkingDistanceKm: 7,
  averageWalkingSpeedKmh: 5,
  strengthTrainingMinutes: 0,
  occupation: [],
};

function scenario(mode: "fixed" | "target-centered" = "fixed"): ForecastScenario {
  return mode === "fixed"
    ? { mode, schedule: { defaultDay: centralDay } }
    : { mode, schedule: { defaultDay: centralDay } };
}

function forecastInput(overrides: Partial<RunForecastInput> = {}): RunForecastInput {
  return {
    seed: 1234,
    startDate: "2026-08-23",
    horizonDays: 30,
    modelVersion: episode.modelVersion,
    recoveryVersion: null,
    sourceFingerprint: "source",
    scenarioFingerprint: "scenario",
    initialStateQuality: "deterministic",
    initialParticles: [{ state: episode.initialState, weight: 1 }],
    parameters: episode.simulatorParameters,
    personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
    ecfPolicy: "hold-ecf",
    scenario: scenario(),
    reliableDonorDays: Array.from({ length: 21 }, () => centralDay),
    variabilityEvidence: {
      donorDayCount: 21,
      source: "observed-history",
      nutritionLogStandardDeviation: 0.2,
      macroCompositionLogStandardDeviation: 0.1,
      walkingLogStandardDeviation: 0.3,
    },
    config: { pathCount: 128 },
    ...overrides,
  };
}

describe("future forecast engine", () => {
  it("collapses exactly to deterministic physiology for one state and fixed inputs", () => {
    const result = runForecast(forecastInput());
    expect(result.status).toBe("ok");
    expect(result.diagnostics.uncertaintySources).toEqual({
      initialState: false, futureBehavior: false, measurement: false, modelParameters: false,
    });
    for (const day of result.dates) {
      expect(day.physiologicalBodyWeightKg.p05).toBe(day.physiologicalBodyWeightKg.p95);
      expect(day.fatMassKg.p25).toBe(day.fatMassKg.p75);
      expect(day.glycogenKg.p05).toBe(day.glycogenKg.median);
    }
    expect(result.dates.at(-1)!.adaptiveThermogenesisKcalPerDay.median)
      .not.toBe(episode.initialState.adaptiveThermogenesisKcalPerDay);
    expect(result.dates.at(-1)!.dynamicRmrKcalPerDay.median)
      .not.toBe(result.dates[0].dynamicRmrKcalPerDay.median);

    let state = episode.initialState;
    for (const [index, forecastDay] of result.dates.entries()) {
      const direct = simulateOneDay({
        state,
        parameters: episode.simulatorParameters,
        day: {
          date: forecastDay.date,
          ...centralDay.nutrition,
          outsideWorkWalkingDistanceKm: centralDay.outsideWorkWalkingDistanceKm,
          averageWalkingSpeedKmh: centralDay.averageWalkingSpeedKmh,
          strengthTrainingMinutes: centralDay.strengthTrainingMinutes,
          occupationalActivity: { category: null, durationHours: 0, intervals: [] },
          sodiumChangeMgPerDay: 0,
          measuredWeightKg: null,
        },
        options: { ecfPolicy: "hold-ecf" },
        personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
      });
      expect(direct.status).toBe("complete");
      if (direct.status !== "complete") throw new Error(`incomplete direct day ${index}`);
      expect(forecastDay.fatMassKg.median).toBe(direct.endState.fatMassKg);
      expect(forecastDay.leanTissueKg.median).toBe(direct.endState.leanTissueKg);
      expect(forecastDay.glycogenKg.median).toBe(direct.endState.glycogenKg);
      expect(forecastDay.extracellularFluidDeviationLiters.median)
        .toBe(direct.endState.extracellularFluidDeviationLiters);
      expect(forecastDay.adaptiveThermogenesisKcalPerDay.median)
        .toBe(direct.endState.adaptiveThermogenesisKcalPerDay);
      expect(forecastDay.physiologicalBodyWeightKg.median).toBe(direct.calculations.endWeightKg);
      expect(forecastDay.dynamicRmrKcalPerDay.median)
        .toBe(direct.calculations.expenditure.dynamicRmrKcalPerDay);
      expect(forecastDay.tdeeKcalPerDay.median)
        .toBe(direct.calculations.expenditure.personalizedTdeeKcalPerDay);
      state = direct.endState;
    }
  });

  it("propagates initial-state uncertainty without inventing future uncertainty", () => {
    const second = {
      ...episode.initialState,
      fatMassKg: episode.initialState.fatMassKg + 2,
      leanTissueKg: episode.initialState.leanTissueKg - 0.5,
      weightFilterState: { ...episode.initialState.weightFilterState },
    };
    reconstructBodyWeightKg(second);
    const result = runForecast(forecastInput({
      initialStateQuality: "recovered",
      recoveryVersion: "bodycast-recovery-v3",
      initialParticles: [
        { state: episode.initialState, weight: 0.8 },
        { state: second, weight: 0.2 },
      ],
      config: { pathCount: 512 },
    }));
    expect(result.diagnostics.startingParticleResampling).toBe("stratified");
    expect(result.diagnostics.uncertaintySources).toMatchObject({ initialState: true, futureBehavior: false });
    expect(result.dates[0].physiologicalBodyWeightKg.p95)
      .toBeGreaterThan(result.dates[0].physiologicalBodyWeightKg.p05);
  });

  it("propagates future-input uncertainty from one exact starting state", () => {
    const result = runForecast(forecastInput({ scenario: scenario("target-centered") }));
    expect(result.diagnostics.uncertaintySources).toMatchObject({ initialState: false, futureBehavior: true });
    expect(result.dates.at(-1)!.physiologicalBodyWeightKg.p95)
      .toBeGreaterThan(result.dates.at(-1)!.physiologicalBodyWeightKg.p05);
    expect(result.dates.at(-1)!.glycogenKg.p95).toBeGreaterThan(result.dates.at(-1)!.glycogenKg.p05);
  });

  it("combines both sources and retains degraded recovery provenance", () => {
    const second = { ...episode.initialState, fatMassKg: episode.initialState.fatMassKg + 1,
      weightFilterState: { ...episode.initialState.weightFilterState } };
    const result = runForecast(forecastInput({
      initialStateQuality: "degraded",
      initialParticles: [{ state: episode.initialState, weight: 0.5 }, { state: second, weight: 0.5 }],
      scenario: scenario("target-centered"),
    }));
    expect(result.status).toBe("degraded");
    expect(result.initialStateQuality).toBe("degraded");
    expect(result.diagnostics.uncertaintySources).toMatchObject({ initialState: true, futureBehavior: true });
  });

  it("is exactly reproducible for the same seed and changes paths for another seed", () => {
    const input = forecastInput({ scenario: scenario("target-centered") });
    expect(runForecast(input)).toEqual(runForecast(input));
    expect(runForecast({ ...input, seed: input.seed + 1 }).dates)
      .not.toEqual(runForecast(input).dates);
  });

  it("generally broadens stochastic weight uncertainty over longer horizons", () => {
    const short = runForecast(forecastInput({ horizonDays: 7, scenario: scenario("target-centered") }));
    const long = runForecast(forecastInput({ horizonDays: 90, scenario: scenario("target-centered") }));
    const shortWidth = short.dates.at(-1)!.physiologicalBodyWeightKg.p95
      - short.dates.at(-1)!.physiologicalBodyWeightKg.p05;
    const longWidth = long.dates.at(-1)!.physiologicalBodyWeightKg.p95
      - long.dates.at(-1)!.physiologicalBodyWeightKg.p05;
    expect(longWidth).toBeGreaterThan(shortWidth);
  });

  it("joint-block resamples recent behavior and rejects insufficient donors", () => {
    const recent: ForecastScenario = { mode: "recent-behavior", minimumDonorDays: 14, blockLengthDays: 7 };
    const result = runForecast(forecastInput({ scenario: recent }));
    expect(result.scenarioProvenance.nutrition).toBe("observed-joint-block-resampling");
    expect(() => runForecast(forecastInput({ scenario: recent, reliableDonorDays: centralDay ? [centralDay] : [] })))
      .toThrow(/at least 14 reliable observed donor days/);
  });

  it("preserves explicit zero strength and occupation and distinct work walking", () => {
    const workDay: ForecastBehaviorDay = {
      ...centralDay,
      outsideWorkWalkingDistanceKm: 3,
      occupation: [{
        category: "manualLight", durationHours: 8, breakDurationHours: 0.5,
        workWalkingDistanceKm: 4, averageWalkingSpeedKmh: 5,
      }],
    };
    const noWork = runForecast(forecastInput({ horizonDays: 1 }));
    const work = runForecast(forecastInput({
      horizonDays: 1,
      scenario: { mode: "fixed", schedule: { defaultDay: workDay } },
    }));
    expect(noWork.dates[0].netActivityKcalPerDay.median).toBeGreaterThan(0);
    expect(work.dates[0].netActivityKcalPerDay.median)
      .toBeGreaterThan(noWork.dates[0].netActivityKcalPerDay.median);
  });

  it("reports latent-weight and hold-ECF limitations without measurement noise", () => {
    const result = runForecast(forecastInput());
    expect(result.diagnostics.latentPhysiologicalWeightOnly).toBe(true);
    expect(result.diagnostics.ecfLimitation).toMatch(/Sodium-driven/);
    expect(result.diagnostics.uncertaintySources.measurement).toBe(false);
  });

  it("tracks invalid paths and degrades when too many fail without clamping", () => {
    const invalidState = {
      ...episode.initialState,
      fatMassKg: -1,
      weightFilterState: { ...episode.initialState.weightFilterState },
    };
    const result = runForecast(forecastInput({
      initialStateQuality: "recovered",
      initialParticles: [
        { state: episode.initialState, weight: 0.5 },
        { state: invalidState, weight: 0.5 },
      ],
      config: { pathCount: 32, minimumValidPathFraction: 0.9 },
    }));
    expect(result.status).toBe("degraded");
    expect(result.diagnostics).toMatchObject({
      generatedPathCount: 32, validPathCount: 16, invalidPathCount: 16,
    });
    expect(Object.keys(result.diagnostics.invalidPathReasons)[0]).toMatch(/fatMassKg/);
    expect(() => runForecast(forecastInput({
      initialParticles: [{ state: invalidState, weight: 1 }], config: { pathCount: 4 },
    }))).toThrow(/all forecast paths were invalid/);
  });

  it("flags limited numerical precision for long horizons without widening intervals", () => {
    const result = runForecast(forecastInput({
      horizonDays: 181,
      config: { pathCount: 128, longHorizonThresholdDays: 180, longHorizonRecommendedPathCount: 1_024 },
    }));
    expect(result.diagnostics.numericalQuality).toMatchObject({
      classification: "limited-long-horizon",
      pathCountAdequateForHorizon: false,
      recommendedMinimumPathCount: 1_024,
      uniqueStartingStateCount: 1,
    });
    expect(result.diagnostics.numericalQuality.note).toMatch(/not widened/);
  });

  it("validates direct-engine horizon, path count, quantiles, and quality controls", () => {
    expect(() => runForecast(forecastInput({ horizonDays: 0 }))).toThrow(/horizonDays/);
    expect(() => runForecast(forecastInput({ config: { pathCount: 0 } }))).toThrow(/pathCount/);
    expect(() => runForecast(forecastInput({
      config: { lowerProbability: 0.3, innerLowerProbability: 0.25 },
    }))).toThrow(/quantile/);
    expect(() => runForecast(forecastInput({ config: { minimumValidPathFraction: 0 } })))
      .toThrow(/minimumValidPathFraction/);
    expect(() => runForecast(forecastInput({ config: { longHorizonThresholdDays: 0 } })))
      .toThrow(/long-horizon/);
  });
});

describe("stratified posterior resampling", () => {
  it("is seeded, approximately faithful, and handles uniform/dominant weights", () => {
    const first = stratifiedResampleIndices([0.2, 0.8], 1_000, new SeededRandom(9));
    const second = stratifiedResampleIndices([0.2, 0.8], 1_000, new SeededRandom(9));
    expect(first).toEqual(second);
    expect(first.filter((index) => index === 0)).toHaveLength(200);
    expect(new Set(stratifiedResampleIndices([0.25, 0.25, 0.25, 0.25], 400, new SeededRandom(3))).size).toBe(4);
    expect(stratifiedResampleIndices([0.001, 0.999], 1_000, new SeededRandom(5))
      .filter((index) => index === 1).length).toBeGreaterThanOrEqual(998);
    expect(stratifiedResampleIndices([0, 0.4, 0, 0.6], 1_000, new SeededRandom(7)))
      .not.toContain(0);
    expect(stratifiedResampleIndices([0, 0.4, 0, 0.6], 1_000, new SeededRandom(7)))
      .not.toContain(2);
  });

  it("validates weights and count", () => {
    expect(() => stratifiedResampleIndices([], 10, new SeededRandom(1))).toThrow();
    expect(() => stratifiedResampleIndices([1], 0, new SeededRandom(1))).toThrow();
    expect(() => stratifiedResampleIndices([-1, 2], 10, new SeededRandom(1))).toThrow();
  });
});

describe("forecast empirical quantiles", () => {
  it("uses documented inverse-ECDF order statistics for odd and even path counts", () => {
    expect(empiricalPredictiveSummary(Array.from({ length: 20 }, (_, index) => index + 1)))
      .toEqual({ mean: 10.5, p05: 1, p25: 5, median: 10, p75: 15, p95: 19 });
    expect(empiricalPredictiveSummary(Array.from({ length: 21 }, (_, index) => index + 1)))
      .toEqual({ mean: 11, p05: 2, p25: 6, median: 11, p75: 16, p95: 20 });
  });

  it("handles repeated, expanded weighted, and deterministic representations monotonically", () => {
    const repeated = empiricalPredictiveSummary([1, 2, 2, 2]);
    expect(repeated).toEqual({ mean: 1.75, p05: 1, p25: 1, median: 2, p75: 2, p95: 2 });
    const deterministic = empiricalPredictiveSummary([7, 7, 7]);
    expect(deterministic).toEqual({ mean: 7, p05: 7, p25: 7, median: 7, p75: 7, p95: 7 });
    expect([repeated.p05, repeated.p25, repeated.median, repeated.p75, repeated.p95])
      .toEqual([...([repeated.p05, repeated.p25, repeated.median, repeated.p75, repeated.p95])]
        .sort((left, right) => left - right));
    expect(() => empiricalPredictiveSummary([])).toThrow(/at least one path/);
  });
});

describe("forecast scenario sampling", () => {
  it("keeps target-centered nutrition joint and centered across independent paths", () => {
    const random = new SeededRandom(44);
    const samples = Array.from({ length: 2_000 }, () => sampleForecastBehaviorPath({
      scenario: scenario("target-centered"),
      startDate: "2026-08-23",
      horizonDays: 1,
      reliableDonorDays: [],
      evidence: {
        donorDayCount: 20, source: "observed-history",
        nutritionLogStandardDeviation: 0.2,
        macroCompositionLogStandardDeviation: 0.1,
        walkingLogStandardDeviation: 0.3,
      },
      random,
    })[0]);
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(samples.map((day) => day.nutrition.caloriesKcal)))
      .toBeGreaterThan(centralDay.nutrition.caloriesKcal * 0.98);
    expect(mean(samples.map((day) => day.nutrition.caloriesKcal)))
      .toBeLessThan(centralDay.nutrition.caloriesKcal * 1.02);
    expect(mean(samples.map((day) => day.nutrition.proteinG)))
      .toBeGreaterThan(centralDay.nutrition.proteinG * 0.98);
    expect(mean(samples.map((day) => day.nutrition.proteinG)))
      .toBeLessThan(centralDay.nutrition.proteinG * 1.02);
    const calorieHigh = samples.filter((day) => day.nutrition.caloriesKcal > centralDay.nutrition.caloriesKcal);
    expect(mean(calorieHigh.map((day) => day.nutrition.carbsG)))
      .toBeGreaterThan(mean(samples.map((day) => day.nutrition.carbsG)));
    expect(samples.every((day) => Object.values(day.nutrition).every((value) => value > 0))).toBe(true);
  });

  it("preserves explicit zeros and honors strength/occupation adherence extremes", () => {
    const planned = {
      ...centralDay,
      outsideWorkWalkingDistanceKm: 0,
      strengthTrainingMinutes: 60,
      occupation: [{
        category: "manualLight" as const, durationHours: 8, breakDurationHours: 0.5,
        workWalkingDistanceKm: 3, averageWalkingSpeedKmh: 5,
      }],
    };
    const absent = sampleForecastBehaviorPath({
      scenario: {
        mode: "target-centered", schedule: { defaultDay: planned },
        variability: { strengthAdherenceProbability: 0, occupationAdherenceProbability: 0 },
      },
      startDate: "2026-08-23", horizonDays: 7, reliableDonorDays: [],
      evidence: forecastInput().variabilityEvidence, random: new SeededRandom(1),
    });
    expect(absent.every((day) => day.outsideWorkWalkingDistanceKm === 0
      && day.strengthTrainingMinutes === 0 && day.occupation.length === 0)).toBe(true);
    const adherent = sampleForecastBehaviorPath({
      scenario: {
        mode: "target-centered", schedule: { defaultDay: planned },
        variability: { strengthAdherenceProbability: 1, occupationAdherenceProbability: 1 },
      },
      startDate: "2026-08-23", horizonDays: 7, reliableDonorDays: [],
      evidence: forecastInput().variabilityEvidence, random: new SeededRandom(1),
    });
    expect(adherent.every((day) => day.strengthTrainingMinutes === 60
      && day.occupation.length === 1)).toBe(true);
  });

  it("resamples recent behavior in contiguous circular blocks", () => {
    const donors = Array.from({ length: 14 }, (_, index) => ({
      ...centralDay,
      nutrition: { ...centralDay.nutrition, caloriesKcal: 2_000 + index },
    }));
    const path = sampleForecastBehaviorPath({
      scenario: { mode: "recent-behavior", minimumDonorDays: 14, blockLengthDays: 7 },
      startDate: "2026-08-23", horizonDays: 14, reliableDonorDays: donors,
      evidence: forecastInput().variabilityEvidence, random: new SeededRandom(7),
    });
    for (const blockStart of [0, 7]) {
      for (let offset = 1; offset < 7; offset += 1) {
        const previous = path[blockStart + offset - 1].nutrition.caloriesKcal - 2_000;
        const current = path[blockStart + offset].nutrition.caloriesKcal - 2_000;
        expect(current).toBe((previous + 1) % 14);
      }
    }
  });
});
