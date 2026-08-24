import { describe, expect, it } from "vitest";
import {
  RecoverModelRequestSchema,
  RecoveryConfigSchema,
  RecoveryStatusQuerySchema,
} from "@/modules/model-recovery/model-recovery.schema";

describe("historical recovery request schemas", () => {
  it("accepts the complete configurable engineering surface", () => {
    const config = {
      particleCount: 512, donorLookbackDays: 90, donorRecencyHalfLifeDays: 20,
      sameWeekdayMultiplier: 3, nutritionLogStandardDeviationFloor: 0.1,
      nutritionLogStandardDeviationCeiling: 0.5, vacationSpreadMultiplier: 1.5,
      nutritionRegimeLogStandardDeviation: 0.4, walkingLogStandardDeviation: 0.3,
      activityExplorationProbability: 0.2, activityExplorationLogStandardDeviation: 0.9,
      minimumWalkingReferenceKm: 3, strengthNoTrainingPriorProbability: 0.25,
      strengthExplorationProbability: 0.1, strengthExplorationMedianMinutes: 45,
      strengthExplorationLogStandardDeviation: 0.5, noOccupationalWorkPriorProbability: 0.25,
      macroCompositionLogStandardDeviation: 0.5, adaptiveProposalEnabled: true,
      adaptivePilotParticleCount: 512, adaptivePilotLikelihoodTemperature: 1,
      adaptivePriorMixtureWeight: 0.1, adaptiveVarianceInflation: 1.5,
      adaptiveVarianceRegularization: 0.05, observationDegreesOfFreedom: 4,
      observationResidualVarianceKg2: 0.25, healthyNormalizedEssThreshold: 0.5,
      degenerateNormalizedEssThreshold: 0.1, healthyMaximumWeightThreshold: 0.05,
      degenerateMaximumWeightThreshold: 0.25, healthyValidParticleFractionThreshold: 0.95,
      degenerateValidParticleFractionThreshold: 0.5, lowerQuantile: 0.05, upperQuantile: 0.95,
    };
    expect(RecoveryConfigSchema.parse(config)).toEqual(config);
    expect(() => RecoveryConfigSchema.parse({ ...config, unknownOption: true })).toThrow();
  });

  it.each([
    [{ nutritionLogStandardDeviationFloor: 0.5, nutritionLogStandardDeviationCeiling: 0.1 }, "nutritionLogStandardDeviationCeiling"],
    [{ degenerateNormalizedEssThreshold: 0.5, healthyNormalizedEssThreshold: 0.5 }, "healthyNormalizedEssThreshold"],
    [{ healthyMaximumWeightThreshold: 0.4, degenerateMaximumWeightThreshold: 0.2 }, "degenerateMaximumWeightThreshold"],
    [{ degenerateValidParticleFractionThreshold: 0.9, healthyValidParticleFractionThreshold: 0.8 }, "healthyValidParticleFractionThreshold"],
  ])("rejects incoherent threshold ordering %#", (config, path) => {
    const result = RecoveryConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toContain(path);
  });

  it("defaults the seed and preprocesses an optional positive status episode id", () => {
    expect(RecoverModelRequestSchema.parse({})).toEqual({ seed: 20_260_824 });
    expect(RecoveryStatusQuerySchema.parse({ episodeId: "7" })).toEqual({ episodeId: 7 });
    expect(RecoveryStatusQuerySchema.parse({})).toEqual({});
    expect(() => RecoveryStatusQuerySchema.parse({ episodeId: "7x" })).toThrow();
  });
});
