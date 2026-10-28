import { CalendarDateSchema } from "@/modules/days/day.schema";
import { getWorkActivityDiagnosticsForDay } from "@/modules/work-intervals/work-activity.service";
import { isLocalDemoMode } from "@/modules/demo/local-demo-mode";
import { getSessionPrincipal } from "@/modules/auth/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = CalendarDateSchema.safeParse(new URL(request.url).searchParams.get("date"));
  if (!parsed.success) {
    return Response.json({
      error: "validation_error",
      details: parsed.error.issues.map(({ path, message, code }) => ({ path, message, code })),
    }, { status: 400 });
  }
  if (isLocalDemoMode()) {
    return Response.json({ date: parsed.data, diagnostics: null, unavailableReason: "profile-or-weight-missing" });
  }
  try {
    return Response.json(await getWorkActivityDiagnosticsForDay(parsed.data, principal.profileId));
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
