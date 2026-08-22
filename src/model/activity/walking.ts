import {
  MAX_SUPPORTED_WALKING_SPEED_KMH,
  WALKING_MET_BANDS,
} from "./constants";
import { calculateIndividualizedNetMetActivity } from "./energy";
import { assertPositive, assertWeight, validateOptionalNonnegative } from "./validation";

type OptionalMeasurement = number | null | undefined;

export type WalkingActivityInput = {
  weightKg: number;
  rmrKcalPerDay: number;
  distanceKm: OptionalMeasurement;
  averageSpeedKmh: OptionalMeasurement;
};

export function walkingMetForSpeed(averageSpeedKmh: number): number {
  validateOptionalNonnegative("averageSpeedKmh", averageSpeedKmh);
  if (averageSpeedKmh <= 0 || averageSpeedKmh > MAX_SUPPORTED_WALKING_SPEED_KMH) {
    throw new RangeError("averageSpeedKmh is outside the supported walking range");
  }

  let met: number = WALKING_MET_BANDS[0].met;
  for (const band of WALKING_MET_BANDS) {
    if (averageSpeedKmh < band.minimumSpeedKmh) break;
    met = band.met;
  }
  return met;
}

/** Returns estimated walking kcal above the standard resting 1 MET. */
export function calculateWalkingActivity(input: WalkingActivityInput): number | null {
  assertWeight(input.weightKg);
  assertPositive("rmrKcalPerDay", input.rmrKcalPerDay);
  validateOptionalNonnegative("distanceKm", input.distanceKm);
  validateOptionalNonnegative("averageSpeedKmh", input.averageSpeedKmh);

  if (input.distanceKm === null || input.distanceKm === undefined) return null;
  if (input.distanceKm === 0) return 0;
  if (input.averageSpeedKmh === null || input.averageSpeedKmh === undefined) return null;

  const grossMet = walkingMetForSpeed(input.averageSpeedKmh);
  const durationHours = input.distanceKm / input.averageSpeedKmh;
  return calculateIndividualizedNetMetActivity({
    grossMet,
    weightKg: input.weightKg,
    durationHours,
    rmrKcalPerDay: input.rmrKcalPerDay,
  });
}
