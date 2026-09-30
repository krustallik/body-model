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

/** Normalize raw activity type strings without loading the energy resolver. */
export function canonicalizeWorkoutType(rawType: string): {
  rawType: string;
  canonicalType: CanonicalWorkoutType | null;
  classification: WorkoutActivityClassification;
} {
  const normalized = rawType.trim().toLowerCase();
  if (normalized === TRADITIONAL_STRENGTH_TRAINING_TYPE.toLowerCase()) {
    return {
      rawType,
      canonicalType: TRADITIONAL_STRENGTH_TRAINING_TYPE,
      classification: "traditional-strength-training",
    };
  }
  if (normalized === STAIR_CLIMBING_TYPE.toLowerCase()) {
    return {
      rawType,
      canonicalType: STAIR_CLIMBING_TYPE,
      classification: "stair-climbing",
    };
  }
  return {
    rawType,
    canonicalType: null,
    classification: "other",
  };
}

export function classifyWorkoutType(type: string): WorkoutActivityClassification {
  return canonicalizeWorkoutType(type).classification;
}
