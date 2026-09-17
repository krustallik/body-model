import { describe, expect, it } from "vitest";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";
import { boundedTargetSearch } from "@/modules/model-target-solver/target-solver-search";
import { solveWeightTarget } from "@/modules/model-target-solver/target-solver";
import type {
  CandidateForecastEvaluation,
  SolverCandidateEvaluation,
  TargetSolverRequest,
} from "@/modules/model-target-solver/target-solver.types";

/**
 * Binary-exact tolerance so median - target === tolerance in IEEE float.
 * 0.05 is NOT exact: (80 + 0.05) - 80 === 0.049999... which wrongly stays
 * "inside" under a mutated `<` comparison.
 */
const TOLERANCE_KG = 0.25;
const TARGET_KG = 80;
const EXACT_ON_TOLERANCE_MEDIAN = TARGET_KG + TOLERANCE_KG;
const EPSILON_KG = 0.03125; // 1/32, also binary-exact and >> ulp

function candidate(caloriesKcal: number, objectiveKg: number): SolverCandidateEvaluation {
  const terminal = {
    mean: TARGET_KG + objectiveKg,
    p05: TARGET_KG + objectiveKg,
    p25: TARGET_KG + objectiveKg,
    median: TARGET_KG + objectiveKg,
    p75: TARGET_KG + objectiveKg,
    p95: TARGET_KG + objectiveKg,
  };
  return {
    caloriesKcal, objectiveKg, terminal,
    nutrition: { caloriesKcal, proteinG: 1, fatG: 1, carbsG: 1 },
    forecast: {} as never, pathCount: 1, stage: "search",
  };
}

function request(overrides: Partial<TargetSolverRequest> = {}): TargetSolverRequest {
  return {
    goal: { metric: "weightKg", targetValueKg: TARGET_KG, goalDate: "2026-10-01" },
    control: {
      type: "daily-calorie-center",
      constraints: { minCaloriesKcal: 1_600, maxCaloriesKcal: 2_400 },
      nutritionAdjustmentPolicy: { type: "proportional-template" },
    },
    scenarioTemplate: {
      mode: "fixed",
      schedule: {
        defaultDay: {
          nutrition: { caloriesKcal: 2_000, proteinG: 150, fatG: 70, carbsG: 200 },
          outsideWorkWalkingDistanceKm: 5,
          averageWalkingSpeedKmh: 5,
          strengthTrainingMinutes: 30,
          occupation: [],
        },
      },
    },
    seed: 11,
    solverConfig: {
      targetToleranceKg: TOLERANCE_KG,
      goalAttainmentToleranceKg: 0.5,
      candidateResolutionKcal: 50,
      robustnessDeltaKcal: 100,
      monotonicityToleranceKg: 0.001,
      coarseGridPoints: 5,
      maxEvaluations: 24,
      searchPathCount: 4,
      finalPathCount: 8,
    },
    ...overrides,
  };
}

function evaluation(input: {
  caloriesKcal: number;
  pathCount: number;
  terminalErrorKg: number;
}): CandidateForecastEvaluation {
  const median = TARGET_KG + input.terminalErrorKg;
  const summary = {
    mean: median, p05: median - 1, p25: median - 0.5, median,
    p75: median + 0.5, p95: median + 1,
  };
  const forecast: ForecastResult = {
    status: "ok",
    forecastVersion: "bodycast-forecast-v1",
    modelVersion: "bodycast-physiology-v6",
    recoveryVersion: null,
    sourceFingerprint: "source",
    scenarioFingerprint: "scenario",
    initialStateQuality: "deterministic",
    horizonDays: 30,
    scenarioProvenance: {
      mode: "fixed", nutrition: "fixed", activity: "fixed-scheduled",
      donorEvidence: {
        donorDayCount: 0, source: "explicit-scenario",
        nutritionLogStandardDeviation: 0, macroCompositionLogStandardDeviation: 0,
        walkingLogStandardDeviation: 0,
      },
    },
    dates: [{ date: "2026-10-01", physiologicalBodyWeightKg: summary } as never],
    diagnostics: {
      seed: 11, generatedPathCount: input.pathCount, validPathCount: input.pathCount,
      invalidPathCount: 0, invalidPathReasons: {}, startingParticleCount: 1,
      startingParticleResampling: "none-single-state",
      uncertaintySources: {
        initialState: false, futureBehavior: false, measurement: false, modelParameters: false,
      },
      ecfPolicy: "hold-ecf", ecfLimitation: null, latentPhysiologicalWeightOnly: true, current: true,
      numericalQuality: {
        classification: "standard", pathCount: input.pathCount,
        recommendedMinimumPathCount: input.pathCount, pathCountAdequateForHorizon: true,
        uniqueStartingStateCount: 1, availableStartingStateCount: 1,
        outerQuantileRankStandardErrorProbability: 0.01, note: "boundary-test",
      },
    },
  };
  return {
    forecast,
    initialPhysiologicalBodyWeightKg: 85,
    terminalPhysiologicalBodyWeightSamplesKg: Array.from(
      { length: input.pathCount },
      () => median,
    ),
  };
}

