export class ForecastScenarioEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForecastScenarioEvidenceError";
  }
}
