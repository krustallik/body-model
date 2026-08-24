import { describe, expect, it } from "vitest";
import { runForecastWithInternalArtifacts, sampleForecastBehaviorPath } from "@/modules/model-forecast/forecast-engine";
import type {
  ForecastBehaviorDay,
  ForecastResult,
} from "@/modules/model-forecast/forecast.types";
import { SeededRandom } from "@/modules/model-recovery/recovery-math";
import { solveWeightTarget } from "@/modules/model-target-solver/target-solver";
import type { SolverScenarioTemplate, TargetSolverRequest } from "@/modules/model-target-solver/target-solver.types";
import { persistedEpisodeFixture } from "./model-episode-fixtures";

const episode = persistedEpisodeFixture("2026-08-22");
const referenceDay: ForecastBehaviorDay = {
  nutrition: { caloriesKcal: 2_400, proteinG: 180, fatG: 80, carbsG: 250 },
  outsideWorkWalkingDistanceKm: 6,
  averageWalkingSpeedKmh: 5,
  strengthTrainingMinutes: 30,
  occupation: [],
};

function forecastArtifacts(scenario: SolverScenarioTemplate, horizonDays: number, seed: number, pathCount: number) {
  return runForecastWithInternalArtifacts({
    seed,
    startDate: "2026-08-23",
    horizonDays,
    modelVersion: episode.modelVersion,
    recoveryVersion: null,
    sourceFingerprint: "synthetic-source",
    scenarioFingerprint: JSON.stringify(scenario),
    initialStateQuality: "deterministic",
    initialParticles: [{ state: episode.initialState, weight: 1 }],
    parameters: episode.simulatorParameters,
    personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
    ecfPolicy: "hold-ecf",
    scenario,
    reliableDonorDays: Array.from({ length: 21 }, () => referenceDay),
    variabilityEvidence: {
      donorDayCount: 21,
      source: "explicit-scenario",
      nutritionLogStandardDeviation: 0.15,
      macroCompositionLogStandardDeviation: 0.08,
      walkingLogStandardDeviation: 0.2,
    },
    config: { pathCount, longHorizonRecommendedPathCount: pathCount },
  });
}

function forecast(scenario: SolverScenarioTemplate, horizonDays: number, seed: number, pathCount: number): ForecastResult {
  return forecastArtifacts(scenario, horizonDays, seed, pathCount).result;
}

function evaluation(scenario: SolverScenarioTemplate, horizonDays: number, seed: number, pathCount: number) {
  const artifacts = forecastArtifacts(scenario, horizonDays, seed, pathCount);
  return {
    forecast: artifacts.result,
    initialPhysiologicalBodyWeightKg: artifacts.initialPhysiologicalBodyWeightKg,
    terminalPhysiologicalBodyWeightSamplesKg: artifacts.terminalPhysiologicalBodyWeightSamplesKg,
  };
}

function request(overrides: Partial<TargetSolverRequest> = {}): TargetSolverRequest {
  return {
    goal: { metric: "weightKg", targetValueKg: 80, goalDate: "2026-11-21" },
    control: {
      type: "daily-calorie-center",
      constraints: { minCaloriesKcal: 1_600, maxCaloriesKcal: 3_200 },
      nutritionAdjustmentPolicy: { type: "proportional-template" },
    },
    scenarioTemplate: { mode: "fixed", schedule: { defaultDay: referenceDay } },
    seed: 91,
    solverConfig: {
      targetToleranceKg: 0.03,
      candidateResolutionKcal: 5,
      monotonicityToleranceKg: 0.001,
      coarseGridPoints: 5,
      maxEvaluations: 24,
      searchPathCount: 1,
      finalPathCount: 1,
    },
    ...overrides,
  };
}

