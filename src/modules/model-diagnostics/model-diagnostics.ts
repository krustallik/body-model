import {
  DEFAULT_PERSONALIZATION_CALIBRATION_CONFIG as calibrationConfig,
  type CalibrationDiagnostics,
  type PersonalizationCalibrationStatus,
} from "@/model/personalization-calibration";
import type { ModelStatusDto, PersistedEpisode } from "@/modules/model-episodes/model-episode.types";
import type { DiagnosticsDto, DiagnosticsEvidence, DiagnosticGate } from "./model-diagnostics.types";

type RecoverySnapshot = {
  algorithmVersion: string;
  status: string;
  observationCount: number;
  validParticleCount: number;
  generatedParticleCount: number;
  normalizedEffectiveSampleSize: number;
  maximumWeight: number;
  diagnostics: unknown;
  posteriorSummary: unknown;
  stale: boolean;
} | null;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function calibrationDiagnostics(value: unknown): Partial<CalibrationDiagnostics> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const candidate = record.scientificCalibration;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Partial<CalibrationDiagnostics>
    : record as Partial<CalibrationDiagnostics>;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function personalizationDiagnostics(input: {
  status: PersonalizationCalibrationStatus;
  personalOffsetKcalPerDay: number;
  activityCalibration: number;
  diagnostics: unknown;
}): DiagnosticsDto["personalization"] {
  const d = calibrationDiagnostics(input.diagnostics);
  const observationCount = finite(d.observationCount);
  const observationSpanDays = finite(d.observationSpanDays);
  const activitySd = finite(d.activityStandardDeviationKcalPerDay);
  const activityCv = finite(d.activityCoefficientOfVariation);
  const gates: DiagnosticGate[] = [
    { id: "offset-observations", current: observationCount, required: calibrationConfig.minOffsetObservationCount, unit: "observations", met: observationCount !== null && observationCount >= calibrationConfig.minOffsetObservationCount },
    { id: "offset-span", current: observationSpanDays, required: calibrationConfig.minOffsetObservationSpanDays, unit: "days", met: observationSpanDays !== null && observationSpanDays >= calibrationConfig.minOffsetObservationSpanDays },
    { id: "full-observations", current: observationCount, required: calibrationConfig.minFullObservationCount, unit: "observations", met: observationCount !== null && observationCount >= calibrationConfig.minFullObservationCount },
    { id: "full-span", current: observationSpanDays, required: calibrationConfig.minFullObservationSpanDays, unit: "days", met: observationSpanDays !== null && observationSpanDays >= calibrationConfig.minFullObservationSpanDays },
    { id: "activity-standard-deviation", current: activitySd, required: calibrationConfig.minActivityStandardDeviationKcalPerDay, unit: "kcal/day-sd", met: activitySd !== null && activitySd >= calibrationConfig.minActivityStandardDeviationKcalPerDay },
    { id: "activity-coefficient-of-variation", current: activityCv, required: calibrationConfig.minActivityCoefficientOfVariation, unit: "coefficient-of-variation", met: activityCv !== null && activityCv >= calibrationConfig.minActivityCoefficientOfVariation },
  ];
  const activeParameters: DiagnosticsDto["personalization"]["activeParameters"] = [];
  if (input.status === "offset-only" || input.status === "fully-calibrated") activeParameters.push("personal-offset");
  if (input.status === "fully-calibrated") activeParameters.push("activity-calibration");
  const accepted = input.status === "offset-only" || input.status === "fully-calibrated";
  const offsetReady = gates[0].met && gates[1].met;
  const nextGate = !offsetReady ? gates.find((gate) => !gate.met && (gate.id === "offset-observations" || gate.id === "offset-span")) ?? null
    : gates.find((gate) => !gate.met && (gate.id === "full-observations" || gate.id === "full-span" || gate.id.startsWith("activity-"))) ?? null;
  return {
    level: accepted ? "good" : input.status === "invalid-history" ? "blocked" : "limited",
    status: input.status,
    accepted,
    activeParameters,
    personalOffsetKcalPerDay: input.personalOffsetKcalPerDay,
    activityCalibration: input.activityCalibration,
    evidence: {
      completeDayCount: finite(d.completeDayCount), observationCount, observationSpanDays,
      activityStandardDeviationKcalPerDay: activitySd,
      activityCoefficientOfVariation: activityCv,
    },
    gates,
    nextGate,
    warnings: stringList(d.warnings),
  };
}

function recoveryDiagnostics(value: unknown): { validParticleFraction: number | null; qualityReasons: string[]; supportWarnings: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { validParticleFraction: null, qualityReasons: [], supportWarnings: [] };
  const d = value as Record<string, unknown>;
  return { validParticleFraction: finite(d.validParticleFraction), qualityReasons: stringList(d.qualityReasons), supportWarnings: stringList(d.supportWarnings) };
}

function posteriorMedians(value: unknown): { bodyWeightKg: number | null; fatMassKg: number | null; leanTissueKg: number | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { bodyWeightKg: null, fatMassKg: null, leanTissueKg: null };
  const summary = value as Record<string, unknown>;
  const median = (key: string) => {
    const item = summary[key];
    return item && typeof item === "object" && !Array.isArray(item)
      ? finite((item as Record<string, unknown>).median) : null;
  };
  return { bodyWeightKg: median("bodyWeightKg"), fatMassKg: median("fatMassKg"), leanTissueKg: median("leanTissueKg") };
}

