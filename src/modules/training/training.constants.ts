/**
 * Strength Training Diary domain constants.
 * Resistance / session / match enums are stored as VarChar strings in Prisma.
 */

import { CANONICAL_EXERCISE_IDENTITIES } from "./canonical-exercise-identity";

export const RESISTANCE = {
  EXTERNAL_WEIGHT: "EXTERNAL_WEIGHT",
  RESISTANCE_BAND: "RESISTANCE_BAND",
  BODYWEIGHT: "BODYWEIGHT",
} as const;

export type ResistanceType = (typeof RESISTANCE)[keyof typeof RESISTANCE];

/**
 * New program/session entries retain an editable resistance selector. This is
 * merely the safe default for the canonical standard pull-up, not a restriction
 * on recording a weighted variation later.
 */
export function recommendedResistanceTypeForCatalogStableKey(
  stableKey: string | null | undefined,
): ResistanceType {
  return stableKey === "pull_up" ? RESISTANCE.BODYWEIGHT : RESISTANCE.EXTERNAL_WEIGHT;
}

export const SESSION_STATUS = {
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

/**
 * PENDING = waiting for delayed Garmin (default after finish with no candidate).
 * UNMATCHED = explicit final only (manual unmatch / explicit finalize).
 * Finish without a candidate stays PENDING — never auto-UNMATCHED.
 */
export const MATCH_STATUS = {
  PENDING: "PENDING",
  MATCHED: "MATCHED",
  AMBIGUOUS: "AMBIGUOUS",
  UNMATCHED: "UNMATCHED",
} as const;

export type MatchStatus = (typeof MATCH_STATUS)[keyof typeof MATCH_STATUS];

export const MATCH_METHOD = {
  AUTO: "AUTO",
  MANUAL: "MANUAL",
  /** Direct one-to-one link when creating a retrospective diary from a Workout. */
  DIRECT_BACKFILL: "DIRECT_BACKFILL",
} as const;

export type MatchMethod = (typeof MATCH_METHOD)[keyof typeof MATCH_METHOD];

export const ENTRY_MODE = {
  LIVE: "LIVE",
  RETROSPECTIVE: "RETROSPECTIVE",
} as const;

export type EntryMode = (typeof ENTRY_MODE)[keyof typeof ENTRY_MODE];

export const EXERCISE_ORIGIN = {
  PLANNED: "PLANNED",
  EXTRA: "EXTRA",
} as const;

export type ExerciseOrigin = (typeof EXERCISE_ORIGIN)[keyof typeof EXERCISE_ORIGIN];

/** Backfill progress for historical strength workouts (UI only — not physiology). */
export const DIARY_COMPLETENESS = {
  NO_DIARY: "NO_DIARY",
  DIARY_EMPTY: "DIARY_EMPTY",
  DIARY_PARTIAL: "DIARY_PARTIAL",
  DIARY_WITH_SETS: "DIARY_WITH_SETS",
} as const;

export type DiaryCompleteness = (typeof DIARY_COMPLETENESS)[keyof typeof DIARY_COMPLETENESS];

/**
 * Exact Ukrainian display names for the original supported catalog.
 * Identity for model code is CANONICAL_EXERCISE_IDENTITIES[].stableKey — not these names.
 */
export const SEEDED_EXERCISE_NAMES = CANONICAL_EXERCISE_IDENTITIES.map(
  (exercise) => exercise.displayName,
);

export const DEFAULT_TRAINING_PROFILE_ID = 1;

/**
 * ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER
 *
 * Conservative time-window thresholds for diary ↔ Garmin strength matching.
 * Prefer missed auto-match over a wrong link. Values are product engineering
 * choices for sync latency / clock skew — not physiological parameters.
 * Unique traditional-strength candidates within ±1 hour auto-match; two
 * plausible workouts in that window stay AMBIGUOUS.
 */
export const MATCH_THRESHOLDS = {
  /** Maximum |session.start − workout.start| for a plausible candidate. */
  maxStartDeltaMs: 60 * 60_000,
  /** Maximum |session.end − workout.end| for a plausible candidate. */
  maxEndDeltaMs: 60 * 60_000,
  /** Absolute minimum overlap between intervals. */
  minOverlapMs: 5 * 60_000,
  /** Minimum overlap as a fraction of the shorter interval. */
  minOverlapRatio: 0.5,
  /** Maximum relative duration difference |d1−d2| / max(d1,d2). */
  maxDurationRelativeDelta: 0.35,
  /** Start window required for a uniquely strong auto-match. */
  strongStartDeltaMs: 60 * 60_000,
  /** End window required for a uniquely strong auto-match. */
  strongEndDeltaMs: 60 * 60_000,
  /** Stronger overlap fraction of the shorter interval for auto-match. */
  strongMinOverlapRatio: 0.7,
  /**
   * Completed sessions still PENDING longer than this appear in match-attention.
   * ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER
   */
  longPendingMs: 6 * 60 * 60_000,
} as const;

/** Engineering product bounds (not scientific). */
export const TRAINING_LIMITS = {
  maxProgramNameLength: 160,
  maxExercisesPerProgram: 40,
  maxPlannedSets: 50,
  maxReps: 10_000,
  maxLoadKg: 2_000,
  maxSetCommentLength: 280,
  /**
   * Optional StrengthSet.rir domain.
   * ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER:
   * 0–10 is a product input bound only. No RIR exclusion threshold is approved
   * (P-A04); null means not reported, never “RIR = 0”.
   */
  minRir: 0,
  maxRir: 10,
  recentSessionsDefaultLimit: 20,
} as const;
