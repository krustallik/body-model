import { validationResponse } from "@/modules/days/day.http";
import { dailyMetricRepository } from "@/modules/days/day.repository";
import { CalendarDateSchema } from "@/modules/days/day.schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const date = CalendarDateSchema.safeParse(new URL(request.url).searchParams.get("date"));
  if (!date.success) return validationResponse(date.error);

  try {
    const heartRate = await dailyMetricRepository.heartRateByDate(date.data);
    return Response.json({ date: date.data, heartRate });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
