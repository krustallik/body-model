import { describe, expect, it } from "vitest";
import { buildDiagnosticsDto, personalizationDiagnostics } from "@/modules/model-diagnostics/model-diagnostics";
import type { ModelStatusDto, PersistedEpisode } from "@/modules/model-episodes/model-episode.types";

const baseCalibration = {
  completeDayCount: 60, observationCount: 35, observationSpanDays: 56,
  activityStandardDeviationKcalPerDay: 75, activityCoefficientOfVariation: 0.2,
  warnings: [],
};

describe("personalization diagnostic boundary matrix", () => {
  it.each([
    [19, 28, 75, 0.2, "offset-observations", false],
    [20, 27, 75, 0.2, "offset-span", false],
    [20, 28, 75, 0.2, "offset-observations", true],
    [34, 56, 75, 0.2, "full-observations", false],
    [35, 55, 75, 0.2, "full-span", false],
    [35, 56, 74.99, 0.2, "activity-standard-deviation", false],
    [35, 56, 75, 0.2, "activity-standard-deviation", true],
    [35, 56, 80, 0.199, "activity-coefficient-of-variation", false],
  ] as const)("evaluates exact conservative gates", (count, span, sd, cv, gateId, met) => {
    const result = personalizationDiagnostics({
      status: "insufficient-history", personalOffsetKcalPerDay: 0, activityCalibration: 1,
      diagnostics: { ...baseCalibration, observationCount: count, observationSpanDays: span, activityStandardDeviationKcalPerDay: sd, activityCoefficientOfVariation: cv },
    });
    expect(result.gates.find((gate) => gate.id === gateId)?.met).toBe(met);
  });

  it.each([
    ["insufficient-history", [], false], ["invalid-history", [], false],
    ["defaults-retained", [], false], ["offset-only", ["personal-offset"], true],
    ["fully-calibrated", ["personal-offset", "activity-calibration"], true],
  ] as const)("maps accepted parameters for %s", (status, activeParameters, accepted) => {
    expect(personalizationDiagnostics({ status, personalOffsetKcalPerDay: 10, activityCalibration: 1.1, diagnostics: baseCalibration }))
      .toMatchObject({ status, activeParameters, accepted });
  });

  it("reads the persisted scientificCalibration envelope", () => {
    const result = personalizationDiagnostics({
      status: "offset-only", personalOffsetKcalPerDay: -120, activityCalibration: 1,
      diagnostics: { nutritionProvenance: { observedNutritionDays: 60 }, scientificCalibration: baseCalibration },
    });
    expect(result.evidence).toMatchObject({ observationCount: 35, observationSpanDays: 56, activityStandardDeviationKcalPerDay: 75 });
    expect(result.gates.every((gate) => gate.met)).toBe(true);
  });
});

function episode(): PersistedEpisode {
  return {
    id: 1, profileId: 1, startDate: "2026-01-01", timezone: "Europe/Bratislava", modelVersion: "test", active: true,
    ecfPolicy: "hold-ecf", baselineEnergyIntakeKcalPerDay: 2200, baselineCarbIntakeG: 250, baselineNutritionFallback: null,
    nutritionMaxBridgeDays: 2, baselineWindowStartDate: "2025-12-01", baselineWindowEndDate: "2025-12-31",
    baselineNutritionDayCount: 28, baselineWeightObservationCount: 20, baselineWeightTrendKgPerWeek: 0,
    baselineWeightTrendPercentPerWeek: 0,
    initialState: { fatMassKg: 20, leanTissueKg: 55, glycogenKg: 0.5, baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0, adaptiveThermogenesisKcalPerDay: 0, weightFilterState: { estimatedWeightKg: 75, varianceKg2: 0.1 } },
    simulatorParameters: { rmrParameters: { fatMassKcalPerKgPerDay: 4.5, leanTissueKcalPerKgPerDay: 21.6, calibrationOffsetKcalPerDay: 0 }, glycogenParameters: { baselineCarbIntakeG: 250, baselineCarbEnergyKcalPerDay: 1000, initialGlycogenKg: 0.5, quadraticOutflowKcalPerKgSquaredPerDay: 4000 }, baselineEnergyIntakeKcalPerDay: 2200, adaptiveThermogenesis: { beta: 0.14, timeConstantDays: 14 }, weightFilter: { processNoiseVarianceKg2PerDay: 0.01, measurementNoiseVarianceKg2: 0.25 } },
    initialRmrKcalPerDay: 1600, personalOffsetKcalPerDay: 0, activityCalibration: 1,
    calibrationStatus: "insufficient-history", calibrationDiagnostics: baseCalibration,
    latestModeledDate: "2026-08-25", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-08-25T12:00:00.000Z",
  };
}

