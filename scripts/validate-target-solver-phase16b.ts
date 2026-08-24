import { runForecastWithInternalArtifacts } from "@/modules/model-forecast/forecast-engine";
import type { RunForecastInput } from "@/modules/model-forecast/forecast.types";
import { empiricalTargetAttainment, wilsonScoreInterval } from "@/modules/model-target-solver/target-probability";
import { solveWeightTarget } from "@/modules/model-target-solver/target-solver";
import type { SolverScenarioTemplate, TargetSolverRequest } from "@/modules/model-target-solver/target-solver.types";
import { VALIDATION_DAY, calibrationSeed, validationForecastInput } from "./lib/forecast-validation";

function scenario(caloriesKcal: number, day = VALIDATION_DAY): SolverScenarioTemplate {
  const scale = caloriesKcal / day.nutrition.caloriesKcal;
  return { mode: "target-centered", schedule: { defaultDay: { ...day, nutrition: {
    caloriesKcal, proteinG: day.nutrition.proteinG * scale, fatG: day.nutrition.fatG * scale,
    carbsG: day.nutrition.carbsG * scale,
  } } }, variability: { nutritionLogStandardDeviation: 0.2, macroCompositionLogStandardDeviation: 0.1,
    walkingLogStandardDeviation: 0.3, strengthAdherenceProbability: 0.8, occupationAdherenceProbability: 0.9 } };
}

function artifacts(input: RunForecastInput) {
  const value = runForecastWithInternalArtifacts(input);
  return { forecast: value.result, initialPhysiologicalBodyWeightKg: value.initialPhysiologicalBodyWeightKg,
    terminalPhysiologicalBodyWeightSamplesKg: value.terminalPhysiologicalBodyWeightSamplesKg };
}

async function solve(input: { horizonDays: number; targetValueKg: number; seed: number;
  searchPathCount: number; finalPathCount: number; template?: SolverScenarioTemplate;
  prepare?: (value: RunForecastInput) => RunForecastInput }) {
  const template = input.template ?? scenario(2_400);
  const request: TargetSolverRequest = {
    goal: { metric: "weightKg", targetValueKg: input.targetValueKg, goalDate: "2099-01-01" },
    control: { type: "daily-calorie-center", constraints: { minCaloriesKcal: 1_500, maxCaloriesKcal: 3_300 },
      nutritionAdjustmentPolicy: { type: "proportional-template" } },
    scenarioTemplate: template, seed: input.seed,
    solverConfig: { searchPathCount: input.searchPathCount, finalPathCount: input.finalPathCount,
      targetToleranceKg: 0.1, goalAttainmentToleranceKg: 0.5, candidateResolutionKcal: 20,
      robustnessDeltaKcal: 100, monotonicityToleranceKg: 0.03, coarseGridPoints: 5, maxEvaluations: 24 },
  };
  const started = performance.now();
  const result = await solveWeightTarget({ request, horizonDays: input.horizonDays,
    evaluateForecast: async ({ scenario: candidate, pathCount }) => {
      const base = validationForecastInput({ seed: input.seed, horizonDays: input.horizonDays,
        pathCount, scenario: candidate });
      return artifacts(input.prepare ? input.prepare(base) : base);
    } });
  return { result, runtimeMs: performance.now() - started };
}

