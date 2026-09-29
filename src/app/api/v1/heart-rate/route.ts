import { validationResponse } from "@/modules/days/day.http";
import { dailyMetricRepository } from "@/modules/days/day.repository";
import { CalendarDateSchema } from "@/modules/days/day.schema";
import { isLocalDemoMode } from "@/modules/demo/local-demo-mode";
import { localDemoHeartRateForDate } from "@/modules/demo/local-demo-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const date = CalendarDateSchema.safeParse(new URL(request.url).searchParams.get("date"));
  if (!date.success) return validationResponse(date.error);
  if (isLocalDemoMode()) return Response.json({ date: date.data, heartRate: localDemoHeartRateForDate(date.data) });

  try {
    const heartRate = await dailyMetricRepository.heartRateByDate(date.data);
    return Response.json({ date: date.data, heartRate });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
