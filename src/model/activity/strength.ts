import { DEFAULT_STRENGTH_MET } from "./constants";
import { calculateIndividualizedNetMetActivity } from "./energy";
import { assertPositive, assertWeight, validateOptionalNonnegative } from "./validation";

export type StrengthActivityInput = {
  weightKg: number;
  rmrKcalPerDay: number;
  durationMinutes: number | null | undefined;
};

/** Returns estimated resistance-training kcal above the standard resting 1 MET. */
export function calculateStrengthActivity(input: StrengthActivityInput): number | null {
  assertWeight(input.weightKg);
  assertPositive("rmrKcalPerDay", input.rmrKcalPerDay);
  validateOptionalNonnegative("durationMinutes", input.durationMinutes);

  if (input.durationMinutes === null || input.durationMinutes === undefined) return null;
  if (input.durationMinutes === 0) return 0;

  const durationHours = input.durationMinutes / 60;
  return calculateIndividualizedNetMetActivity({
    grossMet: DEFAULT_STRENGTH_MET,
    weightKg: input.weightKg,
    durationHours,
    rmrKcalPerDay: input.rmrKcalPerDay,
  });
}
