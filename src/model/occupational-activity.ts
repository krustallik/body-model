import { calculateIndividualizedNetMetActivity } from "./activity/energy";
import { MAX_SUPPORTED_WALKING_SPEED_KMH } from "./activity/constants";
import { calculateStrengthActivity } from "./activity/strength";
import { calculateWalkingActivity } from "./activity/walking";
import {
  assertFinite,
  assertPositive,
  assertWeight,
  validateOptionalNonnegative,
} from "./activity/validation";

/** Categories describe the average non-walking part of a heterogeneous work interval. */
export const OCCUPATIONAL_CATEGORIES = {
  standingLight: {
    label: "Very light / mostly waiting",
    description: "Supervising, scanning, checking, or light hand tasks with very little lifting.",
    residualMet: 1.8,
    met: 1.8,
    examples: ["waiting", "supervising", "scanning", "checking"],
    compendiumCode: "11600",
  },
  manualLight: {
    label: "Light handling / packing",
    description: "Packing, sorting, shelving light items, or occasionally handling light boxes.",
    residualMet: 2.3,
    met: 2.8,
    examples: ["packing", "sorting", "shelving light items", "light boxes"],
    compendiumCode: "11860",
  },
  standingLightModerate: {
    label: "Active light manual work",
    description: "Frequent stocking or more continuous whole-body light work.",
    residualMet: 2.8,
    met: 3.3,
    examples: ["frequent stocking", "continuous light manual work"],
    compendiumCode: "11475",
  },
  manualModerate: {
    label: "Moderate handling",
    description: "Repeated lifting, pushing, or pulling moderately heavy items.",
    residualMet: 4.5,
    met: 4.5,
    examples: ["repeated lifting", "pushing", "pulling"],
    compendiumCode: "11476",
  },
} as const;

export type OccupationalCategory = keyof typeof OCCUPATIONAL_CATEGORIES;

export type OccupationalEstimationFallbackReason =
  | "work-walking-unavailable"
  | "walking-speed-unavailable"
  | "walking-duration-exceeds-active-work-time";

export type WorkBreakSource = "user-entered" | "legacy-unreported";

export type OccupationalActivityEstimate = {
  method: "hybrid-walking-residual" | "category-only-fallback";
  category: OccupationalCategory;
  durationHours: number;
  breakDurationHours: number | null;
  breakSource: WorkBreakSource;
  activeWorkDurationHours: number;
  workWalkingDistanceKm: number | null;
  walkingSpeedKmh: number | null;
  walkingDurationHours: number | null;
  residualDurationHours: number | null;
  walkingActivityKcal: number | null;
  residualActivityKcal: number | null;
  activityKcal: number;
  fallbackReason: OccupationalEstimationFallbackReason | null;
};

/** One second: only absorbs floating-point/boundary rounding, not real activity. */
export const WALKING_DURATION_TOLERANCE_HOURS = 1 / 3_600;

export function isOccupationalCategory(value: string): value is OccupationalCategory {
  return Object.hasOwn(OCCUPATIONAL_CATEGORIES, value);
}

function validateDuration(durationHours: number): void {
  assertFinite("durationHours", durationHours);
  if (durationHours < 0 || durationHours > 24) {
    throw new RangeError("durationHours must be between 0 and 24");
  }
}

