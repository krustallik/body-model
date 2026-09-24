import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import type { TrainingDayFact } from "./training-day-fact";

export type DayWorkoutPresentation = {
  /** Workout row id — the handle retrospective diary backfill starts from. */
  id?: number;
  type: string;
  canonicalType: string | null;
  classification: "traditional-strength-training" | "stair-climbing" | "other";
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  energySource: "device-estimate" | "shadow-diary-estimate" | "unavailable";
  diaryOnly: boolean;
  linkedTrainingSessionId: number | null;
  linkedTrainingProgramName: string | null;
  exerciseDetailAvailability?: "logged-sets" | "no-logged-sets" | "unavailable";
  loggedSetCount?: number | null;
};

export type DayWorkoutSummary = {
  workouts: DayWorkoutPresentation[];
  /** Null means no workout observation for the day (not zero). */
  totalWorkoutMinutes: number | null;
  workoutSource: "workouts" | "legacy-strength" | "none";
};

export type RawWorkoutRow = {
  id?: number;
  type: string;
  startAt: Date | string;
  endAt: Date | string | null;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  energySource?: "device-estimate" | "shadow-diary-estimate" | "unavailable";
  diaryOnly?: boolean;
  matchedDiarySession?: {
    id: number;
    program: { name: string } | null;
  } | null;
  exerciseDetailAvailability?: "logged-sets" | "no-logged-sets" | "unavailable";
  loggedSetCount?: number | null;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function validDurationMinutes(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Canonical UI aggregation: explicit workouts beat legacy strength minutes. */
export function summarizeDayWorkouts(input: {
  workouts: readonly RawWorkoutRow[];
  legacyStrengthTrainingMinutes: number | null;
  trainingDayFact?: TrainingDayFact;
}): DayWorkoutSummary {
  const workouts: DayWorkoutPresentation[] = (input.workouts ?? []).map((workout) => {
    const canonical = canonicalizeWorkoutType(workout.type);
    const linked = workout.matchedDiarySession ?? null;
    return {
      id: workout.id,
      type: workout.type,
      canonicalType: canonical.canonicalType,
      classification: canonical.classification,
      startAt: toIso(workout.startAt),
      endAt: workout.endAt === null ? null : toIso(workout.endAt),
      durationMinutes: validDurationMinutes(workout.durationMinutes),
      activeEnergyKcal: workout.activeEnergyKcal !== null
        && Number.isFinite(workout.activeEnergyKcal)
        && workout.activeEnergyKcal >= 0
        ? workout.activeEnergyKcal
        : null,
      energySource: workout.energySource
        ?? (workout.activeEnergyKcal !== null && Number.isFinite(workout.activeEnergyKcal) && workout.activeEnergyKcal >= 0
          ? "device-estimate"
          : "unavailable"),
      diaryOnly: workout.diaryOnly ?? false,
      linkedTrainingSessionId: linked?.id ?? null,
      linkedTrainingProgramName: linked?.program?.name ?? null,
      exerciseDetailAvailability: workout.exerciseDetailAvailability,
      loggedSetCount: workout.loggedSetCount,
    };
  });

  if (input.trainingDayFact) {
    return {
      workouts,
      totalWorkoutMinutes: input.trainingDayFact.durationMinutes,
      workoutSource: input.trainingDayFact.eventCount > 0 ? "workouts" : "none",
    };
  }

  if (workouts.length > 0) {
    const total = workouts.some((workout) => validDurationMinutes(workout.durationMinutes) === null)
      ? null
      : workouts.reduce((sum, workout) => sum + (validDurationMinutes(workout.durationMinutes) ?? 0), 0);
    return {
      workouts,
      totalWorkoutMinutes: total,
      workoutSource: "workouts",
    };
  }

  return {
    workouts: [],
    totalWorkoutMinutes: 0,
    workoutSource: "none",
  };
}

export function displayWorkoutType(workout: Pick<DayWorkoutPresentation, "type" | "canonicalType">): string {
  return workout.canonicalType ?? workout.type.trim();
}
