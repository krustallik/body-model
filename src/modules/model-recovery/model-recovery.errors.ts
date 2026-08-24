export class ModelRecoveryEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelRecoveryEvidenceError";
  }
}
