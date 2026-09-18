import type { StepperEquipmentAssignmentV7 } from "@/model/activity/personal-stepper-reference-v7";
import type { WorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import { estimateExperimentalStrengthGlycogenDemandV1 } from "@/model/physiology-v7/experimental-strength-glycogen-demand-v1";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Stepper Glycogen Demand V1 (shadow / EXPERIMENTAL only).
 *
 * MS100 / Stair Climbing endurance-bout glycogen depletion heuristic.
 * Stepper Active Energy V1 may be passed as ignored context only — never a
 * kcal→glycogen conversion. Not production TDEE / forecast / GREEN glycogen.
 */
export const EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION =
  "experimental-stepper-glycogen-demand-v1" as const;

export const EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * ENGINEERING PRIOR — saturating scale τ for attributed bracketed steps.
 * Normalizes bout size; not a measured mmol/step coefficient.
 */
export const ENGINEERING_STEPPER_STEP_SCALE_TAU_V1 = 2_500 as const;

/**
 * ENGINEERING PRIOR — saturating scale τ for elapsed duration (minutes).
 * Used with step scale (combined); not a glycogen-per-minute constant (C-G03).
 */
export const ENGINEERING_STEPPER_DURATION_SCALE_TAU_V1 = 35 as const;

/**
 * ENGINEERING PRIOR — reference body mass (kg) for mild absolute-scale context.
 * Directional only; not a personal muscle-mass oracle.
 */
export const ENGINEERING_STEPPER_REFERENCE_BODY_MASS_KG_V1 = 75 as const;

/**
 * Bounded whole-body glycogen depletion magnitudes (kg) for a saturated
 * continuous MS100 / stair bout envelope.
 *
 * Scientific basis for nonnegative depletion pressure: E-G05–E-G07 (aerobic
 * CHO reliance rises with intensity/duration). Direct stepper substrate % and
 * personal capacity remain unavailable — endpoints are ENGINEERING OOM priors.
 */
export const EXPERIMENTAL_STEPPER_REFERENCE_DEMAND_KG_V1 = {
  pointMagnitudeKg: 0.04,
  lowerMagnitudeKg: 0.008,
  upperMagnitudeKg: 0.15,
  evidenceIds: ["E-G05", "E-G06", "E-G07"] as const,
  pointClassification: "engineering-midpoint" as const,
  boundClassification: "engineering-order-of-magnitude-band" as const,
  scientificNote:
    "Aerobic CHO use supports depletion existence/sign; whole-body kg and substrate fraction remain engineering priors.",
} as const;

export type ExperimentalStepperGlycogenDemandAvailabilityV1 =
  | "available"
  | "unavailable";

export type ExperimentalStepperGlycogenDemandUnavailableReasonV1 =
  | "not-stair-climbing-workout"
  | "no-ms100-equipment-assignment"
  | "missing-body-mass"
  | "missing-bracketed-step-evidence"
  | "missing-duration"
  | "non-finite-available-glycogen";

export type ExperimentalStepperGlycogenDemandFeaturesV1 = {
  workoutId: number;
  durationMinutes: number | null;
  bodyMassKg: number | null;
  bracketedStepDelta: number | null;
  derivedStepRatePerMinute: number | null;
  equipmentMachineFamily: "DOMYOS_MS100" | null;
  stepScale: number;
  durationScale: number;
  doseScale: number;
  massScale: number;
  availableGlycogenKg: number | null;
  storeBoundApplied: boolean;
  /**
   * Optional Stepper Active Energy / device kcal context — never converted.
   */
  ignoredActiveEnergyKcal: number | null;
  rejectedConversions: readonly [
    "kcal-to-glycogen",
    "universal-substrate-percent",
    "scale-weight-residual",
    "equal-active-kcal-cross-modality-identity",
    "glycogen-per-minute-constant",
  ];
};

export type ExperimentalStepperGlycogenDemandResultV1 = {
  contractVersion: typeof EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION;
  provenance: typeof EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_PROVENANCE;
  supportedDomain: "ms100-stair-stepper-glycogen-shadow-only";
  availability: ExperimentalStepperGlycogenDemandAvailabilityV1;
  /** Exercise-only glycogen delta (kg). Always ≤ 0 when available. */
  estimatedGlycogenDeltaKg: number | null;
  /** More-depleted bound (≤ estimated). */
  lowerBoundKg: number | null;
  /** Less-depleted bound (≥ estimated, ≤ 0). */
  upperBoundKg: number | null;
  unavailableReason: ExperimentalStepperGlycogenDemandUnavailableReasonV1 | null;
  features: ExperimentalStepperGlycogenDemandFeaturesV1;
  reasons: string[];
};

function finiteNonnegativeOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("availableGlycogenKg must be finite and nonnegative when provided");
  }
  return value;
}

