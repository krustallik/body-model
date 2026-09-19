export const DEFAULT_SNAPSHOT_MAX_GAP_MINUTES = 60;

export type CumulativeSnapshot = {
  timestamp: Date;
  steps: number | null | undefined;
  walkingDistanceKm: number | null | undefined;
};

/** A Health sample whose value belongs to the complete [startTime, endTime] span. */
export type ActivityIntervalSample = {
  startTime: Date;
  endTime: Date;
  value: number;
};

export type BoundaryEstimate = {
  value: number;
  targetTime: string;
  sourceTimes: string[];
  gapMinutes: number;
  method: "exact" | "interpolated" | "nearest" | "interval-overlap";
};

export type UnavailableBoundaryEstimate = {
  value: null;
  targetTime: string;
  reason: "insufficient-data" | "gap-too-large" | "counter-decreased";
};

export type MetricBoundaryEstimate = BoundaryEstimate | UnavailableBoundaryEstimate;

type MetricKey = "steps" | "walkingDistanceKm";

function validateMaxGap(maxGapMinutes: number): void {
  if (!Number.isFinite(maxGapMinutes)) throw new TypeError("maxGapMinutes must be finite");
  if (maxGapMinutes < 0) throw new RangeError("maxGapMinutes must be nonnegative");
}

function validateTarget(targetTime: Date): number {
  const time = targetTime.getTime();
  if (!Number.isFinite(time)) throw new TypeError("targetTime must be a valid Date");
  return time;
}

function metricPoints(snapshots: CumulativeSnapshot[], metric: MetricKey) {
  return snapshots.flatMap((snapshot) => {
    const timestamp = snapshot.timestamp.getTime();
    if (!Number.isFinite(timestamp)) throw new TypeError("snapshot timestamp must be valid");
    const value = snapshot[metric];
    if (value === null || value === undefined) return [];
    if (!Number.isFinite(value)) throw new TypeError(`${metric} must be finite`);
    if (value < 0) throw new RangeError(`${metric} must be nonnegative`);
    return [{ timestamp, value }];
  }).sort((left, right) => left.timestamp - right.timestamp);
}

/** Exact → interpolate within ±maxGap → nearest within ±maxGap. */
export function estimateCumulativeMetricAtTime(input: {
  snapshots: CumulativeSnapshot[];
  targetTime: Date;
  metric: MetricKey;
  maxGapMinutes?: number;
}): MetricBoundaryEstimate {
  const target = validateTarget(input.targetTime);
  const targetIso = input.targetTime.toISOString();
  const maxGapMinutes = input.maxGapMinutes ?? DEFAULT_SNAPSHOT_MAX_GAP_MINUTES;
  validateMaxGap(maxGapMinutes);
  const points = metricPoints(input.snapshots, input.metric);
  if (points.length === 0) return { value: null, targetTime: targetIso, reason: "insufficient-data" };

  const exact = points.findLast((point) => point.timestamp === target);
  if (exact) {
    return {
      value: exact.value,
      targetTime: targetIso,
      sourceTimes: [new Date(exact.timestamp).toISOString()],
      gapMinutes: 0,
      method: "exact",
    };
  }

  const before = points.findLast((point) => point.timestamp < target);
  const after = points.find((point) => point.timestamp > target);
  if (before && after) {
    const beforeGap = (target - before.timestamp) / 60_000;
    const afterGap = (after.timestamp - target) / 60_000;
    if (beforeGap <= maxGapMinutes && afterGap <= maxGapMinutes) {
      if (after.value < before.value) {
        return { value: null, targetTime: targetIso, reason: "counter-decreased" };
      }
      const fraction = (target - before.timestamp) / (after.timestamp - before.timestamp);
      return {
        value: before.value + (after.value - before.value) * fraction,
        targetTime: targetIso,
        sourceTimes: [new Date(before.timestamp).toISOString(), new Date(after.timestamp).toISOString()],
        gapMinutes: Math.max(beforeGap, afterGap),
        method: "interpolated",
      };
    }
  }

  const nearest = points.reduce((best, point) =>
    Math.abs(point.timestamp - target) < Math.abs(best.timestamp - target) ? point : best);
  const gapMinutes = Math.abs(nearest.timestamp - target) / 60_000;
  if (gapMinutes > maxGapMinutes) {
    return { value: null, targetTime: targetIso, reason: "gap-too-large" };
  }
  return {
    value: nearest.value,
    targetTime: targetIso,
    sourceTimes: [new Date(nearest.timestamp).toISOString()],
    gapMinutes,
    method: "nearest",
  };
}

