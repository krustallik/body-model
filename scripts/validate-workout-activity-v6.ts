/**
 * Targeted BodyCast physiology v6 workout-activity validation.
 * Development set only — does not reuse v5 untouched holdout seeds 1001–1010.
 *
 * Run: .\node_modules\.bin\tsx.cmd scripts/validate-workout-activity-v6.ts
 */
import { calculateDynamicDailyExpenditure } from "../src/model/dynamic-daily-expenditure";
import { calculateWalkingActivity } from "../src/model/activity/walking";
import {
  canonicalizeWorkoutType,
  resolveExplicitWorkoutActivityKcal,
} from "../src/model/activity/workout-energy";
import { reconstructStairWalkingOverlap } from "../src/model/activity/stair-walking-overlap";
import { createDynamicRmrParameters } from "../src/model/dynamic-rmr";
import { expandTrainingWorkoutFields } from "../src/modules/health/expand-training-workouts";
import { buildSimulationDays } from "../src/modules/model-episodes/simulation-input-builder";
import type { HistoricalModelSources } from "../src/modules/model-episodes/model-episode.types";

type ScenarioResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const body = {
  fatMassKg: 20,
  leanTissueKg: 40,
  glycogenKg: 0.5,
  baselineExtracellularFluidLiters: 15,
  extracellularFluidDeviationLiters: 0,
};
const rmrParameters = createDynamicRmrParameters({
  initialRmrKcalPerDay: 1600,
  initialFatMassKg: 20,
  initialLeanTissueKg: 40,
});

