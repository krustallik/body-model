import { describe, expect, it } from "vitest";
import {
  applyGlycogenTransitionV7,
  buildEnergyMatchedProteinSubstitutionGlycogenPairV7,
  buildGlycogenTransitionV7,
  GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
  GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7,
  GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7,
  GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
  glycogenCarbohydrateEvidenceV7,
  glycogenProteinContributionV7,
  glycogenRepletionOutcomeV7,
  glycogenTransitionV7Fingerprint,
  initializeGlycogenRejectingAdultCapacityDefaultV7,
  rejectAdultGlycogenCapacityAsPersonalCapacityV7,
  rejectAdultGlycogenCapacityAsValidatorV7,
  rejectAdultGlycogenCapacityClampV7,
  rejectResidualScaleWeightAsGlycogenV7,
} from "@/model/physiology-v7/glycogen-transition-v7";
import type { ResistanceTrainingDayExposureV7 } from "@/model/physiology-v7/resistance-training-exposure-history-v7";
import type { NutritionProvenance } from "@/modules/model-episodes/model-episode.types";
import { buildFluidWaterTransitionPipelineV7 } from "@/model/physiology-v7/fluid-water-transition-pipeline-v7";
import type { PhysiologyV7State } from "@/model/physiology-v7/state";
import {
  buildPhysiologyDayV7,
  createUnavailablePhysiologyRuntimeStateV7,
  runtimeStateFromStructuralStateV7,
} from "@/model/physiology-v7/daily-runtime-v7";
import { rebuildPhysiologyRangeV7 } from "@/model/physiology-v7/rebuild-v7";
import { buildResistanceTrainingExposureHistoryFromSourcesV7 } from "@/model/physiology-v7/resistance-training-exposure-history-sources-v7";
import { observedNutritionProvenance } from "@/modules/model-episodes/nutrition-gap-bridge";

const nutrition = (source: NutritionProvenance["source"]): NutritionProvenance => ({
  source, method: null, referenceDayCount: 0, gapLength: 0, referenceDates: [],
  observedFields: source === "observed" ? ["carbsG"] : [],
  imputedFields: source === "observed" || source === "missing" ? [] : ["carbsG"],
  referenceCaloriesMedian: null, referenceCaloriesMad: null, referenceMacroMadG: null,
  dependency: source === "observed" ? "observed" : "imputed-direct",
});

const mapped = (): ResistanceTrainingDayExposureV7 => ({
  date: "2026-09-18", workoutFeedObserved: true,
  sourceObservation: { availability: "available", observation: "observed-exposure" },
  kind: "observed-mapped-exposure", completeCessation: false, sessions: [], legacyStrengthWorkouts: [],
  mappedSetCount: 2, recordedSetCount: 2, unmappedSetCount: 0,
  muscleGroups: [],
});

