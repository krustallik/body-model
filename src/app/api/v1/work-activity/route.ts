import { CalendarDateSchema } from "@/modules/days/day.schema";
import { getWorkActivityDiagnosticsForDay } from "@/modules/work-intervals/work-activity.service";
import { isLocalDemoMode } from "@/modules/demo/local-demo-mode";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
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
    return Response.json(await getWorkActivityDiagnosticsForDay(parsed.data));
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