export function buildDiagnosticsDto(input: {
  episode: PersistedEpisode;
  status: ModelStatusDto;
  evidence: DiagnosticsEvidence;
  windowStartDate: string | null;
  recovery: RecoverySnapshot;
}): DiagnosticsDto {
  const { episode, status, evidence } = input;
  const needsRecovery = status.recoveryRequired;
  const recoveryDetails = recoveryDiagnostics(input.recovery?.diagnostics);
  const recoveryStatus: DiagnosticsDto["recovery"]["status"] = !needsRecovery ? "not-required"
    : !input.recovery ? "awaiting-observations"
      : input.recovery.stale ? "stale"
        : input.recovery.status === "recovered" || input.recovery.status === "degraded" || input.recovery.status === "degenerate" || input.recovery.status === "awaiting-observations"
          ? input.recovery.status : "degenerate";
  const usable = recoveryStatus === "not-required" || recoveryStatus === "recovered" || recoveryStatus === "degraded";
  const source = recoveryStatus === "not-required" ? "deterministic"
    : recoveryStatus === "recovered" ? "recovered"
      : recoveryStatus === "degraded" ? "degraded" : null;
  const recoveredState = posteriorMedians(input.recovery?.posteriorSummary);
  const currentWeightKg = source === "deterministic" ? status.currentPredictedWeightKg
    : source === "recovered" || source === "degraded" ? recoveredState.bodyWeightKg : null;
  const currentFatMassKg = source === "deterministic" ? status.currentFatMassKg
    : source === "recovered" || source === "degraded" ? recoveredState.fatMassKg : null;
  const currentLeanTissueKg = source === "deterministic" ? status.currentLeanTissueKg
    : source === "recovered" || source === "degraded" ? recoveredState.leanTissueKg : null;
  const hasCurrentState = usable && currentWeightKg !== null && status.latestModeledDate !== null;
  const currentStatus = !hasCurrentState ? "unavailable" : usable ? "available" : "awaiting-recovery";
  const personalization = personalizationDiagnostics({
    status: episode.calibrationStatus,
    personalOffsetKcalPerDay: episode.personalOffsetKcalPerDay,
    activityCalibration: episode.activityCalibration,
    diagnostics: episode.calibrationDiagnostics,
  });
  return {
    episode: { id: episode.id, modelVersion: episode.modelVersion, timezone: episode.timezone, startDate: episode.startDate, latestModeledDate: episode.latestModeledDate, updatedAt: episode.updatedAt },
    currentState: {
      level: currentStatus === "available" ? (source === "degraded" ? "limited" : "good") : "blocked",
      status: currentStatus, source,
      predictedWeightKg: hasCurrentState ? currentWeightKg : null,
      filteredWeightKg: source === "deterministic" && hasCurrentState ? status.currentFilteredWeightKg : null,
      fatMassKg: hasCurrentState ? currentFatMassKg : null,
      leanTissueKg: hasCurrentState ? currentLeanTissueKg : null,
      dynamicRmrKcalPerDay: source === "deterministic" && hasCurrentState ? status.currentDynamicRmrKcalPerDay : null,
      modeledTdeeKcalPerDay: source === "deterministic" && hasCurrentState ? status.currentModeledTdeeKcalPerDay : null,
    },
    dataContinuity: {
      level: status.unknownIntervalCount > 0 || evidence.unresolvedNutritionDayCount > 0 || evidence.incompleteDayCount > 0 ? "limited" : "good",
      recentWindowDays: 28, windowStartDate: input.windowStartDate, windowEndDate: episode.latestModeledDate,
      modeledDayCount: evidence.modeledDayCount, completeDayCount: evidence.completeDayCount, incompleteDayCount: evidence.incompleteDayCount,
      nutrition: { observedDayCount: evidence.observedNutritionDayCount, imputedDayCount: evidence.imputedNutritionDayCount, unresolvedDayCount: evidence.unresolvedNutritionDayCount },
      weightObservationCount: evidence.weightObservationCount,
      unknownIntervalCount: status.unknownIntervalCount, unresolvedDayCount: status.unresolvedDayCount,
      noWorkIntervalSemantics: "zero-occupational-work-not-missing",
    },
    personalization,
    recovery: {
      level: recoveryStatus === "not-required" || recoveryStatus === "recovered" ? "good" : recoveryStatus === "degraded" ? "limited" : "blocked",
      status: recoveryStatus, usableForForecast: usable,
      observationCount: input.recovery?.observationCount ?? null,
      validParticleFraction: recoveryDetails.validParticleFraction,
      normalizedEffectiveSampleSize: input.recovery?.normalizedEffectiveSampleSize ?? null,
      maximumWeight: input.recovery?.maximumWeight ?? null,
      algorithmVersion: input.recovery?.algorithmVersion ?? null,
      qualityReasons: recoveryDetails.qualityReasons, supportWarnings: recoveryDetails.supportWarnings,
    },
    forecastReadiness: {
      level: usable && hasCurrentState ? (source === "degraded" ? "limited" : "good") : "blocked",
      allowed: usable && hasCurrentState, initialStateSource: usable && hasCurrentState ? source : null,
      reasons: !hasCurrentState ? ["current-state-unavailable"] : !usable ? [`recovery-${recoveryStatus}`] : source === "degraded" ? ["degraded-recovery"] : [],
    },
    limitations: [
      { id: "latent-state-not-scale-reading", scope: "current-state" },
      { id: "future-behavior-conditional", scope: "forecast" },
      { id: "measurement-noise-not-modeled", scope: "forecast" },
      { id: "parameter-uncertainty-not-modeled", scope: "forecast" },
      { id: "hold-ecf", scope: "model" },
      { id: "long-horizon-numerical-quality", scope: "forecast" },
    ],
  };
}
