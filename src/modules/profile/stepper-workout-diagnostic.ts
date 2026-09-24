import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import type { WorkoutEnergyEvidenceV7 } from "@/model/activity/workout-energy-v7";
import { canonicalizeWorkoutHeartRateEvidenceV7, type WorkoutHeartRateSampleV7 } from "@/model/activity/workout-heart-rate-v7";
import { estimateExperimentalStepperActiveEnergyV1, type ExperimentalStepperActiveEnergyResultV1 } from "@/model/activity/experimental-stepper-active-energy-v1";
import { FIXED_STEPPER_EQUIPMENT_V7, type StepperEquipmentAssignmentV7 } from "@/model/activity/personal-stepper-reference-v7";
import { canonicalizeWorkoutStepperEvidenceV7, workoutStepperEvidenceDiagnosticV7, type HealthStepIntervalV7, type HealthSyncStepSnapshotV7 } from "@/model/activity/workout-stepper-v7";

export type StepperProgramActiveEnergyDiagnosticV1 = Pick<
  ExperimentalStepperActiveEnergyResultV1,
  "contractVersion" | "provenance" | "availability" | "estimatedActiveKcal" | "lowerBoundKcal" | "upperBoundKcal" | "unavailableReason"
>;

export type StepperWorkoutDiagnosticV7 = ReturnType<typeof workoutStepperEvidenceDiagnosticV7> & {
  equipmentAssignment: StepperEquipmentAssignmentV7;
  programEnergy: StepperProgramActiveEnergyDiagnosticV1;
  labels: {
    derivedStepDelta: "derived health step-counter attribution" | "derived Apple Health interval attribution";
    garminActiveEnergy: "device estimate";
  };
};

/**
 * Read-side diagnostic composition. The BodyCast estimate is explicitly the
 * existing experimental shadow model; device energy remains a separate fact.
 */
export function buildStepperWorkoutDiagnosticV7(input: {
  workout: {
    id: number;
    type: string;
    startAt: string;
    endAt: string;
    durationMinutes: number | null;
    activeEnergyKcal: number | null;
  };
  bodyMassKg?: number | null;
  snapshots: readonly HealthSyncStepSnapshotV7[];
  stepIntervals?: readonly HealthStepIntervalV7[];
  heartRateSamples: readonly WorkoutHeartRateSampleV7[];
}): StepperWorkoutDiagnosticV7 | null {
  const canonical = canonicalizeWorkoutType(input.workout.type);
  if (canonical.classification !== "stair-climbing" || canonical.canonicalType === null) return null;

  const heartRate = canonicalizeWorkoutHeartRateEvidenceV7({
    workoutInterval: { startAt: input.workout.startAt, endAt: input.workout.endAt },
    heartRate: { availability: "loaded", samples: input.heartRateSamples },
  });
  const workoutEnergy: WorkoutEnergyEvidenceV7 = {
    workoutId: input.workout.id,
    canonicalWorkoutType: canonical.canonicalType,
    startAt: input.workout.startAt,
    endAt: input.workout.endAt,
    durationMinutes: input.workout.durationMinutes,
    deviceEnergy: input.workout.activeEnergyKcal === null
      ? { availability: "unavailable", availabilityReason: "no-device-active-energy" }
      : { availability: "available", sourceValueStatus: "observed", valueKcal: input.workout.activeEnergyKcal, semantics: "active", provenance: "device-estimate" },
    heartRate,
  };
  const evidence = canonicalizeWorkoutStepperEvidenceV7({
    workoutEnergy,
    snapshots: input.snapshots,
    stepIntervals: input.stepIntervals,
  });
  const programEnergy = estimateExperimentalStepperActiveEnergyV1({
    workout: evidence,
    bodyMassKg: input.bodyMassKg ?? null,
    equipment: FIXED_STEPPER_EQUIPMENT_V7,
  });
  return {
    ...workoutStepperEvidenceDiagnosticV7(evidence),
    equipmentAssignment: FIXED_STEPPER_EQUIPMENT_V7,
    programEnergy: {
      contractVersion: programEnergy.contractVersion,
      provenance: programEnergy.provenance,
      availability: programEnergy.availability,
      estimatedActiveKcal: programEnergy.estimatedActiveKcal,
      lowerBoundKcal: programEnergy.lowerBoundKcal,
      upperBoundKcal: programEnergy.upperBoundKcal,
      unavailableReason: programEnergy.unavailableReason,
    },
    labels: {
      derivedStepDelta: evidence.bracketedSteps.availability === "available"
        && evidence.bracketedSteps.derivedStepDelta.provenance === "health-step-interval-overlap"
        ? "derived Apple Health interval attribution"
        : "derived health step-counter attribution",
      garminActiveEnergy: "device estimate",
    },
  };
}
