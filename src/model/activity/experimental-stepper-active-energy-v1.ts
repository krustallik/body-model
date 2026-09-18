import {
  WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
  type WorkoutRecoveryEnergyScientificDecision,
} from "@/model/activity/workout-energy";
import type { StepperEquipmentAssignmentV7 } from "@/model/activity/personal-stepper-reference-v7";
import type { WorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Stepper Active Energy V1 (shadow / EXPERIMENTAL only).
 *
 * MS100 / Stair Climbing mechanical vertical-work heuristic. Garmin active kcal
 * is optional reference only. HR is coverage/context only. No fixed MET
 * fallback, no HR→kcal formula, no Garmin→truth calibration, no EPOC add-on.
 */
export const EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION =
  "experimental-stepper-active-energy-v1" as const;

export const EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_PROVENANCE =
  "experimental-heuristic" as const;

/** Physical constant. */
export const STANDARD_GRAVITY_M_PER_S2 = 9.80665 as const;

/** Thermochemical kcal conversion (J). */
export const JOULES_PER_THERMOCHEMICAL_KCAL = 4184 as const;

/**
 * ENGINEERING PRIOR — effective vertical rise per attributed step on Domyos
 * MS100 fixed configuration. Not a personally validated machine metrology.
 * Wide band covers unknown exact stroke and non-machine steps in bracket gaps.
 */
export const ENGINEERING_MS100_STEP_HEIGHT_M_V1 = {
  pointMeters: 0.16,
  lowerMeters: 0.12,
  upperMeters: 0.22,
  classification: "engineering-machine-geometry-prior" as const,
  scientificNote:
    "MS100 fixed configuration implies a bounded step rise; endpoints are engineering, not calibrated stroke metrology.",
} as const;

/**
 * ENGINEERING PRIOR — net metabolic efficiency for positive vertical external
 * work → active (above-rest) kcal. Stair VO2 anchors (E-G01–E-G03) motivate a
 * positive climbing cost; η endpoints are not personal efficiency oracles.
 *
 * Lower η → higher kcal; upper η → lower kcal.
 */
export const ENGINEERING_NET_VERTICAL_WORK_EFFICIENCY_V1 = {
  pointFraction: 0.2,
  /** Worse efficiency (higher energy cost). */
  lowerFraction: 0.12,
  /** Better efficiency (lower energy cost). */
  upperFraction: 0.28,
  classification: "engineering-efficiency-prior" as const,
  evidenceIds: ["E-G01", "E-G02", "E-G03"] as const,
  scientificNote:
    "Efficiency converts external m·g·h work into metabolic active kcal; wide band replaces fake MET precision.",
} as const;

export type ExperimentalStepperActiveEnergyAvailabilityV1 =
  | "available"
  | "unavailable";

export type ExperimentalStepperActiveEnergyUnavailableReasonV1 =
  | "not-stair-climbing-workout"
  | "no-ms100-equipment-assignment"
  | "missing-body-mass"
  | "missing-bracketed-step-evidence"
  | "missing-duration-for-rate-protocol"
  | "non-finite-inputs";

export type ExperimentalStepperActiveEnergyFeaturesV1 = {
  workoutId: number;
  durationMinutes: number | null;
  bodyMassKg: number | null;
  bracketedStepDelta: number | null;
  derivedStepRatePerMinute: number | null;
  equipmentMachineFamily: "DOMYOS_MS100" | null;
  equipmentConfiguration: "fixed" | null;
  stepHeightPointM: number;
  efficiencyPointFraction: number;
  hrCoverage: "unavailable" | "sparse" | "contextual";
  hrSampleCount: number;
  garminReferenceKcal: number | null;
  mechanicalWorkPointJ: number | null;
  rejectedMethods: readonly [
    "fixed-met-fallback",
    "hr-to-kcal-formula",
    "garmin-truth-calibration",
    "epoc-recovery-add-on",
  ];
};

export type ExperimentalStepperActiveEnergyResultV1 = {
  contractVersion: typeof EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION;
  provenance: typeof EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_PROVENANCE;
  supportedDomain: "ms100-stair-stepper-shadow-only";
  availability: ExperimentalStepperActiveEnergyAvailabilityV1;
  estimatedActiveKcal: number | null;
  lowerBoundKcal: number | null;
  upperBoundKcal: number | null;
  unavailableReason: ExperimentalStepperActiveEnergyUnavailableReasonV1 | null;
  features: ExperimentalStepperActiveEnergyFeaturesV1;
  reasons: string[];
  recoveryEnergy: WorkoutRecoveryEnergyScientificDecision;
  /** Optional diagnostic only — never an estimation target. */
  garminReferenceKcal: number | null;
};

function rejectedMethods(): ExperimentalStepperActiveEnergyFeaturesV1["rejectedMethods"] {
  return [
    "fixed-met-fallback",
    "hr-to-kcal-formula",
    "garmin-truth-calibration",
    "epoc-recovery-add-on",
  ] as const;
}

function hrCoverageFromEvidence(
  heartRate: WorkoutStepperEvidenceV7["workoutEnergy"]["heartRate"],
): Pick<ExperimentalStepperActiveEnergyFeaturesV1, "hrCoverage" | "hrSampleCount"> {
  if (heartRate.availability === "unavailable") {
    return { hrCoverage: "unavailable", hrSampleCount: 0 };
  }
  const count = heartRate.sampleCount;
  return {
    hrSampleCount: count,
    hrCoverage: count === 0 ? "unavailable" : count < 3 ? "sparse" : "contextual",
  };
}

function clampNonnegativeFinite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("stepper active energy values must be finite");
  }
  const clamped = Math.max(0, value);
  return Object.is(clamped, -0) ? 0 : clamped;
}

