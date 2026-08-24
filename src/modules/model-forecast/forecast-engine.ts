import { GLYCOGEN_WATER_KG_PER_KG } from "@/model/body-composition/constants";
import { reconstructBodyWeightKg } from "@/model/body-composition/state";
import { simulateOneDay, type PhysiologicalDailyInput } from "@/model/physiological-simulator";
import { addCalendarDays, calendarDayIndex } from "@/modules/model-episodes/model-calendar";
import { SeededRandom, weightedQuantile } from "@/modules/model-recovery/recovery-math";
import { ForecastScenarioEvidenceError } from "./model-forecast.errors";
import {
  DEFAULT_FORECAST_CONFIG,
  FORECAST_ALGORITHM_VERSION,
  type ForecastBehaviorDay,
  type ForecastConfig,
  type ForecastDateSummary,
  type ForecastInitialParticle,
  type ForecastOccupationInterval,
  type ForecastResult,
  type ForecastScenario,
  type PredictiveSummary,
  type RunForecastInput,
  type ScheduledBehavior,
} from "./forecast.types";

type PathDay = {
  physiologicalBodyWeightKg: number;
  fatMassKg: number;
  leanTissueKg: number;
  glycogenKg: number;
  glycogenWaterKg: number;
  glycogenAssociatedMassKg: number;
  extracellularFluidDeviationLiters: number;
  adaptiveThermogenesisKcalPerDay: number;
  dynamicRmrKcalPerDay: number;
  tdeeKcalPerDay: number;
  energyIntakeKcal: number;
  netActivityKcalPerDay: number;
};

const METRICS = [
  "physiologicalBodyWeightKg",
  "fatMassKg",
  "leanTissueKg",
  "glycogenKg",
  "glycogenWaterKg",
  "glycogenAssociatedMassKg",
  "extracellularFluidDeviationLiters",
  "adaptiveThermogenesisKcalPerDay",
  "dynamicRmrKcalPerDay",
  "tdeeKcalPerDay",
  "energyIntakeKcal",
  "netActivityKcalPerDay",
] as const satisfies readonly (keyof PathDay)[];

function resolvedConfig(config?: Partial<ForecastConfig>): ForecastConfig {
  const result = { ...DEFAULT_FORECAST_CONFIG, ...config };
  if (!Number.isInteger(result.pathCount) || result.pathCount <= 0) {
    throw new RangeError("forecast pathCount must be a positive integer");
  }
  if (!(result.minimumValidPathFraction > 0 && result.minimumValidPathFraction <= 1)) {
    throw new RangeError("minimumValidPathFraction must be in (0, 1]");
  }
  if (!Number.isInteger(result.longHorizonThresholdDays) || result.longHorizonThresholdDays < 1
      || !Number.isInteger(result.longHorizonRecommendedPathCount)
      || result.longHorizonRecommendedPathCount < 1) {
    throw new RangeError("long-horizon forecast controls must be positive integers");
  }
  if (!(result.lowerProbability < result.innerLowerProbability
      && result.innerLowerProbability < 0.5
      && result.innerUpperProbability > 0.5
      && result.innerUpperProbability < result.upperProbability)) {
    throw new RangeError("forecast quantile probabilities must be strictly ordered around 0.5");
  }
  return result;
}

function normalizeParticles(particles: readonly ForecastInitialParticle[]): ForecastInitialParticle[] {
  if (particles.length === 0) throw new Error("forecast requires at least one initial particle");
  const total = particles.reduce((sum, particle) => {
    if (!Number.isFinite(particle.weight) || particle.weight < 0) {
      throw new Error("initial particle weights must be finite and non-negative");
    }
    return sum + particle.weight;
  }, 0);
  if (!(total > 0)) throw new Error("at least one initial particle weight must be positive");
  return particles.map((particle) => ({ ...particle, weight: particle.weight / total }));
}

