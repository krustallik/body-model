import { validationResponse } from "@/modules/days/day.http";
import { CalendarDateSchema } from "@/modules/days/day.schema";
import { sleepRepository } from "@/modules/health/sleep.repository";
import { isLocalDemoMode } from "@/modules/demo/local-demo-mode";
import { localDemoSleepForDate } from "@/modules/demo/local-demo-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const date = CalendarDateSchema.safeParse(new URL(request.url).searchParams.get("date"));
  if (!date.success) return validationResponse(date.error);
  if (isLocalDemoMode()) return Response.json({ date: date.data, sleep: localDemoSleepForDate(date.data) });

  try {
    const sleep = await sleepRepository.summaryForDate(date.data);
    return Response.json({ date: date.data, sleep });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
