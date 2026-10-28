import { readJson, validationResponse } from "@/modules/days/day.http";
import { DuplicateWorkoutError } from "@/modules/days/day.errors";
import { DailyMetricRepository } from "@/modules/days/day.repository";
import { DailyMetricDateParamsSchema, UpdateDailyMetricSchema } from "@/modules/days/day.schema";
import { isLocalDemoMode, localDemoReadOnlyResponse } from "@/modules/demo/local-demo-mode";
import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";

export const dynamic = "force-dynamic";

async function parseDate(params: Promise<{ date: string }>): Promise<string | Response> {
  const parsed = DailyMetricDateParamsSchema.safeParse(await params);
  return parsed.success ? parsed.data.date : validationResponse(parsed.error);
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/v1/days/[date]">): Promise<Response> {
  if (isLocalDemoMode()) return localDemoReadOnlyResponse();
  if (!isTrustedOrigin(request)) return originRejected();
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  const date = await parseDate(params);
  if (date instanceof Response) return date;

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = UpdateDailyMetricSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const day = await new DailyMetricRepository(principal.profileId).update(date, parsed.data);
    return day
      ? Response.json({ day })
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    if (error instanceof DuplicateWorkoutError) {
      return Response.json({ error: "workout_conflict" }, { status: 409 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/v1/days/[date]">): Promise<Response> {
  if (isLocalDemoMode()) return localDemoReadOnlyResponse();
  if (!isTrustedOrigin(request)) return originRejected();
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  const date = await parseDate(params);
  if (date instanceof Response) return date;

  try {
    const result = await new DailyMetricRepository(principal.profileId).delete(date);
    return result.deleted
      ? new Response(null, {
        status: 204,
        headers: { "X-Model-Publication-Status": result.modelPublicationStatus ?? "not-run" },
      })
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
