import { assertWeight } from "../activity/validation";

export type BodyCompositionInitializationInput = {
  weightKg: number;
  estimatedBodyFatPercent: number;
};

export type InitialBodyComposition = {
  bodyWeightKg: number;
  fatMassKg: number;
  fatFreeMassKg: number;
  bodyFatPercentEstimate: number;
};

/** Creates an initial modeled state from weight and an estimated BIA percentage. */
export function initializeBodyComposition(
  input: BodyCompositionInitializationInput,
): InitialBodyComposition {
  assertWeight(input.weightKg);

  if (!Number.isFinite(input.estimatedBodyFatPercent)) {
    throw new TypeError("estimatedBodyFatPercent must be finite");
  }
  if (input.estimatedBodyFatPercent < 0 || input.estimatedBodyFatPercent > 100) {
    throw new RangeError("estimatedBodyFatPercent must be between 0 and 100");
  }

  const fatMassKg = input.weightKg * input.estimatedBodyFatPercent / 100;

  return {
    bodyWeightKg: input.weightKg,
    fatMassKg,
    fatFreeMassKg: input.weightKg - fatMassKg,
    bodyFatPercentEstimate: input.estimatedBodyFatPercent,
  };
}
