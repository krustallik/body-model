import {
  ActiveSessionExistsError,
  CatalogExerciseNotFoundError,
  ExerciseHasSetsError,
  ProgramArchivedError,
  ProgramNotFoundError,
  ProgramVersionNotFoundError,
  ResistanceChangeBlockedError,
  SessionExerciseNotFoundError,
  SessionNotEditableError,
  SessionNotFoundError,
  SetNotFoundError,
  SetCreateOperationConflictError,
  SetCreateOperationTombstonedError,
  SetCreateOperationUnresolvedError,
  SetValidationError,
  StaleStrengthEnergySourceError,
  TrainingConcurrentMutationError,
  WorkoutAlreadyMatchedError,
  WorkoutNotEligibleError,
  WorkoutNotFoundError,
} from "./training.errors";

/**
 * Map known training domain errors to HTTP responses.
 * Returns null when the caller should fall through to a generic 500.
 */
export function trainingErrorResponse(error: unknown): Response | null {
  if (error instanceof ActiveSessionExistsError) {
    return Response.json(
      { error: error.code, activeSessionId: error.activeSessionId },
      { status: 409 },
    );
  }
  if (
    error instanceof WorkoutAlreadyMatchedError
    || error instanceof ExerciseHasSetsError
    || error instanceof ResistanceChangeBlockedError
    || error instanceof TrainingConcurrentMutationError
  ) {
    return Response.json({ error: error.code }, { status: 409 });
  }
  if (error instanceof SetCreateOperationConflictError) {
    return Response.json({ error: error.code }, { status: 409 });
  }
  if (error instanceof SetCreateOperationTombstonedError) {
    return Response.json({ error: error.code }, { status: 410 });
  }
  if (error instanceof SetCreateOperationUnresolvedError) {
    return Response.json({ error: error.code, outcome: "unknown" }, { status: 503 });
  }
  if (error instanceof StaleStrengthEnergySourceError) {
    return Response.json({ error: error.code }, { status: 409 });
  }
  if (
    error instanceof ProgramNotFoundError
    || error instanceof ProgramArchivedError
    || error instanceof ProgramVersionNotFoundError
    || error instanceof SessionNotFoundError
    || error instanceof SessionExerciseNotFoundError
    || error instanceof SetNotFoundError
    || error instanceof WorkoutNotFoundError
  ) {
    return Response.json({ error: error.code }, { status: 404 });
  }
  if (
    error instanceof CatalogExerciseNotFoundError
    || error instanceof WorkoutNotEligibleError
    || error instanceof SessionNotEditableError
  ) {
    return Response.json({ error: error.code }, { status: 400 });
  }
  if (error instanceof SetValidationError) {
    return Response.json({ error: error.code, message: error.message }, { status: 400 });
  }
  return null;
}

export function trainingInternalError(): Response {
  return Response.json({ error: "internal_error" }, { status: 500 });
}
