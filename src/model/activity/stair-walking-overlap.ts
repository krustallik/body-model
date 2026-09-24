import { allocateIntervalSampleValue } from "@/model/work-interval-reconstruction";

export const STAIR_SNAPSHOT_BOUNDARY_MAX_GAP_MINUTES = 10;

export type StairOverlapReason =
  | "applied"
  | "missing-before-snapshot"
  | "missing-after-snapshot"
  | "before-gap-too-large"
  | "after-gap-too-large"
  | "invalid-distance-delta"
  | "counter-reset"
  | "cross-midnight-reset"
  | "overlap-already-attributed-to-work"
  | "overlap-deduplicated"
  | "missing-active-energy"
  | "not-stair-climbing";

export type SnapshotPoint = {
  timestamp: Date;
  steps: number | null;
  walkingDistanceKm: number | null;
};

/** Modern Apple Health value recorded across a span instead of at a sync instant. */
export type WalkingDistanceIntervalPoint = {
  startAt: Date;
  endAt: Date;
  walkingDistanceKm: number;
};

export type WalkingSegment = {
  index: number;
  previousTimestamp: Date;
  nextTimestamp: Date;
  distanceKm: number;
  steps: number | null;
  valid: boolean;
  invalidReason: string | null;
};

export type StairWorkoutWindow = {
  startAt: Date;
  endAt: Date;
  /** Device estimate retained for diagnostics and legacy model versions. */
  activeEnergyKcal: number | null;
  /** v7 may select a BodyCast stepper estimate even when the device has no kcal. */
  bodyCastEstimateAvailable?: boolean;
  /** Whether its available estimate represents positive mechanical work. */
  bodyCastEstimatePositive?: boolean;
};

function hasSelectedActivityEnergy(workout: StairWorkoutWindow): boolean {
  if (workout.bodyCastEstimateAvailable === true) {
    return workout.bodyCastEstimatePositive ?? true;
  }
  return workout.activeEnergyKcal !== null && workout.activeEnergyKcal > 0;
}

export type StairOverlapDiagnostic = {
  startAt: string;
  endAt: string;
  activeEnergyKcal: number | null;
  beforeSnapshotAt: string | null;
  beforeGapMinutes: number | null;
  afterSnapshotAt: string | null;
  afterGapMinutes: number | null;
  observedWalkingDistanceDeltaKm: number | null;
  observedStepsDelta: number | null;
  overlapApplied: boolean;
  overlapDistanceAppliedKm: number;
  /** Indicates whether applied overlap came from timed samples or estimated snapshot allocation. */
  distanceAllocation?: "timed-intervals" | "timed-plus-proportional-snapshot" | "proportional-snapshot";
  claimedSegmentIndexes: number[];
  reason: StairOverlapReason;
};

export type WorkIntervalWindow = {
  startAt: Date;
  endAt: Date;
};

function gapMinutes(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / 60_000;
}

/** Build consecutive chronological walking segments; invalid deltas are marked, not fatal. */
export function buildWalkingSegments(snapshots: readonly SnapshotPoint[]): WalkingSegment[] {
  const ordered = [...snapshots]
    .filter((snapshot) => Number.isFinite(snapshot.timestamp.getTime()))
    .sort((left, right) => {
      const delta = left.timestamp.getTime() - right.timestamp.getTime();
      return delta !== 0 ? delta : 0;
    });

  const segments: WalkingSegment[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const previous = ordered[index];
    const next = ordered[index + 1];
    if (previous.timestamp.getTime() === next.timestamp.getTime()) {
      segments.push({
        index,
        previousTimestamp: previous.timestamp,
        nextTimestamp: next.timestamp,
        distanceKm: 0,
        steps: null,
        valid: false,
        invalidReason: "same-timestamp",
      });
      continue;
    }
    if (previous.walkingDistanceKm === null || next.walkingDistanceKm === null) {
      segments.push({
        index,
        previousTimestamp: previous.timestamp,
        nextTimestamp: next.timestamp,
        distanceKm: 0,
        steps: null,
        valid: false,
        invalidReason: "null-distance",
      });
      continue;
    }
    if (!Number.isFinite(previous.walkingDistanceKm) || !Number.isFinite(next.walkingDistanceKm)) {
      segments.push({
        index,
        previousTimestamp: previous.timestamp,
        nextTimestamp: next.timestamp,
        distanceKm: 0,
        steps: null,
        valid: false,
        invalidReason: "malformed-distance",
      });
      continue;
    }
    const distanceKm = next.walkingDistanceKm - previous.walkingDistanceKm;
    if (distanceKm < 0) {
      segments.push({
        index,
        previousTimestamp: previous.timestamp,
        nextTimestamp: next.timestamp,
        distanceKm: 0,
        steps: null,
        valid: false,
        invalidReason: distanceKm < -0.001 ? "counter-reset" : "negative-delta",
      });
      continue;
    }
    // Engineering guardrail: >5 km between consecutive snapshots is treated as implausible.
    if (distanceKm > 5) {
      segments.push({
        index,
        previousTimestamp: previous.timestamp,
        nextTimestamp: next.timestamp,
        distanceKm: 0,
        steps: null,
        valid: false,
        invalidReason: "implausibly-large-delta",
      });
      continue;
    }
    let steps: number | null = null;
    if (
      previous.steps !== null
      && next.steps !== null
      && Number.isFinite(previous.steps)
      && Number.isFinite(next.steps)
      && next.steps >= previous.steps
    ) {
      steps = next.steps - previous.steps;
    }
    segments.push({
      index,
      previousTimestamp: previous.timestamp,
      nextTimestamp: next.timestamp,
      distanceKm,
      steps,
      valid: true,
      invalidReason: null,
    });
  }
  return segments;
}

