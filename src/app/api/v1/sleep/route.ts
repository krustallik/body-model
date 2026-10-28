import { validationResponse } from "@/modules/days/day.http";
import { CalendarDateSchema } from "@/modules/days/day.schema";
import { SleepRepository } from "@/modules/health/sleep.repository";
import { isLocalDemoMode } from "@/modules/demo/local-demo-mode";
import { localDemoSleepForDate } from "@/modules/demo/local-demo-data";
import { getSessionPrincipal } from "@/modules/auth/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const date = CalendarDateSchema.safeParse(new URL(request.url).searchParams.get("date"));
  if (!date.success) return validationResponse(date.error);
  if (isLocalDemoMode()) return Response.json({ date: date.data, sleep: localDemoSleepForDate(date.data) });
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const sleep = await new SleepRepository(principal.profileId).summaryForDate(date.data);
    return Response.json({ date: date.data, sleep });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
