import type { WorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import type { NutritionProvenance } from "@/modules/model-episodes/model-episode.types";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type { ResistanceTrainingDayExposureV7 } from "./resistance-training-exposure-history-v7";
import { validatePhysiologyV7State, type PhysiologyV7State } from "./state";

/** Qualitative-only Stage-8 boundary; deliberately has no kg transition. */
export const GLYCOGEN_TRANSITION_V7_VERSION = "bodycast-glycogen-transition-v7-1" as const;

export type GlycogenCarbohydrateEvidenceV7 =
  | { availability: "available"; provenance: "observed"; carbsG: number }
  | { availability: "available"; provenance: "imputed"; carbsG: number }
  | { availability: "unavailable"; reason: "missing-carbohydrate" };

export function glycogenCarbohydrateEvidenceV7(input: {
  carbsG: number | null;
  nutrition: NutritionProvenance;
}): GlycogenCarbohydrateEvidenceV7 {
  if (input.carbsG === null) return { availability: "unavailable", reason: "missing-carbohydrate" };
  if (!Number.isFinite(input.carbsG) || input.carbsG < 0) throw new RangeError("carbsG must be finite and nonnegative when available");
  return input.nutrition.source === "observed"
    ? { availability: "available", provenance: "observed", carbsG: input.carbsG }
    : { availability: "available", provenance: "imputed", carbsG: input.carbsG };
}

export type GlycogenExerciseEvidenceV7 = {
  strength: "qualified-depletion-pressure" | "unresolved" | "observed-no-exposure" | "unobserved";
  stepper: "endurance-depletion-pressure" | "observed-no-stepper" | "unobserved";
};

function strengthEvidence(day: ResistanceTrainingDayExposureV7 | null, workoutFeedObserved: boolean | null): GlycogenExerciseEvidenceV7["strength"] {
  if (day === null) return workoutFeedObserved === true ? "observed-no-exposure" : "unobserved";
  if (day.kind === "unobserved") return "unobserved";
  if (day.kind === "unresolved-dose") return "unresolved";
  if (day.kind === "observed-no-exposure") return "observed-no-exposure";
  return day.mappedSetCount > 0 ? "qualified-depletion-pressure" : "unresolved";
}

function stepperEvidence(input: {
  workoutFeedObserved: boolean | null;
  stepperWorkouts: readonly WorkoutStepperEvidenceV7[];
}): GlycogenExerciseEvidenceV7["stepper"] {
  if (input.workoutFeedObserved !== true) return "unobserved";
  return input.stepperWorkouts.some((workout) => workout.workoutEnergy.canonicalWorkoutType === "Stair Climbing")
    ? "endurance-depletion-pressure"
    : "observed-no-stepper";
}

export type GlycogenTransitionV7 = {
  contractVersion: typeof GLYCOGEN_TRANSITION_V7_VERSION;
  transitionSlot: "glycogen-transition-slot";
  quantitativeState: {
    availability: "unavailable";
    reason: "no-approved-quantitative-glycogen-transition" | "no-defensible-initial-glycogen-source";
    stateHandling: "carry-forward-for-simulation" | "state-remains-unavailable";
    carriedForwardGlycogenKg: number | null;
    biologicalTransition: "not-modeled";
  };
  carbohydrateEvidence: GlycogenCarbohydrateEvidenceV7;
  exerciseEvidence: GlycogenExerciseEvidenceV7;
  depletionEvidence: "present" | "absent" | "unresolved";
  repletionEvidence: "present-observed" | "present-imputed" | "unavailable";
  sourceCoverage: "complete-for-qualitative-boundary" | "partial" | "unresolved";
  /** Replay identity contains only source evidence relevant to this boundary. */
  provenance: {
    workoutFeedObserved: boolean | null;
    resistance: { date: string; kind: ResistanceTrainingDayExposureV7["kind"]; mappedSetCount: number; recordedSetCount: number; unmappedSetCount: number; legacyStrengthWorkoutCount: number } | null;
    stepper: Array<{ workoutId: number; canonicalWorkoutType: string | null; startAt: string; endAt: string; durationMinutes: number | null; bracketedStepAvailability: "available" | "unavailable" }>;
  };
  blockers: Array<
    | "no-approved-quantitative-glycogen-transition"
    | "no-defensible-initial-glycogen-source"
    | "missing-carbohydrate"
    | "unresolved-workout-evidence"
  >;
};

export function buildGlycogenTransitionV7(input: {
  priorGlycogenKg: number | null;
  carbohydrate: GlycogenCarbohydrateEvidenceV7;
  resistanceExposure: ResistanceTrainingDayExposureV7 | null;
  workoutFeedObserved: boolean | null;
  stepperWorkouts: readonly WorkoutStepperEvidenceV7[];
}): GlycogenTransitionV7 {
  if (input.priorGlycogenKg !== null && (!Number.isFinite(input.priorGlycogenKg) || input.priorGlycogenKg < 0)) {
    throw new RangeError("priorGlycogenKg must be finite and nonnegative when available");
  }
  const exerciseEvidence = {
    strength: strengthEvidence(input.resistanceExposure, input.workoutFeedObserved),
    stepper: stepperEvidence(input),
  } as const;
  const depletionEvidence = exerciseEvidence.strength === "qualified-depletion-pressure"
    || exerciseEvidence.stepper === "endurance-depletion-pressure"
    ? "present"
    : exerciseEvidence.strength === "unresolved" || exerciseEvidence.strength === "unobserved" || exerciseEvidence.stepper === "unobserved"
      ? "unresolved"
      : "absent";
  const repletionEvidence = input.carbohydrate.availability === "unavailable"
    ? "unavailable"
    : input.carbohydrate.provenance === "observed" ? "present-observed" : "present-imputed";
  const blockers: GlycogenTransitionV7["blockers"] = ["no-approved-quantitative-glycogen-transition"];
  if (input.priorGlycogenKg === null) blockers.push("no-defensible-initial-glycogen-source");
  if (input.carbohydrate.availability === "unavailable") blockers.push("missing-carbohydrate");
  if (depletionEvidence === "unresolved") blockers.push("unresolved-workout-evidence");
  const provenance: GlycogenTransitionV7["provenance"] = {
    workoutFeedObserved: input.workoutFeedObserved,
    resistance: input.resistanceExposure === null ? null : {
      date: input.resistanceExposure.date,
      kind: input.resistanceExposure.kind,
      mappedSetCount: input.resistanceExposure.mappedSetCount,
      recordedSetCount: input.resistanceExposure.recordedSetCount,
      unmappedSetCount: input.resistanceExposure.unmappedSetCount,
      legacyStrengthWorkoutCount: input.resistanceExposure.legacyStrengthWorkouts.length,
    },
    stepper: input.stepperWorkouts.map((workout) => ({
      workoutId: workout.workoutEnergy.workoutId,
      canonicalWorkoutType: workout.workoutEnergy.canonicalWorkoutType,
      startAt: workout.workoutEnergy.startAt,
      endAt: workout.workoutEnergy.endAt,
      durationMinutes: workout.workoutEnergy.durationMinutes,
      bracketedStepAvailability: workout.bracketedSteps.availability,
    })),
  };
  return {
    contractVersion: GLYCOGEN_TRANSITION_V7_VERSION,
    transitionSlot: "glycogen-transition-slot",
    quantitativeState: input.priorGlycogenKg === null
      ? { availability: "unavailable", reason: "no-defensible-initial-glycogen-source", stateHandling: "state-remains-unavailable", carriedForwardGlycogenKg: null, biologicalTransition: "not-modeled" }
      : { availability: "unavailable", reason: "no-approved-quantitative-glycogen-transition", stateHandling: "carry-forward-for-simulation", carriedForwardGlycogenKg: input.priorGlycogenKg, biologicalTransition: "not-modeled" },
    carbohydrateEvidence: structuredClone(input.carbohydrate),
    exerciseEvidence,
    depletionEvidence,
    repletionEvidence,
    sourceCoverage: input.carbohydrate.availability === "unavailable" || depletionEvidence === "unresolved"
      ? "unresolved"
      : "complete-for-qualitative-boundary",
    provenance,
    blockers,
  };
}

/** Evidence identity excludes HR, device calories, display names, and tonnage. */
export function glycogenTransitionV7Fingerprint(transition: GlycogenTransitionV7): string {
  return stableSha256({
    contractVersion: transition.contractVersion,
    carbohydrateEvidence: transition.carbohydrateEvidence,
    exerciseEvidence: transition.exerciseEvidence,
    depletionEvidence: transition.depletionEvidence,
    repletionEvidence: transition.repletionEvidence,
    sourceCoverage: transition.sourceCoverage,
    provenance: transition.provenance,
    blockers: transition.blockers,
  });
}

/** State adapter: carry-forward is bookkeeping, never a zero biological delta. */
export function applyGlycogenTransitionV7(input: {
  state: PhysiologyV7State;
  transition: GlycogenTransitionV7;
}): { state: PhysiologyV7State; transition: GlycogenTransitionV7 } {
  validatePhysiologyV7State(input.state);
  return {
    state: { ...input.state, glycogenKg: input.transition.quantitativeState.carriedForwardGlycogenKg },
    transition: structuredClone(input.transition),
  };
}
