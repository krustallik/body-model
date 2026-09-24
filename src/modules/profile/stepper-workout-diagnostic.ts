import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import type { WorkoutEnergyEvidenceV7 } from "@/model/activity/workout-energy-v7";
import { canonicalizeWorkoutHeartRateEvidenceV7, type WorkoutHeartRateSampleV7 } from "@/model/activity/workout-heart-rate-v7";
import { FIXED_STEPPER_EQUIPMENT_V7, type StepperEquipmentAssignmentV7 } from "@/model/activity/personal-stepper-reference-v7";
import { canonicalizeWorkoutStepperEvidenceV7, workoutStepperEvidenceDiagnosticV7, type HealthStepIntervalV7, type HealthSyncStepSnapshotV7 } from "@/model/activity/workout-stepper-v7";

export type StepperWorkoutDiagnosticV7 = ReturnType<typeof workoutStepperEvidenceDiagnosticV7> & {
  equipmentAssignment: StepperEquipmentAssignmentV7;
  labels: {
    derivedStepDelta: "derived health step-counter attribution" | "derived Apple Health interval attribution";
    garminActiveEnergy: "device estimate";
  };
};

/**
 * Read-side diagnostic composition only. It deliberately contains no energy
 * fallback, calibration, or scientific quality classification.
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
  return {
    ...workoutStepperEvidenceDiagnosticV7(evidence),
    equipmentAssignment: FIXED_STEPPER_EQUIPMENT_V7,
    labels: {
      derivedStepDelta: evidence.bracketedSteps.availability === "available"
        && evidence.bracketedSteps.derivedStepDelta.provenance === "health-step-interval-overlap"
        ? "derived Apple Health interval attribution"
        : "derived health step-counter attribution",
      garminActiveEnergy: "device estimate",
    },
  };
}
