import type { WorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import { CANONICAL_STRENGTH_TRAINING_INPUT_V7_VERSION } from "@/modules/model-episodes/strength-training-input-v7";
import type { NutritionProvenance } from "@/modules/model-episodes/model-episode.types";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  PHYSIOLOGY_V7_DAILY_TRANSITION_ORDER,
} from "./contracts";
import {
  FLUID_WATER_TRANSITION_PIPELINE_V7_VERSION,
  buildFluidWaterTransitionPipelineV7,
} from "./fluid-water-transition-pipeline-v7";
import { GLYCOGEN_TRANSITION_V7_VERSION } from "./glycogen-transition-v7";
import { GLYCOGEN_WATER_TRANSITION_V7_VERSION } from "./glycogen-water-transition-v7";
import { QUALIFIED_RESISTANCE_TRAINING_DOSE_V7_VERSION } from "./qualified-resistance-training-dose-v7";
import {
  RESISTANCE_TRAINING_ADAPTATION_RESPONSE_V7_VERSION,
  buildResistanceTrainingAdaptationResponseV7,
} from "./resistance-training-adaptation-response-v7";
import {
  RESISTANCE_TRAINING_EXPOSURE_HISTORY_V7_VERSION,
  resistanceTrainingExposureHistoryV7Fingerprint,
  type ResistanceTrainingExposureHistoryV7,
} from "./resistance-training-exposure-history-v7";
import { SKELETAL_MUSCLE_RESPONSE_CALIBRATION_V7_VERSION } from "./skeletal-muscle-response-calibration-v7";
import {
  PHYSIOLOGY_V7_CONTRACT_VERSION,
  physiologyV7StateFingerprint,
  reconstructPhysiologyV7MassKg,
  validatePhysiologyV7State,
  type PhysiologyV7State,
} from "./state";
import {
  applyTrainingAdaptationTransitionV7,
  TRAINING_ADAPTATION_TRANSITION_V7_VERSION,
} from "./training-adaptation-transition-v7";
import { TRANSIENT_EXERCISE_WATER_ECF_TRANSITION_V7_VERSION } from "./transient-exercise-water-ecf-transition-v7";

export const PHYSIOLOGY_DAILY_RUNTIME_V7_VERSION =
  "bodycast-physiology-daily-runtime-v7-1" as const;

export type PhysiologyV7CompartmentKey =
  | "fatMassKg"
  | "skeletalMuscleKg"
  | "otherLeanTissueKg"
  | "glycogenKg"
  | "glycogenWaterKg"
  | "ecfDeviationKg"
  | "transientExerciseWaterKg";

export type PhysiologyRuntimeCompartmentV7 = {
  availability: "available";
  valueKg: number;
  provenance: "provided-prior-state" | "carried-forward-prior-state";
  transitionStatus: "known-numeric" | "carried-forward";
  stateHandling: "provided-initial-state" | "carry-forward-for-simulation";
  biologicalTransition: "not-yet-evaluated" | "not-modeled";
  unavailableReason: null;
} | {
  availability: "unavailable";
  valueKg: null;
  provenance: null;
  transitionStatus: "unavailable";
  stateHandling: "state-remains-unavailable";
  biologicalTransition: "not-modeled";
  unavailableReason: string;
};

export type PhysiologyRuntimeStateV7 = {
  contractVersion: typeof PHYSIOLOGY_V7_CONTRACT_VERSION;
  compartments: Record<PhysiologyV7CompartmentKey, PhysiologyRuntimeCompartmentV7>;
  adaptiveThermogenesisKcalPerDay: number | null;
  weightFilterState: PhysiologyV7State["weightFilterState"];
  /** Rebuild lineage only; it is not a biological compartment. */
  lineageFingerprint: string;
};

export type PhysiologyDaySourceV7 = {
  date: string;
  observedWeightKg: number | null;
  observedBodyFatPercent: number | null;
  nutrition: {
    caloriesKcal: number | null;
    proteinG: number | null;
    fatG: number | null;
    carbsG: number | null;
    provenance: NutritionProvenance;
  };
  workoutFeedObserved: boolean | null;
  steps: number | null;
  walkingRunningDistanceKm: number | null;
  workouts: readonly {
    workoutId: number;
    type: string;
    startAt: string;
    endAt: string;
    durationMinutes: number | null;
    activeEnergyKcal: number | null;
  }[];
  stepperWorkouts: readonly WorkoutStepperEvidenceV7[];
  /** Context is retained for audit only and has no Stage-9A transition effect. */
  context: {
    heartRateSampleCount: number;
    restingHeartRateSampleCount: number;
    sleepSegmentCount: number;
    displayMetadata?: unknown;
  };
};