describe("target solver exact tolerance boundary", () => {
  it("uses a binary-exact on-tolerance residual (mutation guard)", () => {
    expect(EXACT_ON_TOLERANCE_MEDIAN - TARGET_KG).toBe(TOLERANCE_KG);
    expect(Math.abs(EXACT_ON_TOLERANCE_MEDIAN - TARGET_KG) === TOLERANCE_KG).toBe(true);
  });

  it("treats abs(error) === tolerance as within tolerance for search early-stop", async () => {
    const evaluations: number[] = [];
    const result = await boundedTargetSearch({
      minCaloriesKcal: 1_000,
      maxCaloriesKcal: 3_000,
      config: {
        targetToleranceKg: TOLERANCE_KG,
        candidateResolutionKcal: 1,
        monotonicityToleranceKg: 0.02,
        coarseGridPoints: 5,
        maxEvaluations: 30,
      },
      evaluate: async (caloriesKcal) => {
        evaluations.push(caloriesKcal);
        if (caloriesKcal === 2_000) return candidate(caloriesKcal, TOLERANCE_KG);
        return candidate(caloriesKcal, (caloriesKcal - 2_000) / 1_000);
      },
    });

    expect(result.status).toBe("candidate-found");
    expect(result.best?.caloriesKcal).toBe(2_000);
    expect(Math.abs(result.best!.objectiveKg)).toBe(TOLERANCE_KG);
    expect(evaluations).toContain(2_000);
  });

  it("classifies exact tolerance final verification as within-tolerance / solved", async () => {
    const result = await solveWeightTarget({
      request: request(),
      horizonDays: 30,
      evaluateForecast: async ({ caloriesKcal, pathCount }) => {
        const terminalErrorKg = caloriesKcal === 2_000
          ? TOLERANCE_KG
          : Math.sign(caloriesKcal - 2_000) * (TOLERANCE_KG + 0.5)
            + (caloriesKcal - 2_000) / 5_000;
        return evaluation({ caloriesKcal, pathCount, terminalErrorKg });
      },
    });

    expect(result.status).toBe("solved");
    if (!("searchDiagnostics" in result) || !("feasibility" in result) || !("terminal" in result)) {
      throw new Error("expected full solver result");
    }
    expect(result.terminal!.targetErrorKg).toBe(TOLERANCE_KG);
    expect(result.searchDiagnostics.finalVerificationWithinTolerance).toBe(true);
    expect(result.feasibility.convergence).toBe("within-tolerance");
  });

  it("classifies just-inside tolerance as solved and just-outside as numerically-limited", async () => {
    const inside = await solveWeightTarget({
      request: request(),
      horizonDays: 30,
      evaluateForecast: async ({ caloriesKcal, pathCount }) => {
        const terminalErrorKg = caloriesKcal === 2_000
          ? TOLERANCE_KG - EPSILON_KG
          : Math.sign(caloriesKcal - 2_000) * (TOLERANCE_KG + 0.5)
            + (caloriesKcal - 2_000) / 5_000;
        return evaluation({ caloriesKcal, pathCount, terminalErrorKg });
      },
    });
    expect(inside.status).toBe("solved");
    if ("searchDiagnostics" in inside) {
      expect(inside.searchDiagnostics.finalVerificationWithinTolerance).toBe(true);
    }

    const outside = await solveWeightTarget({
      request: request(),
      horizonDays: 30,
      evaluateForecast: async ({ caloriesKcal, pathCount }) => {
        const terminalErrorKg = caloriesKcal === 2_000
          ? TOLERANCE_KG + EPSILON_KG
          : Math.sign(caloriesKcal - 2_000) * (TOLERANCE_KG + 0.5)
            + (caloriesKcal - 2_000) / 5_000;
        return evaluation({ caloriesKcal, pathCount, terminalErrorKg });
      },
    });
    expect(outside.status).toBe("numerically-limited");
    if ("searchDiagnostics" in outside && "feasibility" in outside) {
      expect(outside.searchDiagnostics.finalVerificationWithinTolerance).toBe(false);
      expect(outside.feasibility.convergence).toBe("outside-tolerance");
    }
  });
});
