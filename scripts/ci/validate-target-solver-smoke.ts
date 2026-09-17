/**
 * CI smoke: target-solver tolerance boundary (mocked forecast evaluations).
 * Full suite (`validate:target-solver`) is multi-minute Monte Carlo; unit tests plus
 * this smoke cover the inclusive-tolerance contract without path sampling cost.
 *
 * Run: npm run validate:target-solver:smoke
 */
import type { ForecastResult } from "../../src/modules/model-forecast/forecast.types";
import { solveWeightTarget } from "../../src/modules/model-target-solver/target-solver";
import type {
  CandidateForecastEvaluation,
  TargetSolverRequest,
} from "../../src/modules/model-target-solver/target-solver.types";

const TOLERANCE_KG = 0.25; // binary-exact so median - target === tolerance in IEEE float
const TARGET_KG = 80;

function request(): TargetSolverRequest {
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
        outerQuantileRankStandardErrorProbability: 0.01, note: "ci-smoke",
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

async function main() {
  const inside = await solveWeightTarget({
    request: request(),
    horizonDays: 30,
    evaluateForecast: async ({ caloriesKcal, pathCount }) => {
      const terminalErrorKg = caloriesKcal === 2_000
        ? TOLERANCE_KG
        : Math.sign(caloriesKcal - 2_000) * (TOLERANCE_KG + 0.2)
          + (caloriesKcal - 2_000) / 5_000;
      return evaluation({ caloriesKcal, pathCount, terminalErrorKg });
    },
  });

  const ok = inside.status === "solved"
    && "searchDiagnostics" in inside
    && inside.searchDiagnostics.finalVerificationWithinTolerance === true
    && "feasibility" in inside
    && inside.feasibility.convergence === "within-tolerance";

  console.log(
    `${ok ? "PASS" : "FAIL"} target-solver-smoke — status=${inside.status}`
    + (`searchDiagnostics` in inside
      ? ` withinTolerance=${inside.searchDiagnostics.finalVerificationWithinTolerance}`
      : ""),
  );
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
