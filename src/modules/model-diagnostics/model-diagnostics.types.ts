import type { PersonalizationCalibrationStatus } from "@/model/personalization-calibration";

export type DiagnosticLevel = "good" | "limited" | "blocked" | "informational";

export type DiagnosticGate = {
  id: "offset-observations" | "offset-span" | "full-observations" | "full-span" | "activity-standard-deviation" | "activity-coefficient-of-variation";
  current: number | null;
  required: number;
  unit: "observations" | "days" | "kcal/day-sd" | "coefficient-of-variation";
  met: boolean;
};

export type DiagnosticsDto = {
  episode: { id: number; modelVersion: string; timezone: string; startDate: string; latestModeledDate: string | null; updatedAt: string };
  currentState: {
    level: DiagnosticLevel;
    status: "available" | "awaiting-recovery" | "unavailable";
    source: "deterministic" | "recovered" | "degraded" | null;
    predictedWeightKg: number | null;
    filteredWeightKg: number | null;
    fatMassKg: number | null;
    leanTissueKg: number | null;
    dynamicRmrKcalPerDay: number | null;
    modeledTdeeKcalPerDay: number | null;
  };
  dataContinuity: {
    level: DiagnosticLevel;
    recentWindowDays: 28;
    windowStartDate: string | null;
    windowEndDate: string | null;
    modeledDayCount: number;
    completeDayCount: number;
    incompleteDayCount: number;
    nutrition: { observedDayCount: number; imputedDayCount: number; unresolvedDayCount: number };
    weightObservationCount: number;
    unknownIntervalCount: number;
    unresolvedDayCount: number;
    noWorkIntervalSemantics: "zero-occupational-work-not-missing";
  };
  personalization: {
    level: DiagnosticLevel;
    status: PersonalizationCalibrationStatus;
    accepted: boolean;
    activeParameters: Array<"personal-offset" | "activity-calibration">;
    personalOffsetKcalPerDay: number;
    activityCalibration: number;
    evidence: {
      completeDayCount: number | null;
      observationCount: number | null;
      observationSpanDays: number | null;
      activityStandardDeviationKcalPerDay: number | null;
      activityCoefficientOfVariation: number | null;
    };
    gates: DiagnosticGate[];
    nextGate: DiagnosticGate | null;
    warnings: string[];
  };
  recovery: {
    level: DiagnosticLevel;
    status: "not-required" | "recovered" | "degraded" | "awaiting-observations" | "degenerate" | "stale";
    usableForForecast: boolean;
    observationCount: number | null;
    validParticleFraction: number | null;
    normalizedEffectiveSampleSize: number | null;
    maximumWeight: number | null;
    algorithmVersion: string | null;
    qualityReasons: string[];
    supportWarnings: string[];
  };
  forecastReadiness: {
    level: DiagnosticLevel;
    allowed: boolean;
    initialStateSource: "deterministic" | "recovered" | "degraded" | null;
    reasons: string[];
  };
  limitations: Array<{
    id: "latent-state-not-scale-reading" | "future-behavior-conditional" | "measurement-noise-not-modeled" | "parameter-uncertainty-not-modeled" | "hold-ecf" | "long-horizon-numerical-quality";
    scope: "current-state" | "forecast" | "model";
  }>;
};

export type DiagnosticsEvidence = {
  modeledDayCount: number;
  completeDayCount: number;
  incompleteDayCount: number;
  observedNutritionDayCount: number;
  imputedNutritionDayCount: number;
  unresolvedNutritionDayCount: number;
  weightObservationCount: number;
};
