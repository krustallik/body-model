import { DEFAULT_TIME_ZONE, instantToLocalDateTime, localDateTimeToInstant } from "@/model/time-zone";

/** Largest explicit range for which an API response materializes every local day. */
export const MAX_MATERIALIZED_TRAINING_DAY_RANGE_DAYS = 366;

export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/** Count inclusive calendar-date labels, independent of 23/25-hour DST days. */
export function inclusiveCalendarDayCount(from: string, to: string): number | null {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function todayInCalendarTimeZone(now = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  return instantToLocalDateTime(now, timeZone).date;
}

/** Convert inclusive local calendar dates to half-open UTC instants, respecting DST. */
export function localCalendarRangeInstants(
  range: { from?: string; to?: string },
  timeZone = DEFAULT_TIME_ZONE,
): { gte?: Date; lt?: Date } {
  return {
    ...(range.from ? { gte: localDateTimeToInstant(range.from, "00:00", timeZone) } : {}),
    ...(range.to ? { lt: localDateTimeToInstant(addCalendarDays(range.to, 1), "00:00", timeZone) } : {}),
  };
}
