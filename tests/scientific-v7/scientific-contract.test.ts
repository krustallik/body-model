import { describe, expect, it } from "vitest";
import {
  buildEnergyMatchedProteinSubstitutionGlycogenPairV7,
  buildGlycogenTransitionV7,
  GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
  GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7,
  GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
  glycogenCarbohydrateEvidenceV7,
  glycogenRepletionOutcomeV7,
  initializeGlycogenRejectingAdultCapacityDefaultV7,
  rejectAdultGlycogenCapacityAsPersonalCapacityV7,
  rejectAdultGlycogenCapacityAsValidatorV7,
  rejectAdultGlycogenCapacityClampV7,
  rejectResidualScaleWeightAsGlycogenV7,
  applyGlycogenTransitionV7,
} from "@/model/physiology-v7/glycogen-transition-v7";
import {
  calculateExtracellularFluidLiters,
  calculateExtracellularFluidMassKg,
  calculateGlycogenAssociatedMassKg,
  calculateGlycogenAssociatedWaterKg,
  reconstructBodyWeightKg,
  type BodyCompositionState,
} from "@/model/body-composition/state";
import {
  createGlycogenParameters,
  stepGlycogenOneDay,
} from "@/model/body-composition/glycogen";
import {
  missingPhysiologicalTransitionFields,
  type PhysiologicalDailyInput,
} from "@/model/physiological-simulator";
import {
  resolveExplicitWorkoutActivityKcal,
  type ExplicitWorkoutActivityEvent,
} from "@/model/activity/workout-energy";
import {
  resolveWorkoutEnergyEvidenceV7,
  type WorkoutEnergyEvidenceV7,
} from "@/model/activity/workout-energy-v7";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  buildQualifiedResistanceTrainingDoseV7,
  qualifiedResistanceTrainingDoseV7Fingerprint,
} from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import {
  buildIncreasingQualifiedSetDoseAdaptationSeriesV7,
  RESISTANCE_TRAINING_VOLUME_CAP_POLICY_V7,
} from "@/model/physiology-v7/resistance-training-adaptation-response-v7";
import {
  applyLeanMassObservationToPhysiologyV7State,
  applyLocalMuscleObservationToPhysiologyV7State,
  applyAcuteMpsObservationToPhysiologyV7State,
  applyStrengthPerformanceObservationToPhysiologyV7State,
  initializePhysiologyV7StateRejectingLeanAsSkeletalMuscleV7,
  initializePhysiologyV7StateRejectingLocalAsWholeBodyV7,
  initializePhysiologyV7StateRejectingMpsAsSkeletalMuscleV7,
  initializePhysiologyV7StateRejectingStrengthAsSkeletalMuscleV7,
  LEAN_MASS_NOT_SKELETAL_MUSCLE_POLICY_V7,
  LOCAL_HYPERTROPHY_NOT_WHOLE_BODY_POLICY_V7,
  ACUTE_MPS_NOT_SKELETAL_MUSCLE_POLICY_V7,
  STRENGTH_PERFORMANCE_NOT_SKELETAL_MUSCLE_POLICY_V7,
  rejectLeanMassAsSkeletalMuscleValidatorV7,
  rejectLocalMuscleAsSkeletalMuscleCalibratorV7,
  rejectLocalMuscleAsSkeletalMuscleValidatorV7,
  rejectAcuteMpsAsSkeletalMuscleCalibratorV7,
  rejectAcuteMpsAsSkeletalMuscleNumericTransitionV7,
  rejectAcuteMpsAsSkeletalMuscleValidatorV7,
  rejectStrengthAsSkeletalMuscleCalibratorV7,
  rejectStrengthAsSkeletalMuscleNumericTransitionV7,
  rejectStrengthAsSkeletalMuscleValidatorV7,
  rejectResidualLeanAsSkeletalMuscleV7,
  rejectResidualLocalAsSkeletalMuscleV7,
  rejectResidualMpsAsSkeletalMuscleV7,
  rejectResidualStrengthAsSkeletalMuscleV7,
} from "@/model/physiology-v7/measurement-role-v7";
import {
  buildPhysiologyDayV7,
  createUnavailablePhysiologyRuntimeStateV7,
  runtimeStateFromStructuralStateV7,
} from "@/model/physiology-v7/daily-runtime-v7";
import { rebuildPhysiologyRangeV7 } from "@/model/physiology-v7/rebuild-v7";
import { buildResistanceTrainingExposureHistoryFromSourcesV7 } from "@/model/physiology-v7/resistance-training-exposure-history-sources-v7";
import { observedNutritionProvenance } from "@/modules/model-episodes/nutrition-gap-bridge";
import {
  buildResistanceTrainingAdaptationResponseV7,
} from "@/model/physiology-v7/resistance-training-adaptation-response-v7";
import { applyTrainingAdaptationTransitionV7 } from "@/model/physiology-v7/training-adaptation-transition-v7";
import {
  buildResistanceTrainingExposureHistoryV7,
} from "@/model/physiology-v7/resistance-training-exposure-history-v7";
import {
  buildCanonicalStrengthTrainingInputV7,
} from "@/modules/model-episodes/strength-training-input-v7";
import { RESISTANCE } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

const completeDay: PhysiologicalDailyInput = {
  date: "2026-09-17",
  caloriesKcal: 2_400,
  proteinG: 140,
  fatG: 80,
  carbsG: 280,
  outsideWorkWalkingDistanceKm: 0,
  averageWalkingSpeedKmh: null,
  strengthTrainingMinutes: 0,
  occupationalActivity: { category: null, durationHours: 0 },
  sodiumChangeMgPerDay: 0,
  measuredWeightKg: null,
};

function stairEvent(activeEnergyKcal: number): ExplicitWorkoutActivityEvent {
  return {
    type: "Stair Climbing",
    canonicalType: "Stair Climbing",
    classification: "stair-climbing",
    startAt: "2026-09-17T16:00:00.000Z",
    endAt: "2026-09-17T16:20:00.000Z",
    durationMinutes: 20,
    activeEnergyKcal,
  };
}

function v7EnergyEvidence(input: Partial<WorkoutEnergyEvidenceV7> = {}): WorkoutEnergyEvidenceV7 {
  return {
    workoutId: 1,
    canonicalWorkoutType: "Traditional Strength Training",
    startAt: "2026-09-17T16:00:00.000Z",
    endAt: "2026-09-17T16:30:00.000Z",
    durationMinutes: 30,
    deviceEnergy: { availability: "unavailable", availabilityReason: "no-device-active-energy" },
    heartRate: canonicalizeWorkoutHeartRateEvidenceV7({
      workoutInterval: { startAt: "2026-09-17T16:00:00.000Z", endAt: "2026-09-17T16:30:00.000Z" },
      heartRate: { availability: "loaded", samples: [{ timestamp: "2026-09-17T16:01:00.000Z", bpm: 170, provenance: { provider: "shortcut", device: null } }] },
    }),
    ...input,
  };
}

