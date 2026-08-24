import { describe, expect, it } from "vitest";
import {
  SeededRandom,
  effectiveSampleSize,
  logImportanceWeight,
  logGamma,
  normalizeLogWeights,
  studentTLogDensity,
  studentTSample,
  weightedQuantile,
  weightedSummary,
} from "@/modules/model-recovery/recovery-math";

describe("historical recovery probability math", () => {
  it("repeats the same pseudo-random sequence for the same seed", () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);
    expect(Array.from({ length: 20 }, () => first.next()))
      .toEqual(Array.from({ length: 20 }, () => second.next()));
  });

  it("produces a different sequence for a different seed", () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(43);
    expect(Array.from({ length: 5 }, () => first.next()))
      .not.toEqual(Array.from({ length: 5 }, () => second.next()));
  });

  it("normalizes extreme log weights without overflow or underflow", () => {
    const result = normalizeLogWeights([-10_000, -10_001, Number.NEGATIVE_INFINITY]);
    expect(result.weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 14);
    expect(result.weights[0]).toBeCloseTo(0.7310585786300049, 14);
    expect(result.weights[1]).toBeCloseTo(0.2689414213699951, 14);
    expect(result.weights[2]).toBe(0);
    expect(result.logNormalizer).toBeCloseTo(-9999.686738312482, 10);
  });

  it("applies the exact prior-over-proposal importance correction", () => {
    expect(logImportanceWeight({
      logLikelihood: -3,
      logPriorDensity: -5,
      logProposalDensity: -7,
    })).toBe(-1);
    expect(logImportanceWeight({
      logLikelihood: -3,
      logPriorDensity: -5,
      logProposalDensity: -5,
    })).toBe(-3);
  });

  it("reports effective sample size on the original particle scale", () => {
    expect(effectiveSampleSize([0.25, 0.25, 0.25, 0.25])).toBe(4);
    expect(effectiveSampleSize([1, 0, 0, 0])).toBe(1);
    expect(effectiveSampleSize([])).toBe(0);
    expect(effectiveSampleSize([0, 0])).toBe(0);
    expect(effectiveSampleSize([1, -0.1])).toBe(0);
    expect(effectiveSampleSize([1, Number.NaN])).toBe(0);
  });

  it("computes deterministic weighted empirical quantiles and summaries", () => {
    const values = [1, 2, 10];
    const weights = [0.2, 0.6, 0.2];
    expect(weightedQuantile(values, weights, 0.5)).toBe(2);
    expect(weightedSummary({ values, weights })).toEqual({
      mean: 3.4,
      lower: 1,
      median: 2,
      upper: 10,
    });
  });

  it("matches known gamma and standard Student-t density values", () => {
    expect(logGamma(1)).toBeCloseTo(0, 14);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 14);
    expect(logGamma(0.25)).toBeCloseTo(1.2880225246980774, 12);
    expect(Math.exp(studentTLogDensity({
      observation: 0,
      location: 0,
      scale: 1,
      degreesOfFreedom: 4,
    }))).toBeCloseTo(0.375, 14);
  });

  it("gives an isolated outlier a heavier tail than a variance-matched Gaussian", () => {
    const degreesOfFreedom = 4;
    const scale = Math.sqrt((degreesOfFreedom - 2) / degreesOfFreedom);
    const tLogDensity = studentTLogDensity({
      observation: 6,
      location: 0,
      scale,
      degreesOfFreedom,
    });
    const gaussianLogDensity = -0.5 * Math.log(2 * Math.PI) - 0.5 * 6 ** 2;
    expect(tLogDensity).toBeGreaterThan(gaussianLogDensity);
  });

  it("samples the configured Student-t observation model deterministically", () => {
    const first = new SeededRandom(88);
    const second = new SeededRandom(88);
    const sample = (random: SeededRandom) => Array.from({ length: 20 }, () => studentTSample({
      random, location: 77, scale: 0.4, degreesOfFreedom: 4,
    }));
    expect(sample(first)).toEqual(sample(second));
    expect(sample(new SeededRandom(89))).not.toEqual(sample(new SeededRandom(88)));
    expect(() => studentTSample({
      random: new SeededRandom(1), location: 0, scale: 0, degreesOfFreedom: 4,
    })).toThrow(/scale/);
  });

  it("validates invalid probability inputs instead of silently repairing them", () => {
    expect(() => new SeededRandom(-1)).toThrow(/32-bit unsigned/);
    const random = new SeededRandom(1);
    expect(() => random.logNormal(Number.NaN, 1)).toThrow(/mean/);
    expect(() => random.logNormal(0, -1)).toThrow(/standard deviation/);
    expect(() => random.weightedIndex([])).toThrow(/empty/);
    expect(() => random.weightedIndex([1, -1])).toThrow(/non-negative/);
    expect(() => random.weightedIndex([0, 0])).toThrow(/positive/);
    expect(() => logImportanceWeight({
      logLikelihood: Number.NEGATIVE_INFINITY, logPriorDensity: 0, logProposalDensity: 0,
    })).toThrow(/likelihood/);
    expect(() => logGamma(0)).toThrow(/positive/);
    expect(() => normalizeLogWeights([])).toThrow(/empty/);
    expect(() => normalizeLogWeights([Number.NEGATIVE_INFINITY])).toThrow(/finite log weight/);
    expect(() => weightedQuantile([], [], 0.5)).toThrow(/equal, non-empty/);
    expect(() => weightedQuantile([1], [1, 2], 0.5)).toThrow(/equal, non-empty/);
    expect(() => weightedQuantile([1], [1], 2)).toThrow(/between zero and one/);
    expect(() => weightedQuantile([Number.NaN], [1], 0.5)).toThrow(/value/);
    expect(() => weightedQuantile([1], [-1], 0.5)).toThrow(/non-negative/);
    expect(() => weightedQuantile([1], [0], 0.5)).toThrow(/positive/);
    expect(() => weightedSummary({ values: [], weights: [] })).toThrow(/equal, non-empty/);
    expect(() => weightedSummary({ values: [1], weights: [0] })).toThrow(/positive/);
    expect(() => weightedSummary({ values: [Number.NaN], weights: [1] })).toThrow(/value/);
    expect(() => studentTLogDensity({
      observation: 1,
      location: 1,
      scale: 0,
      degreesOfFreedom: 4,
    })).toThrow(/scale/);
    expect(() => studentTLogDensity({
      observation: Number.NaN, location: 1, scale: 1, degreesOfFreedom: 4,
    })).toThrow(/observation/);
    expect(() => studentTLogDensity({
      observation: 1, location: Number.NaN, scale: 1, degreesOfFreedom: 4,
    })).toThrow(/location/);
    expect(() => studentTLogDensity({
      observation: 1, location: 1, scale: 1, degreesOfFreedom: 2,
    })).toThrow(/degrees of freedom/);
  });
});
