import { describe, expect, it } from "vitest";
import { runRecoverySupportValidation } from "../scripts/lib/recovery-support-validation";

describe("deterministic broad-regime recovery support validation", () => {
  it("reports empirical multi-quantity coverage and recovery quality on a small smoke grid", () => {
    const result = runRecoverySupportValidation({
      particleCount: 64,
      baseScenarioCount: 12,
      seeds: [101],
    });

    expect(result.scenarioCount).toBe(12);
    expect(result.supportCases.workerToNoWorkCount).toBeGreaterThan(0);
    expect(result.supportCases.sedentaryToHighActivityCount).toBeGreaterThan(0);

    for (const coverage of Object.values(result.coverage)) {
      expect(coverage.central50).toBeGreaterThan(0);
      expect(coverage.high90).toBeGreaterThan(0);
      expect(coverage.central50).toBeLessThanOrEqual(coverage.high90);
      expect(coverage.high90).toBeLessThanOrEqual(1);
    }

    const statusTotal = Object.values(result.statusCounts).reduce((sum, count) => sum + count, 0);
    expect(statusTotal).toBe(result.scenarioCount);
    expect(result.statusCounts.degenerate ?? 0).toBeLessThan(result.scenarioCount);

    for (const failure of result.failures) {
      expect(Number.isFinite(failure.truth)).toBe(true);
      expect(Number.isFinite(failure.lower)).toBe(true);
      expect(Number.isFinite(failure.upper)).toBe(true);
      expect(failure.truth < failure.lower || failure.truth > failure.upper).toBe(true);
    }

    expect(Object.keys(result.byGap)).toEqual(["7", "14", "30"]);
    for (const gap of Object.values(result.byGap)) {
      expect(gap.runCount).toBeGreaterThan(0);
      expect(Number.isFinite(gap.medianNormalizedEss)).toBe(true);
      expect(gap.medianNormalizedEss).toBeGreaterThan(0);
      expect(gap.minimumValidParticleFraction).toBeGreaterThan(0);
      expect(Number.isFinite(gap.medianWeightIntervalWidthKg)).toBe(true);
      expect(gap.medianWeightIntervalWidthKg).toBeGreaterThan(0);
    }
  }, 45_000);
});