/** Low-variance equal-weight conversion of a weighted posterior. */
export function stratifiedResampleIndices(
  weights: readonly number[],
  count: number,
  random: SeededRandom,
): number[] {
  if (!Number.isInteger(count) || count <= 0) throw new RangeError("resample count must be positive");
  const normalized = normalizeParticles(weights.map((weight) => ({ weight, state: {} as never })))
    .map(({ weight }) => weight);
  const cumulative: number[] = [];
  normalized.reduce((sum, weight, index) => (cumulative[index] = sum + weight), 0);
  const result: number[] = [];
  let index = 0;
  for (let stratum = 0; stratum < count; stratum += 1) {
    const target = (stratum + random.next()) / count;
    while (index < cumulative.length - 1 && target > cumulative[index]) index += 1;
    result.push(index);
  }
  return result;
}

function mergeBehavior(base: ForecastBehaviorDay, override?: Partial<ForecastBehaviorDay>): ForecastBehaviorDay {
  return {
    ...base,
    ...override,
    nutrition: override?.nutrition ? { ...override.nutrition } : { ...base.nutrition },
    occupation: (override?.occupation ?? base.occupation).map((interval) => ({ ...interval })),
  };
}

function scheduledDay(schedule: ScheduledBehavior, date: string): ForecastBehaviorDay {
  const weekday = new Date(calendarDayIndex(date) * 86_400_000).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const base = mergeBehavior(schedule.defaultDay, schedule.byDate?.[date]);
  const scheduledStrength = schedule.strengthByWeekday?.[weekday];
  return scheduledStrength === undefined ? base : { ...base, strengthTrainingMinutes: scheduledStrength };
}

function nonnegativeLogNormal(
  center: number,
  standardDeviation: number,
  random: Pick<SeededRandom, "normal">,
): number {
  if (center === 0) return 0;
  return center * Math.exp(standardDeviation * random.normal() - 0.5 * standardDeviation ** 2);
}

function sampledTargetDay(input: {
  central: ForecastBehaviorDay;
  scenario: Extract<ForecastScenario, { mode: "target-centered" }>;
  config: ForecastConfig;
  evidence: RunForecastInput["variabilityEvidence"];
  random: SeededRandom;
  nutritionRegimeZ: number;
  walkingRegimeZ: number;
}): ForecastBehaviorDay {
  const explicit = input.scenario.variability;
  const nutritionSd = explicit?.nutritionLogStandardDeviation
    ?? input.evidence.nutritionLogStandardDeviation;
  const macroSd = explicit?.macroCompositionLogStandardDeviation
    ?? input.evidence.macroCompositionLogStandardDeviation;
  const walkingSd = explicit?.walkingLogStandardDeviation
    ?? input.evidence.walkingLogStandardDeviation;
  const commonZ = 0.6 * input.nutritionRegimeZ + 0.8 * input.random.normal();
  const nutritionMultiplier = Math.exp(nutritionSd * commonZ - 0.5 * nutritionSd ** 2);
  const composition = [-1, 0, 1].map(() => (
    Math.exp(macroSd * input.random.normal() - 0.5 * macroSd ** 2)
  ));
  const strengthAdherence = explicit?.strengthAdherenceProbability
    ?? input.config.strengthAdherenceProbability;
  const occupationAdherence = explicit?.occupationAdherenceProbability
    ?? input.config.occupationAdherenceProbability;
  return {
    nutrition: {
      caloriesKcal: input.central.nutrition.caloriesKcal * nutritionMultiplier,
      proteinG: input.central.nutrition.proteinG * nutritionMultiplier * composition[0],
      fatG: input.central.nutrition.fatG * nutritionMultiplier * composition[1],
      carbsG: input.central.nutrition.carbsG * nutritionMultiplier * composition[2],
    },
    outsideWorkWalkingDistanceKm: nonnegativeLogNormal(
      input.central.outsideWorkWalkingDistanceKm,
      walkingSd,
      { normal: () => 0.6 * input.walkingRegimeZ + 0.8 * input.random.normal() },
    ),
    averageWalkingSpeedKmh: input.central.averageWalkingSpeedKmh,
    strengthTrainingMinutes: input.random.next() < strengthAdherence
      ? input.central.strengthTrainingMinutes : 0,
    occupation: input.random.next() < occupationAdherence
      ? input.central.occupation.map((interval) => ({ ...interval })) : [],
  };
}

