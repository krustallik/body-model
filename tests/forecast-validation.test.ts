import { describe, expect, it } from "vitest";
import {
  calibrationSeed,
  canonicalForecasts,
  runForecastGenerativeValidation,
  runForecastScenarioModeValidation,
  runForecastStressValidation,
  runForecastUncertaintyDecompositionValidation,
} from "../scripts/lib/forecast-validation";

describe("forecast validation harnesses", () => {
  it("keeps exact-model generative coverage separate by horizon and metric", () => {
    const result = runForecastGenerativeValidation({ runsPerHorizon: 2, pathCount: 32 });
    expect(result.kind).toBe("generative-exact-model");
    expect(result.results.map(({ horizon }) => horizon)).toEqual([7, 30, 90]);
    expect(result.results[0].metrics.physiologicalBodyWeightKg.coverage90Wilson95).toHaveLength(2);
    expect(result.expectedFiniteSampleCoverage.outer90).toBeGreaterThan(0.85);
  });

  it("separates forecast and truth PRNG streams deterministically", () => {
    expect(calibrationSeed(1, "forecast")).toBe(calibrationSeed(1, "forecast"));
    expect(calibrationSeed(1, "forecast")).not.toBe(calibrationSeed(1, "truth"));
    expect(new Set(Array.from({ length: 20 }, (_, index) => calibrationSeed(index, "forecast"))).size)
      .toBe(20);
  });

  it("reports initial-only, future-only, combined, fixed, and recent-behavior evidence", () => {
    const decomposition = runForecastUncertaintyDecompositionValidation({ trialsPerCase: 1, pathCount: 16 });
    expect(decomposition.cases.map(({ uncertainty }) => uncertainty))
      .toEqual(["initial-only", "future-only", "combined"]);
    expect(decomposition.cases.every(({ results }) => results.length === 3)).toBe(true);
    const modes = runForecastScenarioModeValidation({ recentTrials: 1, pathCount: 16 });
    expect(modes.fixed.exact).toBe(true);
    expect(modes.recentBehavior.scenarioMode).toBe("recent-behavior");
  });

  it("labels stress results as non-nominal calibration and covers required scenarios", () => {
    const result = runForecastStressValidation();
    expect(result.kind).toBe("stress-not-nominal-calibration");
    expect(result.results).toHaveLength(13);
    expect(result.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "consistent-deficit", "maintenance", "sustained-surplus", "vacation-recovered-initial",
      "degraded-initial", "limited-history",
    ]));
  }, 15_000);

  it("provides the four canonical forecast reports", () => {
    expect(Object.keys(canonicalForecasts())).toEqual([
      "deficit30d", "maintenance90d", "deficitToMaintenance", "recoveredVacation",
    ]);
  });
});
