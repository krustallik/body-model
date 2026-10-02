import type {
  DiaryCompleteness,
  EntryMode,
  ExerciseOrigin,
  MatchMethod,
  MatchStatus,
  ResistanceType,
  SessionStatus,
} from "./training.constants";
import type { BodyweightReferenceV1, LoadAccountingBreakdownV1, LoadAccountingOutputV1 } from "./load-accounting-v1";

export type ExerciseCatalogDto = {
  id: number;
  name: string;
  /** Null is valid for custom exercises; it means portable mapping identity is unavailable. */
  stableKey: string | null;
  isActive: boolean;
  archivedAt: string | null;
  muscleMapping: unknown | null;
  loadAccountingConfig?: unknown | null;
};

export type ProgramExerciseDto = {
  id: number;
  catalogId: number;
  catalogName: string;
  order: number;
  plannedSets: number;
  resistanceType: ResistanceType;
  loadAccountingConfigSnapshot?: unknown | null;
};

export type TrainingProgramDto = {
  id: number;
  name: string;
  archivedAt: string | null;
  currentVersionId: number | null;
  currentVersionNumber: number | null;
  exercises: ProgramExerciseDto[];
  createdAt: string;
  updatedAt: string;
};

export type TrainingProgramSummaryDto = {
  id: number;
  name: string;
  archivedAt: string | null;
  currentVersionId: number | null;
  currentVersionNumber: number | null;
  exerciseCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ProgramVersionSummaryDto = {
  id: number;
  programId: number;
  versionNumber: number;
  exerciseCount: number;
  createdAt: string;
};

export type StrengthSetDto = {
  id: number;
  sessionExerciseId: number;
  setNumber: number;
  reps: number;
  weightKg: number | null;
  bandNominalResistanceKg: number | null;
  /** Null = not reported. Null is never RIR 0. */
  rir: number | null;
  comment: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  loadAccountingOverride?: unknown | null;
};

export type ExerciseHistorySetDto = {
  setNumber: number;
  /** Actual set completion instant; null when the source did not record it. */
  completedAt: string | null;
  reps: number;
  weightKg: number | null;
  bandNominalResistanceKg: number | null;
  rir: number | null;
  comment: string | null;
};

export type ExerciseHistoryEntryDto = {
  sessionId: number;
  occurredAt: string;
  programName: string;
  resistanceType: ResistanceType;
  sets: ExerciseHistorySetDto[];
};

export type StrengthSessionExerciseDto = {
  id: number;
  sourceExerciseCatalogId: number | null;
  /** Portable catalog identity when the source catalog row is still linked. */
  stableKey: string | null;
  snapshotExerciseName: string;
  order: number;
  plannedSets: number;
  resistanceType: ResistanceType;
  origin: ExerciseOrigin;
  muscleMappingSnapshot: unknown | null;
  loadAccountingConfigSnapshot?: unknown | null;
  sets: StrengthSetDto[];
};

export type SelectedActiveEnergyDto = {
  kcal: number | null;
  source: string;
  fullCoverage: boolean;
  resolutionRevision?: number | null;
};

export type MatchedWorkoutDto = {
  id: number;
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  manualActiveEnergyKcal?: number | null;
  externalId: string | null;
};

export type StrengthSessionDto = {
  id: number;
  status: SessionStatus;
  entryMode: EntryMode;
  revision: number;
  programId: number;
  programName: string;
  programVersionId: number;
  programVersionNumber: number;
  /** Null for RETROSPECTIVE — no live web Start Workout occurred. */
  webStartedAt: string | null;
  webEndedAt: string | null;
  effectiveAccountingAt?: string | null;
  accountingTimeZone?: string | null;
  accountingTimeZoneProvenance?: string | null;
  matchStatus: MatchStatus;
  matchMethod: MatchMethod | null;
  matchedAt: string | null;
  matchedWorkoutId: number | null;
  matchedWorkout: MatchedWorkoutDto | null;
  /** Canonical selected active energy. Device kcal stays on matchedWorkout. */
  selectedActiveEnergy?: SelectedActiveEnergyDto;
  exercises: StrengthSessionExerciseDto[];
  ordinaryTonnageKg: number | null;
  /** Whether the persisted Stage 02 result matches the current accounting inputs. */
  materializationState?: "current" | "missing" | "pending" | "stale";
  /** Authoritative persisted Stage 02 mass snapshot for active-energy calculation. */
  activeEnergyMassReference?: {
    reference: BodyweightReferenceV1;
    snapshotRevision: number;
    inputFingerprint: string;
    massResolutionIdentity: string;
  } | null;
  loadAccountingV1?: LoadAccountingOutputV1;
  /** Persisted Stage 02 rows; legacy aggregate snapshots report an explicit unavailable state. */
  loadAccountingBreakdown?:
    | { status: "available"; value: LoadAccountingBreakdownV1 }
    | { status: "unavailable"; reason: "legacy-snapshot-no-breakdown" };
  autoAdvanceExercises?: boolean;
  loggedSets?: number;
  plannedSets?: number;
  /** May exceed 100 when extra sets were logged. Null if plannedSets is 0. */
  planCompletionPercent?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type StrengthSessionSummaryDto = {
  id: number;
  status: SessionStatus;
  entryMode: EntryMode;
  programId: number;
  programName: string;
  webStartedAt: string | null;
  webEndedAt: string | null;
  matchStatus: MatchStatus;
  matchMethod: MatchMethod | null;
  matchedWorkoutId: number | null;
  occurrenceAt: string | null;
  loggedSets: number;
  plannedSets: number;
  planCompletionPercent: number | null;
};

export type MatchCandidateDto = {
  id: number;
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  externalId: string | null;
  alreadyMatched: boolean;
};

export type HistoricalStrengthWorkoutDto = {
  workoutId: number;
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  linkedSessionId: number | null;
  linkedProgramName: string | null;
  diaryCompleteness: DiaryCompleteness;
};