/**
 * Mechanical vertical external work (J) for attributed steps.
 * Physical: W = m · g · h · N
 */
export function mechanicalVerticalWorkJoulesV1(input: {
  bodyMassKg: number;
  stepHeightM: number;
  stepCount: number;
}): number {
  if (!(input.bodyMassKg > 0) || !(input.stepHeightM > 0) || !(input.stepCount >= 0)) {
    throw new RangeError("mechanical work inputs must be positive mass/height and nonnegative steps");
  }
  return input.bodyMassKg * STANDARD_GRAVITY_M_PER_S2 * input.stepHeightM * input.stepCount;
}

/**
 * Active kcal from external vertical work and net efficiency.
 * E_kcal = W / η / 4184
 */
export function activeKcalFromMechanicalWorkV1(input: {
  mechanicalWorkJ: number;
  efficiencyFraction: number;
}): number {
  if (!(input.efficiencyFraction > 0) || !(input.efficiencyFraction < 1)) {
    throw new RangeError("efficiency fraction must be in (0, 1)");
  }
  return clampNonnegativeFinite(
    input.mechanicalWorkJ / input.efficiencyFraction / JOULES_PER_THERMOCHEMICAL_KCAL,
  );
}

function baseFeatures(input: {
  workout: WorkoutStepperEvidenceV7;
  bodyMassKg: number | null;
  equipment: StepperEquipmentAssignmentV7 | null;
}): ExperimentalStepperActiveEnergyFeaturesV1 {
  const energy = input.workout.workoutEnergy;
  const steps = input.workout.bracketedSteps;
  const hr = hrCoverageFromEvidence(energy.heartRate);
  const garmin = energy.deviceEnergy.availability === "available"
    ? energy.deviceEnergy.valueKcal
    : null;
  return {
    workoutId: energy.workoutId,
    durationMinutes: energy.durationMinutes,
    bodyMassKg: input.bodyMassKg,
    bracketedStepDelta: steps.availability === "available" ? steps.derivedStepDelta.value : null,
    derivedStepRatePerMinute: steps.availability === "available"
      ? steps.derivedStepRatePerMinute?.value ?? null
      : null,
    equipmentMachineFamily: input.equipment?.machineFamily ?? null,
    equipmentConfiguration: input.equipment?.configuration ?? null,
    stepHeightPointM: ENGINEERING_MS100_STEP_HEIGHT_M_V1.pointMeters,
    efficiencyPointFraction: ENGINEERING_NET_VERTICAL_WORK_EFFICIENCY_V1.pointFraction,
    ...hr,
    garminReferenceKcal: garmin,
    mechanicalWorkPointJ: null,
    rejectedMethods: rejectedMethods(),
  };
}

