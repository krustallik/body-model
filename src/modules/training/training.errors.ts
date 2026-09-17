export class TrainingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "TrainingError";
  }
}

export class ActiveSessionExistsError extends TrainingError {
  constructor(readonly activeSessionId: number) {
    super("an active strength diary session already exists", "active_session_exists");
    this.name = "ActiveSessionExistsError";
  }
}

export class ProgramNotFoundError extends TrainingError {
  constructor() {
    super("training program not found", "program_not_found");
    this.name = "ProgramNotFoundError";
  }
}

export class ProgramArchivedError extends TrainingError {
  constructor() {
    super("training program is archived", "program_archived");
    this.name = "ProgramArchivedError";
  }
}

export class SessionNotFoundError extends TrainingError {
  constructor() {
    super("strength diary session not found", "session_not_found");
    this.name = "SessionNotFoundError";
  }
}

export class SessionNotActiveError extends TrainingError {
  constructor() {
    super("strength diary session is not active", "session_not_active");
    this.name = "SessionNotActiveError";
  }
}

export class SessionExerciseNotFoundError extends TrainingError {
  constructor() {
    super("session exercise not found", "session_exercise_not_found");
    this.name = "SessionExerciseNotFoundError";
  }
}

export class SetNotFoundError extends TrainingError {
  constructor() {
    super("strength set not found", "set_not_found");
    this.name = "SetNotFoundError";
  }
}

export class SetValidationError extends TrainingError {
  constructor(message: string) {
    super(message, "set_validation_error");
    this.name = "SetValidationError";
  }
}

export class WorkoutNotEligibleError extends TrainingError {
  constructor(message = "workout is not an eligible strength match candidate") {
    super(message, "workout_not_eligible");
    this.name = "WorkoutNotEligibleError";
  }
}

export class WorkoutAlreadyMatchedError extends TrainingError {
  constructor() {
    super("workout is already matched to another diary session", "workout_already_matched");
    this.name = "WorkoutAlreadyMatchedError";
  }
}

export class CatalogExerciseNotFoundError extends TrainingError {
  constructor() {
    super("exercise catalog entry not found", "catalog_not_found");
    this.name = "CatalogExerciseNotFoundError";
  }
}

export class SnapshotImmutableError extends TrainingError {
  constructor() {
    super("session exercise snapshot fields are immutable", "snapshot_immutable");
    this.name = "SnapshotImmutableError";
  }
}

export class WorkoutNotFoundError extends TrainingError {
  constructor() {
    super("workout not found", "workout_not_found");
    this.name = "WorkoutNotFoundError";
  }
}

export class ProgramVersionNotFoundError extends TrainingError {
  constructor() {
    super("training program version not found", "program_version_not_found");
    this.name = "ProgramVersionNotFoundError";
  }
}

export class ExerciseHasSetsError extends TrainingError {
  constructor() {
    super("session exercise has actual sets; confirm deletion", "exercise_has_sets");
    this.name = "ExerciseHasSetsError";
  }
}

export class ResistanceChangeBlockedError extends TrainingError {
  constructor() {
    super(
      "resistance type change requires confirmation to clear incompatible load fields",
      "resistance_change_blocked",
    );
    this.name = "ResistanceChangeBlockedError";
  }
}

export class SessionNotEditableError extends TrainingError {
  constructor() {
    super("strength diary session is not editable", "session_not_editable");
    this.name = "SessionNotEditableError";
  }
}
