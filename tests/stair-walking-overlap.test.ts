import { describe, expect, it } from "vitest";
import {
  STAIR_SNAPSHOT_BOUNDARY_MAX_GAP_MINUTES,
  buildWalkingSegments,
  reconstructStairWalkingOverlap,
  type SnapshotPoint,
} from "@/model/activity/stair-walking-overlap";

const at = (time: string) => new Date(`2026-08-22T${time}+02:00`);

function snapshot(
  time: string,
  walkingDistanceKm: number | null,
  steps: number | null = null,
): SnapshotPoint {
  return { timestamp: at(time), walkingDistanceKm, steps };
}

describe("STAIR_SNAPSHOT_BOUNDARY_MAX_GAP_MINUTES", () => {
  it("is the engineering 10-minute boundary", () => {
    expect(STAIR_SNAPSHOT_BOUNDARY_MAX_GAP_MINUTES).toBe(10);
  });
});

describe("buildWalkingSegments", () => {
  it("builds consecutive chronological segments with positive distance deltas", () => {
    const segments = buildWalkingSegments([
      snapshot("08:00:00", 1.0, 1_000),
      snapshot("09:00:00", 1.4, 1_800),
      snapshot("10:00:00", 2.0, 2_900),
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      index: 0, steps: 800, valid: true, invalidReason: null,
    });
    expect(segments[0]!.distanceKm).toBeCloseTo(0.4, 12);
    expect(segments[1]).toMatchObject({
      index: 1, steps: 1_100, valid: true, invalidReason: null,
    });
    expect(segments[1]!.distanceKm).toBeCloseTo(0.6, 12);
  });

  it("marks counter resets invalid without aborting later segments", () => {
    const segments = buildWalkingSegments([
      snapshot("08:00:00", 2.0),
      snapshot("09:00:00", 0.1),
      snapshot("10:00:00", 0.5),
    ]);
    expect(segments[0]).toMatchObject({ valid: false, invalidReason: "counter-reset" });
    expect(segments[1]).toMatchObject({ valid: true, distanceKm: 0.4 });
  });
});

describe("reconstructStairWalkingOverlap gap boundaries", () => {
  const workout = {
    startAt: at("12:00:00"),
    endAt: at("12:10:00"),
    activeEnergyKcal: 154,
  };

  it.each([
    ["0s before and after", "12:00:00", "12:10:00", true, "applied"],
    ["1s before and after", "11:59:59", "12:10:01", true, "applied"],
    ["9:59 before and after", "11:50:01", "12:19:59", true, "applied"],
    ["exactly 10:00 before and after", "11:50:00", "12:20:00", true, "applied"],
  ] as const)("accepts %s", (_name, before, after, applied, reason) => {
    const result = reconstructStairWalkingOverlap({
      snapshots: [
        snapshot(before, 4.0),
        snapshot(after, 4.6),
      ],
      stairWorkouts: [workout],
    });
    expect(result.diagnostics[0]?.reason).toBe(reason);
    expect(result.diagnostics[0]?.overlapApplied).toBe(applied);
    expect(result.overlapDistanceKm).toBeCloseTo(0.6, 12);
  });

  it("rejects a before-gap of 10 minutes + 1 second", () => {
    const result = reconstructStairWalkingOverlap({
      snapshots: [
        snapshot("11:49:59", 4.0),
        snapshot("12:20:00", 4.6),
      ],
      stairWorkouts: [workout],
    });
    expect(result.diagnostics[0]?.reason).toBe("before-gap-too-large");
    expect(result.overlapDistanceKm).toBe(0);
  });

  it("rejects an after-gap of 10 minutes + 1 second", () => {
    const result = reconstructStairWalkingOverlap({
      snapshots: [
        snapshot("11:50:00", 4.0),
        snapshot("12:20:01", 4.6),
      ],
      stairWorkouts: [workout],
    });
    expect(result.diagnostics[0]?.reason).toBe("after-gap-too-large");
    expect(result.overlapDistanceKm).toBe(0);
  });
});

describe("reconstructStairWalkingOverlap attribution", () => {
  it("claims each walking segment at most once across overlapping stairs", () => {
    // Same before/after boundary window so the second stair can only see already-claimed segments.
    const result = reconstructStairWalkingOverlap({
      snapshots: [
        snapshot("11:55:00", 3.0),
        snapshot("12:05:00", 3.3),
        snapshot("12:15:00", 3.6),
      ],
      stairWorkouts: [
        { startAt: at("12:00:00"), endAt: at("12:10:00"), activeEnergyKcal: 154 },
        { startAt: at("12:01:00"), endAt: at("12:09:00"), activeEnergyKcal: 18 },
      ],
    });
    const claimed = result.claimedSegmentIndexes;
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(result.diagnostics[0]?.overlapApplied).toBe(true);
    expect(result.diagnostics[1]?.reason).toBe("overlap-deduplicated");
    expect(result.diagnostics[1]?.overlapDistanceAppliedKm).toBe(0);
    expect(result.overlapDistanceKm).toBeCloseTo(
      result.diagnostics[0]!.overlapDistanceAppliedKm,
      12,
    );
  });

  it("excludes work-attributed segments from stair overlap", () => {
    const result = reconstructStairWalkingOverlap({
      snapshots: [
        snapshot("11:55:00", 2.0),
        snapshot("12:05:00", 2.4),
        snapshot("12:15:00", 2.8),
      ],
      stairWorkouts: [
        { startAt: at("12:00:00"), endAt: at("12:10:00"), activeEnergyKcal: 154 },
      ],
      workIntervals: [{ startAt: at("08:00:00"), endAt: at("16:00:00") }],
    });
    expect(result.diagnostics[0]?.reason).toBe("overlap-already-attributed-to-work");
    expect(result.overlapDistanceKm).toBe(0);
    expect(result.claimedSegmentIndexes).toEqual([]);
  });

  it("reports counter-reset when boundary distance decreases", () => {
    const result = reconstructStairWalkingOverlap({
      snapshots: [
        snapshot("11:55:00", 5.0),
        snapshot("12:15:00", 1.0),
      ],
      stairWorkouts: [
        { startAt: at("12:00:00"), endAt: at("12:10:00"), activeEnergyKcal: 154 },
      ],
    });
    expect(result.diagnostics[0]?.reason).toBe("counter-reset");
    expect(result.overlapDistanceKm).toBe(0);
  });

  it("skips stairs without positive active energy", () => {
    const result = reconstructStairWalkingOverlap({
      snapshots: [
        snapshot("11:55:00", 4.0),
        snapshot("12:15:00", 4.6),
      ],
      stairWorkouts: [
        { startAt: at("12:00:00"), endAt: at("12:10:00"), activeEnergyKcal: null },
        { startAt: at("12:00:00"), endAt: at("12:10:00"), activeEnergyKcal: 0 },
      ],
    });
    expect(result.diagnostics.map((item) => item.reason)).toEqual([
      "missing-active-energy",
      "missing-active-energy",
    ]);
    expect(result.overlapDistanceKm).toBe(0);
  });
});
