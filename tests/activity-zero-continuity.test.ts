import { describe, expect, it } from "vitest";
import { missingPhysiologicalTransitionFields } from "@/model/physiological-simulator";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { analyzeStateContinuity } from "@/modules/model-episodes/unknown-intervals";
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

  it("treats an absent strength record as a rest day when workout feed was unavailable", () => {
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
    expect(result[0].sourceQuality.status).toBe("complete");
    expect(result[0].input.strengthTrainingMinutes).toBe(0);
    expect(missingPhysiologicalTransitionFields(result[0].input, "hold-ecf"))
      .not.toContain("strengthTrainingMinutes");
  });

  it("treats an absent strength record as rest even when feed provenance is absent", () => {
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
    expect(result[0].sourceQuality.status).toBe("complete");
    expect(result[0].input.strengthTrainingMinutes).toBe(0);
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

  it("does not block on missing walking speed when a recent personal value exists", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      modelVersion: "bodycast-physiology-v6",
      sources: sources({
        days: [
          sourceDay("2026-09-14", { averageWalkingSpeedKmh: 4.8 }),
          sourceDay("2026-09-15", { averageWalkingSpeedKmh: 5.2 }),
          sourceDay(date, { walkingDistanceKm: 5, averageWalkingSpeedKmh: null,
            strengthTrainingMinutes: 0, workoutFeedObserved: true }),
        ],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("complete");
    expect(result[0].input.averageWalkingSpeedKmh).toBe(5);
    expect(result[0].sourceQuality.issues).not.toContain("averageWalkingSpeedKmh");
  });

  it("does not require a workout feed to keep a multi-day rest sequence continuous", () => {
    const older = "2026-09-10";
    const newer = "2026-09-20";
    const result = buildSimulationDays({
      from: older,
      to: newer,
      modelVersion: "bodycast-physiology-v6",
      sources: {
        days: Array.from({ length: 11 }, (_, index) => {
          const current = `2026-09-${String(10 + index).padStart(2, "0")}`;
          return sourceDay(current, { strengthTrainingMinutes: null, workoutFeedObserved: index % 2 === 0 });
        }),
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
    const continuity = analyzeStateContinuity(result, "hold-ecf");
    expect(continuity.resolvedDays).toHaveLength(11);
    expect(continuity.unknownIntervals).toEqual([]);
    expect(result.find((day) => day.input.date === older)?.input.strengthTrainingMinutes).toBe(0);
    expect(result.find((day) => day.input.date === newer)?.input.strengthTrainingMinutes).toBe(0);
  });
});
