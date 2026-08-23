import type { WorkActivityResponseDto } from "./work-activity.service";
import type { WorkIntervalDto } from "./work-interval.repository";
import type { OccupationalCategory } from "@/model/occupational-activity";

export type WorkIntervalFormValues = {
  startTime: string;
  endTime: string;
  category: OccupationalCategory;
};

async function apiError(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;
  try {
    const body = await response.json() as {
      error?: string;
      details?: Array<{ message?: string }>;
    };
    if (body.error === "interval_overlap") return "This work interval overlaps an existing interval.";
    const message = body.details?.[0]?.message;
    if (message?.includes("does not exist")) return "This local time does not exist because of daylight saving time.";
    if (message?.includes("occurs twice")) return "This local time is ambiguous because clocks change on this day.";
    return message ?? body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function loadWorkActivityDay(date: string): Promise<{
  intervals: WorkIntervalDto[];
  activity: WorkActivityResponseDto;
}> {
  const query = `date=${encodeURIComponent(date)}`;
  const [intervalsResponse, activityResponse] = await Promise.all([
    fetch(`/api/v1/work-intervals?${query}`, { cache: "no-store" }),
    fetch(`/api/v1/work-activity?${query}`, { cache: "no-store" }),
  ]);
  if (!intervalsResponse.ok) throw new Error(await apiError(intervalsResponse));
  if (!activityResponse.ok) throw new Error(await apiError(activityResponse));
  const intervalsBody = await intervalsResponse.json() as { intervals: WorkIntervalDto[] };
  return {
    intervals: intervalsBody.intervals,
    activity: await activityResponse.json() as WorkActivityResponseDto,
  };
}

export async function saveWorkInterval(
  date: string,
  values: WorkIntervalFormValues,
  id?: number,
): Promise<void> {
  const response = await fetch(
    id === undefined ? "/api/v1/work-intervals" : `/api/v1/work-intervals/${id}`,
    {
      method: id === undefined ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id === undefined ? { date, ...values } : values),
    },
  );
  if (!response.ok) throw new Error(await apiError(response));
}

export async function removeWorkInterval(id: number): Promise<void> {
  const response = await fetch(`/api/v1/work-intervals/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await apiError(response));
}
