import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type { GlycogenTransitionV7 } from "./glycogen-transition-v7";
import { validatePhysiologyV7State, type PhysiologyV7State } from "./state";

export const TRANSIENT_EXERCISE_WATER_ECF_TRANSITION_V7_VERSION =
  "bodycast-transient-exercise-water-ecf-transition-v7-2" as const;

/**
 * C-J01: acute post-exercise swelling routes to transient-water context only;
 * never skeletalMuscleKg tissue gain. No approved amplitude/decay coefficient.
 */
export const ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7 = {
  conversion: "acute-swelling-to-skeletal-muscle-kg",
  application: "intentionally-rejected",
  destination: "transientExerciseWaterKg",
  skeletalMuscleInterpretation: "not-skeletal-muscle-tissue",
  claimId: "C-J01",
  scientificDecision: "acute-swelling-is-not-muscle-tissue",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type AcuteSwellingNotSkeletalMusclePolicyV7 =
  typeof ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7;

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
  acuteSwellingClassification: {
    destination: "transient-exercise-water-context";
    mayEnterSkeletalMuscleKg: false;
    policy: AcuteSwellingNotSkeletalMusclePolicyV7;
  };
};

function exerciseEvidence(input: GlycogenTransitionV7): TransientExerciseWaterEcfTransitionV7["transientExerciseWater"]["evidence"] {
  if (input.exerciseEvidence.strength === "qualified-depletion-pressure") return "resistance-local-swelling-plausible";
  if (input.exerciseEvidence.stepper === "endurance-depletion-pressure") return "stepper-fluid-shift-categorically-distinct";
  if (input.exerciseEvidence.strength === "unresolved") return "unresolved";
  if (input.exerciseEvidence.strength === "unobserved" || input.exerciseEvidence.stepper === "unobserved") return "unobserved";
  return "no-exercise-trigger-observed";
}

export function classifyAcuteSwellingDestinationV7(): {
  destination: "transient-exercise-water-context";
  mayEnterSkeletalMuscleKg: false;
  policy: AcuteSwellingNotSkeletalMusclePolicyV7;
} {
  return {
    destination: "transient-exercise-water-context",
    mayEnterSkeletalMuscleKg: false,
    policy: ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7,
  };
}

export function rejectAcuteSwellingAsSkeletalMuscleV7(input: {
  skeletalMuscleKg: number | null;
  swellingSignal?: {
    localThicknessChangePercent?: number | null;
    bodyWeightRiseKg?: number | null;
  } | null;
}): {
  accepted: false;
  reason: "acute-swelling-is-not-skeletal-muscle-tissue";
  policy: AcuteSwellingNotSkeletalMusclePolicyV7;
  destination: "transientExerciseWaterKg";
  priorSkeletalMuscleKg: number | null;
  resultingSkeletalMuscleKg: number | null;
} {
  if (input.skeletalMuscleKg !== null
      && (!Number.isFinite(input.skeletalMuscleKg) || input.skeletalMuscleKg < 0)) {
    throw new RangeError("skeletalMuscleKg must be finite and nonnegative when available");
  }
  const signal = input.swellingSignal ?? null;
  if (signal?.localThicknessChangePercent != null
      && !Number.isFinite(signal.localThicknessChangePercent)) {
    throw new RangeError("localThicknessChangePercent must be finite when available");
  }
  if (signal?.bodyWeightRiseKg != null && !Number.isFinite(signal.bodyWeightRiseKg)) {
    throw new RangeError("bodyWeightRiseKg must be finite when available");
  }
  return {
    accepted: false,
    reason: "acute-swelling-is-not-skeletal-muscle-tissue",
    policy: ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7,
    destination: "transientExerciseWaterKg",
    priorSkeletalMuscleKg: input.skeletalMuscleKg,
    resultingSkeletalMuscleKg: input.skeletalMuscleKg,
  };
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
    acuteSwellingClassification: classifyAcuteSwellingDestinationV7(),
  };
}

export function transientExerciseWaterEcfTransitionV7Fingerprint(transition: TransientExerciseWaterEcfTransitionV7): string {
  return stableSha256({
    contractVersion: transition.contractVersion,
    glycogenTransitionFingerprint: transition.glycogenTransitionFingerprint,
    transientEvidence: transition.transientExerciseWater.evidence,
    ecfAvailability: transition.ecfDeviation.availability,
    separation: transition.compartmentSeparation,
    acuteSwellingClassification: transition.acuteSwellingClassification,
  });
}

/**
 * Apply fluid-water carry-forward only. Acute swelling evidence never rewrites
 * skeletalMuscleKg (C-J01).
 */
export function applyTransientExerciseWaterEcfTransitionV7(input: {
  state: PhysiologyV7State;
  transition: TransientExerciseWaterEcfTransitionV7;
}): {
  state: PhysiologyV7State;
  transition: TransientExerciseWaterEcfTransitionV7;
  skeletalMuscleFromSwelling: ReturnType<typeof rejectAcuteSwellingAsSkeletalMuscleV7>;
} {
  validatePhysiologyV7State(input.state);
  const skeletalMuscleFromSwelling = rejectAcuteSwellingAsSkeletalMuscleV7({
    skeletalMuscleKg: input.state.skeletalMuscleKg,
  });
  return {
    state: {
      ...input.state,
      skeletalMuscleKg: skeletalMuscleFromSwelling.resultingSkeletalMuscleKg,
      transientExerciseWaterKg: input.transition.transientExerciseWater.carriedForwardKg,
      ecfDeviationKg: input.transition.ecfDeviation.carriedForwardKg,
    },
    transition: structuredClone(input.transition),
    skeletalMuscleFromSwelling,
  };
}
