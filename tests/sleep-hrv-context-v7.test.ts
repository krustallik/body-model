import { describe, expect, it } from "vitest";
import {
  buildPhysiologyDayV7,
  createUnavailablePhysiologyRuntimeStateV7,
  runtimeStateFromStructuralStateV7,
} from "@/model/physiology-v7/daily-runtime-v7";
import {
  buildResistanceTrainingAdaptationResponseV7,
  resistanceTrainingAdaptationResponseV7Fingerprint,
} from "@/model/physiology-v7/resistance-training-adaptation-response-v7";
import { buildResistanceTrainingExposureHistoryFromSourcesV7 } from "@/model/physiology-v7/resistance-training-exposure-history-sources-v7";
import {
  handleSleepHrvContextForPhysiologyV7,
  HRV_HYPERTROPHY_COEFFICIENT_POLICY_V7,
  MISSING_SLEEP_POLICY_V7,
  rejectHrvAsHypertrophyCoefficientV7,
  rejectIsolatedLowSleepAsDailyMultiplierV7,
  rejectMissingSleepAsZeroPenaltyV7,
  rejectSleepStagesAsBodyCompositionDriverV7,
  rejectWearableSleepAsPsgV7,
  resolveSleepObservationV7,
  SLEEP_DAILY_ANABOLIC_MULTIPLIER_POLICY_V7,
  SLEEP_HRV_CONTEXT_CONTRACT_V7_VERSION,
  SLEEP_STAGE_PHYSIOLOGY_POLICY_V7,
  WEARABLE_SLEEP_PROVENANCE_POLICY_V7,
  type SleepObservationV7,
} from "@/model/physiology-v7/sleep-hrv-context-v7";
import { applyTrainingAdaptationTransitionV7 } from "@/model/physiology-v7/training-adaptation-transition-v7";
import type { PhysiologyV7State } from "@/model/physiology-v7/state";
import { observedNutritionProvenance } from "@/modules/model-episodes/nutrition-gap-bridge";

const emptyState: PhysiologyV7State = {
  fatMassKg: 18,
  skeletalMuscleKg: 30,
  otherLeanTissueKg: null,
  glycogenKg: null,
  glycogenWaterKg: null,
  ecfDeviationKg: null,
  transientExerciseWaterKg: null,
  adaptiveThermogenesisKcalPerDay: null,
  weightFilterState: null,
};

function daySources(date: string, options: {
  sleepObservation?: SleepObservationV7 | null;
  hrvObservation?: {
    availability: "available";
    valueMs: number;
    readinessScore?: number | null;
  } | null;
} = {}) {
  return {
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
      sleepSegmentCount: options.sleepObservation?.availability === "available" ? 1 : 0,
    },
    sleepObservation: options.sleepObservation ?? null,
    hrvObservation: options.hrvObservation ?? null,
  };
}

