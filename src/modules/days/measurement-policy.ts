/**
 * Field-specific source measurement semantics.
 *
 * Nutrition: received 0 means "not tracked" → null (absent observation).
 * Activity: received 0 means observed zero and must survive to simulation.
 * Weight/body-fat: 0 is not a meaningful observation → null.
 */
export const NUTRITION_ZERO_AS_ABSENT_FIELDS = [
  "caloriesKcal",
  "proteinG",
  "fatG",
  "carbsG",
] as const;

export const ABSENT_ZERO_MEASUREMENT_FIELDS = [
  ...NUTRITION_ZERO_AS_ABSENT_FIELDS,
  "weightKg",
  "bodyFatPercent",
] as const;

/** Observed zeros are meaningful and must not be collapsed to null. */
export const ACTIVITY_PRESERVE_ZERO_FIELDS = [
  "steps",
  "activeEnergyKcal",
  "averageWalkingSpeedKmh",
  "walkingDistanceKm",
  "strengthTrainingMinutes",
] as const;

export const DAILY_MEASUREMENT_FIELDS = [
  ...ABSENT_ZERO_MEASUREMENT_FIELDS,
  ...ACTIVITY_PRESERVE_ZERO_FIELDS,
] as const;

const ABSENT_ZERO_FIELD_SET = new Set<string>(ABSENT_ZERO_MEASUREMENT_FIELDS);

function isZeroMeasurement(value: unknown): boolean {
  return value === 0 || (typeof value === "object" && value !== null
    && "isZero" in value && typeof value.isZero === "function" && value.isZero());
}

/** Apply zero→null only to fields where 0 means not tracked / not a real observation. */
export function normalizeDailyMeasurements<T extends object>(record: T): T {
  const result = { ...record } as Record<string, unknown>;
  for (const field of ABSENT_ZERO_MEASUREMENT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) continue;
    if (isZeroMeasurement(result[field])) result[field] = null;
  }
  return result as T;
}

export function normalizeDailyMeasurementInput(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? normalizeDailyMeasurements(value) : value;
}

export function collapsesZeroToAbsent(field: string): boolean {
  return ABSENT_ZERO_FIELD_SET.has(field);
}
