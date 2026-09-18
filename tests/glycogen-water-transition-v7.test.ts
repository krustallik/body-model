import { describe, expect, it } from "vitest";
import {
  applyGlycogenWaterTransitionV7,
  buildGlycogenWaterTransitionV7,
  glycogenWaterTransitionV7Fingerprint,
} from "@/model/physiology-v7/glycogen-water-transition-v7";
import type { GlycogenTransitionV7 } from "@/model/physiology-v7/glycogen-transition-v7";
import {
  GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7,
  GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
  GLYCOGEN_TRANSITION_V7_VERSION,
} from "@/model/physiology-v7/glycogen-transition-v7";
import { reconstructPhysiologyV7MassKg, type PhysiologyV7State } from "@/model/physiology-v7/state";

function glycogen(input: Partial<Pick<GlycogenTransitionV7, "depletionEvidence" | "repletionEvidence" | "sourceCoverage">> = {}): GlycogenTransitionV7 {
  return {
    contractVersion: GLYCOGEN_TRANSITION_V7_VERSION, transitionSlot: "glycogen-transition-slot",
    quantitativeState: { availability: "unavailable", reason: "no-defensible-initial-glycogen-source", stateHandling: "state-remains-unavailable", carriedForwardGlycogenKg: null, biologicalTransition: "not-modeled" },
    carbohydrateEvidence: { availability: "unavailable", reason: "missing-carbohydrate" },
    carbohydrateTimingPolicy: GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7,
    proteinContribution: {
      availability: "unavailable",
      reason: "missing-protein",
      repletionEffect: "none",
      independentBonus: GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
    },
    exerciseEvidence: { strength: "observed-no-exposure", stepper: "observed-no-stepper" },
    depletionEvidence: "absent", repletionEvidence: "unavailable", sourceCoverage: "complete-for-qualitative-boundary",
    provenance: { workoutFeedObserved: true, resistance: null, stepper: [] },
    blockers: ["no-approved-quantitative-glycogen-transition"], ...input,
  };
}

const state = (glycogenWaterKg: number | null): PhysiologyV7State => ({
  fatMassKg: 18, skeletalMuscleKg: 28, otherLeanTissueKg: 17, glycogenKg: null, glycogenWaterKg,
  ecfDeviationKg: -0.3, transientExerciseWaterKg: 0.2, adaptiveThermogenesisKcalPerDay: 0,
  weightFilterState: { estimatedWeightKg: 64.5, varianceKg2: 1 },
});

describe("Stage 8C glycogen-associated water boundary", () => {
  it("keeps quantitative water unavailable when glycogen is unavailable and never emits a kg delta", () => {
    const result = buildGlycogenWaterTransitionV7({ priorGlycogenWaterKg: null, glycogenTransition: glycogen(), glycogenTransitionFingerprint: "g-1" });
    expect(result.quantitativeState).toMatchObject({ availability: "unavailable", carriedForwardGlycogenWaterKg: null, biologicalTransition: "not-modeled" });
    expect(result.magnitude).toEqual({ availability: "unavailable", reason: "no-approved-glycogen-water-ratio-or-transition" });
    expect(result).not.toHaveProperty("glycogenWaterDeltaKg");
  });

  it("preserves directional depletion/repletion evidence without a fixed ratio or magnitude", () => {
    expect(buildGlycogenWaterTransitionV7({ priorGlycogenWaterKg: null, glycogenTransition: glycogen({ depletionEvidence: "present" }), glycogenTransitionFingerprint: "down" }).directionalRelationship)
      .toBe("decrease-plausible-from-glycogen-depletion-evidence");
    expect(buildGlycogenWaterTransitionV7({ priorGlycogenWaterKg: null, glycogenTransition: glycogen({ repletionEvidence: "present-observed" }), glycogenTransitionFingerprint: "up" }).directionalRelationship)
      .toBe("increase-plausible-from-glycogen-repletion-evidence");
  });

  it("carries prior water only for simulation and keeps ECF/transient water separate", () => {
    const transition = buildGlycogenWaterTransitionV7({ priorGlycogenWaterKg: 1.1, glycogenTransition: glycogen(), glycogenTransitionFingerprint: "g-1" });
    expect(transition.quantitativeState).toMatchObject({ stateHandling: "carry-forward-for-simulation", carriedForwardGlycogenWaterKg: 1.1, biologicalTransition: "not-modeled" });
    expect(transition.compartmentSeparation).toEqual({ glycogenAssociatedWater: "separate-compartment", ecfDeviation: "not-a-fallback-or-residual", transientExerciseWater: "not-post-workout-edema" });
    expect(applyGlycogenWaterTransitionV7({ state: state(1.1), transition }).state.glycogenWaterKg).toBe(1.1);
  });

  it("keeps mass reconstruction unavailable rather than substituting unknown glycogen water with zero and fingerprints deterministically", () => {
    expect(reconstructPhysiologyV7MassKg(state(null))).toBeNull();
    const transition = buildGlycogenWaterTransitionV7({ priorGlycogenWaterKg: null, glycogenTransition: glycogen(), glycogenTransitionFingerprint: "g-1" });
    expect(glycogenWaterTransitionV7Fingerprint(transition)).toBe(glycogenWaterTransitionV7Fingerprint(transition));
  });
});
