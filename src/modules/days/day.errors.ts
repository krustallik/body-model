export class DuplicateDayError extends Error {
  constructor() {
    super("A day with this date already exists");
    this.name = "DuplicateDayError";
  }
}

export class DuplicateWorkoutError extends Error {
  constructor() {
    super("A workout cannot replace a synced workout with the same exact interval.");
    this.name = "DuplicateWorkoutError";
  }
}
