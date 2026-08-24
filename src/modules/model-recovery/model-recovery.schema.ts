import { z } from "zod";

const optionalEpisodeId = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value),
  z.number().int().positive().optional(),
);

export const RecoveryConfigSchema = z.object({
  particleCount: z.number().int().min(32).max(20_000).optional(),
  donorLookbackDays: z.number().int().min(7).max(365).optional(),
  donorRecencyHalfLifeDays: z.number().positive().max(365).optional(),
  sameWeekdayMultiplier: z.number().positive().max(20).optional(),
  nutritionLogStandardDeviationFloor: z.number().positive().max(2).optional(),
  nutritionLogStandardDeviationCeiling: z.number().positive().max(2).optional(),
  vacationSpreadMultiplier: z.number().positive().max(5).optional(),
  nutritionRegimeLogStandardDeviation: z.number().positive().max(2).optional(),
  walkingLogStandardDeviation: z.number().positive().max(2).optional(),
  activityExplorationProbability: z.number().gt(0).lt(1).optional(),
  activityExplorationLogStandardDeviation: z.number().positive().max(3).optional(),
  minimumWalkingReferenceKm: z.number().positive().max(20).optional(),
  strengthNoTrainingPriorProbability: z.number().gt(0).lt(1).optional(),
  strengthExplorationProbability: z.number().gt(0).lt(1).optional(),
  strengthExplorationMedianMinutes: z.number().positive().max(300).optional(),
  strengthExplorationLogStandardDeviation: z.number().positive().max(3).optional(),
  noOccupationalWorkPriorProbability: z.number().gt(0).lt(1).optional(),
  macroCompositionLogStandardDeviation: z.number().positive().max(2).optional(),
  adaptiveProposalEnabled: z.boolean().optional(),
  adaptivePilotParticleCount: z.number().int().min(32).max(20_000).optional(),
  adaptivePilotLikelihoodTemperature: z.number().gt(0).max(1).optional(),
  adaptivePriorMixtureWeight: z.number().gt(0).lt(1).optional(),
  adaptiveVarianceInflation: z.number().positive().max(20).optional(),
  adaptiveVarianceRegularization: z.number().positive().max(2).optional(),
  observationDegreesOfFreedom: z.number().gt(2).max(100).optional(),
  observationResidualVarianceKg2: z.number().positive().max(25).optional(),
  healthyNormalizedEssThreshold: z.number().gt(0).max(1).optional(),
  degenerateNormalizedEssThreshold: z.number().gt(0).lt(1).optional(),
  healthyMaximumWeightThreshold: z.number().gt(0).max(1).optional(),
  degenerateMaximumWeightThreshold: z.number().gt(0).max(1).optional(),
  healthyValidParticleFractionThreshold: z.number().gt(0).max(1).optional(),
  degenerateValidParticleFractionThreshold: z.number().gt(0).lt(1).optional(),
  lowerQuantile: z.number().min(0).lt(0.5).optional(),
  upperQuantile: z.number().gt(0.5).max(1).optional(),
}).strict().refine((config) => (
  config.nutritionLogStandardDeviationFloor === undefined
  || config.nutritionLogStandardDeviationCeiling === undefined
  || config.nutritionLogStandardDeviationFloor <= config.nutritionLogStandardDeviationCeiling
), {
  path: ["nutritionLogStandardDeviationCeiling"],
  message: "must not be smaller than nutritionLogStandardDeviationFloor",
}).refine((config) => (
  config.degenerateNormalizedEssThreshold === undefined
  || config.healthyNormalizedEssThreshold === undefined
  || config.degenerateNormalizedEssThreshold < config.healthyNormalizedEssThreshold
), {
  path: ["healthyNormalizedEssThreshold"],
  message: "must exceed degenerateNormalizedEssThreshold",
}).refine((config) => (
  config.healthyMaximumWeightThreshold === undefined
  || config.degenerateMaximumWeightThreshold === undefined
  || config.healthyMaximumWeightThreshold < config.degenerateMaximumWeightThreshold
), {
  path: ["degenerateMaximumWeightThreshold"],
  message: "must exceed healthyMaximumWeightThreshold",
}).refine((config) => (
  config.degenerateValidParticleFractionThreshold === undefined
  || config.healthyValidParticleFractionThreshold === undefined
  || config.degenerateValidParticleFractionThreshold < config.healthyValidParticleFractionThreshold
), {
  path: ["healthyValidParticleFractionThreshold"],
  message: "must exceed degenerateValidParticleFractionThreshold",
});

export const RecoverModelRequestSchema = z.object({
  episodeId: z.number().int().positive().optional(),
  seed: z.number().int().min(0).max(2_147_483_647).default(20_260_824),
  config: RecoveryConfigSchema.optional(),
}).strict();

export const RecoveryStatusQuerySchema = z.object({ episodeId: optionalEpisodeId }).strict();

export type RecoverModelRequest = z.infer<typeof RecoverModelRequestSchema>;
