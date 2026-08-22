import { describe, expect, it } from "vitest";
import { estimateInitialBodyFatPercent } from "@/model/body-composition/bia-estimate";

describe("estimateInitialBodyFatPercent", () => {
  it("returns unavailable when there are no observations", () => {
    expect(estimateInitialBodyFatPercent([])).toBeNull();
  });

  it("ignores missing observations without converting them to zero", () => {
    expect(estimateInitialBodyFatPercent([null, undefined])).toBeNull();
    expect(estimateInitialBodyFatPercent([null, 20, undefined])).toEqual({
      estimatePercent: 20,
      observationCount: 1,
      method: "median",
      spreadPercent: 0,
    });
  });

  it("represents a single observation without inventing confidence", () => {
    expect(estimateInitialBodyFatPercent([18.73])).toEqual({
      estimatePercent: 18.73,
      observationCount: 1,
      method: "median",
      spreadPercent: 0,
    });
  });

  it("calculates the median and MAD for consistent observations", () => {
    const result = estimateInitialBodyFatPercent([18.5, 18.7, 18.6, 18.8, 18.6]);
    expect(result?.estimatePercent).toBe(18.6);
    expect(result?.spreadPercent).toBeCloseTo(0.1, 12);
    expect(result?.observationCount).toBe(5);
  });

  it("handles an odd observation count", () => {
    expect(estimateInitialBodyFatPercent([21, 18, 19])?.estimatePercent).toBe(19);
  });

  it("averages the middle pair for an even observation count", () => {
    expect(estimateInitialBodyFatPercent([22, 18, 20, 24])).toEqual({
      estimatePercent: 21,
      observationCount: 4,
      method: "median",
      spreadPercent: 2,
    });
  });

  it("matches the robust-aggregation golden example", () => {
    const result = estimateInitialBodyFatPercent([18.4, 18.7, 24.9, 18.6, 18.8]);
    expect(result).toEqual({
      estimatePercent: 18.7,
      observationCount: 5,
      method: "median",
      spreadPercent: expect.closeTo(0.1, 12),
    });
  });

  it("is invariant to observation order", () => {
    const forward = estimateInitialBodyFatPercent([18.4, 18.7, 24.9, 18.6, 18.8]);
    const reordered = estimateInitialBodyFatPercent([24.9, 18.8, 18.4, 18.6, 18.7]);
    expect(reordered).toEqual(forward);
  });

  it("keeps its center and spread when an identical set is duplicated", () => {
    const values = [18.4, 18.6, 18.8];
    const original = estimateInitialBodyFatPercent(values);
    const duplicated = estimateInitialBodyFatPercent([...values, ...values]);
    expect(duplicated?.estimatePercent).toBe(original?.estimatePercent);
    expect(duplicated?.spreadPercent).toBe(original?.spreadPercent);
  });

  it("is less affected by one extreme outlier than a simple mean", () => {
    const values = [18.4, 18.7, 24.9, 18.6, 18.8];
    const estimate = estimateInitialBodyFatPercent(values)?.estimatePercent ?? Number.NaN;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const consistentCenter = 18.7;

    expect(Math.abs(estimate - consistentCenter)).toBeLessThan(Math.abs(mean - consistentCenter));
  });

  it("accepts the mathematical boundary percentages", () => {
    expect(estimateInitialBodyFatPercent([0])?.estimatePercent).toBe(0);
    expect(estimateInitialBodyFatPercent([100])?.estimatePercent).toBe(100);
  });

  it.each([-0.01, 100.01])("rejects out-of-range observation %s", (observation) => {
    expect(() => estimateInitialBodyFatPercent([observation])).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite observation %s",
    (observation) => {
      expect(() => estimateInitialBodyFatPercent([observation])).toThrow(TypeError);
    },
  );
});