function segmentOverlapsInterval(segment: WalkingSegment, interval: WorkIntervalWindow): boolean {
  const segmentStart = segment.previousTimestamp.getTime();
  const segmentEnd = segment.nextTimestamp.getTime();
  const workStart = interval.startAt.getTime();
  const workEnd = interval.endAt.getTime();
  return segmentStart < workEnd && segmentEnd > workStart;
}

export function markWorkAttributedSegments(
  segments: readonly WalkingSegment[],
  workIntervals: readonly WorkIntervalWindow[],
): Set<number> {
  const attributed = new Set<number>();
  for (const segment of segments) {
    if (!segment.valid) continue;
    if (workIntervals.some((interval) => segmentOverlapsInterval(segment, interval))) {
      attributed.add(segment.index);
    }
  }
  return attributed;
}

function findBoundarySnapshot(
  snapshots: readonly SnapshotPoint[],
  target: Date,
  side: "before" | "after",
  maxGapMinutes: number,
): { snapshot: SnapshotPoint; gapMinutes: number } | null {
  const targetMs = target.getTime();
  let best: { snapshot: SnapshotPoint; gapMinutes: number } | null = null;
  for (const snapshot of snapshots) {
    const snapshotMs = snapshot.timestamp.getTime();
    if (side === "before") {
      const gap = gapMinutes(snapshotMs, targetMs);
      if (gap < 0 || gap > maxGapMinutes) continue;
      if (!best || gap < best.gapMinutes) best = { snapshot, gapMinutes: gap };
    } else {
      const gap = gapMinutes(targetMs, snapshotMs);
      if (gap < 0 || gap > maxGapMinutes) continue;
      if (!best || gap < best.gapMinutes) best = { snapshot, gapMinutes: gap };
    }
  }
  return best;
}

/**
 * Reconstruct Stair Climbing walking overlap with:
 * - <=10 minute before/after snapshot policy (engineering)
 * - segment claimed at most once
 * - work-attributed segments excluded
 */
