/**
 * Availability says whether a value exists. Provenance says how an available
 * value was obtained. `unavailable` is an availability state, never a method.
 */
export type ValueAvailability = "available" | "unavailable";
export type AvailableValueProvenance = "observed" | "derived" | "estimated";

export type AvailableValue<T> = {
  availability: "available";
  provenance: AvailableValueProvenance;
  value: T;
};

export type UnavailableValue = {
  availability: "unavailable";
  provenance: null;
  value: null;
};

export type ProvenancedValue<T> = AvailableValue<T> | UnavailableValue;

/** Source-observation semantics only; it deliberately does not infer detraining. */
export type WorkoutExposureObservation =
  | { availability: "available"; observation: "observed-exposure" | "observed-no-exposure" }
  | { availability: "unavailable"; observation: "unobserved" };

/**
 * Minimal adaptation-state surface. It carries source-observation evidence and
 * explicitly leaves adaptation response unavailable until a research-backed
 * transition is introduced. It has no cessation or detraining interpretation.
 */
export type TrainingAdaptationStateV7 = {
  sourceObservation: WorkoutExposureObservation;
  adaptationResponse: UnavailableValue;
};

/**
 * `observed-no-exposure` is valid only for a source interval whose workout feed
 * was observed. Missing or legacy feed coverage remains `unobserved`.
 */
export function workoutExposureObservation(input: {
  workoutFeedObserved: boolean | null;
  workoutCount: number;
}): WorkoutExposureObservation {
  if (input.workoutFeedObserved !== true) {
    return { availability: "unavailable", observation: "unobserved" };
  }
  return input.workoutCount === 0
    ? { availability: "available", observation: "observed-no-exposure" }
    : { availability: "available", observation: "observed-exposure" };
}

/**
 * Contract-only ordering for a future v7 daily transition. These identifiers
 * neither execute nor imply a transition formula or a production simulator.
 */
export const PHYSIOLOGY_V7_DAILY_TRANSITION_ORDER = [
  "normalize-sources",
  "resolve-input-semantics",
  "validate-state-contract",
  "energy-nutrition-transition-slot",
  "training-adaptation-transition-slot",
  "fluid-water-transition-slot",
  "reconstruct-mass",
  "annotate-output-provenance",
] as const;

export type PhysiologyV7DailyTransitionSlot =
  (typeof PHYSIOLOGY_V7_DAILY_TRANSITION_ORDER)[number];
