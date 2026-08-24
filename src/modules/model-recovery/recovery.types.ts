import type { ExpenditurePersonalization } from "@/model/dynamic-daily-expenditure";
import type {
  EcfSimulationPolicy,
  PhysiologicalSimulatorParameters,
  PhysiologicalSimulatorState,
} from "@/model/physiological-simulator";
import type { BuiltSimulationDay } from "@/modules/model-episodes/model-episode.types";
import type { WeightedSummary } from "./recovery-math";

export const RECOVERY_ALGORITHM_VERSION = "bodycast-recovery-v3";

export type RecoveryConfig = {
  particleCount: number;
  donorLookbackDays: number;
  donorRecencyHalfLifeDays: number;
  sameWeekdayMultiplier: number;
  nutritionLogStandardDeviationFloor: number;
  nutritionLogStandardDeviationCeiling: number;
  vacationSpreadMultiplier: number;
  nutritionRegimeLogStandardDeviation: number;
  walkingLogStandardDeviation: number;
  activityExplorationProbability: number;
  activityExplorationLogStandardDeviation: number;
  minimumWalkingReferenceKm: number;
  strengthNoTrainingPriorProbability: number;
  strengthExplorationProbability: number;
  strengthExplorationMedianMinutes: number;
  strengthExplorationLogStandardDeviation: number;
  noOccupationalWorkPriorProbability: number;
  macroCompositionLogStandardDeviation: number;
  adaptiveProposalEnabled: boolean;
  adaptivePilotParticleCount: number;
  adaptivePilotLikelihoodTemperature: number;
  adaptivePriorMixtureWeight: number;
  adaptiveVarianceInflation: number;
  adaptiveVarianceRegularization: number;
  observationDegreesOfFreedom: number;
  observationResidualVarianceKg2: number;
  healthyNormalizedEssThreshold: number;
  degenerateNormalizedEssThreshold: number;
  healthyMaximumWeightThreshold: number;
  degenerateMaximumWeightThreshold: number;
  healthyValidParticleFractionThreshold: number;
  degenerateValidParticleFractionThreshold: number;
  lowerQuantile: number;
  upperQuantile: number;
};

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  particleCount: 512,
  donorLookbackDays: 42,
  donorRecencyHalfLifeDays: 14,
  sameWeekdayMultiplier: 2,
  nutritionLogStandardDeviationFloor: 0.18,
  nutritionLogStandardDeviationCeiling: 0.45,
  vacationSpreadMultiplier: 1.5,
  nutritionRegimeLogStandardDeviation: 0.4,
  walkingLogStandardDeviation: 0.35,
  activityExplorationProbability: 0.2,
  activityExplorationLogStandardDeviation: 0.9,
  minimumWalkingReferenceKm: 3,
  strengthNoTrainingPriorProbability: 0.25,
  strengthExplorationProbability: 0.1,
  strengthExplorationMedianMinutes: 45,
  strengthExplorationLogStandardDeviation: 0.5,
  noOccupationalWorkPriorProbability: 0.25,
  macroCompositionLogStandardDeviation: 0.5,
  adaptiveProposalEnabled: true,
  adaptivePilotParticleCount: 512,
  adaptivePilotLikelihoodTemperature: 1,
  adaptivePriorMixtureWeight: 0.1,
  adaptiveVarianceInflation: 1.5,
  adaptiveVarianceRegularization: 0.05,
  observationDegreesOfFreedom: 4,
  observationResidualVarianceKg2: 0.25,
  healthyNormalizedEssThreshold: 0.5,
  degenerateNormalizedEssThreshold: 0.1,
  healthyMaximumWeightThreshold: 0.05,
  degenerateMaximumWeightThreshold: 0.25,
  healthyValidParticleFractionThreshold: 0.95,
  degenerateValidParticleFractionThreshold: 0.5,
  lowerQuantile: 0.05,
  upperQuantile: 0.95,
};