describe("sleep/HRV context v7 guardrails", () => {
  it("treats missing sleep as unknown, not zero, without automatic physiology penalty", () => {
    const missing = resolveSleepObservationV7({
      availability: "unavailable",
      reason: "missing-sleep-record",
    });
    expect(missing).toMatchObject({
      availability: "unavailable",
      interpretation: "unknown-not-zero",
      mayPenalizePhysiology: false,
      mayAssumeZeroSleep: false,
      missingSleepPolicy: MISSING_SLEEP_POLICY_V7,
    });
    expect(missing).not.toMatchObject({ durationMinutes: 0 });
    expect(rejectMissingSleepAsZeroPenaltyV7({
      sleepObservation: null,
    }).accepted).toBe(false);

    const handled = handleSleepHrvContextForPhysiologyV7({
      state: emptyState,
      sleepObservation: null,
    });
    expect(handled.contractVersion).toBe(SLEEP_HRV_CONTEXT_CONTRACT_V7_VERSION);
    expect(handled.physiologyEffect.adaptationPenaltyApplied).toBe(false);
    expect(handled.resultingSkeletalMuscleKg).toBe(30);
    expect(handled.resultingFatMassKg).toBe(18);

    const date = "2026-09-18";
    const withMissing = buildPhysiologyDayV7({
      date,
      priorState: runtimeStateFromStructuralStateV7(emptyState),
      sources: daySources(date, {
        sleepObservation: { availability: "unavailable", reason: "missing-sleep-record" },
      }),
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    const withObserved = buildPhysiologyDayV7({
      date,
      priorState: runtimeStateFromStructuralStateV7(emptyState),
      sources: daySources(date, {
        sleepObservation: {
          availability: "available",
          durationMinutes: 420,
          source: "wearable-consumer",
        },
      }),
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(withMissing.sleepHrvContext.sleepContext.availability).toBe("unavailable");
    expect(withMissing.provenance.missingSleepIsUnknownNotZero).toBe(true);
    expect(withMissing.resultingState.compartments).toEqual(withObserved.resultingState.compartments);
    expect(withMissing.trainingAdaptation.skeletalMuscleTransition)
      .toEqual(withObserved.trainingAdaptation.skeletalMuscleTransition);
  });

  it("keeps consumer sleep stages from driving body-composition outputs", () => {
    const baseSleep = {
      availability: "available" as const,
      durationMinutes: 450,
      source: "wearable-consumer" as const,
    };
    const stageA: SleepObservationV7 = {
      ...baseSleep,
      stages: { remMinutes: 90, coreMinutes: 240, deepMinutes: 60 },
    };
    const stageB: SleepObservationV7 = {
      ...baseSleep,
      stages: { remMinutes: 30, coreMinutes: 300, deepMinutes: 120 },
    };
    expect(rejectSleepStagesAsBodyCompositionDriverV7({
      sleepObservation: stageA,
    })).toMatchObject({
      accepted: false,
      policy: SLEEP_STAGE_PHYSIOLOGY_POLICY_V7,
    });

    const date = "2026-09-18";
    const history = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: date,
      toDate: date,
      days: [{ date, workoutFeedObserved: true }],
      strengthWorkouts: [],
      sessions: [],
    });
    const dayA = buildPhysiologyDayV7({
      date,
      priorState: runtimeStateFromStructuralStateV7(emptyState),
      sources: daySources(date, { sleepObservation: stageA }),
      exposureHistory: history,
    });
    const dayB = buildPhysiologyDayV7({
      date,
      priorState: runtimeStateFromStructuralStateV7(emptyState),
      sources: daySources(date, { sleepObservation: stageB }),
      exposureHistory: history,
    });
    expect(dayA.sleepHrvContext.sleepContext).toMatchObject({
      availability: "available",
      mayDriveBodyCompositionTransitions: false,
    });
    expect(dayA.resultingState.compartments).toEqual(dayB.resultingState.compartments);
    expect(dayA.resultingStructuralStateFingerprint)
      .toBe(dayB.resultingStructuralStateFingerprint);
    expect(dayA.provenance.consumerSleepStagesDoNotDrivePhysiology).toBe(true);
    expect(JSON.stringify(dayA.sleepHrvContext)).not.toMatch(/sleepStageMultiplier|stageDrivenDeltaKg/);
  });

  it("retains wearable sleep provenance and rejects PSG equivalence", () => {
    const wearable: Extract<SleepObservationV7, { availability: "available" }> = {
      availability: "available",
      durationMinutes: 400,
      source: "wearable-consumer",
      stages: { remMinutes: 80, coreMinutes: 220, deepMinutes: 50 },
    };
    const rejected = rejectWearableSleepAsPsgV7({ sleepObservation: wearable });
    expect(rejected.accepted).toBe(false);
    expect(rejected.policy).toEqual(WEARABLE_SLEEP_PROVENANCE_POLICY_V7);
    expect(rejected.sleepContext.provenance).toMatchObject({
      deviceKind: "wearable-consumer",
      measurementUncertainty: "retained",
      psgEquivalence: "intentionally-rejected",
    });
    expect(rejected.sleepContext.provenance).not.toMatchObject({ groundTruth: "psg" });

    const date = "2026-09-18";
    const day = buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: daySources(date, { sleepObservation: wearable }),
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      }),
    });
    expect(day.sleepHrvContext.sleepContext).toMatchObject({
      availability: "available",
      provenance: {
        psgEquivalence: "intentionally-rejected",
        policy: WEARABLE_SLEEP_PROVENANCE_POLICY_V7,
      },
    });
    expect(day.provenance.wearableSleepIsNotPsg).toBe(true);
    expect(JSON.stringify(day.sleepHrvContext.sleepContext)).not.toMatch(/\"psg\"|polysomnography/);
  });

  it("rejects HRV as an independent hypertrophy or muscle-kg coefficient", () => {
    const lowHrv = { availability: "available" as const, valueMs: 25, readinessScore: 40 };
    const highHrv = { availability: "available" as const, valueMs: 90, readinessScore: 85 };
    expect(rejectHrvAsHypertrophyCoefficientV7({ hrvObservation: lowHrv })).toMatchObject({
      accepted: false,
      policy: HRV_HYPERTROPHY_COEFFICIENT_POLICY_V7,
    });

    const date = "2026-09-18";
    const history = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: date,
      toDate: date,
      days: [{ date, workoutFeedObserved: true }],
      strengthWorkouts: [],
      sessions: [],
    });
    const lowResponse = buildResistanceTrainingAdaptationResponseV7({
      date,
      exposureHistory: history,
      hrvObservation: lowHrv,
    });
    const highResponse = buildResistanceTrainingAdaptationResponseV7({
      date,
      exposureHistory: history,
      hrvObservation: highHrv,
    });
    expect(lowResponse.hrvContext).toMatchObject({
      availability: "available",
      mayMultiplyTrainingStimulus: false,
      mayConvertToSkeletalMuscleKg: false,
      hypertrophyCoefficientPolicy: HRV_HYPERTROPHY_COEFFICIENT_POLICY_V7,
    });
    expect(lowResponse.expectedLocalAdaptation).toEqual(highResponse.expectedLocalAdaptation);
    expect(lowResponse.trainingStimulus).toEqual(highResponse.trainingStimulus);
    expect(lowResponse.calibration.rejectedConversions).toContain(
      "hrv-to-hypertrophy-or-skeletal-muscle-kg",
    );
    expect(resistanceTrainingAdaptationResponseV7Fingerprint(lowResponse))
      .toBe(resistanceTrainingAdaptationResponseV7Fingerprint(highResponse));

    const applied = applyTrainingAdaptationTransitionV7({
      state: emptyState,
      response: highResponse,
    });
    expect(applied.state.skeletalMuscleKg).toBe(30);
    expect(applied.transition.skeletalMuscleTransition.biologicalTransition).toBe("not-modeled");

    const dayLow = buildPhysiologyDayV7({
      date,
      priorState: runtimeStateFromStructuralStateV7(emptyState),
      sources: daySources(date, { hrvObservation: lowHrv }),
      exposureHistory: history,
    });
    const dayHigh = buildPhysiologyDayV7({
      date,
      priorState: runtimeStateFromStructuralStateV7(emptyState),
      sources: daySources(date, { hrvObservation: highHrv }),
      exposureHistory: history,
    });
    expect(dayLow.resultingState.compartments).toEqual(dayHigh.resultingState.compartments);
    expect(dayLow.provenance.hrvHasNoHypertrophyCoefficient).toBe(true);
    expect(JSON.stringify(dayHigh.trainingAdaptation.response.hrvContext))
      .not.toMatch(/hrvMultiplier|hypertrophyKgFromHrv/);
  });

  it("rejects an isolated poor night as an exact daily anabolic/body-composition multiplier", () => {
    const poorNight: SleepObservationV7 = {
      availability: "available",
      durationMinutes: 210,
      source: "wearable-consumer",
      stages: { remMinutes: 20, coreMinutes: 140, deepMinutes: 20 },
    };
    const normalNight: SleepObservationV7 = {
      availability: "available",
      durationMinutes: 450,
      source: "wearable-consumer",
      stages: { remMinutes: 90, coreMinutes: 250, deepMinutes: 70 },
    };
    expect(rejectIsolatedLowSleepAsDailyMultiplierV7({ sleepObservation: poorNight })).toMatchObject({
      accepted: false,
      policy: SLEEP_DAILY_ANABOLIC_MULTIPLIER_POLICY_V7,
    });
    const resolved = resolveSleepObservationV7(poorNight);
    expect(resolved).toMatchObject({
      availability: "available",
      mayApplyExactDailyAnabolicMultiplier: false,
      mayApplyMuscleOrFatCoefficient: false,
      dailyAnabolicMultiplierPolicy: SLEEP_DAILY_ANABOLIC_MULTIPLIER_POLICY_V7,
    });

    const handled = handleSleepHrvContextForPhysiologyV7({
      state: emptyState,
      sleepObservation: poorNight,
    });
    expect(handled.physiologyEffect.sleepDailyAnabolicMultiplierApplied).toBe(false);
    expect(handled.resultingSkeletalMuscleKg).toBe(30);
    expect(handled.resultingFatMassKg).toBe(18);

    const date = "2026-09-18";
    const history = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: date,
      toDate: date,
      days: [{ date, workoutFeedObserved: true }],
      strengthWorkouts: [],
      sessions: [],
    });
    const poorDay = buildPhysiologyDayV7({
      date,
      priorState: runtimeStateFromStructuralStateV7(emptyState),
      sources: daySources(date, { sleepObservation: poorNight }),
      exposureHistory: history,
    });
    const normalDay = buildPhysiologyDayV7({
      date,
      priorState: runtimeStateFromStructuralStateV7(emptyState),
      sources: daySources(date, { sleepObservation: normalNight }),
      exposureHistory: history,
    });
    expect(poorDay.resultingState.compartments).toEqual(normalDay.resultingState.compartments);
    expect(poorDay.sleepHrvContext.physiologyEffect.sleepDailyAnabolicMultiplierApplied).toBe(false);
    expect(poorDay.provenance.isolatedLowSleepHasNoExactDailyMultiplier).toBe(true);
  });
});
