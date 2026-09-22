export class ForecastScenarioEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForecastScenarioEvidenceError";
  }
}

export class ForecastUnavailableError extends Error {
  constructor(public readonly reason: "profile-missing" | "missing-weight") {
    super(reason);
    this.name = "ForecastUnavailableError";
  }
}
