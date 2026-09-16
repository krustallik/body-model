import { readJson } from "@/modules/days/day.http";
import { recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";
import { ModelEpisodeNotFoundError, NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { ModelRecoveryEvidenceError } from "@/modules/model-recovery/model-recovery.errors";
import { recoverModelEpisode } from "@/modules/model-recovery/model-recovery.service";
import { forecastQaNow } from "../qa-now";
import { errorKind, logEvent } from "@/lib/logger";
import { tryAcquireOperation } from "@/lib/operation-gate";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const action = (body as { action?: unknown }).action;
  if (action !== "recover" && action !== "recalculate") {
    return Response.json({ error: "invalid_action" }, { status: 400 });
  }
  const release = tryAcquireOperation(action);
  if (!release) return Response.json({ error: "operation_in_progress" }, { status: 429, headers: { "Retry-After": "1" } });
  try {
    const now = forecastQaNow();
    if (action === "recover") return Response.json(await recoverModelEpisode({ seed: 20_260_824, ...(now ? { now } : {}) }));
    return Response.json(await recalculateModelEpisode(now ? { now } : {}));
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) return Response.json({ error: "no_active_episode" }, { status: 404 });
    if (error instanceof ModelEpisodeNotFoundError) return Response.json({ error: "episode_not_found" }, { status: 404 });
    if (error instanceof ModelRecoveryEvidenceError) return Response.json({ error: "insufficient_recovery_evidence", message: error.message }, { status: 422 });
    const event = action === "recover" ? "recovery_failed" : "recalculation_failed";
    logEvent("error", event, { errorType: errorKind(error) });
    return Response.json({ error: event }, { status: 500 });
  } finally {
    release();
  }
}
