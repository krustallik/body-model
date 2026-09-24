import type { DailyMetricDto, DailyMetricField } from "./day.types";
import { addCalendarDays, todayInCalendarTimeZone } from "./calendar-range";

export type HistoryRange = 7 | 30 | 90 | "all";

export type HistoryChartField = DailyMetricField | "totalWorkoutMinutes";

export function rangeStartDate(range: Exclude<HistoryRange, "all">, today: string): string {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (range - 1));
  return start.toISOString().slice(0, 10);
}

export function filterDaysByRange(
  days: DailyMetricDto[],
  range: HistoryRange,
  today: string,
): DailyMetricDto[] {
  const from = range === "all" ? undefined : rangeStartDate(range, today);
  return days.filter(({ date }) => date <= today && (!from || date >= from));
}

export function sortDaysChronologically(days: DailyMetricDto[]): DailyMetricDto[] {
  return [...days].sort((left, right) => left.date.localeCompare(right.date));
}

export function sortDaysNewestFirst(days: DailyMetricDto[]): DailyMetricDto[] {
  return [...days].sort((left, right) => right.date.localeCompare(left.date));
}

export function chartFieldValue(day: DailyMetricDto, field: HistoryChartField): number | null {
  return field === "totalWorkoutMinutes" ? day.totalWorkoutMinutes : day[field];
}

export function hasChartData(days: DailyMetricDto[], fields: HistoryChartField[]): boolean {
  return days.some((day) => fields.some((field) => chartFieldValue(day, field) !== null));
}

/** Chart series model for movement + training: null days stay null (connectNulls, not zero). */
export function movementTrainingChartModel(
  days: DailyMetricDto[],
  options: { range?: HistoryRange; today?: string } = {},
): {
  points: Array<{ date: string; walkingDistanceKm: number | null; totalWorkoutMinutes: number | null }>;
  workoutObservationDates: string[];
  workoutConnectNulls: true;
} {
  const chronological = sortDaysChronologically(days);
  const byDate = new Map(chronological.map((day) => [day.date, day]));
  const range = options.range ?? "all";
  const today = options.today ?? chronological.at(-1)?.date ?? todayInCalendarTimeZone();
  const firstObservedDate = chronological[0]?.date ?? today;
  const from = range === "all" ? firstObservedDate : rangeStartDate(range, today);
  const points: Array<{ date: string; walkingDistanceKm: number | null; totalWorkoutMinutes: number | null }> = [];
  const workoutObservationDates: string[] = [];
  for (let date = from; date <= today; date = addCalendarDays(date, 1)) {
    const day = byDate.get(date);
    const eventCount = day?.trainingDayFact?.eventCount
      ?? (day?.workoutSource === "workouts" ? day.workouts.length : 0);
    const duration = day?.trainingDayFact
      ? day.trainingDayFact.durationMinutes
      : day?.totalWorkoutMinutes ?? (eventCount === 0 ? 0 : null);
    points.push({
      date,
      walkingDistanceKm: day?.walkingDistanceKm ?? null,
      totalWorkoutMinutes: duration,
    });
    if (eventCount > 0) workoutObservationDates.push(date);
  }
  return {
    points,
    workoutObservationDates,
    workoutConnectNulls: true,
  };
}
