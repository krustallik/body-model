import { describe, expect, it } from "vitest";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";
import { solveWeightTarget } from "@/modules/model-target-solver/target-solver";
import type { CandidateForecastEvaluation, TargetSolverRequest } from "@/modules/model-target-solver/target-solver.types";

function request(overrides: Partial<TargetSolverRequest> = {}): TargetSolverRequest {
  return {
    goal: { metric: "weightKg", targetValueKg: 80, goalDate: "2026-10-01" },
    control: { type: "daily-calorie-center", constraints: { minCaloriesKcal: 1_600, maxCaloriesKcal: 2_400 },
      nutritionAdjustmentPolicy: { type: "proportional-template" } },
    scenarioTemplate: { mode: "fixed", schedule: { defaultDay: {
      nutrition: { caloriesKcal: 2_000, proteinG: 150, fatG: 70, carbsG: 200 },
      outsideWorkWalkingDistanceKm: 5, averageWalkingSpeedKmh: 5, strengthTrainingMinutes: 30, occupation: [],
    } } },
    seed: 11,
    solverConfig: { targetToleranceKg: 0.01, goalAttainmentToleranceKg: 0.5,
      candidateResolutionKcal: 10, robustnessDeltaKcal: 100, monotonicityToleranceKg: 0.001,
      coarseGridPoints: 5, maxEvaluations: 20, searchPathCount: 8, finalPathCount: 32 },
    ...overrides,
  };
}

function evaluation(input: { caloriesKcal: number; pathCount: number; finalBiasKg?: number;
  samples?: readonly number[]; initialWeightKg?: number }): CandidateForecastEvaluation {
  const median = 80 + (input.caloriesKcal - 2_000) / 1_000
    + (input.pathCount === 32 ? input.finalBiasKg ?? 0 : 0);
  const summary = { mean: median, p05: median - 2, p25: median - 1, median, p75: median + 1, p95: median + 2 };
  const forecast: ForecastResult = {
    status: "ok", forecastVersion: "bodycast-forecast-v1", modelVersion: "bodycast-physiology-v4",
    recoveryVersion: null, sourceFingerprint: "source", scenarioFingerprint: "scenario",
    initialStateQuality: "deterministic", horizonDays: 30,
    scenarioProvenance: { mode: "fixed", nutrition: "fixed", activity: "fixed-scheduled",
      donorEvidence: { donorDayCount: 0, source: "explicit-scenario", nutritionLogStandardDeviation: 0,
        macroCompositionLogStandardDeviation: 0, walkingLogStandardDeviation: 0 } },
    dates: [{ date: "2026-10-01", physiologicalBodyWeightKg: summary } as never],
    diagnostics: { seed: 11, generatedPathCount: input.pathCount, validPathCount: input.pathCount,
      invalidPathCount: 0, invalidPathReasons: {}, startingParticleCount: 1,
      startingParticleResampling: "none-single-state", uncertaintySources: { initialState: false,
        futureBehavior: false, measurement: false, modelParameters: false }, ecfPolicy: "hold-ecf",
      ecfLimitation: null, latentPhysiologicalWeightOnly: true, current: true,
      numericalQuality: { classification: "standard", pathCount: input.pathCount,
        recommendedMinimumPathCount: input.pathCount, pathCountAdequateForHorizon: true,
        uniqueStartingStateCount: 1, availableStartingStateCount: 1,
        outerQuantileRankStandardErrorProbability: 0.01, note: "test" } },
  };
  return { forecast, initialPhysiologicalBodyWeightKg: input.initialWeightKg ?? 85,
    terminalPhysiologicalBodyWeightSamplesKg: input.samples ?? Array.from({ length: input.pathCount }, () => median) };
}