export type IntervalMetricEstimate = {
  value: number | null;
  start: MetricBoundaryEstimate;
  end: MetricBoundaryEstimate;
  reason?: "insufficient-data" | "gap-too-large" | "counter-decreased";
};

export type SnapshotCoverage = {
  startGapMinutes: number;
  endGapMinutes: number;
};

function nearestSnapshotGapMinutes(snapshots: CumulativeSnapshot[], targetTime: Date): number {
  const target = validateTarget(targetTime);
  if (snapshots.length === 0) throw new RangeError("at least one snapshot is required");
  return Math.min(...snapshots.map((snapshot) => {
    const timestamp = validateTarget(snapshot.timestamp);
    return Math.abs(timestamp - target) / 60_000;
  }));
}

function intervalMetric(
  snapshots: CumulativeSnapshot[],
  startTime: Date,
  endTime: Date,
  metric: MetricKey,
  maxGapMinutes: number,
): IntervalMetricEstimate {
  const start = estimateCumulativeMetricAtTime({ snapshots, targetTime: startTime, metric, maxGapMinutes });
  const end = estimateCumulativeMetricAtTime({ snapshots, targetTime: endTime, metric, maxGapMinutes });
  if (start.value === null) return { value: null, start, end, reason: start.reason };
  if (end.value === null) return { value: null, start, end, reason: end.reason };
  const value = end.value - start.value;
  if (value < 0) return { value: null, start, end, reason: "counter-decreased" };
  return { value, start, end };
}

function validateActivitySamples(samples: readonly ActivityIntervalSample[]): void {
  for (const sample of samples) {
    const start = validateTarget(sample.startTime);
    const end = validateTarget(sample.endTime);
    if (end <= start) throw new RangeError("activity samples must have positive duration");
    if (!Number.isFinite(sample.value)) throw new TypeError("activity sample value must be finite");
    if (sample.value < 0) throw new RangeError("activity sample value must be nonnegative");
  }
}

function remainingRanges(
  start: number,
  end: number,
  blocked: readonly { start: number; end: number }[],
): Array<{ start: number; end: number }> {
  let parts = end > start ? [{ start, end }] : [];
  for (const block of blocked) {
    parts = parts.flatMap((part) => {
      const lo = Math.max(part.start, block.start);
      const hi = Math.min(part.end, block.end);
      if (hi <= lo) return [part];
      const out: Array<{ start: number; end: number }> = [];
      if (part.start < lo) out.push({ start: part.start, end: lo });
      if (hi < part.end) out.push({ start: hi, end: part.end });
      return out;
    });
  }
  return parts.filter((part) => part.end > part.start);
}

export type IntervalAllocationClaim = { start: number; end: number };

/**
 * Attribute interval-sample values onto a window without double-counting overlap.
 * Shorter samples claim time first so nested hourly records beat a day-long dump.
 */
