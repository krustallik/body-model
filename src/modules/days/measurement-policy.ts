/** Zero denotes an absent recorded daily measurement, not an observed zero.
 * Apply only to source measurements; calculated results and plans may be zero.
 */
export const DAILY_MEASUREMENT_FIELDS = [
  "weightKg", "bodyFatPercent", "caloriesKcal", "proteinG", "fatG", "carbsG",
  "steps", "activeEnergyKcal", "averageWalkingSpeedKmh", "walkingDistanceKm",
  "strengthTrainingMinutes",
] as const;

export function normalizeDailyMeasurements<T extends object>(record: T): T {
  const result = { ...record } as Record<string, unknown>;
  for (const field of DAILY_MEASUREMENT_FIELDS) {
    const value = result[field];
    const isZero = value === 0 || (typeof value === "object" && value !== null
      && "isZero" in value && typeof value.isZero === "function" && value.isZero());
    if (isZero) result[field] = null;
  }
  return result as T;
}

export function normalizeDailyMeasurementInput(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? normalizeDailyMeasurements(value) : value;
}
