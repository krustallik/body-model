import { z } from "zod";
import { getSessionPrincipal } from "@/modules/auth/access";
import { readBodyMapTrainingAnalyticsV1 } from "@/modules/training/body-map-training-analytics.repository";
import {
  bodyMapAnalyticsWeeksForMonthsV1,
  type BodyMapAnalyticsMonthsV1,
} from "@/modules/training/body-map-training-analytics-v1";

export const dynamic = "force-dynamic";

const WeeksSchema = z.enum(["4", "8", "12", "24"]);
const MonthsSchema = z.enum(["1", "2", "3", "6"]);
const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const params = new URL(request.url).searchParams;
  const requestedMonths = params.get("months");
  const parsedMonths = requestedMonths === null ? null : MonthsSchema.safeParse(requestedMonths);
  if (parsedMonths && !parsedMonths.success) return Response.json({ error: "invalid_months" }, { status: 400, headers: NO_STORE });
  const parsedWeeks = requestedMonths === null
    ? WeeksSchema.safeParse(params.get("weeks") ?? "4")
    : null;
  if (parsedWeeks && !parsedWeeks.success) return Response.json({ error: "invalid_weeks" }, { status: 400, headers: NO_STORE });
  try {
    const months = parsedMonths?.success ? Number(parsedMonths.data) as BodyMapAnalyticsMonthsV1 : undefined;
    const weeks = months === undefined
      ? Number(parsedWeeks?.success ? parsedWeeks.data : "4") as 4 | 8 | 12 | 24
      : bodyMapAnalyticsWeeksForMonthsV1(months);
    const analytics = await readBodyMapTrainingAnalyticsV1(
      principal.profileId,
      weeks,
      new Date(),
      months,
    );
    return Response.json({ analytics }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
