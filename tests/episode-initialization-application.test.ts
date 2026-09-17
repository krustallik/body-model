import { describe, expect, it } from "vitest";
import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import { prepareEpisodeInitialization } from "@/modules/model-episodes/episode-initialization";
import {
  buildInitializationValidationSources,
  initValidationProfile,
  INIT_VALIDATION_END_DATE,
} from "./initialization-validation-fixtures";

describe("episode initialization personal offset application", () => {
  it("keeps a weak nonzero estimate diagnostic-only and does not apply it operationally", () => {
    const sources = buildInitializationValidationSources({
      personalOffsetKcalPerDay: 150,
    });
    const result = prepareEpisodeInitialization({
      profile: initValidationProfile,
      days: sources.days,
      sources,
      startDate: INIT_VALIDATION_END_DATE,
    });

    expect(result.initializationStatus).toBe("weak");
    expect(result.initializationApplicationReason).toBe("weak-estimate-not-applied");
    expect(result.initialPersonalOffsetKcalPerDay).toBeGreaterThan(50);
    expect(result.appliedPersonalOffsetKcalPerDay).toBe(0);
    expect(result.initializationDiagnostics).toMatchObject({
      application: {
        estimatedOffsetKcalPerDay: result.initialPersonalOffsetKcalPerDay,
        estimatedConfidence: "weak",
        appliedOffsetKcalPerDay: 0,
        reason: "weak-estimate-not-applied",
      },
    });

    // Downstream day that starts from applied offset must match zero-offset expenditure path.
    const macros = result.baseline.fallbackNutrition;
    const withApplied = calculateDynamicDailyExpenditure({
      bodyComposition: result.initialState,
      rmrParameters: result.simulatorParameters.rmrParameters,
      macros,
      outsideWorkWalking: { distanceKm: 5, averageSpeedKmh: 5 },
      strength: { durationMinutes: 30 },
      occupational: { category: null, durationHours: 0 },
      adaptiveThermogenesisKcalPerDay: 0,
      personalization: {
        personalOffsetKcalPerDay: result.appliedPersonalOffsetKcalPerDay ?? 0,
        activityCalibration: 1,
      },
    });
    const withEstimateIfWronglyApplied = calculateDynamicDailyExpenditure({
      bodyComposition: result.initialState,
      rmrParameters: result.simulatorParameters.rmrParameters,
      macros,
      outsideWorkWalking: { distanceKm: 5, averageSpeedKmh: 5 },
      strength: { durationMinutes: 30 },
      occupational: { category: null, durationHours: 0 },
      adaptiveThermogenesisKcalPerDay: 0,
      personalization: {
        personalOffsetKcalPerDay: result.initialPersonalOffsetKcalPerDay ?? 0,
        activityCalibration: 1,
      },
    });
    expect(withApplied.personalizedTdeeKcalPerDay).not.toBeCloseTo(
      withEstimateIfWronglyApplied.personalizedTdeeKcalPerDay!,
      5,
    );
    expect(withApplied.personalOffsetKcalPerDay).toBe(0);
  });

  it("applies a strong estimate operationally when confidence is strong", () => {
    const sources = buildInitializationValidationSources({
      personalOffsetKcalPerDay: 0,
    });
    const result = prepareEpisodeInitialization({
      profile: initValidationProfile,
      days: sources.days,
      sources,
      startDate: INIT_VALIDATION_END_DATE,
    });

    expect(result.initializationStatus).toBe("strong");
    expect(result.initializationApplicationReason).toBe("strong-estimate-applied");
    expect(result.appliedPersonalOffsetKcalPerDay)
      .toBe(result.initialPersonalOffsetKcalPerDay);
    expect(result.initializationDiagnostics).toMatchObject({
      application: {
        estimatedConfidence: "strong",
        appliedOffsetKcalPerDay: result.initialPersonalOffsetKcalPerDay,
        reason: "strong-estimate-applied",
      },
    });
  });

  it("does not invent an operational offset when initialization evidence is insufficient", () => {
    // Persistent water retention → insufficient confidence (not a baseline throw).
    const sources = buildInitializationValidationSources({
      personalOffsetKcalPerDay: 0,
      water: (index) => (index >= 105 ? 1 : 0),
    });
    const result = prepareEpisodeInitialization({
      profile: initValidationProfile,
      days: sources.days,
      sources,
      startDate: INIT_VALIDATION_END_DATE,
    });

    expect(result.initializationStatus).toBe("insufficient");
    expect(result.initializationApplicationReason).toBe("insufficient-not-applied");
    expect(result.appliedPersonalOffsetKcalPerDay).toBe(0);
    const water = (result.initializationDiagnostics as {
      persistentWater?: { preFit?: { detected?: boolean }; postFit?: { detected?: boolean } };
    } | undefined)?.persistentWater;
    expect(water?.preFit?.detected || water?.postFit?.detected).toBe(true);
  });

  it("keeps food-underreporting safeguard from applying a contaminated offset", () => {
    const sources = buildInitializationValidationSources({
      personalOffsetKcalPerDay: 0,
      report: (day) => {
        if (day.caloriesKcal != null) day.caloriesKcal -= 350;
      },
    });
    const result = prepareEpisodeInitialization({
      profile: initValidationProfile,
      days: sources.days,
      sources,
      startDate: INIT_VALIDATION_END_DATE,
    });

    // Contaminated nutrition must not produce a strong operational offset.
    expect(result.initializationStatus).not.toBe("strong");
    expect(result.appliedPersonalOffsetKcalPerDay).toBe(0);
  });
});
