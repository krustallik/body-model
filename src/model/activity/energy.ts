import { assertFinite, assertPositive, assertWeight } from "./validation";

export type IndividualizedMetActivityInput = {
  grossMet: number;
  weightKg: number;
  durationHours: number;
  rmrKcalPerDay: number;
};

/**
 * Converts a gross standard-MET workload to activity kcal above the person's
 * predicted resting expenditure during the same time interval.
 */
export function calculateIndividualizedNetMetActivity(
  input: IndividualizedMetActivityInput,
): number {
  assertWeight(input.weightKg);
  assertFinite("grossMet", input.grossMet);
  assertFinite("durationHours", input.durationHours);
  assertPositive("rmrKcalPerDay", input.rmrKcalPerDay);

  if (input.grossMet < 0) throw new RangeError("grossMet must not be negative");
  if (input.durationHours < 0) throw new RangeError("durationHours must not be negative");
  const grossActivityKcal = input.grossMet * input.weightKg * input.durationHours;
  const restingDuringActivityKcal = input.rmrKcalPerDay / 24 * input.durationHours;
  const netActivityKcal = grossActivityKcal - restingDuringActivityKcal;
  if (netActivityKcal < 0) {
    throw new RangeError("gross activity expenditure must exceed resting expenditure");
  }
  return netActivityKcal;
}
