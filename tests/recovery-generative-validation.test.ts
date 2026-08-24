import { describe, expect, it } from "vitest";
import { runRecoveryGenerativeValidation } from "../scripts/lib/recovery-generative-validation";

describe("generative recovery calibration infrastructure", () => {
  it("withholds exact prior draws and reports interval uncertainty plus weighted ranks", () => {
    const result = runRecoveryGenerativeValidation({ scenarioCount: 6, particleCount: 64 });
    expect(result.scenarioCount).toBe(6);
    expect(Object.values(result.statusCounts).reduce((sum, count) => sum + count, 0)).toBe(6);
    expect(result.byGap["7"].scenarioCount + result.byGap["14"].scenarioCount).toBe(6);
    for (const quantity of Object.keys(result.coverage) as Array<keyof typeof result.coverage>) {
      expect(result.rankHistograms[quantity]).toHaveLength(10);
      expect(result.rankHistograms[quantity].reduce((sum, count) => sum + count, 0)).toBe(6);
      expect(result.rankKolmogorovDistance[quantity]).toBeGreaterThanOrEqual(0);
      for (const interval of Object.values(result.coverage[quantity])) {
        expect(interval.empirical).toBeGreaterThanOrEqual(0);
        expect(interval.empirical).toBeLessThanOrEqual(1);
        expect(interval.binomial95.lower).toBeLessThanOrEqual(interval.empirical);
        expect(interval.binomial95.upper).toBeGreaterThanOrEqual(interval.empirical);
      }
    }
  }, 15_000);
});
