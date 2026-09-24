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
  const eventCount = day.trainingDayFact?.eventCount
    ?? (day.workoutSource === "workouts" ? workouts.length : 0);
  if (eventCount > 0) {
    const kinds = [...new Set(workouts.map((workout) => workoutKind(workout, uk)))];
    const count = eventCount > 1
      ? (uk ? ukrainianCount(eventCount, "тренування", "тренування", "тренувань") : `${eventCount} workouts`)
      : kinds.length === 0
        ? (uk ? "1 тренування" : "1 workout")
      : null;
    const totalMinutes = day.trainingDayFact ? day.trainingDayFact.durationMinutes : day.totalWorkoutMinutes;
    const duration = totalMinutes === null
      ? null
      : formatDurationMinutes(totalMinutes, uk ? "uk" : "en");
    return [count, kinds.join(" + "), duration].filter(Boolean).join(" · ");
  }

  return uk ? "Відпочинок" : "Rest day";
}
