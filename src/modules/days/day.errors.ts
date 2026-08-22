export class DuplicateDayError extends Error {
  constructor() {
    super("A day with this date already exists");
    this.name = "DuplicateDayError";
  }
}
