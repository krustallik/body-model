import { describe, expect, it } from "vitest";
import { calculateStrengthActivity } from "@/model/activity/strength";
import { calculateWalkingActivity } from "@/model/activity/walking";
import type { BodyCompositionState } from "@/model/body-composition/state";
import {
  calculateDynamicDailyExpenditure,
  type DynamicDailyExpenditureInput,
} from "@/model/dynamic-daily-expenditure";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import { canonicalizeWorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import { buildUnifiedEnergyLedgerV1 } from "@/model/unified-experimental-physiology-v1";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";

const INITIAL_FAT_KG = 20;
const INITIAL_LEAN_KG = 40;
const INITIAL_RMR = 1_600;

const rmrParameters = createDynamicRmrParameters({
  initialRmrKcalPerDay: INITIAL_RMR,
  initialFatMassKg: INITIAL_FAT_KG,
  initialLeanTissueKg: INITIAL_LEAN_KG,
});

const bodyComposition: BodyCompositionState = {
  fatMassKg: INITIAL_FAT_KG,
  leanTissueKg: INITIAL_LEAN_KG,
  glycogenKg: 0.5,
  baselineExtracellularFluidLiters: 15,
  extracellularFluidDeviationLiters: 0,
};

const baseInput: DynamicDailyExpenditureInput = {
  bodyComposition,
  rmrParameters,
  macros: { proteinG: 150, carbsG: 200, fatG: 70 },
  outsideWorkWalking: { distanceKm: 3.4, averageSpeedKmh: 5 },
  strength: { durationMinutes: 75 },
  occupational: { category: "standingLightModerate", durationHours: 4 },
  adaptiveThermogenesisKcalPerDay: -40,
};

const calculate = (override: Partial<DynamicDailyExpenditureInput> = {}) => (
  calculateDynamicDailyExpenditure({ ...baseInput, ...override })
);

function workoutEvent(input: {
  type: string;
  activeEnergyKcal: number | null;
  durationMinutes: number;
  startAt: string;
  endAt: string;
}) {
  const canonical = canonicalizeWorkoutType(input.type);
  return {
    type: input.type,
    canonicalType: canonical.canonicalType,
    classification: canonical.classification,
    startAt: input.startAt,
    endAt: input.endAt,
    durationMinutes: input.durationMinutes,
    activeEnergyKcal: input.activeEnergyKcal,
  };
}

describe("workout-aware dynamic daily expenditure", () => {
  it("routes observed MS100 interval steps and HR through active workout kcal into TDEE", () => {
    const startAt = "2026-08-22T05:00:00.000Z";
    const endAt = "2026-08-22T05:10:00.000Z";
    const heartRate = canonicalizeWorkoutHeartRateEvidenceV7({
      workoutInterval: { startAt, endAt },
      heartRate: {
        availability: "loaded",
        samples: [
          { timestamp: startAt, bpm: 120, provenance: { provider: "garmin-connect", device: null } },
          { timestamp: "2026-08-22T05:05:00.000Z", bpm: 135, provenance: { provider: "garmin-connect", device: null } },
          { timestamp: endAt, bpm: 145, provenance: { provider: "garmin-connect", device: null } },
        ],
      },
    });
    const stepperEvidence = canonicalizeWorkoutStepperEvidenceV7({
      workoutEnergy: {
        workoutId: 61,
        canonicalWorkoutType: "Stair Climbing",
        startAt,
        endAt,
        durationMinutes: 10,
        deviceEnergy: { availability: "available", sourceValueStatus: "observed", valueKcal: 356, semantics: "active", provenance: "device-estimate" },
        heartRate,
      },
      snapshots: [],
      stepIntervals: [{ id: 1, startAt, endAt, stepCount: 750 }],
    });
    const event = {
      ...workoutEvent({ type: STAIR_CLIMBING_TYPE, activeEnergyKcal: 356, durationMinutes: 10, startAt, endAt }),
      workoutId: 61,
      stepperEvidence,
    };
    const result = calculate({ strength: { durationMinutes: 0 }, workoutActivity: { events: [event] } });
    const energy = result.workoutEnergyResolution!.perEvent[0].stepperEnergy!;
    expect(result.workoutEnergyResolution?.perEvent[0].source).toBe("mechanical-stepper");
    expect(result.workoutActivityKcalPerDay).toBe(energy.selected.valueKcal);
    expect(result.workoutEnergyResolution?.deviceActiveEnergyKcal).toBe(0);
    expect(result.strengthActivityKcalPerDay).toBe(energy.selected.valueKcal);
    expect(energy.heartRate.decisionReason).toBe("no-personal-ms100-calibration");
  });

  it("carries selected stepper kcal once through daily Activity, Unified ledger, and TDEE", () => {
    const startAt = "2026-08-22T05:00:00.000Z";
    const endAt = "2026-08-22T05:10:00.000Z";
    const evidence = canonicalizeWorkoutStepperEvidenceV7({
      workoutEnergy: {
        workoutId: 62,
        canonicalWorkoutType: "Stair Climbing",
        startAt,
        endAt,
        durationMinutes: 10,
        deviceEnergy: { availability: "available", sourceValueStatus: "observed", valueKcal: 356, semantics: "active", provenance: "device-estimate" },
        heartRate: canonicalizeWorkoutHeartRateEvidenceV7({
          workoutInterval: { startAt, endAt },
          heartRate: { availability: "unavailable" },
        }),
      },
      snapshots: [],
      stepIntervals: [{ id: 2, startAt, endAt, stepCount: 750 }],
    });
    const event = {
      ...workoutEvent({ type: STAIR_CLIMBING_TYPE, activeEnergyKcal: 356, durationMinutes: 10, startAt, endAt }),
      workoutId: 62,
      stepperEvidence: evidence,
    };
    const daily = calculate({
      outsideWorkWalking: { distanceKm: 0, averageSpeedKmh: 5 },
      strength: { durationMinutes: 0 },
      workoutActivity: { events: [event] },
      occupational: { category: null, durationHours: 0 },
      adaptiveThermogenesisKcalPerDay: 0,
    });
    const selectedWorkoutKcal = daily.workoutEnergyResolution!.perEvent[0]!.kcal;
    const unified = buildUnifiedEnergyLedgerV1({
      production: {
        dynamicRmrKcalPerDay: daily.dynamicRmrKcalPerDay,
        tefKcalPerDay: daily.tefKcalPerDay,
        walkingKcalPerDay: null,
        occupationalKcalPerDay: null,
        workoutKcalPerDay: null,
        stepperKcalPerDay: null,
        activityKcalPerDay: daily.activityKcalPerDay,
        adaptiveThermogenesisKcalPerDay: daily.adaptiveThermogenesisKcalPerDay,
        personalOffsetKcalPerDay: null,
        productionTdeeKcalPerDay: daily.modelTdeeBeforePersonalizationKcalPerDay,
      },
      activities: [{ doseKey: "workout:62", kind: "stepper", garminActiveKcal: 356, bodyCastEstimateKcal: null }],
    });

    expect(daily.workoutActivityKcalPerDay).toBeCloseTo(selectedWorkoutKcal, 12);
    expect(daily.strengthActivityKcalPerDay).toBeCloseTo(selectedWorkoutKcal, 12);
    expect(daily.activityKcalPerDay).toBeCloseTo(selectedWorkoutKcal, 12);
    expect(daily.modelTdeeBeforePersonalizationKcalPerDay).toBeCloseTo(
      daily.dynamicRmrKcalPerDay + daily.tefKcalPerDay! + selectedWorkoutKcal,
      10,
    );
    expect(unified.selectedActivityKcal).toBeCloseTo(selectedWorkoutKcal, 12);
    expect(unified.productionTdeeKcal).toBeCloseTo(daily.modelTdeeBeforePersonalizationKcalPerDay!, 12);
    expect(unified.entries.filter((entry) => entry.status === "selected" && entry.kind === "garmin-device")).toHaveLength(0);
    expect(unified.entries.find((entry) => entry.kind === "garmin-device")).toMatchObject({ valueKcal: 356, status: "diagnostic" });
  });

  it("uses remaining outside-work walking after stair overlap subtraction (5.0 - 1.0 work - 0.6 stair = 3.4)", () => {
    const remainingWalkingKm = 5.0 - 1.0 - 0.6;
    expect(remainingWalkingKm).toBeCloseTo(3.4, 12);
    const result = calculate({
      outsideWorkWalking: { distanceKm: remainingWalkingKm, averageSpeedKmh: 5 },
      workoutActivity: {
        events: [
          workoutEvent({
            type: STAIR_CLIMBING_TYPE,
            activeEnergyKcal: 154,
            durationMinutes: 12,
            startAt: "2026-08-22T05:00:00.000Z",
            endAt: "2026-08-22T05:12:00.000Z",
          }),
          workoutEvent({
            type: STAIR_CLIMBING_TYPE,
            activeEnergyKcal: 18,
            durationMinutes: 5,
            startAt: "2026-08-22T10:30:00.000Z",
            endAt: "2026-08-22T10:35:00.000Z",
          }),
          workoutEvent({
            type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
            activeEnergyKcal: 562,
            durationMinutes: 75,
            startAt: "2026-08-22T15:00:00.000Z",
            endAt: "2026-08-22T16:15:00.000Z",
          }),
        ],
      },
    });
    const expectedWalking = calculateWalkingActivity({
      weightKg: result.currentPredictedWeightKg,
      rmrKcalPerDay: result.dynamicRmrKcalPerDay,
      distanceKm: 3.4,
      averageSpeedKmh: 5,
    });
    expect(result.outsideWorkWalkingActivityKcalPerDay).toBeCloseTo(expectedWalking!, 12);
    expect(result.workoutActivityKcalPerDay).toBe(154 + 18 + 562);
    expect(result.strengthActivityKcalPerDay).toBe(734);
  });

  it("applies activityCalibration once to the summed activity including workout kcal", () => {
    const result = calculate({
      personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 0.8 },
      workoutActivity: {
        events: [
          workoutEvent({
            type: STAIR_CLIMBING_TYPE,
            activeEnergyKcal: 154,
            durationMinutes: 12,
            startAt: "2026-08-22T05:00:00.000Z",
            endAt: "2026-08-22T05:12:00.000Z",
          }),
          workoutEvent({
            type: STAIR_CLIMBING_TYPE,
            activeEnergyKcal: 18,
            durationMinutes: 5,
            startAt: "2026-08-22T10:30:00.000Z",
            endAt: "2026-08-22T10:35:00.000Z",
          }),
          workoutEvent({
            type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
            activeEnergyKcal: 562,
            durationMinutes: 75,
            startAt: "2026-08-22T15:00:00.000Z",
            endAt: "2026-08-22T16:15:00.000Z",
          }),
        ],
      },
    });
    expect(result.activityCalibration).toBe(0.8);
    expect(result.calibratedActivityKcalPerDay).toBeCloseTo(result.activityKcalPerDay! * 0.8, 12);
    expect(result.personalizedTdeeKcalPerDay).toBeCloseTo(
      result.dynamicRmrKcalPerDay
        + result.tefKcalPerDay!
        + result.calibratedActivityKcalPerDay!
        + result.adaptiveThermogenesisKcalPerDay!,
      12,
    );
  });

  it("does not double-count strength MET when Garmin strength active kcal is present", () => {
    const withDevice = calculate({
      strength: { durationMinutes: 75 },
      workoutActivity: {
        events: [
          workoutEvent({
            type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
            activeEnergyKcal: 562,
            durationMinutes: 75,
            startAt: "2026-08-22T15:00:00.000Z",
            endAt: "2026-08-22T16:15:00.000Z",
          }),
        ],
      },
    });
    const legacyMet = calculateStrengthActivity({
      weightKg: withDevice.currentPredictedWeightKg,
      rmrKcalPerDay: withDevice.dynamicRmrKcalPerDay,
      durationMinutes: 75,
    })!;
    expect(withDevice.workoutActivityKcalPerDay).toBe(562);
    expect(withDevice.strengthActivityKcalPerDay).toBe(562);
    expect(withDevice.strengthActivityKcalPerDay).not.toBeCloseTo(562 + legacyMet, 8);
  });

  it("keeps day-level activeEnergyKcal out of TDEE composition", () => {
    const withoutDayActive = calculate({
      workoutActivity: {
        events: [
          workoutEvent({
            type: STAIR_CLIMBING_TYPE,
            activeEnergyKcal: 154,
            durationMinutes: 12,
            startAt: "2026-08-22T05:00:00.000Z",
            endAt: "2026-08-22T05:12:00.000Z",
          }),
        ],
      },
    });
    // DynamicDailyExpenditureInput has no day-level activeEnergyKcal field; TDEE must
    // only include explicit workout events + walking/occupational/strength components.
    expect(withoutDayActive.modelTdeeBeforePersonalizationKcalPerDay).toBe(
      withoutDayActive.dynamicRmrKcalPerDay
        + withoutDayActive.tefKcalPerDay!
        + withoutDayActive.activityKcalPerDay!
        + withoutDayActive.adaptiveThermogenesisKcalPerDay!,
    );
    expect(withoutDayActive.workoutActivityKcalPerDay).toBe(154);
    expect(Object.keys(withoutDayActive)).not.toContain("activeEnergyKcal");
  });

  it("preserves pre-change v5 behavior when workoutActivity is omitted", () => {
    const withoutWorkouts = calculate({ strength: { durationMinutes: 60 } });
    expect(withoutWorkouts.workoutActivityKcalPerDay).toBeNull();
    expect(withoutWorkouts.strengthActivityKcalPerDay).toBeCloseTo(202.30833333333334, 12);
    expect(withoutWorkouts.outsideWorkWalkingActivityKcalPerDay).toBeCloseTo(
      calculateWalkingActivity({
        weightKg: withoutWorkouts.currentPredictedWeightKg,
        rmrKcalPerDay: withoutWorkouts.dynamicRmrKcalPerDay,
        distanceKm: 3.4,
        averageSpeedKmh: 5,
      })!,
      12,
    );
  });

  it("adds stair-only workout kcal on top of legacy strength minutes", () => {
    const result = calculate({
      strength: { durationMinutes: 60 },
      workoutActivity: {
        events: [
          workoutEvent({
            type: STAIR_CLIMBING_TYPE,
            activeEnergyKcal: 154,
            durationMinutes: 12,
            startAt: "2026-08-22T05:00:00.000Z",
            endAt: "2026-08-22T05:12:00.000Z",
          }),
          workoutEvent({
            type: STAIR_CLIMBING_TYPE,
            activeEnergyKcal: 18,
            durationMinutes: 5,
            startAt: "2026-08-22T10:30:00.000Z",
            endAt: "2026-08-22T10:35:00.000Z",
          }),
        ],
      },
    });
    const legacyStrength = calculateStrengthActivity({
      weightKg: result.currentPredictedWeightKg,
      rmrKcalPerDay: result.dynamicRmrKcalPerDay,
      durationMinutes: 60,
    })!;
    expect(result.workoutActivityKcalPerDay).toBe(172);
    expect(result.strengthActivityKcalPerDay).toBeCloseTo(legacyStrength + 172, 12);
  });
});
