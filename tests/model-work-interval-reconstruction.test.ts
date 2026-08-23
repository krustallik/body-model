import { describe, expect, it } from "vitest";
import {
  DEFAULT_SNAPSHOT_MAX_GAP_MINUTES,
  estimateCumulativeMetricAtTime,
  estimateDailyWorkWalking,
  estimateWorkIntervalWalking,
  type CumulativeSnapshot,
} from "@/model/work-interval-reconstruction";

const at = (time: string) => new Date(`2026-08-23T${time}:00Z`);
const snapshot = (
  time: string,
  steps: number | null,
  walkingDistanceKm: number | null,
): CumulativeSnapshot => ({ timestamp: at(time), steps, walkingDistanceKm });

describe("cumulative snapshot boundary estimation", () => {
  it("uses an exact boundary snapshot", () => {
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("08:00", 1_200, 0.8)],
      targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: 1_200, gapMinutes: 0, method: "exact" });
  });

  it("linearly interpolates between close surrounding snapshots", () => {
    const result = estimateCumulativeMetricAtTime({
      snapshots: [snapshot("07:45", 1_000, 0.7), snapshot("08:15", 1_300, 0.9)],
      targetTime: at("08:00"), metric: "steps",
    });
    expect(result).toMatchObject({ value: 1_150, gapMinutes: 15, method: "interpolated" });
    expect("sourceTimes" in result && result.sourceTimes).toHaveLength(2);
  });

  it("uses the nearest snapshot when interpolation is unavailable", () => {
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("08:05", 1_200, 0.8)],
      targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: 1_200, gapMinutes: 5, method: "nearest" });
  });

  it("uses the 45-minute default boundary gap", () => {
    expect(DEFAULT_SNAPSHOT_MAX_GAP_MINUTES).toBe(45);
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("08:40", 1_200, 0.8)],
      targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: 1_200, gapMinutes: 40, method: "nearest" });
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("08:46", 1_200, 0.8)],
      targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: null, reason: "gap-too-large" });
  });

  it("reports missing data and excessive gaps", () => {
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("08:00", null, 0.8)], targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: null, reason: "insufficient-data" });
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("07:00", 100, 0.1)], targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: null, reason: "gap-too-large" });
  });

  it("reports a decreasing counter across interpolation", () => {
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("07:45", 1_300, 0.9), snapshot("08:15", 1_000, 0.7)],
      targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: null, reason: "counter-decreased" });
  });

  it("preserves explicit zero", () => {
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("08:00", 0, 0)], targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: 0, method: "exact" });
  });

  it.each([
    { maxGapMinutes: -1 },
    { maxGapMinutes: Number.NaN },
  ])("rejects invalid max gap", ({ maxGapMinutes }) => {
    expect(() => estimateCumulativeMetricAtTime({
      snapshots: [], targetTime: at("08:00"), metric: "steps", maxGapMinutes,
    })).toThrow();
  });

  it("rejects invalid timestamps and cumulative values", () => {
    expect(() => estimateCumulativeMetricAtTime({
      snapshots: [], targetTime: new Date(Number.NaN), metric: "steps",
    })).toThrow(TypeError);
    expect(() => estimateCumulativeMetricAtTime({
      snapshots: [{ timestamp: new Date(Number.NaN), steps: 1, walkingDistanceKm: 1 }],
      targetTime: at("08:00"), metric: "steps",
    })).toThrow(TypeError);
    expect(() => estimateCumulativeMetricAtTime({
      snapshots: [snapshot("08:00", -1, 0)], targetTime: at("08:00"), metric: "steps",
    })).toThrow(RangeError);
    expect(() => estimateCumulativeMetricAtTime({
      snapshots: [snapshot("08:00", Number.NaN, 0)], targetTime: at("08:00"), metric: "steps",
    })).toThrow(TypeError);
  });
});

