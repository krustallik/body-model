import { describe, expect, it } from "vitest";
import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import type { BodyCompositionState } from "@/model/body-composition/state";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import {
  canonicalizeWorkoutType,
  resolveExplicitWorkoutActivityKcal,
  type ExplicitWorkoutActivityEvent,
} from "@/model/activity/workout-energy";
import { reconstructStairWalkingOverlap } from "@/model/activity/stair-walking-overlap";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import {
  CURRENT_MODEL_VERSION,
  LEGACY_PHYSIOLOGY_V5,
} from "@/modules/model-episodes/model-version";
import type { HistoricalModelSources } from "@/modules/model-episodes/model-episode.types";
import { sourceDay } from "./model-episode-fixtures";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";

/** Deterministic seed for the few metamorphic cases below. */
const PROPERTY_SEED = 2_026_08_22;

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

function workoutEvent(input: {
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
}): ExplicitWorkoutActivityEvent {
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

function seededPermutations<T>(items: readonly T[], seed: number): T[][] {
  // LCG over Fisher–Yates: a few deterministic shuffles, not exhaustive.
  let state = seed >>> 0 || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const out: T[][] = [[...items]];
  for (let trial = 0; trial < 4; trial += 1) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(next() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
    }
    out.push(copy);
  }
  return out;
}

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

const baseEvents: ExplicitWorkoutActivityEvent[] = [
  workoutEvent({
    type: STAIR_CLIMBING_TYPE,
    startAt: "2026-08-22T05:00:00.000Z",
    endAt: "2026-08-22T05:12:00.000Z",
    durationMinutes: 12,
    activeEnergyKcal: 154,
  }),
  workoutEvent({
    type: STAIR_CLIMBING_TYPE,
    startAt: "2026-08-22T10:30:00.000Z",
    endAt: "2026-08-22T10:35:00.000Z",
    durationMinutes: 5,
    activeEnergyKcal: 18,
  }),
  workoutEvent({
    type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
    startAt: "2026-08-22T15:00:00.000Z",
    endAt: "2026-08-22T16:15:00.000Z",
    durationMinutes: 75,
    activeEnergyKcal: 562,
  }),
];

