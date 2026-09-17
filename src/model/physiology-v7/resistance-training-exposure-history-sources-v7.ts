import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import {
  buildResistanceTrainingExposureHistoryV7,
  type ResistanceTrainingExposureHistoryDayInputV7,
  type ResistanceTrainingExposureHistorySessionInputV7,
  type ResistanceTrainingExposureHistoryV7,
  type ResistanceTrainingLegacyStrengthWorkoutV7,
  type ResistanceTrainingProgramContextV7,
} from "@/model/physiology-v7/resistance-training-exposure-history-v7";
import type { QualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";

/**
 * Production source assembly for ResistanceTrainingExposureHistoryV7.
 *
 * Call sites that rebuild exposure history MUST use this path (or an equivalent
 * that applies the same legacy-workout rules). Passing only diary sessions into
 * `buildResistanceTrainingExposureHistoryV7` omits legacy Garmin strength rows
 * and can misclassify them as observed-no-exposure.
 */

export type ResistanceTrainingExposureHistorySourceDayV7 = {
  /** Profile-local calendar date (DailyHealthData.date). */
  date: string;
  workoutFeedObserved: boolean | null;
};

export type ResistanceTrainingExposureHistorySourceWorkoutV7 = {
  workoutId: number;
  /** Profile-local calendar date from DailyHealthData — not UTC(startAt). */
  localDate: string;
  type: string;
  matchedStrengthDiarySessionId: number | null;
};

export type ResistanceTrainingExposureHistorySourceSessionV7 = {
  /** Profile-local occurrence date for the diary session. */
  localDate: string;
  strengthDiarySessionId: number;
  sessionRevision: number;
  occurrenceStartAt?: string | null;
  matchedWorkoutId?: number | null;
  program?: ResistanceTrainingProgramContextV7 | null;
  dose: QualifiedResistanceTrainingDoseV7;
};

function isTraditionalStrengthWorkout(type: string): boolean {
  return canonicalizeWorkoutType(type).classification === "traditional-strength-training";
}

/**
 * Partition diary sessions and canonical strength Workouts into day inputs.
 *
 * - Traditional Strength Training without a provided diary session → legacyStrengthWorkouts
 * - Workout already linked to a provided diary session → not duplicated as legacy
 * - Non-strength workouts are ignored for resistance exposure history
 */
export function assembleResistanceTrainingExposureHistoryDaysV7(input: {
  days: readonly ResistanceTrainingExposureHistorySourceDayV7[];
  strengthWorkouts?: readonly ResistanceTrainingExposureHistorySourceWorkoutV7[];
  sessions?: readonly ResistanceTrainingExposureHistorySourceSessionV7[];
}): ResistanceTrainingExposureHistoryDayInputV7[] {
  const sessions = input.sessions ?? [];
  const providedSessionIds = new Set(
    sessions.map((session) => session.strengthDiarySessionId),
  );

  const sessionsByDate = new Map<string, ResistanceTrainingExposureHistorySessionInputV7[]>();
  for (const session of sessions) {
    const list = sessionsByDate.get(session.localDate) ?? [];
    list.push({
      strengthDiarySessionId: session.strengthDiarySessionId,
      sessionRevision: session.sessionRevision,
      occurrenceStartAt: session.occurrenceStartAt ?? null,
      matchedWorkoutId: session.matchedWorkoutId ?? null,
      program: session.program ?? null,
      dose: session.dose,
    });
    sessionsByDate.set(session.localDate, list);
  }

  const legacyByDate = new Map<string, ResistanceTrainingLegacyStrengthWorkoutV7[]>();
  for (const workout of input.strengthWorkouts ?? []) {
    if (!isTraditionalStrengthWorkout(workout.type)) continue;
    const linkedId = workout.matchedStrengthDiarySessionId;
    if (linkedId != null && providedSessionIds.has(linkedId)) {
      // Diary dose path already represents this occurrence — do not double-count.
      continue;
    }
    const list = legacyByDate.get(workout.localDate) ?? [];
    list.push({
      workoutId: workout.workoutId,
      localDate: workout.localDate,
      matchedStrengthDiarySessionId: linkedId,
    });
    legacyByDate.set(workout.localDate, list);
  }

  return input.days.map((day) => ({
    date: day.date,
    workoutFeedObserved: day.workoutFeedObserved,
    sessions: sessionsByDate.get(day.date) ?? [],
    legacyStrengthWorkouts: legacyByDate.get(day.date) ?? [],
  }));
}

/** Production entry point: assemble sources then build the exposure history. */
export function buildResistanceTrainingExposureHistoryFromSourcesV7(input: {
  fromDate: string;
  toDate: string;
  days: readonly ResistanceTrainingExposureHistorySourceDayV7[];
  strengthWorkouts?: readonly ResistanceTrainingExposureHistorySourceWorkoutV7[];
  sessions?: readonly ResistanceTrainingExposureHistorySourceSessionV7[];
}): ResistanceTrainingExposureHistoryV7 {
  return buildResistanceTrainingExposureHistoryV7({
    fromDate: input.fromDate,
    toDate: input.toDate,
    days: assembleResistanceTrainingExposureHistoryDaysV7({
      days: input.days,
      strengthWorkouts: input.strengthWorkouts,
      sessions: input.sessions,
    }),
  });
}
