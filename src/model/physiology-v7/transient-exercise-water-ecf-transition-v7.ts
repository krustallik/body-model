import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type { GlycogenTransitionV7 } from "./glycogen-transition-v7";
import { validatePhysiologyV7State, type PhysiologyV7State } from "./state";

export const TRANSIENT_EXERCISE_WATER_ECF_TRANSITION_V7_VERSION = "bodycast-transient-exercise-water-ecf-transition-v7-1" as const;

export type TransientExerciseWaterEcfTransitionV7 = {
  contractVersion: typeof TRANSIENT_EXERCISE_WATER_ECF_TRANSITION_V7_VERSION;
  transitionSlot: "fluid-water-transition-slot";
  glycogenTransitionFingerprint: string;
  transientExerciseWater: {
    evidence: "resistance-local-swelling-plausible" | "stepper-fluid-shift-categorically-distinct" | "unresolved" | "no-exercise-trigger-observed" | "unobserved";
    magnitude: { availability: "unavailable"; reason: "no-approved-whole-body-amplitude-or-timing-transition" };
    stateHandling: "carry-forward-for-simulation" | "state-remains-unavailable";
    carriedForwardKg: number | null;
    biologicalTransition: "not-modeled";
  };
  ecfDeviation: {
    availability: "unavailable";
    reason: "no-hydration-sodium-fluid-or-ecf-source-or-transition" | "no-defensible-initial-ecf-source";
    stateHandling: "carry-forward-for-simulation" | "state-remains-unavailable";
    carriedForwardKg: number | null;
    biologicalTransition: "not-modeled";
  };
  compartmentSeparation: {
    glycogenWater: "not-generic-hydration";
    transientExerciseWater: "not-ecf-or-glycogen-water";
    ecfDeviation: "not-a-residual-or-transient-water-bucket";
  };
};

function exerciseEvidence(input: GlycogenTransitionV7): TransientExerciseWaterEcfTransitionV7["transientExerciseWater"]["evidence"] {
  if (input.exerciseEvidence.strength === "qualified-depletion-pressure") return "resistance-local-swelling-plausible";
  if (input.exerciseEvidence.stepper === "endurance-depletion-pressure") return "stepper-fluid-shift-categorically-distinct";
  if (input.exerciseEvidence.strength === "unresolved") return "unresolved";
  if (input.exerciseEvidence.strength === "unobserved" || input.exerciseEvidence.stepper === "unobserved") return "unobserved";
  return "no-exercise-trigger-observed";
}

export function buildTransientExerciseWaterEcfTransitionV7(input: {
  priorTransientExerciseWaterKg: number | null;
  priorEcfDeviationKg: number | null;
  glycogenTransition: GlycogenTransitionV7;
  glycogenTransitionFingerprint: string;
}): TransientExerciseWaterEcfTransitionV7 {
  for (const [field, value] of Object.entries({ transient: input.priorTransientExerciseWaterKg, ecf: input.priorEcfDeviationKg })) {
    if (value !== null && !Number.isFinite(value)) throw new RangeError(`${field} must be finite when available`);
  }
  if (input.priorTransientExerciseWaterKg !== null && input.priorTransientExerciseWaterKg < 0) throw new RangeError("transient must be nonnegative");
  return {
    contractVersion: TRANSIENT_EXERCISE_WATER_ECF_TRANSITION_V7_VERSION,
    transitionSlot: "fluid-water-transition-slot",
    glycogenTransitionFingerprint: input.glycogenTransitionFingerprint,
    transientExerciseWater: {
      evidence: exerciseEvidence(input.glycogenTransition),
      magnitude: { availability: "unavailable", reason: "no-approved-whole-body-amplitude-or-timing-transition" },
      stateHandling: input.priorTransientExerciseWaterKg === null ? "state-remains-unavailable" : "carry-forward-for-simulation",
      carriedForwardKg: input.priorTransientExerciseWaterKg,
      biologicalTransition: "not-modeled",
    },
    ecfDeviation: {
      availability: "unavailable",
      reason: input.priorEcfDeviationKg === null ? "no-defensible-initial-ecf-source" : "no-hydration-sodium-fluid-or-ecf-source-or-transition",
      stateHandling: input.priorEcfDeviationKg === null ? "state-remains-unavailable" : "carry-forward-for-simulation",
      carriedForwardKg: input.priorEcfDeviationKg,
      biologicalTransition: "not-modeled",
    },
    compartmentSeparation: {
      glycogenWater: "not-generic-hydration",
      transientExerciseWater: "not-ecf-or-glycogen-water",
      ecfDeviation: "not-a-residual-or-transient-water-bucket",
    },
  };
}

export function transientExerciseWaterEcfTransitionV7Fingerprint(transition: TransientExerciseWaterEcfTransitionV7): string {
  return stableSha256({ contractVersion: transition.contractVersion, glycogenTransitionFingerprint: transition.glycogenTransitionFingerprint, transientEvidence: transition.transientExerciseWater.evidence, ecfAvailability: transition.ecfDeviation.availability, separation: transition.compartmentSeparation });
}

export function applyTransientExerciseWaterEcfTransitionV7(input: { state: PhysiologyV7State; transition: TransientExerciseWaterEcfTransitionV7 }): { state: PhysiologyV7State; transition: TransientExerciseWaterEcfTransitionV7 } {
  validatePhysiologyV7State(input.state);
  return { state: { ...input.state, transientExerciseWaterKg: input.transition.transientExerciseWater.carriedForwardKg, ecfDeviationKg: input.transition.ecfDeviation.carriedForwardKg }, transition: structuredClone(input.transition) };
}
