import { validationResponse } from "@/modules/days/day.http";
import {
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";
import { modelPrincipal } from "@/modules/model-episodes/model-http";
import { RecoveryStatusQuerySchema } from "@/modules/model-recovery/model-recovery.schema";
import {
  getModelRecoveryStatus,
  ModelRefreshVisibilityPendingError,
  TrainingRefreshVisibilityPendingError,
} from "@/modules/model-recovery/model-recovery.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const principal = await modelPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = RecoveryStatusQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    return Response.json(await getModelRecoveryStatus(principal.profileId, parsed.data.episodeId));
  } catch (error) {
    if (error instanceof TrainingRefreshVisibilityPendingError) {
      return Response.json({ error: "training_refresh_pending" }, { status: 503 });
    }
    if (error instanceof ModelRefreshVisibilityPendingError) {
      return Response.json({ error: "model_refresh_pending" }, { status: 503 });
    }
    if (error instanceof NoActiveModelEpisodeError) {
      return Response.json({ error: "no_active_episode" }, { status: 404 });
    }
    if (error instanceof ModelEpisodeNotFoundError) {
      return Response.json({ error: "episode_not_found" }, { status: 404 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