describe("work interval walking reconstruction", () => {
  const goldenSnapshots = [
    snapshot("08:05", 1_200, 0.8),
    snapshot("16:05", 4_700, 3.3),
    snapshot("22:00", 7_200, 5.1),
  ];

  it("reconstructs the real 08:00–16:00 nearest-snapshot example", () => {
    const result = estimateWorkIntervalWalking({
      snapshots: goldenSnapshots, startTime: at("08:00"), endTime: at("16:00"),
    });
    expect(result.estimatedSteps.value).toBe(3_500);
    expect(result.estimatedWalkingDistanceKm.value).toBeCloseTo(2.5, 12);
    expect(result.estimatedSteps.start).toMatchObject({ method: "nearest", gapMinutes: 5 });
    expect(result.estimatedSteps.end).toMatchObject({ method: "nearest", gapMinutes: 5 });
  });

  it("returns zero for unchanged valid counters", () => {
    const result = estimateWorkIntervalWalking({
      snapshots: [snapshot("08:00", 0, 0), snapshot("09:00", 0, 0)],
      startTime: at("08:00"), endTime: at("09:00"),
    });
    expect(result.estimatedSteps.value).toBe(0);
    expect(result.estimatedWalkingDistanceKm.value).toBe(0);
  });

  it("does not clamp a decreasing interval counter", () => {
    const result = estimateWorkIntervalWalking({
      snapshots: [snapshot("08:00", 2_000, 2), snapshot("09:00", 1_000, 1)],
      startTime: at("08:00"), endTime: at("09:00"),
    });
    expect(result.estimatedSteps).toMatchObject({ value: null, reason: "counter-decreased" });
    expect(result.estimatedWalkingDistanceKm).toMatchObject({ value: null, reason: "counter-decreased" });
  });

  it("reports independently missing start and end boundaries", () => {
    const missingStart = estimateWorkIntervalWalking({
      snapshots: [snapshot("09:00", 100, 0.1)],
      startTime: at("08:00"), endTime: at("09:00"), maxGapMinutes: 30,
    });
    expect(missingStart.estimatedSteps).toMatchObject({ value: null, reason: "gap-too-large" });
    const missingEnd = estimateWorkIntervalWalking({
      snapshots: [snapshot("08:00", 100, 0.1)],
      startTime: at("08:00"), endTime: at("09:00"), maxGapMinutes: 30,
    });
    expect(missingEnd.estimatedSteps).toMatchObject({ value: null, reason: "gap-too-large" });
  });

  it("rejects a nonpositive interval", () => {
    expect(() => estimateWorkIntervalWalking({
      snapshots: goldenSnapshots, startTime: at("16:00"), endTime: at("08:00"),
    })).toThrow(RangeError);
  });

  it("handles multiple sorted non-overlapping intervals and outside-work subtraction", () => {
    const snapshots = [
      snapshot("08:00", 1_000, 0.5), snapshot("12:00", 3_000, 2),
      snapshot("13:00", 3_500, 2.5), snapshot("17:00", 5_500, 4),
    ];
    const result = estimateDailyWorkWalking({
      snapshots,
      intervals: [
        { id: 2, startTime: at("13:00"), endTime: at("17:00") },
        { id: 1, startTime: at("08:00"), endTime: at("12:00") },
      ],
      dailyWalkingDistanceKm: 5,
    });
    expect(result.intervals.map(({ intervalId }) => intervalId)).toEqual([1, 2]);
    expect(result.workWalkingDistanceKm).toBe(3);
    expect(result.outsideWorkWalkingDistanceKm).toBe(2);
  });

  it("returns unavailable outside distance for missing or inconsistent inputs", () => {
    const missing = estimateDailyWorkWalking({
      snapshots: [], intervals: [{ id: 1, startTime: at("08:00"), endTime: at("09:00") }],
      dailyWalkingDistanceKm: null,
    });
    expect(missing).toMatchObject({ workWalkingDistanceKm: null, outsideWorkWalkingDistanceKm: null });

    const excessive = estimateDailyWorkWalking({
      snapshots: [snapshot("08:00", 0, 0), snapshot("09:00", 1_000, 2)],
      intervals: [{ id: 1, startTime: at("08:00"), endTime: at("09:00") }],
      dailyWalkingDistanceKm: 1,
    });
    expect(excessive).toMatchObject({
      workWalkingDistanceKm: 2,
      outsideWorkWalkingDistanceKm: null,
      outsideWorkFailure: "work-distance-exceeds-daily-total",
    });
  });

  it("rejects overlapping, invalid, and non-finite daily inputs", () => {
    expect(() => estimateDailyWorkWalking({
      snapshots: [],
      intervals: [
        { id: 1, startTime: at("08:00"), endTime: at("12:00") },
        { id: 2, startTime: at("11:00"), endTime: at("13:00") },
      ],
      dailyWalkingDistanceKm: 0,
    })).toThrow(RangeError);
    expect(() => estimateDailyWorkWalking({
      snapshots: [], intervals: [{ id: 1, startTime: at("09:00"), endTime: at("09:00") }],
      dailyWalkingDistanceKm: 0,
    })).toThrow(RangeError);
    expect(() => estimateDailyWorkWalking({
      snapshots: [], intervals: [], dailyWalkingDistanceKm: Number.POSITIVE_INFINITY,
    })).toThrow(TypeError);
    expect(() => estimateDailyWorkWalking({
      snapshots: [], intervals: [], dailyWalkingDistanceKm: -1,
    })).toThrow(RangeError);
  });
});