describe("Phase 16B feasibility and empirical probability", () => {
  it("uses raw terminal samples rather than the five retained quantiles", async () => {
    const result = await solveWeightTarget({ request: request(), horizonDays: 30,
      evaluateForecast: async ({ caloriesKcal, pathCount }) => evaluation({ caloriesKcal, pathCount,
        samples: Array.from({ length: pathCount }, () => 79) }) });
    expect(result.status).toBe("solved");
    if (!("terminal" in result) || !result.terminal) throw new Error("expected terminal result");
    expect(result.terminal.median).toBe(80);
    expect(result.terminal.attainment).toMatchObject({ direction: "loss", probability: 1,
      successes: 32, sampleCount: 32 });
    expect(result.terminal.attainment.monteCarloInterval.lower).toBeLessThan(1);
  });

  it("lets final-quality verification downgrade acceptance", async () => {
    const base = request();
    const result = await solveWeightTarget({ request: { ...base, solverConfig: { ...base.solverConfig,
      candidateResolutionKcal: 100 } }, horizonDays: 30,
    evaluateForecast: async ({ caloriesKcal, pathCount }) => evaluation({ caloriesKcal, pathCount, finalBiasKg: 0.05 }) });
    expect(result.status).toBe("numerically-limited");
    if (!("feasibility" in result)) throw new Error("expected feasibility result");
    expect(result.feasibility).toMatchObject({ status: "numerically-limited", convergence: "outside-tolerance" });
  });

  it("returns CRN local sensitivity and compact response diagnostics", async () => {
    const result = await solveWeightTarget({ request: request(), horizonDays: 30,
      evaluateForecast: async ({ caloriesKcal, pathCount }) => evaluation({ caloriesKcal, pathCount }) });
    if (!("robustness" in result)) throw new Error("expected robustness result");
    expect(result.robustness).toMatchObject({ classification: "stable", commonRandomNumbers: true,
      resolutionDiagnostics: { configuredCandidateSpacingKcal: 10 } });
    expect(result.robustness.sensitivityKgPer100Kcal).toBeCloseTo(0.1, 10);
    expect(result.searchDiagnostics.evaluations.some((item) => item.stage === "robustness" && item.pathCount === 32)).toBe(true);
  });

  it("keeps boundary feasibility explicitly caller-constrained", async () => {
    const boundaryRequest = request({ goal: { metric: "weightKg", targetValueKg: 79.6, goalDate: "2026-10-01" } });
    const result = await solveWeightTarget({ request: boundaryRequest, horizonDays: 30,
      evaluateForecast: async ({ caloriesKcal, pathCount }) => evaluation({ caloriesKcal, pathCount }) });
    expect(result.status).toBe("solved-at-boundary");
    if (!("control" in result)) throw new Error("expected target result");
    expect(result.control).toMatchObject({ constraintBoundary: "min",
      boundaryReason: "target-statistic-reached-at-caller-bound" });
    expect(result.feasibility.status).toBe("feasible-at-boundary");
  });

  it("separates forecast failure from caller-constraint failure", async () => {
    const result = await solveWeightTarget({ request: request(), horizonDays: 30,
      evaluateForecast: async ({ caloriesKcal, pathCount }) => {
        const value = evaluation({ caloriesKcal, pathCount });
        return { ...value, forecast: { ...value.forecast, dates: [] } };
      } });
    expect(result.status).toBe("no-valid-candidate");
    if (!("feasibility" in result)) throw new Error("expected feasibility result");
    expect(result.feasibility).toMatchObject({ status: "forecast-unreliable", constraints: "satisfied" });
  });

  it("confirms an apparent cheap-path reversal as a Monte Carlo artifact", async () => {
    const base = request();
    const result = await solveWeightTarget({ request: { ...base, solverConfig: { ...base.solverConfig,
      monotonicityConfirmationPathCount: 64 } }, horizonDays: 30,
    evaluateForecast: async ({ caloriesKcal, pathCount }) => {
      const value = evaluation({ caloriesKcal, pathCount });
      if (pathCount !== 8 || caloriesKcal !== 2_200) return value;
      const median = 79.2;
      const summary = { mean: median, p05: median - 2, p25: median - 1, median, p75: median + 1, p95: median + 2 };
      return { ...value, forecast: { ...value.forecast, dates: [{ ...value.forecast.dates[0],
        physiologicalBodyWeightKg: summary }] }, terminalPhysiologicalBodyWeightSamplesKg: Array(8).fill(median) };
    } });
    expect(result.status).toBe("solved");
    if (!("searchDiagnostics" in result)) throw new Error("expected diagnostics");
    expect(result.searchDiagnostics).toMatchObject({ initialMonotonicity: "non-monotonic",
      monotonicity: "approximately-monotonic",
      monotonicityConfirmation: { status: "monte-carlo-artifact", pathCount: 64 } });
    expect(result.searchDiagnostics.evaluations.some((item) =>
      item.stage === "monotonicity-confirmation" && item.pathCount === 64)).toBe(true);
  });

  it("returns non-monotonic only when the higher-path response remains materially reversed", async () => {
    const base = request();
    const result = await solveWeightTarget({ request: { ...base, solverConfig: { ...base.solverConfig,
      monotonicityConfirmationPathCount: 64 } }, horizonDays: 30,
    evaluateForecast: async ({ caloriesKcal, pathCount }) => {
      const value = evaluation({ caloriesKcal, pathCount });
      const median = 79 + ((caloriesKcal - 2_000) / 200) ** 2;
      const summary = { mean: median, p05: median - 2, p25: median - 1, median, p75: median + 1, p95: median + 2 };
      return { ...value, forecast: { ...value.forecast, dates: [{ ...value.forecast.dates[0],
        physiologicalBodyWeightKg: summary }] }, terminalPhysiologicalBodyWeightSamplesKg: Array(pathCount).fill(median) };
    } });
    expect(result.status).toBe("non-monotonic");
    if (!("searchDiagnostics" in result)) throw new Error("expected diagnostics");
    expect(result.searchDiagnostics.monotonicityConfirmation.status).toBe("confirmed-non-monotonic");
    expect(result.feasibility.status).toBe("non-monotonic");
  });

  it("reports practical resolution inputs instead of claiming configured spacing alone", async () => {
    const result = await solveWeightTarget({ request: request(), horizonDays: 30,
      evaluateForecast: async ({ caloriesKcal, pathCount }) => evaluation({ caloriesKcal, pathCount,
        finalBiasKg: 0.02 }) });
    if (!("robustness" in result)) throw new Error("expected robustness");
    expect(result.robustness.meaningfulResolutionKcal).toBeGreaterThanOrEqual(10);
    expect(result.robustness.resolutionDiagnostics).toMatchObject({ configuredCandidateSpacingKcal: 10 });
    expect(result.robustness.resolutionDiagnostics.endpointToleranceEquivalentKcal).toBeCloseTo(10);
    expect(result.robustness.resolutionDiagnostics.searchToFinalMedianShiftKg).toBeCloseTo(0.02);
  });

  it("keeps near-zero and asymmetric response diagnostics local to the perturbation panel", async () => {
    const solveResponse = (terminalMedian: (caloriesKcal: number) => number) => solveWeightTarget({
      request: request(), horizonDays: 30,
      evaluateForecast: async ({ caloriesKcal, pathCount }) => {
        const value = evaluation({ caloriesKcal, pathCount });
        const median = terminalMedian(caloriesKcal);
        const summary = { mean: median, p05: median - 2, p25: median - 1, median, p75: median + 1, p95: median + 2 };
        return { ...value, forecast: { ...value.forecast, dates: [{ ...value.forecast.dates[0],
          physiologicalBodyWeightKg: summary }] }, terminalPhysiologicalBodyWeightSamplesKg: Array(pathCount).fill(median) };
      },
    });
    const nearZero = await solveResponse((caloriesKcal) => 80 + (caloriesKcal - 2_000) * 1e-8);
    const asymmetric = await solveResponse((caloriesKcal) => 80 + (caloriesKcal - 2_000)
      / (caloriesKcal < 2_000 ? 2_000 : 1_000));
    if (!("robustness" in nearZero) || !("robustness" in asymmetric)) throw new Error("expected robustness");
    expect(nearZero.robustness.sensitivityKgPer100Kcal).toBeCloseTo(0.000001, 9);
    expect(nearZero.robustness.meaningfulResolutionKcal).toBeGreaterThan(100_000);
    expect(asymmetric.robustness.sensitivityKgPer100Kcal).toBeCloseTo(0.075, 10);
  });
});
