import { describe, expect, it } from "vitest";
import {
  buildPhysiologyDayV7,
  createUnavailablePhysiologyRuntimeStateV7,
  runtimeStateFromStructuralStateV7,
} from "@/model/physiology-v7/daily-runtime-v7";
import {
  applyLeanMassObservationToPhysiologyV7State,
  classifyLeanMassEndpointRoleV7,
  initializePhysiologyV7StateRejectingLeanAsSkeletalMuscleV7,
  LEAN_MASS_NOT_SKELETAL_MUSCLE_POLICY_V7,
  MEASUREMENT_ROLE_CONTRACT_V7_VERSION,
  rejectLeanMassAsSkeletalMuscleValidatorV7,
  rejectResidualLeanAsSkeletalMuscleV7,
} from "@/model/physiology-v7/measurement-role-v7";
import { rebuildPhysiologyRangeV7 } from "@/model/physiology-v7/rebuild-v7";
import { buildResistanceTrainingExposureHistoryFromSourcesV7 } from "@/model/physiology-v7/resistance-training-exposure-history-sources-v7";
import type { PhysiologyV7State } from "@/model/physiology-v7/state";
import { observedNutritionProvenance } from "@/modules/model-episodes/nutrition-gap-bridge";

const nutrition = {
  caloriesKcal: 2_300,
  proteinG: 150,
  fatG: 75,
  carbsG: 250,
  provenance: observedNutritionProvenance(),
};

const emptyState: PhysiologyV7State = {
  fatMassKg: null,
  skeletalMuscleKg: null,
  otherLeanTissueKg: null,
  glycogenKg: null,
  glycogenWaterKg: null,
  ecfDeviationKg: null,
  transientExerciseWaterKg: null,
  adaptiveThermogenesisKcalPerDay: null,
  weightFilterState: null,
};

function sources(date: string, leanMassObservation: {
  endpointKind: "dxa-lean-soft-tissue" | "bia-lean-mass" | "fat-free-mass" | "generic-lean-tissue" | "device-reported-skeletal-muscle-proxy";
  valueKg: number;
} | null = null) {
  return {
    date,
    observedWeightKg: 80,
    observedBodyFatPercent: 20,
    nutrition: structuredClone(nutrition),
    workoutFeedObserved: true,
    steps: 8_000,
    walkingRunningDistanceKm: 6,
    workouts: [],
    stepperWorkouts: [],
    context: {
      heartRateSampleCount: 0,
      restingHeartRateSampleCount: 0,
      sleepSegmentCount: 0,
    },
    leanMassObservation,
  };
}

