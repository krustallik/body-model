import { addCalendarDays } from "@/modules/model-episodes/model-calendar";

/** Delete health sync rows whose calendar `date` is older than this many days. */
export const HEALTH_DATA_RETENTION_DAYS = 30;

/**
 * Earliest calendar date still within retention for `referenceDate`.
 * Rows with `date < cutoff` are older than `retentionDays` and should be deleted.
 *
 * SleepSegment rows are intentionally NOT tied to DailyHealthData and are not
 * removed by this cutoff — they are source history for future recalculation.
 */
export function healthRetentionCutoffDate(
  referenceDate: string,
  retentionDays: number = HEALTH_DATA_RETENTION_DAYS,
): string {
  return addCalendarDays(referenceDate, -retentionDays);
}
