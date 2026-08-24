import { describe, expect, it } from "vitest";
import { runRecoverySupportValidation } from "../scripts/lib/recovery-support-validation";

describe("deterministic broad-regime recovery support validation", () => {
  it("reports empirical multi-quantity coverage and every failure without claiming calibration", () => {
    const result = runRecoverySupportValidation({
      particleCount: 128,
      baseScenarioCount: 12,
      seeds: [101, 907],
    });
    expect(result.scenarioCount).toBe(24);
    expect(result.supportCases.workerToNoWorkCount).toBeGreaterThan(0);
    expect(result.supportCases.sedentaryToHighActivityCount).toBeGreaterThan(0);
    for (const coverage of Object.values(result.coverage)) {
      expect(coverage.central50).toBeGreaterThanOrEqual(0);
      expect(coverage.high90).toBeGreaterThan(0);
      expect(coverage.central50).toBeLessThanOrEqual(coverage.high90);
      expect(coverage.high90).toBeLessThanOrEqual(1);
    }
    expect(result.failures.every((failure) => (
      failure.truth < failure.lower || failure.truth > failure.upper
    ))).toBe(true);
    expect(Object.values(result.statusCounts).reduce((sum, count) => sum + count, 0))
      .toBe(result.scenarioCount);
    const expectedHighFailures = Object.values(result.coverage).reduce((sum, coverage) => (
      sum + Math.round(result.scenarioCount * (1 - coverage.high90))
    ), 0);
    expect(result.failures).toHaveLength(expectedHighFailures);
    expect(Object.keys(result.byGap)).toEqual(["7", "14", "30"]);
    expect(Object.values(result.byGap).every(({ runCount, medianNormalizedEss }) => (
      runCount > 0 && medianNormalizedEss > 0
    ))).toBe(true);
  }, 30_000);
});
