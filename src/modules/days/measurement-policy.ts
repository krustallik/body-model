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

/** Fractional daily metrics persisted with at most 2 decimal places. */
export const ROUND_TO_HUNDREDTHS_FIELDS = [
  "weightKg",
  "bodyFatPercent",
  "caloriesKcal",
  "proteinG",
  "fatG",
  "carbsG",
  "activeEnergyKcal",
  "averageWalkingSpeedKmh",
  "walkingDistanceKm",
  "strengthTrainingMinutes",
] as const;

const ABSENT_ZERO_FIELD_SET = new Set<string>(ABSENT_ZERO_MEASUREMENT_FIELDS);
const ROUND_TO_HUNDREDTHS_FIELD_SET = new Set<string>(ROUND_TO_HUNDREDTHS_FIELDS);

function isZeroMeasurement(value: unknown): boolean {
  return value === 0 || (typeof value === "object" && value !== null
    && "isZero" in value && typeof value.isZero === "function" && value.isZero());
}

function roundToHundredths(value: unknown): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return Math.round(Number(`${value}e+2`)) / 100;
}

/** Round fractional daily metrics to hundredths on write paths. Integers (steps) are untouched. */
export function roundDailyMetricFractions<T extends object>(record: T): T {
  const result = { ...record } as Record<string, unknown>;
  for (const field of ROUND_TO_HUNDREDTHS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) continue;
    result[field] = roundToHundredths(result[field]);
  }
  return result as T;
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

/** Normalize zeros then round fractions — use on create/update/sync write paths. */
export function prepareDailyMeasurementsForWrite<T extends object>(record: T): T {
  return roundDailyMetricFractions(normalizeDailyMeasurements(record));
}

/** Schema/input preprocess: collapse absent zeros only. Rounding belongs on write paths. */
export function normalizeDailyMeasurementInput(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? normalizeDailyMeasurements(value) : value;
}

export function collapsesZeroToAbsent(field: string): boolean {
  return ABSENT_ZERO_FIELD_SET.has(field);
}

export function roundsToHundredths(field: string): boolean {
  return ROUND_TO_HUNDREDTHS_FIELD_SET.has(field);
}
