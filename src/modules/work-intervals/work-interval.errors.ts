export class WorkIntervalOverlapError extends Error {
  constructor() {
    super("work interval overlaps an existing interval");
    this.name = "WorkIntervalOverlapError";
  }
}
