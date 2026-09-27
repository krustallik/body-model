import { localDateTimeToInstant } from "@/model/time-zone";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import {
  DISTANCE_ALLOCATION_POLICY_V1,
  classifyDistanceIntervalsV1,
  finiteNonNegative,
  fourCellTotalKm,
  type DistanceIntervalV1,
  type DistanceMethodV1,
  type FourCellDistanceV1,
} from "./canonical-activity-policy-v1";

const SUM_EPSILON_KM = 1e-9;

export type StepSampleSourceV1 = "apple" | "garmin" | "manual-ms100";

export type StepSampleV1 = {
  id: string;
  startMs: number;
  endMs: number;
  steps: number;
  source: StepSampleSourceV1;
};

export type TimeWindowV1 = {
  id: string;
  startMs: number;
  endMs: number;
};

export type DayBoundV1 = {
  date: string;
  startMs: number;
  endMs: number;
};

export type DistanceLedgerSliceV1 = {
  date: string;
  intervalId: string;
  startMs: number;
  endMs: number;
  distanceKm: number;
  method: DistanceMethodV1;
  coveredBudgetKm: number;
  uncoveredBudgetKm: number;
  coveredMethod: DistanceMethodV1;
  uncoveredMethod: DistanceMethodV1 | null;
  cells: FourCellDistanceV1;
};

export type DistanceLedgerDayV1 = {
  date: string;
  complete: boolean;
  conflicted: boolean;
  partialCoverage: boolean;
  knownAcceptedSubtotalKm: number;
  cells: FourCellDistanceV1;
  invalidated: boolean;
};

export type DistanceLedgerV1 = {
  policyVersion: typeof DISTANCE_ALLOCATION_POLICY_V1;
  rawSumKm: number;
  knownAcceptedSubtotalKm: number;
  /** False when any source conflict or partial step coverage remains. */
  complete: boolean;
  conflictedIntervalIds: string[];
  slices: DistanceLedgerSliceV1[];
  days: DistanceLedgerDayV1[];
  /** Old and new local dates touched by a cross-midnight split. */
  invalidatedDates: string[];
  workWindowWithoutStepperKm: Record<string, number>;
  workWindowStepperOverlapHours: Record<string, number>;
};

export function localDayBoundV1(date: string, timeZone: string): DayBoundV1 {
  const startMs = localDateTimeToInstant(date, "00:00", timeZone).getTime();
  const endMs = localDateTimeToInstant(addCalendarDays(date, 1), "00:00", timeZone).getTime();
  return { date, startMs, endMs };
}

export function dayBoundsAroundV1(date: string, timeZone: string): DayBoundV1[] {
  return [
    localDayBoundV1(addCalendarDays(date, -1), timeZone),
    localDayBoundV1(date, timeZone),
    localDayBoundV1(addCalendarDays(date, 1), timeZone),
  ];
}

function emptyCells(): FourCellDistanceV1 {
  return {
    workWithoutStepperKm: 0,
    workWithStepperKm: 0,
    outsideWithoutStepperKm: 0,
    outsideWithStepperKm: 0,
  };
}

function addCells(left: FourCellDistanceV1, right: FourCellDistanceV1): FourCellDistanceV1 {
  return {
    workWithoutStepperKm: left.workWithoutStepperKm + right.workWithoutStepperKm,
    workWithStepperKm: left.workWithStepperKm + right.workWithStepperKm,
    outsideWithoutStepperKm: left.outsideWithoutStepperKm + right.outsideWithoutStepperKm,
    outsideWithStepperKm: left.outsideWithStepperKm + right.outsideWithStepperKm,
  };
}

