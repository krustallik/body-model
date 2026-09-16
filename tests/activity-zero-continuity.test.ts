import { describe, expect, it } from "vitest";
import { missingPhysiologicalTransitionFields } from "@/model/physiological-simulator";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { sourceDay } from "./model-episode-fixtures";
import type { HistoricalModelSources } from "@/modules/model-episodes/model-episode.types";

const date = "2026-09-16";

function sources(override: Partial<HistoricalModelSources> = {}): HistoricalModelSources {
  return {
    days: [sourceDay(date)],
    snapshots: [],
    workIntervals: [],
    workouts: [],
    ...override,
  };
}

describe("activity missing/zero continuity", () => {
  it("completes a v6 rest day when workout feed was observed and strength is missing", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: "bodycast-physiology-v6",
      sources: sources({
        days: [sourceDay(date, {
          strengthTrainingMinutes: null,
          workoutFeedObserved: true,
          walkingDistanceKm: 5,
        })],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("complete");
    expect(result[0].input.strengthTrainingMinutes).toBe(0);
    expect(missingPhysiologicalTransitionFields(result[0].input, "hold-ecf")).toEqual([]);
  });

  it("completes stair-only day without legacy strength minutes when feed observed", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: "bodycast-physiology-v6",
      sources: sources({
        days: [sourceDay(date, {
          strengthTrainingMinutes: null,
          workoutFeedObserved: true,
        })],
        workouts: [{
          id: 1,
          date,
          externalId: "stair-1",
          type: "Stair Climbing",
          startAt: new Date(`${date}T08:00:00.000Z`),
          endAt: new Date(`${date}T09:00:00.000Z`),
          durationMinutes: 60,
          energyKcal: null,
          activeEnergyKcal: 150,
        }],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("complete");
    expect(result[0].input.strengthTrainingMinutes).toBe(0);
    expect(result[0].input.workoutActivity?.events).toHaveLength(1);
  });

  it("keeps unknown strength when workout feed was unavailable", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: "bodycast-physiology-v6",
      sources: sources({
        days: [sourceDay(date, {
          strengthTrainingMinutes: null,
          workoutFeedObserved: false,
        })],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("missing-activity");
    expect(result[0].sourceQuality.issues).toContain("strengthTrainingMinutes");
    expect(missingPhysiologicalTransitionFields(result[0].input, "hold-ecf"))
      .toContain("strengthTrainingMinutes");
  });

  it("keeps legacy null unknown when coverage provenance is absent", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: "bodycast-physiology-v6",
      sources: sources({
        days: [sourceDay(date, {
          strengthTrainingMinutes: null,
          workoutFeedObserved: null,
        })],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("missing-activity");
  });

  it("uses observed legacy strength zero when feed unavailable", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: "bodycast-physiology-v6",
      sources: sources({
        days: [sourceDay(date, {
          strengthTrainingMinutes: 0,
          workoutFeedObserved: false,
        })],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("complete");
    expect(result[0].input.strengthTrainingMinutes).toBe(0);
  });

  it("treats walking distance zero as complete without requiring speed", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: "bodycast-physiology-v6",
      sources: sources({
        days: [sourceDay(date, {
          walkingDistanceKm: 0,
          averageWalkingSpeedKmh: null,
          strengthTrainingMinutes: 0,
          workoutFeedObserved: true,
        })],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("complete");
    expect(result[0].input.outsideWorkWalkingDistanceKm).toBe(0);
    expect(missingPhysiologicalTransitionFields(result[0].input, "hold-ecf")).toEqual([]);
  });

  it("does not reinterpret historical null strength under v5", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: "bodycast-physiology-v5",
      sources: sources({
        days: [sourceDay(date, {
          strengthTrainingMinutes: null,
          workoutFeedObserved: true,
        })],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("missing-activity");
    expect(result[0].input.strengthTrainingMinutes).toBeNull();
  });

  it("uses explicit Traditional Strength Training when present", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: "bodycast-physiology-v6",
      sources: sources({
        days: [sourceDay(date, {
          strengthTrainingMinutes: null,
          workoutFeedObserved: true,
        })],
        workouts: [{
          id: 2,
          date,
          externalId: "strength-1",
          type: "traditional Strength Training",
          startAt: new Date(`${date}T18:00:00.000Z`),
          endAt: new Date(`${date}T19:00:00.000Z`),
          durationMinutes: 60,
          energyKcal: null,
          activeEnergyKcal: 220,
        }],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("complete");
    expect(result[0].input.strengthTrainingMinutes).toBe(0);
    expect(result[0].input.workoutActivity?.events[0]?.classification)
      .toBe("traditional-strength-training");
  });

  it("marks walking distance absent as unknown activity", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: "bodycast-physiology-v6",
      sources: sources({
        days: [sourceDay(date, {
          walkingDistanceKm: null,
          averageWalkingSpeedKmh: 5,
          strengthTrainingMinutes: 0,
          workoutFeedObserved: true,
        })],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("missing-activity");
    expect(result[0].sourceQuality.issues).toContain("outsideWorkWalkingDistanceKm");
  });

  it("requires walking speed only when walking distance is positive", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: "bodycast-physiology-v6",
      sources: sources({
        days: [sourceDay(date, {
          walkingDistanceKm: 5,
          averageWalkingSpeedKmh: null,
          strengthTrainingMinutes: 0,
          workoutFeedObserved: true,
        })],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("missing-activity");
    expect(result[0].sourceQuality.issues).toContain("averageWalkingSpeedKmh");
  });

  it("does not let a later day's observed feed reinterpret an older unknown day", () => {
    const older = "2026-09-10";
    const newer = "2026-09-20";
    const result = buildSimulationDays({
      from: older,
      to: newer,
      modelVersion: "bodycast-physiology-v6",
      sources: {
        days: [
          sourceDay(older, {
            strengthTrainingMinutes: null,
            workoutFeedObserved: null,
          }),
          sourceDay(newer, {
            strengthTrainingMinutes: null,
            workoutFeedObserved: true,
          }),
        ],
        snapshots: [],
        workIntervals: [],
        workouts: [{
          id: 3,
          date: newer,
          externalId: "stair-new",
          type: "Stair Climbing",
          startAt: new Date(`${newer}T08:00:00.000Z`),
          endAt: new Date(`${newer}T09:00:00.000Z`),
          durationMinutes: 60,
          energyKcal: null,
          activeEnergyKcal: 100,
        }],
      },
    });
    const olderDay = result.find((day) => day.input.date === older);
    const newerDay = result.find((day) => day.input.date === newer);
    expect(olderDay?.sourceQuality.status).toBe("missing-activity");
    expect(olderDay?.input.strengthTrainingMinutes).toBeNull();
    expect(newerDay?.sourceQuality.status).toBe("complete");
    expect(newerDay?.input.strengthTrainingMinutes).toBe(0);
  });
});