describe("Stage 8B glycogen transition", () => {
  it("distinguishes observed, imputed, and missing carbohydrates without treating missing as zero", () => {
    expect(glycogenCarbohydrateEvidenceV7({ carbsG: 0, nutrition: nutrition("observed") }))
      .toEqual({ availability: "available", provenance: "observed", carbsG: 0 });
    expect(glycogenCarbohydrateEvidenceV7({ carbsG: 150, nutrition: nutrition("imputed-local") }))
      .toEqual({ availability: "available", provenance: "imputed", carbsG: 150 });
    expect(glycogenCarbohydrateEvidenceV7({ carbsG: null, nutrition: nutrition("missing") }))
      .toEqual({ availability: "unavailable", reason: "missing-carbohydrate" });
  });

  it("emits qualitative strength and stepper depletion pressure but no kg delta", () => {
    const result = buildGlycogenTransitionV7({
      priorGlycogenKg: null,
      carbohydrate: glycogenCarbohydrateEvidenceV7({ carbsG: 180, nutrition: nutrition("observed") }),
      resistanceExposure: mapped(), workoutFeedObserved: true,
      stepperWorkouts: [{
        workoutEnergy: { workoutId: 7, canonicalWorkoutType: "Stair Climbing", startAt: "2026-09-18T10:00:00Z", endAt: "2026-09-18T10:30:00Z", durationMinutes: 30 },
        bracketedSteps: { availability: "unavailable" },
      } as never],
    });
    expect(result.depletionEvidence).toBe("present");
    expect(result.repletionEvidence).toBe("present-observed");
    expect(result.carbohydrateTimingPolicy).toEqual(GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7);
    expect(result.quantitativeState).toMatchObject({ availability: "unavailable", carriedForwardGlycogenKg: null, biologicalTransition: "not-modeled" });
    expect(result).not.toHaveProperty("glycogenDeltaKg");
  });

  it("records that meal frequency/timing is not applied at daily resolution and missing timing is not fasting", () => {
    const withCarbs = buildGlycogenTransitionV7({
      priorGlycogenKg: null,
      carbohydrate: glycogenCarbohydrateEvidenceV7({ carbsG: 180, nutrition: nutrition("observed") }),
      resistanceExposure: null, workoutFeedObserved: true, stepperWorkouts: [],
    });
    const missingCarbs = buildGlycogenTransitionV7({
      priorGlycogenKg: null,
      carbohydrate: glycogenCarbohydrateEvidenceV7({ carbsG: null, nutrition: nutrition("missing") }),
      resistanceExposure: null, workoutFeedObserved: true, stepperWorkouts: [],
    });
    expect(withCarbs.carbohydrateTimingPolicy.mealFrequencyEffect).toBe("intentionally-not-applied");
    expect(withCarbs.carbohydrateTimingPolicy.mealTimingInput).toBe("unavailable-not-zero-or-fasting");
    expect(missingCarbs.carbohydrateTimingPolicy).toEqual(withCarbs.carbohydrateTimingPolicy);
    expect(missingCarbs.carbohydrateEvidence.availability).toBe("unavailable");
  });

  it("does not improve glycogen repletion when protein rises under matched carbohydrate and energy", () => {
    const observedNutrition: NutritionProvenance = {
      ...nutrition("observed"),
      observedFields: ["carbsG", "proteinG", "fatG"],
    };
    const pair = buildEnergyMatchedProteinSubstitutionGlycogenPairV7({
      priorGlycogenKg: 0.35,
      carbsG: 220,
      energyKcal: 2_400,
      lowerProteinG: 90,
      higherProteinG: 180,
      nutrition: observedNutrition,
      resistanceExposure: null,
      workoutFeedObserved: true,
      stepperWorkouts: [],
    });
    expect(pair.lowerMacros.carbsG).toBe(pair.higherMacros.carbsG);
    expect(pair.lowerMacros.energyKcal).toBeCloseTo(pair.higherMacros.energyKcal, 10);
    expect(pair.higherMacros.proteinG).toBeGreaterThan(pair.lowerMacros.proteinG);
    expect(pair.higherMacros.fatG).toBeLessThan(pair.lowerMacros.fatG);
    expect(pair.lowerProtein.proteinContribution).toEqual(
      glycogenProteinContributionV7({ proteinG: 90, nutrition: observedNutrition }),
    );
    expect(pair.higherProtein.proteinContribution.independentBonus).toEqual(GLYCOGEN_PROTEIN_BONUS_POLICY_V7);
    expect(pair.higherProtein.proteinContribution.repletionEffect).toBe("none");
    expect(glycogenRepletionOutcomeV7(pair.higherProtein)).toEqual(
      glycogenRepletionOutcomeV7(pair.lowerProtein),
    );
    expect(pair.higherProtein.repletionEvidence).toBe("present-observed");
    expect(pair.higherProtein).not.toHaveProperty("proteinGlycogenBonusKg");
    expect(pair.higherProtein).not.toHaveProperty("glycogenDeltaKg");
  });

  it("does not invent depletion on an observed no-exercise day and preserves unresolved legacy exposure", () => {
    const noExercise = buildGlycogenTransitionV7({
      priorGlycogenKg: null,
      carbohydrate: glycogenCarbohydrateEvidenceV7({ carbsG: null, nutrition: nutrition("missing") }),
      resistanceExposure: null, workoutFeedObserved: true, stepperWorkouts: [],
    });
    expect(noExercise.depletionEvidence).toBe("absent");
    const unresolved = buildGlycogenTransitionV7({
      priorGlycogenKg: null, carbohydrate: noExercise.carbohydrateEvidence,
      resistanceExposure: { ...mapped(), kind: "unresolved-dose", mappedSetCount: 0 },
      workoutFeedObserved: true, stepperWorkouts: [],
    });
    expect(unresolved.depletionEvidence).toBe("unresolved");
  });

  it("carries an existing numeric state as simulation handling rather than a biological zero", () => {
    const transition = buildGlycogenTransitionV7({
      priorGlycogenKg: 0.4,
      carbohydrate: glycogenCarbohydrateEvidenceV7({ carbsG: 100, nutrition: nutrition("imputed-local") }),
      resistanceExposure: null, workoutFeedObserved: true, stepperWorkouts: [],
    });
    expect(transition.quantitativeState).toMatchObject({ stateHandling: "carry-forward-for-simulation", carriedForwardGlycogenKg: 0.4, biologicalTransition: "not-modeled" });
    const applied = applyGlycogenTransitionV7({
      state: {
        fatMassKg: 18, skeletalMuscleKg: null, otherLeanTissueKg: 17, glycogenKg: 0.4,
        glycogenWaterKg: 0, ecfDeviationKg: 0, transientExerciseWaterKg: 0,
        adaptiveThermogenesisKcalPerDay: 0, weightFilterState: { estimatedWeightKg: 64, varianceKg2: 1 },
      },
      transition,
    });
    expect(applied.state.glycogenKg).toBe(0.4);
    expect(glycogenTransitionV7Fingerprint(transition)).toBe(glycogenTransitionV7Fingerprint(transition));
  });

  it("keeps adult literature glycogen range as metadata and never clamps personal glycogenKg", () => {
    const initialized = initializeGlycogenRejectingAdultCapacityDefaultV7();
    expect(initialized.glycogenKg).toBeNull();
    expect(initialized.adultCapacityContext).toMatchObject({
      role: "research-context-metadata",
      literatureRangeKg: { lowerKg: 0.3, upperKg: 0.86 },
      mayClampGlycogenKg: false,
      mayDerivePersonalCapacity: false,
    });
    expect(initialized.glycogenFromAdultCapacity).toMatchObject({
      applied: false,
      policy: GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
      resultingGlycogenKg: null,
    });
    expect(initialized).not.toHaveProperty("personalGlycogenCapacityKg");

    expect(rejectAdultGlycogenCapacityAsPersonalCapacityV7()).toMatchObject({
      derived: false,
      personalCapacityKg: null,
    });
    expect(rejectAdultGlycogenCapacityAsValidatorV7({ glycogenKg: 0.1 }).accepted).toBe(false);
    expect(rejectAdultGlycogenCapacityAsValidatorV7({ glycogenKg: 1.5 }).accepted).toBe(false);
    expect(rejectAdultGlycogenCapacityClampV7({ glycogenKg: 0.1 }).resultingGlycogenKg).toBe(0.1);
    expect(rejectAdultGlycogenCapacityClampV7({ glycogenKg: 0.5 }).resultingGlycogenKg).toBe(0.5);
    expect(rejectAdultGlycogenCapacityClampV7({ glycogenKg: 1.5 }).resultingGlycogenKg).toBe(1.5);

    const below = buildGlycogenTransitionV7({
      priorGlycogenKg: 0.1,
      carbohydrate: glycogenCarbohydrateEvidenceV7({ carbsG: 180, nutrition: nutrition("observed") }),
      resistanceExposure: null, workoutFeedObserved: true, stepperWorkouts: [],
    });
    const above = buildGlycogenTransitionV7({
      priorGlycogenKg: 1.5,
      carbohydrate: glycogenCarbohydrateEvidenceV7({ carbsG: 180, nutrition: nutrition("observed") }),
      resistanceExposure: null, workoutFeedObserved: true, stepperWorkouts: [],
    });
    expect(below.adultCapacityContext.literatureRangeKg).toEqual(
      GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg,
    );
    expect(below.glycogenFromAdultCapacity.applied).toBe(false);
    expect(below.quantitativeState.carriedForwardGlycogenKg).toBe(0.1);
    expect(above.quantitativeState.carriedForwardGlycogenKg).toBe(1.5);
    expect(below).not.toHaveProperty("glycogenCapacityClampKg");
    expect(JSON.stringify(below)).not.toMatch(/personalCapacityKg|clampGlycogen|capacityDefault/);

    const stateBelow: PhysiologyV7State = {
      fatMassKg: 18, skeletalMuscleKg: 28, otherLeanTissueKg: 17, glycogenKg: 0.1,
      glycogenWaterKg: null, ecfDeviationKg: null, transientExerciseWaterKg: null,
      adaptiveThermogenesisKcalPerDay: 0, weightFilterState: { estimatedWeightKg: 64, varianceKg2: 1 },
    };
    expect(applyGlycogenTransitionV7({ state: stateBelow, transition: below }).state.glycogenKg).toBe(0.1);
    expect(rejectResidualScaleWeightAsGlycogenV7({
      state: stateBelow,
      residualScaleWeightKg: 2.4,
    })).toMatchObject({
      applied: false,
      resultingGlycogenKg: 0.1,
      rejectedOperations: expect.arrayContaining(["residual-allocate-from-scale-weight"]),
    });

    const pipeline = buildFluidWaterTransitionPipelineV7({
      localDate: "2026-09-18",
      priorState: stateBelow,
      carbsG: 200,
      nutrition: nutrition("observed"),
      resistanceExposure: null,
      workoutFeedObserved: true,
      stepperWorkouts: [],
    });
    expect(pipeline.glycogen.adultCapacityContext.mayClampGlycogenKg).toBe(false);
    expect(pipeline.state.glycogenKg).toBe(0.1);

    const date = "2026-09-18";
    const daySources = {
      date,
      observedWeightKg: 80,
      observedBodyFatPercent: 20,
      nutrition: {
        caloriesKcal: 2_300,
        proteinG: 150,
        fatG: 75,
        carbsG: 250,
        provenance: observedNutritionProvenance(),
      },
      workoutFeedObserved: true,
      steps: 8_000,
      walkingRunningDistanceKm: 6,
      workouts: [] as const,
      stepperWorkouts: [] as const,
      context: {
        heartRateSampleCount: 0,
        restingHeartRateSampleCount: 0,
        sleepSegmentCount: 0,
      },
    };
    const day = buildPhysiologyDayV7({
      date,
      priorState: runtimeStateFromStructuralStateV7({
        ...stateBelow,
        glycogenKg: 1.5,
      }),
      sources: daySources,
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(day.fluidWater.glycogen.glycogenFromAdultCapacity.applied).toBe(false);
    expect(day.resultingState.compartments.glycogenKg).toMatchObject({
      availability: "available",
      valueKg: 1.5,
      biologicalTransition: "not-modeled",
    });

    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate: date,
      toDate: date,
      initialState: runtimeStateFromStructuralStateV7({
        ...stateBelow,
        glycogenKg: 0.1,
      }),
      sources: {
        days: [daySources],
        exposure: {
          historyFromDate: date,
          days: [{ date, workoutFeedObserved: true }],
          strengthWorkouts: [],
          sessions: [],
        },
      },
    });
    expect(rebuilt.finalState.compartments.glycogenKg.valueKg).toBe(0.1);
    expect(rebuilt.days[0]?.fluidWater.glycogen.adultCapacityContext.mayInitializeGlycogenKg).toBe(false);
    expect(createUnavailablePhysiologyRuntimeStateV7().compartments.glycogenKg.valueKg).toBeNull();
  });
});
