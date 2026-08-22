import type { DailyMetricDto, DailyMetricField } from "./day.types";

export type HistoryRange = 7 | 30 | 90 | "all";

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

export function hasChartData(days: DailyMetricDto[], fields: DailyMetricField[]): boolean {
  return days.some((day) => fields.some((field) => day[field] !== null));
}