function status(recoveryRequired: boolean): ModelStatusDto {
  return {
    episodeId: 1, episodeStartDate: "2026-01-01", latestModeledDate: "2026-08-25", modelVersion: "test",
    calibrationStatus: "insufficient-history", personalOffsetKcalPerDay: 0, activityCalibration: 1,
    daysModeled: 28, incompleteDays: 0, observedNutritionDays: 20, imputedNutritionDays: 8, unbridgeableNutritionDays: 0,
    currentPredictedWeightKg: 74, currentFilteredWeightKg: 74.2, currentFatMassKg: 19, currentLeanTissueKg: 54.5,
    currentDynamicRmrKcalPerDay: 1580, currentModeledTdeeKcalPerDay: 2300,
    continuityStatus: recoveryRequired ? "awaiting-recovery" : "resolved", lastResolvedDate: "2026-08-25", recoveryRequired,
    unknownIntervalCount: recoveryRequired ? 1 : 0, unresolvedDayCount: recoveryRequired ? 3 : 0, postGapObservedDayCount: 2, unknownIntervals: [],
  };
}

const evidence = { modeledDayCount: 28, completeDayCount: 27, incompleteDayCount: 1, observedNutritionDayCount: 20, imputedNutritionDayCount: 7, unresolvedNutritionDayCount: 1, weightObservationCount: 0 };

describe("multidimensional diagnostic composition", () => {
  it.each([
    ["not-required", false, null, true, "deterministic"],
    ["recovered", true, "recovered", true, "recovered"],
    ["degraded", true, "degraded", true, "degraded"],
    ["awaiting-observations", true, null, false, null],
    ["degenerate", true, "degenerate", false, null],
    ["stale", true, "recovered", false, null],
  ] as const)("handles recovery state %s", (expected, required, rawStatus, allowed, source) => {
    const recovery = rawStatus ? {
      algorithmVersion: "recovery-v1", status: rawStatus, observationCount: 3,
      validParticleCount: 90, generatedParticleCount: 100, normalizedEffectiveSampleSize: 0.6,
      maximumWeight: 0.03, diagnostics: { validParticleFraction: 0.9, qualityReasons: [], supportWarnings: [] },
      posteriorSummary: { bodyWeightKg: { median: 72.5 }, fatMassKg: { median: 18.1 }, leanTissueKg: { median: 53.2 } },
      stale: expected === "stale",
    } : null;
    const result = buildDiagnosticsDto({ episode: episode(), status: status(required), evidence, windowStartDate: "2026-07-29", recovery });
    expect(result.recovery.status).toBe(expected);
    expect(result.forecastReadiness).toMatchObject({ allowed, initialStateSource: source });
    if (source === "recovered" || source === "degraded") {
      expect(result.currentState).toMatchObject({ predictedWeightKg: 72.5, fatMassKg: 18.1, leanTissueKg: 53.2, dynamicRmrKcalPerDay: null, modeledTdeeKcalPerDay: null });
    }
    if (!allowed) expect(result.currentState.predictedWeightKg).toBeNull();
  });

  it("keeps missing weight and absent work intervals separate from day completeness", () => {
    const result = buildDiagnosticsDto({ episode: episode(), status: status(false), evidence: { ...evidence, completeDayCount: 28, incompleteDayCount: 0, unresolvedNutritionDayCount: 0 }, windowStartDate: "2026-07-29", recovery: null });
    expect(result.dataContinuity).toMatchObject({ weightObservationCount: 0, completeDayCount: 28, noWorkIntervalSemantics: "zero-occupational-work-not-missing" });
  });

  it("reports observed, imputed, and unresolved nutrition independently", () => {
    const result = buildDiagnosticsDto({ episode: episode(), status: status(false), evidence, windowStartDate: "2026-07-29", recovery: null });
    expect(result.dataContinuity.nutrition).toEqual({ observedDayCount: 20, imputedDayCount: 7, unresolvedDayCount: 1 });
    expect(result).not.toHaveProperty("confidenceScore");
  });

  it("marks incomplete activity evidence as limited even when nutrition is resolved", () => {
    const result = buildDiagnosticsDto({ episode: episode(), status: status(false), evidence: { ...evidence, unresolvedNutritionDayCount: 0 }, windowStartDate: "2026-07-29", recovery: null });
    expect(result.dataContinuity.level).toBe("limited");
  });
});