async function main() {
  const horizonDays = 90;
  const hiddenCaloriesKcal = 2_250;
  const truth = artifacts(validationForecastInput({ seed: 160_090, horizonDays, pathCount: 2_048,
    scenario: scenario(hiddenCaloriesKcal) }));
  const targetValueKg = truth.forecast.dates.at(-1)!.physiologicalBodyWeightKg.median;
  const seedStability = [];
  for (const seed of [160_091, 160_092, 160_093]) {
    const value = await solve({ horizonDays, targetValueKg, seed, searchPathCount: 128, finalPathCount: 512 });
    seedStability.push(compact(value));
  }
  const pathSensitivity = [];
  for (const [searchPathCount, finalPathCount] of [[64, 256], [128, 512], [256, 1_024]] as const) {
    const value = await solve({ horizonDays, targetValueKg, seed: 160_090, searchPathCount, finalPathCount });
    pathSensitivity.push({ searchPathCount, finalPathCount, ...compact(value) });
  }
  const highCompute = compact(await solve({ horizonDays, targetValueKg, seed: 160_090,
    searchPathCount: 512, finalPathCount: 2_048 }));

  const horizonCurve = [30, 60, 90, 180, 365].map((horizon) => {
    const lower = artifacts(validationForecastInput({ seed: 170_000 + horizon, horizonDays: horizon,
      pathCount: 256, scenario: scenario(1_500) })).forecast.dates.at(-1)!.physiologicalBodyWeightKg.median;
    const upper = artifacts(validationForecastInput({ seed: 170_000 + horizon, horizonDays: horizon,
      pathCount: 256, scenario: scenario(3_300) })).forecast.dates.at(-1)!.physiologicalBodyWeightKg.median;
    return { horizonDays: horizon, lowerBoundMedianKg: lower, upperBoundMedianKg: upper,
      targetBracketed: targetValueKg >= Math.min(lower, upper) && targetValueKg <= Math.max(lower, upper) };
  });

  const calibrationForecast = artifacts(validationForecastInput({ seed: 180_000, horizonDays: 90,
    pathCount: 2_048, scenario: scenario(2_400) }));
  const sorted = [...calibrationForecast.terminalPhysiologicalBodyWeightSamplesKg].sort((a, b) => a - b);
  const probabilityCalibration = [0.2, 0.5, 0.8].map((nominal, bin) => {
    const thresholdKg = sorted[Math.floor(nominal * (sorted.length - 1))];
    let successes = 0;
    const trials = 96;
    for (let trial = 0; trial < trials; trial += 1) {
      const realized = artifacts(validationForecastInput({ seed: calibrationSeed(180_100 + bin * 1_000 + trial, "truth"),
        horizonDays: 90, pathCount: 1, scenario: scenario(2_400) }))
        .terminalPhysiologicalBodyWeightSamplesKg[0];
      successes += Number(realized <= thresholdKg);
    }
    const predicted = empiricalTargetAttainment({ samplesKg: sorted, initialWeightKg: 100,
      targetWeightKg: thresholdKg, maintenanceToleranceKg: 0.5 });
    return { nominalBin: nominal, predictedProbability: predicted.probability, thresholdKg, trials, successes,
      observedFrequency: successes / trials, observedWilson95: wilsonScoreInterval(successes, trials) };
  });
  const highCarb = { ...VALIDATION_DAY, nutrition: { caloriesKcal: 2_400, proteinG: 150, fatG: 50, carbsG: 337.5 } };
  const lowCarb = { ...VALIDATION_DAY, nutrition: { caloriesKcal: 2_400, proteinG: 180, fatG: 140, carbsG: 105 } };
  const proteinHeavy = { ...VALIDATION_DAY, nutrition: { caloriesKcal: 2_400, proteinG: 300, fatG: 60, carbsG: 165 } };
  const fatHeavy = { ...VALIDATION_DAY, nutrition: { caloriesKcal: 2_400, proteinG: 120, fatG: 180, carbsG: 75 } };
  const highActivity = { ...VALIDATION_DAY, outsideWorkWalkingDistanceKm: 14, strengthTrainingMinutes: 60 };
  const regimes: Array<{ name: string; horizonDays: number; hiddenCaloriesKcal: number;
    day?: typeof VALIDATION_DAY; prepare?: (value: RunForecastInput) => RunForecastInput }> = [
    { name: "loss-low-center", horizonDays: 30, hiddenCaloriesKcal: 1_800 },
    { name: "larger-loss", horizonDays: 180, hiddenCaloriesKcal: 1_600 },
    { name: "loss-moderate-center", horizonDays: 90, hiddenCaloriesKcal: 2_100 },
    { name: "maintenance", horizonDays: 90, hiddenCaloriesKcal: 2_400 },
    { name: "gain", horizonDays: 180, hiddenCaloriesKcal: 2_900 },
    { name: "high-carbohydrate", horizonDays: 90, hiddenCaloriesKcal: 2_300, day: highCarb },
    { name: "low-carbohydrate", horizonDays: 90, hiddenCaloriesKcal: 2_300, day: lowCarb },
    { name: "protein-heavy", horizonDays: 90, hiddenCaloriesKcal: 2_300, day: proteinHeavy },
    { name: "fat-heavy", horizonDays: 90, hiddenCaloriesKcal: 2_300, day: fatHeavy },
    { name: "different-fat-lean", horizonDays: 90, hiddenCaloriesKcal: 2_250,
      prepare: (value) => ({ ...value, initialParticles: value.initialParticles.map((particle) => ({ ...particle,
        state: { ...particle.state, fatMassKg: particle.state.fatMassKg + 3,
          leanTissueKg: particle.state.leanTissueKg - 2 } })) }) },
    { name: "different-adaptive-thermogenesis", horizonDays: 90, hiddenCaloriesKcal: 2_250,
      prepare: (value) => ({ ...value, initialParticles: value.initialParticles.map((particle) => ({ ...particle,
        state: { ...particle.state, adaptiveThermogenesisKcalPerDay: 100 } })) }) },
    { name: "personalized", horizonDays: 90, hiddenCaloriesKcal: 2_250,
      prepare: (value) => ({ ...value, personalization: { personalOffsetKcalPerDay: 175,
        activityCalibration: 1.12 } }) },
    { name: "high-fixed-activity", horizonDays: 90, hiddenCaloriesKcal: 2_250, day: highActivity },
    { name: "recovered-ensemble", horizonDays: 90, hiddenCaloriesKcal: 2_250,
      prepare: ensemble("recovered") },
    { name: "degraded-ensemble-long-horizon", horizonDays: 365, hiddenCaloriesKcal: 2_250,
      prepare: ensemble("degraded") },
  ];
  const expandedInverse = [];
  for (const [index, regime] of regimes.entries()) {
    const seed = 190_000 + index;
    const day = regime.day ?? VALIDATION_DAY;
    const hidden = scenario(regime.hiddenCaloriesKcal, day);
    const truthInput = validationForecastInput({ seed, horizonDays: regime.horizonDays, pathCount: 256,
      scenario: hidden });
    const truthArtifacts = artifacts(regime.prepare ? regime.prepare(truthInput) : truthInput);
    const target = truthArtifacts.forecast.dates.at(-1)!.physiologicalBodyWeightKg.median;
    const solved = await solve({ horizonDays: regime.horizonDays, targetValueKg: target, seed,
      searchPathCount: 16, finalPathCount: 64, template: scenario(2_400, day), prepare: regime.prepare });
    expandedInverse.push({ name: regime.name, horizonDays: regime.horizonDays,
      hiddenCaloriesKcal: regime.hiddenCaloriesKcal, ...compact(solved),
      controlErrorKcal: "control" in solved.result && solved.result.control.solvedValueKcal !== null
        ? solved.result.control.solvedValueKcal - regime.hiddenCaloriesKcal : null });
  }
  console.log(JSON.stringify({ targetValueKg, hiddenCaloriesKcal, seedStability, pathSensitivity,
    highCompute, horizonCurve, probabilityCalibration, expandedInverse }, null, 2));
}

