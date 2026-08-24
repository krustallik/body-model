import { performance } from "node:perf_hooks";
import { runForecast, runForecastWithInternalArtifacts } from "@/modules/model-forecast/forecast-engine";
import { solveWeightTarget } from "@/modules/model-target-solver/target-solver";
import type { SolverScenarioTemplate, TargetSolverRequest } from "@/modules/model-target-solver/target-solver.types";
import { validationForecastInput } from "./lib/forecast-validation";

const reference = validationForecastInput({ seed: 160_000, horizonDays: 30, pathCount: 1 });
if (!("schedule" in reference.scenario)) throw new Error("benchmark requires an explicit schedule");
const template: SolverScenarioTemplate = {
  mode: "fixed",
  schedule: reference.scenario.schedule,
};
const hiddenCaloriesKcal = 2_250;
const referenceNutrition = template.schedule.defaultDay.nutrition;
const hiddenScenario: SolverScenarioTemplate = {
  ...template,
  schedule: { ...template.schedule, defaultDay: { ...template.schedule.defaultDay, nutrition: {
    caloriesKcal: hiddenCaloriesKcal,
    proteinG: referenceNutrition.proteinG * hiddenCaloriesKcal / referenceNutrition.caloriesKcal,
    fatG: referenceNutrition.fatG * hiddenCaloriesKcal / referenceNutrition.caloriesKcal,
    carbsG: referenceNutrition.carbsG * hiddenCaloriesKcal / referenceNutrition.caloriesKcal,
  } } },
};

async function main() {
const results = [];
for (const horizonDays of [30, 90, 180, 365]) {
  const seed = 160_000 + horizonDays;
  const forward = runForecast(validationForecastInput({ seed, horizonDays, pathCount: 512, scenario: hiddenScenario }));
  const targetValueKg = forward.dates.at(-1)!.physiologicalBodyWeightKg.median;
  const request: TargetSolverRequest = {
    goal: { metric: "weightKg", targetValueKg, goalDate: "2099-01-01" },
    control: { type: "daily-calorie-center", constraints: { minCaloriesKcal: 1_500, maxCaloriesKcal: 3_200 },
      nutritionAdjustmentPolicy: { type: "proportional-template" } },
    scenarioTemplate: template,
    seed,
  };
  const started = performance.now();
  const result = await solveWeightTarget({
    request,
    horizonDays,
    evaluateForecast: async ({ scenario, pathCount }) => {
      const artifacts = runForecastWithInternalArtifacts(
        validationForecastInput({ seed, horizonDays, pathCount, scenario }),
      );
      return { forecast: artifacts.result,
        initialPhysiologicalBodyWeightKg: artifacts.initialPhysiologicalBodyWeightKg,
        terminalPhysiologicalBodyWeightSamplesKg: artifacts.terminalPhysiologicalBodyWeightSamplesKg };
    },
  });
  const runtimeMs = performance.now() - started;
  results.push({
    horizonDays,
    runtimeMs,
    status: result.status,
    evaluations: "searchDiagnostics" in result ? result.searchDiagnostics.evaluations.length : 0,
    searchPathCount: "searchDiagnostics" in result ? result.searchDiagnostics.searchPathCount : null,
    finalPathCount: "searchDiagnostics" in result ? result.searchDiagnostics.finalPathCount : null,
    solvedCaloriesKcal: "control" in result ? result.control.solvedValueKcal : null,
    hiddenCaloriesKcal,
    endpointErrorKg: "terminal" in result ? result.terminal?.targetErrorKg : null,
    empiricalAttainmentProbability: "terminal" in result ? result.terminal?.attainment.probability : null,
    probabilityMonteCarloInterval95: "terminal" in result ? result.terminal?.attainment.monteCarloInterval : null,
    localSensitivityKgPer100Kcal: "robustness" in result ? result.robustness.sensitivityKgPer100Kcal : null,
    numericalQuality: "quality" in result ? result.quality.numericalQuality?.classification : null,
  });
}
console.log(JSON.stringify(results, null, 2));
}

void main();
