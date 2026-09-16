import { describe, expect, it } from "vitest";
import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import type { BodyCompositionState } from "@/model/body-composition/state";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { LEGACY_PHYSIOLOGY_V5 } from "@/modules/model-episodes/model-version";
import type { HistoricalModelSources } from "@/modules/model-episodes/model-episode.types";
import { sourceDay } from "./model-episode-fixtures";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";

const date = "2026-08-22";
const instant = (time: string) => new Date(`2026-08-22T${time}:00+02:00`);

const bodyComposition: BodyCompositionState = {
  fatMassKg: 20,
  leanTissueKg: 40,
  glycogenKg: 0.5,
  baselineExtracellularFluidLiters: 15,
  extracellularFluidDeviationLiters: 0,
};

const rmrParameters = createDynamicRmrParameters({
  initialRmrKcalPerDay: 1_600,
  initialFatMassKg: 20,
  initialLeanTissueKg: 40,
});

const garminWorkouts = [
  {
    id: 1,
    date,
    externalId: "stair-1",
    type: STAIR_CLIMBING_TYPE,
    startAt: instant("07:00"),
    endAt: new Date("2026-08-22T07:12:00+02:00"),
    durationMinutes: 12,
    energyKcal: null,
    activeEnergyKcal: 154,
  },
  {
    id: 2,
    date,
    externalId: "stair-2",
    type: STAIR_CLIMBING_TYPE,
    startAt: instant("12:30"),
    endAt: new Date("2026-08-22T12:35:00+02:00"),
    durationMinutes: 5,
    energyKcal: null,
    activeEnergyKcal: 18,
  },
  {
    id: 3,
    date,
    externalId: "strength-1",
    type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
    startAt: instant("17:00"),
    endAt: new Date("2026-08-22T18:15:00+02:00"),
    durationMinutes: 75,
    energyKcal: null,
    activeEnergyKcal: 562,
  },
];

function fixtureSources(): HistoricalModelSources {
  return {
    days: [sourceDay(date, {
      walkingDistanceKm: 5.0,
      averageWalkingSpeedKmh: 5,
      strengthTrainingMinutes: 75,
    })],
    snapshots: [
      { id: 1, date, receivedAt: instant("08:00"), syncedAt: null, steps: 1_000,
        walkingDistanceKm: 1.0 },
      { id: 2, date, receivedAt: instant("09:00"), syncedAt: null, steps: 2_500,
        walkingDistanceKm: 2.0 },
      { id: 3, date, receivedAt: instant("10:00"), syncedAt: null, steps: 4_000,
        walkingDistanceKm: 3.0 },
      { id: 4, date, receivedAt: instant("12:25"), syncedAt: null, steps: 5_000,
        walkingDistanceKm: 3.5 },
      { id: 5, date, receivedAt: instant("12:40"), syncedAt: null, steps: 6_000,
        walkingDistanceKm: 4.1 },
      { id: 6, date, receivedAt: instant("18:00"), syncedAt: null, steps: 8_000,
        walkingDistanceKm: 5.0 },
    ],
    workIntervals: [{
      id: 1, date, startAt: instant("09:00"), endAt: instant("10:00"),
      timezone: "Europe/Bratislava", category: "standingLight", breakMinutes: 0,
    }],
    workouts: garminWorkouts,
  };
}

describe("workout-activity v6 regression for v5 episodes", () => {
  it("keeps buildSimulationDays identical for v5 whether workouts are present or empty", () => {
    const withWorkouts = buildSimulationDays({
      from: date,
      to: date,
      sources: fixtureSources(),
      modelVersion: LEGACY_PHYSIOLOGY_V5,
    });
    const withoutWorkouts = buildSimulationDays({
      from: date,
      to: date,
      sources: { ...fixtureSources(), workouts: [] },
      modelVersion: LEGACY_PHYSIOLOGY_V5,
    });
    expect(withWorkouts).toEqual(withoutWorkouts);
    expect(withWorkouts[0].input.workoutActivity).toBeUndefined();
    expect(withWorkouts[0].input.strengthTrainingMinutes).toBe(75);
    expect(withWorkouts[0].input.outsideWorkWalkingDistanceKm)
      .toBe(withoutWorkouts[0].input.outsideWorkWalkingDistanceKm);
  });

  it("keeps DynamicDailyExpenditure identical when workoutActivity is omitted (v5 path)", () => {
    const before = calculateDynamicDailyExpenditure({
      bodyComposition,
      rmrParameters,
      macros: { proteinG: 150, carbsG: 200, fatG: 70 },
      outsideWorkWalking: { distanceKm: 4.0, averageSpeedKmh: 5 },
      strength: { durationMinutes: 75 },
      occupational: { category: "standingLightModerate", durationHours: 4 },
      adaptiveThermogenesisKcalPerDay: -40,
      personalization: { personalOffsetKcalPerDay: 50, activityCalibration: 0.95 },
    });
    const after = calculateDynamicDailyExpenditure({
      bodyComposition,
      rmrParameters,
      macros: { proteinG: 150, carbsG: 200, fatG: 70 },
      outsideWorkWalking: { distanceKm: 4.0, averageSpeedKmh: 5 },
      strength: { durationMinutes: 75 },
      occupational: { category: "standingLightModerate", durationHours: 4 },
      adaptiveThermogenesisKcalPerDay: -40,
      personalization: { personalOffsetKcalPerDay: 50, activityCalibration: 0.95 },
    });
    expect(after).toEqual(before);
    expect(after.workoutActivityKcalPerDay).toBeNull();
    expect(before.workoutActivityKcalPerDay).toBeNull();
  });

  it("does not change v5 expenditure totals when day-level Garmin workouts exist only in sources", () => {
    const built = buildSimulationDays({
      from: date,
      to: date,
      sources: fixtureSources(),
      modelVersion: LEGACY_PHYSIOLOGY_V5,
    })[0];
    const expenditure = calculateDynamicDailyExpenditure({
      bodyComposition,
      rmrParameters,
      macros: {
        proteinG: built.input.proteinG,
        carbsG: built.input.carbsG,
        fatG: built.input.fatG,
      },
      outsideWorkWalking: {
        distanceKm: built.input.outsideWorkWalkingDistanceKm,
        averageSpeedKmh: built.input.averageWalkingSpeedKmh,
      },
      strength: { durationMinutes: built.input.strengthTrainingMinutes },
      occupational: built.input.occupationalActivity,
      adaptiveThermogenesisKcalPerDay: 0,
    });
    const baselineWithoutSourceWorkouts = calculateDynamicDailyExpenditure({
      bodyComposition,
      rmrParameters,
      macros: {
        proteinG: built.input.proteinG,
        carbsG: built.input.carbsG,
        fatG: built.input.fatG,
      },
      outsideWorkWalking: {
        distanceKm: built.input.outsideWorkWalkingDistanceKm,
        averageSpeedKmh: built.input.averageWalkingSpeedKmh,
      },
      strength: { durationMinutes: 75 },
      occupational: built.input.occupationalActivity,
      adaptiveThermogenesisKcalPerDay: 0,
    });
    expect(expenditure).toEqual(baselineWithoutSourceWorkouts);
    expect(expenditure.workoutActivityKcalPerDay).toBeNull();
    // Stair 154+18 and strength 562 must not leak into v5 TDEE.
    expect(expenditure.activityKcalPerDay).not.toBeCloseTo(
      (expenditure.activityKcalPerDay ?? 0) + 154 + 18 + 562,
      5,
    );
  });
});
