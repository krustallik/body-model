import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { MATCH_THRESHOLDS } from "./training.constants";

export type MatchInterval = {
  startAt: Date;
  endAt: Date;
};

export type MatchWorkoutCandidate = {
  id: number;
  type: string;
  startAt: Date;
  endAt: Date;
  /** Already linked to another diary session — never auto-selected. */
  alreadyMatched?: boolean;
};

export type MatchOutcomeKind = "MATCH" | "AMBIGUOUS" | "NO_MATCH";

export type ScoredMatchCandidate = {
  id: number;
  startDeltaMs: number;
  endDeltaMs: number;
  overlapMs: number;
  overlapRatio: number;
  durationRelativeDelta: number;
  strong: boolean;
};

export type MatchDiaryResult = {
  kind: MatchOutcomeKind;
  /** Present only when kind === MATCH. */
  workoutId: number | null;
  plausible: ScoredMatchCandidate[];
  reason: string;
};

function durationMs(interval: MatchInterval): number {
  return Math.max(0, interval.endAt.getTime() - interval.startAt.getTime());
}

function overlapMs(a: MatchInterval, b: MatchInterval): number {
  const start = Math.max(a.startAt.getTime(), b.startAt.getTime());
  const end = Math.min(a.endAt.getTime(), b.endAt.getTime());
  return Math.max(0, end - start);
}

function isCanonicalStrength(type: string): boolean {
  return canonicalizeWorkoutType(type).classification === "traditional-strength-training";
}

function scoreCandidate(
  session: MatchInterval,
  workout: MatchInterval,
): Omit<ScoredMatchCandidate, "id" | "strong"> & { strong: boolean } | null {
  const sessionDuration = durationMs(session);
  const workoutDuration = durationMs(workout);
  if (sessionDuration <= 0 || workoutDuration <= 0) return null;

  const startDeltaMs = Math.abs(session.startAt.getTime() - workout.startAt.getTime());
  const endDeltaMs = Math.abs(session.endAt.getTime() - workout.endAt.getTime());
  const overlap = overlapMs(session, workout);
  const shorter = Math.min(sessionDuration, workoutDuration);
  const overlapRatio = shorter > 0 ? overlap / shorter : 0;
  const durationRelativeDelta =
    Math.abs(sessionDuration - workoutDuration) / Math.max(sessionDuration, workoutDuration);

  if (startDeltaMs > MATCH_THRESHOLDS.maxStartDeltaMs) return null;
  if (endDeltaMs > MATCH_THRESHOLDS.maxEndDeltaMs) return null;
  if (overlap < MATCH_THRESHOLDS.minOverlapMs) return null;
  if (overlapRatio < MATCH_THRESHOLDS.minOverlapRatio) return null;
  if (durationRelativeDelta > MATCH_THRESHOLDS.maxDurationRelativeDelta) return null;

  const strong =
    startDeltaMs <= MATCH_THRESHOLDS.strongStartDeltaMs
    && endDeltaMs <= MATCH_THRESHOLDS.strongEndDeltaMs
    && overlapRatio >= MATCH_THRESHOLDS.strongMinOverlapRatio;

  return {
    startDeltaMs,
    endDeltaMs,
    overlapMs: overlap,
    overlapRatio,
    durationRelativeDelta,
    strong,
  };
}

/**
 * Pure diary ↔ Garmin strength matcher.
 * Only canonical traditional-strength-training is eligible; stair-climbing never is.
 * Does not use kcal. Auto-match only on a uniquely strong candidate.
 */
export function matchDiaryToWorkouts(
  sessionInterval: MatchInterval,
  candidates: readonly MatchWorkoutCandidate[],
): MatchDiaryResult {
  if (!(sessionInterval.endAt > sessionInterval.startAt)) {
    return { kind: "NO_MATCH", workoutId: null, plausible: [], reason: "invalid_session_interval" };
  }

  const plausible: ScoredMatchCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.alreadyMatched) continue;
    if (!isCanonicalStrength(candidate.type)) continue;

    const scored = scoreCandidate(sessionInterval, {
      startAt: candidate.startAt,
      endAt: candidate.endAt,
    });
    if (!scored) continue;

    plausible.push({ id: candidate.id, ...scored });
  }

  if (plausible.length === 0) {
    return { kind: "NO_MATCH", workoutId: null, plausible, reason: "no_plausible_candidate" };
  }

  if (plausible.length >= 2) {
    return { kind: "AMBIGUOUS", workoutId: null, plausible, reason: "multiple_plausible_candidates" };
  }

  const only = plausible[0]!;
  if (!only.strong) {
    return { kind: "NO_MATCH", workoutId: null, plausible, reason: "unique_but_not_strong" };
  }

  return { kind: "MATCH", workoutId: only.id, plausible, reason: "unique_strong_candidate" };
}
