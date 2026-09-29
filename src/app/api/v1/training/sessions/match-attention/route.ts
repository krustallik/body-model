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
    const [sessions, totalCount] = await Promise.all([
      trainingService.listMatchAttention({
        limit: query.data.limit,
        ...(query.data.offset !== undefined ? { offset: query.data.offset } : {}),
      }),
      trainingService.countMatchAttention(),
    ]);
    return Response.json({ sessions, totalCount });
  } catch {
    return trainingInternalError();
  }
}