describe("scientific v7 contract — currently reachable audited behavior", () => {
  it("missing protein remains unavailable rather than becoming measured zero", () => {
    const missing = missingPhysiologicalTransitionFields(
      { ...completeDay, proteinG: null },
      "full",
    );
    const measuredZero = missingPhysiologicalTransitionFields(
      { ...completeDay, proteinG: 0 },
      "full",
    );

    expect(missing).toContain("proteinG");
    expect(measuredZero).not.toContain("proteinG");
  });

  it("more carbohydrate from the same depleted state does not reduce glycogen restoration", () => {
    const parameters = createGlycogenParameters({ baselineCarbIntakeG: 250 });
    const lower = stepGlycogenOneDay({
      currentGlycogenKg: 0.3,
      carbIntakeG: 150,
      parameters,
    });
    const higher = stepGlycogenOneDay({
      currentGlycogenKg: 0.3,
      carbIntakeG: 300,
      parameters,
    });

    expect(lower).not.toBeNull();
    expect(higher).not.toBeNull();
    expect(higher!.glycogenKg).toBeGreaterThanOrEqual(lower!.glycogenKg);
  });

  it("daily v7 need not apply meal-frequency effect", () => {
    const observed = buildGlycogenTransitionV7({
      priorGlycogenKg: null,
      carbohydrate: glycogenCarbohydrateEvidenceV7({
        carbsG: 220,
        nutrition: {
          source: "observed",
          method: null,
          referenceDayCount: 0,
          gapLength: 0,
          referenceDates: [],
          observedFields: ["carbsG"],
          imputedFields: [],
          referenceCaloriesMedian: null,
          referenceCaloriesMad: null,
          referenceMacroMadG: null,
          dependency: "observed",
        },
      }),
      resistanceExposure: null,
      workoutFeedObserved: true,
      stepperWorkouts: [],
    });
    const missingCarbs = buildGlycogenTransitionV7({
      priorGlycogenKg: null,
      carbohydrate: glycogenCarbohydrateEvidenceV7({
        carbsG: null,
        nutrition: {
          source: "missing",
          method: null,
          referenceDayCount: 0,
          gapLength: 0,
          referenceDates: [],
          observedFields: [],
          imputedFields: [],
          referenceCaloriesMedian: null,
          referenceCaloriesMad: null,
          referenceMacroMadG: null,
          dependency: "observed",
        },
      }),
      resistanceExposure: null,
      workoutFeedObserved: true,
      stepperWorkouts: [],
    });

    expect(observed.carbohydrateEvidence).toEqual({
      availability: "available",
      provenance: "observed",
      carbsG: 220,
    });
    expect(observed.carbohydrateTimingPolicy).toEqual(GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7);
    expect(observed.carbohydrateTimingPolicy.resolution).toBe("daily-totals-only");
    expect(observed.carbohydrateTimingPolicy.mealFrequencyEffect).toBe("intentionally-not-applied");
    expect(observed.carbohydrateTimingPolicy.mealTimingInput).toBe("unavailable-not-zero-or-fasting");
    expect(observed.carbohydrateTimingPolicy.physiologicalEqualityClaim).toBe("not-asserted");
    expect(observed).not.toHaveProperty("mealFrequency");
    expect(observed).not.toHaveProperty("mealTimingMultiplier");
    expect(missingCarbs.carbohydrateEvidence).toEqual({
      availability: "unavailable",
      reason: "missing-carbohydrate",
    });
    expect(missingCarbs.carbohydrateTimingPolicy).toEqual(observed.carbohydrateTimingPolicy);
    expect(missingCarbs.carbohydrateEvidence).not.toEqual({
      availability: "available",
      provenance: "observed",
      carbsG: 0,
    });
  });

  it("protein is not double-counted as a glycogen bonus", () => {
    const nutrition = {
      source: "observed" as const,
      method: null,
      referenceDayCount: 0,
      gapLength: 0,
      referenceDates: [] as string[],
      observedFields: ["carbsG", "proteinG", "fatG"] as Array<"caloriesKcal" | "proteinG" | "fatG" | "carbsG">,
      imputedFields: [] as Array<"caloriesKcal" | "proteinG" | "fatG" | "carbsG">,
      referenceCaloriesMedian: null,
      referenceCaloriesMad: null,
      referenceMacroMadG: null,
      dependency: "observed" as const,
    };
    const pair = buildEnergyMatchedProteinSubstitutionGlycogenPairV7({
      priorGlycogenKg: 0.32,
      carbsG: 250,
      energyKcal: 2_600,
      lowerProteinG: 80,
      higherProteinG: 170,
      nutrition,
      resistanceExposure: null,
      workoutFeedObserved: true,
      stepperWorkouts: [],
    });

    expect(pair.lowerMacros.carbsG).toBe(250);
    expect(pair.higherMacros.carbsG).toBe(250);
    expect(pair.lowerMacros.energyKcal).toBeCloseTo(2_600, 10);
    expect(pair.higherMacros.energyKcal).toBeCloseTo(2_600, 10);
    expect(pair.higherMacros.proteinG).toBeGreaterThan(pair.lowerMacros.proteinG);
    expect(pair.higherProtein.proteinContribution.availability).toBe("available");
    expect(pair.higherProtein.proteinContribution.repletionEffect).toBe("none");
    expect(pair.higherProtein.proteinContribution.independentBonus).toEqual(GLYCOGEN_PROTEIN_BONUS_POLICY_V7);
    expect(pair.higherProtein.proteinContribution.independentBonus.application).toBe("intentionally-not-applied");
    expect(glycogenRepletionOutcomeV7(pair.higherProtein)).toEqual(
      glycogenRepletionOutcomeV7(pair.lowerProtein),
    );
    expect(pair.higherProtein.repletionEvidence).toBe(pair.lowerProtein.repletionEvidence);
    expect(pair.higherProtein.quantitativeState).toEqual(pair.lowerProtein.quantitativeState);
    expect(pair.higherProtein).not.toHaveProperty("proteinGlycogenBonusKg");
    expect(pair.higherProtein).not.toHaveProperty("glycogenDeltaKg");
  });

  it("adult glycogen range is contextual rather than a universal clamp", () => {
    const initialized = initializeGlycogenRejectingAdultCapacityDefaultV7();
    expect(initialized.glycogenKg).toBeNull();
    expect(initialized.adultCapacityContext.role).toBe("research-context-metadata");
    expect(initialized.adultCapacityContext.literatureRangeKg).toEqual({
      lowerKg: 0.3,
      upperKg: 0.86,
    });
    expect(initialized.adultCapacityContext.mayClampGlycogenKg).toBe(false);
    expect(initialized.glycogenFromAdultCapacity.applied).toBe(false);
    expect(initialized.glycogenFromAdultCapacity.policy).toEqual(
      GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
    );
    expect(rejectAdultGlycogenCapacityAsPersonalCapacityV7().personalCapacityKg).toBeNull();
    expect(rejectAdultGlycogenCapacityAsValidatorV7({ glycogenKg: 0.1 }).accepted).toBe(false);
    expect(rejectAdultGlycogenCapacityClampV7({ glycogenKg: 1.5 }).resultingGlycogenKg).toBe(1.5);

    const below = buildGlycogenTransitionV7({
      priorGlycogenKg: 0.1,
      carbohydrate: glycogenCarbohydrateEvidenceV7({
        carbsG: 200,
        nutrition: {
          source: "observed",
          method: null,
          referenceDayCount: 0,
          gapLength: 0,
          referenceDates: [],
          observedFields: ["carbsG"],
          imputedFields: [],
          referenceCaloriesMedian: null,
          referenceCaloriesMad: null,
          referenceMacroMadG: null,
          dependency: "observed",
        },
      }),
      resistanceExposure: null,
      workoutFeedObserved: true,
      stepperWorkouts: [],
    });
    const above = buildGlycogenTransitionV7({
      priorGlycogenKg: 1.5,
      carbohydrate: below.carbohydrateEvidence,
      resistanceExposure: null,
      workoutFeedObserved: true,
      stepperWorkouts: [],
    });
    expect(below.adultCapacityContext.mayInitializeGlycogenKg).toBe(false);
    expect(below.quantitativeState.carriedForwardGlycogenKg).toBe(0.1);
    expect(above.quantitativeState.carriedForwardGlycogenKg).toBe(1.5);
    expect(below.glycogenFromAdultCapacity.applied).toBe(false);
    expect(below).not.toHaveProperty("personalGlycogenCapacityKg");

    const state = {
      fatMassKg: 18,
      skeletalMuscleKg: 28,
      otherLeanTissueKg: 17,
      glycogenKg: 0.1,
      glycogenWaterKg: null,
      ecfDeviationKg: null,
      transientExerciseWaterKg: null,
      adaptiveThermogenesisKcalPerDay: 0,
      weightFilterState: { estimatedWeightKg: 64, varianceKg2: 1 },
    };
    expect(applyGlycogenTransitionV7({ state, transition: below }).state.glycogenKg).toBe(0.1);
    expect(rejectResidualScaleWeightAsGlycogenV7({
      state,
      residualScaleWeightKg: 3,
    }).applied).toBe(false);

    const date = "2026-09-18";
    const sources = {
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
      priorState: runtimeStateFromStructuralStateV7({ ...state, glycogenKg: 1.5 }),
      sources,
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(day.fluidWater.glycogen.adultCapacityContext.mayValidateGlycogenKg).toBe(false);
    expect(day.resultingState.compartments.glycogenKg.valueKg).toBe(1.5);

    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate: date,
      toDate: date,
      initialState: runtimeStateFromStructuralStateV7(state),
      sources: {
        days: [sources],
        exposure: {
          historyFromDate: date,
          days: [{ date, workoutFeedObserved: true }],
          strengthWorkouts: [],
          sessions: [],
        },
      },
    });
    expect(rebuilt.finalState.compartments.glycogenKg.valueKg).toBe(0.1);
    expect(rebuilt.days[0]?.fluidWater.glycogen.glycogenFromAdultCapacity.applied).toBe(false);
  });

  it("glycogen-associated water co-moves without asserting a universal ratio", () => {
    const lower = calculateGlycogenAssociatedWaterKg(0.3);
    const higher = calculateGlycogenAssociatedWaterKg(0.4);

    expect(lower).toBeGreaterThanOrEqual(0);
    expect(higher).toBeGreaterThan(lower);
  });

  it("body-weight reconstruction counts glycogen-associated mass exactly once", () => {
    const state: BodyCompositionState = {
      fatMassKg: 18,
      leanTissueKg: 46,
      glycogenKg: 0.4,
      baselineExtracellularFluidLiters: 12,
      extracellularFluidDeviationLiters: 0.2,
    };
    const expectedComponentSum = state.fatMassKg
      + state.leanTissueKg
      + calculateGlycogenAssociatedMassKg(state.glycogenKg)
      + calculateExtracellularFluidMassKg(calculateExtracellularFluidLiters(state));

    expect(reconstructBodyWeightKg(state)).toBe(expectedComponentSum);
  });

  it("changing glycogen-associated mass does not change lean tissue", () => {
    const lower: BodyCompositionState = {
      fatMassKg: 18,
      leanTissueKg: 46,
      glycogenKg: 0.3,
      baselineExtracellularFluidLiters: 12,
      extracellularFluidDeviationLiters: 0,
    };
    const higher: BodyCompositionState = { ...lower, glycogenKg: 0.4 };

    expect(higher.leanTissueKg).toBe(lower.leanTissueKg);
    expect(reconstructBodyWeightKg(higher)).toBeGreaterThan(reconstructBodyWeightKg(lower));
  });

  it("lean mass is not skeletal muscle", () => {
    const initialized = initializePhysiologyV7StateRejectingLeanAsSkeletalMuscleV7({
      leanTissueKg: 54,
      endpointKind: "dxa-lean-soft-tissue",
    });
    expect(initialized.state.skeletalMuscleKg).toBeNull();
    expect(initialized.leanContext.role).toBe("aggregate-lean-context");
    expect(initialized.skeletalMuscleFromLean.applied).toBe(false);
    expect(initialized.skeletalMuscleFromLean.policy).toEqual(LEAN_MASS_NOT_SKELETAL_MUSCLE_POLICY_V7);

    const withMuscle = applyLeanMassObservationToPhysiologyV7State({
      state: {
        fatMassKg: 18,
        skeletalMuscleKg: 30,
        otherLeanTissueKg: null,
        glycogenKg: null,
        glycogenWaterKg: null,
        ecfDeviationKg: null,
        transientExerciseWaterKg: null,
        adaptiveThermogenesisKcalPerDay: null,
        weightFilterState: null,
      },
      leanObservation: { endpointKind: "bia-lean-mass", valueKg: 57 },
    });
    expect(withMuscle.state.skeletalMuscleKg).toBe(30);
    expect(withMuscle.skeletalMuscleFromLean.resultingSkeletalMuscleKg).toBe(30);
    expect(rejectLeanMassAsSkeletalMuscleValidatorV7({
      skeletalMuscleKg: 30,
      leanMassKg: 57,
    }).accepted).toBe(false);
    expect(rejectResidualLeanAsSkeletalMuscleV7({
      state: initialized.state,
      residualLeanKg: 50,
    }).applied).toBe(false);

    const date = "2026-09-18";
    const leanSources = {
      date,
      observedWeightKg: 80,
      observedBodyFatPercent: 22,
      nutrition: {
        caloriesKcal: 2_200,
        proteinG: 140,
        fatG: 70,
        carbsG: 240,
        provenance: observedNutritionProvenance(),
      },
      workoutFeedObserved: true,
      steps: 7_000,
      walkingRunningDistanceKm: 5,
      workouts: [] as const,
      stepperWorkouts: [] as const,
      context: {
        heartRateSampleCount: 0,
        restingHeartRateSampleCount: 0,
        sleepSegmentCount: 0,
      },
      leanMassObservation: {
        endpointKind: "device-reported-skeletal-muscle-proxy" as const,
        valueKg: 49,
      },
    };
    const day = buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: leanSources,
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(day.leanMassMeasurement.leanContext).toMatchObject({
      availability: "available",
      role: "aggregate-lean-context",
      valueKg: 49,
      skeletalMuscleInterpretation: "not-skeletal-muscle",
    });
    expect(day.resultingState.compartments.skeletalMuscleKg.availability).toBe("unavailable");
    expect(day.provenance.leanMassIsNotSkeletalMuscle).toBe(true);

    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate: date,
      toDate: date,
      initialState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: {
        days: [leanSources],
        exposure: {
          historyFromDate: date,
          days: [{ date, workoutFeedObserved: true }],
          strengthWorkouts: [],
          sessions: [],
        },
      },
    });
    expect(rebuilt.finalState.compartments.skeletalMuscleKg).toMatchObject({
      availability: "unavailable",
      valueKg: null,
    });
    expect(rebuilt.days[0]?.leanMassMeasurement.skeletalMuscleFromLean.applied).toBe(false);
  });

  it("local hypertrophy is not whole-body hypertrophy", () => {
    const localObservation = {
      endpointKind: "local-muscle-percent-change" as const,
      site: "vastus-lateralis",
      value: 5.2,
      unit: "percent-change" as const,
    };
    const initialized = initializePhysiologyV7StateRejectingLocalAsWholeBodyV7({ localObservation });
    expect(initialized.state.skeletalMuscleKg).toBeNull();
    expect(initialized.localContext.role).toBe("local-hypertrophy-proxy");
    expect(initialized.skeletalMuscleFromLocal.applied).toBe(false);
    expect(initialized.skeletalMuscleFromLocal.policy).toEqual(LOCAL_HYPERTROPHY_NOT_WHOLE_BODY_POLICY_V7);

    const withMuscle = applyLocalMuscleObservationToPhysiologyV7State({
      state: {
        fatMassKg: 18,
        skeletalMuscleKg: 30,
        otherLeanTissueKg: null,
        glycogenKg: null,
        glycogenWaterKg: null,
        ecfDeviationKg: null,
        transientExerciseWaterKg: null,
        adaptiveThermogenesisKcalPerDay: null,
        weightFilterState: null,
      },
      localObservation: {
        endpointKind: "mri-muscle-csa",
        site: "vastus-lateralis",
        value: 80,
        unit: "cm2-csa",
      },
    });
    expect(withMuscle.state.skeletalMuscleKg).toBe(30);
    expect(withMuscle.skeletalMuscleFromLocal.resultingSkeletalMuscleKg).toBe(30);
    expect(rejectLocalMuscleAsSkeletalMuscleValidatorV7({
      skeletalMuscleKg: 30,
      localObservation,
    }).accepted).toBe(false);
    expect(rejectLocalMuscleAsSkeletalMuscleCalibratorV7({
      skeletalMuscleKg: 30,
      localObservation,
    }).accepted).toBe(false);
    expect(rejectResidualLocalAsSkeletalMuscleV7({
      state: initialized.state,
      residualLocalValue: 5.2,
    }).applied).toBe(false);

    const date = "2026-09-18";
    const localSources = {
      date,
      observedWeightKg: 80,
      observedBodyFatPercent: 22,
      nutrition: {
        caloriesKcal: 2_200,
        proteinG: 140,
        fatG: 70,
        carbsG: 240,
        provenance: observedNutritionProvenance(),
      },
      workoutFeedObserved: true,
      steps: 7_000,
      walkingRunningDistanceKm: 5,
      workouts: [] as const,
      stepperWorkouts: [] as const,
      context: {
        heartRateSampleCount: 0,
        restingHeartRateSampleCount: 0,
        sleepSegmentCount: 0,
      },
      localMuscleObservation: localObservation,
    };
    const day = buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: localSources,
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(day.localMuscleMeasurement.localContext).toMatchObject({
      availability: "available",
      role: "local-hypertrophy-proxy",
      value: 5.2,
      wholeBodyInterpretation: "not-whole-body-skeletal-muscle",
    });
    expect(day.resultingState.compartments.skeletalMuscleKg.availability).toBe("unavailable");
    expect(day.provenance.localHypertrophyIsNotWholeBodySkeletalMuscle).toBe(true);

    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate: date,
      toDate: date,
      initialState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: {
        days: [localSources],
        exposure: {
          historyFromDate: date,
          days: [{ date, workoutFeedObserved: true }],
          strengthWorkouts: [],
          sessions: [],
        },
      },
    });
    expect(rebuilt.finalState.compartments.skeletalMuscleKg).toMatchObject({
      availability: "unavailable",
      valueKg: null,
    });
    expect(rebuilt.days[0]?.localMuscleMeasurement.skeletalMuscleFromLocal.applied).toBe(false);
  });

  it("acute MPS is not accumulated muscle mass", () => {
    const mpsObservation = {
      endpointKind: "isotope-tracer-fsr" as const,
      value: 0.08,
      unit: "percent-per-hour" as const,
      tissueSite: "vastus-lateralis",
    };
    const initialized = initializePhysiologyV7StateRejectingMpsAsSkeletalMuscleV7({ mpsObservation });
    expect(initialized.state.skeletalMuscleKg).toBeNull();
    expect(initialized.mpsContext.role).toBe("acute-mps-mechanistic-context");
    expect(initialized.skeletalMuscleFromMps.applied).toBe(false);
    expect(initialized.skeletalMuscleFromMps.policy).toEqual(ACUTE_MPS_NOT_SKELETAL_MUSCLE_POLICY_V7);
    expect(initialized).not.toHaveProperty("mpsToSkeletalMuscleKg");

    const withMuscle = applyAcuteMpsObservationToPhysiologyV7State({
      state: {
        fatMassKg: 18,
        skeletalMuscleKg: 30,
        otherLeanTissueKg: null,
        glycogenKg: null,
        glycogenWaterKg: null,
        ecfDeviationKg: null,
        transientExerciseWaterKg: null,
        adaptiveThermogenesisKcalPerDay: null,
        weightFilterState: null,
      },
      mpsObservation: {
        endpointKind: "acute-mps-percent-response",
        value: 150,
        unit: "percent-change",
      },
    });
    expect(withMuscle.state.skeletalMuscleKg).toBe(30);
    expect(withMuscle.skeletalMuscleFromMps.resultingSkeletalMuscleKg).toBe(30);
    expect(rejectAcuteMpsAsSkeletalMuscleValidatorV7({
      skeletalMuscleKg: 30,
      mpsObservation,
    }).accepted).toBe(false);
    expect(rejectAcuteMpsAsSkeletalMuscleCalibratorV7({
      skeletalMuscleKg: 30,
      mpsObservation,
    }).accepted).toBe(false);
    expect(rejectAcuteMpsAsSkeletalMuscleNumericTransitionV7({
      skeletalMuscleKg: 30,
      mpsObservation,
    })).toMatchObject({
      applied: false,
      resultingSkeletalMuscleKg: 30,
    });
    expect(rejectResidualMpsAsSkeletalMuscleV7({
      state: initialized.state,
      residualMpsValue: 0.08,
    }).applied).toBe(false);

    const date = "2026-09-18";
    const mpsSources = {
      date,
      observedWeightKg: 80,
      observedBodyFatPercent: 22,
      nutrition: {
        caloriesKcal: 2_200,
        proteinG: 140,
        fatG: 70,
        carbsG: 240,
        provenance: observedNutritionProvenance(),
      },
      workoutFeedObserved: true,
      steps: 7_000,
      walkingRunningDistanceKm: 5,
      workouts: [] as const,
      stepperWorkouts: [] as const,
      context: {
        heartRateSampleCount: 0,
        restingHeartRateSampleCount: 0,
        sleepSegmentCount: 0,
      },
      acuteMpsObservation: mpsObservation,
    };
    const day = buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: mpsSources,
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(day.acuteMpsMeasurement.mpsContext).toMatchObject({
      availability: "available",
      role: "acute-mps-mechanistic-context",
      value: 0.08,
      skeletalMuscleInterpretation: "not-accumulated-skeletal-muscle-kg",
    });
    expect(day.trainingAdaptation.response.acuteMpsContext).toMatchObject({
      availability: "available",
      role: "acute-mps-mechanistic-context",
      mayNumericallyTransitionSkeletalMuscleKg: false,
    });
    expect(day.trainingAdaptation.response.calibration.rejectedConversions).toContain(
      "acute-mps-to-chronic-skeletal-muscle-kg",
    );
    expect(day.resultingState.compartments.skeletalMuscleKg.availability).toBe("unavailable");
    expect(day.provenance.acuteMpsIsNotAccumulatedSkeletalMuscle).toBe(true);

    const adaptation = buildResistanceTrainingAdaptationResponseV7({
      date,
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
      mpsObservation,
    });
    const transitioned = applyTrainingAdaptationTransitionV7({
      state: {
        fatMassKg: 18,
        skeletalMuscleKg: 30,
        otherLeanTissueKg: null,
        glycogenKg: null,
        glycogenWaterKg: null,
        ecfDeviationKg: null,
        transientExerciseWaterKg: null,
        adaptiveThermogenesisKcalPerDay: null,
        weightFilterState: null,
      },
      response: adaptation,
    });
    expect(transitioned.state.skeletalMuscleKg).toBe(30);
    expect(transitioned.transition.skeletalMuscleTransition.biologicalTransition).toBe("not-modeled");

    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate: date,
      toDate: date,
      initialState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: {
        days: [mpsSources],
        exposure: {
          historyFromDate: date,
          days: [{ date, workoutFeedObserved: true }],
          strengthWorkouts: [],
          sessions: [],
        },
      },
    });
    expect(rebuilt.finalState.compartments.skeletalMuscleKg).toMatchObject({
      availability: "unavailable",
      valueKg: null,
    });
    expect(rebuilt.days[0]?.acuteMpsMeasurement.skeletalMuscleFromMps.applied).toBe(false);
  });

  it("strength loss is not muscle loss", () => {
    const strengthObservation = {
      endpointKind: "strength-trend" as const,
      value: -12,
      unit: "percent-change" as const,
      movement: "back-squat",
    };
    const initialized = initializePhysiologyV7StateRejectingStrengthAsSkeletalMuscleV7({
      strengthObservation,
    });
    expect(initialized.state.skeletalMuscleKg).toBeNull();
    expect(initialized.strengthContext.role).toBe("strength-performance-context");
    expect(initialized.skeletalMuscleFromStrength.applied).toBe(false);
    expect(initialized.skeletalMuscleFromStrength.policy).toEqual(
      STRENGTH_PERFORMANCE_NOT_SKELETAL_MUSCLE_POLICY_V7,
    );
    expect(initialized).not.toHaveProperty("strengthToSkeletalMuscleKg");

    const withMuscle = applyStrengthPerformanceObservationToPhysiologyV7State({
      state: {
        fatMassKg: 18,
        skeletalMuscleKg: 30,
        otherLeanTissueKg: null,
        glycogenKg: null,
        glycogenWaterKg: null,
        ecfDeviationKg: null,
        transientExerciseWaterKg: null,
        adaptiveThermogenesisKcalPerDay: null,
        weightFilterState: null,
      },
      strengthObservation: {
        endpointKind: "one-rep-max",
        value: 140,
        unit: "kg-load",
        movement: "deadlift",
      },
    });
    expect(withMuscle.state.skeletalMuscleKg).toBe(30);
    expect(withMuscle.skeletalMuscleFromStrength.resultingSkeletalMuscleKg).toBe(30);
    expect(rejectStrengthAsSkeletalMuscleValidatorV7({
      skeletalMuscleKg: 30,
      strengthObservation,
    }).accepted).toBe(false);
    expect(rejectStrengthAsSkeletalMuscleCalibratorV7({
      skeletalMuscleKg: 30,
      strengthObservation,
    }).accepted).toBe(false);
    expect(rejectStrengthAsSkeletalMuscleNumericTransitionV7({
      skeletalMuscleKg: 30,
      strengthObservation,
    })).toMatchObject({
      applied: false,
      resultingSkeletalMuscleKg: 30,
    });
    expect(rejectResidualStrengthAsSkeletalMuscleV7({
      state: initialized.state,
      residualStrengthValue: -12,
    }).applied).toBe(false);

    const date = "2026-09-18";
    const strengthSources = {
      date,
      observedWeightKg: 80,
      observedBodyFatPercent: 22,
      nutrition: {
        caloriesKcal: 2_200,
        proteinG: 140,
        fatG: 70,
        carbsG: 240,
        provenance: observedNutritionProvenance(),
      },
      workoutFeedObserved: true,
      steps: 7_000,
      walkingRunningDistanceKm: 5,
      workouts: [] as const,
      stepperWorkouts: [] as const,
      context: {
        heartRateSampleCount: 0,
        restingHeartRateSampleCount: 0,
        sleepSegmentCount: 0,
      },
      strengthPerformanceObservation: strengthObservation,
    };
    const day = buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: strengthSources,
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(day.strengthPerformanceMeasurement.strengthContext).toMatchObject({
      availability: "available",
      role: "strength-performance-context",
      value: -12,
      skeletalMuscleInterpretation: "not-skeletal-muscle-tissue",
    });
    expect(day.trainingAdaptation.response.strengthPerformanceContext).toMatchObject({
      availability: "available",
      role: "strength-performance-context",
      mayNumericallyTransitionSkeletalMuscleKg: false,
    });
    expect(day.trainingAdaptation.response.calibration.rejectedConversions).toContain(
      "strength-performance-to-skeletal-muscle-kg",
    );
    expect(day.resultingState.compartments.skeletalMuscleKg.availability).toBe("unavailable");
    expect(day.provenance.strengthPerformanceIsNotSkeletalMuscle).toBe(true);

    const adaptation = buildResistanceTrainingAdaptationResponseV7({
      date,
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
      strengthObservation,
    });
    const transitioned = applyTrainingAdaptationTransitionV7({
      state: {
        fatMassKg: 18,
        skeletalMuscleKg: 30,
        otherLeanTissueKg: null,
        glycogenKg: null,
        glycogenWaterKg: null,
        ecfDeviationKg: null,
        transientExerciseWaterKg: null,
        adaptiveThermogenesisKcalPerDay: null,
        weightFilterState: null,
      },
      response: adaptation,
    });
    expect(transitioned.state.skeletalMuscleKg).toBe(30);
    expect(transitioned.transition.skeletalMuscleTransition.biologicalTransition).toBe("not-modeled");

    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate: date,
      toDate: date,
      initialState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: {
        days: [strengthSources],
        exposure: {
          historyFromDate: date,
          days: [{ date, workoutFeedObserved: true }],
          strengthWorkouts: [],
          sessions: [],
        },
      },
    });
    expect(rebuilt.finalState.compartments.skeletalMuscleKg).toMatchObject({
      availability: "unavailable",
      valueKg: null,
    });
    expect(rebuilt.days[0]?.strengthPerformanceMeasurement.skeletalMuscleFromStrength.applied).toBe(false);
  });

  it("device active energy retains estimate provenance", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(211)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.perEvent).toEqual([{
      classification: "stair-climbing",
      source: "device-active-kcal",
      kcal: 211,
    }]);
  });

  it("maximum HR alone does not determine active energy", () => {
    const shorter = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence({ durationMinutes: 10 }));
    const longer = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence({ durationMinutes: 60 }));

    expect(shorter.activeEnergy).toEqual({
      availability: "unavailable",
      availabilityReason: "no-device-active-energy",
    });
    expect(longer.activeEnergy).toEqual(shorter.activeEnergy);
    expect(shorter.heartRateContext).toEqual(v7EnergyEvidence({ durationMinutes: 10 }).heartRate);
  });

  it("sparse HR cannot recover unobserved transitions", () => {
    const early = canonicalizeWorkoutHeartRateEvidenceV7({
      workoutInterval: { startAt: "2026-09-17T16:00:00.000Z", endAt: "2026-09-17T17:00:00.000Z" },
      heartRate: { availability: "loaded", samples: [
        { timestamp: "2026-09-17T16:05:00.000Z", bpm: 100, provenance: { provider: "shortcut", device: null } },
        { timestamp: "2026-09-17T16:10:00.000Z", bpm: 140, provenance: { provider: "shortcut", device: null } },
      ] },
    });
    const irregular = canonicalizeWorkoutHeartRateEvidenceV7({
      workoutInterval: { startAt: "2026-09-17T16:00:00.000Z", endAt: "2026-09-17T17:00:00.000Z" },
      heartRate: { availability: "loaded", samples: [
        { timestamp: "2026-09-17T16:45:00.000Z", bpm: 100, provenance: { provider: "shortcut", device: null } },
        { timestamp: "2026-09-17T16:55:00.000Z", bpm: 140, provenance: { provider: "shortcut", device: null } },
      ] },
    });

    expect(early.summary).toEqual({ sampleMeanBpm: 120, maxObservedBpm: 140, basis: "observed-samples-only" });
    expect(irregular.summary).toEqual(early.summary);
    expect(irregular.samplingTopology).not.toEqual(early.samplingTopology);

    const earlyEnergy = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence({ heartRate: early }));
    const irregularEnergy = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence({ heartRate: irregular }));
    expect(earlyEnergy.activeEnergy).toEqual({ availability: "unavailable", availabilityReason: "no-device-active-energy" });
    expect(irregularEnergy.activeEnergy).toEqual(earlyEnergy.activeEnergy);
    expect(earlyEnergy.activeEnergy).not.toHaveProperty("valueKcal");
    expect(irregularEnergy.activeEnergy).not.toHaveProperty("valueKcal");

    // P-K04 has no audited numeric adequacy threshold. Topology is exposed as
    // observation fact only: no scientific quality label or confidence upgrade.
    expect(irregular).not.toHaveProperty("coveragePercent");
    expect(irregular).not.toHaveProperty("adequacyClassification");
    expect(irregularEnergy).not.toHaveProperty("confidence");
  });

  it("v7 device active energy is available once with active semantics and estimate provenance", () => {
    const result = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence({
      deviceEnergy: {
        availability: "available",
        sourceValueStatus: "observed",
        valueKcal: 211,
        semantics: "active",
        provenance: "device-estimate",
      },
    }));

    expect(result.activeEnergy).toEqual({
      availability: "available",
      valueKcal: 211,
      semantics: "active",
      provenance: "device-estimate",
    });
  });

  it("device active energy is counted once without a resting-energy adjustment", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(211)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.deviceActiveEnergyKcal).toBe(211);
    expect(result.strengthMetFallbackKcal).toBe(0);
    expect(result.workoutActivityKcal).toBe(211);
  });

  it("observed workout active energy receives no automatic EPOC add-on", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(211)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.workoutActivityKcal).toBe(result.deviceActiveEnergyKcal);
  });

  it("workout energy is not multiplied by a universal EPOC percentage", () => {
    const first = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(200)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });
    const second = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(400)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(first.workoutActivityKcal).toBe(200);
    expect(second.workoutActivityKcal).toBe(400);
  });

  it("the represented workout active-energy interval is counted exactly once", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(120), stairEvent(90)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.workoutActivityKcal).toBe(120 + 90);
    expect(result.deviceActiveEnergyKcal).toBe(result.workoutActivityKcal);
  });

  it("excluding an EPOC add-on does not deny EPOC physiology", () => {
    const device = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence({
      deviceEnergy: {
        availability: "available",
        sourceValueStatus: "observed",
        valueKcal: 211,
        semantics: "active",
        provenance: "device-estimate",
      },
    }));
    const missing = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence());
    const production = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(211)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(device.activeEnergy).toEqual({
      availability: "available",
      valueKcal: 211,
      semantics: "active",
      provenance: "device-estimate",
    });
    expect(device.recoveryEnergy.application).toBe("intentionally-not-applied");
    expect(device.recoveryEnergy.numericComponent).toBe("rejected");
    expect(device.recoveryEnergy.researchAuthority).toBe("research-6.1");
    expect(device.recoveryEnergy.scientificDecision).toBe("uncertainty-and-double-counting");
    expect(device.recoveryEnergy.physiologyClaim).toBe("does-not-assert-epoc-is-physiologically-zero");
    expect(device.recoveryEnergy.addedKcal).toBeNull();
    expect(missing.recoveryEnergy).toEqual(device.recoveryEnergy);
    expect(production.recoveryEnergy).toEqual(device.recoveryEnergy);
    expect(production.workoutActivityKcal).toBe(211);
    expect(production).not.toHaveProperty("epocKcal");
    expect(device).not.toHaveProperty("epocKcal");
  });

  it("hard-set dose remains available without tonnage", () => {
    const pressSnapshot = buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press");
    const pushupSnapshot = buildExerciseMuscleMappingSnapshotV7("pushup_handles");
    const rowSnapshot = buildExerciseMuscleMappingSnapshotV7("one_arm_seated_cable_row");

    function session(partial: Partial<StrengthSessionDto> & {
      exercises: StrengthSessionDto["exercises"];
    }): StrengthSessionDto {
      return {
        id: 42,
        status: "COMPLETED",
        entryMode: "RETROSPECTIVE",
        revision: 2,
        programId: 7,
        programName: "Upper",
        programVersionId: 9,
        programVersionNumber: 1,
        webStartedAt: null,
        webEndedAt: null,
        matchStatus: "MATCHED",
        matchMethod: "DIRECT_BACKFILL",
        matchedAt: "2026-09-17T18:30:00.000Z",
        matchedWorkoutId: 99,
        matchedWorkout: {
          id: 99,
          type: "Strength Training",
          startAt: "2026-09-17T17:00:00.000Z",
          endAt: "2026-09-17T18:00:00.000Z",
          durationMinutes: 60,
          activeEnergyKcal: 400,
          externalId: "garmin-99",
        },
        ordinaryTonnageKg: null,
        createdAt: "2026-09-17T17:00:00.000Z",
        updatedAt: "2026-09-17T18:30:00.000Z",
        ...partial,
      };
    }

    const externalWeight = buildCanonicalStrengthTrainingInputV7({
      session: session({
        ordinaryTonnageKg: 720,
        exercises: [{
          id: 1,
          sourceExerciseCatalogId: 10,
          stableKey: null,
          snapshotExerciseName: "Press",
          order: 1,
          plannedSets: 3,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
          origin: "PLANNED",
          muscleMappingSnapshot: pressSnapshot,
          sets: [{
            id: 11,
            sessionExerciseId: 1,
            setNumber: 1,
            reps: 8,
            weightKg: 30,
            bandNominalResistanceKg: null,
            rir: null,
            comment: null,
            completedAt: null,
            createdAt: "2026-09-17T17:00:00.000Z",
            updatedAt: "2026-09-17T17:00:00.000Z",
          }],
        }],
      }),
      heartRateSamples: null,
    });
    const bodyweight = buildCanonicalStrengthTrainingInputV7({
      session: session({
        ordinaryTonnageKg: null,
        exercises: [{
          id: 2,
          sourceExerciseCatalogId: 11,
          stableKey: null,
          snapshotExerciseName: "Push-up",
          order: 1,
          plannedSets: 3,
          resistanceType: RESISTANCE.BODYWEIGHT,
          origin: "PLANNED",
          muscleMappingSnapshot: pushupSnapshot,
          sets: [{
            id: 12,
            sessionExerciseId: 2,
            setNumber: 1,
            reps: 15,
            weightKg: null,
            bandNominalResistanceKg: null,
            rir: null,
            comment: null,
            completedAt: "2026-09-17T17:05:00.000Z",
            createdAt: "2026-09-17T17:00:00.000Z",
            updatedAt: "2026-09-17T17:00:00.000Z",
          }],
        }],
      }),
      heartRateSamples: null,
    });
    const band = buildCanonicalStrengthTrainingInputV7({
      session: session({
        ordinaryTonnageKg: null,
        exercises: [{
          id: 3,
          sourceExerciseCatalogId: 12,
          stableKey: null,
          snapshotExerciseName: "Band row",
          order: 1,
          plannedSets: 4,
          resistanceType: RESISTANCE.RESISTANCE_BAND,
          origin: "PLANNED",
          muscleMappingSnapshot: rowSnapshot,
          sets: [{
            id: 13,
            sessionExerciseId: 3,
            setNumber: 1,
            reps: 12,
            weightKg: null,
            bandNominalResistanceKg: 15,
            rir: null,
            comment: null,
            completedAt: null,
            createdAt: "2026-09-17T17:00:00.000Z",
            updatedAt: "2026-09-17T17:00:00.000Z",
          }],
        }],
      }),
      heartRateSamples: null,
    });

    const withTonnage = buildQualifiedResistanceTrainingDoseV7(externalWeight, {
      ordinaryTonnageKg: 720,
    });
    const bodyweightDose = buildQualifiedResistanceTrainingDoseV7(bodyweight, {
      ordinaryTonnageKg: null,
    });
    const bandDose = buildQualifiedResistanceTrainingDoseV7(band, {
      ordinaryTonnageKg: null,
    });
    const tonnageRemoved = buildQualifiedResistanceTrainingDoseV7(externalWeight, {
      ordinaryTonnageKg: null,
    });

    expect(withTonnage.availability).toBe("available");
    expect(bodyweightDose.availability).toBe("available");
    expect(bandDose.availability).toBe("available");
    expect(tonnageRemoved.availability).toBe("available");
    if (
      withTonnage.availability === "available"
      && bodyweightDose.availability === "available"
      && bandDose.availability === "available"
      && tonnageRemoved.availability === "available"
    ) {
      expect(withTonnage.mappedSetCount).toBeGreaterThan(0);
      expect(bodyweightDose.mappedSetCount).toBeGreaterThan(0);
      expect(bandDose.mappedSetCount).toBeGreaterThan(0);
      expect(bodyweightDose.ordinaryTonnageKg).toBeNull();
      expect(bandDose.ordinaryTonnageKg).toBeNull();
      expect(qualifiedResistanceTrainingDoseV7Fingerprint(tonnageRemoved))
        .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(withTonnage));
      expect(withTonnage.hardSetQualification).toEqual({
        status: "qualified-by-product-assumption",
        assumption: "assumed-near-failure",
      });
    }
  });

  it("missing HR does not erase strength stimulus", () => {
    const snapshot = buildExerciseMuscleMappingSnapshotV7("flat_dumbbell_fly");
    const session: StrengthSessionDto = {
      id: 55,
      status: "COMPLETED",
      entryMode: "RETROSPECTIVE",
      revision: 4,
      programId: 7,
      programName: "Chest",
      programVersionId: 9,
      programVersionNumber: 1,
      webStartedAt: null,
      webEndedAt: null,
      matchStatus: "MATCHED",
      matchMethod: "DIRECT_BACKFILL",
      matchedAt: "2026-09-17T18:30:00.000Z",
      matchedWorkoutId: 99,
      matchedWorkout: {
        id: 99,
        type: "Strength Training",
        startAt: "2026-09-17T17:00:00.000Z",
        endAt: "2026-09-17T18:00:00.000Z",
        durationMinutes: 60,
        activeEnergyKcal: 400,
        externalId: "garmin-99",
      },
      exercises: [{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: null,
        snapshotExerciseName: "Fly",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: snapshot,
        sets: [{
          id: 11,
          sessionExerciseId: 1,
          setNumber: 1,
          reps: 10,
          weightKg: 12,
          bandNominalResistanceKg: null,
          rir: null,
          comment: null,
          completedAt: null,
          createdAt: "2026-09-17T17:00:00.000Z",
          updatedAt: "2026-09-17T17:00:00.000Z",
        }],
      }],
      ordinaryTonnageKg: 120,
      createdAt: "2026-09-17T17:00:00.000Z",
      updatedAt: "2026-09-17T18:30:00.000Z",
    };

    const withHr = buildCanonicalStrengthTrainingInputV7({
      session,
      heartRateSamples: [
        { timestamp: "2026-09-17T17:01:00.000Z", bpm: 140, source: "shortcut" },
      ],
    });
    const withoutHr = buildCanonicalStrengthTrainingInputV7({
      session,
      heartRateSamples: null,
    });

    const doseWithHr = buildQualifiedResistanceTrainingDoseV7(withHr, {
      ordinaryTonnageKg: 120,
    });
    const doseWithoutHr = buildQualifiedResistanceTrainingDoseV7(withoutHr, {
      ordinaryTonnageKg: 120,
    });

    expect(doseWithHr.availability).toBe("available");
    expect(doseWithoutHr.availability).toBe("available");
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(doseWithHr))
      .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(doseWithoutHr));
    if (doseWithHr.availability === "available" && doseWithoutHr.availability === "available") {
      expect(doseWithHr.heartRateContext.availability).toBe("loaded");
      expect(doseWithoutHr.heartRateContext.availability).toBe("unavailable");
      expect(doseWithHr.mappedSetCount).toBe(doseWithoutHr.mappedSetCount);
      expect(doseWithHr.muscleGroups).toEqual(doseWithoutHr.muscleGroups);
    }
  });

  it("no unsupported hard volume cap", () => {
    const series = buildIncreasingQualifiedSetDoseAdaptationSeriesV7([1, 6, 12, 20, 40]);
    expect(series.map((row) => row.qualifiedHardSetCount)).toEqual([1, 6, 12, 20, 40]);

    for (const row of series) {
      expect(row.response.trainingStimulus).toMatchObject({
        availability: "available",
        status: "qualified-mapped-training-dose",
        qualifiedHardSetCount: row.qualifiedHardSetCount,
      });
      expect(row.expectedLocalAdaptation.availability).toBe("available");
      expect(row.expectedLocalAdaptation.expectedPolarity).toBe("nonnegative-stimulus-evidence");
      expect(row.expectedLocalAdaptation.cutoffForcedZeroOrNegative).toBe(false);
      expect(row.expectedLocalAdaptation.volumeCapPolicy).toEqual(RESISTANCE_TRAINING_VOLUME_CAP_POLICY_V7);
      expect(row.expectedLocalAdaptation.volumeCapPolicy.application).toBe("intentionally-not-applied");
      expect(row.expectedLocalAdaptation.volumeCapPolicy.forcesZeroOrNegativeSolelyByCrossing).toBe(false);
      expect(row.response.calibration.qualitativeConstraints).toContain(
        "no-universal-set-cutoff-forces-zero-or-negative-expected-adaptation",
      );
      expect(row.response.calibration.rejectedConversions).toContain(
        "universal-set-cutoff-to-zero-or-negative-hypertrophy",
      );
      expect(row.response.muscleMassTransition.availability).toBe("unavailable");
      expect(row.response).not.toHaveProperty("skeletalMuscleDeltaKg");
      expect(row.response).not.toHaveProperty("hypertrophyScore");
      expect(row.response).not.toHaveProperty("setCutoffZeroGain");
    }

    const high = series[series.length - 1]!;
    const low = series[0]!;
    expect(high.qualifiedHardSetCount).toBeGreaterThan(low.qualifiedHardSetCount);
    expect(high.expectedLocalAdaptation.expectedPolarity).toBe(low.expectedLocalAdaptation.expectedPolarity);
    expect(high.expectedLocalAdaptation.cutoffForcedZeroOrNegative).toBe(false);
  });

  it("load is not a standalone hypertrophy multiplier", () => {
    const snapshot = buildExerciseMuscleMappingSnapshotV7("incline_dumbbell_press_30deg");

    function sessionAtLoad(weightKg: number, ordinaryTonnageKg: number): StrengthSessionDto {
      return {
        id: 61,
        status: "COMPLETED",
        entryMode: "RETROSPECTIVE",
        revision: 1,
        programId: 7,
        programName: "Press",
        programVersionId: 9,
        programVersionNumber: 1,
        webStartedAt: null,
        webEndedAt: null,
        matchStatus: "MATCHED",
        matchMethod: "DIRECT_BACKFILL",
        matchedAt: "2026-09-17T18:30:00.000Z",
        matchedWorkoutId: 99,
        matchedWorkout: {
          id: 99,
          type: "Strength Training",
          startAt: "2026-09-17T17:00:00.000Z",
          endAt: "2026-09-17T18:00:00.000Z",
          durationMinutes: 60,
          activeEnergyKcal: 400,
          externalId: "garmin-99",
        },
        exercises: [{
          id: 1,
          sourceExerciseCatalogId: 10,
          stableKey: "incline_dumbbell_press_30deg",
          snapshotExerciseName: "Incline DB press",
          order: 1,
          plannedSets: 3,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
          origin: "PLANNED",
          muscleMappingSnapshot: snapshot,
          sets: [{
            id: 11,
            sessionExerciseId: 1,
            setNumber: 1,
            reps: 10,
            weightKg,
            bandNominalResistanceKg: null,
            rir: null,
            comment: null,
            completedAt: null,
            createdAt: "2026-09-17T17:00:00.000Z",
            updatedAt: "2026-09-17T17:00:00.000Z",
          }],
        }],
        ordinaryTonnageKg,
        createdAt: "2026-09-17T17:00:00.000Z",
        updatedAt: "2026-09-17T18:30:00.000Z",
      };
    }

    const lowerLoad = buildCanonicalStrengthTrainingInputV7({
      session: sessionAtLoad(20, 400),
      heartRateSamples: null,
    });
    const higherLoad = buildCanonicalStrengthTrainingInputV7({
      session: sessionAtLoad(40, 800),
      heartRateSamples: null,
    });

    const lowerDose = buildQualifiedResistanceTrainingDoseV7(lowerLoad, { ordinaryTonnageKg: 400 });
    const higherDose = buildQualifiedResistanceTrainingDoseV7(higherLoad, { ordinaryTonnageKg: 800 });

    expect(lowerDose.availability).toBe("available");
    expect(higherDose.availability).toBe("available");
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(lowerDose))
      .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(higherDose));
    if (lowerDose.availability === "available" && higherDose.availability === "available") {
      expect(lowerDose.mappedSetCount).toBe(higherDose.mappedSetCount);
      expect(lowerDose.muscleGroups).toEqual(higherDose.muscleGroups);
      expect(lowerDose.hardSetQualification).toEqual(higherDose.hardSetQualification);
      expect(lowerDose.ordinaryTonnageKg).toBe(400);
      expect(higherDose.ordinaryTonnageKg).toBe(800);
      expect(lowerDose).not.toHaveProperty("loadMultiplier");
      expect(higherDose).not.toHaveProperty("hypertrophyKg");
    }
  });

  it("resistance-training HR adds no independent hypertrophy multiplier", () => {
    const snapshot = buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press");
    const session: StrengthSessionDto = {
      id: 62,
      status: "COMPLETED",
      entryMode: "RETROSPECTIVE",
      revision: 2,
      programId: 7,
      programName: "Shoulders",
      programVersionId: 9,
      programVersionNumber: 1,
      webStartedAt: null,
      webEndedAt: null,
      matchStatus: "MATCHED",
      matchMethod: "DIRECT_BACKFILL",
      matchedAt: "2026-09-17T18:30:00.000Z",
      matchedWorkoutId: 99,
      matchedWorkout: {
        id: 99,
        type: "Strength Training",
        startAt: "2026-09-17T17:00:00.000Z",
        endAt: "2026-09-17T18:00:00.000Z",
        durationMinutes: 60,
        activeEnergyKcal: 400,
        externalId: "garmin-99",
      },
      exercises: [{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: "seated_dumbbell_press",
        snapshotExerciseName: "Seated DB press",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: snapshot,
        sets: [{
          id: 11,
          sessionExerciseId: 1,
          setNumber: 1,
          reps: 8,
          weightKg: 24,
          bandNominalResistanceKg: null,
          rir: null,
          comment: null,
          completedAt: null,
          createdAt: "2026-09-17T17:00:00.000Z",
          updatedAt: "2026-09-17T17:00:00.000Z",
        }],
      }],
      ordinaryTonnageKg: 384,
      createdAt: "2026-09-17T17:00:00.000Z",
      updatedAt: "2026-09-17T18:30:00.000Z",
    };

    const unavailableHr = buildCanonicalStrengthTrainingInputV7({
      session,
      heartRateSamples: null,
    });
    const moderateHr = buildCanonicalStrengthTrainingInputV7({
      session,
      heartRateSamples: [
        { timestamp: "2026-09-17T17:05:00.000Z", bpm: 120, source: "shortcut" },
        { timestamp: "2026-09-17T17:20:00.000Z", bpm: 130, source: "shortcut" },
      ],
    });
    const higherHr = buildCanonicalStrengthTrainingInputV7({
      session,
      heartRateSamples: [
        { timestamp: "2026-09-17T17:05:00.000Z", bpm: 150, source: "shortcut" },
        { timestamp: "2026-09-17T17:20:00.000Z", bpm: 170, source: "shortcut" },
      ],
    });

    const doseUnavailable = buildQualifiedResistanceTrainingDoseV7(unavailableHr, {
      ordinaryTonnageKg: 384,
    });
    const doseModerate = buildQualifiedResistanceTrainingDoseV7(moderateHr, {
      ordinaryTonnageKg: 384,
    });
    const doseHigher = buildQualifiedResistanceTrainingDoseV7(higherHr, {
      ordinaryTonnageKg: 384,
    });

    expect(doseUnavailable.availability).toBe("available");
    expect(doseModerate.availability).toBe("available");
    expect(doseHigher.availability).toBe("available");
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(doseUnavailable))
      .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(doseModerate));
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(doseModerate))
      .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(doseHigher));
    if (
      doseUnavailable.availability === "available"
      && doseModerate.availability === "available"
      && doseHigher.availability === "available"
    ) {
      expect(doseUnavailable.heartRateContext.availability).toBe("unavailable");
      expect(doseModerate.heartRateContext.availability).toBe("loaded");
      expect(doseHigher.heartRateContext.availability).toBe("loaded");
      expect(doseUnavailable.mappedSetCount).toBe(doseHigher.mappedSetCount);
      expect(doseUnavailable.muscleGroups).toEqual(doseHigher.muscleGroups);
      expect(doseUnavailable).not.toHaveProperty("heartRateMultiplier");
      expect(doseHigher).not.toHaveProperty("anabolicHrBonus");
    }
  });

  it("equal HR does not imply equal local stimulus", () => {
    const sharedHrSamples = [
      { timestamp: "2026-09-17T17:10:00.000Z", bpm: 140, source: "shortcut" },
      { timestamp: "2026-09-17T17:25:00.000Z", bpm: 160, source: "shortcut" },
    ] as const;

    function sessionFor(
      id: number,
      exercise: StrengthSessionDto["exercises"][number],
    ): StrengthSessionDto {
      return {
        id,
        status: "COMPLETED",
        entryMode: "RETROSPECTIVE",
        revision: 1,
        programId: 7,
        programName: "Split",
        programVersionId: 9,
        programVersionNumber: 1,
        webStartedAt: null,
        webEndedAt: null,
        matchStatus: "MATCHED",
        matchMethod: "DIRECT_BACKFILL",
        matchedAt: "2026-09-17T18:30:00.000Z",
        matchedWorkoutId: 99,
        matchedWorkout: {
          id: 99,
          type: "Strength Training",
          startAt: "2026-09-17T17:00:00.000Z",
          endAt: "2026-09-17T18:00:00.000Z",
          durationMinutes: 60,
          activeEnergyKcal: 400,
          externalId: "garmin-99",
        },
        exercises: [exercise],
        ordinaryTonnageKg: 240,
        createdAt: "2026-09-17T17:00:00.000Z",
        updatedAt: "2026-09-17T18:30:00.000Z",
      };
    }

    const pushSession = sessionFor(71, {
      id: 1,
      sourceExerciseCatalogId: 10,
      stableKey: "incline_dumbbell_press_30deg",
      snapshotExerciseName: "Incline DB press",
      order: 1,
      plannedSets: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: "PLANNED",
      muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("incline_dumbbell_press_30deg"),
      sets: [{
        id: 11,
        sessionExerciseId: 1,
        setNumber: 1,
        reps: 8,
        weightKg: 30,
        bandNominalResistanceKg: null,
        rir: null,
        comment: null,
        completedAt: null,
        createdAt: "2026-09-17T17:00:00.000Z",
        updatedAt: "2026-09-17T17:00:00.000Z",
      }],
    });
    const pullSession = sessionFor(72, {
      id: 2,
      sourceExerciseCatalogId: 11,
      stableKey: "one_arm_seated_cable_row",
      snapshotExerciseName: "One-arm cable row",
      order: 1,
      plannedSets: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: "PLANNED",
      muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("one_arm_seated_cable_row"),
      sets: [{
        id: 21,
        sessionExerciseId: 2,
        setNumber: 1,
        reps: 8,
        weightKg: 30,
        bandNominalResistanceKg: null,
        rir: null,
        comment: null,
        completedAt: null,
        createdAt: "2026-09-17T17:00:00.000Z",
        updatedAt: "2026-09-17T17:00:00.000Z",
      }],
    });

    const pushInput = buildCanonicalStrengthTrainingInputV7({
      session: pushSession,
      heartRateSamples: [...sharedHrSamples],
    });
    const pullInput = buildCanonicalStrengthTrainingInputV7({
      session: pullSession,
      heartRateSamples: [...sharedHrSamples],
    });

    expect(pushInput.heartRate).toEqual(pullInput.heartRate);

    const pushDose = buildQualifiedResistanceTrainingDoseV7(pushInput, { ordinaryTonnageKg: 240 });
    const pullDose = buildQualifiedResistanceTrainingDoseV7(pullInput, { ordinaryTonnageKg: 240 });

    expect(pushDose.availability).toBe("available");
    expect(pullDose.availability).toBe("available");
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(pushDose))
      .not.toBe(qualifiedResistanceTrainingDoseV7Fingerprint(pullDose));
    if (pushDose.availability === "available" && pullDose.availability === "available") {
      expect(pushDose.heartRateContext).toEqual(pullDose.heartRateContext);
      expect(pushDose.mappedSetCount).toBe(pullDose.mappedSetCount);
      expect(pushDose.muscleGroups).not.toEqual(pullDose.muscleGroups);
      expect(pushDose.muscleGroups.find((g) => g.muscleGroup === "chest")?.directMappedSetCount)
        .toBeGreaterThan(0);
      expect(pullDose.muscleGroups.find((g) => g.muscleGroup === "back")?.directMappedSetCount)
        .toBeGreaterThan(0);
      expect(pushDose.muscleGroups.find((g) => g.muscleGroup === "back")?.directMappedSetCount ?? 0)
        .toBe(0);
      expect(pullDose.muscleGroups.find((g) => g.muscleGroup === "chest")?.directMappedSetCount ?? 0)
        .toBe(0);
    }
  });

  it("volume-equated frequency has no required independent positive effect", () => {
    const snapshot = buildExerciseMuscleMappingSnapshotV7("incline_dumbbell_press_30deg");

    function doseWithSets(sessionId: number, setCount: number) {
      const sets = Array.from({ length: setCount }, (_, index) => ({
        id: sessionId * 10 + index,
        sessionExerciseId: 1,
        setNumber: index + 1,
        reps: 8,
        weightKg: 20,
        bandNominalResistanceKg: null,
        rir: null,
        comment: null,
        completedAt: null,
        createdAt: "2026-09-14T17:00:00.000Z",
        updatedAt: "2026-09-14T17:00:00.000Z",
      }));
      const session: StrengthSessionDto = {
        id: sessionId,
        status: "COMPLETED",
        entryMode: "RETROSPECTIVE",
        revision: 1,
        programId: 7,
        programName: "Press",
        programVersionId: 9,
        programVersionNumber: 1,
        webStartedAt: null,
        webEndedAt: null,
        matchStatus: "MATCHED",
        matchMethod: "DIRECT_BACKFILL",
        matchedAt: "2026-09-14T18:30:00.000Z",
        matchedWorkoutId: 99,
        matchedWorkout: {
          id: 99,
          type: "Strength Training",
          startAt: "2026-09-14T17:00:00.000Z",
          endAt: "2026-09-14T18:00:00.000Z",
          durationMinutes: 60,
          activeEnergyKcal: 400,
          externalId: "garmin-99",
        },
        exercises: [{
          id: 1,
          sourceExerciseCatalogId: 10,
          stableKey: "incline_dumbbell_press_30deg",
          snapshotExerciseName: "Incline DB press",
          order: 1,
          plannedSets: setCount,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
          origin: "PLANNED",
          muscleMappingSnapshot: snapshot,
          sets,
        }],
        ordinaryTonnageKg: null,
        createdAt: "2026-09-14T17:00:00.000Z",
        updatedAt: "2026-09-14T18:30:00.000Z",
      };
      return buildQualifiedResistanceTrainingDoseV7(
        buildCanonicalStrengthTrainingInputV7({ session, heartRateSamples: null }),
      );
    }

    const lowFrequency = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-20",
      days: [{
        date: "2026-09-14",
        workoutFeedObserved: true,
        sessions: [{
          strengthDiarySessionId: 1,
          sessionRevision: 1,
          dose: doseWithSets(1, 4),
        }],
      }],
    });
    const highFrequency = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-20",
      days: [
        {
          date: "2026-09-14",
          workoutFeedObserved: true,
          sessions: [{
            strengthDiarySessionId: 2,
            sessionRevision: 1,
            dose: doseWithSets(2, 2),
          }],
        },
        {
          date: "2026-09-17",
          workoutFeedObserved: true,
          sessions: [{
            strengthDiarySessionId: 3,
            sessionRevision: 1,
            dose: doseWithSets(3, 2),
          }],
        },
      ],
    });

    const lowWeek = lowFrequency.weeklyAggregates[0]!;
    const highWeek = highFrequency.weeklyAggregates[0]!;
    expect(lowWeek.totalMappedSetCount).toBe(4);
    expect(highWeek.totalMappedSetCount).toBe(4);
    expect(lowWeek.muscleGroups).toEqual(highWeek.muscleGroups);
    expect(lowWeek.sessionCount).toBe(1);
    expect(highWeek.sessionCount).toBe(2);
    expect(lowWeek.distinctExposureDayCount).toBe(1);
    expect(highWeek.distinctExposureDayCount).toBe(2);
    expect(lowWeek).not.toHaveProperty("frequencyMultiplier");
    expect(highWeek).not.toHaveProperty("frequencyMultiplier");
    expect(lowWeek).not.toHaveProperty("anabolicFrequencyBonus");
  });

  it("validated nonzero loading is not complete cessation", () => {
    const snapshot = buildExerciseMuscleMappingSnapshotV7("flat_dumbbell_fly");
    const session: StrengthSessionDto = {
      id: 80,
      status: "COMPLETED",
      entryMode: "RETROSPECTIVE",
      revision: 1,
      programId: 7,
      programName: "Chest",
      programVersionId: 9,
      programVersionNumber: 1,
      webStartedAt: null,
      webEndedAt: null,
      matchStatus: "MATCHED",
      matchMethod: "DIRECT_BACKFILL",
      matchedAt: "2026-09-14T18:30:00.000Z",
      matchedWorkoutId: 99,
      matchedWorkout: {
        id: 99,
        type: "Strength Training",
        startAt: "2026-09-14T17:00:00.000Z",
        endAt: "2026-09-14T18:00:00.000Z",
        durationMinutes: 60,
        activeEnergyKcal: 400,
        externalId: "garmin-99",
      },
      exercises: [{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: "flat_dumbbell_fly",
        snapshotExerciseName: "Fly",
        order: 1,
        plannedSets: 2,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: snapshot,
        sets: [{
          id: 11,
          sessionExerciseId: 1,
          setNumber: 1,
          reps: 10,
          weightKg: 12,
          bandNominalResistanceKg: null,
          rir: null,
          comment: null,
          completedAt: null,
          createdAt: "2026-09-14T17:00:00.000Z",
          updatedAt: "2026-09-14T17:00:00.000Z",
        }],
      }],
      ordinaryTonnageKg: null,
      createdAt: "2026-09-14T17:00:00.000Z",
      updatedAt: "2026-09-14T18:30:00.000Z",
    };
    const dose = buildQualifiedResistanceTrainingDoseV7(
      buildCanonicalStrengthTrainingInputV7({ session, heartRateSamples: null }),
    );
    expect(dose.availability).toBe("available");
    if (dose.availability === "available") {
      expect(dose.mappedSetCount).toBeGreaterThan(0);
    }

    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      days: [{
        date: "2026-09-14",
        workoutFeedObserved: true,
        sessions: [{
          strengthDiarySessionId: 80,
          sessionRevision: 1,
          dose,
        }],
      }],
    });

    expect(history.days[0]!.kind).toBe("observed-mapped-exposure");
    expect(history.days[0]!.completeCessation).toBe(false);
    expect(history.days[0]!.mappedSetCount).toBeGreaterThan(0);
  });

  it("resumption restores stimulus without invented memory gain", () => {
    const snapshot = buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press");
    function dose(sessionId: number) {
      const session: StrengthSessionDto = {
        id: sessionId,
        status: "COMPLETED",
        entryMode: "RETROSPECTIVE",
        revision: 1,
        programId: 7,
        programName: "Shoulders",
        programVersionId: 9,
        programVersionNumber: 1,
        webStartedAt: null,
        webEndedAt: null,
        matchStatus: "MATCHED",
        matchMethod: "DIRECT_BACKFILL",
        matchedAt: "2026-09-14T18:30:00.000Z",
        matchedWorkoutId: 99,
        matchedWorkout: {
          id: 99,
          type: "Strength Training",
          startAt: "2026-09-14T17:00:00.000Z",
          endAt: "2026-09-14T18:00:00.000Z",
          durationMinutes: 60,
          activeEnergyKcal: 400,
          externalId: "garmin-99",
        },
        exercises: [{
          id: 1,
          sourceExerciseCatalogId: 10,
          stableKey: "seated_dumbbell_press",
          snapshotExerciseName: "Press",
          order: 1,
          plannedSets: 3,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
          origin: "PLANNED",
          muscleMappingSnapshot: snapshot,
          sets: [{
            id: sessionId * 10,
            sessionExerciseId: 1,
            setNumber: 1,
            reps: 8,
            weightKg: 22,
            bandNominalResistanceKg: null,
            rir: null,
            comment: null,
            completedAt: null,
            createdAt: "2026-09-14T17:00:00.000Z",
            updatedAt: "2026-09-14T17:00:00.000Z",
          }],
        }],
        ordinaryTonnageKg: null,
        createdAt: "2026-09-14T17:00:00.000Z",
        updatedAt: "2026-09-14T18:30:00.000Z",
      };
      return buildQualifiedResistanceTrainingDoseV7(
        buildCanonicalStrengthTrainingInputV7({ session, heartRateSamples: null }),
      );
    }

    const first = dose(91);
    const resumed = dose(92);
    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-18",
      days: [
        {
          date: "2026-09-14",
          workoutFeedObserved: true,
          sessions: [{ strengthDiarySessionId: 91, sessionRevision: 1, dose: first }],
        },
        { date: "2026-09-15", workoutFeedObserved: true, sessions: [] },
        { date: "2026-09-16", workoutFeedObserved: true, sessions: [] },
        {
          date: "2026-09-17",
          workoutFeedObserved: true,
          sessions: [{ strengthDiarySessionId: 92, sessionRevision: 1, dose: resumed }],
        },
      ],
    });

    expect(history.resumptionEvents).toHaveLength(1);
    expect(history.resumptionEvents[0]).toMatchObject({
      resumedOnDate: "2026-09-17",
      verifiedNoExposureDates: ["2026-09-15", "2026-09-16"],
      resumedMappedSetCount: 1,
      quantitativeMemoryBonus: null,
    });
    const resumedDay = history.days.find((day) => day.date === "2026-09-17")!;
    expect(resumedDay.kind).toBe("observed-mapped-exposure");
    expect(resumedDay.mappedSetCount).toBeGreaterThan(0);
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(resumed))
      .toBe(resumedDay.sessions[0]!.doseFingerprint);
    expect(history.resumptionEvents[0]).not.toHaveProperty("muscleMemoryMultiplier");
    expect(history).not.toHaveProperty("retrainingAcceleration");
  });

  it("momentary failure is not mandatory", () => {
    const snapshot = buildExerciseMuscleMappingSnapshotV7("incline_dumbbell_press_30deg");

    function sessionWithRir(rir: number | null, setId: number): StrengthSessionDto {
      return {
        id: 100 + setId,
        status: "COMPLETED",
        entryMode: "RETROSPECTIVE",
        revision: 1,
        programId: 7,
        programName: "Press",
        programVersionId: 9,
        programVersionNumber: 1,
        webStartedAt: null,
        webEndedAt: null,
        matchStatus: "MATCHED",
        matchMethod: "DIRECT_BACKFILL",
        matchedAt: "2026-09-14T18:30:00.000Z",
        matchedWorkoutId: 99,
        matchedWorkout: {
          id: 99,
          type: "Strength Training",
          startAt: "2026-09-14T17:00:00.000Z",
          endAt: "2026-09-14T18:00:00.000Z",
          durationMinutes: 60,
          activeEnergyKcal: 400,
          externalId: "garmin-99",
        },
        exercises: [{
          id: 1,
          sourceExerciseCatalogId: 10,
          stableKey: "incline_dumbbell_press_30deg",
          snapshotExerciseName: "Incline DB press",
          order: 1,
          plannedSets: 3,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
          origin: "PLANNED",
          muscleMappingSnapshot: snapshot,
          sets: [{
            id: setId,
            sessionExerciseId: 1,
            setNumber: 1,
            reps: 8,
            weightKg: 20,
            bandNominalResistanceKg: null,
            rir,
            comment: null,
            completedAt: null,
            createdAt: "2026-09-14T17:00:00.000Z",
            updatedAt: "2026-09-14T17:00:00.000Z",
          }],
        }],
        ordinaryTonnageKg: null,
        createdAt: "2026-09-14T17:00:00.000Z",
        updatedAt: "2026-09-14T18:30:00.000Z",
      };
    }

    const failureDose = buildQualifiedResistanceTrainingDoseV7(
      buildCanonicalStrengthTrainingInputV7({
        session: sessionWithRir(0, 1),
        heartRateSamples: null,
      }),
    );
    const nearFailureDose = buildQualifiedResistanceTrainingDoseV7(
      buildCanonicalStrengthTrainingInputV7({
        session: sessionWithRir(1, 2),
        heartRateSamples: null,
      }),
    );

    expect(failureDose.availability).toBe("available");
    expect(nearFailureDose.availability).toBe("available");
    if (failureDose.availability === "available" && nearFailureDose.availability === "available") {
      // Narrow C-A04 oracle: failure (RIR 0) and near-failure (RIR 1) both
      // qualify equally — not a claim that every RIR value qualifies.
      expect(failureDose.qualifiedHardSetCount).toBe(1);
      expect(nearFailureDose.qualifiedHardSetCount).toBe(1);
      expect(failureDose.mappedSetCount).toBe(1);
      expect(nearFailureDose.mappedSetCount).toBe(1);
      expect(failureDose.muscleGroups).toEqual(nearFailureDose.muscleGroups);
      expect(failureDose.setEffortEvidence[0]!.evidence).toEqual({
        status: "qualified-by-user-reported-rir",
        provenance: "user-reported-rir",
        rir: 0,
        reportedProximity: "momentary-failure",
      });
      expect(nearFailureDose.setEffortEvidence[0]!.evidence).toEqual({
        status: "qualified-by-user-reported-rir",
        provenance: "user-reported-rir",
        rir: 1,
        reportedProximity: "reps-in-reserve",
      });
      expect(failureDose).not.toHaveProperty("failureBonus");
      expect(nearFailureDose).not.toHaveProperty("failureMultiplier");
      expect(qualifiedResistanceTrainingDoseV7Fingerprint(failureDose))
        .not.toBe(qualifiedResistanceTrainingDoseV7Fingerprint(nearFailureDose));
    }
  });
});
