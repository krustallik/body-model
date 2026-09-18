import {
  resistanceTrainingAdaptationResponseV7Fingerprint,
  type ResistanceTrainingAdaptationResponseV7,
} from "@/model/physiology-v7/resistance-training-adaptation-response-v7";
import {
  validatePhysiologyV7State,
  type PhysiologyV7State,
} from "@/model/physiology-v7/state";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Executable implementation of the v7 `training-adaptation-transition-slot`.
 * It is an integration boundary, not a skeletal-muscle physiology equation.
 * The Stage-7 response includes the qualified dose, exposure history, and
 * calibration decision needed to explain why a numeric transition is absent.
 */
export const TRAINING_ADAPTATION_TRANSITION_V7_VERSION =
  "bodycast-training-adaptation-transition-v7-1" as const;

export type SkeletalMuscleTransitionHandlingV7 =
  | {
    availability: "unavailable";
    reason: "no-approved-whole-body-calibration";
    stateHandling: "carry-forward-for-simulation";
    carriedForwardSkeletalMuscleKg: number;
    biologicalTransition: "not-modeled";
  }
  | {
    availability: "unavailable";
    reason: "no-defensible-initial-skeletal-muscle-source";
    stateHandling: "state-remains-unavailable";
    carriedForwardSkeletalMuscleKg: null;
    biologicalTransition: "not-modeled";
  };

export type TrainingAdaptationTransitionV7 = {
  contractVersion: typeof TRAINING_ADAPTATION_TRANSITION_V7_VERSION;
  transitionSlot: "training-adaptation-transition-slot";
  /** Full Stage-7 evidence is retained for replay, audit, and downstream output. */
  response: ResistanceTrainingAdaptationResponseV7;
  responseFingerprint: string;
  skeletalMuscleTransition: SkeletalMuscleTransitionHandlingV7;
};

/**
 * Applies the currently approved calibration decision to the v7 state seam.
 * Carry-forward is simulator bookkeeping only and must never be interpreted as
 * observed zero biological change.
 */
export function buildTrainingAdaptationTransitionV7(input: {
  priorSkeletalMuscleKg: number | null;
  response: ResistanceTrainingAdaptationResponseV7;
}): TrainingAdaptationTransitionV7 {
  if (input.priorSkeletalMuscleKg !== null && (!Number.isFinite(input.priorSkeletalMuscleKg) || input.priorSkeletalMuscleKg < 0)) {
    throw new RangeError("priorSkeletalMuscleKg must be a nonnegative finite value when available");
  }
  const responseFingerprint = resistanceTrainingAdaptationResponseV7Fingerprint(input.response);
  const skeletalMuscleTransition: SkeletalMuscleTransitionHandlingV7 = input.priorSkeletalMuscleKg === null
    ? {
      availability: "unavailable",
      reason: "no-defensible-initial-skeletal-muscle-source",
      stateHandling: "state-remains-unavailable",
      carriedForwardSkeletalMuscleKg: null,
      biologicalTransition: "not-modeled",
    }
    : {
      availability: "unavailable",
      reason: input.response.calibration.quantitativeTransition.reason,
      stateHandling: "carry-forward-for-simulation",
      carriedForwardSkeletalMuscleKg: input.priorSkeletalMuscleKg,
      biologicalTransition: "not-modeled",
    };
  return {
    contractVersion: TRAINING_ADAPTATION_TRANSITION_V7_VERSION,
    transitionSlot: "training-adaptation-transition-slot",
    response: structuredClone(input.response),
    responseFingerprint,
    skeletalMuscleTransition,
  };
}

/**
 * State-level adapter for the declared v7 daily transition slot. No v6 state,
 * persistence record, or generic lean-tissue field participates in this path.
 */
export function applyTrainingAdaptationTransitionV7(input: {
  state: PhysiologyV7State;
  response: ResistanceTrainingAdaptationResponseV7;
}): { state: PhysiologyV7State; transition: TrainingAdaptationTransitionV7 } {
  validatePhysiologyV7State(input.state);
  const transition = buildTrainingAdaptationTransitionV7({
    priorSkeletalMuscleKg: input.state.skeletalMuscleKg,
    response: input.response,
  });
  return {
    state: {
      ...input.state,
      skeletalMuscleKg: transition.skeletalMuscleTransition.carriedForwardSkeletalMuscleKg,
    },
    transition,
  };
}

export function trainingAdaptationTransitionV7Fingerprint(
  transition: TrainingAdaptationTransitionV7,
): string {
  return stableSha256({
    contractVersion: transition.contractVersion,
    transitionSlot: transition.transitionSlot,
    responseFingerprint: transition.responseFingerprint,
    skeletalMuscleTransition: transition.skeletalMuscleTransition,
  });
}