export function allocateIntervalSampleValue(input: {
  samples: readonly ActivityIntervalSample[];
  startTime: Date;
  endTime: Date;
  claimedMs?: IntervalAllocationClaim[];
  excludedWindows?: readonly { startTime: Date; endTime: Date }[];
}): { value: number; claimedSampleIndexes: number[] } {
  const windowStart = validateTarget(input.startTime);
  const windowEnd = validateTarget(input.endTime);
  if (windowEnd <= windowStart) throw new RangeError("allocation window must have positive duration");
  validateActivitySamples(input.samples);

  const blocked: IntervalAllocationClaim[] = [
    ...(input.claimedMs ?? []),
    ...(input.excludedWindows ?? []).map((window) => ({
      start: window.startTime.getTime(),
      end: window.endTime.getTime(),
    })),
  ];
  const ranked = input.samples
    .map((sample, index) => ({ sample, index }))
    .sort((left, right) => {
      const leftDuration = left.sample.endTime.getTime() - left.sample.startTime.getTime();
      const rightDuration = right.sample.endTime.getTime() - right.sample.startTime.getTime();
      return leftDuration - rightDuration || left.sample.startTime.getTime() - right.sample.startTime.getTime();
    });

  let value = 0;
  const newlyClaimed: IntervalAllocationClaim[] = [];
  const claimedSampleIndexes: number[] = [];
  for (const { sample, index } of ranked) {
    const sampleStart = sample.startTime.getTime();
    const sampleEnd = sample.endTime.getTime();
    const overlapStart = Math.max(windowStart, sampleStart);
    const overlapEnd = Math.min(windowEnd, sampleEnd);
    const free = remainingRanges(overlapStart, overlapEnd, [...blocked, ...newlyClaimed]);
    if (free.length === 0) continue;
    let used = false;
    for (const piece of free) {
      value += sample.value * (piece.end - piece.start) / (sampleEnd - sampleStart);
      newlyClaimed.push(piece);
      used = true;
    }
    if (used) claimedSampleIndexes.push(index);
  }
  input.claimedMs?.push(...newlyClaimed);
  return { value, claimedSampleIndexes };
}

/**
 * Apple Health interval samples record a value over a span, rather than a
 * cumulative counter at one point. Allocate a boundary-crossing sample by the
 * exact time overlap, so a work period never needs a nearby sync snapshot.
 */
export function estimateIntervalSampleMetric(input: {
  samples: readonly ActivityIntervalSample[];
  startTime: Date;
  endTime: Date;
}): IntervalMetricEstimate {
  const start = validateTarget(input.startTime);
  const end = validateTarget(input.endTime);
  if (end <= start) throw new RangeError("work interval must have positive duration");
  validateActivitySamples(input.samples);
  if (input.samples.length === 0) {
    const unavailable = (targetTime: Date): UnavailableBoundaryEstimate => ({
      value: null,
      targetTime: targetTime.toISOString(),
      reason: "insufficient-data",
    });
    return { value: null, start: unavailable(input.startTime), end: unavailable(input.endTime), reason: "insufficient-data" };
  }
  const { value } = allocateIntervalSampleValue({
    samples: input.samples,
    startTime: input.startTime,
    endTime: input.endTime,
  });
  const sourceTimes = input.samples
    .filter((sample) => sample.startTime.getTime() < end && sample.endTime.getTime() > start)
    .flatMap((sample) => [sample.startTime.toISOString(), sample.endTime.toISOString()]);
  const boundary = (targetTime: Date): BoundaryEstimate => ({
    value,
    targetTime: targetTime.toISOString(),
    sourceTimes,
    gapMinutes: 0,
    method: "interval-overlap",
  });
  return { value, start: boundary(input.startTime), end: boundary(input.endTime) };
}

export function estimateWorkIntervalWalking(input: {
  snapshots: CumulativeSnapshot[];
  startTime: Date;
  endTime: Date;
  maxGapMinutes?: number;
}): {
  estimatedSteps: IntervalMetricEstimate;
  estimatedWalkingDistanceKm: IntervalMetricEstimate;
  snapshotCoverage: SnapshotCoverage | null;
} {
  const start = validateTarget(input.startTime);
  const end = validateTarget(input.endTime);
  if (end <= start) throw new RangeError("work interval must have positive duration");
  const maxGapMinutes = input.maxGapMinutes ?? DEFAULT_SNAPSHOT_MAX_GAP_MINUTES;
  validateMaxGap(maxGapMinutes);
  return {
    estimatedSteps: intervalMetric(input.snapshots, input.startTime, input.endTime, "steps", maxGapMinutes),
    estimatedWalkingDistanceKm: intervalMetric(
      input.snapshots, input.startTime, input.endTime, "walkingDistanceKm", maxGapMinutes,
    ),
    snapshotCoverage: input.snapshots.length === 0 ? null : {
      startGapMinutes: nearestSnapshotGapMinutes(input.snapshots, input.startTime),
      endGapMinutes: nearestSnapshotGapMinutes(input.snapshots, input.endTime),
    },
  };
}

