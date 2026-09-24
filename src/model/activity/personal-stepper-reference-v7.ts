import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type { WorkoutStepperEvidenceV7 } from "./workout-stepper-v7";

export const PERSONAL_STEPPER_REFERENCE_V7_CONTRACT_VERSION =
  "bodycast-personal-stepper-reference-v1" as const;

export type StepperEquipmentAssignmentV7 = {
  id: number;
  machineFamily: "DOMYOS_MS100";
  configuration: "fixed";
  effectiveFrom: string;
  /** Exclusive end; null means open-ended. */
  effectiveTo: string | null;
  createdAt: string;
};

/** This user's equipment is fixed: DOMYOS MS100 in the fixed configuration. */
export const FIXED_STEPPER_EQUIPMENT_V7: StepperEquipmentAssignmentV7 = {
  id: 0,
  machineFamily: "DOMYOS_MS100",
  configuration: "fixed",
  effectiveFrom: "1970-01-01T00:00:00.000Z",
  effectiveTo: null,
  createdAt: "1970-01-01T00:00:00.000Z",
};

export type PersonalStepperReferenceCandidateV7 = {
  workout: WorkoutStepperEvidenceV7;
  /** Observed daily context only; no body-mass scaling is performed. */
  bodyMassKg: number | null;
};

export type PersonalStepperReferenceDiagnosticV7 = {
  workoutId: number;
  startedAt: string;
  status: "eligible" | "ineligible";
  requiredReasons: readonly (
    | "no-device-active-energy"
    | "no-duration"
  )[];
  optionalContextMissing: readonly (
    | "no-bracketed-step-evidence"
    | "no-step-rate"
    | "hr-unavailable"
    | "hr-loaded-zero-samples"
    | "body-mass-unavailable"
  )[];
};

export type PersonalStepperReferenceSampleV7 = {
  workoutId: number;
  startedAt: string;
  durationMinutes: number;
  equipmentAssignment: StepperEquipmentAssignmentV7;
  bracketedSteps: WorkoutStepperEvidenceV7["bracketedSteps"];
  heartRate: WorkoutStepperEvidenceV7["workoutEnergy"]["heartRate"];
  bodyMassKg: number | null;
  target: {
    valueKcal: number;
    sourceValueStatus: "observed";
    semantics: "active";
    provenance: "device-estimate";
  };
};

export type PersonalStepperReferenceSetV7 = {
  contractVersion: typeof PERSONAL_STEPPER_REFERENCE_V7_CONTRACT_VERSION;
  samples: readonly PersonalStepperReferenceSampleV7[];
  diagnostics: readonly PersonalStepperReferenceDiagnosticV7[];
};

function timestampMs(value: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error(`Invalid personal-stepper workout timestamp: ${value}`);
  return timestamp;
}

/**
 * Builds reference facts only. It never estimates kcal: an eligible sample has
 * an observed Garmin active-energy target and the fixed MS100 equipment profile.
 * Step, HR, and body-mass context remain optional.
 */
export function buildPersonalStepperReferenceSetV7(input: {
  candidates: readonly PersonalStepperReferenceCandidateV7[];
}): PersonalStepperReferenceSetV7 {
  const ordered = [...input.candidates].sort((left, right) => (
    timestampMs(left.workout.workoutEnergy.startAt) - timestampMs(right.workout.workoutEnergy.startAt)
    || left.workout.workoutEnergy.workoutId - right.workout.workoutEnergy.workoutId
  ));
  const samples: PersonalStepperReferenceSampleV7[] = [];
  const diagnostics: PersonalStepperReferenceDiagnosticV7[] = [];

  for (const candidate of ordered) {
    const { workout } = candidate;
    const energy = workout.workoutEnergy;
    const assignment = FIXED_STEPPER_EQUIPMENT_V7;
    const requiredReasons: PersonalStepperReferenceDiagnosticV7["requiredReasons"][number][] = [];
    if (energy.deviceEnergy.availability !== "available") requiredReasons.push("no-device-active-energy");
    if (energy.durationMinutes === null || energy.durationMinutes <= 0) requiredReasons.push("no-duration");

    const optionalContextMissing: PersonalStepperReferenceDiagnosticV7["optionalContextMissing"][number][] = [];
    if (workout.bracketedSteps.availability !== "available") optionalContextMissing.push("no-bracketed-step-evidence");
    if (workout.bracketedSteps.availability !== "available" || workout.bracketedSteps.derivedStepRatePerMinute === null) optionalContextMissing.push("no-step-rate");
    if (energy.heartRate.availability === "unavailable") optionalContextMissing.push("hr-unavailable");
    if (energy.heartRate.availability === "loaded" && energy.heartRate.sampleCount === 0) optionalContextMissing.push("hr-loaded-zero-samples");
    if (candidate.bodyMassKg === null) optionalContextMissing.push("body-mass-unavailable");

    diagnostics.push({
      workoutId: energy.workoutId,
      startedAt: energy.startAt,
      status: requiredReasons.length === 0 ? "eligible" : "ineligible",
      requiredReasons,
      optionalContextMissing,
    });
    if (requiredReasons.length !== 0) continue;
    // Type-level narrowing mirrors the required-field diagnostics above.
    if (energy.deviceEnergy.availability !== "available" || energy.durationMinutes === null || energy.durationMinutes <= 0) continue;
    samples.push({
      workoutId: energy.workoutId,
      startedAt: energy.startAt,
      durationMinutes: energy.durationMinutes,
      equipmentAssignment: assignment,
      bracketedSteps: workout.bracketedSteps,
      heartRate: energy.heartRate,
      bodyMassKg: candidate.bodyMassKg,
      target: {
        valueKcal: energy.deviceEnergy.valueKcal,
        sourceValueStatus: "observed",
        semantics: "active",
        provenance: "device-estimate",
      },
    });
  }
  return { contractVersion: PERSONAL_STEPPER_REFERENCE_V7_CONTRACT_VERSION, samples, diagnostics };
}

export function personalStepperReferenceSetFingerprintV7(
  referenceSet: PersonalStepperReferenceSetV7,
): string {
  return stableSha256(referenceSet);
}
