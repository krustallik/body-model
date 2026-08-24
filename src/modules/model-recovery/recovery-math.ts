export type NormalizedWeights = {
  weights: number[];
  logNormalizer: number;
};

export type WeightedSummary = {
  mean: number;
  lower: number;
  median: number;
  upper: number;
};

export function logImportanceWeight(input: {
  logLikelihood: number;
  logPriorDensity: number;
  logProposalDensity: number;
}): number {
  assertFinite(input.logLikelihood, "Log likelihood");
  assertFinite(input.logPriorDensity, "Log prior density");
  assertFinite(input.logProposalDensity, "Log proposal density");
  return input.logLikelihood + input.logPriorDensity - input.logProposalDensity;
}

const UINT32_SCALE = 4_294_967_296;
const HALF_LOG_TWO_PI = 0.5 * Math.log(2 * Math.PI);
const LANCZOS_COEFFICIENTS = [
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
] as const;

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite.`);
  }
}

export class SeededRandom {
  private state: number;
  private spareNormal: number | null = null;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new Error("Recovery seed must be a 32-bit unsigned integer.");
    }
    this.state = seed >>> 0;
  }

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_SCALE;
  }

  normal(): number {
    if (this.spareNormal !== null) {
      const result = this.spareNormal;
      this.spareNormal = null;
      return result;
    }

    const radius = Math.sqrt(-2 * Math.log(Math.max(this.next(), Number.EPSILON)));
    const angle = 2 * Math.PI * this.next();
    this.spareNormal = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  }

  logNormal(logMean: number, logStandardDeviation: number): number {
    assertFinite(logMean, "Log-normal mean");
    if (!Number.isFinite(logStandardDeviation) || logStandardDeviation < 0) {
      throw new Error("Log-normal standard deviation must be finite and non-negative.");
    }
    return Math.exp(logMean + logStandardDeviation * this.normal());
  }

  weightedIndex(weights: readonly number[]): number {
    if (weights.length === 0) {
      throw new Error("Cannot sample an empty weighted collection.");
    }
    const total = weights.reduce((sum, weight) => {
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error("Sampling weights must be finite and non-negative.");
      }
      return sum + weight;
    }, 0);
    if (!(total > 0)) {
      throw new Error("At least one sampling weight must be positive.");
    }

    const target = this.next() * total;
    let cumulative = 0;
    for (let index = 0; index < weights.length; index += 1) {
      cumulative += weights[index];
      if (target < cumulative) return index;
    }
    return weights.length - 1;
  }
}

export function logGamma(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Gamma input must be finite and positive.");
  }
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }

  const shifted = value - 1;
  let series = 0.99999999999980993;
  for (let index = 0; index < LANCZOS_COEFFICIENTS.length; index += 1) {
    series += LANCZOS_COEFFICIENTS[index] / (shifted + index + 1);
  }
  const tail = shifted + LANCZOS_COEFFICIENTS.length - 0.5;
  return HALF_LOG_TWO_PI + (shifted + 0.5) * Math.log(tail) - tail + Math.log(series);
}

export function studentTLogDensity(input: {
  observation: number;
  location: number;
  scale: number;
  degreesOfFreedom: number;
}): number {
  const { observation, location, scale, degreesOfFreedom } = input;
  assertFinite(observation, "Student-t observation");
  assertFinite(location, "Student-t location");
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("Student-t scale must be finite and positive.");
  }
  if (!Number.isFinite(degreesOfFreedom) || degreesOfFreedom <= 2) {
    throw new Error("Student-t degrees of freedom must be finite and greater than two.");
  }

  const standardizedSquared = ((observation - location) / scale) ** 2;
  return logGamma((degreesOfFreedom + 1) / 2)
    - logGamma(degreesOfFreedom / 2)
    - 0.5 * Math.log(degreesOfFreedom * Math.PI)
    - Math.log(scale)
    - ((degreesOfFreedom + 1) / 2) * Math.log1p(standardizedSquared / degreesOfFreedom);
}

function gammaSample(random: SeededRandom, shape: number): number {
  if (!Number.isFinite(shape) || shape <= 0) {
    throw new Error("Gamma sample shape must be finite and positive.");
  }
  if (shape < 1) {
    return gammaSample(random, shape + 1) * random.next() ** (1 / shape);
  }
  const adjustment = shape - 1 / 3;
  const scale = 1 / Math.sqrt(9 * adjustment);
  for (;;) {
    const normal = random.normal();
    const base = 1 + scale * normal;
    if (base <= 0) continue;
    const candidate = base ** 3;
    const uniform = random.next();
    if (uniform < 1 - 0.0331 * normal ** 4
        || Math.log(uniform) < 0.5 * normal ** 2
          + adjustment * (1 - candidate + Math.log(candidate))) {
      return adjustment * candidate;
    }
  }
}

export function studentTSample(input: {
  random: SeededRandom;
  location: number;
  scale: number;
  degreesOfFreedom: number;
}): number {
  assertFinite(input.location, "Student-t location");
  if (!Number.isFinite(input.scale) || input.scale <= 0) {
    throw new Error("Student-t scale must be finite and positive.");
  }
  if (!Number.isFinite(input.degreesOfFreedom) || input.degreesOfFreedom <= 2) {
    throw new Error("Student-t degrees of freedom must be finite and greater than two.");
  }
  const chiSquared = 2 * gammaSample(input.random, input.degreesOfFreedom / 2);
  return input.location + input.scale * input.random.normal()
    / Math.sqrt(chiSquared / input.degreesOfFreedom);
}

export function normalizeLogWeights(logWeights: readonly number[]): NormalizedWeights {
  if (logWeights.length === 0) {
    throw new Error("Cannot normalize an empty weight collection.");
  }
  const maximum = Math.max(...logWeights);
  if (!Number.isFinite(maximum)) {
    throw new Error("At least one recovery trajectory must have a finite log weight.");
  }
  const shifted = logWeights.map((value) => Number.isFinite(value) ? Math.exp(value - maximum) : 0);
  const shiftedSum = shifted.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(shiftedSum) || !(shiftedSum > 0)) {
    throw new Error("Recovery trajectory weights could not be normalized.");
  }
  return {
    weights: shifted.map((value) => value / shiftedSum),
    logNormalizer: maximum + Math.log(shiftedSum),
  };
}

export function effectiveSampleSize(weights: readonly number[]): number {
  if (weights.length === 0) return 0;
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) return 0;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || !(total > 0)) return 0;
  const squaredNormalizedSum = weights.reduce((sum, weight) => sum + (weight / total) ** 2, 0);
  return squaredNormalizedSum > 0 ? 1 / squaredNormalizedSum : 0;
}

export function weightedQuantile(
  values: readonly number[],
  weights: readonly number[],
  probability: number,
): number {
  if (values.length === 0 || values.length !== weights.length) {
    throw new Error("Weighted quantiles require equal, non-empty value and weight collections.");
  }
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("Quantile probability must be between zero and one.");
  }
  const entries = values.map((value, index) => {
    assertFinite(value, "Weighted value");
    const weight = weights[index];
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error("Quantile weights must be finite and non-negative.");
    }
    return { value, weight };
  }).sort((left, right) => left.value - right.value);
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(total > 0)) throw new Error("At least one quantile weight must be positive.");
  const target = probability * total;
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    if (cumulative >= target) return entry.value;
  }
  return entries.at(-1)!.value;
}

export function weightedSummary(input: {
  values: readonly number[];
  weights: readonly number[];
  lowerProbability?: number;
  upperProbability?: number;
}): WeightedSummary {
  const { values, weights, lowerProbability = 0.05, upperProbability = 0.95 } = input;
  if (values.length === 0 || values.length !== weights.length) {
    throw new Error("Weighted summaries require equal, non-empty value and weight collections.");
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || !(total > 0)) {
    throw new Error("At least one summary weight must be positive.");
  }
  const mean = values.reduce((sum, value, index) => {
    assertFinite(value, "Summary value");
    return sum + value * weights[index];
  }, 0) / total;
  return {
    mean,
    lower: weightedQuantile(values, weights, lowerProbability),
    median: weightedQuantile(values, weights, 0.5),
    upper: weightedQuantile(values, weights, upperProbability),
  };
}
