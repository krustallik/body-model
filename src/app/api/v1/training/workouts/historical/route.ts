import { getSessionPrincipal } from "@/modules/auth/access";
import { validationResponse } from "@/modules/days/day.http";
import { HistoricalWorkoutsQuerySchema } from "@/modules/training/training.schema";
import { trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const parsed = HistoricalWorkoutsQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    onlyMissingDiary: url.searchParams.get("onlyMissingDiary") ?? undefined,
  });
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const [workouts, totalCount] = await Promise.all([
      trainingService.listHistoricalStrengthWorkouts({
        profileId: principal.profileId,
        limit: parsed.data.limit,
        ...(parsed.data.offset !== undefined ? { offset: parsed.data.offset } : {}),
        cursor: parsed.data.cursor,
        onlyMissingDiary: parsed.data.onlyMissingDiary,
      }),
      trainingService.countHistoricalStrengthWorkouts(principal.profileId, parsed.data.onlyMissingDiary),
    ]);
    return Response.json({ workouts, totalCount });
  } catch {
    return trainingInternalError();
  }
}
