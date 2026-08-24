import { describe, expect, it } from "vitest";
import { SeededRandom } from "@/modules/model-recovery/recovery-math";
import {
  evaluateDefensiveRegimeMixture,
  fitAdaptiveRegimeProposal,
  logPriorRecoveryRegimeDensity,
  sampleDefensiveRegimeMixture,
  samplePriorRecoveryRegime,
  type AdaptiveRegimeProposal,
  type RecoveryTrajectoryRegime,
} from "@/modules/model-recovery/recovery-regime-proposal";
import { DEFAULT_RECOVERY_CONFIG } from "@/modules/model-recovery/recovery.types";

function normalLogDensity(value: number, mean: number, standardDeviation: number) {
  return -0.5 * Math.log(2 * Math.PI) - Math.log(standardDeviation)
    - 0.5 * ((value - mean) / standardDeviation) ** 2;
}

describe("adaptive persistent recovery-regime proposal", () => {
  it("has exact prior/proposal identity for prior draws", () => {
    const regime = samplePriorRecoveryRegime(new SeededRandom(10), DEFAULT_RECOVERY_CONFIG);
    const density = logPriorRecoveryRegimeDensity(regime, DEFAULT_RECOVERY_CONFIG);
    expect(Number.isFinite(density)).toBe(true);
    expect(density - density).toBe(0);
    expect(Math.log(regime.macroCompositionMultipliers.reduce((product, value) => (
      product * value
    ), 1))).toBeCloseTo(0, 12);
  });

  it("fits the weighted log-nutrition marginal with documented regularization", () => {
    const base = samplePriorRecoveryRegime(new SeededRandom(11), DEFAULT_RECOVERY_CONFIG);
    const regimes = [-1, 1].map((logNutrition) => ({
      ...base, nutritionMultiplier: Math.exp(logNutrition),
    }));
    const proposal = fitAdaptiveRegimeProposal({
      regimes, logLikelihoods: [0, 0], config: DEFAULT_RECOVERY_CONFIG,
    });
    expect(proposal.logNutritionMean).toBeCloseTo(0, 14);
    expect(proposal.logNutritionStandardDeviation ** 2).toBeCloseTo(
      DEFAULT_RECOVERY_CONFIG.adaptiveVarianceInflation
        + DEFAULT_RECOVERY_CONFIG.adaptiveVarianceRegularization
          * DEFAULT_RECOVERY_CONFIG.nutritionRegimeLogStandardDeviation ** 2,
      14,
    );
  });

  it("evaluates the defensive mixture and exact p/q correction analytically", () => {
    const regime: RecoveryTrajectoryRegime = {
      ...samplePriorRecoveryRegime(new SeededRandom(12), DEFAULT_RECOVERY_CONFIG),
      nutritionMultiplier: Math.exp(0.1),
    };
    const adaptive: AdaptiveRegimeProposal = {
      logNutritionMean: 0.2, logNutritionStandardDeviation: 0.3,
    };
    const density = evaluateDefensiveRegimeMixture({
      regime, adaptive, config: DEFAULT_RECOVERY_CONFIG,
    });
    const logPriorNutrition = normalLogDensity(
      0.1, 0, DEFAULT_RECOVERY_CONFIG.nutritionRegimeLogStandardDeviation,
    );
    const logAdaptiveNutrition = normalLogDensity(0.1, 0.2, 0.3);
    const alpha = DEFAULT_RECOVERY_CONFIG.adaptivePriorMixtureWeight;
    const expectedLogProposalNutrition = Math.log(
      alpha * Math.exp(logPriorNutrition) + (1 - alpha) * Math.exp(logAdaptiveNutrition),
    );
    expect(density.logPriorDensity - density.logProposalDensity)
      .toBeCloseTo(logPriorNutrition - expectedLogProposalNutrition, 12);
  });

  it("samples the declared prior-mixture floor while preserving structural modes", () => {
    const random = new SeededRandom(13);
    const adaptive: AdaptiveRegimeProposal = {
      logNutritionMean: 1, logNutritionStandardDeviation: 0.1,
    };
    const draws = Array.from({ length: 2_000 }, () => sampleDefensiveRegimeMixture({
      random, adaptive, config: DEFAULT_RECOVERY_CONFIG,
    }));
    const priorFraction = draws.filter(({ component }) => component === "prior").length
      / draws.length;
    expect(priorFraction).toBeGreaterThan(0.07);
    expect(priorFraction).toBeLessThan(0.13);
    expect(draws.some(({ regime }) => regime.forceNoOccupationalWork)).toBe(true);
    expect(draws.some(({ regime }) => regime.useActivityExploration)).toBe(true);
    expect(draws.every(({ logPriorDensity, logProposalDensity }) => (
      Number.isFinite(logPriorDensity) && Number.isFinite(logProposalDensity)
    ))).toBe(true);
  });
});
