/**
 * Strength Training Diary domain constants.
 * Resistance / session / match enums are stored as VarChar strings in Prisma.
 */

export const RESISTANCE = {
  EXTERNAL_WEIGHT: "EXTERNAL_WEIGHT",
  RESISTANCE_BAND: "RESISTANCE_BAND",
  BODYWEIGHT: "BODYWEIGHT",
} as const;

export type ResistanceType = (typeof RESISTANCE)[keyof typeof RESISTANCE];

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

/** Exact Ukrainian names seeded by migration 20260917160000_strength_training_diary. */
export const SEEDED_EXERCISE_NAMES = [
  "Жим гантелей на похилій лаві вгору (30°)",
  "Розведення гантелей на горизонтальній лаві",
  "Віджимання від ручок",
  "Жим гантелей сидячи",
  "Махи гантеллю однією рукою вбік",
  "Розгинання однієї руки в блоці",
  "Розгинання однієї руки з гантеллю в нахилі",
  "Тяга горизонтального блоку сидячи однією рукою",
  "Гіперекстензія",
  "Згинання однієї руки від коліна",
  "Згинання рук з розворотом сидячи на похилій лаві",
  "Згинання кисті з гантеллю в упорі",
] as const;

export const DEFAULT_TRAINING_PROFILE_ID = 1;

/**
 * ENGINEERING ASSUMPTION — NOT SCIENTIFIC PARAMETER
 *
 * Conservative time-window thresholds for diary ↔ Garmin strength matching.
 * Prefer missed auto-match over a wrong link. Values are product engineering
 * choices for sync latency / clock skew — not physiological parameters.
 */
export const MATCH_THRESHOLDS = {
  /** Maximum |session.start − workout.start| for a plausible candidate. */
  maxStartDeltaMs: 20 * 60_000,
  /** Maximum |session.end − workout.end| for a plausible candidate. */
  maxEndDeltaMs: 20 * 60_000,
  /** Absolute minimum overlap between intervals. */
  minOverlapMs: 5 * 60_000,
  /** Minimum overlap as a fraction of the shorter interval. */
  minOverlapRatio: 0.5,
  /** Maximum relative duration difference |d1−d2| / max(d1,d2). */
  maxDurationRelativeDelta: 0.35,
  /** Tighter start window required for a uniquely strong auto-match. */
  strongStartDeltaMs: 10 * 60_000,
  /** Tighter end window required for a uniquely strong auto-match. */
  strongEndDeltaMs: 10 * 60_000,
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
  recentSessionsDefaultLimit: 20,
} as const;
