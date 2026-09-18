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
  /** Present whenever the row came from `workouts`; absent for legacy fallbacks. */
  id?: number;
  type: string;
  canonicalType: string | null;
  classification: "traditional-strength-training" | "stair-climbing" | "other";
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  /** Present when this Garmin/device workout is MATCHED to a strength diary session. */
  linkedTrainingSessionId?: number | null;
  linkedTrainingProgramName?: string | null;
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

export type NightlySleepSummaryDto = {
  sleepDate: string;
  sleepStartAt: string;
  sleepEndAt: string;
  totalSleepMinutes: number;
  timeInBedMinutes: number;
  awakeMinutes: number;
  coreMinutes: number;
  deepMinutes: number;
  remMinutes: number;
  unspecifiedSleepMinutes: number;
  efficiencyPercent: number | null;
  segmentCount: number;
  timeInBedProvenance: "inBed-union" | "session-span-fallback";
  sleepDateAttribution: "segment-offset" | "fallback-timezone" | "utc-instant";
  wakeOffsetMinutes: number | null;
  qualityFlags: string[];
  segments: Array<{
    startAt: string;
    endAt: string;
    state: "awake" | "inBed" | "core" | "deep" | "rem" | "asleepUnspecified" | "unknown";
    rawState: string;
  }>;
};

export type DailyMetricDto = {
  date: string;
  updatedAt: string;
  workouts: DayWorkoutDto[];
  /** Display total; null = no workout observation (not zero). */
  totalWorkoutMinutes: number | null;
  workoutSource: "workouts" | "legacy-strength" | "none";
  /**
   * true = workout feed synced for this day (including empty rest),
   * false = feed unavailable, null = legacy/unknown. Missing feed ≠ rest.
   */
  workoutFeedObserved: boolean | null;
  heartRate?: HeartRateDayDto;
  restingHeartRate?: HeartRateDayDto;
  /** Convenience scalar for tables: latest resting BPM for this calendar day. */
  restingHeartRateBpm?: number | null;
  /** Convenience scalar for tables: total sleep minutes for sleepDate = date. */
  sleepMinutes?: number | null;
  sleep?: NightlySleepSummaryDto | null;
} & Record<DailyMetricField, number | null>;
