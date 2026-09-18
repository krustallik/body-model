import { describe, expect, it } from "vitest";
import {
  PHYSIOLOGY_V7_DAILY_TRANSITION_ORDER,
  workoutExposureObservation,
  type AvailableValue,
  type TrainingAdaptationStateV7,
  type UnavailableValue,
} from "@/model/physiology-v7/contracts";
import {
  reconstructPhysiologyV7MassKg,
  type PhysiologyV7State,
} from "@/model/physiology-v7/state";

const state: PhysiologyV7State = {
  fatMassKg: 18,
  skeletalMuscleKg: 28,
  otherLeanTissueKg: 17,
  glycogenKg: 0.4,
  glycogenWaterKg: 1.2,
  ecfDeviationKg: -0.3,
  transientExerciseWaterKg: 0.2,
  adaptiveThermogenesisKcalPerDay: 0,
  weightFilterState: { estimatedWeightKg: 64.5, varianceKg2: 1 },
};

describe("physiology v7 structural Stage 5 contracts", () => {
  it("defines a contract-only daily transition order without an executable v7 engine", () => {
    expect(PHYSIOLOGY_V7_DAILY_TRANSITION_ORDER).toEqual([
      "normalize-sources",
      "resolve-input-semantics",
      "validate-state-contract",
      "energy-nutrition-transition-slot",
      "glycogen-transition-slot",
      "training-adaptation-transition-slot",
      "fluid-water-transition-slot",
      "reconstruct-mass",
      "annotate-output-provenance",
    ]);
  });

  it("separates availability from provenance and preserves observed zero", () => {
    const observedZero: AvailableValue<number> = {
      availability: "available", provenance: "observed", value: 0,
    };
    const estimated: AvailableValue<number> = {
      availability: "available", provenance: "estimated", value: 3,
    };
    const unavailable: UnavailableValue = {
      availability: "unavailable", provenance: null, value: null,
    };
    expect(observedZero.value).toBe(0);
    expect(estimated.provenance).toBe("estimated");
    expect(unavailable).toEqual({ availability: "unavailable", provenance: null, value: null });
  });

  it("only calls no exposure observed when the workout feed itself was observed", () => {
    expect(workoutExposureObservation({ workoutFeedObserved: true, workoutCount: 0 }))
      .toEqual({ availability: "available", observation: "observed-no-exposure" });
    expect(workoutExposureObservation({ workoutFeedObserved: true, workoutCount: 2 }))
      .toEqual({ availability: "available", observation: "observed-exposure" });
    expect(workoutExposureObservation({ workoutFeedObserved: null, workoutCount: 0 }))
      .toEqual({ availability: "unavailable", observation: "unobserved" });
  });

  it("keeps adaptation response unavailable until a research-backed transition exists", () => {
    const adaptation: TrainingAdaptationStateV7 = {
      sourceObservation: { availability: "available", observation: "observed-no-exposure" },
      adaptationResponse: { availability: "unavailable", provenance: null, value: null },
    };
    expect(adaptation.adaptationResponse.availability).toBe("unavailable");
  });

  it("reconstructs mass from non-overlapping compartments exactly once and keeps ECF deviation signed", () => {
    expect(reconstructPhysiologyV7MassKg(state)).toBe(64.5);
    expect(reconstructPhysiologyV7MassKg({ ...state, glycogenWaterKg: 2.2 })).toBe(65.5);
    expect(reconstructPhysiologyV7MassKg({ ...state, ecfDeviationKg: 0.7 })).toBe(65.5);
    expect(reconstructPhysiologyV7MassKg({ ...state, skeletalMuscleKg: null })).toBeNull();
  });
});