function overlapMs(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function unionDurationMs(ranges: readonly { startMs: number; endMs: number }[]): number {
  const sorted = ranges
    .filter((range) => range.endMs > range.startMs)
    .map((range) => ({ startMs: range.startMs, endMs: range.endMs }))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  let total = 0;
  let cursor = -Infinity;
  for (const range of sorted) {
    const start = Math.max(range.startMs, cursor);
    if (range.endMs > start) total += range.endMs - start;
    cursor = Math.max(cursor, range.endMs);
  }
  return total;
}

function denominatorSamples(samples: readonly StepSampleV1[]): StepSampleV1[] {
  return samples.filter((sample) => sample.source !== "manual-ms100" && sample.endMs > sample.startMs && sample.steps >= 0);
}

type AtomicSegment = {
  startMs: number;
  endMs: number;
  distanceKm: number;
  covered: boolean;
  inWork: boolean;
  inStepper: boolean;
  workWindowId: string | null;
};

function allocateSlice(input: {
  date: string;
  intervalId: string;
  startMs: number;
  endMs: number;
  distanceKm: number;
  stepSamples: readonly StepSampleV1[];
  workWindows: readonly TimeWindowV1[];
  stepperWindows: readonly TimeWindowV1[];
}): DistanceLedgerSliceV1 & { workWindowKm: Record<string, number> } {
  const duration = input.endMs - input.startMs;
  if (!(duration > 0)) throw new RangeError("slice must have positive duration");
  const samples = denominatorSamples(input.stepSamples).map((sample) => ({
    ...sample,
    startMs: Math.max(sample.startMs, input.startMs),
    endMs: Math.min(sample.endMs, input.endMs),
  })).filter((sample) => sample.endMs > sample.startMs);
  const coveredMs = unionDurationMs(samples);
  const uncoveredMs = duration - coveredMs;
  const coveredBudgetKm = input.distanceKm * (coveredMs / duration);
  const uncoveredBudgetKm = input.distanceKm - coveredBudgetKm;
  const boundaries = new Set<number>([input.startMs, input.endMs]);
  for (const sample of samples) {
    boundaries.add(sample.startMs);
    boundaries.add(sample.endMs);
  }
  for (const window of [...input.workWindows, ...input.stepperWindows]) {
    if (window.endMs <= input.startMs || window.startMs >= input.endMs) continue;
    boundaries.add(Math.max(window.startMs, input.startMs));
    boundaries.add(Math.min(window.endMs, input.endMs));
  }
  const points = [...boundaries].sort((left, right) => left - right);
  const segments: AtomicSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const startMs = points[index]!;
    const endMs = points[index + 1]!;
    if (endMs <= startMs) continue;
    const midpoint = startMs + (endMs - startMs) / 2;
    const covered = samples.some((sample) => sample.startMs <= midpoint && midpoint < sample.endMs);
    const workOwners = input.workWindows.filter((window) => window.startMs <= midpoint && midpoint < window.endMs);
    const inStepper = input.stepperWindows.some((window) => window.startMs <= midpoint && midpoint < window.endMs);
    segments.push({
      startMs,
      endMs,
      distanceKm: 0,
      covered,
      inWork: workOwners.length > 0,
      inStepper,
      workWindowId: workOwners.length === 1 ? workOwners[0]!.id : null,
    });
  }
  const coveredSegments = segments.filter((segment) => segment.covered);
  const uncoveredSegments = segments.filter((segment) => !segment.covered);
  let coveredSteps = 0;
  const segmentSteps = new Map<AtomicSegment, number>();
  for (const segment of coveredSegments) {
    let steps = 0;
    for (const sample of samples) {
      const overlap = overlapMs(segment.startMs, segment.endMs, sample.startMs, sample.endMs);
      const sampleDuration = sample.endMs - sample.startMs;
      if (overlap > 0 && sampleDuration > 0) steps += sample.steps * (overlap / sampleDuration);
    }
    segmentSteps.set(segment, steps);
    coveredSteps += steps;
  }
  const oneCoarseSample = samples.length === 1
    && samples[0]!.startMs <= input.startMs
    && samples[0]!.endMs >= input.endMs
    && (samples[0]!.endMs - samples[0]!.startMs) > duration;
  const coveredMethod: DistanceMethodV1 = coveredMs === 0
    ? "time-weighted-missing-steps"
    : coveredSteps === 0
      ? "observed-zero-steps"
      : oneCoarseSample
        ? "coarse-step-boundary-assumed"
        : uncoveredMs === 0
          ? "fully-step-supported"
          : "step-reallocation-within-time-budget";
  const uncoveredMethod: DistanceMethodV1 | null = uncoveredMs === 0 ? null : "time-weighted-missing-steps";
  const method: DistanceMethodV1 = uncoveredMs === 0 ? coveredMethod : coveredSteps > 0
    ? "step-reallocation-within-time-budget"
    : "time-weighted-missing-steps";

  function assign(group: AtomicSegment[], budgetKm: number, mode: "time" | "steps"): void {
    if (group.length === 0 || budgetKm === 0) return;
    const weights = group.map((segment) => mode === "steps"
      ? (segmentSteps.get(segment) ?? 0)
      : segment.endMs - segment.startMs);
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    if (weightTotal === 0) return;
    let assigned = 0;
    let lastPositive = 0;
    weights.forEach((weight, index) => {
      if (weight > 0) lastPositive = index;
    });
    group.forEach((segment, index) => {
      const weight = weights[index] ?? 0;
      const distanceKm = index === lastPositive
        ? budgetKm - assigned
        : budgetKm * (weight / weightTotal);
      if (index <= lastPositive) {
        segment.distanceKm += distanceKm;
        assigned += distanceKm;
      }
    });
  }
  assign(uncoveredSegments, uncoveredBudgetKm, "time");
  assign(coveredSegments, coveredBudgetKm, coveredSteps === 0 ? "time" : "steps");

  const cells = emptyCells();
  const workWindowKm: Record<string, number> = {};
  for (const segment of segments) {
    if (segment.inWork && segment.inStepper) cells.workWithStepperKm += segment.distanceKm;
    else if (segment.inWork) cells.workWithoutStepperKm += segment.distanceKm;
    else if (segment.inStepper) cells.outsideWithStepperKm += segment.distanceKm;
    else cells.outsideWithoutStepperKm += segment.distanceKm;
    if (segment.workWindowId !== null && !segment.inStepper) {
      workWindowKm[segment.workWindowId] = (workWindowKm[segment.workWindowId] ?? 0) + segment.distanceKm;
    }
  }
  return {
    date: input.date,
    intervalId: input.intervalId,
    startMs: input.startMs,
    endMs: input.endMs,
    distanceKm: fourCellTotalKm(cells),
    method,
    coveredBudgetKm,
    uncoveredBudgetKm,
    coveredMethod,
    uncoveredMethod,
    cells,
    workWindowKm,
  };
}