type BehaviorPathSampler = (date: string, dayIndex: number) => ForecastBehaviorDay;

function behaviorSampler(input: {
  scenario: ForecastScenario;
  reliableDonorDays: readonly ForecastBehaviorDay[];
  evidence: RunForecastInput["variabilityEvidence"];
  config: ForecastConfig;
  random: SeededRandom;
}): BehaviorPathSampler {
  if (input.scenario.mode === "fixed") {
    const scenario = input.scenario;
    return (date) => scheduledDay(scenario.schedule, date);
  }
  if (input.scenario.mode === "recent-behavior") {
    const minimum = input.scenario.minimumDonorDays ?? input.config.minimumReliableDonorDays;
    if (input.reliableDonorDays.length < minimum) {
      throw new ForecastScenarioEvidenceError(
        `recent-behavior requires at least ${minimum} reliable observed donor days; received ${input.reliableDonorDays.length}`,
      );
    }
    const blockLength = input.scenario.blockLengthDays ?? input.config.blockLengthDays;
    let blockStart = 0;
    return (_date, dayIndex) => {
      if (dayIndex % blockLength === 0) {
        blockStart = Math.floor(input.random.next() * input.reliableDonorDays.length);
      }
      const donor = input.reliableDonorDays[
        (blockStart + (dayIndex % blockLength)) % input.reliableDonorDays.length
      ];
      return mergeBehavior(donor);
    };
  }
  const scenario = input.scenario;
  const nutritionRegimeZ = input.random.normal();
  const walkingRegimeZ = input.random.normal();
  return (date) => sampledTargetDay({
    central: scheduledDay(scenario.schedule, date),
    scenario,
    config: input.config,
    evidence: input.evidence,
    random: input.random,
    nutritionRegimeZ,
    walkingRegimeZ,
  });
}

/** Samples exactly the future-input distribution consumed by the forecast engine. */
export function sampleForecastBehaviorPath(input: {
  scenario: ForecastScenario;
  startDate: string;
  horizonDays: number;
  reliableDonorDays: readonly ForecastBehaviorDay[];
  evidence: RunForecastInput["variabilityEvidence"];
  config?: Partial<ForecastConfig>;
  random: SeededRandom;
}): ForecastBehaviorDay[] {
  const config = resolvedConfig(input.config);
  const sampler = behaviorSampler({
    scenario: input.scenario,
    reliableDonorDays: input.reliableDonorDays,
    evidence: input.evidence,
    config,
    random: input.random,
  });
  return Array.from({ length: input.horizonDays }, (_, dayIndex) => (
    sampler(addCalendarDays(input.startDate, dayIndex), dayIndex)
  ));
}

function toPhysiologyInput(date: string, behavior: ForecastBehaviorDay): PhysiologicalDailyInput {
  return {
    date,
    ...behavior.nutrition,
    outsideWorkWalkingDistanceKm: behavior.outsideWorkWalkingDistanceKm,
    averageWalkingSpeedKmh: behavior.averageWalkingSpeedKmh,
    strengthTrainingMinutes: behavior.strengthTrainingMinutes,
    occupationalActivity: {
      category: null,
      durationHours: 0,
      intervals: behavior.occupation.map((interval: ForecastOccupationInterval) => ({ ...interval })),
    },
    sodiumChangeMgPerDay: 0,
    measuredWeightKg: null,
  };
}

export function empiricalPredictiveSummary(
  values: readonly number[],
  config: Pick<ForecastConfig, "lowerProbability" | "innerLowerProbability" | "innerUpperProbability" | "upperProbability"> = DEFAULT_FORECAST_CONFIG,
): PredictiveSummary {
  if (values.length === 0) throw new Error("predictive summary requires at least one path");
  const weights = values.map(() => 1);
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p05: weightedQuantile(values, weights, config.lowerProbability),
    p25: weightedQuantile(values, weights, config.innerLowerProbability),
    median: weightedQuantile(values, weights, 0.5),
    p75: weightedQuantile(values, weights, config.innerUpperProbability),
    p95: weightedQuantile(values, weights, config.upperProbability),
  };
}