function clampToStore(deltaKg: number, availableGlycogenKg: number | null): number {
  if (availableGlycogenKg === null) return deltaKg;
  const clamped = Math.max(deltaKg, -availableGlycogenKg);
  return Object.is(clamped, -0) ? 0 : clamped;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function engineeringStepperStepScaleV1(stepCount: number): number {
  if (!(stepCount > 0)) return 0;
  return 1 - Math.exp(-stepCount / ENGINEERING_STEPPER_STEP_SCALE_TAU_V1);
}

export function engineeringStepperDurationScaleV1(durationMinutes: number): number {
  if (!(durationMinutes > 0)) return 0;
  return 1 - Math.exp(-durationMinutes / ENGINEERING_STEPPER_DURATION_SCALE_TAU_V1);
}

/**
 * Mild mass context around the engineering reference. Not a personal capacity.
 */
export function engineeringStepperMassScaleV1(bodyMassKg: number): number {
  return clamp(bodyMassKg / ENGINEERING_STEPPER_REFERENCE_BODY_MASS_KG_V1, 0.85, 1.2);
}

/**
 * Combined dose scale: geometric mean of step and duration saturating scales
 * when both positive — matched longer/faster bouts deplete more without a
 * fixed glycogen-per-minute constant.
 */
export function engineeringStepperDoseScaleV1(input: {
  stepCount: number;
  durationMinutes: number;
}): number {
  const stepScale = engineeringStepperStepScaleV1(input.stepCount);
  const durationScale = engineeringStepperDurationScaleV1(input.durationMinutes);
  if (stepScale <= 0 && durationScale <= 0) return 0;
  if (stepScale <= 0) return durationScale;
  if (durationScale <= 0) return stepScale;
  return Math.sqrt(stepScale * durationScale);
}

function rejectedConversions(): ExperimentalStepperGlycogenDemandFeaturesV1["rejectedConversions"] {
  return [
    "kcal-to-glycogen",
    "universal-substrate-percent",
    "scale-weight-residual",
    "equal-active-kcal-cross-modality-identity",
    "glycogen-per-minute-constant",
  ] as const;
}

function baseFeatures(input: {
  workout: WorkoutStepperEvidenceV7;
  bodyMassKg: number | null;
  equipment: StepperEquipmentAssignmentV7 | null;
  availableGlycogenKg: number | null;
  ignoredActiveEnergyKcal: number | null;
}): ExperimentalStepperGlycogenDemandFeaturesV1 {
  const energy = input.workout.workoutEnergy;
  const steps = input.workout.bracketedSteps;
  return {
    workoutId: energy.workoutId,
    durationMinutes: energy.durationMinutes,
    bodyMassKg: input.bodyMassKg,
    bracketedStepDelta: steps.availability === "available" ? steps.derivedStepDelta.value : null,
    derivedStepRatePerMinute: steps.availability === "available"
      ? steps.derivedStepRatePerMinute?.value ?? null
      : null,
    equipmentMachineFamily: input.equipment?.machineFamily ?? null,
    stepScale: 0,
    durationScale: 0,
    doseScale: 0,
    massScale: 1,
    availableGlycogenKg: input.availableGlycogenKg,
    storeBoundApplied: false,
    ignoredActiveEnergyKcal: input.ignoredActiveEnergyKcal,
    rejectedConversions: rejectedConversions(),
  };
}

function unavailable(input: {
  reason: ExperimentalStepperGlycogenDemandUnavailableReasonV1;
  reasons: string[];
  features: ExperimentalStepperGlycogenDemandFeaturesV1;
}): ExperimentalStepperGlycogenDemandResultV1 {
  return {
    contractVersion: EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION,
    provenance: EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_PROVENANCE,
    supportedDomain: "ms100-stair-stepper-glycogen-shadow-only",
    availability: "unavailable",
    estimatedGlycogenDeltaKg: null,
    lowerBoundKg: null,
    upperBoundKg: null,
    unavailableReason: input.reason,
    features: input.features,
    reasons: input.reasons,
  };
}

/**
 * Estimate MS100 stair-stepper exercise-only glycogen delta (≤ 0).
 * Missing evidence ≠ 0 depletion.
 */
export function estimateExperimentalStepperGlycogenDemandV1(input: {
  workout: WorkoutStepperEvidenceV7;
  bodyMassKg: number | null;
  equipment: StepperEquipmentAssignmentV7 | null;
  availableGlycogenKg?: number | null;
  /**
   * Optional Stepper Active Energy V1 / device kcal — context only.
   * Never converted to glycogen.
   */
  activeEnergyKcal?: number | null;
}): ExperimentalStepperGlycogenDemandResultV1 {
  const availableGlycogenKg = finiteNonnegativeOrNull(input.availableGlycogenKg ?? null);
  const ignoredActiveEnergyKcal = input.activeEnergyKcal === undefined
    ? null
    : input.activeEnergyKcal;
  if (ignoredActiveEnergyKcal !== null && !Number.isFinite(ignoredActiveEnergyKcal)) {
    throw new RangeError("activeEnergyKcal must be finite when provided");
  }

  const features = baseFeatures({
    workout: input.workout,
    bodyMassKg: input.bodyMassKg,
    equipment: input.equipment,
    availableGlycogenKg,
    ignoredActiveEnergyKcal,
  });
  const energy = input.workout.workoutEnergy;

  if (energy.canonicalWorkoutType !== "Stair Climbing") {
    return unavailable({
      reason: "not-stair-climbing-workout",
      reasons: ["supported-domain-ms100-stair-only", "missing-evidence-is-not-zero-depletion"],
      features,
    });
  }
  if (input.equipment === null || input.equipment.machineFamily !== "DOMYOS_MS100") {
    return unavailable({
      reason: "no-ms100-equipment-assignment",
      reasons: ["ms100-assignment-required", "missing-evidence-is-not-zero-depletion"],
      features,
    });
  }
  if (input.bodyMassKg === null || !(input.bodyMassKg > 0) || !Number.isFinite(input.bodyMassKg)) {
    return unavailable({
      reason: "missing-body-mass",
      reasons: ["body-mass-required-for-mass-context-scale", "missing-evidence-is-not-zero-depletion"],
      features,
    });
  }
  if (input.workout.bracketedSteps.availability !== "available") {
    return unavailable({
      reason: "missing-bracketed-step-evidence",
      reasons: ["bracketed-steps-required-no-invented-cadence", "missing-evidence-is-not-zero-depletion"],
      features,
    });
  }
  if (energy.durationMinutes === null || !(energy.durationMinutes > 0) || !Number.isFinite(energy.durationMinutes)) {
    return unavailable({
      reason: "missing-duration",
      reasons: ["duration-required-for-bout-scale", "missing-evidence-is-not-zero-depletion"],
      features,
    });
  }

  const stepCount = input.workout.bracketedSteps.derivedStepDelta.value;
  if (!Number.isFinite(stepCount) || stepCount < 0) {
    throw new RangeError("bracketed step delta must be finite and nonnegative when available");
  }

  const stepScale = engineeringStepperStepScaleV1(stepCount);
  const durationScale = engineeringStepperDurationScaleV1(energy.durationMinutes);
  const doseScale = engineeringStepperDoseScaleV1({
    stepCount,
    durationMinutes: energy.durationMinutes,
  });
  const massScale = engineeringStepperMassScaleV1(input.bodyMassKg);
  features.stepScale = stepScale;
  features.durationScale = durationScale;
  features.doseScale = doseScale;
  features.massScale = massScale;

  // Observed zero steps with valid bracket: available zero depletion (not missing).
  if (!(doseScale > 0) || stepCount === 0) {
    features.storeBoundApplied = availableGlycogenKg !== null;
    return {
      contractVersion: EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION,
      provenance: EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_PROVENANCE,
      supportedDomain: "ms100-stair-stepper-glycogen-shadow-only",
      availability: "available",
      estimatedGlycogenDeltaKg: 0,
      lowerBoundKg: 0,
      upperBoundKg: 0,
      unavailableReason: null,
      features,
      reasons: [
        "observed-zero-step-delta-zero-depletion",
        "exercise-only-delta-nonpositive",
        "kcal-to-glycogen-intentionally-rejected",
      ],
    };
  }

  const ref = EXPERIMENTAL_STEPPER_REFERENCE_DEMAND_KG_V1;
  const scale = doseScale * massScale;
  let estimatedGlycogenDeltaKg = -ref.pointMagnitudeKg * scale;
  let lowerBoundKg = -ref.upperMagnitudeKg * scale;
  let upperBoundKg = -ref.lowerMagnitudeKg * scale;

  estimatedGlycogenDeltaKg = clampToStore(estimatedGlycogenDeltaKg, availableGlycogenKg);
  lowerBoundKg = Math.min(
    clampToStore(lowerBoundKg, availableGlycogenKg),
    estimatedGlycogenDeltaKg,
  );
  upperBoundKg = Math.max(
    clampToStore(upperBoundKg, availableGlycogenKg),
    estimatedGlycogenDeltaKg,
  );
  upperBoundKg = Math.min(0, upperBoundKg);

  const storeBoundApplied = availableGlycogenKg !== null;
  features.storeBoundApplied = storeBoundApplied;

  return {
    contractVersion: EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION,
    provenance: EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_PROVENANCE,
    supportedDomain: "ms100-stair-stepper-glycogen-shadow-only",
    availability: "available",
    estimatedGlycogenDeltaKg,
    lowerBoundKg,
    upperBoundKg,
    unavailableReason: null,
    features,
    reasons: [
      "experimental-heuristic-bounded-prior",
      "step-and-duration-saturating-dose-scale",
      "mass-context-scale-not-personal-capacity",
      "exercise-only-delta-nonpositive",
      ...(storeBoundApplied
        ? ["store-bounded-to-available-glycogen"]
        : ["store-bound-not-applied-glycogen-unavailable"]),
      "kcal-to-glycogen-intentionally-rejected",
      "universal-substrate-percent-intentionally-rejected",
      "equal-active-kcal-cross-modality-identity-intentionally-rejected",
      "glycogen-per-minute-constant-intentionally-rejected",
      ...(ignoredActiveEnergyKcal !== null
        ? ["active-energy-present-as-ignored-context-only"]
        : ["active-energy-context-absent"]),
    ],
  };
}

/**
 * Cross-modality helper for C-G04 / C-F05 tests: strength and stepper estimators
 * at the same ignored active-kcal context must not be forced equal.
 */
export function strengthAndStepperGlycogenDifferAtEqualActiveKcalV1(input: {
  strength: Parameters<typeof estimateExperimentalStrengthGlycogenDemandV1>[0];
  stepper: Parameters<typeof estimateExperimentalStepperGlycogenDemandV1>[0];
  sharedActiveEnergyKcal: number;
}): boolean {
  const strength = estimateExperimentalStrengthGlycogenDemandV1({
    ...input.strength,
    activeEnergyKcal: input.sharedActiveEnergyKcal,
  });
  const stepper = estimateExperimentalStepperGlycogenDemandV1({
    ...input.stepper,
    activeEnergyKcal: input.sharedActiveEnergyKcal,
  });
  if (strength.availability !== "available" || stepper.availability !== "available") {
    return false;
  }
  return strength.estimatedGlycogenDeltaKg !== stepper.estimatedGlycogenDeltaKg;
}

export function experimentalStepperGlycogenDemandV1Fingerprint(
  result: ExperimentalStepperGlycogenDemandResultV1,
): string {
  return stableSha256(result);
}
