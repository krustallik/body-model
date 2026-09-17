import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";

export type DayWorkoutPresentation = {
  /** Workout row id — the handle retrospective diary backfill starts from. */
  id: number;
  type: string;
  canonicalType: string | null;
  classification: "traditional-strength-training" | "stair-climbing" | "other";
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  linkedTrainingSessionId: number | null;
  linkedTrainingProgramName: string | null;
};

export type DayWorkoutSummary = {
  workouts: DayWorkoutPresentation[];
  /** Null means no workout observation for the day (not zero). */
  totalWorkoutMinutes: number | null;
  workoutSource: "workouts" | "legacy-strength" | "none";
};

export type RawWorkoutRow = {
  id: number;
  type: string;
  startAt: Date | string;
  endAt: Date | string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  matchedDiarySession?: {
    id: number;
    program: { name: string } | null;
  } | null;
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
      endAt: toIso(workout.endAt),
      durationMinutes: validDurationMinutes(workout.durationMinutes),
      activeEnergyKcal: workout.activeEnergyKcal !== null
        && Number.isFinite(workout.activeEnergyKcal)
        && workout.activeEnergyKcal >= 0
        ? workout.activeEnergyKcal
        : null,
      linkedTrainingSessionId: linked?.id ?? null,
      linkedTrainingProgramName: linked?.program?.name ?? null,
    };
  });

  if (workouts.length > 0) {
    const total = workouts.reduce((sum, workout) => (
      sum + (workout.durationMinutes ?? 0)
    ), 0);
    return {
      workouts,
      totalWorkoutMinutes: total > 0 ? total : null,
      workoutSource: "workouts",
    };
  }

  const legacy = validDurationMinutes(input.legacyStrengthTrainingMinutes);
  if (legacy !== null) {
    return {
      workouts: [],
      totalWorkoutMinutes: legacy,
      workoutSource: "legacy-strength",
    };
  }

  return {
    workouts: [],
    totalWorkoutMinutes: null,
    workoutSource: "none",
  };
}

export function displayWorkoutType(workout: Pick<DayWorkoutPresentation, "type" | "canonicalType">): string {
  return workout.canonicalType ?? workout.type.trim();
}
