import { addCalendarDays, calendarDayIndex } from "@/modules/model-episodes/model-calendar";

/** First goal date that satisfies the solver's completed-local-day boundary. */
export function minimumGoalDate(latestCompletedLocalDate: string): string {
  return addCalendarDays(latestCompletedLocalDate, 1);
}

export function isGoalDateAfterLatestCompletedLocalDate(
  goalDate: string,
  latestCompletedLocalDate: string,
): boolean {
  return calendarDayIndex(goalDate) >= calendarDayIndex(minimumGoalDate(latestCompletedLocalDate));
}

export function goalHorizonDays(latestCompletedLocalDate: string, goalDate: string): number {
  const horizonDays = calendarDayIndex(goalDate) - calendarDayIndex(latestCompletedLocalDate);
  if (!isGoalDateAfterLatestCompletedLocalDate(goalDate, latestCompletedLocalDate)) {
    throw new RangeError("goalDate must be after the latest completed local date");
  }
  return horizonDays;
}
