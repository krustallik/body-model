import type {
  MatchMethod,
  MatchStatus,
  ResistanceType,
  SessionStatus,
} from "./training.constants";

export type ExerciseCatalogDto = {
  id: number;
  name: string;
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

export type StrengthSetDto = {
  id: number;
  sessionExerciseId: number;
  setNumber: number;
  reps: number;
  weightKg: number | null;
  bandNominalResistanceKg: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StrengthSessionExerciseDto = {
  id: number;
  sourceExerciseCatalogId: number | null;
  snapshotExerciseName: string;
  order: number;
  plannedSets: number;
  resistanceType: ResistanceType;
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
  programId: number;
  programName: string;
  programVersionId: number;
  programVersionNumber: number;
  webStartedAt: string;
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
  programId: number;
  programName: string;
  webStartedAt: string;
  webEndedAt: string | null;
  matchStatus: MatchStatus;
  matchMethod: MatchMethod | null;
  matchedWorkoutId: number | null;
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
