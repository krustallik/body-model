import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";
import { modelAuthorizationError } from "@/modules/model-episodes/model-http";
import { ModelRecoveryEvidenceError } from "@/modules/model-recovery/model-recovery.errors";
import { RecoverModelRequestSchema } from "@/modules/model-recovery/model-recovery.schema";
import { recoverModelEpisode } from "@/modules/model-recovery/model-recovery.service";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = modelAuthorizationError(request);
  if (unauthorized) return unauthorized;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = RecoverModelRequestSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    return Response.json(await recoverModelEpisode(parsed.data));
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) {
      return Response.json({ error: "no_active_episode" }, { status: 404 });
    }
    if (error instanceof ModelEpisodeNotFoundError) {
      return Response.json({ error: "episode_not_found" }, { status: 404 });
    }
    if (error instanceof ModelRecoveryEvidenceError) {
      return Response.json({ error: "insufficient_recovery_evidence", message: error.message }, { status: 422 });
    }
    return Response.json({ error: "recovery_failed" }, { status: 500 });
  }
}
