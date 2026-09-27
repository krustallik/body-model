/** Increment only when persisted scientific state semantics change. */
export const CURRENT_MODEL_VERSION = "bodycast-physiology-v7" as const;

/** Last physiology version before Garmin workout-aware activity accounting. */
export const LEGACY_PHYSIOLOGY_V5 = "bodycast-physiology-v5" as const;

const SELECTION_V1_SUFFIX = "+selection-v1";

function physiologyMajor(modelVersion: string): number | null {
  const match = /^bodycast-physiology-v(\d+)(?:\+selection-v1)?$/.exec(modelVersion);
  return match ? Number(match[1]) : null;
}

export function usesSelectionV1(modelVersion: string | undefined): boolean {
  if (modelVersion === undefined) return false;
  return modelVersion.endsWith(SELECTION_V1_SUFFIX) && physiologyMajor(modelVersion) !== null;
}

export function usesWorkoutAwareActivity(modelVersion: string): boolean {
  const major = physiologyMajor(modelVersion);
  return major !== null && major >= 6;
}

/** Stepper HR-aware energy has its own persisted semantic version from v7. */
export function usesBodyCastStepperEnergy(modelVersion: string): boolean {
  const major = physiologyMajor(modelVersion);
  return major !== null && major >= 7;
}
