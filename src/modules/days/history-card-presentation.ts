import type { DailyMetricDto, DayWorkoutDto } from "./day.types";
import { formatDurationMinutes } from "./metric-format";

function workoutKind(workout: DayWorkoutDto, uk: boolean): string {
  if (workout.classification === "traditional-strength-training") return uk ? "силове" : "strength";
  if (workout.classification === "stair-climbing") return uk ? "сходи" : "stairs";
  return uk ? "інше тренування" : "other workout";
}

function ukrainianCount(count: number, singular: string, few: string, many: string): string {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const noun = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? many
    : lastDigit === 1
      ? singular
      : lastDigit >= 2 && lastDigit <= 4
        ? few
        : many;
  return `${count} ${noun}`;
}

export function historyRecordCount(count: number, uk: boolean): string {
  if (!uk) return `${count} ${count === 1 ? "record" : "records"}`;
  return ukrainianCount(count, "запис", "записи", "записів");
}

/** Short summary of the canonical workout DTO; it does not recalculate activity or energy. */
export function historyWorkoutSummary(day: DailyMetricDto, uk: boolean): string {
  const workouts = day.workouts ?? [];
  if (workouts.length > 0) {
    const kinds = [...new Set(workouts.map((workout) => workoutKind(workout, uk)))];
    const count = workouts.length > 1
      ? (uk ? ukrainianCount(workouts.length, "тренування", "тренування", "тренувань") : `${workouts.length} workouts`)
      : null;
    const duration = day.totalWorkoutMinutes === null
      ? null
      : formatDurationMinutes(day.totalWorkoutMinutes, uk ? "uk" : "en");
    return [count, kinds.join(" + "), duration].filter(Boolean).join(" · ");
  }

  if (day.workoutSource === "legacy-strength" && day.totalWorkoutMinutes !== null) {
    return [uk ? "силове" : "strength", formatDurationMinutes(day.totalWorkoutMinutes, uk ? "uk" : "en")]
      .join(" · ");
  }

  if (day.workoutFeedObserved === true) return uk ? "Відпочинок" : "Rest day";
  if (day.workoutFeedObserved === false) return uk ? "Дані про тренування відсутні" : "Workout data unavailable";
  return "—";
}
