import { readJson, validationResponse } from "@/modules/days/day.http";
import { dailyMetricRepository } from "@/modules/days/day.repository";
import { DailyMetricDateParamsSchema, UpdateDailyMetricSchema } from "@/modules/days/day.schema";

export const dynamic = "force-dynamic";

async function parseDate(params: Promise<{ date: string }>): Promise<string | Response> {
  const parsed = DailyMetricDateParamsSchema.safeParse(await params);
  return parsed.success ? parsed.data.date : validationResponse(parsed.error);
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/v1/days/[date]">): Promise<Response> {
  const date = await parseDate(params);
  if (date instanceof Response) return date;

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = UpdateDailyMetricSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const day = await dailyMetricRepository.update(date, parsed.data);
    return day
      ? Response.json({ day })
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext<"/api/v1/days/[date]">): Promise<Response> {
  const date = await parseDate(params);
  if (date instanceof Response) return date;

  try {
    return await dailyMetricRepository.delete(date)
      ? new Response(null, { status: 204 })
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
