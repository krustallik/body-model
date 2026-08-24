import { runForecast } from "@/modules/model-forecast/forecast-engine";
import type {
  ForecastBehaviorDay,
  ForecastInitialParticle,
  ForecastResult,
  ForecastScenario,
  RunForecastInput,
} from "@/modules/model-forecast/forecast.types";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { prepareEpisodeInitialization } from "@/modules/model-episodes/episode-initialization";
import type { ModelHealthDaySource } from "@/modules/model-episodes/model-episode.types";

export const VALIDATION_DAY: ForecastBehaviorDay = {
  nutrition: { caloriesKcal: 2_400, proteinG: 160, fatG: 80, carbsG: 260 },
  outsideWorkWalkingDistanceKm: 6,
  averageWalkingSpeedKmh: 5,
  strengthTrainingMinutes: 0,
  occupation: [],
};

function sourceDay(date: string, index: number): ModelHealthDaySource {
  return {
    date,
    weightKg: 80 + [0, 0.1, -0.05, 0.05][index % 4],
    bodyFatPercent: 20,
    caloriesKcal: 2_400 + [0, 120, -80, 60, -100][index % 5],
    proteinG: 160 + [0, 10, -5][index % 3],
    fatG: 80 + [0, 8, -6][index % 3],
    carbsG: 260 + [0, 25, -20][index % 3],
    averageWalkingSpeedKmh: 5,
    walkingDistanceKm: 6 + [0, 2, -1][index % 3],
    strengthTrainingMinutes: index % 3 === 0 ? 60 : 0,
  };
}

const historyEnd = "2026-08-22";
const history = Array.from({ length: 60 }, (_, index) => (
  sourceDay(addCalendarDays(historyEnd, index - 59), index)
));
const prepared = prepareEpisodeInitialization({
  profile: { id: 1, sex: "male", dateOfBirth: "1990-05-10", heightCm: 180 },
  days: history,
  startDate: historyEnd,
});

export function validationForecastInput(input: {
  seed: number;
  horizonDays: number;
  scenario?: ForecastScenario;
  pathCount?: number;
  initialParticles?: ForecastInitialParticle[];
  initialStateQuality?: "deterministic" | "recovered" | "degraded";
  fallbackEvidence?: boolean;
}): RunForecastInput {
  return {
    seed: input.seed,
    startDate: "2026-08-23",
    horizonDays: input.horizonDays,
    modelVersion: "bodycast-physiology-v4",
    recoveryVersion: input.initialStateQuality === "deterministic" || !input.initialStateQuality
      ? null : "bodycast-recovery-v3",
    sourceFingerprint: "synthetic-validation-source",
    scenarioFingerprint: "synthetic-validation-scenario",
    initialStateQuality: input.initialStateQuality ?? "deterministic",
    initialParticles: input.initialParticles ?? [{ state: prepared.initialState, weight: 1 }],
    parameters: prepared.simulatorParameters,
    personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
    ecfPolicy: "hold-ecf",
    scenario: input.scenario ?? {
      mode: "target-centered",
      schedule: { defaultDay: VALIDATION_DAY },
    },
    reliableDonorDays: history.map((day) => ({
      nutrition: {
        caloriesKcal: day.caloriesKcal!, proteinG: day.proteinG!,
        fatG: day.fatG!, carbsG: day.carbsG!,
      },
      outsideWorkWalkingDistanceKm: day.walkingDistanceKm!,
      averageWalkingSpeedKmh: day.averageWalkingSpeedKmh!,
      strengthTrainingMinutes: day.strengthTrainingMinutes!,
      occupation: [],
    })),
    variabilityEvidence: {
      donorDayCount: input.fallbackEvidence ? 2 : 60,
      source: input.fallbackEvidence ? "engineering-fallback" : "observed-history",
      nutritionLogStandardDeviation: 0.2,
      macroCompositionLogStandardDeviation: 0.1,
      walkingLogStandardDeviation: 0.3,
    },
    config: { pathCount: input.pathCount ?? 256 },
  };
}

type Metric = "physiologicalBodyWeightKg" | "fatMassKg" | "glycogenKg";

function wilson(successes: number, total: number): [number, number] {
  const z = 1.959963984540054;
  const proportion = successes / total;
  const denominator = 1 + z ** 2 / total;
  const center = (proportion + z ** 2 / (2 * total)) / denominator;
  const half = z * Math.sqrt((proportion * (1 - proportion) + z ** 2 / (4 * total)) / total) / denominator;
  return [center - half, center + half];
}

