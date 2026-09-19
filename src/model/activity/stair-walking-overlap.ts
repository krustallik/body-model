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
  activeEnergyKcal: number | null;
};

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
    const claimed = new Set<number>();
    const diagnostics: StairOverlapDiagnostic[] = [];
    let overlapDistanceKm = 0;
    for (const workout of [...input.stairWorkouts].sort((left, right) => left.startAt.getTime() - right.startAt.getTime())) {
      if (workout.activeEnergyKcal === null || workout.activeEnergyKcal <= 0) {
        diagnostics.push({
          startAt: workout.startAt.toISOString(), endAt: workout.endAt.toISOString(), activeEnergyKcal: workout.activeEnergyKcal,
          beforeSnapshotAt: null, beforeGapMinutes: null, afterSnapshotAt: null, afterGapMinutes: null,
          observedWalkingDistanceDeltaKm: null, observedStepsDelta: null, overlapApplied: false,
          overlapDistanceAppliedKm: 0, claimedSegmentIndexes: [], reason: "missing-active-energy",
        });
        continue;
      }
      let distanceKm = 0;
      const claimedIndexes: number[] = [];
      for (const [index, sample] of intervalRecords.entries()) {
        const sampleStart = sample.startAt.getTime();
        const sampleEnd = sample.endAt.getTime();
        if (!Number.isFinite(sample.walkingDistanceKm) || sample.walkingDistanceKm < 0 || sampleEnd <= sampleStart) continue;
        const overlapStart = Math.max(sampleStart, workout.startAt.getTime());
        const overlapEnd = Math.min(sampleEnd, workout.endAt.getTime());
        if (overlapEnd <= overlapStart || claimed.has(index)) continue;
        // Work walking is already accounted for by its own direct interval allocation.
        const workOverlapMs = (input.workIntervals ?? []).reduce((sum, work) => sum + Math.max(
          0,
          Math.min(overlapEnd, work.endAt.getTime()) - Math.max(overlapStart, work.startAt.getTime()),
        ), 0);
        const usableMs = Math.max(0, overlapEnd - overlapStart - workOverlapMs);
        if (usableMs <= 0) continue;
        distanceKm += sample.walkingDistanceKm * usableMs / (sampleEnd - sampleStart);
        claimed.add(index);
        claimedIndexes.push(index);
      }
      overlapDistanceKm += distanceKm;
      diagnostics.push({
        startAt: workout.startAt.toISOString(), endAt: workout.endAt.toISOString(), activeEnergyKcal: workout.activeEnergyKcal,
        beforeSnapshotAt: null, beforeGapMinutes: 0, afterSnapshotAt: null, afterGapMinutes: 0,
        observedWalkingDistanceDeltaKm: distanceKm, observedStepsDelta: null, overlapApplied: distanceKm > 0,
        overlapDistanceAppliedKm: distanceKm, claimedSegmentIndexes: claimedIndexes,
        reason: distanceKm > 0 ? "applied" : "overlap-already-attributed-to-work",
      });
    }
    return { overlapDistanceKm, diagnostics, claimedSegmentIndexes: [...claimed] };
  }
  const maxGapMinutes = input.maxGapMinutes ?? STAIR_SNAPSHOT_BOUNDARY_MAX_GAP_MINUTES;
  const orderedSnapshots = [...input.snapshots]
    .filter((snapshot) => Number.isFinite(snapshot.timestamp.getTime()))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const segments = buildWalkingSegments(orderedSnapshots);
  const workAttributed = markWorkAttributedSegments(
    segments,
    input.workIntervals ?? [],
  );
  const claimed = new Set<number>();
  const diagnostics: StairOverlapDiagnostic[] = [];
  let overlapDistanceKm = 0;

  const chronologicalStairs = [...input.stairWorkouts]
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());

  for (const workout of chronologicalStairs) {
    if (workout.activeEnergyKcal === null || workout.activeEnergyKcal <= 0) {
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

    let appliedKm = 0;
    const newlyClaimed: number[] = [];
    let skippedWork = false;
    let skippedDedup = false;
    for (const segment of claimable) {
      if (workAttributed.has(segment.index)) {
        skippedWork = true;
        continue;
      }
      if (claimed.has(segment.index)) {
        skippedDedup = true;
        continue;
      }
      claimed.add(segment.index);
      newlyClaimed.push(segment.index);
      appliedKm += segment.distanceKm;
    }

    let reason: StairOverlapReason = "applied";
    if (newlyClaimed.length === 0) {
      if (skippedWork) reason = "overlap-already-attributed-to-work";
      else if (skippedDedup) reason = "overlap-deduplicated";
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
      claimedSegmentIndexes: newlyClaimed,
      reason,
    });
  }

  return {
    overlapDistanceKm,
    diagnostics,
    claimedSegmentIndexes: [...claimed].sort((left, right) => left - right),
  };
}