export function estimateDailyWorkWalking(input: {
  snapshots: CumulativeSnapshot[];
  activityIntervals?: {
    steps: readonly ActivityIntervalSample[];
    walkingDistanceKm: readonly ActivityIntervalSample[];
  };
  intervals: { id: number; startTime: Date; endTime: Date }[];
  dailyWalkingDistanceKm: number | null | undefined;
  maxGapMinutes?: number;
}) {
  if (input.dailyWalkingDistanceKm !== null && input.dailyWalkingDistanceKm !== undefined) {
    if (!Number.isFinite(input.dailyWalkingDistanceKm)) throw new TypeError("dailyWalkingDistanceKm must be finite");
    if (input.dailyWalkingDistanceKm < 0) throw new RangeError("dailyWalkingDistanceKm must be nonnegative");
  }
  const intervals = [...input.intervals].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  for (let index = 0; index < intervals.length; index += 1) {
    validateTarget(intervals[index].startTime);
    validateTarget(intervals[index].endTime);
    if (intervals[index].endTime <= intervals[index].startTime) {
      throw new RangeError("work intervals must have positive duration");
    }
    if (index > 0 && intervals[index].startTime < intervals[index - 1].endTime) {
      throw new RangeError("work intervals must not overlap");
    }
  }
  const estimates = intervals.map((interval) => {
    const legacy = estimateWorkIntervalWalking({
      snapshots: input.snapshots,
      startTime: interval.startTime,
      endTime: interval.endTime,
      maxGapMinutes: input.maxGapMinutes,
    });
    const useStepIntervals = (input.activityIntervals?.steps.length ?? 0) > 0;
    const useDistanceIntervals = (input.activityIntervals?.walkingDistanceKm.length ?? 0) > 0;
    return {
      intervalId: interval.id,
      estimatedSteps: useStepIntervals
        ? estimateIntervalSampleMetric({ samples: input.activityIntervals!.steps, startTime: interval.startTime, endTime: interval.endTime })
        : legacy.estimatedSteps,
      estimatedWalkingDistanceKm: useDistanceIntervals
        ? estimateIntervalSampleMetric({ samples: input.activityIntervals!.walkingDistanceKm, startTime: interval.startTime, endTime: interval.endTime })
        : legacy.estimatedWalkingDistanceKm,
      // The UI quality line describes walking distance, so only hide snapshot
      // coverage when distance itself came from interval records.
      snapshotCoverage: useDistanceIntervals ? null : legacy.snapshotCoverage,
    };
  });
  const distances = estimates.map(({ estimatedWalkingDistanceKm }) => estimatedWalkingDistanceKm.value);
  const workWalkingDistanceKm = distances.some((value) => value === null)
    ? null
    : distances.reduce<number>((sum, value) => sum + value!, 0);
  if (input.dailyWalkingDistanceKm === null || input.dailyWalkingDistanceKm === undefined
      || workWalkingDistanceKm === null) {
    return { intervals: estimates, workWalkingDistanceKm, outsideWorkWalkingDistanceKm: null };
  }
  const outsideWorkWalkingDistanceKm = input.dailyWalkingDistanceKm - workWalkingDistanceKm;
  if (outsideWorkWalkingDistanceKm < 0) {
    return {
      intervals: estimates,
      workWalkingDistanceKm,
      outsideWorkWalkingDistanceKm: null,
      outsideWorkFailure: "work-distance-exceeds-daily-total" as const,
    };
  }
  return { intervals: estimates, workWalkingDistanceKm, outsideWorkWalkingDistanceKm };
}