/** Avalanche sequential panel indices into separated deterministic PRNG streams. */
export function calibrationSeed(panelIndex: number, stream: "forecast" | "truth"): number {
  let value = (panelIndex ^ (stream === "forecast" ? 0x9e3779b9 : 0x243f6a88)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function runForecastGenerativeValidation(input: {
  runsPerHorizon?: number;
  pathCount?: number;
} = {}) {
  const runsPerHorizon = input.runsPerHorizon ?? 128;
  const pathCount = input.pathCount ?? 256;
  const horizons = [7, 30, 90] as const;
  const metrics: Metric[] = ["physiologicalBodyWeightKg", "fatMassKg", "glycogenKg"];
  const counts = Object.fromEntries(horizons.map((horizon) => [horizon,
    Object.fromEntries(metrics.map((metric) => [metric, { inner: 0, outer: 0 }]))])) as Record<number, Record<Metric, { inner: number; outer: number }>>;
  for (const horizon of horizons) {
    for (let run = 0; run < runsPerHorizon; run += 1) {
      const panelIndex = horizon * 10_000 + run;
      const forecast = runForecast(validationForecastInput({
        seed: calibrationSeed(panelIndex, "forecast"), horizonDays: horizon, pathCount,
      }));
      const truth = runForecast(validationForecastInput({
        seed: calibrationSeed(panelIndex, "truth"), horizonDays: horizon, pathCount: 1,
      }));
      for (const metric of metrics) {
        const interval = forecast.dates.at(-1)![metric];
        const value = truth.dates.at(-1)![metric].median;
        if (value >= interval.p25 && value <= interval.p75) counts[horizon][metric].inner += 1;
        if (value >= interval.p05 && value <= interval.p95) counts[horizon][metric].outer += 1;
      }
    }
  }
  return {
    kind: "generative-exact-model" as const,
    uncertainty: "future-only" as const,
    runsPerHorizon,
    pathCount,
    expectedFiniteSampleCoverage: {
      inner50: (Math.ceil(0.75 * pathCount) - Math.ceil(0.25 * pathCount)) / (pathCount + 1),
      outer90: (Math.ceil(0.95 * pathCount) - Math.ceil(0.05 * pathCount)) / (pathCount + 1),
      convention: "inverse-ECDF order statistics; independent continuous truth",
    },
    results: horizons.map((horizon) => ({
      horizon,
      metrics: Object.fromEntries(metrics.map((metric) => {
        const count = counts[horizon][metric];
        return [metric, {
          trials: runsPerHorizon,
          successes50: count.inner,
          coverage50: count.inner / runsPerHorizon,
          coverage50Wilson95: wilson(count.inner, runsPerHorizon),
          nominal50: 0.5,
          successes90: count.outer,
          coverage90: count.outer / runsPerHorizon,
          coverage90Wilson95: wilson(count.outer, runsPerHorizon),
          nominal90: 0.9,
        }];
      })),
    })),
  };
}

function validationParticles(): ForecastInitialParticle[] {
  const state = prepared.initialState;
  return Array.from({ length: 41 }, (_, particleIndex) => {
    const z = (particleIndex - 20) / 8;
    return {
      state: {
        ...state,
        fatMassKg: state.fatMassKg + 0.8 * z,
        leanTissueKg: state.leanTissueKg - 0.25 * z,
        glycogenKg: state.glycogenKg * Math.exp(0.08 * z),
        extracellularFluidDeviationLiters: state.extracellularFluidDeviationLiters + 0.35 * z,
        adaptiveThermogenesisKcalPerDay: state.adaptiveThermogenesisKcalPerDay + 12 * z,
      },
      weight: Math.exp(-0.5 * z ** 2),
      sourceParticleIndex: particleIndex,
    };
  });
}

type CalibrationCase = {
  name: "initial-only" | "future-only" | "combined" | "recent-behavior";
  scenario: ForecastScenario;
  initialParticles: ForecastInitialParticle[];
  initialStateQuality: "deterministic" | "recovered";
};

function runCalibrationCase(input: {
  calibrationCase: CalibrationCase;
  trials: number;
  pathCount: number;
  horizons: readonly number[];
  panelOffset: number;
}) {
  const metrics: Metric[] = ["physiologicalBodyWeightKg", "fatMassKg", "glycogenKg"];
  return {
    uncertainty: input.calibrationCase.name,
    scenarioMode: input.calibrationCase.scenario.mode,
    trialsPerHorizon: input.trials,
    pathCount: input.pathCount,
    results: input.horizons.map((horizon) => {
      const counts = Object.fromEntries(metrics.map((metric) => [metric, { inner: 0, outer: 0 }])) as
        Record<Metric, { inner: number; outer: number }>;
      for (let trial = 0; trial < input.trials; trial += 1) {
        const panelIndex = input.panelOffset + horizon * 10_000 + trial;
        const common = {
          horizonDays: horizon,
          scenario: input.calibrationCase.scenario,
          initialParticles: input.calibrationCase.initialParticles,
          initialStateQuality: input.calibrationCase.initialStateQuality,
        } as const;
        const forecast = runForecast(validationForecastInput({
          ...common,
          seed: calibrationSeed(panelIndex, "forecast"),
          pathCount: input.pathCount,
        }));
        const truth = runForecast(validationForecastInput({
          ...common,
          seed: calibrationSeed(panelIndex, "truth"),
          pathCount: 1,
        }));
        for (const metric of metrics) {
          const interval = forecast.dates.at(-1)![metric];
          const value = truth.dates.at(-1)![metric].median;
          if (value >= interval.p25 && value <= interval.p75) counts[metric].inner += 1;
          if (value >= interval.p05 && value <= interval.p95) counts[metric].outer += 1;
        }
      }
      return {
        horizon,
        metrics: Object.fromEntries(metrics.map((metric) => {
          const count = counts[metric];
          return [metric, {
            trials: input.trials,
            successes50: count.inner,
            coverage50: count.inner / input.trials,
            coverage50Wilson95: wilson(count.inner, input.trials),
            nominal50: 0.5,
            successes90: count.outer,
            coverage90: count.outer / input.trials,
            coverage90Wilson95: wilson(count.outer, input.trials),
            nominal90: 0.9,
          }];
        })),
      };
    }),
  };
}

export function runForecastUncertaintyDecompositionValidation(input: {
  trialsPerCase?: number;
  pathCount?: number;
} = {}) {
  const trials = input.trialsPerCase ?? 64;
  const pathCount = input.pathCount ?? 256;
  const particles = validationParticles();
  const target: ForecastScenario = { mode: "target-centered", schedule: { defaultDay: VALIDATION_DAY } };
  const exact = [{ state: prepared.initialState, weight: 1 }];
  const cases: CalibrationCase[] = [
    { name: "initial-only", scenario: fixed(VALIDATION_DAY), initialParticles: particles, initialStateQuality: "recovered" },
    { name: "future-only", scenario: target, initialParticles: exact, initialStateQuality: "deterministic" },
    { name: "combined", scenario: target, initialParticles: particles, initialStateQuality: "recovered" },
  ];
  return {
    kind: "uncertainty-decomposition" as const,
    cases: cases.map((calibrationCase, index) => runCalibrationCase({
      calibrationCase,
      trials,
      pathCount,
      horizons: [7, 30, 90],
      panelOffset: 1_000_000 + index * 100_000,
    })),
  };
}

export function runForecastScenarioModeValidation(input: {
  recentTrials?: number;
  pathCount?: number;
} = {}) {
  const pathCount = input.pathCount ?? 256;
  const fixedForecast = runForecast(validationForecastInput({
    seed: 2_000_001,
    horizonDays: 90,
    scenario: fixed(VALIDATION_DAY),
    pathCount,
  }));
  const fixedTruth = runForecast(validationForecastInput({
    seed: 2_000_002,
    horizonDays: 90,
    scenario: fixed(VALIDATION_DAY),
    pathCount: 1,
  }));
  const fixedMetrics: Metric[] = ["physiologicalBodyWeightKg", "fatMassKg", "glycogenKg"];
  const fixedExact = Object.fromEntries(fixedMetrics.map((metric) => {
    const predicted = fixedForecast.dates.at(-1)![metric];
    const realized = fixedTruth.dates.at(-1)![metric].median;
    return [metric, Math.max(
      Math.abs(predicted.p05 - realized),
      Math.abs(predicted.p25 - realized),
      Math.abs(predicted.median - realized),
      Math.abs(predicted.p75 - realized),
      Math.abs(predicted.p95 - realized),
    )];
  }));
  const recentCase: CalibrationCase = {
    name: "recent-behavior",
    scenario: { mode: "recent-behavior", blockLengthDays: 3, minimumDonorDays: 14 },
    initialParticles: [{ state: prepared.initialState, weight: 1 }],
    initialStateQuality: "deterministic",
  };
  return {
    kind: "scenario-mode-validation" as const,
    fixed: {
      horizon: 90,
      pathCount,
      maximumAbsoluteEndpointErrorByMetric: fixedExact,
      exact: Object.values(fixedExact).every((value) => value === 0),
    },
    recentBehavior: runCalibrationCase({
      calibrationCase: recentCase,
      trials: input.recentTrials ?? 128,
      pathCount,
      horizons: [7, 30, 90],
      panelOffset: 2_100_000,
    }),
  };
}

export function runForecastHighPathReference() {
  const horizonDays = 365;
  const seed = 3_000_001;
  const ordinary = runForecast(validationForecastInput({ seed, horizonDays, pathCount: 512 }));
  const reference = runForecast(validationForecastInput({ seed, horizonDays, pathCount: 8_192 }));
  const metrics: Metric[] = ["physiologicalBodyWeightKg", "fatMassKg", "glycogenKg"];
  const ordinaryFinal = ordinary.dates.at(-1)!;
  const referenceFinal = reference.dates.at(-1)!;
  return {
    kind: "high-path-reference" as const,
    horizonDays,
    seed,
    ordinaryPathCount: 512,
    referencePathCount: 8_192,
    ordinaryNumericalQuality: ordinary.diagnostics.numericalQuality,
    referenceNumericalQuality: reference.diagnostics.numericalQuality,
    endpointAbsoluteDifferences: Object.fromEntries(metrics.map((metric) => {
      const left = ordinaryFinal[metric];
      const right = referenceFinal[metric];
      return [metric, {
        p05: Math.abs(left.p05 - right.p05),
        p25: Math.abs(left.p25 - right.p25),
        median: Math.abs(left.median - right.median),
        p75: Math.abs(left.p75 - right.p75),
        p95: Math.abs(left.p95 - right.p95),
      }];
    })),
  };
}

function fixed(day: ForecastBehaviorDay): ForecastScenario {
  return { mode: "fixed", schedule: { defaultDay: day } };
}

function overridesFrom(date: string, day: ForecastBehaviorDay, through: string): Record<string, ForecastBehaviorDay> {
  const overrides: Record<string, ForecastBehaviorDay> = {};
  for (let current = date; current <= through; current = addCalendarDays(current, 1)) {
    overrides[current] = day;
  }
  return overrides;
}

export function runForecastStressValidation() {
  const deficit = { ...VALIDATION_DAY, nutrition: { ...VALIDATION_DAY.nutrition, caloriesKcal: 1_700 } };
  const surplus = { ...VALIDATION_DAY, nutrition: { ...VALIDATION_DAY.nutrition, caloriesKcal: 3_200 } };
  const highCarb = { ...VALIDATION_DAY, nutrition: { caloriesKcal: 2_700, proteinG: 150, fatG: 55, carbsG: 430 } };
  const lowCarb = { ...VALIDATION_DAY, nutrition: { caloriesKcal: 2_000, proteinG: 180, fatG: 110, carbsG: 50 } };
  const scenarios: Array<{ name: string; forecast: ForecastScenario; truth: ForecastScenario; horizon: number; options?: Partial<Parameters<typeof validationForecastInput>[0]> }> = [
    { name: "consistent-deficit", forecast: fixed(deficit), truth: fixed(deficit), horizon: 30 },
    { name: "maintenance", forecast: fixed(VALIDATION_DAY), truth: fixed(VALIDATION_DAY), horizon: 90 },
    { name: "sustained-surplus", forecast: fixed(surplus), truth: fixed(surplus), horizon: 30 },
    { name: "abrupt-deficit-to-maintenance", forecast: { mode: "target-centered", schedule: { defaultDay: deficit, byDate: overridesFrom("2026-09-07", VALIDATION_DAY, "2026-09-21") } }, truth: fixed(VALIDATION_DAY), horizon: 30 },
    { name: "deficit-to-surplus", forecast: { mode: "target-centered", schedule: { defaultDay: deficit, byDate: overridesFrom("2026-09-07", surplus, "2026-09-21") } }, truth: fixed(surplus), horizon: 30 },
    { name: "high-carb", forecast: { mode: "target-centered", schedule: { defaultDay: highCarb } }, truth: fixed(highCarb), horizon: 30 },
    { name: "low-carb", forecast: { mode: "target-centered", schedule: { defaultDay: lowCarb } }, truth: fixed(lowCarb), horizon: 30 },
    { name: "low-activity", forecast: { mode: "target-centered", schedule: { defaultDay: { ...VALIDATION_DAY, outsideWorkWalkingDistanceKm: 0 } } }, truth: fixed({ ...VALIDATION_DAY, outsideWorkWalkingDistanceKm: 0 }), horizon: 30 },
    { name: "high-activity", forecast: { mode: "target-centered", schedule: { defaultDay: { ...VALIDATION_DAY, outsideWorkWalkingDistanceKm: 18 } } }, truth: fixed({ ...VALIDATION_DAY, outsideWorkWalkingDistanceKm: 18 }), horizon: 30 },
    { name: "regular-strength", forecast: { mode: "target-centered", schedule: { defaultDay: VALIDATION_DAY, strengthByWeekday: { 1: 60, 3: 60, 5: 60 } } }, truth: fixed({ ...VALIDATION_DAY, strengthTrainingMinutes: 60 }), horizon: 30 },
    { name: "vacation-recovered-initial", forecast: { mode: "target-centered", schedule: { defaultDay: VALIDATION_DAY } }, truth: fixed(VALIDATION_DAY), horizon: 30, options: { initialStateQuality: "recovered", initialParticles: [{ state: prepared.initialState, weight: 0.6 }, { state: { ...prepared.initialState, glycogenKg: prepared.initialState.glycogenKg * 1.2 }, weight: 0.4 }] } },
    { name: "degraded-initial", forecast: { mode: "target-centered", schedule: { defaultDay: VALIDATION_DAY } }, truth: fixed(VALIDATION_DAY), horizon: 30, options: { initialStateQuality: "degraded", initialParticles: [{ state: prepared.initialState, weight: 0.9 }, { state: { ...prepared.initialState, fatMassKg: prepared.initialState.fatMassKg + 2 }, weight: 0.1 }] } },
    { name: "limited-history", forecast: { mode: "target-centered", schedule: { defaultDay: VALIDATION_DAY } }, truth: fixed(VALIDATION_DAY), horizon: 30, options: { fallbackEvidence: true } },
  ];
  return {
    kind: "stress-not-nominal-calibration" as const,
    results: scenarios.map((item, index) => {
      const forecast = runForecast(validationForecastInput({
        seed: 50_000 + index * 2, horizonDays: item.horizon, scenario: item.forecast,
        pathCount: 512, ...item.options,
      }));
      const truth = runForecast(validationForecastInput({
        seed: 50_001 + index * 2, horizonDays: item.horizon, scenario: item.truth,
        pathCount: 1, ...item.options,
      }));
      const predicted = forecast.dates.at(-1)!;
      const realized = truth.dates.at(-1)!;
      return {
        name: item.name,
        horizon: item.horizon,
        forecastStatus: forecast.status,
        weightTruthInside90: realized.physiologicalBodyWeightKg.median >= predicted.physiologicalBodyWeightKg.p05
          && realized.physiologicalBodyWeightKg.median <= predicted.physiologicalBodyWeightKg.p95,
        final: {
          weight: predicted.physiologicalBodyWeightKg,
          fatMass: predicted.fatMassKg,
          glycogen: predicted.glycogenKg,
          rmr: predicted.dynamicRmrKcalPerDay,
          tdee: predicted.tdeeKcalPerDay,
        },
      };
    }),
  };
}

export function canonicalForecasts(): Record<string, ForecastResult> {
  const deficit = { ...VALIDATION_DAY, nutrition: { ...VALIDATION_DAY.nutrition, caloriesKcal: 1_800 } };
  return {
    deficit30d: runForecast(validationForecastInput({ seed: 701, horizonDays: 30, scenario: { mode: "target-centered", schedule: { defaultDay: deficit } }, pathCount: 512 })),
    maintenance90d: runForecast(validationForecastInput({ seed: 702, horizonDays: 90, scenario: { mode: "target-centered", schedule: { defaultDay: VALIDATION_DAY } }, pathCount: 512 })),
    deficitToMaintenance: runForecast(validationForecastInput({ seed: 703, horizonDays: 30, scenario: { mode: "target-centered", schedule: { defaultDay: deficit, byDate: overridesFrom("2026-09-07", VALIDATION_DAY, "2026-09-21") } }, pathCount: 512 })),
    recoveredVacation: runForecast(validationForecastInput({
      seed: 704, horizonDays: 30, scenario: { mode: "target-centered", schedule: { defaultDay: VALIDATION_DAY } }, pathCount: 512,
      initialStateQuality: "recovered",
      initialParticles: [{ state: prepared.initialState, weight: 0.7 }, { state: { ...prepared.initialState, glycogenKg: prepared.initialState.glycogenKg * 1.25 }, weight: 0.3 }],
    })),
  };
}
