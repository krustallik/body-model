import { normalizeLogWeights, SeededRandom } from "./recovery-math";
import type { RecoveryConfig } from "./recovery.types";

export type RecoveryTrajectoryRegime = {
  nutritionMultiplier: number;
  macroCompositionMultipliers: [number, number, number];
  walkingMultiplier: number;
  useActivityExploration: boolean;
  forceNoStrengthTraining: boolean;
  useStrengthExploration: boolean;
  forceNoOccupationalWork: boolean;
};

export type AdaptiveRegimeProposal = {
  logNutritionMean: number;
  logNutritionStandardDeviation: number;
};

export type RegimeProposalDraw = {
  regime: RecoveryTrajectoryRegime;
  component: "prior" | "adaptive";
  logPriorDensity: number;
  logProposalDensity: number;
};

const LOG_TWO_PI = Math.log(2 * Math.PI);

function priorCovariance(config: RecoveryConfig): number[][] {
  const macroVariance = config.macroCompositionLogStandardDeviation ** 2;
  return [
    [config.nutritionRegimeLogStandardDeviation ** 2, 0, 0, 0],
    [0, 2 * macroVariance / 3, -macroVariance / 3, 0],
    [0, -macroVariance / 3, 2 * macroVariance / 3, 0],
    [0, 0, 0, config.activityExplorationLogStandardDeviation ** 2],
  ];
}

function cholesky(matrix: readonly (readonly number[])[]): number[][] {
  const result = matrix.map((row) => row.map(() => 0));
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let value = matrix[row][column];
      for (let inner = 0; inner < column; inner += 1) {
        value -= result[row][inner] * result[column][inner];
      }
      if (row === column) {
        if (!(value > 0) || !Number.isFinite(value)) {
          throw new Error("Recovery regime covariance must be positive definite.");
        }
        result[row][column] = Math.sqrt(value);
      } else {
        result[row][column] = value / result[column][column];
      }
    }
  }
  return result;
}

function sampleMultivariateNormal(
  random: SeededRandom,
  mean: readonly number[],
  lower: readonly (readonly number[])[],
): number[] {
  const normals = mean.map(() => random.normal());
  return mean.map((center, row) => center + lower[row]
    .slice(0, row + 1)
    .reduce((sum, coefficient, column) => sum + coefficient * normals[column], 0));
}

function logMultivariateNormal(
  value: readonly number[],
  mean: readonly number[],
  lower: readonly (readonly number[])[],
): number {
  if (value.length !== mean.length || lower.length !== mean.length) {
    throw new Error("Recovery regime density dimensions must match.");
  }
  const standardized: number[] = [];
  for (let row = 0; row < value.length; row += 1) {
    let residual = value[row] - mean[row];
    for (let column = 0; column < row; column += 1) {
      residual -= lower[row][column] * standardized[column];
    }
    standardized.push(residual / lower[row][row]);
  }
  const logDeterminant = lower.reduce((sum, row, index) => sum + Math.log(row[index]), 0);
  return -0.5 * value.length * LOG_TWO_PI - logDeterminant
    - 0.5 * standardized.reduce((sum, item) => sum + item ** 2, 0);
}

function regimeVector(regime: RecoveryTrajectoryRegime): number[] {
  return [
    Math.log(regime.nutritionMultiplier),
    Math.log(regime.macroCompositionMultipliers[0]),
    Math.log(regime.macroCompositionMultipliers[1]),
    Math.log(regime.walkingMultiplier),
  ];
}

function vectorRegime(
  value: readonly number[],
  modes: Pick<RecoveryTrajectoryRegime,
    "useActivityExploration" | "forceNoStrengthTraining"
    | "useStrengthExploration" | "forceNoOccupationalWork">,
): RecoveryTrajectoryRegime {
  return {
    nutritionMultiplier: Math.exp(value[0]),
    macroCompositionMultipliers: [
      Math.exp(value[1]), Math.exp(value[2]), Math.exp(-value[1] - value[2]),
    ],
    walkingMultiplier: Math.exp(value[3]),
    ...modes,
  };
}

function logBernoulli(value: boolean, probability: number): number {
  if (value) return probability === 0 ? Number.NEGATIVE_INFINITY : Math.log(probability);
  return probability === 1 ? Number.NEGATIVE_INFINITY : Math.log1p(-probability);
}

function logModeDensity(
  regime: RecoveryTrajectoryRegime,
  probabilities: ReturnType<typeof priorProbabilities>,
): number {
  return logBernoulli(regime.useActivityExploration, probabilities.useActivityExploration)
    + logBernoulli(regime.forceNoStrengthTraining, probabilities.forceNoStrengthTraining)
    + logBernoulli(regime.useStrengthExploration, probabilities.useStrengthExploration)
    + logBernoulli(regime.forceNoOccupationalWork, probabilities.forceNoOccupationalWork);
}

function priorProbabilities(config: RecoveryConfig): {
  useActivityExploration: number;
  forceNoStrengthTraining: number;
  useStrengthExploration: number;
  forceNoOccupationalWork: number;
} {
  return {
    useActivityExploration: config.activityExplorationProbability,
    forceNoStrengthTraining: config.strengthNoTrainingPriorProbability,
    useStrengthExploration: config.strengthExplorationProbability,
    forceNoOccupationalWork: config.noOccupationalWorkPriorProbability,
  };
}

