import { calculateStrengthActivity } from "./strength";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";
import type { WorkoutStepperEvidenceV7 } from "./workout-stepper-v7";
import {
  estimateHrAwareStepperActiveEnergyV1,
  type StepperHeartRateEnergyCalibrationV1,
  type StepperHrAwareActiveEnergyResultV1,
} from "./stepper-hr-aware-active-energy-v1";
import {
  WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
  type WorkoutRecoveryEnergyScientificDecision,
} from "./workout-recovery-energy";

export {
  WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
  type WorkoutRecoveryEnergyScientificDecision,
} from "./workout-recovery-energy";

export type WorkoutActivityClassification =
  | "traditional-strength-training"
  | "stair-climbing"
  | "other";

export type CanonicalWorkoutType =
  | typeof TRADITIONAL_STRENGTH_TRAINING_TYPE
  | typeof STAIR_CLIMBING_TYPE;

export type ExplicitWorkoutActivityEvent = {
  workoutId?: number;
  /** Raw source type string preserved for provenance (case/spacing as stored). */
  type: string;
  /** Canonical BodyCast type when recognized; null for unrecognized types. */
  canonicalType: CanonicalWorkoutType | null;
  classification: WorkoutActivityClassification;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  /** Actual interval evidence is supplied for observed stepper workouts only. */
  stepperEvidence?: WorkoutStepperEvidenceV7;
  /** No production calibration exists yet; this is an explicit future input. */
  stepperHeartRateCalibration?: StepperHeartRateEnergyCalibrationV1 | null;
};

export type ExplicitWorkoutActivityInput = {
  events: readonly ExplicitWorkoutActivityEvent[];
};

export type WorkoutEnergyResolutionSummaryV1 = {
  modelVersion: "bodycast-workout-energy-v2";
  workoutActivityKcal: number;
  deviceActiveEnergyKcal: number;
  bodyCastStepperActiveEnergyKcal: number;
  strengthMetFallbackKcal: number;
  perEvent: Array<{
    workoutId?: number;
    classification: WorkoutActivityClassification;
    source: "hr-calibrated-stepper" | "mechanical-stepper" | "device-active-kcal" | "strength-met-fallback" | "none";
    kcal: number;
    stepperEnergy?: StepperHrAwareActiveEnergyResultV1;
  }>;
};

/**
 * Normalize workout type values (not payload keys): trim + case-insensitive
 * match against canonical Garmin/CIRQA labels.
 */
export function canonicalizeWorkoutType(rawType: string): {
  rawType: string;
  canonicalType: CanonicalWorkoutType | null;
  classification: WorkoutActivityClassification;
} {
  const rawTypePreserved = rawType;
  const normalized = rawType.trim().toLowerCase();
  if (normalized === TRADITIONAL_STRENGTH_TRAINING_TYPE.toLowerCase()) {
    return {
      rawType: rawTypePreserved,
      canonicalType: TRADITIONAL_STRENGTH_TRAINING_TYPE,
      classification: "traditional-strength-training",
    };
  }
  if (normalized === STAIR_CLIMBING_TYPE.toLowerCase()) {
    return {
      rawType: rawTypePreserved,
      canonicalType: STAIR_CLIMBING_TYPE,
      classification: "stair-climbing",
    };
  }
  return {
    rawType: rawTypePreserved,
    canonicalType: null,
    classification: "other",
  };
}

export function classifyWorkoutType(type: string): WorkoutActivityClassification {
  return canonicalizeWorkoutType(type).classification;
}

export function hasExplicitStrengthWorkouts(
  events: readonly ExplicitWorkoutActivityEvent[],
): boolean {
  return events.some((event) => event.classification === "traditional-strength-training");
}

/**
 * Resolve workout activity kcal for one day.
 * On observed MS100 stepper workouts, calibrated BodyCast HR energy replaces
 * the mechanical estimate; otherwise the mechanical estimate is primary.
 * Device active kcal remains the fallback when BodyCast stepper inputs are not
 * available. Garmin active kcal is used as-is for other workouts (already excludes resting).
 * Strength MET is only a per-event fallback when active kcal is missing.
 * Stair without any usable energy evidence contributes 0 and never invents MET.
 */