/** Category-only estimate used when walking decomposition is not available. */
export function calculateOccupationalActivity(input: {
  category: OccupationalCategory;
  weightKg: number;
  rmrKcalPerDay: number;
  durationHours: number;
}): number {
  assertWeight(input.weightKg);
  assertPositive("rmrKcalPerDay", input.rmrKcalPerDay);
  validateDuration(input.durationHours);
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

function calculateResidualOccupationalActivity(input: {
  category: OccupationalCategory;
  weightKg: number;
  rmrKcalPerDay: number;
  durationHours: number;
}): number {
  if (input.durationHours === 0) return 0;
  return calculateIndividualizedNetMetActivity({
    grossMet: OCCUPATIONAL_CATEGORIES[input.category].residualMet,
    weightKg: input.weightKg,
    durationHours: input.durationHours,
    rmrKcalPerDay: input.rmrKcalPerDay,
  });
}

function categoryOnlyFallback(
  input: {
    category: OccupationalCategory;
    weightKg: number;
    rmrKcalPerDay: number;
    durationHours: number;
    breakDurationHours: number | null;
    breakSource: WorkBreakSource;
    activeWorkDurationHours: number;
    workWalkingDistanceKm: number | null;
    walkingSpeedKmh: number | null;
  },
  fallbackReason: OccupationalEstimationFallbackReason,
): OccupationalActivityEstimate {
  const activityKcal = calculateOccupationalActivity({
    ...input,
    durationHours: input.activeWorkDurationHours,
  });
  return {
    method: "category-only-fallback",
    category: input.category,
    durationHours: input.durationHours,
    breakDurationHours: input.breakDurationHours,
    breakSource: input.breakSource,
    activeWorkDurationHours: input.activeWorkDurationHours,
    workWalkingDistanceKm: input.workWalkingDistanceKm,
    walkingSpeedKmh: input.walkingSpeedKmh,
    walkingDurationHours: null,
    residualDurationHours: null,
    walkingActivityKcal: null,
    residualActivityKcal: null,
    activityKcal,
    fallbackReason,
  };
}

/**
 * Partitions clock time into mutually exclusive walking and non-walking states.
 * The supplied speed is a duration proxy; it must not be described as work-specific.
 */
export function calculateHybridOccupationalActivity(input: {
  category: OccupationalCategory;
  weightKg: number;
  rmrKcalPerDay: number;
  durationHours: number;
  breakDurationHours?: number | null;
  workWalkingDistanceKm: number | null | undefined;
  walkingSpeedKmh: number | null | undefined;
}): OccupationalActivityEstimate {
  assertWeight(input.weightKg);
  assertPositive("rmrKcalPerDay", input.rmrKcalPerDay);
  validateDuration(input.durationHours);
  if (!OCCUPATIONAL_CATEGORIES[input.category]) throw new RangeError("unknown occupational category");
  validateOptionalNonnegative("workWalkingDistanceKm", input.workWalkingDistanceKm);
  validateOptionalNonnegative("walkingSpeedKmh", input.walkingSpeedKmh);
  validateOptionalNonnegative("breakDurationHours", input.breakDurationHours);

  const breakDurationHours = input.breakDurationHours ?? null;
  const breakSource: WorkBreakSource = input.breakDurationHours === null
      || input.breakDurationHours === undefined
    ? "legacy-unreported"
    : "user-entered";
  if (breakDurationHours !== null && breakDurationHours >= input.durationHours) {
    throw new RangeError("breakDurationHours must be shorter than durationHours");
  }
  const activeWorkDurationHours = input.durationHours - (breakDurationHours ?? 0);

  const workWalkingDistanceKm = input.workWalkingDistanceKm ?? null;
  const walkingSpeedKmh = input.walkingSpeedKmh ?? null;
  const fallbackInput = {
    ...input,
    breakDurationHours,
    breakSource,
    activeWorkDurationHours,
    workWalkingDistanceKm,
    walkingSpeedKmh,
  };
  if (workWalkingDistanceKm === null) {
    return categoryOnlyFallback(fallbackInput, "work-walking-unavailable");
  }
  if (workWalkingDistanceKm > 0 && (walkingSpeedKmh === null
      || walkingSpeedKmh <= 0 || walkingSpeedKmh > MAX_SUPPORTED_WALKING_SPEED_KMH)) {
    return categoryOnlyFallback(fallbackInput, "walking-speed-unavailable");
  }

  const walkingDurationHours = workWalkingDistanceKm === 0
    ? 0
    : workWalkingDistanceKm / walkingSpeedKmh!;
  if (walkingDurationHours > activeWorkDurationHours + WALKING_DURATION_TOLERANCE_HOURS) {
    return categoryOnlyFallback(fallbackInput, "walking-duration-exceeds-active-work-time");
  }
  const residualDurationHours = Math.max(0, activeWorkDurationHours - walkingDurationHours);
  const walkingActivityKcal = calculateWalkingActivity({
    weightKg: input.weightKg,
    rmrKcalPerDay: input.rmrKcalPerDay,
    distanceKm: workWalkingDistanceKm,
    averageSpeedKmh: walkingSpeedKmh,
  })!;
  const residualActivityKcal = calculateResidualOccupationalActivity({
    category: input.category,
    weightKg: input.weightKg,
    rmrKcalPerDay: input.rmrKcalPerDay,
    durationHours: residualDurationHours,
  });
  return {
    method: "hybrid-walking-residual",
    category: input.category,
    durationHours: input.durationHours,
    breakDurationHours,
    breakSource,
    activeWorkDurationHours,
    workWalkingDistanceKm,
    walkingSpeedKmh,
    walkingDurationHours,
    residualDurationHours,
    walkingActivityKcal,
    residualActivityKcal,
    activityKcal: walkingActivityKcal + residualActivityKcal,
    fallbackReason: null,
  };
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
