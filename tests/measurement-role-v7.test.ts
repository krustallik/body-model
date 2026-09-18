import { describe, expect, it } from "vitest";
import {
  buildPhysiologyDayV7,
  createUnavailablePhysiologyRuntimeStateV7,
  runtimeStateFromStructuralStateV7,
} from "@/model/physiology-v7/daily-runtime-v7";
import {
  applyLeanMassObservationToPhysiologyV7State,
  applyLocalMuscleObservationToPhysiologyV7State,
  applyAcuteMpsObservationToPhysiologyV7State,
  applyStrengthPerformanceObservationToPhysiologyV7State,
  classifyLeanMassEndpointRoleV7,
  classifyLocalMuscleEndpointRoleV7,
  classifyAcuteMpsEndpointRoleV7,
  classifyStrengthPerformanceEndpointRoleV7,
  initializePhysiologyV7StateRejectingLeanAsSkeletalMuscleV7,
  initializePhysiologyV7StateRejectingLocalAsWholeBodyV7,
  initializePhysiologyV7StateRejectingMpsAsSkeletalMuscleV7,
  initializePhysiologyV7StateRejectingStrengthAsSkeletalMuscleV7,
  LEAN_MASS_NOT_SKELETAL_MUSCLE_POLICY_V7,
  LOCAL_HYPERTROPHY_NOT_WHOLE_BODY_POLICY_V7,
  ACUTE_MPS_NOT_SKELETAL_MUSCLE_POLICY_V7,
  STRENGTH_PERFORMANCE_NOT_SKELETAL_MUSCLE_POLICY_V7,
  MEASUREMENT_ROLE_CONTRACT_V7_VERSION,
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
  type AcuteMpsObservationV7,
  type LocalMuscleObservationV7,
  type StrengthPerformanceObservationV7,
} from "@/model/physiology-v7/measurement-role-v7";
import { rebuildPhysiologyRangeV7 } from "@/model/physiology-v7/rebuild-v7";
import {
  buildResistanceTrainingAdaptationResponseV7,
} from "@/model/physiology-v7/resistance-training-adaptation-response-v7";
import { applyTrainingAdaptationTransitionV7 } from "@/model/physiology-v7/training-adaptation-transition-v7";
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

