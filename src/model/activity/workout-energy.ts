import { calculateStrengthActivity } from "./strength";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";

export type WorkoutActivityClassification =
  | "traditional-strength-training"
  | "stair-climbing"
  | "other";

export type CanonicalWorkoutType =
  | typeof TRADITIONAL_STRENGTH_TRAINING_TYPE
  | typeof STAIR_CLIMBING_TYPE;

export type ExplicitWorkoutActivityEvent = {
  /** Raw source type string preserved for provenance (case/spacing as stored). */
  type: string;
  /** Canonical BodyCast type when recognized; null for unrecognized types. */
  canonicalType: CanonicalWorkoutType | null;
  classification: WorkoutActivityClassification;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
};

export type ExplicitWorkoutActivityInput = {
  events: readonly ExplicitWorkoutActivityEvent[];
};

/**
 * Normalize workout type values (not payload keys): trim + case-insensitive
 * match against canonical Garmin/CIRQA labels.
 */
export function canonicalizeWorkoutType(rawType: string): {
  rawType: string;
  canonicalType: CanonicalWorkoutType | null;
  classification: WorkoutActivityClassification;
} {
  const rawTypePreserved = rawType;
  const normalized = rawType.trim().toLowerCase();
  if (normalized === TRADITIONAL_STRENGTH_TRAINING_TYPE.toLowerCase()) {
    return {
      rawType: rawTypePreserved,
      canonicalType: TRADITIONAL_STRENGTH_TRAINING_TYPE,
      classification: "traditional-strength-training",
    };
  }
  if (normalized === STAIR_CLIMBING_TYPE.toLowerCase()) {
    return {
      rawType: rawTypePreserved,
      canonicalType: STAIR_CLIMBING_TYPE,
      classification: "stair-climbing",
    };
  }
  return {
    rawType: rawTypePreserved,
    canonicalType: null,
    classification: "other",
  };
}

export function classifyWorkoutType(type: string): WorkoutActivityClassification {
  return canonicalizeWorkoutType(type).classification;
}

export function hasExplicitStrengthWorkouts(
  events: readonly ExplicitWorkoutActivityEvent[],
): boolean {
  return events.some((event) => event.classification === "traditional-strength-training");
}

/**
 * Resolve workout activity kcal for one day.
 * Garmin active kcal is used as-is (already excludes resting).
 * Strength MET is only a per-event fallback when active kcal is missing.
 * Stair without active kcal contributes 0 and never invents MET.
 */
export function resolveExplicitWorkoutActivityKcal(input: {
  events: readonly ExplicitWorkoutActivityEvent[];
  weightKg: number;
  rmrKcalPerDay: number;
}): {
  workoutActivityKcal: number;
  deviceActiveEnergyKcal: number;
  strengthMetFallbackKcal: number;
  perEvent: Array<{
    classification: WorkoutActivityClassification;
    source: "device-active-kcal" | "strength-met-fallback" | "none";
    kcal: number;
  }>;
} {
  let deviceActiveEnergyKcal = 0;
  let strengthMetFallbackKcal = 0;
  const perEvent: Array<{
    classification: WorkoutActivityClassification;
    source: "device-active-kcal" | "strength-met-fallback" | "none";
    kcal: number;
  }> = [];

  for (const event of input.events) {
    if (event.activeEnergyKcal !== null && event.activeEnergyKcal > 0) {
      deviceActiveEnergyKcal += event.activeEnergyKcal;
      perEvent.push({
        classification: event.classification,
        source: "device-active-kcal",
        kcal: event.activeEnergyKcal,
      });
      continue;
    }

    if (
      event.classification === "traditional-strength-training"
      && event.durationMinutes !== null
      && event.durationMinutes > 0
    ) {
      const fallback = calculateStrengthActivity({
        weightKg: input.weightKg,
        rmrKcalPerDay: input.rmrKcalPerDay,
        durationMinutes: event.durationMinutes,
      });
      const kcal = fallback ?? 0;
      strengthMetFallbackKcal += kcal;
      perEvent.push({
        classification: event.classification,
        source: "strength-met-fallback",
        kcal,
      });
      continue;
    }

    perEvent.push({
      classification: event.classification,
      source: "none",
      kcal: 0,
    });
  }

  return {
    workoutActivityKcal: deviceActiveEnergyKcal + strengthMetFallbackKcal,
    deviceActiveEnergyKcal,
    strengthMetFallbackKcal,
    perEvent,
  };
}
