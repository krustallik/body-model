import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Personal Active-Energy Calibration Coverage V1.
 *
 * This is a shadow validation contract, not a calorimetry calibration. It
 * records whether repeated personal comparisons are sufficiently compatible to
 * be eligible for later validation. Garmin active kcal is
 * only a diagnostic reference; HR is only timing/coverage context. Neither is
 * converted to kcal or used to alter a point estimate.
 */
export const EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_REVISION =
  "experimental-personal-energy-calibration-v1" as const;

export const EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_PROVENANCE =
  "experimental-heuristic" as const;

/** Engineering gate for repeated, like-for-like shadow comparisons. */
export const EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_PRIORS = {
  minimumCompatibleObservations: 3,
  currentWindowDays: 90,
  compatibleUncertaintyWidthMultiplier: 0.85,
  inadequateCoverageUncertaintyWidthMultiplier: 1.25,
  classification: "engineering-personal-validation-coverage-prior" as const,
} as const;

export type PersonalEnergyCalibrationModalityV1 =
  | "ms100-stepper"
  | "resistance-diary";

export type PersonalEnergyCalibrationTimingQualityV1 =
  | "complete"
  | "partial"
  | "unavailable";

export type PersonalEnergyCalibrationHrCoverageV1 =
  | "contextual"
  | "sparse"
  | "unavailable";

export type PersonalEnergyCalibrationObservationV1 = {
  sessionId: string | number;
  observedAt: string;
  modality: PersonalEnergyCalibrationModalityV1;
  source: string;
  deviceId: string | null;
  timingQuality: PersonalEnergyCalibrationTimingQualityV1;
  hrCoverage: PersonalEnergyCalibrationHrCoverageV1;
  /** Optional diagnostic comparison only; never a criterion label. */
  garminReferenceKcal: number | null;
};

export type ExperimentalPersonalEnergyCalibrationStatusV1 =
  | "missing-evidence"
  | "mixed-modality-or-device"
  | "insufficient-compatible-observations"
  | "insufficient-timing-or-hr-coverage"
  | "repeated-compatible-observations";

export type ExperimentalPersonalEnergyCalibrationResultV1 = {
  contractVersion: typeof EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_REVISION;
  provenance: typeof EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_PROVENANCE;
  supportedDomain: "personal-modality-device-specific-active-energy-shadow-validation";
  availability: "available" | "unavailable";
  status: ExperimentalPersonalEnergyCalibrationStatusV1;
  /** Null means calibration evidence is missing, never zero uncertainty. */
  uncertaintyWidthMultiplier: number | null;
  compatibleObservationCount: number;
  currentObservationCount: number;
  modality: PersonalEnergyCalibrationModalityV1 | null;
  source: string | null;
  deviceId: string | null;
  timingQualityCounts: Record<PersonalEnergyCalibrationTimingQualityV1, number>;
  hrCoverageCounts: Record<PersonalEnergyCalibrationHrCoverageV1, number>;
  garminDiagnosticReferenceCount: number;
  eligibleForCalibration: boolean;
  validatedAccuracyImprovement: false;
  calibrationApplication: "intentionally-not-applied";
  hrUncertainty: {
    role: "context-and-coverage-only-not-kcal-conversion";
    classification: "activity-and-device-specific";
    universalResistanceVsCardioErrorRanking: "intentionally-not-defined";
  };
  reasons: string[];
};

function emptyTimingCounts(): Record<PersonalEnergyCalibrationTimingQualityV1, number> {
  return { complete: 0, partial: 0, unavailable: 0 };
}

function emptyHrCounts(): Record<PersonalEnergyCalibrationHrCoverageV1, number> {
  return { contextual: 0, sparse: 0, unavailable: 0 };
}

function observationKey(observation: PersonalEnergyCalibrationObservationV1): string {
  return [
    observation.modality,
    observation.source.trim(),
    observation.deviceId ?? "missing-device",
    String(observation.sessionId),
  ].join("|");
}

function sortAndDedupeCurrentObservations(input: {
  observations: readonly PersonalEnergyCalibrationObservationV1[];
  asOf: string;
}): PersonalEnergyCalibrationObservationV1[] {
  const asOf = Date.parse(input.asOf);
  if (!Number.isFinite(asOf)) return [];
  const earliest = asOf - EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_PRIORS.currentWindowDays * 86_400_000;
  const byKey = new Map<string, PersonalEnergyCalibrationObservationV1>();
  for (const observation of input.observations) {
    const observedAt = Date.parse(observation.observedAt);
    if (!Number.isFinite(observedAt) || observedAt > asOf || observedAt < earliest) continue;
    if (observation.source.trim() === "" || observation.deviceId === null || observation.deviceId.trim() === "") continue;
    const key = observationKey(observation);
    const previous = byKey.get(key);
    if (previous === undefined || observation.observedAt > previous.observedAt) byKey.set(key, observation);
  }
  return [...byKey.values()].sort((left, right) => (
    left.observedAt.localeCompare(right.observedAt)
    || observationKey(left).localeCompare(observationKey(right))
  ));
}