export type RecoveryStateSummary = {
  bodyWeightKg: WeightedSummary;
  fatMassKg: WeightedSummary;
  leanTissueKg: WeightedSummary;
  glycogenKg: WeightedSummary;
  extracellularFluidDeviationLiters: WeightedSummary;
  adaptiveThermogenesisKcalPerDay: WeightedSummary;
};

export type RecoveryParticle = {
  particleIndex: number;
  logLikelihood: number;
  normalizedWeight: number;
  bodyWeightKg: number;
  state: PhysiologicalSimulatorState;
  proposal: {
    component: "prior" | "adaptive";
    logPriorDensity: number;
    logProposalDensity: number;
    logImportanceCorrection: number;
    regime: {
      nutritionMultiplier: number;
      macroCompositionMultipliers: [number, number, number];
      walkingMultiplier: number;
      useActivityExploration: boolean;
      forceNoStrengthTraining: boolean;
      useStrengthExploration: boolean;
      forceNoOccupationalWork: boolean;
    };
  };
};

export type RecoveryQuality = "recovered" | "degraded" | "degenerate" | "awaiting-observations";

export type TrajectoryRecoveryResult = {
  algorithmVersion: typeof RECOVERY_ALGORITHM_VERSION;
  seed: number;
  status: RecoveryQuality;
  generatedParticleCount: number;
  validParticleCount: number;
  invalidParticleCount: number;
  observationCount: number;
  observationDates: string[];
  effectiveSampleSize: number;
  normalizedEffectiveSampleSize: number;
  maximumWeight: number;
  posteriorSummary: RecoveryStateSummary;
  ensemble: RecoveryParticle[];
  diagnostics: {
    donorDayCount: number;
    unknownDayCount: number;
    invalidProposalReasons: Record<string, number>;
    likelihood: "student-t-physiological-end-weight" | "none-prior-predictive";
    importanceSampling: {
      target: "posterior-over-unknown-histories";
      proposal: "generative-prior" | "defensive-adaptive-regime-mixture";
      priorProposalCorrectionApplied: boolean;
      logWeightEquation: "log_likelihood" | "log_likelihood+log_prior-log_proposal";
    };
    pilot: {
      generatedParticleCount: number;
      validParticleCount: number;
      invalidParticleCount: number;
      normalizedEffectiveSampleSize: number | null;
      maximumWeight: number | null;
    };
    logWeightDistribution: {
      minimum: number;
      median: number;
      maximum: number;
      standardDeviation: number;
    };
    topParticleOrigins: Array<{
      particleIndex: number;
      normalizedWeight: number;
      logLikelihood: number;
      logImportanceCorrection: number;
      component: "prior" | "adaptive";
      nutritionMultiplier: number;
      walkingMultiplier: number;
      useActivityExploration: boolean;
      forceNoOccupationalWork: boolean;
    }>;
    downstreamQualityContract: {
      forecastInitialization: "allowed-with-quality-label" | "prior-predictive-only" | "refuse-degenerate";
      posteriorIntervalsTrustworthy: boolean;
    };
    observationResidualVarianceKg2: number;
    observationResidualVarianceRole: "effective-scale-to-physiology-residual";
    auxiliaryWeightFilterSemantics: "separate-observation-replay-after-physiological-inference";
    validParticleFraction: number;
    qualityReasons: string[];
    supportWarnings: string[];
    biaUsed: false;
    observationAssimilationInsideSimulator: false;
    resamplingUsed: false;
    ecfPolicyLimitation: string | null;
  };
};

export type TrajectoryRecoveryInput = {
  seed: number;
  initialState: PhysiologicalSimulatorState;
  parameters: PhysiologicalSimulatorParameters;
  personalization?: ExpenditurePersonalization;
  ecfPolicy: EcfSimulationPolicy;
  days: readonly BuiltSimulationDay[];
  donorDays: readonly BuiltSimulationDay[];
  config?: Partial<RecoveryConfig>;
};