function unavailableReason(field: PhysiologyV7CompartmentKey): string {
  if (field === "skeletalMuscleKg") return "no-defensible-initial-skeletal-muscle-source";
  if (field === "glycogenKg") return "no-defensible-initial-glycogen-source";
  if (field === "glycogenWaterKg") return "no-defensible-initial-glycogen-water-source";
  if (field === "ecfDeviationKg") return "no-defensible-initial-ecf-source";
  if (field === "transientExerciseWaterKg") return "no-defensible-initial-transient-water-source";
  if (field === "fatMassKg") return "no-approved-v7-fat-initialization-source";
  return "no-defensible-other-lean-tissue-source";
}

function initialCompartment(
  field: PhysiologyV7CompartmentKey,
  value: number | null,
): PhysiologyRuntimeCompartmentV7 {
  return value === null ? {
    availability: "unavailable",
    valueKg: null,
    provenance: null,
    transitionStatus: "unavailable",
    stateHandling: "state-remains-unavailable",
    biologicalTransition: "not-modeled",
    unavailableReason: unavailableReason(field),
  } : {
    availability: "available",
    valueKg: value,
    provenance: "provided-prior-state",
    transitionStatus: "known-numeric",
    stateHandling: "provided-initial-state",
    biologicalTransition: "not-yet-evaluated",
    unavailableReason: null,
  };
}

export function runtimeStateFromStructuralStateV7(
  state: PhysiologyV7State,
): PhysiologyRuntimeStateV7 {
  validatePhysiologyV7State(state);
  const compartments = Object.fromEntries(([
    "fatMassKg",
    "skeletalMuscleKg",
    "otherLeanTissueKg",
    "glycogenKg",
    "glycogenWaterKg",
    "ecfDeviationKg",
    "transientExerciseWaterKg",
  ] as const).map((field) => [field, initialCompartment(field, state[field])])) as
    Record<PhysiologyV7CompartmentKey, PhysiologyRuntimeCompartmentV7>;
  return {
    contractVersion: PHYSIOLOGY_V7_CONTRACT_VERSION,
    compartments,
    adaptiveThermogenesisKcalPerDay: state.adaptiveThermogenesisKcalPerDay,
    weightFilterState: state.weightFilterState === null
      ? null
      : { ...state.weightFilterState },
    lineageFingerprint: stableSha256({
      contractVersion: PHYSIOLOGY_V7_CONTRACT_VERSION,
      initialState: state,
    }),
  };
}

export function createUnavailablePhysiologyRuntimeStateV7(): PhysiologyRuntimeStateV7 {
  return runtimeStateFromStructuralStateV7({
    fatMassKg: null,
    skeletalMuscleKg: null,
    otherLeanTissueKg: null,
    glycogenKg: null,
    glycogenWaterKg: null,
    ecfDeviationKg: null,
    transientExerciseWaterKg: null,
    adaptiveThermogenesisKcalPerDay: null,
    weightFilterState: null,
  });
}

export function structuralStateFromRuntimeStateV7(
  state: PhysiologyRuntimeStateV7,
): PhysiologyV7State {
  const value = (field: PhysiologyV7CompartmentKey): number | null => {
    const compartment = state.compartments[field];
    return compartment.availability === "available" ? compartment.valueKg : null;
  };
  return validatePhysiologyV7State({
    fatMassKg: value("fatMassKg"),
    skeletalMuscleKg: value("skeletalMuscleKg"),
    otherLeanTissueKg: value("otherLeanTissueKg"),
    glycogenKg: value("glycogenKg"),
    glycogenWaterKg: value("glycogenWaterKg"),
    ecfDeviationKg: value("ecfDeviationKg"),
    transientExerciseWaterKg: value("transientExerciseWaterKg"),
    adaptiveThermogenesisKcalPerDay: state.adaptiveThermogenesisKcalPerDay,
    weightFilterState: state.weightFilterState === null
      ? null
      : { ...state.weightFilterState },
  });
}

function carryForward(
  prior: PhysiologyRuntimeCompartmentV7,
  reason: string,
): PhysiologyRuntimeCompartmentV7 {
  return prior.availability === "unavailable" ? {
    ...prior,
    unavailableReason: reason,
  } : {
    availability: "available",
    valueKg: prior.valueKg,
    provenance: "carried-forward-prior-state",
    transitionStatus: "carried-forward",
    stateHandling: "carry-forward-for-simulation",
    biologicalTransition: "not-modeled",
    unavailableReason: null,
  };
}

