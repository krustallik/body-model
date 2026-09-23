import { describe, expect, it } from "vitest";
import { addCalendarDays } from "@/modules/model-forecast/forecast-ui";
import {
  buildForecastChartRows,
  formatForecastChartValue,
  forecastChartLabels,
} from "@/modules/model-forecast/forecast-chart-data";
import type { ForecastDateSummary, ForecastResult, PredictiveSummary } from "@/modules/model-forecast/forecast.types";

function summary(overrides: Partial<PredictiveSummary> = {}): PredictiveSummary {
  return { mean: 80, p05: 70, p25: 75, median: 80, p75: 85, p95: 90, ...overrides };
}

function day(date: string, weight = summary()): ForecastDateSummary {
  return {
    date,
    physiologicalBodyWeightKg: weight,
    fatMassKg: summary(),
    leanTissueKg: summary(),
    glycogenKg: summary(),
    glycogenWaterKg: summary(),
    glycogenAssociatedMassKg: summary(),
    extracellularFluidDeviationLiters: summary(),
    adaptiveThermogenesisKcalPerDay: summary(),
    dynamicRmrKcalPerDay: summary(),
    tdeeKcalPerDay: summary(),
    energyIntakeKcal: summary(),
    netActivityKcalPerDay: summary(),
  };
}

function result(dates: ForecastDateSummary[], version: ForecastResult["forecastVersion"] = "bodycast-forecast-v1"): ForecastResult {
  return {
    status: "ok",
    forecastVersion: version,
    modelVersion: "test",
    recoveryVersion: null,
    sourceFingerprint: "source",
    scenarioFingerprint: "scenario",
    initialStateQuality: "deterministic",
    horizonDays: dates.length,
    scenarioProvenance: {
      mode: "fixed", nutrition: "fixed", activity: "fixed-scheduled",
      donorEvidence: { donorDayCount: 20, source: "observed-history", nutritionLogStandardDeviation: 0.1, macroCompositionLogStandardDeviation: 0.1, walkingLogStandardDeviation: 0.1 },
    },
    dates,
    diagnostics: {
      seed: 1, generatedPathCount: 512, validPathCount: 512, invalidPathCount: 0, invalidPathReasons: {},
      startingParticleCount: 1, startingParticleResampling: "none-single-state",
      uncertaintySources: { initialState: false, futureBehavior: true, measurement: false, modelParameters: false },
      ecfPolicy: "hold-ecf", ecfLimitation: null, latentPhysiologicalWeightOnly: true, current: true,
      numericalQuality: { classification: "standard", pathCount: 512, recommendedMinimumPathCount: 512, pathCountAdequateForHorizon: true, uniqueStartingStateCount: 1, availableStartingStateCount: 1, outerQuantileRankStandardErrorProbability: 0.01, note: "test" },
    },
  };
}

describe("forecast chart data", () => {
  it("keeps measured, filtered model estimate, and future forecast as separate date series", () => {
    const rows = buildForecastChartRows({
      metric: "physiologicalBodyWeightKg",
      history: [
        { date: "2026-03-27", modeledWeightKg: 83, filteredWeightKg: 78.6 },
        { date: "2026-03-28", modeledWeightKg: 84, filteredWeightKg: null },
      ],
      observedWeights: [
        { date: "2026-03-27", weightKg: 79.2 },
        { date: "2026-03-29", weightKg: 77.9 },
      ],
      result: result([day("2026-03-29", summary({ mean: 78.4, p05: 77.4, p25: 77.9, median: 78.4, p75: 78.9, p95: 79.4 }))]),
    });
    expect(rows.map((row) => row.date)).toEqual(["2026-03-27", "2026-03-28", "2026-03-29"]);
    expect(rows[0]).toMatchObject({ measuredWeightKg: 79.2, modelEstimateKg: 78.6 });
    expect(rows[1]).toMatchObject({ measuredWeightKg: null, modelEstimateKg: null });
    expect(rows[2]).toMatchObject({ measuredWeightKg: 77.9, futureMedianKg: 78.4, innerIntervalKg: [77.9, 78.9], outerIntervalKg: [77.4, 79.4] });
    expect(new Set(rows.map((row) => row.date)).size).toBe(rows.length);
    expect(rows[0]?.futureMedianKg).toBeNull();
    expect(rows[2]?.modelEstimateKg).toBeNull();
  });

  it("uses engineering bounds without claiming p25–p75 or p05–p95 semantics", () => {
    const labels = forecastChartLabels("en", "physiologicalBodyWeightKg", true);
    const rows = buildForecastChartRows({
      metric: "physiologicalBodyWeightKg", history: [],
      result: result([day("2026-03-29")], "experimental-forecast-v1"),
    });
    expect(rows[0]).toMatchObject({ engineeringRangeKg: [70, 90], innerIntervalKg: null, outerIntervalKg: null, futureMedianKg: 80 });
    expect(labels).toMatchObject({ engineeringRange: "Engineering range", hasQuantileBands: false });
    expect(labels.innerInterval).toBeNull();
    expect(labels.outerInterval).toBeNull();
  });

  it("omits absent optional intervals while retaining a finite median", () => {
    const incomplete = summary({ p25: undefined as unknown as number, p75: undefined as unknown as number });
    const rows = buildForecastChartRows({ metric: "physiologicalBodyWeightKg", history: [], result: result([day("2026-03-29", incomplete)]) });
    expect(rows[0]).toMatchObject({ futureMedianKg: 80, innerIntervalKg: null, outerIntervalKg: [70, 90] });
  });

  it("surfaces an upstream quantile ordering violation instead of sorting it in the UI", () => {
    const broken = summary({ p25: 86, median: 80 });
    expect(() => buildForecastChartRows({ metric: "physiologicalBodyWeightKg", history: [], result: result([day("2026-03-29", broken)]) }))
      .toThrow(/quantiles are out of order.*physiologicalBodyWeightKg.*2026-03-29/i);
  });

  it("preserves date-only strings and supports short and long forecast horizons", () => {
    expect(addCalendarDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(formatForecastChartValue(78.64, "en")).toBe("78.6 kg");
    expect(formatForecastChartValue([77.24, 80.84], "uk")).toBe("77,2–80,8 kg");
    expect(formatForecastChartValue(Number.NaN, "en")).toBeNull();
    for (const horizon of [7, 365]) {
      const dates = Array.from({ length: horizon }, (_, index) => day(addCalendarDays("2026-01-01", index + 1)));
      const rows = buildForecastChartRows({ metric: "physiologicalBodyWeightKg", history: [], result: result(dates) });
      expect(rows).toHaveLength(horizon);
      expect(rows[0]?.date).toBe("2026-01-02");
      expect(rows.at(-1)?.date).toBe(addCalendarDays("2026-01-01", horizon));
    }
  });

  it("uses plain domain labels in Ukrainian and English", () => {
    expect(forecastChartLabels("uk", "physiologicalBodyWeightKg", false)).toMatchObject({
      measuredWeight: "Вага з вагів", modelEstimate: "Оцінка моделі", futureMedian: "Майбутній прогноз · медіана",
      innerInterval: "Інтервал прогнозу 25–75%", outerInterval: "Інтервал прогнозу 5–95%",
    });
    expect(forecastChartLabels("en", "physiologicalBodyWeightKg", false)).toMatchObject({
      measuredWeight: "Measured weight", modelEstimate: "Model estimate", futureMedian: "Future forecast · median",
      innerInterval: "Forecast interval 25–75%", outerInterval: "Forecast interval 5–95%",
    });
  });
});
