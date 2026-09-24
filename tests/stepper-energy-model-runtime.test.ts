import { describe, expect, it } from "vitest";
import { resolveExplicitWorkoutActivityKcal } from "@/model/activity/workout-energy";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { CURRENT_MODEL_VERSION } from "@/modules/model-episodes/model-version";
import type { HistoricalModelSources } from "@/modules/model-episodes/model-episode.types";
import { sourceDay } from "./model-episode-fixtures";

const date = "2026-09-23";
const startAt = new Date("2026-09-23T18:00:00+02:00");
const endAt = new Date("2026-09-23T18:10:00+02:00");

function sources(): HistoricalModelSources {
  return {
    days: [sourceDay(date, { weightKg: 75, walkingDistanceKm: 0, averageWalkingSpeedKmh: 5, strengthTrainingMinutes: 0 })],
    snapshots: [],
    activityIntervals: [{
      id: 7,
      date,
      metric: "steps",
      startAt,
      endAt,
      value: 750,
    }],
    workIntervals: [],
    workouts: [{
      id: 61,
      date,
      externalId: "health-session-61",
      type: "Stair Climbing",
      startAt,
      endAt,
      durationMinutes: 10,
      energyKcal: null,
      activeEnergyKcal: 356,
    }],
    heartRateSamples: [
      { date, timestamp: new Date(startAt.getTime() + 1_000), bpm: 122, source: "garmin-connect" },
      { date, timestamp: new Date(startAt.getTime() + 300_000), bpm: 137, source: "garmin-connect" },
      { date, timestamp: new Date(endAt.getTime() - 1_000), bpm: 149, source: "garmin-connect" },
    ],
  };
}

