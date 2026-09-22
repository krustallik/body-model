import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runForecast } from "@/modules/model-forecast/forecast-engine";
import type { ForecastBehaviorDay, RunForecastInput } from "@/modules/model-forecast/forecast.types";
import { solveWeightTarget } from "@/modules/model-target-solver/target-solver";
import type { TargetSolverRequest } from "@/modules/model-target-solver/target-solver.types";
import { persistedEpisodeFixture } from "./model-episode-fixtures";

const episode = persistedEpisodeFixture("2026-08-22");
const day: ForecastBehaviorDay = {
  nutrition: { caloriesKcal: 2_200, proteinG: 170, fatG: 70, carbsG: 230 },
  outsideWorkWalkingDistanceKm: 7,
  averageWalkingSpeedKmh: 5,
  strengthTrainingMinutes: 0,
  occupation: [],
};

const unifiedRowsOff: readonly unknown[] = [];
const unifiedRowsOn = [{ profileId: 1, date: "2026-08-22", modelRevision: "unified-experimental-physiology-state-v1" }];

function forecastInput(overrides: Partial<RunForecastInput> = {}): RunForecastInput {
  return {
    seed: 90210,
    startDate: "2026-08-23",
    horizonDays: 7,
    modelVersion: episode.modelVersion,
    recoveryVersion: null,
    sourceFingerprint: "production-isolation-source",
    scenarioFingerprint: "production-isolation-scenario",
    initialStateQuality: "deterministic",
    initialParticles: [{ state: episode.initialState, weight: 1 }],
    parameters: episode.simulatorParameters,
    personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
    ecfPolicy: "hold-ecf",
    scenario: { mode: "fixed", schedule: { defaultDay: day } },
    reliableDonorDays: Array.from({ length: 21 }, () => day),
    variabilityEvidence: {
      donorDayCount: 21,
      source: "observed-history",
      nutritionLogStandardDeviation: 0.2,
      macroCompositionLogStandardDeviation: 0.1,
      walkingLogStandardDeviation: 0.3,
    },
    config: { pathCount: 16 },
    ...overrides,
  };
}

function productionForecast(unifiedRows: readonly unknown[]) {
  // Unified rows are deliberately not an input to production forecast. Keeping
  // the fixture in the call makes the ON/OFF comparison explicit in this test.
  void unifiedRows;
  return runForecast(forecastInput());
}

function targetRequest(): TargetSolverRequest {
  return {
    goal: { metric: "weightKg", targetValueKg: 79, goalDate: "2026-08-29" },
    control: {
      type: "daily-calorie-center",
      constraints: { minCaloriesKcal: 1_800, maxCaloriesKcal: 3_000 },
      nutritionAdjustmentPolicy: { type: "proportional-template" },
    },
    scenarioTemplate: { mode: "fixed", schedule: { defaultDay: day } },
    seed: 90210,
    solverConfig: {
      coarseGridPoints: 3,
      maxEvaluations: 6,
      searchPathCount: 8,
      finalPathCount: 16,
      monotonicityConfirmationPathCount: 32,
    },
  };
}

async function productionGoal(unifiedRows: readonly unknown[]) {
  void unifiedRows;
  return solveWeightTarget({
    request: targetRequest(),
    horizonDays: 7,
    evaluateForecast: async ({ scenario, pathCount, caloriesKcal }) => {
      const forecast = runForecast(forecastInput({
        config: { pathCount },
        scenario,
        seed: 90210 + caloriesKcal,
      }));
      const terminal = forecast.dates.at(-1)!.physiologicalBodyWeightKg.median;
      return {
        forecast,
        initialPhysiologicalBodyWeightKg: episode.initialState.fatMassKg + episode.initialState.leanTissueKg + episode.initialState.glycogenKg + episode.initialState.extracellularFluidDeviationLiters,
        terminalPhysiologicalBodyWeightSamplesKg: Array.from({ length: pathCount }, () => terminal),
      };
    },
  });
}

describe("UnifiedExperimentalPhysiologyStateV1 production isolation", () => {
  it("keeps production TDEE and forecast identical with Unified rows OFF versus ON", () => {
    const off = productionForecast(unifiedRowsOff);
    const on = productionForecast(unifiedRowsOn);
    expect(on).toEqual(off);
    expect(on.dates.map((entry) => entry.tdeeKcalPerDay)).toEqual(off.dates.map((entry) => entry.tdeeKcalPerDay));
  });

  it("keeps goal planner output identical with Unified rows OFF versus ON", async () => {
    const off = await productionGoal(unifiedRowsOff);
    const on = await productionGoal(unifiedRowsOn);
    expect(on).toEqual(off);
  });

  it("keeps production modules free of Unified-state imports", () => {
    const productionFiles = [
      "src/modules/model-forecast/forecast-engine.ts",
      "src/modules/model-target-solver/model-target-solver.service.ts",
      "src/modules/model-target-solver/target-solver.ts",
    ];
    for (const path of productionFiles) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/unified-experimental-physiology-state/);
    }
  });
});
