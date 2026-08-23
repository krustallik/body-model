import { calculateIndividualizedNetMetActivity } from "./activity/energy";
import { calculateStrengthActivity } from "./activity/strength";
import { calculateWalkingActivity } from "./activity/walking";
import { assertFinite, assertPositive, assertWeight, validateOptionalNonnegative } from "./activity/validation";

export const OCCUPATIONAL_CATEGORIES = {
  standingLight: {
    label: "Standing tasks — light effort",
    description: "Mostly standing with light hand work.",
    met: 1.8,
    examples: ["store clerk", "bartending", "light assembly", "filing"],
    compendiumCode: "11600",
  },
  manualLight: {
    label: "Manual work — light effort",
    description: "Light manual work with more whole-body movement.",
    met: 2.8,
    examples: ["general light manual or unskilled work"],
    compendiumCode: "11475",
  },
  standingLightModerate: {
    label: "Standing tasks — light/moderate effort",
    description: "Active standing with repeated arm or body movement.",
    met: 3.3,
    examples: ["packing boxes", "stocking parts", "patient care", "auto repair"],
    compendiumCode: "11610",
  },
  manualModerate: {
    label: "Manual work — moderate effort",
    description: "More demanding manual work or regular lifting.",
    met: 4.5,
    examples: ["general moderate manual or unskilled work"],
    compendiumCode: "11476",
  },
} as const;

export type OccupationalCategory = keyof typeof OCCUPATIONAL_CATEGORIES;

export function isOccupationalCategory(value: string): value is OccupationalCategory {
  return Object.hasOwn(OCCUPATIONAL_CATEGORIES, value);
}

export function calculateOccupationalActivity(input: {
  category: OccupationalCategory;
  weightKg: number;
  rmrKcalPerDay: number;
  durationHours: number;
}): number {
  assertWeight(input.weightKg);
  assertPositive("rmrKcalPerDay", input.rmrKcalPerDay);
  assertFinite("durationHours", input.durationHours);
  if (input.durationHours < 0 || input.durationHours > 24) {
    throw new RangeError("durationHours must be between 0 and 24");
  }
  const category = OCCUPATIONAL_CATEGORIES[input.category];
  if (!category) throw new RangeError("unknown occupational category");
  if (input.durationHours === 0) return 0;
  return calculateIndividualizedNetMetActivity({
    grossMet: category.met,
    weightKg: input.weightKg,
    durationHours: input.durationHours,
    rmrKcalPerDay: input.rmrKcalPerDay,
  });
}

/** Combines occupation, only walking outside work, and strength without overlap. */
export function calculateOverlapAwareActivity(input: {
  occupationalActivityKcal: number | null | undefined;
  outsideWorkWalkingDistanceKm: number | null | undefined;
  dailyAverageWalkingSpeedKmh: number | null | undefined;
  strengthTrainingMinutes: number | null | undefined;
  weightKg: number;
  rmrKcalPerDay: number;
}): {
  occupationalActivityKcal: number;
  outsideWorkWalkingActivityKcal: number;
  strengthActivityKcal: number;
  totalActivityKcal: number;
} | null {
  validateOptionalNonnegative("occupationalActivityKcal", input.occupationalActivityKcal);
  if (input.occupationalActivityKcal === null || input.occupationalActivityKcal === undefined) {
    return null;
  }
  const outsideWorkWalkingActivityKcal = calculateWalkingActivity({
    weightKg: input.weightKg,
    rmrKcalPerDay: input.rmrKcalPerDay,
    distanceKm: input.outsideWorkWalkingDistanceKm,
    averageSpeedKmh: input.dailyAverageWalkingSpeedKmh,
  });
  const strengthActivityKcal = calculateStrengthActivity({
    weightKg: input.weightKg,
    rmrKcalPerDay: input.rmrKcalPerDay,
    durationMinutes: input.strengthTrainingMinutes,
  });
  if (outsideWorkWalkingActivityKcal === null || strengthActivityKcal === null) return null;
  const totalActivityKcal = input.occupationalActivityKcal
    + outsideWorkWalkingActivityKcal + strengthActivityKcal;
  if (!Number.isFinite(totalActivityKcal)) throw new RangeError("activity total exceeds numeric precision");
  return {
    occupationalActivityKcal: input.occupationalActivityKcal,
    outsideWorkWalkingActivityKcal,
    strengthActivityKcal,
    totalActivityKcal,
  };
}
