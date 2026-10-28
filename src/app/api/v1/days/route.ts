import { DuplicateDayError } from "@/modules/days/day.errors";
import { readJson, validationResponse } from "@/modules/days/day.http";
import { DailyMetricRepository } from "@/modules/days/day.repository";
import { CreateDailyMetricSchema, DailyMetricListQuerySchema } from "@/modules/days/day.schema";
import { addCalendarDays, todayInCalendarTimeZone } from "@/modules/days/calendar-range";
import { isLocalDemoMode, localDemoReadOnlyResponse } from "@/modules/demo/local-demo-mode";
import { getLocalDemoDataset } from "@/modules/demo/local-demo-data";
import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";

export const dynamic = "force-dynamic";

function defaultDateRange(): { from: string; to: string } {
  const to = todayInCalendarTimeZone();
  return { from: addCalendarDays(to, -29), to };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawQuery = Object.fromEntries(url.searchParams);
  const query = DailyMetricListQuerySchema.safeParse(
    rawQuery.from || rawQuery.to ? rawQuery : { ...defaultDateRange(), ...rawQuery },
  );
  if (!query.success) return validationResponse(query.error);

  if (isLocalDemoMode()) {
    const { from, to, limit, offset, includeTrainingDays } = query.data;
    const daysInRange = getLocalDemoDataset(to ?? todayInCalendarTimeZone()).days.filter((day) => (
      (!from || day.date >= from) && (!to || day.date <= to)
    ));
    const days = daysInRange.slice(offset, offset + limit);
    const trainingDays = includeTrainingDays
      ? getLocalDemoDataset(to ?? todayInCalendarTimeZone()).trainingDays.filter((fact) => (
        (!from || fact.date >= from) && (!to || fact.date <= to)
      ))
      : [];
    return Response.json({ days, trainingDays, limit, offset });
  }
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { days, trainingDays } = await new DailyMetricRepository(principal.profileId).listWithTrainingFacts(query.data);
    return Response.json({ days, trainingDays, limit: query.data.limit, offset: query.data.offset });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (isLocalDemoMode()) return localDemoReadOnlyResponse();
  if (!isTrustedOrigin(request)) return originRejected();
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = CreateDailyMetricSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    return Response.json({ day: await new DailyMetricRepository(principal.profileId).create(parsed.data) }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateDayError) {
      return Response.json({ error: "date_conflict" }, { status: 409 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