describe("target solver core with the Phase 14B forward model", () => {
  it("recovers a hidden deterministic calorie plan in forward-inverse-forward validation", async () => {
    const horizonDays = 90;
    const hiddenCalories = 2_275;
    const hiddenScenario = { mode: "fixed" as const, schedule: { defaultDay: {
      ...referenceDay,
      nutrition: {
        caloriesKcal: hiddenCalories,
        proteinG: referenceDay.nutrition.proteinG * hiddenCalories / referenceDay.nutrition.caloriesKcal,
        fatG: referenceDay.nutrition.fatG * hiddenCalories / referenceDay.nutrition.caloriesKcal,
        carbsG: referenceDay.nutrition.carbsG * hiddenCalories / referenceDay.nutrition.caloriesKcal,
      },
    } } };
    const target = forecast(hiddenScenario, horizonDays, 91, 1).dates.at(-1)!.physiologicalBodyWeightKg.median;
    const result = await solveWeightTarget({
      request: request({ goal: { metric: "weightKg", targetValueKg: target, goalDate: "2026-11-21" } }),
      horizonDays,
      evaluateForecast: async ({ scenario, pathCount }) => evaluation(scenario, horizonDays, 91, pathCount),
    });
    expect(result.status).toBe("solved");
    if (!("terminal" in result) || !result.terminal) throw new Error("expected solved result");
    expect(Math.abs(result.control.solvedValueKcal! - hiddenCalories)).toBeLessThanOrEqual(10);
    expect(Math.abs(result.terminal.targetErrorKg)).toBeLessThanOrEqual(0.03);
    expect(result.forecast).toEqual(forecast(result.scenario!, horizonDays, 91, 1));
    expect(result.forecast!.dates.at(-1)!.dynamicRmrKcalPerDay.median)
      .not.toBe(result.forecast!.dates[0].dynamicRmrKcalPerDay.median);
    expect(result.forecast!.dates.at(-1)!.adaptiveThermogenesisKcalPerDay.median)
      .not.toBe(episode.initialState.adaptiveThermogenesisKcalPerDay);
    expect(result.forecast!.dates.at(-1)!.fatMassKg.median)
      .not.toBe(episode.initialState.fatMassKg);
    expect(result.forecast!.dates.at(-1)!.glycogenKg.median)
      .not.toBe(episode.initialState.glycogenKg);
  });

  it.each([
    [30, 2_100, 301],
    [90, 2_400, 902],
    [180, 2_700, 1_803],
  ])("forward-predicts a stochastic inverse target over %i days", async (horizonDays, hiddenCalories, seed) => {
    const scale = hiddenCalories / referenceDay.nutrition.caloriesKcal;
    const hiddenScenario: SolverScenarioTemplate = {
      mode: "target-centered",
      schedule: { defaultDay: { ...referenceDay, nutrition: {
        caloriesKcal: hiddenCalories,
        proteinG: referenceDay.nutrition.proteinG * scale,
        fatG: referenceDay.nutrition.fatG * scale,
        carbsG: referenceDay.nutrition.carbsG * scale,
      } } },
      variability: { nutritionLogStandardDeviation: 0.15, macroCompositionLogStandardDeviation: 0.08,
        walkingLogStandardDeviation: 0.2, strengthAdherenceProbability: 0.8, occupationAdherenceProbability: 0.9 },
    };
    const target = forecast(hiddenScenario, horizonDays, seed, 128).dates.at(-1)!.physiologicalBodyWeightKg.median;
    const base = request({
      goal: { metric: "weightKg", targetValueKg: target, goalDate: "2027-12-31" },
      scenarioTemplate: { ...hiddenScenario, schedule: { ...hiddenScenario.schedule,
        defaultDay: { ...hiddenScenario.schedule.defaultDay, nutrition: referenceDay.nutrition } } },
      seed,
    });
    const result = await solveWeightTarget({
      request: { ...base, solverConfig: { ...base.solverConfig, targetToleranceKg: 0.1,
        candidateResolutionKcal: 20, searchPathCount: 32, finalPathCount: 128 } },
      horizonDays,
      evaluateForecast: async ({ scenario, pathCount }) => evaluation(scenario, horizonDays, seed, pathCount),
    });
    expect(result.status).toMatch(/solved/);
    if (!("terminal" in result) || !result.terminal) throw new Error("expected stochastic solution");
    expect(Math.abs(result.control.solvedValueKcal! - hiddenCalories)).toBeLessThanOrEqual(100);
    expect(Math.abs(result.terminal.targetErrorKg)).toBeLessThanOrEqual(0.2);
    expect(result.terminal.targetAttainmentProbability).toBeGreaterThanOrEqual(0);
    expect(result.terminal.targetAttainmentProbability).toBeLessThanOrEqual(1);
  }, 15_000);

  it("returns not-bracketed for a target outside caller bounds", async () => {
    const result = await solveWeightTarget({
      request: request({ goal: { metric: "weightKg", targetValueKg: 50, goalDate: "2026-09-01" } }),
      horizonDays: 10,
      evaluateForecast: async ({ scenario, pathCount }) => evaluation(scenario, 10, 91, pathCount),
    });
    expect(result.status).toBe("not-bracketed");
    expect("control" in result && result.control.solvedValueKcal).toBe(1_600);
  });

  it("returns a boundary diagnostic for an exact bound target", async () => {
    const horizonDays = 30;
    const atMinimum = forecast({ mode: "fixed", schedule: { defaultDay: {
      ...referenceDay, nutrition: { caloriesKcal: 1_600, proteinG: 120, fatG: 160 / 3, carbsG: 500 / 3 },
    } } }, horizonDays, 91, 1).dates.at(-1)!.physiologicalBodyWeightKg.median;
    const result = await solveWeightTarget({
      request: request({ goal: { metric: "weightKg", targetValueKg: atMinimum, goalDate: "2026-09-21" } }),
      horizonDays,
      evaluateForecast: async ({ scenario, pathCount }) => evaluation(scenario, horizonDays, 91, pathCount),
    });
    expect(result.status).toBe("solved-at-boundary");
    expect("control" in result && result.control.constraintBoundary).toBe("min");
  });

  it.each([
    ["initial-state-unavailable", "awaiting"],
    ["initial-state-unreliable", "degenerate"],
  ] as const)("propagates %s without a fallback state", async (status, initialStateQuality) => {
    const result = await solveWeightTarget({ request: request(), horizonDays: 30,
      evaluateForecast: async () => ({
        status, initialStateQuality, reason: "blocked", modelVersion: episode.modelVersion,
        forecastVersion: "bodycast-forecast-v1", recoveryVersion: "bodycast-recovery-v3",
      }) });
    expect(result).toMatchObject({ status, initialStateQuality, reason: "blocked" });
  });

  it("rejects macro-invalid candidates rather than clamping them", async () => {
    const base = request();
    const result = await solveWeightTarget({
      request: { ...base, control: { ...base.control, constraints: {
        minCaloriesKcal: 1_600, maxCaloriesKcal: 3_200, minProteinG: 300,
      } } },
      horizonDays: 30,
      evaluateForecast: async ({ scenario, pathCount }) => evaluation(scenario, 30, 91, pathCount),
    });
    expect(result.status).toBe("no-valid-candidate");
    expect("searchDiagnostics" in result && result.searchDiagnostics.rejectedCandidates.length).toBe(5);
  });

  it("aligns stochastic behavior path-for-path under common random numbers", () => {
    const target = (caloriesKcal: number): SolverScenarioTemplate => ({
      mode: "target-centered",
      schedule: { defaultDay: { ...referenceDay, nutrition: { ...referenceDay.nutrition, caloriesKcal } } },
      variability: { nutritionLogStandardDeviation: 0.2, macroCompositionLogStandardDeviation: 0.1,
        walkingLogStandardDeviation: 0.2, strengthAdherenceProbability: 0.7, occupationAdherenceProbability: 0.8 },
    });
    const sample = (scenario: SolverScenarioTemplate) => sampleForecastBehaviorPath({
      scenario, startDate: "2026-08-23", horizonDays: 30, reliableDonorDays: [],
      evidence: { donorDayCount: 0, source: "explicit-scenario", nutritionLogStandardDeviation: 0.2,
        macroCompositionLogStandardDeviation: 0.1, walkingLogStandardDeviation: 0.2 },
      random: new SeededRandom(123),
    });
    const lower = sample(target(2_000));
    const higher = sample(target(2_100));
    expect(lower.map((day) => day.strengthTrainingMinutes)).toEqual(higher.map((day) => day.strengthTrainingMinutes));
    expect(lower.map((day) => day.outsideWorkWalkingDistanceKm)).toEqual(higher.map((day) => day.outsideWorkWalkingDistanceKm));
    for (const [index, day] of higher.entries()) {
      expect(day.nutrition.caloriesKcal / lower[index].nutrition.caloriesKcal).toBeCloseTo(1.05, 12);
    }
  });
});
