import { describe, expect, it } from "vitest";
import { buildTransientExerciseWaterEcfTransitionV7, transientExerciseWaterEcfTransitionV7Fingerprint } from "@/model/physiology-v7/transient-exercise-water-ecf-transition-v7";
import type { GlycogenTransitionV7 } from "@/model/physiology-v7/glycogen-transition-v7";
import { reconstructPhysiologyV7MassKg, type PhysiologyV7State } from "@/model/physiology-v7/state";

function glycogen(strength: GlycogenTransitionV7["exerciseEvidence"]["strength"], stepper: GlycogenTransitionV7["exerciseEvidence"]["stepper"]): GlycogenTransitionV7 {
  return { contractVersion: "bodycast-glycogen-transition-v7-1", transitionSlot: "glycogen-transition-slot", quantitativeState: { availability: "unavailable", reason: "no-defensible-initial-glycogen-source", stateHandling: "state-remains-unavailable", carriedForwardGlycogenKg: null, biologicalTransition: "not-modeled" }, carbohydrateEvidence: { availability: "unavailable", reason: "missing-carbohydrate" }, exerciseEvidence: { strength, stepper }, depletionEvidence: "absent", repletionEvidence: "unavailable", sourceCoverage: "complete-for-qualitative-boundary", provenance: { workoutFeedObserved: true, resistance: null, stepper: [] }, blockers: ["no-approved-quantitative-glycogen-transition"] };
}

describe("Stage 8D transient exercise water and ECF", () => {
  it("keeps resistance swelling and stepper fluid-shift evidence categorically distinct and magnitude unavailable", () => {
    const resistance = buildTransientExerciseWaterEcfTransitionV7({ priorTransientExerciseWaterKg: null, priorEcfDeviationKg: null, glycogenTransition: glycogen("qualified-depletion-pressure", "observed-no-stepper"), glycogenTransitionFingerprint: "r" });
    const stepper = buildTransientExerciseWaterEcfTransitionV7({ priorTransientExerciseWaterKg: null, priorEcfDeviationKg: null, glycogenTransition: glycogen("observed-no-exposure", "endurance-depletion-pressure"), glycogenTransitionFingerprint: "s" });
    expect(resistance.transientExerciseWater.evidence).toBe("resistance-local-swelling-plausible");
    expect(stepper.transientExerciseWater.evidence).toBe("stepper-fluid-shift-categorically-distinct");
    expect(resistance.transientExerciseWater.magnitude.availability).toBe("unavailable");
  });

  it("preserves unresolved/unobserved/no-exercise semantics and never derives ECF", () => {
    expect(buildTransientExerciseWaterEcfTransitionV7({ priorTransientExerciseWaterKg: null, priorEcfDeviationKg: null, glycogenTransition: glycogen("unresolved", "observed-no-stepper"), glycogenTransitionFingerprint: "u" }).transientExerciseWater.evidence).toBe("unresolved");
    expect(buildTransientExerciseWaterEcfTransitionV7({ priorTransientExerciseWaterKg: null, priorEcfDeviationKg: null, glycogenTransition: glycogen("unobserved", "unobserved"), glycogenTransitionFingerprint: "x" }).transientExerciseWater.evidence).toBe("unobserved");
    const none = buildTransientExerciseWaterEcfTransitionV7({ priorTransientExerciseWaterKg: null, priorEcfDeviationKg: null, glycogenTransition: glycogen("observed-no-exposure", "observed-no-stepper"), glycogenTransitionFingerprint: "n" });
    expect(none.transientExerciseWater.evidence).toBe("no-exercise-trigger-observed");
    expect(none.ecfDeviation).toMatchObject({ availability: "unavailable", carriedForwardKg: null, biologicalTransition: "not-modeled" });
  });

  it("carries prior values only for simulation, keeps water compartments distinct, and fingerprints deterministically", () => {
    const result = buildTransientExerciseWaterEcfTransitionV7({ priorTransientExerciseWaterKg: 0.2, priorEcfDeviationKg: -0.3, glycogenTransition: glycogen("observed-no-exposure", "observed-no-stepper"), glycogenTransitionFingerprint: "n" });
    expect(result.transientExerciseWater).toMatchObject({ stateHandling: "carry-forward-for-simulation", biologicalTransition: "not-modeled" });
    expect(result.ecfDeviation).toMatchObject({ stateHandling: "carry-forward-for-simulation", biologicalTransition: "not-modeled" });
    expect(result.compartmentSeparation.ecfDeviation).toBe("not-a-residual-or-transient-water-bucket");
    expect(transientExerciseWaterEcfTransitionV7Fingerprint(result)).toBe(transientExerciseWaterEcfTransitionV7Fingerprint(result));
  });

  it("does not substitute unavailable transient water or ECF in mass reconstruction", () => {
    const state: PhysiologyV7State = { fatMassKg: 18, skeletalMuscleKg: 28, otherLeanTissueKg: 17, glycogenKg: 0.4, glycogenWaterKg: 1.2, ecfDeviationKg: null, transientExerciseWaterKg: null, adaptiveThermogenesisKcalPerDay: 0, weightFilterState: { estimatedWeightKg: 64.5, varianceKg2: 1 } };
    expect(reconstructPhysiologyV7MassKg(state)).toBeNull();
  });
});
