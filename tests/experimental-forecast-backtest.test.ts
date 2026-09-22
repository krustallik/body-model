import { describe, expect, it } from "vitest";
import { scoreExperimentalForecastAsOf } from "@/modules/experimental-forecast-v1/backtest";
import type { ExperimentalForecastResult } from "@/modules/experimental-forecast-v1/contracts";

const forecast = {
  status: "ok",
  forecastRevision: "experimental-forecast-v1",
  horizonDays: 2,
  anchorDate: "2026-01-01",
  anchorWeightKg: 80,
  initialStateQuality: "standard",
  initialStateFingerprint: "state",
  scenarioFingerprint: "scenario",
  seed: 1,
  scenario: { mode: "maintain-current" },
  coverage: { eligibleDays: 28, requestedWindowDays: 28 },
  current: { modeledWeightKg: 80, fatMassKg: 16, slowNonFatKg: 64, glycogenWaterKg: 1, transientWaterKg: 0, restingRmrKcalPerDay: 1700, typicalMaintenanceKcalPerDay: 2400, latestExpenditureKcalPerDay: 2400 },
  dates: [
    { date: "2026-01-02", expectedWeightKg: 80, weightChangeFromAnchorKg: { median: 0, lower: -0.2, upper: 0.2, representation: "engineering-range" }, weightKg: { median: 80, lower: 79.8, upper: 80.2, representation: "engineering-range" }, fatMassKg: null, slowNonFatKg: null, glycogenKg: null, glycogenWaterKg: null, transientWaterKg: null, expenditureKcalPerDay: { median: 2400, lower: 2380, upper: 2420, representation: "engineering-range" }, intakeKcal: { median: 2400, lower: 2400, upper: 2400, representation: "engineering-range" }, activityKcalPerDay: { median: 500, lower: 480, upper: 520, representation: "engineering-range" }, energyState: "maintenance", selectedDoseKeys: [], quality: "standard", uncertaintyReasons: [] },
    { date: "2026-01-03", expectedWeightKg: 80.2, weightChangeFromAnchorKg: { median: 0.2, lower: 0, upper: 0.4, representation: "engineering-range" }, weightKg: { median: 80.2, lower: 80, upper: 80.4, representation: "engineering-range" }, fatMassKg: null, slowNonFatKg: null, glycogenKg: null, glycogenWaterKg: null, transientWaterKg: null, expenditureKcalPerDay: { median: 2400, lower: 2380, upper: 2420, representation: "engineering-range" }, intakeKcal: { median: 2400, lower: 2400, upper: 2400, representation: "engineering-range" }, activityKcalPerDay: { median: 500, lower: 480, upper: 520, representation: "engineering-range" }, energyState: "maintenance", selectedDoseKeys: [], quality: "standard", uncertaintyReasons: [] },
  ],
  diagnostics: { generatedPathCount: 1, validPathCount: 1, uncertaintySources: { initialState: false, futureInputs: true, model: true, horizon: true, missingAssumptions: false }, notes: [], },
} as ExperimentalForecastResult;

describe("ExperimentalForecastV1 backtest scoring", () => {
  it("scores only observations after the as-of anchor and reports coverage", () => {
    const score = scoreExperimentalForecastAsOf({
      asOfDate: "2026-01-01",
      forecast,
      observations: [
        { date: "2025-12-31", observedWeightKg: 100 },
        { date: "2026-01-02", observedWeightKg: 80.1 },
        { date: "2026-01-03", observedWeightKg: 80.5 },
      ],
    });
    expect(score.comparedDays).toBe(2);
    expect(score.rangeCoverage).toBe(0.5);
    expect(score.futureLeakageChecked).toBe(true);
  });
});