describe("workout-activity property / metamorphic", () => {
  it("is invariant to workout event order for total workout + calibrated activity", () => {
    const baselineResolved = resolveExplicitWorkoutActivityKcal({
      events: baseEvents,
      weightKg: 80,
      rmrKcalPerDay: 1_600,
    });
    const baselineExpenditure = calculateDynamicDailyExpenditure({
      bodyComposition,
      rmrParameters,
      macros: { proteinG: 150, carbsG: 250, fatG: 70 },
      outsideWorkWalking: { distanceKm: 3.4, averageSpeedKmh: 5 },
      strength: { durationMinutes: 0 },
      occupational: { category: null, durationHours: 0 },
      adaptiveThermogenesisKcalPerDay: 0,
      workoutActivity: { events: baseEvents },
      personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1.15 },
    });

    for (const events of seededPermutations(baseEvents, PROPERTY_SEED)) {
      const resolved = resolveExplicitWorkoutActivityKcal({
        events,
        weightKg: 80,
        rmrKcalPerDay: 1_600,
      });
      const expenditure = calculateDynamicDailyExpenditure({
        bodyComposition,
        rmrParameters,
        macros: { proteinG: 150, carbsG: 250, fatG: 70 },
        outsideWorkWalking: { distanceKm: 3.4, averageSpeedKmh: 5 },
        strength: { durationMinutes: 0 },
        occupational: { category: null, durationHours: 0 },
        adaptiveThermogenesisKcalPerDay: 0,
        workoutActivity: { events },
        personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1.15 },
      });
      expect(resolved.workoutActivityKcal).toBe(baselineResolved.workoutActivityKcal);
      expect(expenditure.workoutActivityKcalPerDay)
        .toBe(baselineExpenditure.workoutActivityKcalPerDay);
      expect(expenditure.calibratedActivityKcalPerDay)
        .toBeCloseTo(baselineExpenditure.calibratedActivityKcalPerDay!, 12);
    }
  });

  it("does not increase deducted stair distance when the same segment is claimed twice", () => {
    const snapshots = [
      { timestamp: instant("11:55"), steps: 3_000, walkingDistanceKm: 3.0 },
      { timestamp: instant("12:05"), steps: 3_600, walkingDistanceKm: 3.3 },
      { timestamp: instant("12:15"), steps: 4_200, walkingDistanceKm: 3.6 },
    ];
    const once = reconstructStairWalkingOverlap({
      snapshots,
      stairWorkouts: [
        { startAt: instant("12:00"), endAt: instant("12:10"), activeEnergyKcal: 154 },
      ],
    });
    const duplicatedClaim = reconstructStairWalkingOverlap({
      snapshots,
      stairWorkouts: [
        { startAt: instant("12:00"), endAt: instant("12:10"), activeEnergyKcal: 154 },
        { startAt: instant("12:00"), endAt: instant("12:10"), activeEnergyKcal: 154 },
      ],
    });
    expect(once.overlapDistanceKm).toBeGreaterThan(0);
    expect(duplicatedClaim.overlapDistanceKm).toBeCloseTo(once.overlapDistanceKm, 12);
    expect(duplicatedClaim.diagnostics[1]?.reason).toBe("overlap-deduplicated");
    expect(duplicatedClaim.diagnostics[1]?.overlapDistanceAppliedKm).toBe(0);
  });

  it("moves workout activity by Δ when device activeEnergyKcal moves by Δ (pre-calibration)", () => {
    const baseKcal = 400;
    const deltas = [0, 25, 80, 150];
    const baseline = calculateDynamicDailyExpenditure({
      bodyComposition,
      rmrParameters,
      macros: { proteinG: 150, carbsG: 250, fatG: 70 },
      outsideWorkWalking: { distanceKm: 3.4, averageSpeedKmh: 5 },
      strength: { durationMinutes: 0 },
      occupational: { category: null, durationHours: 0 },
      adaptiveThermogenesisKcalPerDay: 0,
      workoutActivity: {
        events: [workoutEvent({
          type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
          startAt: "2026-08-22T15:00:00.000Z",
          endAt: "2026-08-22T16:00:00.000Z",
          durationMinutes: 60,
          activeEnergyKcal: baseKcal,
        })],
      },
      personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
    });

    for (const delta of deltas) {
      const result = calculateDynamicDailyExpenditure({
        bodyComposition,
        rmrParameters,
        macros: { proteinG: 150, carbsG: 250, fatG: 70 },
        outsideWorkWalking: { distanceKm: 3.4, averageSpeedKmh: 5 },
        strength: { durationMinutes: 0 },
        occupational: { category: null, durationHours: 0 },
        adaptiveThermogenesisKcalPerDay: 0,
        workoutActivity: {
          events: [workoutEvent({
            type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
            startAt: "2026-08-22T15:00:00.000Z",
            endAt: "2026-08-22T16:00:00.000Z",
            durationMinutes: 60,
            activeEnergyKcal: baseKcal + delta,
          })],
        },
        personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
      });
      expect(result.workoutActivityKcalPerDay)
        .toBeCloseTo(baseline.workoutActivityKcalPerDay! + delta, 12);
      // Pre-calibration: activityCalibration is 1, so calibrated activity tracks raw activity.
      expect(result.calibratedActivityKcalPerDay)
        .toBeCloseTo(result.activityKcalPerDay!, 12);
      expect(result.activityKcalPerDay)
        .toBeCloseTo(baseline.activityKcalPerDay! + delta, 12);
    }
  });

  it("treats walking=0 as complete observed rest vs walking=null as missing activity", () => {
    const zeroWalking = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: CURRENT_MODEL_VERSION,
      sources: {
        days: [sourceDay(date, {
          walkingDistanceKm: 0,
          averageWalkingSpeedKmh: null,
          strengthTrainingMinutes: 0,
          workoutFeedObserved: true,
        })],
        snapshots: [],
        workIntervals: [],
        workouts: [],
      },
    })[0]!;
    const nullWalking = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: CURRENT_MODEL_VERSION,
      sources: {
        days: [sourceDay(date, {
          walkingDistanceKm: null,
          averageWalkingSpeedKmh: 5,
          strengthTrainingMinutes: 0,
          workoutFeedObserved: true,
        })],
        snapshots: [],
        workIntervals: [],
        workouts: [],
      },
    })[0]!;

    expect(zeroWalking.sourceQuality.status).toBe("complete");
    expect(zeroWalking.input.outsideWorkWalkingDistanceKm).toBe(0);
    expect(nullWalking.sourceQuality.status).toBe("missing-activity");
    expect(nullWalking.sourceQuality.issues).toContain("outsideWorkWalkingDistanceKm");
    expect(nullWalking.input.outsideWorkWalkingDistanceKm).toBeNull();
  });

  it("keeps v5 TDEE unchanged when v6 Garmin workouts are added", () => {
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

    expect(withWorkouts.input.workoutActivity).toBeUndefined();
    expect(v5With.workoutActivityKcalPerDay).toBeNull();
    expect(v5With.personalizedTdeeKcalPerDay).toBe(v5Without.personalizedTdeeKcalPerDay);
    expect(v5With.activityKcalPerDay).toBe(v5Without.activityKcalPerDay);
  });
});
