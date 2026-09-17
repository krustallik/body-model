import { describe, expect, it } from "vitest";
import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import type { BodyCompositionState } from "@/model/body-composition/state";
import { reconstructBodyWeightKg } from "@/model/body-composition/state";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { CURRENT_MODEL_VERSION } from "@/modules/model-episodes/model-version";
import type { HistoricalModelSources } from "@/modules/model-episodes/model-episode.types";
import { sourceDay } from "./model-episode-fixtures";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";

/**
 * Cross-module known-number oracle:
 * daily walking 5.0 − work 1.0 − stair overlap 0.6 = 3.4 remaining
 * workout active kcal 154 + 18 + 562 = 734
 * activityCalibration = 1.1 applied once
 */
const date = "2026-08-22";
const instant = (time: string) => new Date(`2026-08-22T${time}:00+02:00`);
const ACTIVITY_CALIBRATION = 1.1;
const WORKOUT_KCAL = 154 + 18 + 562;

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

function knownNumberSources(): HistoricalModelSources {
  return {
    days: [sourceDay(date, {
      walkingDistanceKm: 5.0,
      averageWalkingSpeedKmh: 5,
      strengthTrainingMinutes: 75,
      proteinG: 150,
      carbsG: 200,
      fatG: 70,
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
    workouts: [
      {
        id: 1, date, externalId: "stair-a", type: STAIR_CLIMBING_TYPE,
        startAt: instant("07:00"),
        endAt: new Date("2026-08-22T07:12:00+02:00"),
        durationMinutes: 12, energyKcal: null, activeEnergyKcal: 154,
      },
      {
        id: 2, date, externalId: "stair-b", type: STAIR_CLIMBING_TYPE,
        startAt: instant("12:30"),
        endAt: new Date("2026-08-22T12:35:00+02:00"),
        durationMinutes: 5, energyKcal: null, activeEnergyKcal: 18,
      },
      {
        id: 3, date, externalId: "strength", type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        startAt: instant("17:00"),
        endAt: new Date("2026-08-22T18:15:00+02:00"),
        durationMinutes: 75, energyKcal: null, activeEnergyKcal: 562,
      },
    ],
  };
}

describe("v6 workout known-number oracle (builder → expenditure)", () => {
  it("matches independent walking/workout/calibration arithmetic", () => {
    const built = buildSimulationDays({
      from: date,
      to: date,
      sources: knownNumberSources(),
      modelVersion: CURRENT_MODEL_VERSION,
    })[0]!;

    expect(built.input.outsideWorkWalkingDistanceKm).toBeCloseTo(3.4, 12);
    expect(built.input.strengthTrainingMinutes).toBe(0);
    expect(built.input.workoutActivity?.events.map((event) => event.activeEnergyKcal))
      .toEqual([154, 18, 562]);

    const result = calculateDynamicDailyExpenditure({
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
      adaptiveThermogenesisKcalPerDay: -40,
      workoutActivity: built.input.workoutActivity,
      personalization: {
        personalOffsetKcalPerDay: 25,
        activityCalibration: ACTIVITY_CALIBRATION,
      },
    });

    const weightKg = reconstructBodyWeightKg(bodyComposition);
    const durationHours = 3.4 / 5;
    // 2024 Adult Compendium level-walking MET at 5.0 km/h → 3.8
    const walkingOracle = 3.8 * weightKg * durationHours
      - result.dynamicRmrKcalPerDay / 24 * durationHours;

    expect(result.workoutActivityKcalPerDay).toBe(WORKOUT_KCAL);
    expect(result.strengthActivityKcalPerDay).toBe(WORKOUT_KCAL);
    expect(result.outsideWorkWalkingActivityKcalPerDay).toBeCloseTo(walkingOracle, 8);

    const rawActivityOracle = walkingOracle
      + WORKOUT_KCAL
      + result.occupationalActivityKcalPerDay!;
    expect(result.activityKcalPerDay).toBeCloseTo(rawActivityOracle, 8);
    expect(result.calibratedActivityKcalPerDay)
      .toBeCloseTo(rawActivityOracle * ACTIVITY_CALIBRATION, 8);
    // Calibration once: not squared.
    expect(result.calibratedActivityKcalPerDay)
      .not.toBeCloseTo(rawActivityOracle * ACTIVITY_CALIBRATION * ACTIVITY_CALIBRATION, 5);

    const tdeeOracle = result.dynamicRmrKcalPerDay
      + result.tefKcalPerDay!
      + result.calibratedActivityKcalPerDay!
      + result.adaptiveThermogenesisKcalPerDay!
      + 25;
    expect(result.personalizedTdeeKcalPerDay).toBeCloseTo(tdeeOracle, 8);
  });

  it("does not invent MET for stair events that already have device kcal", () => {
    const built = buildSimulationDays({
      from: date,
      to: date,
      sources: knownNumberSources(),
      modelVersion: CURRENT_MODEL_VERSION,
    })[0]!;
    const result = calculateDynamicDailyExpenditure({
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
      strength: { durationMinutes: 0 },
      occupational: built.input.occupationalActivity,
      adaptiveThermogenesisKcalPerDay: 0,
      workoutActivity: built.input.workoutActivity,
    });
    expect(result.workoutActivityKcalPerDay).toBe(WORKOUT_KCAL);
    // Strength minutes suppressed on v6 when explicit strength workouts present.
    expect(built.input.strengthTrainingMinutes).toBe(0);
  });
});
