import { instantToLocalDateTime } from "@/model/time-zone";
import {
  canonicalizeSleepState,
  isAsleepState,
  type AsleepState,
  type SleepState,
} from "@/modules/health/sleep-state";

export type SleepSegmentInput = {
  startAt: string;
  endAt: string;
  state: SleepState;
  rawState: string;
};

export type SleepSegmentInterval = {
  startAt: Date;
  endAt: Date;
  state: SleepState;
  rawState: string;
  /** Minutes east of UTC for the source wall clock at startAt, when known. */
  startOffsetMinutes?: number | null;
  /** Minutes east of UTC for the source wall clock at endAt, when known. */
  endOffsetMinutes?: number | null;
};

export type NightlySleepSummary = {
  sleepDate: string;
  sleepStartAt: string;
  sleepEndAt: string;
  timeInBedMinutes: number;
  totalSleepMinutes: number;
  awakeMinutes: number;
  coreMinutes: number;
  deepMinutes: number;
  remMinutes: number;
  unspecifiedSleepMinutes: number;
  /** Measured efficiency only when time-in-bed comes from inBed union; otherwise null. */
  sleepEfficiency: number | null;
  segmentCount: number;
  timeInBedProvenance: "inBed-union" | "session-span-fallback";
  sleepDateAttribution: "segment-offset" | "fallback-timezone" | "utc-instant";
  /** Wake-end wall offset used for sleepDate / local clock display, when known. */
  wakeOffsetMinutes: number | null;
  qualityFlags: string[];
  segments: Array<{
    startAt: string;
    endAt: string;
    state: SleepState;
    rawState: string;
  }>;
};

/** Gap longer than this starts a new sleep session when clustering segments. */
export const SLEEP_SESSION_GAP_MS = 4 * 60 * 60 * 1_000;

/**
 * When contradictory asleep stages overlap, each overlapping minute is assigned to
 * exactly one stage by this priority (highest wins): deep > rem > core > asleepUnspecified.
 * Stage totals therefore remain a partition of totalSleepMinutes.
 */
export const ASLEEP_STAGE_PRIORITY: readonly AsleepState[] = [
  "deep",
  "rem",
  "core",
  "asleepUnspecified",
];

type MsInterval = { startMs: number; endMs: number };

