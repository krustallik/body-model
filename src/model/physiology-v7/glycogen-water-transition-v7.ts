import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type { GlycogenTransitionV7 } from "./glycogen-transition-v7";
import { validatePhysiologyV7State, type PhysiologyV7State } from "./state";

/** Qualitative-only Stage-8 water-accounting boundary; deliberately no ratio or kg delta. */
export const GLYCOGEN_WATER_TRANSITION_V7_VERSION = "bodycast-glycogen-water-transition-v7-1" as const;

export type GlycogenWaterTransitionV7 = {
  contractVersion: typeof GLYCOGEN_WATER_TRANSITION_V7_VERSION;
  transitionSlot: "fluid-water-transition-slot";
  glycogenTransitionFingerprint: string;
  quantitativeState: {
    availability: "unavailable";
    reason: "no-approved-glycogen-water-ratio-or-transition" | "no-defensible-initial-glycogen-water-source";
    stateHandling: "carry-forward-for-simulation" | "state-remains-unavailable";
    carriedForwardGlycogenWaterKg: number | null;
    biologicalTransition: "not-modeled";
  };
  directionalRelationship:
    | "decrease-plausible-from-glycogen-depletion-evidence"
    | "increase-plausible-from-glycogen-repletion-evidence"
    | "both-directions-evidence-present-magnitude-and-ordering-unresolved"
    | "unresolved";
  magnitude: { availability: "unavailable"; reason: "no-approved-glycogen-water-ratio-or-transition" };
  compartmentSeparation: {
    glycogenAssociatedWater: "separate-compartment";
    ecfDeviation: "not-a-fallback-or-residual";
    transientExerciseWater: "not-post-workout-edema";
  };
  blockers: Array<
    | "no-approved-glycogen-water-ratio-or-transition"
    | "no-defensible-initial-glycogen-water-source"
    | "unresolved-glycogen-source-evidence"
  >;
};

function direction(input: GlycogenTransitionV7): GlycogenWaterTransitionV7["directionalRelationship"] {
  const decrease = input.depletionEvidence === "present";
  const increase = input.repletionEvidence === "present-observed" || input.repletionEvidence === "present-imputed";
  if (decrease && increase) return "both-directions-evidence-present-magnitude-and-ordering-unresolved";
  if (decrease) return "decrease-plausible-from-glycogen-depletion-evidence";
  if (increase) return "increase-plausible-from-glycogen-repletion-evidence";
  return "unresolved";
}

export function buildGlycogenWaterTransitionV7(input: {
  priorGlycogenWaterKg: number | null;
  glycogenTransition: GlycogenTransitionV7;
  glycogenTransitionFingerprint: string;
}): GlycogenWaterTransitionV7 {
  if (input.priorGlycogenWaterKg !== null && (!Number.isFinite(input.priorGlycogenWaterKg) || input.priorGlycogenWaterKg < 0)) {
    throw new RangeError("priorGlycogenWaterKg must be finite and nonnegative when available");
  }
  const blockers: GlycogenWaterTransitionV7["blockers"] = ["no-approved-glycogen-water-ratio-or-transition"];
  if (input.priorGlycogenWaterKg === null) blockers.push("no-defensible-initial-glycogen-water-source");
  if (input.glycogenTransition.sourceCoverage === "unresolved") blockers.push("unresolved-glycogen-source-evidence");
  return {
    contractVersion: GLYCOGEN_WATER_TRANSITION_V7_VERSION,
    transitionSlot: "fluid-water-transition-slot",
    glycogenTransitionFingerprint: input.glycogenTransitionFingerprint,
    quantitativeState: input.priorGlycogenWaterKg === null
      ? { availability: "unavailable", reason: "no-defensible-initial-glycogen-water-source", stateHandling: "state-remains-unavailable", carriedForwardGlycogenWaterKg: null, biologicalTransition: "not-modeled" }
      : { availability: "unavailable", reason: "no-approved-glycogen-water-ratio-or-transition", stateHandling: "carry-forward-for-simulation", carriedForwardGlycogenWaterKg: input.priorGlycogenWaterKg, biologicalTransition: "not-modeled" },
    directionalRelationship: direction(input.glycogenTransition),
    magnitude: { availability: "unavailable", reason: "no-approved-glycogen-water-ratio-or-transition" },
    compartmentSeparation: {
      glycogenAssociatedWater: "separate-compartment",
      ecfDeviation: "not-a-fallback-or-residual",
      transientExerciseWater: "not-post-workout-edema",
    },
    blockers,
  };
}

/** Evidence identity deliberately excludes HR, device energy, tonnage, and display metadata. */
export function glycogenWaterTransitionV7Fingerprint(transition: GlycogenWaterTransitionV7): string {
  return stableSha256({
    contractVersion: transition.contractVersion,
    glycogenTransitionFingerprint: transition.glycogenTransitionFingerprint,
    directionalRelationship: transition.directionalRelationship,
    magnitude: transition.magnitude,
    blockers: transition.blockers,
  });
}

/** Carry-forward keeps simulator continuity only; it never asserts zero water biology. */
export function applyGlycogenWaterTransitionV7(input: {
  state: PhysiologyV7State;
  transition: GlycogenWaterTransitionV7;
}): { state: PhysiologyV7State; transition: GlycogenWaterTransitionV7 } {
  validatePhysiologyV7State(input.state);
  return {
    state: { ...input.state, glycogenWaterKg: input.transition.quantitativeState.carriedForwardGlycogenWaterKg },
    transition: structuredClone(input.transition),
  };
}