export function allocateDistanceLedgerV1(input: {
  intervals: readonly DistanceIntervalV1[];
  stepSamples: readonly StepSampleV1[];
  workWindows: readonly TimeWindowV1[];
  stepperWindows: readonly TimeWindowV1[];
  dayBounds: readonly DayBoundV1[];
}): DistanceLedgerV1 {
  const clusters = classifyDistanceIntervalsV1(input.intervals);
  const rawSumKm = input.intervals.reduce((sum, interval) => sum + (finiteNonNegative(interval.distanceKm) ?? 0), 0);
  const conflictedIntervalIds = clusters
    .filter((cluster) => cluster.status === "source-conflicted")
    .flatMap((cluster) => cluster.intervalIds);
  const slices: DistanceLedgerSliceV1[] = [];
  const workWindowWithoutStepperKm: Record<string, number> = {};
  let unallocatedKm = 0;
  const datesTouchedByInterval = new Map<string, Set<string>>();

  for (const cluster of clusters) {
    if (cluster.status !== "accepted" || cluster.acceptedDistanceKm === null) continue;
    const interval = input.intervals.find((candidate) => candidate.id === cluster.intervalIds[0]);
    if (interval === undefined) continue;
    const distance = finiteNonNegative(cluster.acceptedDistanceKm);
    if (distance === null) continue;
    const duration = interval.endMs - interval.startMs;
    const overlapping = input.dayBounds
      .filter((day) => overlapMs(interval.startMs, interval.endMs, day.startMs, day.endMs) > 0)
      .sort((left, right) => left.startMs - right.startMs);
    const touched = new Set(overlapping.map((day) => day.date));
    datesTouchedByInterval.set(interval.id, touched);
    let allocatedDuration = 0;
    const pieces = overlapping.map((day) => {
      const startMs = Math.max(interval.startMs, day.startMs);
      const endMs = Math.min(interval.endMs, day.endMs);
      allocatedDuration += endMs - startMs;
      return { date: day.date, startMs, endMs };
    });
    const allocatedDistance = duration > 0 ? distance * (allocatedDuration / duration) : 0;
    unallocatedKm += distance - allocatedDistance;
    let assigned = 0;
    pieces.forEach((piece, index) => {
      const pieceDuration = piece.endMs - piece.startMs;
      const pieceDistance = index === pieces.length - 1
        ? allocatedDistance - assigned
        : distance * (pieceDuration / duration);
      assigned += pieceDistance;
      const slice = allocateSlice({
        date: piece.date,
        intervalId: interval.id,
        startMs: piece.startMs,
        endMs: piece.endMs,
        distanceKm: pieceDistance,
        stepSamples: input.stepSamples,
        workWindows: input.workWindows,
        stepperWindows: input.stepperWindows,
      });
      slices.push(slice);
      for (const [windowId, km] of Object.entries(slice.workWindowKm)) {
        workWindowWithoutStepperKm[windowId] = (workWindowWithoutStepperKm[windowId] ?? 0) + km;
      }
    });
  }

  const invalidatedDates = [...new Set(
    [...datesTouchedByInterval.values()]
      .filter((dates) => dates.size > 1)
      .flatMap((dates) => [...dates]),
  )].sort();

  const knownAcceptedSubtotalKm = slices.reduce((sum, slice) => sum + slice.distanceKm, 0);
  const partialCoverage = slices.some((slice) => slice.uncoveredBudgetKm > SUM_EPSILON_KM)
    || unallocatedKm > SUM_EPSILON_KM;
  const conflicted = conflictedIntervalIds.length > 0;
  const complete = !conflicted && !partialCoverage && unallocatedKm <= SUM_EPSILON_KM;

  const byDate = new Map<string, DistanceLedgerSliceV1[]>();
  for (const slice of slices) {
    const list = byDate.get(slice.date) ?? [];
    list.push(slice);
    byDate.set(slice.date, list);
  }
  const dayDates = new Set<string>([
    ...input.dayBounds.map((day) => day.date),
    ...byDate.keys(),
    ...invalidatedDates,
  ]);
  const days = [...dayDates].sort().map((date) => {
    const daySlices = byDate.get(date) ?? [];
    const cells = daySlices.reduce((sum, slice) => addCells(sum, slice.cells), emptyCells());
    const bound = input.dayBounds.find((day) => day.date === date);
    const dayPartial = daySlices.some((slice) => slice.uncoveredBudgetKm > SUM_EPSILON_KM);
    const dayConflict = input.intervals.some((interval) => (
      conflictedIntervalIds.includes(interval.id)
      && bound !== undefined
      && overlapMs(interval.startMs, interval.endMs, bound.startMs, bound.endMs) > 0
    ));
    return {
      date,
      complete: !dayConflict && !dayPartial && unallocatedKm <= SUM_EPSILON_KM,
      conflicted: dayConflict,
      partialCoverage: dayPartial || unallocatedKm > SUM_EPSILON_KM,
      knownAcceptedSubtotalKm: daySlices.reduce((sum, slice) => sum + slice.distanceKm, 0),
      cells,
      invalidated: invalidatedDates.includes(date),
    };
  });

  const workWindowStepperOverlapHours: Record<string, number> = {};
  for (const window of input.workWindows) {
    const overlap = input.stepperWindows.reduce((sum, stepper) => (
      sum + overlapMs(window.startMs, window.endMs, stepper.startMs, stepper.endMs)
    ), 0);
    workWindowStepperOverlapHours[window.id] = overlap / 3_600_000;
  }

  return {
    policyVersion: DISTANCE_ALLOCATION_POLICY_V1,
    rawSumKm,
    knownAcceptedSubtotalKm,
    complete,
    conflictedIntervalIds,
    slices,
    days,
    invalidatedDates,
    workWindowWithoutStepperKm,
    workWindowStepperOverlapHours,
  };
}
