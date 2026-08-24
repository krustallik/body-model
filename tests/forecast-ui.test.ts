import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  blockedPresentation,
  buildForecastRequest,
  chartRows,
  DEFAULT_PLAN,
  formatDate,
  formatValue,
  localCalendarDate,
  qualityPresentation,
  summarizeEndpoint,
} from "@/modules/model-forecast/forecast-ui";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";

function result(overrides: Partial<ForecastResult> = {}): ForecastResult {
  const summary = { mean: 80, p05: 78, p25: 79, median: 80, p75: 81, p95: 82 };
  return {
    status: "ok", forecastVersion: "bodycast-forecast-v1", modelVersion: "test", recoveryVersion: null,
    sourceFingerprint: "source", scenarioFingerprint: "scenario", initialStateQuality: "deterministic", horizonDays: 1,
    scenarioProvenance: { mode: "fixed", nutrition: "fixed", activity: "fixed-scheduled", donorEvidence: { donorDayCount: 20, source: "observed-history", nutritionLogStandardDeviation: .1, macroCompositionLogStandardDeviation: .1, walkingLogStandardDeviation: .1 } },
    dates: [{ date: "2026-03-30", physiologicalBodyWeightKg: summary, fatMassKg: summary, leanTissueKg: summary, glycogenKg: summary, glycogenWaterKg: summary, glycogenAssociatedMassKg: summary, extracellularFluidDeviationLiters: summary, adaptiveThermogenesisKcalPerDay: summary, dynamicRmrKcalPerDay: summary, tdeeKcalPerDay: summary, energyIntakeKcal: summary, netActivityKcalPerDay: summary }],
    diagnostics: { seed: 1, generatedPathCount: 512, validPathCount: 512, invalidPathCount: 0, invalidPathReasons: {}, startingParticleCount: 1, startingParticleResampling: "none-single-state", uncertaintySources: { initialState: false, futureBehavior: false, measurement: false, modelParameters: false }, ecfPolicy: "hold-ecf", ecfLimitation: null, latentPhysiologicalWeightOnly: true, current: true, numericalQuality: { classification: "standard", pathCount: 512, recommendedMinimumPathCount: 512, pathCountAdequateForHorizon: true, uniqueStartingStateCount: 1, availableStartingStateCount: 1, outerQuantileRankStandardErrorProbability: .01, note: "ok" } },
    ...overrides,
  };
}

describe("forecast application helpers", () => {
  it("keeps calendar dates stable across the Europe/Bratislava DST boundary", () => {
    expect(addCalendarDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addCalendarDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addCalendarDays("2026-10-24", 2)).toBe("2026-10-26");
  });

  it("builds the recent-routine request without inventing a manual schedule", () => {
    expect(buildForecastRequest("recent-behavior", 30, DEFAULT_PLAN, "2026-08-24")).toEqual({
      horizonDays: 30, seed: 20_260_824, scenario: { mode: "recent-behavior" },
    });
  });

  it("formats calendar labels and values without applying a hidden local-time offset", () => {
    expect(localCalendarDate(new Date("2026-08-24T22:30:00.000Z"))).toBe("2026-08-25");
    expect(formatDate("2026-08-24", { year: "numeric" })).toMatch(/Aug 24, 2026/);
    expect(formatValue(80.04)).toBe("80 kg");
    expect(formatValue(2234.6, "kcal")).toMatch(/2.?235 kcal/);
  });

  it("maps planned weekday work and a deterministic three-day strength pattern", () => {
    const request = buildForecastRequest("fixed", 7, { ...DEFAULT_PLAN, plannedWork: true }, "2026-08-23");
    expect(request.scenario.mode).toBe("fixed");
    if (request.scenario.mode !== "fixed") throw new Error("wrong mode");
    expect(Object.keys(request.scenario.schedule.byDate ?? {})).toEqual([
      "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
    ]);
    expect(request.scenario.schedule.strengthByWeekday).toMatchObject({ "1": 45, "3": 45, "5": 45, "0": 0 });
  });

  it("builds a flexible target scenario with an empty occupation schedule when work is off", () => {
    const request = buildForecastRequest("target-centered", 7, { ...DEFAULT_PLAN, strengthDaysPerWeek: 7 }, "2026-08-23");
    expect(request.scenario.mode).toBe("target-centered");
    if (request.scenario.mode !== "target-centered") throw new Error("wrong mode");
    expect(request.scenario.schedule.byDate).toEqual({});
    expect(request.scenario.schedule.defaultDay.occupation).toEqual([]);
    expect(Object.values(request.scenario.schedule.strengthByWeekday ?? {})).toEqual([45, 45, 45, 45, 45, 45, 45]);
  });

  it("exposes both nested interval bands without turning them into guarantees", () => {
    const forecast = result();
    expect(summarizeEndpoint(forecast, "physiologicalBodyWeightKg")?.median).toBe(80);
    expect(chartRows(forecast, "physiologicalBodyWeightKg")).toEqual([{ date: "2026-03-30", median: 80, likely: [79, 81], possible: [78, 82] }]);
  });

  it("prioritizes recovery, degraded evidence, and long-horizon numerical warnings", () => {
    expect(qualityPresentation(result()).title).toBe("Forecast ready");
    expect(qualityPresentation(result({ initialStateQuality: "recovered" })).title).toBe("Current state reconstructed");
    expect(qualityPresentation(result({ status: "degraded" })).title).toBe("Forecast has limited evidence");
    const long = result();
    long.diagnostics.numericalQuality.classification = "limited-long-horizon";
    expect(qualityPresentation(long).title).toBe("Long-range precision is limited");
    expect(blockedPresentation({ status: "initial-state-unavailable", forecastVersion: "bodycast-forecast-v1", modelVersion: "test", recoveryVersion: null, initialStateQuality: "awaiting", reason: "The recovery ensemble no longer matches current history and must be rerun before forecasting." }).title).toBe("Model update needed");
    expect(blockedPresentation({ status: "initial-state-unreliable", forecastVersion: "bodycast-forecast-v1", modelVersion: "test", recoveryVersion: null, initialStateQuality: "degenerate", reason: "Too concentrated" }).title).toBe("Current state is too uncertain");
  });
});
