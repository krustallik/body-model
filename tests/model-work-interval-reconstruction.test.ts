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

  it("uses an inclusive ±60-minute boundary window", () => {
    expect(DEFAULT_SNAPSHOT_MAX_GAP_MINUTES).toBe(60);
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("09:00", 1_200, 0.8)],
      targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: 1_200, gapMinutes: 60, method: "nearest" });
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("07:00", 900, 0.6)],
      targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: 900, gapMinutes: 60, method: "nearest" });
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("09:01", 1_200, 0.8)],
      targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: null, reason: "gap-too-large" });
  });

  it("accepts an exact work-start sync at the boundary", () => {
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("06:00", 1_000, 0.7)],
      targetTime: at("06:00"), metric: "steps",
    })).toMatchObject({ value: 1_000, gapMinutes: 0, method: "exact" });
  });

  it("reports missing data and excessive gaps", () => {
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("08:00", null, 0.8)], targetTime: at("08:00"), metric: "steps",
    })).toMatchObject({ value: null, reason: "insufficient-data" });
    expect(estimateCumulativeMetricAtTime({
      snapshots: [snapshot("06:59", 100, 0.1)], targetTime: at("08:00"), metric: "steps",
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

  it("reconstructs a 06:00–14:00 shift from ±60-minute sync windows", () => {
    const result = estimateWorkIntervalWalking({
      snapshots: [snapshot("05:30", 800, 0.5), snapshot("14:20", 3_300, 2.3)],
      startTime: at("06:00"),
      endTime: at("14:00"),
    });
    expect(result.estimatedSteps.value).toBe(2_500);
    expect(result.estimatedWalkingDistanceKm.value).toBeCloseTo(1.8, 12);
    expect(result.estimatedSteps.start).toMatchObject({ method: "nearest", gapMinutes: 30 });
    expect(result.estimatedSteps.end).toMatchObject({ method: "nearest", gapMinutes: 20 });
  });

  it("reports the nearest actual syncs at Bratislava work boundaries", () => {
    const result = estimateWorkIntervalWalking({
      snapshots: [
        { timestamp: new Date("2026-08-23T03:23:37Z"), steps: 1_000, walkingDistanceKm: 0.8 }, // 05:23:37 Europe/Bratislava (UTC+2)
        { timestamp: new Date("2026-08-23T12:02:29Z"), steps: 4_000, walkingDistanceKm: 3.1 }, // 14:02:29 Europe/Bratislava (UTC+2)
      ],
      startTime: at("04:00"), // 06:00 Europe/Bratislava (UTC+2)
      endTime: at("12:00"), // 14:00 Europe/Bratislava (UTC+2)
    });
    expect(result.snapshotCoverage).toEqual({
      startGapMinutes: (36 * 60 + 23) / 60,
      endGapMinutes: (2 * 60 + 29) / 60,
    });
  });

  it("accepts syncs up to one hour inside either work boundary", () => {
    const result = estimateWorkIntervalWalking({
      snapshots: [snapshot("06:45", 1_100, 0.8), snapshot("13:15", 2_600, 1.9)],
      startTime: at("06:00"),
      endTime: at("14:00"),
    });
    expect(result.estimatedSteps.value).toBe(1_500);
    expect(result.estimatedSteps.start).toMatchObject({ method: "nearest", gapMinutes: 45 });
    expect(result.estimatedSteps.end).toMatchObject({ method: "nearest", gapMinutes: 45 });
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

  it("prefers Apple Health interval samples and prorates records crossing work boundaries", () => {
    const result = estimateDailyWorkWalking({
      snapshots: [snapshot("08:00", 0, 0), snapshot("17:00", 99_999, 99)],
      activityIntervals: {
        steps: [
          { startTime: at("07:45"), endTime: at("08:15"), value: 60 },
          { startTime: at("08:15"), endTime: at("09:15"), value: 120 },
          { startTime: at("09:15"), endTime: at("10:15"), value: 90 },
        ],
        walkingDistanceKm: [
          { startTime: at("07:45"), endTime: at("08:15"), value: 0.3 },
          { startTime: at("08:15"), endTime: at("09:15"), value: 0.6 },
          { startTime: at("09:15"), endTime: at("10:15"), value: 0.45 },
        ],
      },
      intervals: [{ id: 1, startTime: at("08:00"), endTime: at("10:00") }],
      dailyWalkingDistanceKm: 2,
    });
    expect(result.intervals[0]).toMatchObject({
      estimatedSteps: { value: 217.5, start: { method: "interval-overlap" } },
      estimatedWalkingDistanceKm: { value: 1.0875, end: { method: "interval-overlap" } },
      snapshotCoverage: null,
    });
    expect(result.workWalkingDistanceKm).toBe(1.0875);
    expect(result.outsideWorkWalkingDistanceKm).toBeCloseTo(0.9125, 10);
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