export function resolveExplicitWorkoutActivityKcal(input: {
  events: readonly ExplicitWorkoutActivityEvent[];
  weightKg: number;
  rmrKcalPerDay: number;
  stepperHeartRateCalibration?: StepperHeartRateEnergyCalibrationV1 | null;
}): WorkoutEnergyResolutionSummaryV1 & {
  workoutActivityKcal: number;
  deviceActiveEnergyKcal: number;
  bodyCastStepperActiveEnergyKcal: number;
  strengthMetFallbackKcal: number;
  recoveryEnergy: WorkoutRecoveryEnergyScientificDecision;
} {
  let deviceActiveEnergyKcal = 0;
  let bodyCastStepperActiveEnergyKcal = 0;
  let strengthMetFallbackKcal = 0;
  const perEvent: Array<{
    workoutId?: number;
    classification: WorkoutActivityClassification;
    source: "hr-calibrated-stepper" | "mechanical-stepper" | "device-active-kcal" | "strength-met-fallback" | "none";
    kcal: number;
    stepperEnergy?: StepperHrAwareActiveEnergyResultV1;
  }> = [];

  for (const event of input.events) {
    let stepperEnergy: StepperHrAwareActiveEnergyResultV1 | undefined;
    if (event.classification === "stair-climbing" && event.stepperEvidence !== undefined) {
      stepperEnergy = estimateHrAwareStepperActiveEnergyV1({
        workout: event.stepperEvidence,
        bodyMassKg: input.weightKg,
        calibration: event.stepperHeartRateCalibration ?? input.stepperHeartRateCalibration ?? null,
        deviceActiveEnergyKcal: event.activeEnergyKcal,
      });
      if (stepperEnergy.selected.availability === "available") {
        const kcal = stepperEnergy.selected.valueKcal;
        if (stepperEnergy.selected.source === "hr-calibrated-ms100") {
          bodyCastStepperActiveEnergyKcal += kcal;
          perEvent.push({ ...(event.workoutId === undefined ? {} : { workoutId: event.workoutId }), classification: event.classification, source: "hr-calibrated-stepper", kcal, stepperEnergy });
        } else if (stepperEnergy.selected.source === "mechanical-ms100") {
          bodyCastStepperActiveEnergyKcal += kcal;
          perEvent.push({ ...(event.workoutId === undefined ? {} : { workoutId: event.workoutId }), classification: event.classification, source: "mechanical-stepper", kcal, stepperEnergy });
        } else {
          deviceActiveEnergyKcal += kcal;
          perEvent.push({ ...(event.workoutId === undefined ? {} : { workoutId: event.workoutId }), classification: event.classification, source: "device-active-kcal", kcal, stepperEnergy });
        }
        continue;
      }
    }

    if (event.activeEnergyKcal !== null && event.activeEnergyKcal > 0) {
      deviceActiveEnergyKcal += event.activeEnergyKcal;
      perEvent.push({
        ...(event.workoutId === undefined ? {} : { workoutId: event.workoutId }),
        classification: event.classification,
        source: "device-active-kcal",
        kcal: event.activeEnergyKcal,
        ...(stepperEnergy ? { stepperEnergy } : {}),
      });
      continue;
    }

    if (
      event.classification === "traditional-strength-training"
      && event.durationMinutes !== null
      && event.durationMinutes > 0
    ) {
      const fallback = calculateStrengthActivity({
        weightKg: input.weightKg,
        rmrKcalPerDay: input.rmrKcalPerDay,
        durationMinutes: event.durationMinutes,
      });
      const kcal = fallback ?? 0;
      strengthMetFallbackKcal += kcal;
      perEvent.push({
        ...(event.workoutId === undefined ? {} : { workoutId: event.workoutId }),
        classification: event.classification,
        source: "strength-met-fallback",
        kcal,
        ...(stepperEnergy ? { stepperEnergy } : {}),
      });
      continue;
    }

    perEvent.push({
      ...(event.workoutId === undefined ? {} : { workoutId: event.workoutId }),
      classification: event.classification,
      source: "none",
      kcal: 0,
      ...(stepperEnergy ? { stepperEnergy } : {}),
    });
  }

  return {
    modelVersion: "bodycast-workout-energy-v2",
    workoutActivityKcal: deviceActiveEnergyKcal + bodyCastStepperActiveEnergyKcal + strengthMetFallbackKcal,
    deviceActiveEnergyKcal,
    bodyCastStepperActiveEnergyKcal,
    strengthMetFallbackKcal,
    recoveryEnergy: WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
    perEvent,
  };
}
