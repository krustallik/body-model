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

export type DayWorkoutDto = {
  type: string;
  canonicalType: string | null;
  classification: "traditional-strength-training" | "stair-climbing" | "other";
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
};

export type HeartRateSampleDto = { timestamp: string; bpm: number };
export type HeartRateDayDto = {
  sampleCount: number;
  minBpm: number | null;
  maxBpm: number | null;
  avgBpm: number | null;
  latestBpm: number | null;
  latestTimestamp: string | null;
  samples: HeartRateSampleDto[];
};

export type DailyMetricDto = {
  date: string;
  updatedAt: string;
  workouts: DayWorkoutDto[];
  /** Display total; null = no workout observation (not zero). */
  totalWorkoutMinutes: number | null;
  workoutSource: "workouts" | "legacy-strength" | "none";
  heartRate?: HeartRateDayDto;
  restingHeartRate?: HeartRateDayDto;
} & Record<DailyMetricField, number | null>;
