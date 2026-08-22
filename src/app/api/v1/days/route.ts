import { DuplicateDayError } from "@/modules/days/day.errors";
import { readJson, validationResponse } from "@/modules/days/day.http";
import { dailyMetricRepository } from "@/modules/days/day.repository";
import { CreateDailyMetricSchema, DailyMetricListQuerySchema } from "@/modules/days/day.schema";

export const dynamic = "force-dynamic";

function defaultDateRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawQuery = Object.fromEntries(url.searchParams);
  const query = DailyMetricListQuerySchema.safeParse(
    rawQuery.from || rawQuery.to ? rawQuery : { ...defaultDateRange(), ...rawQuery },
  );
  if (!query.success) return validationResponse(query.error);

  try {
    const days = await dailyMetricRepository.list(query.data);
    return Response.json({ days, limit: query.data.limit, offset: query.data.offset });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = CreateDailyMetricSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    return Response.json({ day: await dailyMetricRepository.create(parsed.data) }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateDayError) {
      return Response.json({ error: "date_conflict" }, { status: 409 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
