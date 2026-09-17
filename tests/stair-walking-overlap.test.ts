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

  it("marks null-distance segments invalid without aborting later segments", () => {
    const segments = buildWalkingSegments([
      snapshot("08:00:00", 1.0),
      snapshot("09:00:00", null),
      snapshot("10:00:00", 1.5),
      snapshot("11:00:00", 2.0),
    ]);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ valid: false, invalidReason: "null-distance" });
    expect(segments[1]).toMatchObject({ valid: false, invalidReason: "null-distance" });
    expect(segments[2]).toMatchObject({ valid: true, distanceKm: 0.5 });
  });

  it("marks same-timestamp segments invalid", () => {
    const segments = buildWalkingSegments([
      snapshot("08:00:00", 1.0),
      snapshot("08:00:00", 1.4),
      snapshot("09:00:00", 1.9),
    ]);
    expect(segments[0]).toMatchObject({
      valid: false, invalidReason: "same-timestamp", distanceKm: 0,
    });
    expect(segments[1]).toMatchObject({ valid: true, distanceKm: 0.5 });
  });

  it("keeps later valid segments after a nested/partial bad middle segment", () => {
    const segments = buildWalkingSegments([
      snapshot("08:00:00", 1.0),
      snapshot("09:00:00", 1.3),
      snapshot("09:00:00", 1.3), // same-timestamp nest inside otherwise valid chain
      snapshot("10:00:00", 1.8),
      snapshot("11:00:00", null), // null after a good segment
      snapshot("12:00:00", 2.4),
      snapshot("13:00:00", 2.9),
    ]);
    expect(segments.map((segment) => segment.invalidReason)).toEqual([
      null,
      "same-timestamp",
      null,
      "null-distance",
      "null-distance",
      null,
    ]);
    expect(segments[0]?.distanceKm).toBeCloseTo(0.3, 12);
    expect(segments[2]?.distanceKm).toBeCloseTo(0.5, 12);
    expect(segments[5]?.distanceKm).toBeCloseTo(0.5, 12);
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

describe("reconstructStairWalkingOverlap missing boundaries", () => {
  const workout = {
    startAt: at("12:00:00"),
    endAt: at("12:10:00"),
    activeEnergyKcal: 154,
  };

  it("reports missing-before-snapshot when no snapshot exists at or before start", () => {
    const result = reconstructStairWalkingOverlap({
      snapshots: [
        snapshot("12:05:00", 4.2),
        snapshot("12:15:00", 4.6),
      ],
      stairWorkouts: [workout],
    });
    expect(result.diagnostics[0]?.reason).toBe("missing-before-snapshot");
    expect(result.diagnostics[0]?.beforeSnapshotAt).toBeNull();
    expect(result.overlapDistanceKm).toBe(0);
  });

  it("reports missing-after-snapshot when no snapshot exists at or after end", () => {
    const result = reconstructStairWalkingOverlap({
      snapshots: [
        snapshot("11:55:00", 4.0),
        snapshot("12:05:00", 4.3),
      ],
      stairWorkouts: [workout],
    });
    expect(result.diagnostics[0]?.reason).toBe("missing-after-snapshot");
    expect(result.diagnostics[0]?.afterSnapshotAt).toBeNull();
    expect(result.overlapDistanceKm).toBe(0);
  });

  it("reports missing-before-snapshot when both boundary snapshots are absent", () => {
    const result = reconstructStairWalkingOverlap({
      snapshots: [],
      stairWorkouts: [workout],
    });
    expect(result.diagnostics[0]?.reason).toBe("missing-before-snapshot");
    expect(result.diagnostics[0]?.beforeSnapshotAt).toBeNull();
    expect(result.diagnostics[0]?.afterSnapshotAt).toBeNull();
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

  it("applies adjacent stair workouts independently when windows do not share segments", () => {
    const result = reconstructStairWalkingOverlap({
      snapshots: [
        snapshot("07:55:00", 1.0),
        snapshot("08:15:00", 1.4),
        snapshot("12:25:00", 2.0),
        snapshot("12:40:00", 2.5),
      ],
      stairWorkouts: [
        { startAt: at("08:00:00"), endAt: at("08:10:00"), activeEnergyKcal: 154 },
        { startAt: at("12:30:00"), endAt: at("12:35:00"), activeEnergyKcal: 18 },
      ],
    });
    expect(result.diagnostics.map((item) => item.reason)).toEqual(["applied", "applied"]);
    expect(result.diagnostics[0]?.overlapDistanceAppliedKm).toBeCloseTo(0.4, 12);
    expect(result.diagnostics[1]?.overlapDistanceAppliedKm).toBeCloseTo(0.5, 12);
    expect(result.overlapDistanceKm).toBeCloseTo(0.9, 12);
    expect(result.claimedSegmentIndexes).toEqual([0, 2]);
  });

  it("does not let one bad null-distance segment invalidate a later valid stair overlap", () => {
    const result = reconstructStairWalkingOverlap({
      snapshots: [
        snapshot("07:55:00", 1.0),
        snapshot("08:05:00", null), // bad segment inside first window
        snapshot("08:15:00", 1.5),
        snapshot("12:25:00", 2.0),
        snapshot("12:40:00", 2.6),
      ],
      stairWorkouts: [
        { startAt: at("08:00:00"), endAt: at("08:10:00"), activeEnergyKcal: 154 },
        { startAt: at("12:30:00"), endAt: at("12:35:00"), activeEnergyKcal: 18 },
      ],
    });
    expect(result.diagnostics[0]?.reason).toBe("invalid-distance-delta");
    expect(result.diagnostics[0]?.overlapApplied).toBe(false);
    expect(result.diagnostics[1]?.reason).toBe("applied");
    expect(result.diagnostics[1]?.overlapDistanceAppliedKm).toBeCloseTo(0.6, 12);
    expect(result.overlapDistanceKm).toBeCloseTo(0.6, 12);
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
