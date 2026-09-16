import { describe, expect, it } from "vitest";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import {
  CURRENT_MODEL_VERSION,
  LEGACY_PHYSIOLOGY_V5,
  usesWorkoutAwareActivity,
} from "@/modules/model-episodes/model-version";
import type { HistoricalModelSources } from "@/modules/model-episodes/model-episode.types";
import { sourceDay } from "./model-episode-fixtures";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";

const date = "2026-08-22";
const instant = (time: string) => new Date(`2026-08-22T${time}:00+02:00`);

function sources(
  override: Partial<HistoricalModelSources> = {},
): HistoricalModelSources {
  return {
    days: [sourceDay(date, {
      walkingDistanceKm: 5.0,
      strengthTrainingMinutes: 75,
    })],
    snapshots: [
      { id: 1, date, receivedAt: instant("07:55"), syncedAt: null, steps: 4_000,
        walkingDistanceKm: 3.0 },
      { id: 2, date, receivedAt: instant("08:05"), syncedAt: null, steps: 5_000,
        walkingDistanceKm: 3.6 },
      { id: 3, date, receivedAt: instant("16:00"), syncedAt: null, steps: 8_000,
        walkingDistanceKm: 5.0 },
    ],
    workIntervals: [{
      id: 1, date, startAt: instant("09:00"), endAt: instant("10:00"),
      timezone: "Europe/Bratislava", category: "standingLight", breakMinutes: 0,
    }],
    workouts: [
      {
        id: 1,
        date,
        externalId: "stair-1",
        type: STAIR_CLIMBING_TYPE,
        startAt: instant("08:00"),
        endAt: new Date("2026-08-22T08:10:00+02:00"),
        durationMinutes: 10,
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
    ],
    ...override,
  };
}

describe("model-version physiology gate", () => {
  it("publishes CURRENT_MODEL_VERSION as v6", () => {
    expect(CURRENT_MODEL_VERSION).toBe("bodycast-physiology-v6");
    expect(usesWorkoutAwareActivity(CURRENT_MODEL_VERSION)).toBe(true);
    expect(usesWorkoutAwareActivity(LEGACY_PHYSIOLOGY_V5)).toBe(false);
  });
});

describe("simulation-input-builder v5 vs v6", () => {
  it("ignores workouts and keeps old walking on bodycast-physiology-v5", () => {
    const fixture = sources({
      snapshots: [
        { id: 1, date, receivedAt: instant("08:00"), syncedAt: null, steps: 1_000,
          walkingDistanceKm: 1.0 },
        { id: 2, date, receivedAt: instant("09:00"), syncedAt: null, steps: 2_500,
          walkingDistanceKm: 2.0 },
        { id: 3, date, receivedAt: instant("10:00"), syncedAt: null, steps: 4_000,
          walkingDistanceKm: 3.0 },
        { id: 4, date, receivedAt: instant("18:00"), syncedAt: null, steps: 8_000,
          walkingDistanceKm: 5.0 },
      ],
      workIntervals: [{
        id: 1, date, startAt: instant("09:00"), endAt: instant("10:00"),
        timezone: "Europe/Bratislava", category: "standingLight", breakMinutes: 0,
      }],
    });
    const result = buildSimulationDays({
      from: date,
      to: date,
      sources: fixture,
      modelVersion: LEGACY_PHYSIOLOGY_V5,
    });
    expect(result[0].input.workoutActivity).toBeUndefined();
    expect(result[0].input.strengthTrainingMinutes).toBe(75);
    expect(result[0].sourceQuality.stairWalkingOverlap).toBeUndefined();
    expect(result[0].sourceQuality.workoutCount).toBeUndefined();
    expect(result[0].sourceQuality.workWalkingDistanceKm).toBeCloseTo(1.0, 12);
    expect(result[0].input.outsideWorkWalkingDistanceKm).toBeCloseTo(4.0, 12);
    expect(result[0].sourceQuality.sourceObservationFields).not.toContain("workouts");
  });

  it("enables workout path and stair overlap subtraction on bodycast-physiology-v6", () => {
    // Fixture: daily walking 5.0, reconstructed work walking 1.0, stair overlap 0.6
    // → remaining outside-work walking 3.4.
    const fixture = sources({
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
          id: 1,
          date,
          externalId: "stair-1",
          type: STAIR_CLIMBING_TYPE,
          startAt: new Date("2026-08-22T12:30:00+02:00"),
          endAt: new Date("2026-08-22T12:35:00+02:00"),
          durationMinutes: 5,
          energyKcal: null,
          activeEnergyKcal: 154,
        },
        {
          id: 2,
          date,
          externalId: "strength-1",
          type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
          startAt: instant("17:00"),
          endAt: new Date("2026-08-22T18:15:00+02:00"),
          durationMinutes: 75,
          energyKcal: null,
          activeEnergyKcal: 562,
        },
      ],
    });

    const result = buildSimulationDays({
      from: date,
      to: date,
      sources: fixture,
      modelVersion: CURRENT_MODEL_VERSION,
    });

    expect(result[0].sourceQuality.workWalkingDistanceKm).toBeCloseTo(1.0, 12);
    expect(result[0].sourceQuality.stairWalkingOverlap?.[0]?.overlapApplied).toBe(true);
    expect(result[0].sourceQuality.stairWalkingOverlap?.[0]?.reason).toBe("applied");
    expect(result[0].sourceQuality.stairWalkingOverlap?.[0]?.overlapDistanceAppliedKm)
      .toBeCloseTo(0.6, 12);
    expect(result[0].input.outsideWorkWalkingDistanceKm).toBeCloseTo(3.4, 12);
    expect(result[0].input.strengthTrainingMinutes).toBe(0);
    expect(result[0].input.workoutActivity?.events).toHaveLength(2);
    expect(result[0].input.workoutActivity?.events.map((event) => event.activeEnergyKcal))
      .toEqual([154, 562]);
    expect(result[0].sourceQuality.workoutCount).toBe(2);
    expect(result[0].sourceQuality.sourceObservationFields).toContain("workouts");
  });

  it("defaults to the legacy v5 path when modelVersion is omitted", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      sources: sources(),
    });
    expect(result[0].input.workoutActivity).toBeUndefined();
    expect(result[0].input.strengthTrainingMinutes).toBe(75);
  });
});
