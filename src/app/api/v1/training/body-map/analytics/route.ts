import { z } from "zod";
import { getSessionPrincipal } from "@/modules/auth/access";
import { readBodyMapTrainingAnalyticsV1 } from "@/modules/training/body-map-training-analytics.repository";

export const dynamic = "force-dynamic";

const WeeksSchema = z.enum(["4", "8", "12"]);
const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const parsed = WeeksSchema.safeParse(new URL(request.url).searchParams.get("weeks") ?? "4");
  if (!parsed.success) return Response.json({ error: "invalid_weeks" }, { status: 400, headers: NO_STORE });
  try {
    const analytics = await readBodyMapTrainingAnalyticsV1(
      principal.profileId,
      Number(parsed.data) as 4 | 8 | 12,
    );
    return Response.json({ analytics }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
