export type EpisodeInitializationFailure =
  | "profile-missing"
  | "insufficient-baseline-data"
  | "insufficient-weight-bia"
  | "invalid-initial-state"
  | "start-date-not-complete";

export class EpisodeInitializationError extends Error {
  constructor(public readonly reason: EpisodeInitializationFailure) {
    super(reason);
    this.name = "EpisodeInitializationError";
  }
}

export class NoActiveModelEpisodeError extends Error {
  constructor() {
    super("no active model episode");
    this.name = "NoActiveModelEpisodeError";
  }
}

export class ModelEpisodeNotFoundError extends Error {
  constructor() {
    super("model episode not found");
    this.name = "ModelEpisodeNotFoundError";
  }
}
