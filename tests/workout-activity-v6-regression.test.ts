import { describe, expect, it } from "vitest";
import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import type { BodyCompositionState } from "@/model/body-composition/state";
import { reconstructBodyWeightKg } from "@/model/body-composition/state";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import {
  LEGACY_PHYSIOLOGY_V5,
} from "@/modules/model-episodes/model-version";
import type { HistoricalModelSources } from "@/modules/model-episodes/model-episode.types";
import { sourceDay } from "./model-episode-fixtures";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";

const date = "2026-08-22";
const PHYSIOLOGY_V6 = "bodycast-physiology-v6";
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

/** Known Garmin active kcal that would change TDEE if v5 leaked into workout path. */
const WORKOUT_ACTIVE_KCAL = 154 + 18 + 562; // 734

function garminLeakCapableSources(): HistoricalModelSources {
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
    workouts: [
      {
        id: 1, date, externalId: "stair-1", type: STAIR_CLIMBING_TYPE,
        startAt: instant("07:00"),
        endAt: new Date("2026-08-22T07:12:00+02:00"),
        durationMinutes: 12, energyKcal: null, activeEnergyKcal: 154,
      },
      {
        id: 2, date, externalId: "stair-2", type: STAIR_CLIMBING_TYPE,
        startAt: instant("12:30"),
        endAt: new Date("2026-08-22T12:35:00+02:00"),
        durationMinutes: 5, energyKcal: null, activeEnergyKcal: 18,
      },
      {
        id: 3, date, externalId: "strength-1", type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        startAt: instant("17:00"),
        endAt: new Date("2026-08-22T18:15:00+02:00"),
        durationMinutes: 75, energyKcal: null, activeEnergyKcal: 562,
      },
    ],
  };
}

function expenditureFromBuilt(built: ReturnType<typeof buildSimulationDays>[number]) {
  return calculateDynamicDailyExpenditure({
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
    workoutActivity: built.input.workoutActivity,
    personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
  });
}

describe("workout-activity v5/v6 regression", () => {
  it("keeps v5 simulation inputs free of workoutActivity even when Garmin workouts are present", () => {
    const withWorkouts = buildSimulationDays({
      from: date,
      to: date,
      sources: garminLeakCapableSources(),
      modelVersion: LEGACY_PHYSIOLOGY_V5,
    })[0]!;
    const withoutWorkouts = buildSimulationDays({
      from: date,
      to: date,
      sources: { ...garminLeakCapableSources(), workouts: [] },
      modelVersion: LEGACY_PHYSIOLOGY_V5,
    })[0]!;

    expect(withWorkouts.input.workoutActivity).toBeUndefined();
    expect(withoutWorkouts.input.workoutActivity).toBeUndefined();
    expect(withWorkouts.input.strengthTrainingMinutes).toBe(75);
    expect(withWorkouts.input.outsideWorkWalkingDistanceKm)
      .toBeCloseTo(withoutWorkouts.input.outsideWorkWalkingDistanceKm!, 12);
    // Work walking still reconstructed; stair overlap must NOT run on v5.
    expect(withWorkouts.sourceQuality.stairWalkingOverlap).toBeUndefined();
    expect(withWorkouts.input.outsideWorkWalkingDistanceKm).toBeCloseTo(4.0, 12);
  });

  it("prevents Garmin workout active kcal from leaking into v5 TDEE", () => {
    const withWorkouts = buildSimulationDays({
      from: date,
      to: date,
      sources: garminLeakCapableSources(),
      modelVersion: LEGACY_PHYSIOLOGY_V5,
    })[0]!;
    const withoutWorkouts = buildSimulationDays({
      from: date,
      to: date,
      sources: { ...garminLeakCapableSources(), workouts: [] },
      modelVersion: LEGACY_PHYSIOLOGY_V5,
    })[0]!;
    const v5With = expenditureFromBuilt(withWorkouts);
    const v5Without = expenditureFromBuilt(withoutWorkouts);

    // Leak detector: adding 734 kcal of Garmin workouts must not change v5 TDEE at all.
    expect(v5With.workoutActivityKcalPerDay).toBeNull();
    expect(v5With.personalizedTdeeKcalPerDay)
      .toBe(v5Without.personalizedTdeeKcalPerDay);
    expect(v5With.activityKcalPerDay).toBe(v5Without.activityKcalPerDay);

    const v6 = expenditureFromBuilt(buildSimulationDays({
      from: date,
      to: date,
      sources: garminLeakCapableSources(),
      modelVersion: PHYSIOLOGY_V6,
    })[0]!);
    expect(v6.workoutActivityKcalPerDay).toBe(WORKOUT_ACTIVE_KCAL);
    expect(v6.personalizedTdeeKcalPerDay)
      .not.toBeCloseTo(v5With.personalizedTdeeKcalPerDay!, 5);
  });

  it("uses workout-aware reconstruction on v6 for the same physical source dataset", () => {
    const built = buildSimulationDays({
      from: date,
      to: date,
      sources: garminLeakCapableSources(),
      modelVersion: PHYSIOLOGY_V6,
    })[0]!;

    expect(built.input.workoutActivity?.events).toHaveLength(3);
    expect(built.input.strengthTrainingMinutes).toBe(0);
    expect(built.sourceQuality.workWalkingDistanceKm).toBeCloseTo(1.0, 12);
    expect(built.sourceQuality.stairWalkingOverlap?.some((row) => (
      row.overlapApplied && Math.abs(row.overlapDistanceAppliedKm - 0.2) < 1e-9
    ))).toBe(true);
    expect(built.input.outsideWorkWalkingDistanceKm).toBeCloseTo(3.8, 12);

    const expenditure = expenditureFromBuilt(built);
    expect(expenditure.workoutActivityKcalPerDay).toBe(WORKOUT_ACTIVE_KCAL);
    expect(expenditure.strengthActivityKcalPerDay).toBe(WORKOUT_ACTIVE_KCAL);
    expect(expenditure.outsideWorkWalkingActivityKcalPerDay).toBeGreaterThan(0);

    const weightKg = reconstructBodyWeightKg(bodyComposition);
    // Independent Compendium oracle for remaining walking 3.8 km @ 5 km/h, MET 3.8.
    const durationHours = 3.8 / 5;
    const walkingOracle = 3.8 * weightKg * durationHours
      - expenditure.dynamicRmrKcalPerDay / 24 * durationHours;
    expect(expenditure.outsideWorkWalkingActivityKcalPerDay)
      .toBeCloseTo(walkingOracle, 8);
  });
});