describe("versioned stepper energy in historical model runtime", () => {
  it("loads temporal HR and interval steps onto the v7 production workout event", () => {
    const [day] = buildSimulationDays({ from: date, to: date, sources: sources(), modelVersion: CURRENT_MODEL_VERSION });
    const event = day.input.workoutActivity?.events[0];
    expect(event?.stepperEvidence?.bracketedSteps).toMatchObject({
      availability: "available",
      derivedStepDelta: { value: 750, provenance: "health-step-interval-overlap" },
      derivedStepRatePerMinute: { value: 75 },
    });
    expect(event?.stepperEvidence?.workoutEnergy.heartRate).toMatchObject({
      availability: "loaded",
      sampleCount: 3,
      summary: { sampleMeanBpm: 136 },
    });
  });

  it("uses BodyCast mechanical active kcal in TDEE when HR lacks personal calibration", () => {
    const [day] = buildSimulationDays({ from: date, to: date, sources: sources(), modelVersion: CURRENT_MODEL_VERSION });
    const events = day.input.workoutActivity!.events;
    const result = resolveExplicitWorkoutActivityKcal({
      events,
      weightKg: 75,
      rmrKcalPerDay: 1_800,
    });
    const perEvent = result.perEvent[0];
    expect(perEvent.source).toBe("mechanical-stepper");
    expect(perEvent.kcal).toBe(perEvent.stepperEnergy?.mechanicalBaseline.estimatedActiveKcal);
    expect(perEvent.kcal).not.toBe(356);
    expect(result.deviceActiveEnergyKcal).toBe(0);
    expect(result.workoutActivityKcal).toBe(perEvent.kcal);
    expect(perEvent.stepperEnergy?.heartRate.decisionReason).toBe("no-personal-ms100-calibration");
  });

  it("deduplicates stair-time walking distance when BodyCast has steps but Garmin kcal is absent", () => {
    const input = sources();
    input.days = [sourceDay(date, { weightKg: 75, walkingDistanceKm: 0.8, averageWalkingSpeedKmh: 5, strengthTrainingMinutes: 0 })];
    input.activityIntervals = [
      ...(input.activityIntervals ?? []),
      { id: 8, date, metric: "walking-distance-km", startAt, endAt, value: 0.8 },
    ];
    input.workouts = input.workouts!.map((workout) => ({ ...workout, activeEnergyKcal: null }));

    const [day] = buildSimulationDays({ from: date, to: date, sources: input, modelVersion: CURRENT_MODEL_VERSION });
    const event = day!.input.workoutActivity!.events[0]!;
    const energy = resolveExplicitWorkoutActivityKcal({
      events: [event],
      weightKg: 75,
      rmrKcalPerDay: 1_800,
    });

    expect(event.stepperEvidence?.bracketedSteps.availability).toBe("available");
    expect(energy.perEvent[0]?.source).toBe("mechanical-stepper");
    expect(energy.workoutActivityKcal).toBeGreaterThan(0);
    expect(energy.deviceActiveEnergyKcal).toBe(0);
    expect(day!.sourceQuality.stairWalkingOverlap?.[0]).toMatchObject({
      overlapApplied: true,
      overlapDistanceAppliedKm: 0.8,
      activeEnergyKcal: null,
    });
    expect(day!.input.outsideWorkWalkingDistanceKm).toBeCloseTo(0, 12);
  });

  it("uses Garmin only when stepper evidence is unavailable and keeps walking if both sources are unavailable", () => {
    const base = sources();
    base.days = [sourceDay(date, { weightKg: 75, walkingDistanceKm: 0.8, averageWalkingSpeedKmh: 5, strengthTrainingMinutes: 0 })];
    base.activityIntervals = [{ id: 80, date, metric: "walking-distance-km", startAt, endAt, value: 0.8 }];

    const withGarmin = buildSimulationDays({ from: date, to: date, sources: base, modelVersion: CURRENT_MODEL_VERSION })[0]!;
    const fallback = resolveExplicitWorkoutActivityKcal({
      events: withGarmin.input.workoutActivity!.events,
      weightKg: 75,
      rmrKcalPerDay: 1_800,
    });
    expect(withGarmin.input.workoutActivity?.events[0]?.stepperEvidence?.bracketedSteps.availability).toBe("unavailable");
    expect(fallback.perEvent[0]).toMatchObject({ source: "device-active-kcal", kcal: 356 });
    expect(fallback.workoutActivityKcal).toBe(356);
    expect(fallback.bodyCastStepperActiveEnergyKcal).toBe(0);
    expect(withGarmin.input.outsideWorkWalkingDistanceKm).toBeCloseTo(0, 12);

    base.workouts = base.workouts!.map((workout) => ({ ...workout, activeEnergyKcal: null }));
    const withoutEither = buildSimulationDays({ from: date, to: date, sources: base, modelVersion: CURRENT_MODEL_VERSION })[0]!;
    const unavailable = resolveExplicitWorkoutActivityKcal({
      events: withoutEither.input.workoutActivity!.events,
      weightKg: 75,
      rmrKcalPerDay: 1_800,
    });
    expect(unavailable.perEvent[0]?.source).toBe("none");
    expect(unavailable.workoutActivityKcal).toBe(0);
    expect(withoutEither.input.outsideWorkWalkingDistanceKm).toBeCloseTo(0.8, 12);
  });

  it("does not remove positive walking distance when observed step count yields zero stepper kcal", () => {
    const input = sources();
    input.days = [sourceDay(date, { weightKg: 75, walkingDistanceKm: 0.8, averageWalkingSpeedKmh: 5, strengthTrainingMinutes: 0 })];
    input.activityIntervals = [
      { id: 81, date, metric: "steps", startAt, endAt, value: 0 },
      { id: 82, date, metric: "walking-distance-km", startAt, endAt, value: 0.8 },
    ];
    input.workouts = input.workouts!.map((workout) => ({ ...workout, activeEnergyKcal: 356 }));

    const built = buildSimulationDays({ from: date, to: date, sources: input, modelVersion: CURRENT_MODEL_VERSION })[0]!;
    const resolution = resolveExplicitWorkoutActivityKcal({
      events: built.input.workoutActivity!.events,
      weightKg: 75,
      rmrKcalPerDay: 1_800,
    });

    expect(resolution.perEvent[0]).toMatchObject({ source: "mechanical-stepper", kcal: 0 });
    expect(built.input.outsideWorkWalkingDistanceKm).toBeCloseTo(0.8, 12);
  });

  it("scales partial timed steps and leaves missing or sparse HR out of kcal selection", () => {
    const input = sources();
    input.activityIntervals = [{
      id: 83,
      date,
      metric: "steps",
      startAt,
      endAt: new Date(startAt.getTime() + 5 * 60_000),
      value: 300,
    }];
    input.heartRateSamples = [
      { date, timestamp: new Date(startAt.getTime() + 2 * 60_000), bpm: 138, source: "garmin-connect" },
    ];

    const built = buildSimulationDays({ from: date, to: date, sources: input, modelVersion: CURRENT_MODEL_VERSION })[0]!;
    const event = built.input.workoutActivity!.events[0]!;
    const resolution = resolveExplicitWorkoutActivityKcal({ events: [event], weightKg: 75, rmrKcalPerDay: 1_800 });
    const evidence = event.stepperEvidence!;

    expect(evidence.bracketedSteps).toMatchObject({
      availability: "available",
      intervalCoveragePercent: 50,
      observedIntervalStepCount: 300,
      derivedStepDelta: { value: 600, provenance: "duration-scaled-partial-health-step-interval" },
    });
    expect(evidence.workoutEnergy.heartRate).toMatchObject({ availability: "loaded", sampleCount: 1 });
    expect(resolution.perEvent[0]?.source).toBe("mechanical-stepper");
    expect(resolution.perEvent[0]?.stepperEnergy?.heartRate.quality).toBe("context-only");
  });

  it("removes only workout-overlap walking on both sides of a calendar boundary", () => {
    const nextDate = "2026-09-24";
    const beforeStart = new Date("2026-09-23T23:40:00Z");
    const midnight = new Date("2026-09-24T00:00:00Z");
    const afterEnd = new Date("2026-09-24T00:20:00Z");
    const input = sources();
    input.days = [
      sourceDay(date, { weightKg: 75, walkingDistanceKm: 0.4, averageWalkingSpeedKmh: 5, strengthTrainingMinutes: 0 }),
      sourceDay(nextDate, { weightKg: 75, walkingDistanceKm: 0.5, averageWalkingSpeedKmh: 5, strengthTrainingMinutes: 0 }),
    ];
    input.workouts = [{
      id: 72,
      date,
      externalId: "cross-midnight-stepper",
      type: "Stair Climbing",
      startAt: new Date("2026-09-23T23:50:00Z"),
      endAt: new Date("2026-09-24T00:10:00Z"),
      durationMinutes: 20,
      energyKcal: null,
      activeEnergyKcal: null,
    }];
    input.activityIntervals = [
      { id: 70, date, metric: "walking-distance-km", startAt: beforeStart, endAt: new Date("2026-09-23T23:50:00Z"), value: 0.1 },
      { id: 71, date, metric: "walking-distance-km", startAt: new Date("2026-09-23T23:50:00Z"), endAt: midnight, value: 0.3 },
      { id: 72, date, metric: "steps", startAt: new Date("2026-09-23T23:50:00Z"), endAt: midnight, value: 100 },
      { id: 73, date: nextDate, metric: "walking-distance-km", startAt: midnight, endAt: new Date("2026-09-24T00:10:00Z"), value: 0.2 },
      { id: 74, date: nextDate, metric: "walking-distance-km", startAt: new Date("2026-09-24T00:10:00Z"), endAt: afterEnd, value: 0.3 },
      { id: 75, date: nextDate, metric: "steps", startAt: midnight, endAt: new Date("2026-09-24T00:10:00Z"), value: 100 },
    ];
    input.heartRateSamples = [];

    const days = buildSimulationDays({ from: date, to: nextDate, sources: input, modelVersion: CURRENT_MODEL_VERSION });
    const workoutDay = days[0]!;
    const afterMidnightDay = days[1]!;

    expect(workoutDay.input.workoutActivity?.events[0]?.stepperEvidence?.bracketedSteps).toMatchObject({
      availability: "available",
      derivedStepDelta: { value: 200 },
      intervalCoveragePercent: 100,
    });
    expect(workoutDay.input.outsideWorkWalkingDistanceKm).toBeCloseTo(0.1, 12);
    expect(afterMidnightDay.input.workoutActivity?.events).toEqual([]);
    expect(afterMidnightDay.sourceQuality.stairWalkingOverlap?.[0]).toMatchObject({
      overlapApplied: true,
      overlapDistanceAppliedKm: 0.2,
      activeEnergyKcal: null,
    });
    expect(afterMidnightDay.input.outsideWorkWalkingDistanceKm).toBeCloseTo(0.3, 12);
  });

  it("preserves v6 device-only semantics while the new version is active", () => {
    const [day] = buildSimulationDays({ from: date, to: date, sources: sources(), modelVersion: "bodycast-physiology-v6" });
    const event = day.input.workoutActivity!.events[0];
    expect(event.stepperEvidence).toBeUndefined();
    expect(resolveExplicitWorkoutActivityKcal({ events: [event], weightKg: 75, rmrKcalPerDay: 1_800 }).perEvent[0].source)
      .toBe("device-active-kcal");
  });
});
