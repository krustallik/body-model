import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";
import { modelAuthorizationError } from "@/modules/model-episodes/model-http";
import { RecalculateModelRequestSchema } from "@/modules/model-episodes/model-episode.schema";
import { recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = modelAuthorizationError(request);
  if (unauthorized) return unauthorized;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = RecalculateModelRequestSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    return Response.json(await recalculateModelEpisode(parsed.data));
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) {
      return Response.json({ error: "no_active_episode" }, { status: 404 });
    }
    if (error instanceof ModelEpisodeNotFoundError) {
      return Response.json({ error: "episode_not_found" }, { status: 404 });
    }
    return Response.json({ error: "recalculation_failed" }, { status: 500 });
  }
}
