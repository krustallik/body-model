import { calendarDayIndex } from "@/modules/model-episodes/model-calendar";

export function goalHorizonDays(latestCompletedLocalDate: string, goalDate: string): number {
  const horizonDays = calendarDayIndex(goalDate) - calendarDayIndex(latestCompletedLocalDate);
  if (horizonDays <= 0) throw new RangeError("goalDate must be after the latest completed local date");
  return horizonDays;
}
