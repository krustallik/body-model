import type {
  DiaryCompleteness,
  EntryMode,
  ExerciseOrigin,
  MatchMethod,
  MatchStatus,
  ResistanceType,
  SessionStatus,
} from "./training.constants";

export type ExerciseCatalogDto = {
  id: number;
  name: string;
  /** Null is valid for custom exercises; it means portable mapping identity is unavailable. */
  stableKey: string | null;
  isActive: boolean;
  archivedAt: string | null;
  muscleMapping: unknown | null;
};

export type ProgramExerciseDto = {
  id: number;
  catalogId: number;
  catalogName: string;
  order: number;
  plannedSets: number;
  resistanceType: ResistanceType;
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
};

export type ExerciseHistorySetDto = {
  setNumber: number;
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
  sets: StrengthSetDto[];
};

export type MatchedWorkoutDto = {
  id: number;
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
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
  matchStatus: MatchStatus;
  matchMethod: MatchMethod | null;
  matchedAt: string | null;
  matchedWorkoutId: number | null;
  matchedWorkout: MatchedWorkoutDto | null;
  exercises: StrengthSessionExerciseDto[];
  ordinaryTonnageKg: number | null;
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
