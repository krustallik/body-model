import { describe, expect, it } from "vitest";
import { runRecoveryGenerativeValidation } from "../scripts/lib/recovery-generative-validation";

describe("generative recovery calibration infrastructure", () => {
  it("withholds exact prior draws and reports usable recovery quality properties", () => {
    const result = runRecoveryGenerativeValidation({ scenarioCount: 4, particleCount: 32 });

    expect(result.scenarioCount).toBe(4);
    expect(Object.values(result.statusCounts).reduce((sum, count) => sum + count, 0)).toBe(4);
    expect(result.statusCounts.degenerate ?? 0).toBeLessThan(result.scenarioCount);
    expect(result.byGap["7"].scenarioCount + result.byGap["14"].scenarioCount).toBe(4);

    expect(Number.isFinite(result.medianNormalizedEss)).toBe(true);
    expect(result.medianNormalizedEss).toBeGreaterThan(0);
    expect(Number.isFinite(result.medianMaximumWeight)).toBe(true);
    expect(result.medianMaximumWeight).toBeGreaterThan(0);
    expect(result.medianMaximumWeight).toBeLessThanOrEqual(1);

    for (const gap of Object.values(result.byGap)) {
      expect(gap.scenarioCount).toBeGreaterThan(0);
      expect(Number.isFinite(gap.medianNormalizedEss)).toBe(true);
      expect(gap.medianNormalizedEss).toBeGreaterThan(0);
      expect(gap.degenerateCount).toBeLessThanOrEqual(gap.scenarioCount);
    }

    for (const quantity of Object.keys(result.coverage) as Array<keyof typeof result.coverage>) {
      const high90 = result.coverage[quantity].high90;
      expect(high90.empirical).toBeGreaterThan(0);
      expect(high90.empirical).toBeLessThanOrEqual(1);
      expect(high90.binomial95.lower).toBeLessThanOrEqual(high90.empirical);
      expect(high90.binomial95.upper).toBeGreaterThanOrEqual(high90.empirical);

      const central50 = result.coverage[quantity].central50;
      expect(central50.empirical).toBeGreaterThanOrEqual(0);
      expect(central50.empirical).toBeLessThanOrEqual(high90.empirical + 1e-12);

      expect(Number.isFinite(result.rankKolmogorovDistance[quantity])).toBe(true);
      expect(result.rankKolmogorovDistance[quantity]).toBeGreaterThanOrEqual(0);
      expect(result.rankKolmogorovDistance[quantity]).toBeLessThanOrEqual(1);

      const histogram = result.rankHistograms[quantity];
      expect(histogram).toHaveLength(10);
      expect(histogram.reduce((sum, count) => sum + count, 0)).toBe(4);
    }
  }, 30_000);
});
