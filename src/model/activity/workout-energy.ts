import { calculateStrengthActivity } from "./strength";
import {
  knownEnergyCoverageV1,
  resolveEventEnergyV1,
  type EnergySourceKind,
  type KnownEnergyCoverageV1,
} from "./canonical-activity-policy-v1";
import {
  type CanonicalWorkoutType,
  type WorkoutActivityClassification,
} from "./workout-type";
export { canonicalizeWorkoutType, classifyWorkoutType } from "./workout-type";
export type { CanonicalWorkoutType, WorkoutActivityClassification } from "./workout-type";
import type { WorkoutStepperEvidenceV7 } from "./workout-stepper-v7";
import { estimateExperimentalStepperActiveEnergyV1 } from "./experimental-stepper-active-energy-v1";
import { FIXED_STEPPER_EQUIPMENT_V7 } from "./personal-stepper-reference-v7";
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
  /** Staged selection v1 only. Ignored by the legacy resolver. */
  bodyCastEstimateKcal?: number | null;
  bodyCastEstimateFresh?: boolean;
  strengthSessionCompleted?: boolean;
  manualActiveKcal?: number | null;
  manualActiveKcalPresent?: boolean;
  mechanicalStepperKcal?: number | null;
  /** Future forecast only. Historical events leave this unset. */
  forecastScenarioStrengthMet?: boolean;
};

export type ExplicitWorkoutActivityInput = {
  events: readonly ExplicitWorkoutActivityEvent[];
  /** Omitted means the historical Garmin/MET resolver. */
  selectionPolicy?: "legacy" | "bodycast-active-energy-selection-v1";
};

export type WorkoutEnergyResolutionSummaryV1 = {
  modelVersion: "bodycast-workout-energy-v2";
  workoutActivityKcal: number;
  deviceActiveEnergyKcal: number;
  bodyCastStepperActiveEnergyKcal: number;
  strengthMetFallbackKcal: number;
  energyCoverage?: KnownEnergyCoverageV1;
  publishedStrengthEstimateKcal?: number;
  perEvent: Array<{
    workoutId?: number;
    classification: WorkoutActivityClassification;
    source: "hr-calibrated-stepper" | "mechanical-stepper" | "device-active-kcal" | "strength-met-fallback" | "bodycast-strength-estimate" | "manual-kcal" | "forecast-scenario-strength-met" | "none";
    kcal: number;
    stepperEnergy?: StepperHrAwareActiveEnergyResultV1;
  }>;
};

function selectionProvenance(
  source: EnergySourceKind,
): "device-active-kcal" | "mechanical-stepper" | "bodycast-strength-estimate" | "manual-kcal" | "forecast-scenario-strength-met" | "none" {
  switch (source) {
    case "garmin-fallback":
      return "device-active-kcal";
    case "bodycast-stepper-mechanical":
      return "mechanical-stepper";
    case "bodycast-strength-estimate":
      return "bodycast-strength-estimate";
    case "manual-kcal":
      return "manual-kcal";
    case "forecast-scenario-strength-met":
      return "forecast-scenario-strength-met";
    case "unavailable":
      return "none";
    default:
      return "none";
  }
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
  selectionPolicy?: "legacy" | "bodycast-active-energy-selection-v1";
}): WorkoutEnergyResolutionSummaryV1 & {
  workoutActivityKcal: number;
  deviceActiveEnergyKcal: number;
  bodyCastStepperActiveEnergyKcal: number;
  strengthMetFallbackKcal: number;
  recoveryEnergy: WorkoutRecoveryEnergyScientificDecision;
  energyCoverage?: KnownEnergyCoverageV1;
  publishedStrengthEstimateKcal?: number;
} {
  let deviceActiveEnergyKcal = 0;
  let bodyCastStepperActiveEnergyKcal = 0;
  let strengthMetFallbackKcal = 0;
  let publishedStrengthEstimateKcal = 0;
  const selectedValues: Array<number | null> = [];
  const selectionV1 = input.selectionPolicy === "bodycast-active-energy-selection-v1";
  const perEvent: Array<{
    workoutId?: number;
    classification: WorkoutActivityClassification;
    source: "hr-calibrated-stepper" | "mechanical-stepper" | "device-active-kcal" | "strength-met-fallback" | "bodycast-strength-estimate" | "manual-kcal" | "forecast-scenario-strength-met" | "none";
    kcal: number;
    stepperEnergy?: StepperHrAwareActiveEnergyResultV1;
  }> = [];

  for (const event of input.events) {
    // Forecast scenario MET is labeled and must work on plain v7 episodes without
    // forcing the full selection-v1 policy onto every historical event.
    if (!selectionV1 && event.forecastScenarioStrengthMet === true) {
      const selected = resolveEventEnergyV1(event);
      const provenance = selectionProvenance(selected.source);
      if (selected.selectedKcal !== null && provenance !== "none") {
        publishedStrengthEstimateKcal += selected.selectedKcal;
        perEvent.push({
          ...(event.workoutId === undefined ? {} : { workoutId: event.workoutId }),
          classification: event.classification,
          source: provenance,
          kcal: selected.selectedKcal,
        });
      } else {
        perEvent.push({
          ...(event.workoutId === undefined ? {} : { workoutId: event.workoutId }),
          classification: event.classification,
          source: "none",
          kcal: 0,
        });
      }
      continue;
    }
    if (selectionV1) {
      let mechanicalStepperKcal = event.mechanicalStepperKcal ?? null;
      if (
        mechanicalStepperKcal === null
        && event.classification === "stair-climbing"
        && event.stepperEvidence !== undefined
      ) {
        const mechanical = estimateExperimentalStepperActiveEnergyV1({
          workout: event.stepperEvidence,
          bodyMassKg: input.weightKg,
          equipment: FIXED_STEPPER_EQUIPMENT_V7,
        });
        if (mechanical.availability === "available" && mechanical.estimatedActiveKcal !== null) {
          mechanicalStepperKcal = mechanical.estimatedActiveKcal;
        }
      }
      const selected = resolveEventEnergyV1({
        ...event,
        mechanicalStepperKcal,
      });
      const provenance = selectionProvenance(selected.source);
      if (selected.selectedKcal === null || provenance === "none") {
        selectedValues.push(null);
      } else {
        selectedValues.push(selected.selectedKcal);
        if (selected.source === "garmin-fallback") deviceActiveEnergyKcal += selected.selectedKcal;
        else if (selected.source === "bodycast-strength-estimate" || selected.source === "forecast-scenario-strength-met") {
          publishedStrengthEstimateKcal += selected.selectedKcal;
        } else bodyCastStepperActiveEnergyKcal += selected.selectedKcal;
      }
      perEvent.push({
        ...(event.workoutId === undefined ? {} : { workoutId: event.workoutId }),
        classification: event.classification,
        source: provenance,
        kcal: selected.selectedKcal ?? 0,
      });
      continue;
    }
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
    workoutActivityKcal: deviceActiveEnergyKcal + bodyCastStepperActiveEnergyKcal + strengthMetFallbackKcal + publishedStrengthEstimateKcal,
    deviceActiveEnergyKcal,
    bodyCastStepperActiveEnergyKcal,
    strengthMetFallbackKcal,
    recoveryEnergy: WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
    ...(selectionV1 ? {
      energyCoverage: knownEnergyCoverageV1(selectedValues),
      publishedStrengthEstimateKcal,
    } : {}),
    perEvent,
  };
}
