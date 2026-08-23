export const DEFAULT_SNAPSHOT_MAX_GAP_MINUTES = 45;

export type CumulativeSnapshot = {
  timestamp: Date;
  steps: number | null | undefined;
  walkingDistanceKm: number | null | undefined;
};

export type BoundaryEstimate = {
  value: number;
  targetTime: string;
  sourceTimes: string[];
  gapMinutes: number;
  method: "exact" | "interpolated" | "nearest";
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

export function estimateWorkIntervalWalking(input: {
  snapshots: CumulativeSnapshot[];
  startTime: Date;
  endTime: Date;
  maxGapMinutes?: number;
}): { estimatedSteps: IntervalMetricEstimate; estimatedWalkingDistanceKm: IntervalMetricEstimate } {
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
  };
}

export function estimateDailyWorkWalking(input: {
  snapshots: CumulativeSnapshot[];
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
  const estimates = intervals.map((interval) => ({
    intervalId: interval.id,
    ...estimateWorkIntervalWalking({
      snapshots: input.snapshots,
      startTime: interval.startTime,
      endTime: interval.endTime,
      maxGapMinutes: input.maxGapMinutes,
    }),
  }));
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