export function samplePriorRecoveryRegime(
  random: SeededRandom,
  config: RecoveryConfig,
): RecoveryTrajectoryRegime {
  const continuous = sampleMultivariateNormal(random, [0, 0, 0, 0], cholesky(priorCovariance(config)));
  return vectorRegime(continuous, {
    useActivityExploration: random.next() < config.activityExplorationProbability,
    forceNoStrengthTraining: random.next() < config.strengthNoTrainingPriorProbability,
    useStrengthExploration: random.next() < config.strengthExplorationProbability,
    forceNoOccupationalWork: random.next() < config.noOccupationalWorkPriorProbability,
  });
}

export function logPriorRecoveryRegimeDensity(
  regime: RecoveryTrajectoryRegime,
  config: RecoveryConfig,
): number {
  return logMultivariateNormal(
    regimeVector(regime), [0, 0, 0, 0], cholesky(priorCovariance(config)),
  ) + logModeDensity(regime, priorProbabilities(config));
}

export function fitAdaptiveRegimeProposal(input: {
  regimes: readonly RecoveryTrajectoryRegime[];
  logLikelihoods: readonly number[];
  config: RecoveryConfig;
}): AdaptiveRegimeProposal {
  if (input.regimes.length === 0 || input.regimes.length !== input.logLikelihoods.length) {
    throw new Error("Adaptive recovery fitting requires matching non-empty pilot samples.");
  }
  const tempered = input.logLikelihoods.map((value) => (
    value * input.config.adaptivePilotLikelihoodTemperature
  ));
  const weights = normalizeLogWeights(tempered).weights;
  const logNutrition = input.regimes.map((regime) => Math.log(regime.nutritionMultiplier));
  const logNutritionMean = logNutrition.reduce((sum, value, index) => (
    sum + weights[index] * value
  ), 0);
  const empiricalVariance = logNutrition.reduce((sum, value, index) => (
    sum + weights[index] * (value - logNutritionMean) ** 2
  ), 0);
  return {
    logNutritionMean,
    logNutritionStandardDeviation: Math.sqrt(
      input.config.adaptiveVarianceInflation * empiricalVariance
      + input.config.adaptiveVarianceRegularization
        * input.config.nutritionRegimeLogStandardDeviation ** 2,
    ),
  };
}

function logNormalDensity(value: number, mean: number, standardDeviation: number): number {
  const standardized = (value - mean) / standardDeviation;
  return -0.5 * LOG_TWO_PI - Math.log(standardDeviation) - 0.5 * standardized ** 2;
}

export function logAdaptiveRecoveryRegimeDensity(
  regime: RecoveryTrajectoryRegime,
  proposal: AdaptiveRegimeProposal,
): number {
  return logNormalDensity(
    Math.log(regime.nutritionMultiplier),
    proposal.logNutritionMean,
    proposal.logNutritionStandardDeviation,
  );
}

function logMixture(first: number, second: number): number {
  const maximum = Math.max(first, second);
  return maximum + Math.log(Math.exp(first - maximum) + Math.exp(second - maximum));
}

export function evaluateDefensiveRegimeMixture(input: {
  regime: RecoveryTrajectoryRegime;
  adaptive: AdaptiveRegimeProposal;
  config: RecoveryConfig;
}): Pick<RegimeProposalDraw, "logPriorDensity" | "logProposalDensity"> {
  const logPriorDensity = logPriorRecoveryRegimeDensity(input.regime, input.config);
  const logPriorNutritionDensity = logNormalDensity(
    Math.log(input.regime.nutritionMultiplier),
    0,
    input.config.nutritionRegimeLogStandardDeviation,
  );
  const logAdaptiveDensity = logAdaptiveRecoveryRegimeDensity(input.regime, input.adaptive);
  const logNutritionMixtureDensity = logMixture(
    Math.log(input.config.adaptivePriorMixtureWeight) + logPriorNutritionDensity,
    Math.log1p(-input.config.adaptivePriorMixtureWeight) + logAdaptiveDensity,
  );
  return {
    logPriorDensity,
    logProposalDensity: logPriorDensity - logPriorNutritionDensity
      + logNutritionMixtureDensity,
  };
}

export function sampleDefensiveRegimeMixture(input: {
  random: SeededRandom;
  adaptive: AdaptiveRegimeProposal;
  config: RecoveryConfig;
}): RegimeProposalDraw {
  const fromPrior = input.random.next() < input.config.adaptivePriorMixtureWeight;
  const regime = samplePriorRecoveryRegime(input.random, input.config);
  if (!fromPrior) {
    regime.nutritionMultiplier = Math.exp(
      input.adaptive.logNutritionMean
      + input.adaptive.logNutritionStandardDeviation * input.random.normal(),
    );
  }
  return {
    regime,
    component: fromPrior ? "prior" : "adaptive",
    ...evaluateDefensiveRegimeMixture({ regime, adaptive: input.adaptive, config: input.config }),
  };
}
