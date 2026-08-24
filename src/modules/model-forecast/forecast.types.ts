import type { ExpenditurePersonalization } from "@/model/dynamic-daily-expenditure";
import type {
  EcfSimulationPolicy,
  PhysiologicalSimulatorParameters,
  PhysiologicalSimulatorState,
} from "@/model/physiological-simulator";
import type { OccupationalCategory } from "@/model/occupational-activity";

export const FORECAST_ALGORITHM_VERSION = "bodycast-forecast-v1";

export type ForecastNutrition = {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

export type ForecastOccupationInterval = {
  category: OccupationalCategory;
  durationHours: number;
  breakDurationHours: number | null;
  workWalkingDistanceKm: number | null;
  averageWalkingSpeedKmh: number | null;
};

export type ForecastBehaviorDay = {
  nutrition: ForecastNutrition;
  outsideWorkWalkingDistanceKm: number;
  averageWalkingSpeedKmh: number;
  strengthTrainingMinutes: number;
  occupation: ForecastOccupationInterval[];
};

export type ScheduledBehavior = {
  defaultDay: ForecastBehaviorDay;
  byDate?: Record<string, Partial<ForecastBehaviorDay>>;
  strengthByWeekday?: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, number>>;
};

export type FixedForecastScenario = {
  mode: "fixed";
  schedule: ScheduledBehavior;
};

export type RecentBehaviorForecastScenario = {
  mode: "recent-behavior";
  donorLookbackDays?: number;
  minimumDonorDays?: number;
  blockLengthDays?: number;
};

export type TargetCenteredForecastScenario = {
  mode: "target-centered";
  schedule: ScheduledBehavior;
  variability?: {
    nutritionLogStandardDeviation?: number;
    macroCompositionLogStandardDeviation?: number;
    walkingLogStandardDeviation?: number;
    strengthAdherenceProbability?: number;
    occupationAdherenceProbability?: number;
  };
};

export type ForecastScenario =
  | FixedForecastScenario
  | RecentBehaviorForecastScenario
  | TargetCenteredForecastScenario;

export type ForecastConfig = {
  pathCount: number;
  lowerProbability: number;
  innerLowerProbability: number;
  innerUpperProbability: number;
  upperProbability: number;
  recentDonorLookbackDays: number;
  minimumReliableDonorDays: number;
  blockLengthDays: number;
  fallbackNutritionLogStandardDeviation: number;
  fallbackMacroCompositionLogStandardDeviation: number;
  fallbackWalkingLogStandardDeviation: number;
  strengthAdherenceProbability: number;
  occupationAdherenceProbability: number;
  minimumValidPathFraction: number;
  longHorizonThresholdDays: number;
  longHorizonRecommendedPathCount: number;
};

export const DEFAULT_FORECAST_CONFIG: ForecastConfig = {
  pathCount: 512,
  lowerProbability: 0.05,
  innerLowerProbability: 0.25,
  innerUpperProbability: 0.75,
  upperProbability: 0.95,
  recentDonorLookbackDays: 56,
  minimumReliableDonorDays: 14,
  blockLengthDays: 7,
  fallbackNutritionLogStandardDeviation: 0.25,
  fallbackMacroCompositionLogStandardDeviation: 0.12,
  fallbackWalkingLogStandardDeviation: 0.35,
  strengthAdherenceProbability: 0.8,
  occupationAdherenceProbability: 0.9,
  minimumValidPathFraction: 0.9,
  longHorizonThresholdDays: 180,
  longHorizonRecommendedPathCount: 1_024,
};

export type ForecastInitialParticle = {
  state: PhysiologicalSimulatorState;
  weight: number;
  sourceParticleIndex?: number;
};

export type ForecastInitialStateQuality =
  | "deterministic"
  | "recovered"
  | "degraded"
  | "awaiting"
  | "degenerate";

export type ForecastVariabilityEvidence = {
  donorDayCount: number;
  source: "observed-history" | "engineering-fallback" | "explicit-scenario";
  nutritionLogStandardDeviation: number;
  macroCompositionLogStandardDeviation: number;
  walkingLogStandardDeviation: number;
};

export type PredictiveSummary = {
  mean: number;
  p05: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
};

export type ForecastDateSummary = {
  date: string;
  physiologicalBodyWeightKg: PredictiveSummary;
  fatMassKg: PredictiveSummary;
  leanTissueKg: PredictiveSummary;
  glycogenKg: PredictiveSummary;
  glycogenWaterKg: PredictiveSummary;
  glycogenAssociatedMassKg: PredictiveSummary;
  extracellularFluidDeviationLiters: PredictiveSummary;
  adaptiveThermogenesisKcalPerDay: PredictiveSummary;
  dynamicRmrKcalPerDay: PredictiveSummary;
  tdeeKcalPerDay: PredictiveSummary;
  energyIntakeKcal: PredictiveSummary;
  netActivityKcalPerDay: PredictiveSummary;
};

export type ForecastResult = {
  status: "ok" | "degraded" | "insufficient-scenario-evidence";
  forecastVersion: typeof FORECAST_ALGORITHM_VERSION;
  modelVersion: string;
  recoveryVersion: string | null;
  sourceFingerprint: string;
  scenarioFingerprint: string;
  initialStateQuality: ForecastInitialStateQuality;
  horizonDays: number;
  scenarioProvenance: {
    mode: ForecastScenario["mode"];
    nutrition: "fixed" | "joint-target-distribution" | "observed-joint-block-resampling";
    activity: "fixed-scheduled" | "stochastic-adherence" | "observed-joint-block-resampling";
    donorEvidence: ForecastVariabilityEvidence;
  };
  dates: ForecastDateSummary[];
  diagnostics: {
    seed: number;
    generatedPathCount: number;
    validPathCount: number;
    invalidPathCount: number;
    invalidPathReasons: Record<string, number>;
    startingParticleCount: number;
    startingParticleResampling: "none-single-state" | "stratified";
    uncertaintySources: {
      initialState: boolean;
      futureBehavior: boolean;
      measurement: false;
      modelParameters: false;
    };
    ecfPolicy: EcfSimulationPolicy;
    ecfLimitation: string | null;
    latentPhysiologicalWeightOnly: true;
    current: true;
    numericalQuality: {
      classification: "standard" | "limited-long-horizon";
      pathCount: number;
      recommendedMinimumPathCount: number;
      pathCountAdequateForHorizon: boolean;
      uniqueStartingStateCount: number;
      availableStartingStateCount: number;
      outerQuantileRankStandardErrorProbability: number;
      note: string;
    };
  };
};

export type ForecastBlockedResult = {
  status: "initial-state-unreliable" | "initial-state-unavailable";
  forecastVersion: typeof FORECAST_ALGORITHM_VERSION;
  modelVersion: string;
  recoveryVersion: string | null;
  initialStateQuality: "degenerate" | "awaiting";
  reason: string;
};

export type RunForecastInput = {
  seed: number;
  startDate: string;
  horizonDays: number;
  modelVersion: string;
  recoveryVersion: string | null;
  sourceFingerprint: string;
  scenarioFingerprint: string;
  initialStateQuality: Exclude<ForecastInitialStateQuality, "awaiting" | "degenerate">;
  initialParticles: readonly ForecastInitialParticle[];
  parameters: PhysiologicalSimulatorParameters;
  personalization: ExpenditurePersonalization;
  ecfPolicy: EcfSimulationPolicy;
  scenario: ForecastScenario;
  reliableDonorDays: readonly ForecastBehaviorDay[];
  variabilityEvidence: ForecastVariabilityEvidence;
  config?: Partial<ForecastConfig>;
};
