import { describe, expect, it } from "vitest";
import { buildFluidWaterTransitionPipelineV7 } from "@/model/physiology-v7/fluid-water-transition-pipeline-v7";
import type { PhysiologyV7State } from "@/model/physiology-v7/state";
import type { NutritionProvenance } from "@/modules/model-episodes/model-episode.types";

const nutrition: NutritionProvenance = { source: "observed", method: null, referenceDayCount: 0, gapLength: 0, referenceDates: [], observedFields: ["carbsG"], imputedFields: [], referenceCaloriesMedian: null, referenceCaloriesMad: null, referenceMacroMadG: null, dependency: "observed" };
const state: PhysiologyV7State = { fatMassKg: 18, skeletalMuscleKg: 28, otherLeanTissueKg: 17, glycogenKg: null, glycogenWaterKg: null, ecfDeviationKg: null, transientExerciseWaterKg: null, adaptiveThermogenesisKcalPerDay: 0, weightFilterState: { estimatedWeightKg: 64, varianceKg2: 1 } };

describe("Stage 8E canonical fluid/water pipeline", () => {
  it("composes 8B, 8C, and 8D from canonical source semantics without numeric substitutions", () => {
    const result = buildFluidWaterTransitionPipelineV7({ localDate: "2026-09-18", priorState: state, carbsG: 200, nutrition, resistanceExposure: null, workoutFeedObserved: true, stepperWorkouts: [] });
    expect(result.glycogen.contractVersion).toBe("bodycast-glycogen-transition-v7-2");
    expect(result.glycogenWater.contractVersion).toBe("bodycast-glycogen-water-transition-v7-1");
    expect(result.transientExerciseWaterEcf.contractVersion).toBe("bodycast-transient-exercise-water-ecf-transition-v7-1");
    expect(result.glycogen.carbohydrateEvidence).toMatchObject({ provenance: "observed", carbsG: 200 });
    expect(result.glycogen.carbohydrateTimingPolicy.mealFrequencyEffect).toBe("intentionally-not-applied");
    expect(result.state.glycogenKg).toBeNull();
    expect(result.reconstructedMassKg).toBeNull();
  });

  it("is deterministic and changes its rebuild fingerprint for relevant carbohydrate source evidence", () => {
    const base = { localDate: "2026-09-18", priorState: state, carbsG: 200, nutrition, resistanceExposure: null, workoutFeedObserved: true, stepperWorkouts: [] } as const;
    expect(buildFluidWaterTransitionPipelineV7(base).fingerprint).toBe(buildFluidWaterTransitionPipelineV7(base).fingerprint);
    expect(buildFluidWaterTransitionPipelineV7({ ...base, carbsG: 201 }).fingerprint).not.toBe(buildFluidWaterTransitionPipelineV7(base).fingerprint);
  });

  it("uses field-level carbohydrate provenance for partially observed nutrition", () => {
    const partialObserved: NutritionProvenance = {
      ...nutrition,
      source: "missing",
      observedFields: ["carbsG"],
      imputedFields: ["proteinG"],
    };
    const imputedCarbs: NutritionProvenance = {
      ...nutrition,
      source: "imputed-local",
      observedFields: ["proteinG"],
      imputedFields: ["carbsG"],
    };

    expect(buildFluidWaterTransitionPipelineV7({
      localDate: "2026-09-18",
      priorState: state,
      carbsG: 200,
      nutrition: partialObserved,
      resistanceExposure: null,
      workoutFeedObserved: true,
      stepperWorkouts: [],
    }).glycogen.carbohydrateEvidence).toMatchObject({ provenance: "observed" });
    expect(buildFluidWaterTransitionPipelineV7({
      localDate: "2026-09-18",
      priorState: state,
      carbsG: 200,
      nutrition: imputedCarbs,
      resistanceExposure: null,
      workoutFeedObserved: true,
      stepperWorkouts: [],
    }).glycogen.carbohydrateEvidence).toMatchObject({ provenance: "imputed" });
  });
});