function unavailable(input: {
  reason: ExperimentalStepperActiveEnergyUnavailableReasonV1;
  reasons: string[];
  features: ExperimentalStepperActiveEnergyFeaturesV1;
}): ExperimentalStepperActiveEnergyResultV1 {
  return {
    contractVersion: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
    provenance: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_PROVENANCE,
    supportedDomain: "ms100-stair-stepper-shadow-only",
    availability: "unavailable",
    estimatedActiveKcal: null,
    lowerBoundKcal: null,
    upperBoundKcal: null,
    unavailableReason: input.reason,
    features: input.features,
    reasons: input.reasons,
    recoveryEnergy: WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
    garminReferenceKcal: input.features.garminReferenceKcal,
  };
}

/**
 * Estimate MS100 stair-stepper active kcal from BodyCast-observed session
 * mechanics. Missing evidence ≠ 0 kcal.
 */
export function estimateExperimentalStepperActiveEnergyV1(input: {
  workout: WorkoutStepperEvidenceV7;
  bodyMassKg: number | null;
  equipment: StepperEquipmentAssignmentV7 | null;
}): ExperimentalStepperActiveEnergyResultV1 {
  const features = baseFeatures(input);
  const energy = input.workout.workoutEnergy;

  if (energy.canonicalWorkoutType !== "Stair Climbing") {
    return unavailable({
      reason: "not-stair-climbing-workout",
      reasons: ["supported-domain-ms100-stair-only", "missing-evidence-is-not-zero-kcal"],
      features,
    });
  }
  if (input.equipment === null || input.equipment.machineFamily !== "DOMYOS_MS100") {
    return unavailable({
      reason: "no-ms100-equipment-assignment",
      reasons: [
        "ms100-assignment-required-for-supported-domain",
        "missing-evidence-is-not-zero-kcal",
      ],
      features,
    });
  }
  if (input.bodyMassKg === null || !(input.bodyMassKg > 0) || !Number.isFinite(input.bodyMassKg)) {
    return unavailable({
      reason: "missing-body-mass",
      reasons: ["body-mass-required-for-mechanical-work", "missing-evidence-is-not-zero-kcal"],
      features,
    });
  }
  if (input.workout.bracketedSteps.availability !== "available") {
    return unavailable({
      reason: "missing-bracketed-step-evidence",
      reasons: [
        "bracketed-step-delta-required-no-met-fallback",
        "missing-evidence-is-not-zero-kcal",
        "fixed-met-fallback-intentionally-rejected",
      ],
      features,
    });
  }

  const stepCount = input.workout.bracketedSteps.derivedStepDelta.value;
  if (!Number.isFinite(stepCount) || stepCount < 0) {
    return unavailable({
      reason: "non-finite-inputs",
      reasons: ["non-finite-step-delta", "missing-evidence-is-not-zero-kcal"],
      features,
    });
  }

  const height = ENGINEERING_MS100_STEP_HEIGHT_M_V1;
  const eta = ENGINEERING_NET_VERTICAL_WORK_EFFICIENCY_V1;

  const workPoint = mechanicalVerticalWorkJoulesV1({
    bodyMassKg: input.bodyMassKg,
    stepHeightM: height.pointMeters,
    stepCount,
  });
  const workLower = mechanicalVerticalWorkJoulesV1({
    bodyMassKg: input.bodyMassKg,
    stepHeightM: height.lowerMeters,
    stepCount,
  });
  const workUpper = mechanicalVerticalWorkJoulesV1({
    bodyMassKg: input.bodyMassKg,
    stepHeightM: height.upperMeters,
    stepCount,
  });

  const point = activeKcalFromMechanicalWorkV1({
    mechanicalWorkJ: workPoint,
    efficiencyFraction: eta.pointFraction,
  });
  // Lower energy edge: smaller rise + better efficiency
  const lower = activeKcalFromMechanicalWorkV1({
    mechanicalWorkJ: workLower,
    efficiencyFraction: eta.upperFraction,
  });
  // Upper energy edge: larger rise + worse efficiency
  const upper = activeKcalFromMechanicalWorkV1({
    mechanicalWorkJ: workUpper,
    efficiencyFraction: eta.lowerFraction,
  });

  const orderedLower = Math.min(lower, point);
  const orderedUpper = Math.max(upper, point);

  features.mechanicalWorkPointJ = workPoint;

  const reasons = [
    "experimental-heuristic-mechanical-vertical-work",
    "active-kcal-from-external-work-over-net-efficiency",
    "ms100-fixed-configuration-step-height-prior",
    "garmin-active-kcal-reference-only-not-truth",
    "hr-context-coverage-only-not-kcal",
    "fixed-met-fallback-intentionally-rejected",
    "hr-to-kcal-formula-intentionally-rejected",
    "garmin-truth-calibration-intentionally-rejected",
    "epoc-recovery-add-on-intentionally-rejected",
    "exercise-energy-separate-from-epoc-recovery",
    ...(energy.durationMinutes !== null && energy.durationMinutes > 0
      ? ["duration-available-for-matched-protocol-monotonicity"]
      : ["duration-not-required-when-step-delta-observed"]),
    ...(features.hrCoverage === "contextual"
      ? ["hr-coverage-contextual"]
      : features.hrCoverage === "sparse"
        ? ["hr-coverage-sparse"]
        : ["hr-coverage-unavailable"]),
  ];

  return {
    contractVersion: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
    provenance: EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_PROVENANCE,
    supportedDomain: "ms100-stair-stepper-shadow-only",
    availability: "available",
    estimatedActiveKcal: point,
    lowerBoundKcal: orderedLower,
    upperBoundKcal: orderedUpper,
    unavailableReason: null,
    features,
    reasons,
    recoveryEnergy: WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
    garminReferenceKcal: features.garminReferenceKcal,
  };
}