function baseResult(input: {
  status: ExperimentalPersonalEnergyCalibrationStatusV1;
  observations: readonly PersonalEnergyCalibrationObservationV1[];
  uncertaintyWidthMultiplier: number | null;
  reasons: string[];
}): ExperimentalPersonalEnergyCalibrationResultV1 {
  const timingQualityCounts = emptyTimingCounts();
  const hrCoverageCounts = emptyHrCounts();
  for (const observation of input.observations) {
    timingQualityCounts[observation.timingQuality] += 1;
    hrCoverageCounts[observation.hrCoverage] += 1;
  }
  const modalities = [...new Set(input.observations.map(({ modality }) => modality))];
  const sources = [...new Set(input.observations.map(({ source }) => source.trim()))];
  const devices = [...new Set(input.observations.map(({ deviceId }) => deviceId))];
  const compatible = input.observations.filter((observation) => (
    observation.timingQuality === "complete" && observation.hrCoverage === "contextual"
  ));
  return {
    contractVersion: EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_REVISION,
    provenance: EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_PROVENANCE,
    supportedDomain: "personal-modality-device-specific-active-energy-shadow-validation",
    availability: input.observations.length === 0 ? "unavailable" : "available",
    status: input.status,
    uncertaintyWidthMultiplier: input.uncertaintyWidthMultiplier,
    compatibleObservationCount: compatible.length,
    currentObservationCount: input.observations.length,
    modality: modalities.length === 1 ? modalities[0]! : null,
    source: sources.length === 1 ? sources[0]! : null,
    deviceId: devices.length === 1 ? devices[0]! : null,
    timingQualityCounts,
    hrCoverageCounts,
    garminDiagnosticReferenceCount: input.observations.filter(({ garminReferenceKcal }) => garminReferenceKcal !== null).length,
    eligibleForCalibration: input.status === "repeated-compatible-observations",
    // Metadata consistency is not an indirect-calorimetry oracle. A later,
    // explicit validation contract would be required before shrinking error.
    validatedAccuracyImprovement: false,
    calibrationApplication: "intentionally-not-applied",
    hrUncertainty: {
      role: "context-and-coverage-only-not-kcal-conversion",
      classification: "activity-and-device-specific",
      universalResistanceVsCardioErrorRanking: "intentionally-not-defined",
    },
    reasons: input.reasons,
  };
}

export function evaluateExperimentalPersonalEnergyCalibrationCoverageV1(input: {
  asOf: string;
  observations: readonly PersonalEnergyCalibrationObservationV1[];
}): ExperimentalPersonalEnergyCalibrationResultV1 {
  const observations = sortAndDedupeCurrentObservations(input);
  if (observations.length === 0) {
    return baseResult({
      status: "missing-evidence",
      observations,
      uncertaintyWidthMultiplier: null,
      reasons: ["missing-calibration-evidence-is-not-zero-uncertainty"],
    });
  }

  const modalityDeviceKeys = new Set(observations.map((observation) => (
    `${observation.modality}|${observation.source.trim()}|${observation.deviceId}`
  )));
  if (modalityDeviceKeys.size !== 1) {
    return baseResult({
      status: "mixed-modality-or-device",
      observations,
      uncertaintyWidthMultiplier: 1,
      reasons: [
        "mixed-modality-or-device-observations-do-not-narrow-uncertainty",
        "garmin-reference-diagnostic-only-not-calibration-target",
        "hr-context-coverage-only-not-kcal-conversion",
      ],
    });
  }

  const completeContextual = observations.filter((observation) => (
    observation.timingQuality === "complete" && observation.hrCoverage === "contextual"
  ));
  if (completeContextual.length < EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_PRIORS.minimumCompatibleObservations) {
    const inadequateCoverage = observations.some((observation) => (
      observation.timingQuality !== "complete" || observation.hrCoverage !== "contextual"
    ));
    return baseResult({
      status: inadequateCoverage
        ? "insufficient-timing-or-hr-coverage"
        : "insufficient-compatible-observations",
      observations,
      uncertaintyWidthMultiplier: inadequateCoverage
        ? EXPERIMENTAL_PERSONAL_ENERGY_CALIBRATION_V1_PRIORS.inadequateCoverageUncertaintyWidthMultiplier
        : 1,
      reasons: [
        inadequateCoverage
          ? "poor-timing-or-hr-coverage-blocks-calibration-and-widens-uncertainty"
          : "repeated-compatible-observations-required-before-uncertainty-can-narrow",
        "garmin-reference-diagnostic-only-not-calibration-target",
        "hr-context-coverage-only-not-kcal-conversion",
      ],
    });
  }

  return baseResult({
    status: "repeated-compatible-observations",
    observations,
    uncertaintyWidthMultiplier: 1,
    reasons: [
      "repeated-current-modality-device-compatible-observations-establish-eligibility-only",
      "compatible-metadata-does-not-validate-accuracy-or-narrow-uncertainty",
      "calibration-coverage-only-point-estimate-unchanged",
      "garmin-reference-diagnostic-only-not-calibration-target",
      "hr-context-coverage-only-not-kcal-conversion",
      "resistance-hr-uncertainty-is-device-and-activity-specific-not-universally-ranked",
    ],
  });
}

export function experimentalPersonalEnergyCalibrationCoverageV1Fingerprint(
  result: ExperimentalPersonalEnergyCalibrationResultV1,
): string {
  return stableSha256(result);
}
