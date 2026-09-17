import { describe, expect, it } from "vitest";
import {
  PHYSIOLOGY_V7_CONTRACT_VERSION,
  physiologyV7StateFingerprint,
  validatePhysiologyV7State,
  type PhysiologyV7State,
} from "@/model/physiology-v7/state";
import type { PhysiologicalSimulatorState } from "@/model/physiological-simulator";

const v7State: PhysiologyV7State = {
  fatMassKg: 18,
  skeletalMuscleKg: 28,
  otherLeanTissueKg: 17,
  glycogenKg: 0.4,
  glycogenWaterKg: 1.2,
  ecfDeviationKg: 0.1,
  transientExerciseWaterKg: 0,
  adaptiveThermogenesisKcalPerDay: -20,
  weightFilterState: {
    estimatedWeightKg: 64.7,
    varianceKg2: 1,
  },
};

describe("physiology v7 state contract", () => {
  it("keeps the v7 compartments distinct and validates their structural invariants", () => {
    expect(PHYSIOLOGY_V7_CONTRACT_VERSION).toBe("bodycast-physiology-v7-state-v1");
    expect(validatePhysiologyV7State(v7State)).toEqual(v7State);
    for (const field of [
      "fatMassKg", "skeletalMuscleKg", "otherLeanTissueKg", "glycogenKg",
      "glycogenWaterKg", "transientExerciseWaterKg",
    ] as const) {
      expect(() => validatePhysiologyV7State({ ...v7State, [field]: -0.01 }))
        .toThrow(RangeError);
    }
  });

  it("fingerprints the same v7 state deterministically", () => {
    expect(physiologyV7StateFingerprint(v7State)).toBe(physiologyV7StateFingerprint({ ...v7State }));
  });

  it("does not alter the v6 simulator state contract", () => {
    const v6: PhysiologicalSimulatorState = {
      fatMassKg: 18,
      leanTissueKg: 45,
      glycogenKg: 0.4,
      baselineExtracellularFluidLiters: 12,
      extracellularFluidDeviationLiters: 0.1,
      adaptiveThermogenesisKcalPerDay: -20,
      weightFilterState: { estimatedWeightKg: 64.7, varianceKg2: 1 },
    };
    expect(v6.leanTissueKg).toBe(45);
    expect("skeletalMuscleKg" in v6).toBe(false);
  });
});
