import { describe, expect, it } from "vitest";
import {
  ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7,
  applyTransientExerciseWaterEcfTransitionV7,
  buildTransientExerciseWaterEcfTransitionV7,
  classifyAcuteSwellingDestinationV7,
  rejectAcuteSwellingAsSkeletalMuscleV7,
  transientExerciseWaterEcfTransitionV7Fingerprint,
} from "@/model/physiology-v7/transient-exercise-water-ecf-transition-v7";
import type { GlycogenTransitionV7 } from "@/model/physiology-v7/glycogen-transition-v7";
import {
  GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
  GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7,
  GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7,
  GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
  GLYCOGEN_TRANSITION_V7_VERSION,
  resolveAdultGlycogenCapacityContextV7,
} from "@/model/physiology-v7/glycogen-transition-v7";
import { reconstructPhysiologyV7MassKg, type PhysiologyV7State } from "@/model/physiology-v7/state";

function glycogen(strength: GlycogenTransitionV7["exerciseEvidence"]["strength"], stepper: GlycogenTransitionV7["exerciseEvidence"]["stepper"]): GlycogenTransitionV7 {
  return {
    contractVersion: GLYCOGEN_TRANSITION_V7_VERSION,
    transitionSlot: "glycogen-transition-slot",
    quantitativeState: { availability: "unavailable", reason: "no-defensible-initial-glycogen-source", stateHandling: "state-remains-unavailable", carriedForwardGlycogenKg: null, biologicalTransition: "not-modeled" },
    carbohydrateEvidence: { availability: "unavailable", reason: "missing-carbohydrate" },
    carbohydrateTimingPolicy: GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7,
    proteinContribution: {
      availability: "unavailable",
      reason: "missing-protein",
      repletionEffect: "none",
      independentBonus: GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
    },
    adultCapacityContext: resolveAdultGlycogenCapacityContextV7(),
    glycogenFromAdultCapacity: {
      applied: false,
      target: "glycogenKg",
      policy: GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
      literatureRangeKg: GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg,
      priorGlycogenKg: null,
      resultingGlycogenKg: null,
      rejectedOperations: [
        "initialize",
        "cap",
        "clamp",
        "overwrite",
        "validate",
        "derive-personal-capacity",
        "residual-allocate-from-scale-weight",
      ],
    },
    exerciseEvidence: { strength, stepper },
    depletionEvidence: "absent",
    repletionEvidence: "unavailable",
    sourceCoverage: "complete-for-qualitative-boundary",
    provenance: { workoutFeedObserved: true, resistance: null, stepper: [] },
    blockers: ["no-approved-quantitative-glycogen-transition"],
  };
}

describe("Stage 8D transient exercise water and ECF", () => {
  it("keeps resistance swelling and stepper fluid-shift evidence categorically distinct and magnitude unavailable", () => {
    const resistance = buildTransientExerciseWaterEcfTransitionV7({ priorTransientExerciseWaterKg: null, priorEcfDeviationKg: null, glycogenTransition: glycogen("qualified-depletion-pressure", "observed-no-stepper"), glycogenTransitionFingerprint: "r" });
    const stepper = buildTransientExerciseWaterEcfTransitionV7({ priorTransientExerciseWaterKg: null, priorEcfDeviationKg: null, glycogenTransition: glycogen("observed-no-exposure", "endurance-depletion-pressure"), glycogenTransitionFingerprint: "s" });
    expect(resistance.transientExerciseWater.evidence).toBe("resistance-local-swelling-plausible");
    expect(stepper.transientExerciseWater.evidence).toBe("stepper-fluid-shift-categorically-distinct");
    expect(resistance.transientExerciseWater.magnitude.availability).toBe("unavailable");
    expect(resistance.acuteSwellingClassification).toEqual(classifyAcuteSwellingDestinationV7());
    expect(resistance.acuteSwellingClassification.mayEnterSkeletalMuscleKg).toBe(false);
    expect(resistance.acuteSwellingClassification.policy).toEqual(ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7);
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

  it("routes acute swelling to transient water and never mutates skeletalMuscleKg", () => {
    expect(rejectAcuteSwellingAsSkeletalMuscleV7({
      skeletalMuscleKg: 30,
      swellingSignal: { localThicknessChangePercent: 8, bodyWeightRiseKg: 0.4 },
    })).toMatchObject({
      accepted: false,
      destination: "transientExerciseWaterKg",
      resultingSkeletalMuscleKg: 30,
      policy: ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7,
    });

    const state: PhysiologyV7State = {
      fatMassKg: 18,
      skeletalMuscleKg: 28,
      otherLeanTissueKg: 17,
      glycogenKg: 0.4,
      glycogenWaterKg: 1.2,
      ecfDeviationKg: null,
      transientExerciseWaterKg: 0.15,
      adaptiveThermogenesisKcalPerDay: 0,
      weightFilterState: { estimatedWeightKg: 64.5, varianceKg2: 1 },
    };
    const transition = buildTransientExerciseWaterEcfTransitionV7({
      priorTransientExerciseWaterKg: state.transientExerciseWaterKg,
      priorEcfDeviationKg: state.ecfDeviationKg,
      glycogenTransition: glycogen("qualified-depletion-pressure", "observed-no-stepper"),
      glycogenTransitionFingerprint: "r",
    });
    expect(transition.transientExerciseWater.evidence).toBe("resistance-local-swelling-plausible");
    const applied = applyTransientExerciseWaterEcfTransitionV7({ state, transition });
    expect(applied.state.skeletalMuscleKg).toBe(28);
    expect(applied.state.transientExerciseWaterKg).toBe(0.15);
    expect(applied.skeletalMuscleFromSwelling.accepted).toBe(false);
    expect(applied.transition.acuteSwellingClassification.destination).toBe("transient-exercise-water-context");
  });

  it("does not substitute unavailable transient water or ECF in mass reconstruction", () => {
    const state: PhysiologyV7State = { fatMassKg: 18, skeletalMuscleKg: 28, otherLeanTissueKg: 17, glycogenKg: 0.4, glycogenWaterKg: 1.2, ecfDeviationKg: null, transientExerciseWaterKg: null, adaptiveThermogenesisKcalPerDay: 0, weightFilterState: { estimatedWeightKg: 64.5, varianceKg2: 1 } };
    expect(reconstructPhysiologyV7MassKg(state)).toBeNull();
  });
});
