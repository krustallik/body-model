import {
  ActiveSessionExistsError,
  CatalogExerciseNotFoundError,
  ProgramArchivedError,
  ProgramNotFoundError,
  SessionExerciseNotFoundError,
  SessionNotFoundError,
  SetNotFoundError,
  SetValidationError,
  WorkoutAlreadyMatchedError,
  WorkoutNotEligibleError,
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
  if (error instanceof WorkoutAlreadyMatchedError) {
    return Response.json({ error: error.code }, { status: 409 });
  }
  if (
    error instanceof ProgramNotFoundError
    || error instanceof ProgramArchivedError
    || error instanceof SessionNotFoundError
    || error instanceof SessionExerciseNotFoundError
    || error instanceof SetNotFoundError
  ) {
    return Response.json({ error: error.code }, { status: 404 });
  }
  if (
    error instanceof CatalogExerciseNotFoundError
    || error instanceof WorkoutNotEligibleError
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
