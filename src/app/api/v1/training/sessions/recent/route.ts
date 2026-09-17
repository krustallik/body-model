import { validationResponse } from "@/modules/days/day.http";
import { RecentSessionsQuerySchema } from "@/modules/training/training.schema";
import { trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const query = RecentSessionsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return validationResponse(query.error);

  try {
    const sessions = await trainingService.listRecentSessions({ limit: query.data.limit });
    return Response.json({ sessions });
  } catch {
    return trainingInternalError();
  }
}