function assertClose(actual: number, expected: number, tolerance = 1e-6): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function workoutEvent(input: {
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
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

function scenarioStrengthGarmin(): ScenarioResult {
  const resolved = resolveExplicitWorkoutActivityKcal({
    events: [workoutEvent({
      type: "Traditional Strength Training",
      startAt: "2026-09-15T16:00:00.000Z",
      endAt: "2026-09-15T17:00:00.000Z",
      durationMinutes: 60,
      activeEnergyKcal: 562,
    })],
    weightKg: 80,
    rmrKcalPerDay: 1600,
  });
  const ok = resolved.workoutActivityKcal === 562
    && resolved.deviceActiveEnergyKcal === 562
    && resolved.strengthMetFallbackKcal === 0;
  return {
    name: "strength-garmin-kcal",
    ok,
    detail: `workout=${resolved.workoutActivityKcal}`,
  };
}

function scenarioStrengthMetFallback(): ScenarioResult {
  const resolved = resolveExplicitWorkoutActivityKcal({
    events: [workoutEvent({
      type: "Traditional Strength Training",
      startAt: "2026-09-15T16:00:00.000Z",
      endAt: "2026-09-15T17:00:00.000Z",
      durationMinutes: 60,
      activeEnergyKcal: null,
    })],
    weightKg: 80,
    rmrKcalPerDay: 1600,
  });
  const ok = resolved.deviceActiveEnergyKcal === 0
    && resolved.strengthMetFallbackKcal > 0
    && resolved.perEvent[0]?.source === "strength-met-fallback";
  return {
    name: "strength-met-fallback",
    ok,
    detail: `fallback=${resolved.strengthMetFallbackKcal}`,
  };
}

function scenarioStairOverlap(): ScenarioResult {
  const day = new Date("2026-09-15T00:00:00.000Z");
  const before = new Date(day.getTime() + 10 * 3600_000);
  const after = new Date(day.getTime() + 11 * 3600_000);
  const overlap = reconstructStairWalkingOverlap({
    snapshots: [
      { timestamp: before, steps: 1000, walkingDistanceKm: 2.0 },
      { timestamp: after, steps: 1600, walkingDistanceKm: 2.6 },
    ],
    stairWorkouts: [{
      startAt: new Date(before.getTime() + 60_000),
      endAt: new Date(after.getTime() - 60_000),
      activeEnergyKcal: 154,
    }],
  });
  // The workout spans 58 of the 60 minutes bracketed by the cumulative
  // snapshots, so the snapshot-derived distance is apportioned by time.
  const expectedOverlapKm = 0.6 * (58 / 60);
  const ok = assertClose(overlap.overlapDistanceKm, expectedOverlapKm, 1e-9)
    && overlap.diagnostics[0]?.reason === "applied";
  return {
    name: "stair-kcal-known-overlap",
    ok,
    detail: `overlapKm=${overlap.overlapDistanceKm} expected=${expectedOverlapKm}`,
  };
}

function scenarioStairWithoutSnapshots(): ScenarioResult {
  const overlap = reconstructStairWalkingOverlap({
    snapshots: [],
    stairWorkouts: [{
      startAt: new Date("2026-09-15T10:00:00.000Z"),
      endAt: new Date("2026-09-15T10:30:00.000Z"),
      activeEnergyKcal: 154,
    }],
  });
  const resolved = resolveExplicitWorkoutActivityKcal({
    events: [workoutEvent({
      type: "Stair Climbing",
      startAt: "2026-09-15T10:00:00.000Z",
      endAt: "2026-09-15T10:30:00.000Z",
      durationMinutes: 30,
      activeEnergyKcal: 154,
    })],
    weightKg: 80,
    rmrKcalPerDay: 1600,
  });
  const ok = overlap.overlapDistanceKm === 0
    && resolved.workoutActivityKcal === 154;
  return {
    name: "stair-without-snapshots",
    ok,
    detail: `kcal=${resolved.workoutActivityKcal} overlap=${overlap.overlapDistanceKm}`,
  };
}

function scenarioRealisticGarminChain(): ScenarioResult {
  const expanded = expandTrainingWorkoutFields({
    trainingType: "Stair Climbing\nStair Climbing\nTraditional Strength Training",
    trainingActiveKcal: "154\n18\n562",
    trainingTimestamps: [
      "2026-09-15T08:00:00.000Z",
      "2026-09-15T12:00:00.000Z",
      "2026-09-15T16:00:00.000Z",
      "2026-09-15T08:20:00.000Z",
      "2026-09-15T12:10:00.000Z",
      "2026-09-15T17:00:00.000Z",
    ].join("\n"),
    dayDate: "2026-09-15",
    timezone: "UTC",
  });
  const workoutSum = expanded.workouts.reduce(
    (total, workout) => total + (workout.activeEnergyKcal ?? 0),
    0,
  );
  const remainingWalkingKm = Math.max(0, 5.0 - 1.0 - 0.6);
  const walkingKcal = calculateWalkingActivity({
    weightKg: 80,
    rmrKcalPerDay: 1600,
    distanceKm: remainingWalkingKm,
    averageSpeedKmh: 5,
  });
  const expenditure = calculateDynamicDailyExpenditure({
    bodyComposition: body,
    rmrParameters,
    macros: { proteinG: 150, carbsG: 250, fatG: 70 },
    outsideWorkWalking: { distanceKm: remainingWalkingKm, averageSpeedKmh: 5 },
    strength: { durationMinutes: 60 },
    workoutActivity: {
      events: expanded.workouts.map((workout) => workoutEvent({
        type: workout.type,
        startAt: workout.startAt,
        endAt: workout.endAt,
        durationMinutes: workout.durationMinutes,
        activeEnergyKcal: workout.activeEnergyKcal,
      })),
    },
    occupational: { category: "standingLight", durationHours: 0 },
    adaptiveThermogenesisKcalPerDay: 0,
    personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1.1 },
  });
  const ok = expanded.workouts.length === 3
    && workoutSum === 734
    && remainingWalkingKm === 3.4
    && walkingKcal !== null
    && expenditure.workoutActivityKcalPerDay === 734
    && expenditure.activityCalibration === 1.1
    && expenditure.calibratedActivityKcalPerDay !== null
    && assertClose(
      expenditure.calibratedActivityKcalPerDay!,
      expenditure.activityKcalPerDay! * 1.1,
    );
  return {
    name: "realistic-garmin-154-18-562",
    ok,
    detail: `workouts=${expanded.workouts.length} sum=${workoutSum} remainingKm=${remainingWalkingKm} raw=${expenditure.activityKcalPerDay} cal=${expenditure.calibratedActivityKcalPerDay}`,
  };
}

function scenarioV5Regression(): ScenarioResult {
  const sources: HistoricalModelSources = {
    days: [{
      date: "2026-09-15",
      weightKg: 80,
      bodyFatPercent: 20,
      caloriesKcal: 2400,
      proteinG: 150,
      fatG: 70,
      carbsG: 250,
      averageWalkingSpeedKmh: 5,
      walkingDistanceKm: 5,
      strengthTrainingMinutes: 45,
      workoutFeedObserved: null,
    }],
    snapshots: [],
    workIntervals: [],
    workouts: [{
      id: 1,
      date: "2026-09-15",
      externalId: null,
      type: "Traditional Strength Training",
      startAt: new Date("2026-09-15T16:00:00.000Z"),
      endAt: new Date("2026-09-15T17:00:00.000Z"),
      durationMinutes: 60,
      energyKcal: null,
      activeEnergyKcal: 562,
    }],
  };
  const v5 = buildSimulationDays({
    from: "2026-09-15",
    to: "2026-09-15",
    sources,
    modelVersion: "bodycast-physiology-v5",
  });
  const ok = v5[0]?.input.strengthTrainingMinutes === 45
    && v5[0]?.input.workoutActivity === undefined
    && v5[0]?.input.outsideWorkWalkingDistanceKm === 5;
  return {
    name: "legacy-v5-regression",
    ok,
    detail: `strengthMinutes=${v5[0]?.input.strengthTrainingMinutes} hasWorkoutActivity=${v5[0]?.input.workoutActivity !== undefined}`,
  };
}

function scenarioDeviceSensitivity(): ScenarioResult {
  const nominal = 562;
  const impacts: number[] = [];
  for (const scale of [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3]) {
    const result = calculateDynamicDailyExpenditure({
      bodyComposition: body,
      rmrParameters,
      macros: { proteinG: 150, carbsG: 250, fatG: 70 },
      outsideWorkWalking: { distanceKm: 3.4, averageSpeedKmh: 5 },
      strength: { durationMinutes: 0 },
      workoutActivity: {
        events: [workoutEvent({
          type: "Traditional Strength Training",
          startAt: "2026-09-15T16:00:00.000Z",
          endAt: "2026-09-15T17:00:00.000Z",
          durationMinutes: 60,
          activeEnergyKcal: nominal * scale,
        })],
      },
      occupational: { category: "standingLight", durationHours: 0 },
      adaptiveThermogenesisKcalPerDay: 0,
      personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
    });
    impacts.push(result.personalizedTdeeKcalPerDay ?? Number.NaN);
  }
  const ok = impacts.every((value) => Number.isFinite(value))
    && impacts[3]! > impacts[0]!
    && impacts[6]! > impacts[3]!;
  return {
    name: "device-sensitivity-minus30-to-plus30",
    ok,
    detail: `tdee=[${impacts.map((value) => value.toFixed(1)).join(", ")}]`,
  };
}

const scenarios = [
  scenarioStrengthGarmin,
  scenarioStrengthMetFallback,
  scenarioStairOverlap,
  scenarioStairWithoutSnapshots,
  scenarioRealisticGarminChain,
  scenarioV5Regression,
  scenarioDeviceSensitivity,
];

let failed = 0;
for (const run of scenarios) {
  const result = run();
  const mark = result.ok ? "PASS" : "FAIL";
  console.log(`${mark} ${result.name} — ${result.detail}`);
  if (!result.ok) failed += 1;
}

console.log(`\nTargeted v6 validation: ${scenarios.length - failed}/${scenarios.length} passed`);
if (failed > 0) process.exit(1);
