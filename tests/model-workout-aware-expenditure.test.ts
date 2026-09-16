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
