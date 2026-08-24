export type TargetDirection = "loss" | "gain" | "maintenance";

export type ProbabilityInterval = {
  confidenceLevel: 0.95;
  lower: number;
  upper: number;
  method: "wilson-score";
};

export type EmpiricalAttainmentProbability = {
  direction: TargetDirection;
  definition: "at-or-below-target" | "at-or-above-target" | "within-target-band";
  probability: number;
  successes: number;
  sampleCount: number;
  monteCarloInterval: ProbabilityInterval;
};

const Z_95 = 1.959963984540054;

/** Score interval for numerical uncertainty in a Monte Carlo Bernoulli proportion. */
export function wilsonScoreInterval(successes: number, sampleCount: number): ProbabilityInterval {
  if (!Number.isInteger(successes) || !Number.isInteger(sampleCount)
      || sampleCount < 1 || successes < 0 || successes > sampleCount) {
    throw new RangeError("successes and sampleCount must define a non-empty binomial sample");
  }
  const proportion = successes / sampleCount;
  const z2 = Z_95 ** 2;
  const denominator = 1 + z2 / sampleCount;
  const center = (proportion + z2 / (2 * sampleCount)) / denominator;
  const halfWidth = Z_95 * Math.sqrt(
    proportion * (1 - proportion) / sampleCount + z2 / (4 * sampleCount ** 2),
  ) / denominator;
  return {
    confidenceLevel: 0.95,
    lower: successes === 0 ? 0 : Math.max(0, center - halfWidth),
    upper: successes === sampleCount ? 1 : Math.min(1, center + halfWidth),
    method: "wilson-score",
  };
}

export function classifyTargetDirection(input: {
  initialWeightKg: number;
  targetWeightKg: number;
  maintenanceToleranceKg: number;
}): TargetDirection {
  if (!Number.isFinite(input.initialWeightKg) || !Number.isFinite(input.targetWeightKg)
      || !Number.isFinite(input.maintenanceToleranceKg) || input.maintenanceToleranceKg < 0) {
    throw new RangeError("weights must be finite and maintenance tolerance must be non-negative");
  }
  if (input.targetWeightKg < input.initialWeightKg - input.maintenanceToleranceKg) return "loss";
  if (input.targetWeightKg > input.initialWeightKg + input.maintenanceToleranceKg) return "gain";
  return "maintenance";
}

/** Equal-weight empirical probability over valid terminal forecast paths. */
export function empiricalTargetAttainment(input: {
  samplesKg: readonly number[];
  initialWeightKg: number;
  targetWeightKg: number;
  maintenanceToleranceKg: number;
}): EmpiricalAttainmentProbability {
  if (input.samplesKg.length === 0 || input.samplesKg.some((sample) => !Number.isFinite(sample))) {
    throw new RangeError("terminal samples must be a non-empty finite sample");
  }
  const direction = classifyTargetDirection(input);
  const attained = (sample: number): boolean => direction === "loss"
    ? sample <= input.targetWeightKg
    : direction === "gain"
      ? sample >= input.targetWeightKg
      : Math.abs(sample - input.targetWeightKg) <= input.maintenanceToleranceKg;
  const successes = input.samplesKg.reduce((count, sample) => count + Number(attained(sample)), 0);
  return {
    direction,
    definition: direction === "loss" ? "at-or-below-target"
      : direction === "gain" ? "at-or-above-target" : "within-target-band",
    probability: successes / input.samplesKg.length,
    successes,
    sampleCount: input.samplesKg.length,
    monteCarloInterval: wilsonScoreInterval(successes, input.samplesKg.length),
  };
}