function summarizeDates(paths: readonly PathDay[][], startDate: string, config: ForecastConfig): ForecastDateSummary[] {
  return Array.from({ length: paths[0]?.length ?? 0 }, (_, dayIndex) => {
    const summaries = Object.fromEntries(METRICS.map((metric) => [
      metric,
      empiricalPredictiveSummary(paths.map((path) => path[dayIndex][metric]), config),
    ])) as unknown as Omit<ForecastDateSummary, "date">;
    return { date: addCalendarDays(startDate, dayIndex), ...summaries };
  });
}

function invalidReason(error: unknown): string {
  if (error instanceof Error) return `${error.name}:${error.message}`.slice(0, 200);
  return "unknown-forecast-path-error";
}

export type ForecastInternalArtifacts = {
  result: ForecastResult;
  initialPhysiologicalBodyWeightKg: number;
  terminalPhysiologicalBodyWeightSamplesKg: readonly number[];
};

/** Internal simulation artifacts for consumers that need the empirical paths. */
export function runForecastWithInternalArtifacts(input: RunForecastInput): ForecastInternalArtifacts {
  if (!Number.isInteger(input.horizonDays) || input.horizonDays <= 0) {
    throw new RangeError("forecast horizonDays must be a positive integer");
  }
  const config = resolvedConfig(input.config);
  const random = new SeededRandom(input.seed);
  const particles = normalizeParticles(input.initialParticles);
  const startingIndices = particles.length === 1
    ? Array.from({ length: config.pathCount }, () => 0)
    : stratifiedResampleIndices(particles.map(({ weight }) => weight), config.pathCount, random);
  const validPaths: PathDay[][] = [];
  const validStartingIndices: number[] = [];
  const invalidPathReasons: Record<string, number> = {};
  for (const startingIndex of startingIndices) {
    let state = particles[startingIndex].state;
    const behaviorPath = sampleForecastBehaviorPath({
      scenario: input.scenario,
      startDate: input.startDate,
      horizonDays: input.horizonDays,
      reliableDonorDays: input.reliableDonorDays,
      evidence: input.variabilityEvidence,
      config,
      random,
    });
    const path: PathDay[] = [];
    try {
      for (let dayIndex = 0; dayIndex < input.horizonDays; dayIndex += 1) {
        const date = addCalendarDays(input.startDate, dayIndex);
        const behavior = behaviorPath[dayIndex];
        const result = simulateOneDay({
          state,
          parameters: input.parameters,
          day: toPhysiologyInput(date, behavior),
          options: { ecfPolicy: input.ecfPolicy },
          personalization: input.personalization,
        });
        if (result.status !== "complete") {
          throw new Error(`incomplete:${result.missingFields.join(",")}`);
        }
        const glycogenWaterKg = result.endState.glycogenKg * GLYCOGEN_WATER_KG_PER_KG;
        path.push({
          physiologicalBodyWeightKg: result.calculations.endWeightKg,
          fatMassKg: result.endState.fatMassKg,
          leanTissueKg: result.endState.leanTissueKg,
          glycogenKg: result.endState.glycogenKg,
          glycogenWaterKg,
          glycogenAssociatedMassKg: result.endState.glycogenKg + glycogenWaterKg,
          extracellularFluidDeviationLiters: result.endState.extracellularFluidDeviationLiters,
          adaptiveThermogenesisKcalPerDay: result.endState.adaptiveThermogenesisKcalPerDay,
          dynamicRmrKcalPerDay: result.calculations.expenditure.dynamicRmrKcalPerDay,
          tdeeKcalPerDay: result.calculations.expenditure.personalizedTdeeKcalPerDay!,
          energyIntakeKcal: behavior.nutrition.caloriesKcal,
          netActivityKcalPerDay: result.calculations.expenditure.calibratedActivityKcalPerDay!,
        });
        state = result.endState;
      }
      validPaths.push(path);
      validStartingIndices.push(startingIndex);
    } catch (error) {
      const reason = invalidReason(error);
      invalidPathReasons[reason] = (invalidPathReasons[reason] ?? 0) + 1;
    }
  }
  if (validPaths.length === 0) throw new Error("all forecast paths were invalid");
  const validFraction = validPaths.length / config.pathCount;
  const futureBehaviorUncertain = input.scenario.mode !== "fixed";
  const degraded = input.initialStateQuality === "degraded"
    || validFraction < 1
    || (futureBehaviorUncertain && input.variabilityEvidence.source === "engineering-fallback");
  const uniqueStartingStateCount = new Set(startingIndices).size;
  const longHorizonLimited = input.horizonDays > config.longHorizonThresholdDays
    && config.pathCount < config.longHorizonRecommendedPathCount;
  const result: ForecastResult = {
    status: degraded || validFraction < config.minimumValidPathFraction ? "degraded" : "ok",
    forecastVersion: FORECAST_ALGORITHM_VERSION,
    modelVersion: input.modelVersion,
    recoveryVersion: input.recoveryVersion,
    sourceFingerprint: input.sourceFingerprint,
    scenarioFingerprint: input.scenarioFingerprint,
    initialStateQuality: input.initialStateQuality,
    horizonDays: input.horizonDays,
    scenarioProvenance: {
      mode: input.scenario.mode,
      nutrition: input.scenario.mode === "fixed" ? "fixed"
        : input.scenario.mode === "recent-behavior" ? "observed-joint-block-resampling"
          : "joint-target-distribution",
      activity: input.scenario.mode === "fixed" ? "fixed-scheduled"
        : input.scenario.mode === "recent-behavior" ? "observed-joint-block-resampling"
          : "stochastic-adherence",
      donorEvidence: input.variabilityEvidence,
    },
    dates: summarizeDates(validPaths, input.startDate, config),
    diagnostics: {
      seed: input.seed,
      generatedPathCount: config.pathCount,
      validPathCount: validPaths.length,
      invalidPathCount: config.pathCount - validPaths.length,
      invalidPathReasons,
      startingParticleCount: particles.length,
      startingParticleResampling: particles.length === 1 ? "none-single-state" : "stratified",
      uncertaintySources: {
        initialState: particles.length > 1,
        futureBehavior: futureBehaviorUncertain,
        measurement: false,
        modelParameters: false,
      },
      ecfPolicy: input.ecfPolicy,
      ecfLimitation: input.ecfPolicy === "hold-ecf"
        ? "Sodium-driven extracellular-fluid forcing is held; latent scale weight may deviate through unmodeled fluid and gut-content effects."
        : null,
      latentPhysiologicalWeightOnly: true,
      current: true,
      numericalQuality: {
        classification: longHorizonLimited ? "limited-long-horizon" : "standard",
        pathCount: config.pathCount,
        recommendedMinimumPathCount: input.horizonDays > config.longHorizonThresholdDays
          ? config.longHorizonRecommendedPathCount : DEFAULT_FORECAST_CONFIG.pathCount,
        pathCountAdequateForHorizon: !longHorizonLimited,
        uniqueStartingStateCount,
        availableStartingStateCount: particles.length,
        outerQuantileRankStandardErrorProbability: Math.sqrt(
          config.lowerProbability * (1 - config.lowerProbability) / config.pathCount,
        ),
        note: "Numerical Monte Carlo quality is separate from physiological predictive uncertainty; intervals are not widened by this diagnostic.",
      },
    },
  };
  const initialPhysiologicalBodyWeightKg = empiricalPredictiveSummary(
    validStartingIndices.map((index) => reconstructBodyWeightKg(particles[index].state)),
  ).median;
  return {
    result,
    initialPhysiologicalBodyWeightKg,
    terminalPhysiologicalBodyWeightSamplesKg: validPaths.map((path) => path.at(-1)!.physiologicalBodyWeightKg),
  };
}

export function runForecast(input: RunForecastInput): ForecastResult {
  return runForecastWithInternalArtifacts(input).result;
}