describe("measurement-role v7 lean ≠ skeletal muscle", () => {
  it("classifies DXA/BIA/FFM/generic lean as aggregate lean context only", () => {
    for (const endpointKind of [
      "dxa-lean-soft-tissue",
      "bia-lean-mass",
      "fat-free-mass",
      "generic-lean-tissue",
      "device-reported-skeletal-muscle-proxy",
    ] as const) {
      expect(classifyLeanMassEndpointRoleV7(endpointKind)).toEqual({
        role: "aggregate-lean-context",
        mayInitializeSkeletalMuscleKg: false,
        mayOverwriteSkeletalMuscleKg: false,
        mayValidateSkeletalMuscleKg: false,
        skeletalMuscleInterpretation: "not-skeletal-muscle",
        endpointKind,
      });
    }
  });

  it("initialization from lean tissue keeps skeletalMuscleKg unavailable", () => {
    const initialized = initializePhysiologyV7StateRejectingLeanAsSkeletalMuscleV7({
      leanTissueKg: 55,
      endpointKind: "generic-lean-tissue",
    });
    expect(initialized.leanContext).toMatchObject({
      availability: "available",
      role: "aggregate-lean-context",
      valueKg: 55,
      skeletalMuscleInterpretation: "not-skeletal-muscle",
    });
    expect(initialized.state.skeletalMuscleKg).toBeNull();
    expect(initialized.skeletalMuscleFromLean).toEqual({
      applied: false,
      target: "skeletalMuscleKg",
      policy: LEAN_MASS_NOT_SKELETAL_MUSCLE_POLICY_V7,
      priorSkeletalMuscleKg: null,
      resultingSkeletalMuscleKg: null,
      rejectedOperations: ["initialize", "overwrite", "validate", "residual-allocate"],
    });
  });

  it("observation handling never overwrites an existing skeletalMuscleKg from lean", () => {
    const prior = { ...emptyState, skeletalMuscleKg: 31, fatMassKg: 18 };
    const applied = applyLeanMassObservationToPhysiologyV7State({
      state: prior,
      leanObservation: { endpointKind: "dxa-lean-soft-tissue", valueKg: 58 },
    });
    expect(applied.state.skeletalMuscleKg).toBe(31);
    expect(applied.leanContext.valueKg).toBe(58);
    expect(applied.skeletalMuscleFromLean.applied).toBe(false);
    expect(applied.skeletalMuscleFromLean.resultingSkeletalMuscleKg).toBe(31);
  });

  it("rejects lean validation and residual allocation into skeletalMuscleKg", () => {
    expect(rejectLeanMassAsSkeletalMuscleValidatorV7({
      skeletalMuscleKg: 30,
      leanMassKg: 55,
    })).toMatchObject({
      accepted: false,
      reason: "lean-mass-is-not-skeletal-muscle-validator",
      policy: LEAN_MASS_NOT_SKELETAL_MUSCLE_POLICY_V7,
    });
    expect(rejectResidualLeanAsSkeletalMuscleV7({
      state: emptyState,
      residualLeanKg: 50,
    })).toMatchObject({
      applied: false,
      resultingSkeletalMuscleKg: null,
      rejectedOperations: expect.arrayContaining(["residual-allocate"]),
    });
  });

  it("daily runtime observation path retains lean context without writing skeletalMuscleKg", () => {
    const date = "2026-09-18";
    const result = buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: sources(date, { endpointKind: "bia-lean-mass", valueKg: 52 }),
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(result.leanMassMeasurement.contractVersion).toBe(MEASUREMENT_ROLE_CONTRACT_V7_VERSION);
    expect(result.leanMassMeasurement.leanContext).toMatchObject({
      availability: "available",
      role: "aggregate-lean-context",
      endpointKind: "bia-lean-mass",
      valueKg: 52,
    });
    expect(result.leanMassMeasurement.skeletalMuscleFromLean.applied).toBe(false);
    expect(result.resultingState.compartments.skeletalMuscleKg).toMatchObject({
      availability: "unavailable",
      valueKg: null,
    });
    expect(result.provenance.leanMassIsNotSkeletalMuscle).toBe(true);
    expect(result).not.toHaveProperty("leanToSkeletalMuscleKg");
  });

  it("rebuild keeps skeletalMuscleKg independent of lean observations across days", () => {
    const fromDate = "2026-09-18";
    const toDate = "2026-09-19";
    const prior = runtimeStateFromStructuralStateV7({
      ...emptyState,
      skeletalMuscleKg: 29,
    });
    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate,
      toDate,
      initialState: prior,
      sources: {
        days: [
          sources(fromDate, { endpointKind: "fat-free-mass", valueKg: 60 }),
          sources(toDate, { endpointKind: "device-reported-skeletal-muscle-proxy", valueKg: 61 }),
        ],
        exposure: {
          historyFromDate: fromDate,
          days: [
            { date: fromDate, workoutFeedObserved: true },
            { date: toDate, workoutFeedObserved: true },
          ],
          strengthWorkouts: [],
          sessions: [],
        },
      },
    });
    expect(rebuilt.days).toHaveLength(2);
    for (const day of rebuilt.days) {
      expect(day.leanMassMeasurement.skeletalMuscleFromLean.applied).toBe(false);
      expect(day.resultingState.compartments.skeletalMuscleKg).toMatchObject({
        availability: "available",
        valueKg: 29,
        biologicalTransition: "not-modeled",
      });
    }
    expect(rebuilt.finalState.compartments.skeletalMuscleKg.valueKg).toBe(29);
  });
});
