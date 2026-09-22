import { readJson } from "@/modules/days/day.http";
import {
  initializeNewModelEpisode,
  recalculateModelEpisode,
} from "@/modules/model-episodes/model-episode.service";
import {
  EpisodeInitializationError,
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";
import { ModelRecoveryEvidenceError } from "@/modules/model-recovery/model-recovery.errors";
import { recoverModelEpisode } from "@/modules/model-recovery/model-recovery.service";
import { forecastQaNow } from "../qa-now";
import { errorKind, logEvent } from "@/lib/logger";
import { tryAcquireOperation } from "@/lib/operation-gate";

export const dynamic = "force-dynamic";

const FORECAST_ACTIONS = new Set(["recover", "recalculate", "initialize"]);
const DEFAULT_RECOVERY_SEED = 20_260_824;

async function recalculateThenRecover(now?: Date) {
  const result = await recalculateModelEpisode(now ? { now } : {});
  if (!result.recoveryRequired) return result;
  try {
    const recovery = await recoverModelEpisode({
      seed: DEFAULT_RECOVERY_SEED,
      episodeId: result.episodeId,
      ...(now ? { now } : {}),
    });
    return { ...result, recovery };
  } catch (error) {
    if (error instanceof ModelRecoveryEvidenceError) {
      return {
        ...result,
        recovery: {
          status: "insufficient_recovery_evidence" as const,
          message: error.message,
        },
      };
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const action = (body as { action?: unknown }).action;
  if (typeof action !== "string" || !FORECAST_ACTIONS.has(action)) {
    return Response.json({ error: "invalid_action" }, { status: 400 });
  }
  const release = tryAcquireOperation(action);
  if (!release) return Response.json({ error: "operation_in_progress" }, { status: 429, headers: { "Retry-After": "1" } });
  try {
    const now = forecastQaNow();
    if (action === "recover") {
      return Response.json(await recoverModelEpisode({ seed: DEFAULT_RECOVERY_SEED, ...(now ? { now } : {}) }));
    }
    if (action === "initialize") {
      const episode = await initializeNewModelEpisode(now ? { now } : {});
      // Initialization creates the active episode and freezes its assumptions;
      // immediately materialize the available history so Diagnostics is
      // populated on the same click, including insufficient-history bootstrap
      // episodes.
      await recalculateModelEpisode(now ? { now } : {});
      return Response.json({
        status: "ok",
        episodeId: episode.id,
        modelVersion: episode.modelVersion,
        startDate: episode.startDate,
      });
    }
    return Response.json(await recalculateThenRecover(now));
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) return Response.json({ error: "no_active_episode" }, { status: 404 });
    if (error instanceof ModelEpisodeNotFoundError) return Response.json({ error: "episode_not_found" }, { status: 404 });
    if (error instanceof ModelRecoveryEvidenceError) {
      return Response.json({ error: "insufficient_recovery_evidence", message: error.message }, { status: 422 });
    }
    if (error instanceof EpisodeInitializationError) {
      return Response.json({
        error: "initialization_failed",
        reason: error.reason,
        message: error.reason,
      }, { status: 422 });
    }
    const event = action === "recover" ? "recovery_failed"
      : action === "initialize" ? "initialization_failed"
        : "recalculation_failed";
    logEvent("error", event, { errorType: errorKind(error) });
    return Response.json({ error: event }, { status: 500 });
  } finally {
    release();
  }
}
