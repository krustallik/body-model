/** Increment only when persisted scientific state semantics change. */
export const CURRENT_MODEL_VERSION = "bodycast-physiology-v6" as const;

/** Last physiology version before Garmin workout-aware activity accounting. */
export const LEGACY_PHYSIOLOGY_V5 = "bodycast-physiology-v5" as const;

export function usesWorkoutAwareActivity(modelVersion: string): boolean {
  const match = /^bodycast-physiology-v(\d+)$/.exec(modelVersion);
  if (!match) return false;
  return Number(match[1]) >= 6;
}
