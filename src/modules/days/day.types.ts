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
  endAt: string | null;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  /** Where the active-energy value came from; diary shadow stays separate from device sync. */
  energySource?: "device-estimate" | "shadow-diary-estimate" | "unavailable";
  /** True for a diary-only event synthesized for History, not a persisted device Workout. */
  diaryOnly?: boolean;
  /** Present when this Garmin/device workout is MATCHED to a strength diary session. */
  linkedTrainingSessionId?: number | null;
  linkedTrainingProgramName?: string | null;
  executionStatus?: import("./training-day-fact").TrainingEventExecutionStatus;
  exerciseDetailAvailability?: import("./training-day-fact").ExerciseDetailAvailability;
  loggedSetCount?: number | null;
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
  updatedAt: string | null;
  /** False when this row exists only to present a training event, without a Health row. */
  hasHealthRecord?: boolean;
  workouts: DayWorkoutDto[];
  /** Event-derived duration: 0 for no events, null when at least one duration is unknown. */
  totalWorkoutMinutes: number | null;
  workoutSource: "workouts" | "legacy-strength" | "none";
  /**
   * true = workout feed synced for this day (including empty rest),
   * false = feed unavailable, null = legacy/unknown. Missing feed ≠ rest.
   */
  workoutFeedObserved: boolean | null;
  /** Event fact is independent of Health measurements and workout feed coverage. */
  trainingDayFact?: import("./training-day-fact").TrainingDayFact;
  heartRate?: HeartRateDayDto;
  restingHeartRate?: HeartRateDayDto;
  /** Convenience scalar for tables: latest resting BPM for this calendar day. */
  restingHeartRateBpm?: number | null;
  /** Convenience scalar for tables: total sleep minutes for sleepDate = date. */
  sleepMinutes?: number | null;
  sleep?: NightlySleepSummaryDto | null;
} & Record<DailyMetricField, number | null>;
