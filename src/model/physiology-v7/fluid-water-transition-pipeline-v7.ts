import type { WorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import type { NutritionProvenance } from "@/modules/model-episodes/model-episode.types";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { applyGlycogenTransitionV7, buildGlycogenTransitionV7, glycogenCarbohydrateEvidenceV7, glycogenProteinContributionV7, glycogenTransitionV7Fingerprint, type GlycogenTransitionV7 } from "./glycogen-transition-v7";
import { applyGlycogenWaterTransitionV7, buildGlycogenWaterTransitionV7, glycogenWaterTransitionV7Fingerprint, type GlycogenWaterTransitionV7 } from "./glycogen-water-transition-v7";
import type { ResistanceTrainingDayExposureV7 } from "./resistance-training-exposure-history-v7";
import { reconstructPhysiologyV7MassKg, type PhysiologyV7State } from "./state";
import { applyTransientExerciseWaterEcfTransitionV7, buildTransientExerciseWaterEcfTransitionV7, transientExerciseWaterEcfTransitionV7Fingerprint, type TransientExerciseWaterEcfTransitionV7 } from "./transient-exercise-water-ecf-transition-v7";

/** Canonical, rebuildable Stage-8 orchestration seam; not a numeric simulator. */
export const FLUID_WATER_TRANSITION_PIPELINE_V7_VERSION = "bodycast-fluid-water-transition-pipeline-v7-1" as const;

export type FluidWaterTransitionPipelineV7 = {
  contractVersion: typeof FLUID_WATER_TRANSITION_PIPELINE_V7_VERSION;
  localDate: string;
  glycogen: GlycogenTransitionV7;
  glycogenWater: GlycogenWaterTransitionV7;
  transientExerciseWaterEcf: TransientExerciseWaterEcfTransitionV7;
  state: PhysiologyV7State;
  reconstructedMassKg: number | null;
  fingerprint: string;
};

export function buildFluidWaterTransitionPipelineV7(input: {
  localDate: string;
  priorState: PhysiologyV7State;
  carbsG: number | null;
  proteinG?: number | null;
  nutrition: NutritionProvenance;
  resistanceExposure: ResistanceTrainingDayExposureV7 | null;
  workoutFeedObserved: boolean | null;
  stepperWorkouts: readonly WorkoutStepperEvidenceV7[];
}): FluidWaterTransitionPipelineV7 {
  const carbohydrate = glycogenCarbohydrateEvidenceV7({ carbsG: input.carbsG, nutrition: input.nutrition });
  const protein = glycogenProteinContributionV7({
    proteinG: input.proteinG === undefined ? null : input.proteinG,
    nutrition: input.nutrition,
  });
  const glycogen = buildGlycogenTransitionV7({
    priorGlycogenKg: input.priorState.glycogenKg,
    carbohydrate,
    protein,
    resistanceExposure: input.resistanceExposure,
    workoutFeedObserved: input.workoutFeedObserved,
    stepperWorkouts: input.stepperWorkouts,
  });
  const glycogenFingerprint = glycogenTransitionV7Fingerprint(glycogen);
  const afterGlycogen = applyGlycogenTransitionV7({ state: input.priorState, transition: glycogen }).state;
  const glycogenWater = buildGlycogenWaterTransitionV7({ priorGlycogenWaterKg: afterGlycogen.glycogenWaterKg, glycogenTransition: glycogen, glycogenTransitionFingerprint: glycogenFingerprint });
  const glycogenWaterFingerprint = glycogenWaterTransitionV7Fingerprint(glycogenWater);
  const afterGlycogenWater = applyGlycogenWaterTransitionV7({ state: afterGlycogen, transition: glycogenWater }).state;
  const transientExerciseWaterEcf = buildTransientExerciseWaterEcfTransitionV7({ priorTransientExerciseWaterKg: afterGlycogenWater.transientExerciseWaterKg, priorEcfDeviationKg: afterGlycogenWater.ecfDeviationKg, glycogenTransition: glycogen, glycogenTransitionFingerprint: glycogenFingerprint });
  const transientFingerprint = transientExerciseWaterEcfTransitionV7Fingerprint(transientExerciseWaterEcf);
  const state = applyTransientExerciseWaterEcfTransitionV7({ state: afterGlycogenWater, transition: transientExerciseWaterEcf }).state;
  const fingerprint = stableSha256({ contractVersion: FLUID_WATER_TRANSITION_PIPELINE_V7_VERSION, localDate: input.localDate, priorState: input.priorState, glycogenFingerprint, glycogenWaterFingerprint, transientFingerprint });
  return { contractVersion: FLUID_WATER_TRANSITION_PIPELINE_V7_VERSION, localDate: input.localDate, glycogen, glycogenWater, transientExerciseWaterEcf, state, reconstructedMassKg: reconstructPhysiologyV7MassKg(state), fingerprint };
}