function ensemble(quality: "recovered" | "degraded") {
  return (value: RunForecastInput): RunForecastInput => {
    const state = value.initialParticles[0].state;
    return { ...value, initialStateQuality: quality, recoveryVersion: "bodycast-recovery-v3",
      initialParticles: [
        { state, weight: 0.6, sourceParticleIndex: 0 },
        { state: { ...state, fatMassKg: state.fatMassKg + 1.2,
          glycogenKg: state.glycogenKg * 1.15 }, weight: 0.4, sourceParticleIndex: 1 },
      ] };
  };
}

function compact(value: Awaited<ReturnType<typeof solve>>) {
  const result = value.result;
  return { runtimeMs: value.runtimeMs, status: result.status,
    caloriesKcal: "control" in result ? result.control.solvedValueKcal : null,
    residualKg: "terminal" in result ? result.terminal?.targetErrorKg : null,
    interval90Kg: "terminal" in result && result.terminal ? [result.terminal.p05, result.terminal.p95] : null,
    attainment: "terminal" in result ? result.terminal?.attainment : null,
    numericalQuality: "quality" in result ? result.quality.numericalQuality?.classification : null,
    sensitivityKgPer100Kcal: "robustness" in result ? result.robustness.sensitivityKgPer100Kcal : null };
}

void main();