/**
 * Matched-protocol helper: same mass, height, efficiency, and step rate →
 * energy nondecreasing with duration (C-K06).
 */
export function estimateMatchedProtocolDurationEnergyV1(input: {
  bodyMassKg: number;
  durationMinutes: number;
  stepRatePerMinute: number;
  equipment: StepperEquipmentAssignmentV7;
}): ExperimentalStepperActiveEnergyResultV1 {
  if (!(input.durationMinutes > 0) || !(input.stepRatePerMinute >= 0)) {
    throw new RangeError("matched protocol requires positive duration and nonnegative rate");
  }
  const stepCount = input.stepRatePerMinute * input.durationMinutes;
  const startAt = "2026-01-01T12:00:00.000Z";
  const endAt = new Date(Date.parse(startAt) + input.durationMinutes * 60_000).toISOString();
  const workout: WorkoutStepperEvidenceV7 = {
    workoutEnergy: {
      workoutId: 0,
      canonicalWorkoutType: "Stair Climbing",
      startAt,
      endAt,
      durationMinutes: input.durationMinutes,
      deviceEnergy: { availability: "unavailable", availabilityReason: "no-device-active-energy" },
      heartRate: {
        availability: "unavailable",
        availabilityReason: "no-hr-source",
        workoutInterval: { startAt, endAt },
        samples: null,
        sampleCount: null,
        distinctSources: null,
        samplingTopology: null,
        summary: null,
      },
    },
    bracketedSteps: {
      availability: "available",
      before: {
        snapshotId: 1,
        timestamp: startAt,
        timestampBasis: "received-at",
        stepCount: 0,
      },
      after: {
        snapshotId: 2,
        timestamp: endAt,
        timestampBasis: "received-at",
        stepCount,
      },
      preGapSeconds: 0,
      postGapSeconds: 0,
      derivedStepDelta: { value: stepCount, provenance: "bracketed-health-step-delta" },
      derivedStepRatePerMinute: {
        value: input.stepRatePerMinute,
        provenance: "derived-from-bracketed-health-step-delta-and-workout-duration",
      },
    },
  };
  return estimateExperimentalStepperActiveEnergyV1({
    workout,
    bodyMassKg: input.bodyMassKg,
    equipment: input.equipment,
  });
}

export function experimentalStepperActiveEnergyV1Fingerprint(
  result: ExperimentalStepperActiveEnergyResultV1,
): string {
  return stableSha256(result);
}
