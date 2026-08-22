export const DAILY_METRIC_FIELDS = [
  "weightKg",
  "bodyFatPercent",
  "caloriesKcal",
  "proteinG",
  "fatG",
  "carbsG",
  "steps",
  "activeEnergyKcal",
  "averageWalkingSpeedKmh",
  "walkingDistanceKm",
  "strengthTrainingMinutes",
] as const;

export type DailyMetricField = (typeof DAILY_METRIC_FIELDS)[number];

export type DailyMetricDto = {
  date: string;
  updatedAt: string;
} & Record<DailyMetricField, number | null>;
