import { instantToLocalDateTime } from "@/model/time-zone";

const DAY_MS = 86_400_000;

export function calendarDayIndex(date: string): number {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    throw new RangeError("date must be a real calendar date in YYYY-MM-DD format");
  }
  return parsed / DAY_MS;
}

export function addCalendarDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new TypeError("days must be an integer");
  return new Date((calendarDayIndex(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

export function enumerateCalendarDates(from: string, to: string): string[] {
  const start = calendarDayIndex(from);
  const end = calendarDayIndex(to);
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => (
    new Date((start + index) * DAY_MS).toISOString().slice(0, 10)
  ));
}

export function latestCompletedLocalDate(now: Date, timeZone: string): string {
  if (!Number.isFinite(now.getTime())) throw new TypeError("now must be a valid Date");
  return addCalendarDays(instantToLocalDateTime(now, timeZone).date, -1);
}