function runtimeSourceFingerprint(
  sources: PhysiologyDaySourceV7,
  exposureHistory: ResistanceTrainingExposureHistoryV7,
): string {
  return stableSha256({
    date: sources.date,
    observations: {
      weightKg: sources.observedWeightKg,
      bodyFatPercent: sources.observedBodyFatPercent,
    },
    nutrition: sources.nutrition,
    activity: {
      workoutFeedObserved: sources.workoutFeedObserved,
      steps: sources.steps,
      walkingRunningDistanceKm: sources.walkingRunningDistanceKm,
      workouts: sources.workouts.map((workout) => ({
        type: workout.type,
        startAt: workout.startAt,
        endAt: workout.endAt,
        durationMinutes: workout.durationMinutes,
      })).sort((left, right) => stableSha256(left).localeCompare(stableSha256(right))),
      stepper: sources.stepperWorkouts.map((workout) => ({
        canonicalWorkoutType: workout.workoutEnergy.canonicalWorkoutType,
        bracketedSteps: workout.bracketedSteps,
      })).sort((left, right) => stableSha256(left).localeCompare(stableSha256(right))),
    },
    exposureHistoryFingerprint: resistanceTrainingExposureHistoryV7Fingerprint(exposureHistory),
  });
}

export function buildPhysiologyDayV7(input: {
  date: string;
  priorState: PhysiologyRuntimeStateV7;
  sources: PhysiologyDaySourceV7;
  exposureHistory: ResistanceTrainingExposureHistoryV7;
}) {
  if (input.sources.date !== input.date) throw new RangeError("source date must match runtime date");
  if (input.exposureHistory.toDate !== input.date) {
    throw new RangeError("exposure history must end on runtime date");
  }
  const priorStructuralState = structuralStateFromRuntimeStateV7(input.priorState);
  const priorStateFingerprint = stableSha256({
    contractVersion: input.priorState.contractVersion,
    compartments: input.priorState.compartments,
    adaptiveThermogenesisKcalPerDay: input.priorState.adaptiveThermogenesisKcalPerDay,
    weightFilterState: input.priorState.weightFilterState,
    lineageFingerprint: input.priorState.lineageFingerprint,
  });
  const inputSourceFingerprint = runtimeSourceFingerprint(input.sources, input.exposureHistory);

  const proteinContext = input.sources.nutrition.proteinG === null
    ? { availability: "unavailable" as const, reason: "missing-protein-source" as const }
    : {
      availability: "available" as const,
      proteinG: input.sources.nutrition.proteinG,
      provenance: input.sources.nutrition.provenance.observedFields.includes("proteinG")
        ? "observed" as const
        : input.sources.nutrition.provenance.source === "imputed-local"
          ? "imputed-local" as const
          : input.sources.nutrition.provenance.source === "imputed-fallback"
            ? "imputed-fallback" as const
            : "observed" as const,
    };
  const adaptationResponse = buildResistanceTrainingAdaptationResponseV7({
    date: input.date,
    exposureHistory: input.exposureHistory,
    proteinContext,
    energyBalanceContext: {
      availability: "unavailable",
      reason: "missing-energy-balance-source",
    },
  });
  const afterTraining = applyTrainingAdaptationTransitionV7({
    state: priorStructuralState,
    response: adaptationResponse,
  });
  const resistanceExposure = input.exposureHistory.days.find(({ date }) => date === input.date) ?? null;
  const fluidWater = buildFluidWaterTransitionPipelineV7({
    localDate: input.date,
    priorState: afterTraining.state,
    carbsG: input.sources.nutrition.carbsG,
    nutrition: input.sources.nutrition.provenance,
    resistanceExposure,
    workoutFeedObserved: input.sources.workoutFeedObserved,
    stepperWorkouts: input.sources.stepperWorkouts,
  });

  const resultingCompartments: PhysiologyRuntimeStateV7["compartments"] = {
    fatMassKg: carryForward(input.priorState.compartments.fatMassKg, "no-approved-v7-fat-transition"),
    skeletalMuscleKg: carryForward(
      input.priorState.compartments.skeletalMuscleKg,
      afterTraining.transition.skeletalMuscleTransition.reason,
    ),
    otherLeanTissueKg: carryForward(
      input.priorState.compartments.otherLeanTissueKg,
      "no-approved-v7-other-lean-transition",
    ),
    glycogenKg: carryForward(
      input.priorState.compartments.glycogenKg,
      fluidWater.glycogen.quantitativeState.reason,
    ),
    glycogenWaterKg: carryForward(
      input.priorState.compartments.glycogenWaterKg,
      fluidWater.glycogenWater.quantitativeState.reason,
    ),
    ecfDeviationKg: carryForward(
      input.priorState.compartments.ecfDeviationKg,
      fluidWater.transientExerciseWaterEcf.ecfDeviation.reason,
    ),
    transientExerciseWaterKg: carryForward(
      input.priorState.compartments.transientExerciseWaterKg,
      fluidWater.transientExerciseWaterEcf.transientExerciseWater.magnitude.reason,
    ),
  };
  const scientificFingerprint = stableSha256({
    contractVersion: PHYSIOLOGY_DAILY_RUNTIME_V7_VERSION,
    date: input.date,
    inputSourceFingerprint,
    priorStateFingerprint,
    trainingAdaptation: afterTraining.transition,
    fluidWaterFingerprint: fluidWater.fingerprint,
    resultingCompartments,
  });
  const resultingState: PhysiologyRuntimeStateV7 = {
    contractVersion: PHYSIOLOGY_V7_CONTRACT_VERSION,
    compartments: resultingCompartments,
    adaptiveThermogenesisKcalPerDay: input.priorState.adaptiveThermogenesisKcalPerDay,
    weightFilterState: input.priorState.weightFilterState === null
      ? null
      : { ...input.priorState.weightFilterState },
    lineageFingerprint: scientificFingerprint,
  };
  const resultingStructuralState = structuralStateFromRuntimeStateV7(resultingState);
  const reconstructedMassKg = reconstructPhysiologyV7MassKg(resultingStructuralState);
  const blockers = Object.values(resultingCompartments)
    .filter((compartment) => compartment.availability === "unavailable")
    .map((compartment) => compartment.unavailableReason)
    .filter((reason, index, values) => values.indexOf(reason) === index)
    .sort();

  return {
    contractVersion: PHYSIOLOGY_DAILY_RUNTIME_V7_VERSION,
    date: input.date,
    transitionOrder: [...PHYSIOLOGY_V7_DAILY_TRANSITION_ORDER],
    inputSourceFingerprint,
    priorStateFingerprint,
    transitionVersions: {
      state: PHYSIOLOGY_V7_CONTRACT_VERSION,
      strengthInput: CANONICAL_STRENGTH_TRAINING_INPUT_V7_VERSION,
      qualifiedResistanceDose: QUALIFIED_RESISTANCE_TRAINING_DOSE_V7_VERSION,
      resistanceExposure: RESISTANCE_TRAINING_EXPOSURE_HISTORY_V7_VERSION,
      adaptationResponse: RESISTANCE_TRAINING_ADAPTATION_RESPONSE_V7_VERSION,
      muscleCalibration: SKELETAL_MUSCLE_RESPONSE_CALIBRATION_V7_VERSION,
      trainingAdaptation: TRAINING_ADAPTATION_TRANSITION_V7_VERSION,
      glycogen: GLYCOGEN_TRANSITION_V7_VERSION,
      glycogenWater: GLYCOGEN_WATER_TRANSITION_V7_VERSION,
      transientExerciseWaterEcf: TRANSIENT_EXERCISE_WATER_ECF_TRANSITION_V7_VERSION,
      fluidWaterPipeline: FLUID_WATER_TRANSITION_PIPELINE_V7_VERSION,
      dailyRuntime: PHYSIOLOGY_DAILY_RUNTIME_V7_VERSION,
    },
    energyNutrition: {
      transitionSlot: "energy-nutrition-transition-slot" as const,
      evidence: structuredClone(input.sources.nutrition),
      fatMassTransition: {
        availability: "unavailable" as const,
        reason: "no-approved-v7-fat-transition" as const,
        biologicalTransition: "not-modeled" as const,
      },
      energyBalance: {
        availability: "unavailable" as const,
        reason: "no-approved-v7-energy-balance-transition" as const,
      },
    },
    trainingAdaptation: afterTraining.transition,
    fluidWater,
    observations: {
      observedWeightKg: input.sources.observedWeightKg === null
        ? { availability: "unavailable" as const, valueKg: null, provenance: null }
        : {
          availability: "available" as const,
          valueKg: input.sources.observedWeightKg,
          provenance: "daily-health-data-observation" as const,
        },
      observedBodyFatPercent: input.sources.observedBodyFatPercent === null
        ? { availability: "unavailable" as const, valuePercent: null, provenance: null }
        : {
          availability: "available" as const,
          valuePercent: input.sources.observedBodyFatPercent,
          provenance: "daily-health-data-observation" as const,
        },
    },
    massReconstruction: reconstructedMassKg === null
      ? {
        availability: "unavailable" as const,
        valueKg: null,
        reason: "one-or-more-required-compartments-unavailable" as const,
      }
      : { availability: "available" as const, valueKg: reconstructedMassKg, reason: null },
    resultingState,
    resultingStructuralStateFingerprint: physiologyV7StateFingerprint(resultingStructuralState),
    provenance: {
      sourceDateSemantics: "profile-local-calendar-date" as const,
      observedWeightIsNotReconstructedMass: true as const,
      heartRateAndSleepAreContextOnly: true as const,
    },
    blockers,
    scientificFingerprint,
    fingerprint: scientificFingerprint,
  };
}

export type PhysiologyDayResultV7 = ReturnType<typeof buildPhysiologyDayV7>;