function toMsInterval(startAt: Date, endAt: Date): MsInterval | null {
  const startMs = startAt.getTime();
  const endMs = endAt.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

/** Parse `Z` / `±HH:MM` from an ISO datetime; null when absent. */
export function offsetMinutesFromIso(iso: string): number | null {
  const trimmed = iso.trim();
  if (/Z$/i.test(trimmed)) return 0;
  const match = /([+-])(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Calendar YYYY-MM-DD in the wall clock defined by offsetMinutes east of UTC. */
export function calendarDateAtOffset(instant: Date, offsetMinutes: number): string {
  const local = new Date(instant.getTime() + offsetMinutes * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/** Merge overlapping/adjacent intervals and return total duration in minutes. */
export function unionDurationMinutes(intervals: MsInterval[]): number {
  if (intervals.length === 0) return 0;
  const ordered = [...intervals].sort((left, right) => left.startMs - right.startMs);
  const merged: MsInterval[] = [{ ...ordered[0]! }];
  for (const interval of ordered.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (interval.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, interval.endMs);
      continue;
    }
    merged.push({ ...interval });
  }
  return merged.reduce((sum, { startMs, endMs }) => sum + (endMs - startMs), 0) / 60_000;
}

function intervalsOverlap(left: MsInterval, right: MsInterval): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function hasCrossStateAsleepOverlap(
  byState: Map<SleepState, MsInterval[]>,
): boolean {
  const asleep = ASLEEP_STAGE_PRIORITY
    .flatMap((state) => (byState.get(state) ?? []).map((interval) => ({ state, interval })));
  for (let i = 0; i < asleep.length; i += 1) {
    for (let j = i + 1; j < asleep.length; j += 1) {
      if (asleep[i]!.state === asleep[j]!.state) continue;
      if (intervalsOverlap(asleep[i]!.interval, asleep[j]!.interval)) return true;
    }
  }
  return false;
}

/**
 * Partition overlapping asleep intervals into disjoint stage totals.
 * Each timeline fragment is owned by the highest-priority covering stage.
 */
export function partitionAsleepStageMinutes(
  byState: Map<SleepState, MsInterval[]>,
): Record<AsleepState, number> {
  const covered = ASLEEP_STAGE_PRIORITY.flatMap((state) => (
    (byState.get(state) ?? []).map((interval) => ({ state, interval }))
  ));
  const totals: Record<AsleepState, number> = {
    deep: 0,
    rem: 0,
    core: 0,
    asleepUnspecified: 0,
  };
  if (covered.length === 0) return totals;

  const bounds = [...new Set(
    covered.flatMap(({ interval }) => [interval.startMs, interval.endMs]),
  )].sort((left, right) => left - right);

  for (let index = 0; index < bounds.length - 1; index += 1) {
    const startMs = bounds[index]!;
    const endMs = bounds[index + 1]!;
    if (endMs <= startMs) continue;
    const midpoint = (startMs + endMs) / 2;
    let winner: AsleepState | null = null;
    for (const state of ASLEEP_STAGE_PRIORITY) {
      const owns = (byState.get(state) ?? []).some(
        (interval) => interval.startMs <= midpoint && midpoint < interval.endMs,
      );
      if (owns) {
        winner = state;
        break;
      }
    }
    if (winner) totals[winner] += (endMs - startMs) / 60_000;
  }
  return totals;
}

function clusterSessions(segments: SleepSegmentInterval[]): SleepSegmentInterval[][] {
  if (segments.length === 0) return [];
  const ordered = [...segments].sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  const sessions: SleepSegmentInterval[][] = [[ordered[0]!]];
  for (const segment of ordered.slice(1)) {
    const current = sessions[sessions.length - 1]!;
    const previousEnd = Math.max(...current.map(({ endAt }) => endAt.getTime()));
    if (segment.startAt.getTime() - previousEnd > SLEEP_SESSION_GAP_MS) {
      sessions.push([segment]);
      continue;
    }
    current.push(segment);
  }
  return sessions;
}

function resolveSleepDate(
  sleepEndAt: Date,
  wakeSegment: SleepSegmentInterval,
  fallbackTimeZone?: string,
): Pick<NightlySleepSummary, "sleepDate" | "sleepDateAttribution" | "wakeOffsetMinutes"> {
  if (typeof wakeSegment.endOffsetMinutes === "number") {
    return {
      sleepDate: calendarDateAtOffset(sleepEndAt, wakeSegment.endOffsetMinutes),
      sleepDateAttribution: "segment-offset",
      wakeOffsetMinutes: wakeSegment.endOffsetMinutes,
    };
  }
  if (fallbackTimeZone) {
    return {
      sleepDate: instantToLocalDateTime(sleepEndAt, fallbackTimeZone).date,
      sleepDateAttribution: "fallback-timezone",
      wakeOffsetMinutes: null,
    };
  }
  // Last resort: UTC calendar date of the instant (never a hardcoded city zone).
  return {
    sleepDate: sleepEndAt.toISOString().slice(0, 10),
    sleepDateAttribution: "utc-instant",
    wakeOffsetMinutes: 0,
  };
}

function summarizeSession(
  session: SleepSegmentInterval[],
  fallbackTimeZone?: string,
): NightlySleepSummary | null {
  const intervals = session
    .map((segment) => {
      const interval = toMsInterval(segment.startAt, segment.endAt);
      return interval ? { segment, interval } : null;
    })
    .filter((row): row is { segment: SleepSegmentInterval; interval: MsInterval } => row !== null);
  if (intervals.length === 0) return null;

  const byState = new Map<SleepState, MsInterval[]>();
  for (const { segment, interval } of intervals) {
    byState.set(segment.state, [...(byState.get(segment.state) ?? []), interval]);
  }

  const asleepIntervals = intervals
    .filter(({ segment }) => isAsleepState(segment.state))
    .map(({ interval }) => interval);
  const awakeIntervals = byState.get("awake") ?? [];
  const inBedIntervals = byState.get("inBed") ?? [];

  const totalSleepMinutes = unionDurationMinutes(asleepIntervals);
  const awakeMinutes = unionDurationMinutes(awakeIntervals);
  const stageMinutes = partitionAsleepStageMinutes(byState);
  const hadAsleepOverlap = hasCrossStateAsleepOverlap(byState);

  const sleepStartMs = Math.min(...intervals.map(({ interval }) => interval.startMs));
  const sleepEndMs = Math.max(...intervals.map(({ interval }) => interval.endMs));
  const sleepStartAt = new Date(sleepStartMs);
  const sleepEndAt = new Date(sleepEndMs);
  const wakeSegment = intervals.reduce((best, row) => (
    row.interval.endMs >= best.interval.endMs ? row : best
  )).segment;
  const attribution = resolveSleepDate(sleepEndAt, wakeSegment, fallbackTimeZone);

  let timeInBedMinutes = unionDurationMinutes(inBedIntervals);
  let timeInBedProvenance: NightlySleepSummary["timeInBedProvenance"] = "inBed-union";
  if (timeInBedMinutes <= 0) {
    const relevant = intervals.filter(({ segment }) => (
      isAsleepState(segment.state) || segment.state === "awake" || segment.state === "inBed"
    ));
    if (relevant.length > 0) {
      const startMs = Math.min(...relevant.map(({ interval }) => interval.startMs));
      const endMs = Math.max(...relevant.map(({ interval }) => interval.endMs));
      timeInBedMinutes = (endMs - startMs) / 60_000;
      timeInBedProvenance = "session-span-fallback";
    }
  }

  const qualityFlags: string[] = [];
  if (hadAsleepOverlap) qualityFlags.push("overlapping-asleep-stages");
  if (timeInBedProvenance === "session-span-fallback") {
    qualityFlags.push("time-in-bed-derived-from-span");
  }

  // Measured efficiency only when time-in-bed is from real inBed samples.
  const sleepEfficiency = timeInBedProvenance === "inBed-union" && timeInBedMinutes > 0
    ? (totalSleepMinutes / timeInBedMinutes) * 100
    : null;

  return {
    sleepDate: attribution.sleepDate,
    sleepStartAt: sleepStartAt.toISOString(),
    sleepEndAt: sleepEndAt.toISOString(),
    timeInBedMinutes,
    totalSleepMinutes,
    awakeMinutes,
    coreMinutes: stageMinutes.core,
    deepMinutes: stageMinutes.deep,
    remMinutes: stageMinutes.rem,
    unspecifiedSleepMinutes: stageMinutes.asleepUnspecified,
    sleepEfficiency,
    segmentCount: session.length,
    timeInBedProvenance,
    sleepDateAttribution: attribution.sleepDateAttribution,
    wakeOffsetMinutes: attribution.wakeOffsetMinutes,
    qualityFlags,
    segments: session.map((segment) => ({
      startAt: segment.startAt.toISOString(),
      endAt: segment.endAt.toISOString(),
      state: segment.state,
      rawState: segment.rawState,
    })),
  };
}

/**
 * Cluster raw segments into nightly sessions and summarize each night.
 * Sleep date prefers the wake segment's recorded UTC offset; otherwise the
 * caller-supplied fallback IANA timezone (sync/profile); never a hardcoded city.
 * When multiple sessions share a sleepDate, keep the longest total-sleep session.
 */
export function buildNightlySleepSummaries(
  segments: SleepSegmentInterval[],
  fallbackTimeZone?: string,
): NightlySleepSummary[] {
  const byDate = new Map<string, NightlySleepSummary>();
  for (const session of clusterSessions(segments)) {
    const summary = summarizeSession(session, fallbackTimeZone);
    if (!summary) continue;
    const existing = byDate.get(summary.sleepDate);
    if (!existing || summary.totalSleepMinutes > existing.totalSleepMinutes) {
      byDate.set(summary.sleepDate, summary);
    }
  }
  return [...byDate.values()].sort((left, right) => left.sleepDate.localeCompare(right.sleepDate));
}

export function pickLatestCompletedSleep(
  summaries: NightlySleepSummary[],
  now: Date = new Date(),
): NightlySleepSummary | null {
  const completed = summaries
    .filter((summary) => Date.parse(summary.sleepEndAt) <= now.getTime())
    .sort((left, right) => right.sleepEndAt.localeCompare(left.sleepEndAt));
  return completed[0] ?? null;
}

export function toSleepSegmentInterval(input: SleepSegmentInput): SleepSegmentInterval {
  return {
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
    state: input.state,
    rawState: input.rawState,
    startOffsetMinutes: offsetMinutesFromIso(input.startAt),
    endOffsetMinutes: offsetMinutesFromIso(input.endAt),
  };
}

export function mapRawSleepState(rawState: string): Pick<SleepSegmentInput, "state" | "rawState"> {
  const trimmed = rawState.trim();
  return { state: canonicalizeSleepState(trimmed), rawState: trimmed };
}