function sources(date: string, options: {
  leanMassObservation?: {
    endpointKind: "dxa-lean-soft-tissue" | "bia-lean-mass" | "fat-free-mass" | "generic-lean-tissue" | "device-reported-skeletal-muscle-proxy";
    valueKg: number;
  } | null;
  localMuscleObservation?: LocalMuscleObservationV7 | null;
  acuteMpsObservation?: AcuteMpsObservationV7 | null;
  strengthPerformanceObservation?: StrengthPerformanceObservationV7 | null;
} = {}) {
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
    leanMassObservation: options.leanMassObservation ?? null,
    localMuscleObservation: options.localMuscleObservation ?? null,
    acuteMpsObservation: options.acuteMpsObservation ?? null,
    strengthPerformanceObservation: options.strengthPerformanceObservation ?? null,
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
      sources: sources(date, { leanMassObservation: { endpointKind: "bia-lean-mass", valueKg: 52 } }),
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
          sources(fromDate, { leanMassObservation: { endpointKind: "fat-free-mass", valueKg: 60 } }),
          sources(toDate, { leanMassObservation: { endpointKind: "device-reported-skeletal-muscle-proxy", valueKg: 61 } }),
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

describe("measurement-role v7 local ≠ whole-body skeletal muscle", () => {
  const localObservation: LocalMuscleObservationV7 = {
    endpointKind: "local-muscle-percent-change",
    site: "vastus-lateralis",
    value: 5.2,
    unit: "percent-change",
  };

  it("classifies ultrasound/CSA/thickness/fiber endpoints as local hypertrophy context only", () => {
    for (const endpointKind of [
      "ultrasound-muscle-thickness",
      "mri-muscle-csa",
      "mri-muscle-volume",
      "biopsy-fiber-csa",
      "local-muscle-percent-change",
    ] as const) {
      expect(classifyLocalMuscleEndpointRoleV7(endpointKind)).toEqual({
        role: "local-hypertrophy-proxy",
        mayInitializeSkeletalMuscleKg: false,
        mayOverwriteSkeletalMuscleKg: false,
        mayValidateSkeletalMuscleKg: false,
        mayCalibrateSkeletalMuscleKg: false,
        wholeBodyInterpretation: "not-whole-body-skeletal-muscle",
        endpointKind,
      });
    }
  });

  it("initialization from local percent change keeps skeletalMuscleKg unavailable", () => {
    const initialized = initializePhysiologyV7StateRejectingLocalAsWholeBodyV7({
      localObservation,
    });
    expect(initialized.localContext).toMatchObject({
      availability: "available",
      role: "local-hypertrophy-proxy",
      site: "vastus-lateralis",
      value: 5.2,
      wholeBodyInterpretation: "not-whole-body-skeletal-muscle",
    });
    expect(initialized.state.skeletalMuscleKg).toBeNull();
    expect(initialized.skeletalMuscleFromLocal).toEqual({
      applied: false,
      target: "skeletalMuscleKg",
      policy: LOCAL_HYPERTROPHY_NOT_WHOLE_BODY_POLICY_V7,
      priorSkeletalMuscleKg: null,
      resultingSkeletalMuscleKg: null,
      rejectedOperations: ["initialize", "overwrite", "validate", "calibrate", "residual-allocate"],
    });
    expect(initialized).not.toHaveProperty("localToWholeBodyKg");
  });

  it("observation handling never overwrites skeletalMuscleKg from local CSA/thickness", () => {
    const prior = { ...emptyState, skeletalMuscleKg: 31, fatMassKg: 18 };
    const applied = applyLocalMuscleObservationToPhysiologyV7State({
      state: prior,
      localObservation: {
        endpointKind: "mri-muscle-csa",
        site: "vastus-lateralis",
        value: 78,
        unit: "cm2-csa",
      },
    });
    expect(applied.state.skeletalMuscleKg).toBe(31);
    expect(applied.localContext.value).toBe(78);
    expect(applied.skeletalMuscleFromLocal.applied).toBe(false);
    expect(applied.skeletalMuscleFromLocal.resultingSkeletalMuscleKg).toBe(31);
  });

  it("rejects local validation, calibration, and residual allocation into skeletalMuscleKg", () => {
    expect(rejectLocalMuscleAsSkeletalMuscleValidatorV7({
      skeletalMuscleKg: 30,
      localObservation,
    })).toMatchObject({
      accepted: false,
      reason: "local-hypertrophy-is-not-whole-body-skeletal-muscle-validator",
      policy: LOCAL_HYPERTROPHY_NOT_WHOLE_BODY_POLICY_V7,
    });
    expect(rejectLocalMuscleAsSkeletalMuscleCalibratorV7({
      skeletalMuscleKg: 30,
      localObservation,
    })).toMatchObject({
      accepted: false,
      reason: "local-hypertrophy-is-not-whole-body-skeletal-muscle-calibrator",
    });
    expect(rejectResidualLocalAsSkeletalMuscleV7({
      state: emptyState,
      residualLocalValue: 5.2,
    })).toMatchObject({
      applied: false,
      resultingSkeletalMuscleKg: null,
      rejectedOperations: expect.arrayContaining(["residual-allocate"]),
    });
  });

  it("daily runtime retains local context without writing whole-body skeletalMuscleKg", () => {
    const date = "2026-09-18";
    const result = buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: sources(date, { localMuscleObservation: localObservation }),
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(result.localMuscleMeasurement.contractVersion).toBe(MEASUREMENT_ROLE_CONTRACT_V7_VERSION);
    expect(result.localMuscleMeasurement.localContext).toMatchObject({
      availability: "available",
      role: "local-hypertrophy-proxy",
      endpointKind: "local-muscle-percent-change",
      value: 5.2,
    });
    expect(result.localMuscleMeasurement.skeletalMuscleFromLocal.applied).toBe(false);
    expect(result.resultingState.compartments.skeletalMuscleKg).toMatchObject({
      availability: "unavailable",
      valueKg: null,
    });
    expect(result.provenance.localHypertrophyIsNotWholeBodySkeletalMuscle).toBe(true);
  });

  it("rebuild keeps skeletalMuscleKg independent of local muscle observations across days", () => {
    const fromDate = "2026-09-18";
    const toDate = "2026-09-19";
    const prior = runtimeStateFromStructuralStateV7({
      ...emptyState,
      skeletalMuscleKg: 28,
    });
    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate,
      toDate,
      initialState: prior,
      sources: {
        days: [
          sources(fromDate, {
            localMuscleObservation: {
              endpointKind: "ultrasound-muscle-thickness",
              site: "biceps-brachii",
              value: 7.5,
              unit: "percent-change",
            },
          }),
          sources(toDate, {
            localMuscleObservation: {
              endpointKind: "mri-muscle-volume",
              site: "quadriceps",
              value: 1200,
              unit: "cm3-volume",
            },
          }),
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
      expect(day.localMuscleMeasurement.skeletalMuscleFromLocal.applied).toBe(false);
      expect(day.resultingState.compartments.skeletalMuscleKg).toMatchObject({
        availability: "available",
        valueKg: 28,
        biologicalTransition: "not-modeled",
      });
    }
    expect(rebuilt.finalState.compartments.skeletalMuscleKg.valueKg).toBe(28);
  });
});

describe("measurement-role v7 acute MPS ≠ skeletal muscle kg", () => {
  const mpsObservation: AcuteMpsObservationV7 = {
    endpointKind: "isotope-tracer-fsr",
    value: 0.08,
    unit: "percent-per-hour",
    tissueSite: "vastus-lateralis",
  };

  it("classifies tracer/FSR/MPS endpoints as mechanistic context only", () => {
    for (const endpointKind of [
      "isotope-tracer-fsr",
      "acute-mps-percent-response",
      "biopsy-fractional-synthesis",
      "reported-acute-synthesis-signal",
    ] as const) {
      expect(classifyAcuteMpsEndpointRoleV7(endpointKind)).toEqual({
        role: "acute-mps-mechanistic-context",
        mayInitializeSkeletalMuscleKg: false,
        mayOverwriteSkeletalMuscleKg: false,
        mayValidateSkeletalMuscleKg: false,
        mayCalibrateSkeletalMuscleKg: false,
        mayNumericallyTransitionSkeletalMuscleKg: false,
        skeletalMuscleInterpretation: "not-accumulated-skeletal-muscle-kg",
        endpointKind,
      });
    }
  });

  it("initialization from acute MPS keeps skeletalMuscleKg unavailable", () => {
    const initialized = initializePhysiologyV7StateRejectingMpsAsSkeletalMuscleV7({
      mpsObservation,
    });
    expect(initialized.mpsContext).toMatchObject({
      availability: "available",
      role: "acute-mps-mechanistic-context",
      value: 0.08,
      skeletalMuscleInterpretation: "not-accumulated-skeletal-muscle-kg",
    });
    expect(initialized.state.skeletalMuscleKg).toBeNull();
    expect(initialized.skeletalMuscleFromMps).toEqual({
      applied: false,
      target: "skeletalMuscleKg",
      policy: ACUTE_MPS_NOT_SKELETAL_MUSCLE_POLICY_V7,
      priorSkeletalMuscleKg: null,
      resultingSkeletalMuscleKg: null,
      rejectedOperations: [
        "initialize",
        "overwrite",
        "validate",
        "calibrate",
        "numeric-transition",
        "residual-allocate",
      ],
    });
    expect(initialized).not.toHaveProperty("mpsToSkeletalMuscleKg");
    expect(initialized).not.toHaveProperty("mpsKgConversion");
  });

  it("observation handling never overwrites skeletalMuscleKg from FSR/MPS", () => {
    const prior = { ...emptyState, skeletalMuscleKg: 31, fatMassKg: 18 };
    const applied = applyAcuteMpsObservationToPhysiologyV7State({
      state: prior,
      mpsObservation: {
        endpointKind: "acute-mps-percent-response",
        value: 120,
        unit: "percent-change",
        tissueSite: "vastus-lateralis",
      },
    });
    expect(applied.state.skeletalMuscleKg).toBe(31);
    expect(applied.mpsContext.value).toBe(120);
    expect(applied.skeletalMuscleFromMps.applied).toBe(false);
    expect(applied.skeletalMuscleFromMps.resultingSkeletalMuscleKg).toBe(31);
  });

  it("rejects MPS validation, calibration, numeric transition, and residual allocation", () => {
    expect(rejectAcuteMpsAsSkeletalMuscleValidatorV7({
      skeletalMuscleKg: 30,
      mpsObservation,
    })).toMatchObject({
      accepted: false,
      reason: "acute-mps-is-not-accumulated-skeletal-muscle-validator",
      policy: ACUTE_MPS_NOT_SKELETAL_MUSCLE_POLICY_V7,
    });
    expect(rejectAcuteMpsAsSkeletalMuscleCalibratorV7({
      skeletalMuscleKg: 30,
      mpsObservation,
    })).toMatchObject({
      accepted: false,
      reason: "acute-mps-is-not-accumulated-skeletal-muscle-calibrator",
    });
    expect(rejectAcuteMpsAsSkeletalMuscleNumericTransitionV7({
      skeletalMuscleKg: 30,
      mpsObservation,
    })).toMatchObject({
      applied: false,
      reason: "acute-mps-is-not-skeletal-muscle-numeric-transition",
      priorSkeletalMuscleKg: 30,
      resultingSkeletalMuscleKg: 30,
    });
    expect(rejectResidualMpsAsSkeletalMuscleV7({
      state: emptyState,
      residualMpsValue: 0.08,
    })).toMatchObject({
      applied: false,
      resultingSkeletalMuscleKg: null,
      rejectedOperations: expect.arrayContaining(["residual-allocate"]),
    });
  });

  it("adaptation path retains MPS as mechanistic context without changing skeletalMuscleKg", () => {
    const date = "2026-09-18";
    const exposureHistory = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: date,
      toDate: date,
      days: [{ date, workoutFeedObserved: true }],
      strengthWorkouts: [],
      sessions: [],
    });
    const response = buildResistanceTrainingAdaptationResponseV7({
      date,
      exposureHistory,
      mpsObservation,
    });
    expect(response.acuteMpsContext).toMatchObject({
      availability: "available",
      role: "acute-mps-mechanistic-context",
      value: 0.08,
      mayNumericallyTransitionSkeletalMuscleKg: false,
    });
    expect(response.calibration.rejectedConversions).toContain(
      "acute-mps-to-chronic-skeletal-muscle-kg",
    );
    expect(response.muscleMassTransition.availability).toBe("unavailable");
    expect(JSON.stringify(response)).not.toMatch(/mpsToKg|mpsKgDelta|skeletalMuscleDeltaKg/);

    const applied = applyTrainingAdaptationTransitionV7({
      state: { ...emptyState, skeletalMuscleKg: 29 },
      response,
    });
    expect(applied.state.skeletalMuscleKg).toBe(29);
    expect(applied.transition.skeletalMuscleTransition.carriedForwardSkeletalMuscleKg).toBe(29);
    expect(applied.transition.skeletalMuscleTransition.biologicalTransition).toBe("not-modeled");
  });

  it("daily runtime retains MPS context without writing skeletalMuscleKg", () => {
    const date = "2026-09-18";
    const result = buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: sources(date, { acuteMpsObservation: mpsObservation }),
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(result.acuteMpsMeasurement.contractVersion).toBe(MEASUREMENT_ROLE_CONTRACT_V7_VERSION);
    expect(result.acuteMpsMeasurement.mpsContext).toMatchObject({
      availability: "available",
      role: "acute-mps-mechanistic-context",
      endpointKind: "isotope-tracer-fsr",
      value: 0.08,
    });
    expect(result.acuteMpsMeasurement.skeletalMuscleFromMps.applied).toBe(false);
    expect(result.trainingAdaptation.response.acuteMpsContext).toMatchObject({
      availability: "available",
      role: "acute-mps-mechanistic-context",
    });
    expect(result.resultingState.compartments.skeletalMuscleKg).toMatchObject({
      availability: "unavailable",
      valueKg: null,
    });
    expect(result.provenance.acuteMpsIsNotAccumulatedSkeletalMuscle).toBe(true);
  });

  it("rebuild keeps skeletalMuscleKg independent of acute MPS observations across days", () => {
    const fromDate = "2026-09-18";
    const toDate = "2026-09-19";
    const prior = runtimeStateFromStructuralStateV7({
      ...emptyState,
      skeletalMuscleKg: 28,
    });
    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate,
      toDate,
      initialState: prior,
      sources: {
        days: [
          sources(fromDate, {
            acuteMpsObservation: {
              endpointKind: "isotope-tracer-fsr",
              value: 0.09,
              unit: "fractional-synthesis-rate",
              tissueSite: "vastus-lateralis",
            },
          }),
          sources(toDate, {
            acuteMpsObservation: {
              endpointKind: "biopsy-fractional-synthesis",
              value: 0.11,
              unit: "percent-per-hour",
            },
          }),
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
      expect(day.acuteMpsMeasurement.skeletalMuscleFromMps.applied).toBe(false);
      expect(day.resultingState.compartments.skeletalMuscleKg).toMatchObject({
        availability: "available",
        valueKg: 28,
        biologicalTransition: "not-modeled",
      });
    }
    expect(rebuilt.finalState.compartments.skeletalMuscleKg.valueKg).toBe(28);
  });
});

describe("measurement-role v7 strength/performance ≠ skeletal muscle kg", () => {
  const strengthObservation: StrengthPerformanceObservationV7 = {
    endpointKind: "one-rep-max",
    value: 100,
    unit: "kg-load",
    movement: "back-squat",
  };

  it("classifies 1RM/load/reps/trend/performance as training context only", () => {
    for (const endpointKind of [
      "one-rep-max",
      "working-load",
      "repetition-count",
      "strength-trend",
      "performance-score",
    ] as const) {
      expect(classifyStrengthPerformanceEndpointRoleV7(endpointKind)).toEqual({
        role: "strength-performance-context",
        mayInitializeSkeletalMuscleKg: false,
        mayOverwriteSkeletalMuscleKg: false,
        mayValidateSkeletalMuscleKg: false,
        mayCalibrateSkeletalMuscleKg: false,
        mayNumericallyTransitionSkeletalMuscleKg: false,
        skeletalMuscleInterpretation: "not-skeletal-muscle-tissue",
        endpointKind,
      });
    }
  });

  it("initialization from strength decline keeps skeletalMuscleKg unavailable", () => {
    const initialized = initializePhysiologyV7StateRejectingStrengthAsSkeletalMuscleV7({
      strengthObservation: {
        endpointKind: "strength-trend",
        value: -12,
        unit: "percent-change",
        movement: "bench-press",
      },
    });
    expect(initialized.strengthContext).toMatchObject({
      availability: "available",
      role: "strength-performance-context",
      value: -12,
      skeletalMuscleInterpretation: "not-skeletal-muscle-tissue",
    });
    expect(initialized.state.skeletalMuscleKg).toBeNull();
    expect(initialized.skeletalMuscleFromStrength).toEqual({
      applied: false,
      target: "skeletalMuscleKg",
      policy: STRENGTH_PERFORMANCE_NOT_SKELETAL_MUSCLE_POLICY_V7,
      priorSkeletalMuscleKg: null,
      resultingSkeletalMuscleKg: null,
      rejectedOperations: [
        "initialize",
        "overwrite",
        "validate",
        "calibrate",
        "numeric-transition",
        "residual-allocate",
      ],
    });
    expect(initialized).not.toHaveProperty("strengthToSkeletalMuscleKg");
    expect(initialized).not.toHaveProperty("performanceKgConversion");
  });

  it("observation handling never overwrites skeletalMuscleKg from 1RM/load/reps", () => {
    const prior = { ...emptyState, skeletalMuscleKg: 31, fatMassKg: 18 };
    const applied = applyStrengthPerformanceObservationToPhysiologyV7State({
      state: prior,
      strengthObservation: {
        endpointKind: "working-load",
        value: 80,
        unit: "percent-1rm",
        movement: "deadlift",
      },
    });
    expect(applied.state.skeletalMuscleKg).toBe(31);
    expect(applied.strengthContext.value).toBe(80);
    expect(applied.skeletalMuscleFromStrength.applied).toBe(false);
    expect(applied.skeletalMuscleFromStrength.resultingSkeletalMuscleKg).toBe(31);
  });

  it("rejects strength validation, calibration, numeric transition, and residual allocation", () => {
    expect(rejectStrengthAsSkeletalMuscleValidatorV7({
      skeletalMuscleKg: 30,
      strengthObservation,
    })).toMatchObject({
      accepted: false,
      reason: "strength-performance-is-not-skeletal-muscle-validator",
      policy: STRENGTH_PERFORMANCE_NOT_SKELETAL_MUSCLE_POLICY_V7,
    });
    expect(rejectStrengthAsSkeletalMuscleCalibratorV7({
      skeletalMuscleKg: 30,
      strengthObservation,
    })).toMatchObject({
      accepted: false,
      reason: "strength-performance-is-not-skeletal-muscle-calibrator",
    });
    expect(rejectStrengthAsSkeletalMuscleNumericTransitionV7({
      skeletalMuscleKg: 30,
      strengthObservation: {
        endpointKind: "strength-trend",
        value: -8,
        unit: "percent-change",
      },
    })).toMatchObject({
      applied: false,
      reason: "strength-performance-is-not-skeletal-muscle-numeric-transition",
      priorSkeletalMuscleKg: 30,
      resultingSkeletalMuscleKg: 30,
    });
    expect(rejectResidualStrengthAsSkeletalMuscleV7({
      state: emptyState,
      residualStrengthValue: -10,
    })).toMatchObject({
      applied: false,
      resultingSkeletalMuscleKg: null,
      rejectedOperations: expect.arrayContaining(["residual-allocate"]),
    });
  });

  it("adaptation path retains strength as training context without changing skeletalMuscleKg", () => {
    const date = "2026-09-18";
    const exposureHistory = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: date,
      toDate: date,
      days: [{ date, workoutFeedObserved: true }],
      strengthWorkouts: [],
      sessions: [],
    });
    const response = buildResistanceTrainingAdaptationResponseV7({
      date,
      exposureHistory,
      strengthObservation: {
        endpointKind: "strength-trend",
        value: -15,
        unit: "percent-change",
        movement: "squat",
      },
    });
    expect(response.strengthPerformanceContext).toMatchObject({
      availability: "available",
      role: "strength-performance-context",
      value: -15,
      mayNumericallyTransitionSkeletalMuscleKg: false,
    });
    expect(response.calibration.rejectedConversions).toContain(
      "strength-performance-to-skeletal-muscle-kg",
    );
    expect(response.muscleMassTransition.availability).toBe("unavailable");
    expect(JSON.stringify(response)).not.toMatch(/strengthToKg|performanceKgDelta|skeletalMuscleDeltaKg/);

    const applied = applyTrainingAdaptationTransitionV7({
      state: { ...emptyState, skeletalMuscleKg: 29 },
      response,
    });
    expect(applied.state.skeletalMuscleKg).toBe(29);
    expect(applied.transition.skeletalMuscleTransition.carriedForwardSkeletalMuscleKg).toBe(29);
    expect(applied.transition.skeletalMuscleTransition.biologicalTransition).toBe("not-modeled");
  });

  it("daily runtime retains strength context without writing skeletalMuscleKg", () => {
    const date = "2026-09-18";
    const result = buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: sources(date, { strengthPerformanceObservation: strengthObservation }),
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(result.strengthPerformanceMeasurement.contractVersion).toBe(MEASUREMENT_ROLE_CONTRACT_V7_VERSION);
    expect(result.strengthPerformanceMeasurement.strengthContext).toMatchObject({
      availability: "available",
      role: "strength-performance-context",
      endpointKind: "one-rep-max",
      value: 100,
    });
    expect(result.strengthPerformanceMeasurement.skeletalMuscleFromStrength.applied).toBe(false);
    expect(result.trainingAdaptation.response.strengthPerformanceContext).toMatchObject({
      availability: "available",
      role: "strength-performance-context",
    });
    expect(result.resultingState.compartments.skeletalMuscleKg).toMatchObject({
      availability: "unavailable",
      valueKg: null,
    });
    expect(result.provenance.strengthPerformanceIsNotSkeletalMuscle).toBe(true);
  });

  it("rebuild keeps skeletalMuscleKg independent of strength/performance observations across days", () => {
    const fromDate = "2026-09-18";
    const toDate = "2026-09-19";
    const prior = runtimeStateFromStructuralStateV7({
      ...emptyState,
      skeletalMuscleKg: 28,
    });
    const rebuilt = rebuildPhysiologyRangeV7({
      fromDate,
      toDate,
      initialState: prior,
      sources: {
        days: [
          sources(fromDate, {
            strengthPerformanceObservation: {
              endpointKind: "one-rep-max",
              value: 120,
              unit: "kg-load",
              movement: "squat",
            },
          }),
          sources(toDate, {
            strengthPerformanceObservation: {
              endpointKind: "strength-trend",
              value: -10,
              unit: "percent-change",
              movement: "squat",
            },
          }),
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
      expect(day.strengthPerformanceMeasurement.skeletalMuscleFromStrength.applied).toBe(false);
      expect(day.resultingState.compartments.skeletalMuscleKg).toMatchObject({
        availability: "available",
        valueKg: 28,
        biologicalTransition: "not-modeled",
      });
    }
    expect(rebuilt.finalState.compartments.skeletalMuscleKg.valueKg).toBe(28);
  });
});
