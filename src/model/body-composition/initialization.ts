import { assertWeight } from "../activity/validation";

export type BodyCompositionInitializationInput = {
  weightKg: number;
  estimatedBodyFatPercent: number;
};

export type ObservedBodyComposition = {
  bodyWeightKg: number;
  observedFatMassKg: number;
  observedFatFreeMassKg: number;
  bodyFatPercentEstimate: number;
};

/** Derives an observed two-compartment baseline; this is not a latent Hall state. */
export function initializeBodyComposition(
  input: BodyCompositionInitializationInput,
): ObservedBodyComposition {
  assertWeight(input.weightKg);

  if (!Number.isFinite(input.estimatedBodyFatPercent)) {
    throw new TypeError("estimatedBodyFatPercent must be finite");
  }
  if (input.estimatedBodyFatPercent <= 0 || input.estimatedBodyFatPercent >= 100) {
    throw new RangeError("estimatedBodyFatPercent must be greater than 0 and less than 100");
  }

  const fatMassKg = input.weightKg * input.estimatedBodyFatPercent / 100;
  const fatFreeMassKg = input.weightKg - fatMassKg;
  if (fatMassKg <= 0 || fatFreeMassKg <= 0) {
    throw new RangeError("estimatedBodyFatPercent cannot produce a nondegenerate model state");
  }

  return {
    bodyWeightKg: input.weightKg,
    observedFatMassKg: fatMassKg,
    observedFatFreeMassKg: fatFreeMassKg,
    bodyFatPercentEstimate: input.estimatedBodyFatPercent,
  };
}