export function reconstructStairWalkingOverlap(input: {
  snapshots: readonly SnapshotPoint[];
  /** Preferred modern source; legacy snapshots are used when this has no records. */
  walkingDistanceIntervals?: readonly WalkingDistanceIntervalPoint[];
  stairWorkouts: readonly StairWorkoutWindow[];
  workIntervals?: readonly WorkIntervalWindow[];
  maxGapMinutes?: number;
}): {
  overlapDistanceKm: number;
  diagnostics: StairOverlapDiagnostic[];
  claimedSegmentIndexes: number[];
} {
  const intervalRecords = input.walkingDistanceIntervals ?? [];
  if (intervalRecords.length > 0) {
    const claimedMs: Array<{ start: number; end: number }> = [];
    const claimedIndexes = new Set<number>();
    const diagnostics: StairOverlapDiagnostic[] = [];
    let overlapDistanceKm = 0;
    const samples = intervalRecords.flatMap((sample) => {
      const sampleStart = sample.startAt.getTime();
      const sampleEnd = sample.endAt.getTime();
      if (!Number.isFinite(sample.walkingDistanceKm) || sample.walkingDistanceKm < 0 || sampleEnd <= sampleStart) {
        return [];
      }
      return [{
        startTime: sample.startAt,
        endTime: sample.endAt,
        value: sample.walkingDistanceKm,
      }];
    });
    const maxGapMinutes = input.maxGapMinutes ?? STAIR_SNAPSHOT_BOUNDARY_MAX_GAP_MINUTES;
    const snapshotSegments = buildWalkingSegments(input.snapshots)
      .filter((segment) => segment.valid && segment.distanceKm >= 0)
      .map((segment) => ({
        startTime: segment.previousTimestamp,
        endTime: segment.nextTimestamp,
        value: segment.distanceKm,
      }));
    for (const workout of [...input.stairWorkouts].sort((left, right) => left.startAt.getTime() - right.startAt.getTime())) {
      if (!hasSelectedActivityEnergy(workout)) {
        diagnostics.push({
          startAt: workout.startAt.toISOString(), endAt: workout.endAt.toISOString(), activeEnergyKcal: workout.activeEnergyKcal,
          beforeSnapshotAt: null, beforeGapMinutes: null, afterSnapshotAt: null, afterGapMinutes: null,
          observedWalkingDistanceDeltaKm: null, observedStepsDelta: null, overlapApplied: false,
          overlapDistanceAppliedKm: 0, claimedSegmentIndexes: [], reason: "missing-active-energy",
        });
        continue;
      }
      const workoutStart = workout.startAt.getTime();
      const workoutEnd = workout.endAt.getTime();
      // Timed Health intervals are the preferred source. Cumulative snapshots
      // fill only uncovered time when their segment brackets the session within
      // the established boundary-gap policy. Allocation claims keep the mixed
      // sources and multiple sessions from charging the same instant twice.
      const snapshotFallback = snapshotSegments.filter((sample) => {
        const sampleStart = sample.startTime.getTime();
        const sampleEnd = sample.endTime.getTime();
        if (sampleStart >= workoutEnd || sampleEnd <= workoutStart) return false;
        const beforeGapMinutes = Math.max(0, sampleStart - workoutStart) / 60_000;
        const afterGapMinutes = Math.max(0, workoutEnd - sampleEnd) / 60_000;
        return beforeGapMinutes <= maxGapMinutes && afterGapMinutes <= maxGapMinutes;
      });
      // Resolve modern timed samples first regardless of duration. The shared
      // claims then let snapshots estimate only portions no timed sample covers.
      const timedAllocation = allocateIntervalSampleValue({
        samples,
        startTime: workout.startAt,
        endTime: workout.endAt,
        claimedMs,
        excludedWindows: input.workIntervals?.map((work) => ({
          startTime: work.startAt,
          endTime: work.endAt,
        })),
      });
      const snapshotAllocation = allocateIntervalSampleValue({
        samples: snapshotFallback,
        startTime: workout.startAt,
        endTime: workout.endAt,
        claimedMs,
        excludedWindows: input.workIntervals?.map((work) => ({
          startTime: work.startAt,
          endTime: work.endAt,
        })),
      });
      const allocatedValue = timedAllocation.value + snapshotAllocation.value;
      overlapDistanceKm += allocatedValue;
      for (const index of timedAllocation.claimedSampleIndexes) claimedIndexes.add(index);
      for (const index of snapshotAllocation.claimedSampleIndexes) claimedIndexes.add(samples.length + index);
      diagnostics.push({
        startAt: workout.startAt.toISOString(), endAt: workout.endAt.toISOString(), activeEnergyKcal: workout.activeEnergyKcal,
        beforeSnapshotAt: null, beforeGapMinutes: null, afterSnapshotAt: null, afterGapMinutes: null,
        // Allocated overlap is an estimate, not a direct observed workout distance.
        observedWalkingDistanceDeltaKm: null, observedStepsDelta: null, overlapApplied: allocatedValue > 0,
        overlapDistanceAppliedKm: allocatedValue,
        ...(allocatedValue > 0 ? {
          distanceAllocation: snapshotAllocation.value > 0
            ? "timed-plus-proportional-snapshot" as const
            : timedAllocation.value > 0 ? "timed-intervals" as const : "proportional-snapshot" as const,
        } : {}),
        claimedSegmentIndexes: [
          ...timedAllocation.claimedSampleIndexes,
          ...snapshotAllocation.claimedSampleIndexes.map((index) => samples.length + index),
        ],
        reason: allocatedValue > 0 ? "applied" : "overlap-already-attributed-to-work",
      });
    }
    if (samples.length > 0) {
      return { overlapDistanceKm, diagnostics, claimedSegmentIndexes: [...claimedIndexes] };
    }
  }
  const maxGapMinutes = input.maxGapMinutes ?? STAIR_SNAPSHOT_BOUNDARY_MAX_GAP_MINUTES;
  const orderedSnapshots = [...input.snapshots]
    .filter((snapshot) => Number.isFinite(snapshot.timestamp.getTime()))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const segments = buildWalkingSegments(orderedSnapshots);
  const legacyDistanceSamples: Array<{ startTime: Date; endTime: Date; value: number }> = [];
  const legacySampleSegmentIndexes: number[] = [];
  for (const segment of segments) {
    if (!segment.valid) continue;
    legacySampleSegmentIndexes.push(segment.index);
    legacyDistanceSamples.push({
      startTime: segment.previousTimestamp,
      endTime: segment.nextTimestamp,
      value: segment.distanceKm,
    });
  }
  const claimedMs: Array<{ start: number; end: number }> = [];
  const diagnostics: StairOverlapDiagnostic[] = [];
  let overlapDistanceKm = 0;

  const chronologicalStairs = [...input.stairWorkouts]
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());

  for (const workout of chronologicalStairs) {
    if (!hasSelectedActivityEnergy(workout)) {
      diagnostics.push({
        startAt: workout.startAt.toISOString(),
        endAt: workout.endAt.toISOString(),
        activeEnergyKcal: workout.activeEnergyKcal,
        beforeSnapshotAt: null,
        beforeGapMinutes: null,
        afterSnapshotAt: null,
        afterGapMinutes: null,
        observedWalkingDistanceDeltaKm: null,
        observedStepsDelta: null,
        overlapApplied: false,
        overlapDistanceAppliedKm: 0,
        claimedSegmentIndexes: [],
        reason: "missing-active-energy",
      });
      continue;
    }

    const before = findBoundarySnapshot(orderedSnapshots, workout.startAt, "before", maxGapMinutes);
    const after = findBoundarySnapshot(orderedSnapshots, workout.endAt, "after", maxGapMinutes);

    if (!before) {
      const anyBefore = orderedSnapshots.findLast(
        (snapshot) => snapshot.timestamp.getTime() <= workout.startAt.getTime(),
      );
      diagnostics.push({
        startAt: workout.startAt.toISOString(),
        endAt: workout.endAt.toISOString(),
        activeEnergyKcal: workout.activeEnergyKcal,
        beforeSnapshotAt: anyBefore?.timestamp.toISOString() ?? null,
        beforeGapMinutes: anyBefore
          ? gapMinutes(anyBefore.timestamp.getTime(), workout.startAt.getTime())
          : null,
        afterSnapshotAt: after?.snapshot.timestamp.toISOString() ?? null,
        afterGapMinutes: after?.gapMinutes ?? null,
        observedWalkingDistanceDeltaKm: null,
        observedStepsDelta: null,
        overlapApplied: false,
        overlapDistanceAppliedKm: 0,
        claimedSegmentIndexes: [],
        reason: anyBefore ? "before-gap-too-large" : "missing-before-snapshot",
      });
      continue;
    }
    if (!after) {
      const anyAfter = orderedSnapshots.find(
        (snapshot) => snapshot.timestamp.getTime() >= workout.endAt.getTime(),
      );
      diagnostics.push({
        startAt: workout.startAt.toISOString(),
        endAt: workout.endAt.toISOString(),
        activeEnergyKcal: workout.activeEnergyKcal,
        beforeSnapshotAt: before.snapshot.timestamp.toISOString(),
        beforeGapMinutes: before.gapMinutes,
        afterSnapshotAt: anyAfter?.timestamp.toISOString() ?? null,
        afterGapMinutes: anyAfter
          ? gapMinutes(workout.endAt.getTime(), anyAfter.timestamp.getTime())
          : null,
        observedWalkingDistanceDeltaKm: null,
        observedStepsDelta: null,
        overlapApplied: false,
        overlapDistanceAppliedKm: 0,
        claimedSegmentIndexes: [],
        reason: anyAfter ? "after-gap-too-large" : "missing-after-snapshot",
      });
      continue;
    }

    const beforeMs = before.snapshot.timestamp.getTime();
    const afterMs = after.snapshot.timestamp.getTime();
    const windowSegments = segments.filter((segment) => (
      segment.previousTimestamp.getTime() >= beforeMs
      && segment.nextTimestamp.getTime() <= afterMs
    ));

    let observedDistance: number | null = null;
    if (
      before.snapshot.walkingDistanceKm !== null
      && after.snapshot.walkingDistanceKm !== null
      && Number.isFinite(before.snapshot.walkingDistanceKm)
      && Number.isFinite(after.snapshot.walkingDistanceKm)
    ) {
      const delta = after.snapshot.walkingDistanceKm - before.snapshot.walkingDistanceKm;
      if (delta < 0) {
        diagnostics.push({
          startAt: workout.startAt.toISOString(),
          endAt: workout.endAt.toISOString(),
          activeEnergyKcal: workout.activeEnergyKcal,
          beforeSnapshotAt: before.snapshot.timestamp.toISOString(),
          beforeGapMinutes: before.gapMinutes,
          afterSnapshotAt: after.snapshot.timestamp.toISOString(),
          afterGapMinutes: after.gapMinutes,
          observedWalkingDistanceDeltaKm: delta,
          observedStepsDelta: null,
          overlapApplied: false,
          overlapDistanceAppliedKm: 0,
          claimedSegmentIndexes: [],
          reason: "counter-reset",
        });
        continue;
      }
      observedDistance = delta;
    }

    let observedSteps: number | null = null;
    if (
      before.snapshot.steps !== null
      && after.snapshot.steps !== null
      && Number.isFinite(before.snapshot.steps)
      && Number.isFinite(after.snapshot.steps)
      && after.snapshot.steps >= before.snapshot.steps
    ) {
      observedSteps = after.snapshot.steps - before.snapshot.steps;
    }

    const claimable = windowSegments.filter((segment) => segment.valid);
    if (claimable.length === 0 && observedDistance === null) {
      diagnostics.push({
        startAt: workout.startAt.toISOString(),
        endAt: workout.endAt.toISOString(),
        activeEnergyKcal: workout.activeEnergyKcal,
        beforeSnapshotAt: before.snapshot.timestamp.toISOString(),
        beforeGapMinutes: before.gapMinutes,
        afterSnapshotAt: after.snapshot.timestamp.toISOString(),
        afterGapMinutes: after.gapMinutes,
        observedWalkingDistanceDeltaKm: observedDistance,
        observedStepsDelta: observedSteps,
        overlapApplied: false,
        overlapDistanceAppliedKm: 0,
        claimedSegmentIndexes: [],
        reason: "invalid-distance-delta",
      });
      continue;
    }

    const previousClaims = [...claimedMs];
    const allocated = allocateIntervalSampleValue({
      samples: legacyDistanceSamples,
      startTime: workout.startAt,
      endTime: workout.endAt,
      claimedMs,
      excludedWindows: input.workIntervals?.map((work) => ({
        startTime: work.startAt,
        endTime: work.endAt,
      })),
    });
    const newlyClaimed = allocated.claimedSampleIndexes
      .map((sampleIndex) => legacySampleSegmentIndexes[sampleIndex])
      .filter((segmentIndex): segmentIndex is number => segmentIndex !== undefined);
    const appliedKm = allocated.value;
    const hadPreviousClaimInWorkout = previousClaims.some((claim) => (
      claim.start < workout.endAt.getTime() && claim.end > workout.startAt.getTime()
    ));
    const overlapsWork = (input.workIntervals ?? []).some((work) => (
      work.startAt.getTime() < workout.endAt.getTime()
      && work.endAt.getTime() > workout.startAt.getTime()
    ));

    let reason: StairOverlapReason = "applied";
    if (newlyClaimed.length === 0) {
      if (hadPreviousClaimInWorkout) reason = "overlap-deduplicated";
      else if (overlapsWork) reason = "overlap-already-attributed-to-work";
      else reason = "invalid-distance-delta";
    }

    overlapDistanceKm += appliedKm;
    diagnostics.push({
      startAt: workout.startAt.toISOString(),
      endAt: workout.endAt.toISOString(),
      activeEnergyKcal: workout.activeEnergyKcal,
      beforeSnapshotAt: before.snapshot.timestamp.toISOString(),
      beforeGapMinutes: before.gapMinutes,
      afterSnapshotAt: after.snapshot.timestamp.toISOString(),
      afterGapMinutes: after.gapMinutes,
      observedWalkingDistanceDeltaKm: observedDistance,
      observedStepsDelta: observedSteps,
      overlapApplied: newlyClaimed.length > 0,
      overlapDistanceAppliedKm: appliedKm,
      ...(appliedKm > 0 ? { distanceAllocation: "proportional-snapshot" as const } : {}),
      claimedSegmentIndexes: newlyClaimed,
      reason,
    });
  }

  return {
    overlapDistanceKm,
    diagnostics,
    claimedSegmentIndexes: [...new Set(diagnostics.flatMap((diagnostic) => diagnostic.claimedSegmentIndexes))]
      .sort((left, right) => left - right),
  };
}
