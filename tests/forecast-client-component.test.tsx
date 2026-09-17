import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }));

import { ForecastClient } from "@/app/forecast/forecast-client";
import {
  forecastReadiness,
  noActiveModelPresentation,
  qualityPresentation,
} from "@/modules/model-forecast/forecast-ui";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";
import type { ModelStatusDto } from "@/modules/model-episodes/model-episode.types";

function modelStatus(overrides: Partial<ModelStatusDto> = {}): ModelStatusDto {
  return {
    episodeId: 1, episodeStartDate: "2026-07-01", latestModeledDate: "2026-08-24", modelVersion: "test",
    calibrationStatus: "fully-calibrated", personalOffsetKcalPerDay: 0, activityCalibration: 1,
    daysModeled: 55, incompleteDays: 0, observedNutritionDays: 50, imputedNutritionDays: 5,
    unbridgeableNutritionDays: 0, currentPredictedWeightKg: 80, currentFilteredWeightKg: 80,
    currentFatMassKg: 16, currentLeanTissueKg: 45, currentDynamicRmrKcalPerDay: 1700,
    currentModeledTdeeKcalPerDay: 2400, continuityStatus: "resolved", lastResolvedDate: "2026-08-24",
    recoveryRequired: false, unknownIntervalCount: 0, unresolvedDayCount: 0, postGapObservedDayCount: 0,
    unknownIntervals: [], ...overrides,
  };
}

function forecastResult(overrides: Partial<ForecastResult> = {}): ForecastResult {
  const summary = { mean: 80, p05: 78, p25: 79, median: 80, p75: 81, p95: 82 };
  return {
    status: "ok", forecastVersion: "bodycast-forecast-v1", modelVersion: "test", recoveryVersion: null,
    sourceFingerprint: "source", scenarioFingerprint: "scenario", initialStateQuality: "deterministic", horizonDays: 1,
    scenarioProvenance: {
      mode: "fixed", nutrition: "fixed", activity: "fixed-scheduled",
      donorEvidence: {
        donorDayCount: 20, source: "observed-history", nutritionLogStandardDeviation: 0.1,
        macroCompositionLogStandardDeviation: 0.1, walkingLogStandardDeviation: 0.1,
      },
    },
    dates: [{
      date: "2026-03-30", physiologicalBodyWeightKg: summary, fatMassKg: summary, leanTissueKg: summary,
      glycogenKg: summary, glycogenWaterKg: summary, glycogenAssociatedMassKg: summary,
      extracellularFluidDeviationLiters: summary, adaptiveThermogenesisKcalPerDay: summary,
      dynamicRmrKcalPerDay: summary, tdeeKcalPerDay: summary, energyIntakeKcal: summary,
      netActivityKcalPerDay: summary,
    }],
    diagnostics: {
      seed: 1, generatedPathCount: 512, validPathCount: 512, invalidPathCount: 0, invalidPathReasons: {},
      startingParticleCount: 1, startingParticleResampling: "none-single-state",
      uncertaintySources: { initialState: false, futureBehavior: false, measurement: false, modelParameters: false },
      ecfPolicy: "hold-ecf", ecfLimitation: null, latentPhysiologicalWeightOnly: true, current: true,
      numericalQuality: {
        classification: "standard", pathCount: 512, recommendedMinimumPathCount: 512,
        pathCountAdequateForHorizon: true, uniqueStartingStateCount: 1, availableStartingStateCount: 1,
        outerQuantileRankStandardErrorProbability: 0.01, note: "ok",
      },
    },
    ...overrides,
  };
}

describe("ForecastClient", () => {
  it("renders the complete initial control surface and honest loading state", () => {
    const html = renderToStaticMarkup(<ForecastClient />);
    expect(html).toContain("See the range, not just a line.");
    expect(html).toContain("As lately");
    expect(html).toContain("Exact daily plan");
    expect(html).toContain("Plan with small drift");
    expect(html).toContain("Calculating possible weight paths");
    expect(html).toContain("href=\"/forecast\"");
    expect(html).toContain("do it here");
  });

  it("keeps start-model wording available for the missing-episode empty state", () => {
    const copy = noActiveModelPresentation("uk");
    expect(copy.primaryAction).toBe("Запустити модель");
    expect(copy.detail).toMatch(/Модель ще не рахувала/);
  });

  it("shows a visible recalculate control on the initial forecast surface", () => {
    const html = renderToStaticMarkup(<ForecastClient />);
    expect(html).toContain("Recalculate model");
    expect(html).toContain("Takes health-table rows, saves calculated days, and automatically estimates state after a data gap when needed.");
  });

  it("exposes readiness and quality copy that the client renders after load", () => {
    const readiness = forecastReadiness({
      status: modelStatus(),
      mode: "recent-behavior",
      donorDayCount: 20,
      successfulForecast: true,
      locale: "en",
    });
    expect(readiness.canForecast).toBe(true);
    expect(readiness.score).toBeGreaterThan(0);
    expect(readiness.title).toMatch(/Forecast/);

    const quality = qualityPresentation(forecastResult(), "fully-calibrated", "en");
    expect(quality.tone).toBe("good");
    expect(quality.title).toBe("Forecast ready");
  });
});
