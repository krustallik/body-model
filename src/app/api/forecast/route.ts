import { readJson, validationResponse } from "@/modules/days/day.http";
import { ModelEpisodeNotFoundError, NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { getModelStatus, recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";
import { EpisodeInitializationError } from "@/modules/model-episodes/model-episode.errors";
import { ModelRecoveryEvidenceError } from "@/modules/model-recovery/model-recovery.errors";
import { recoverModelEpisode } from "@/modules/model-recovery/model-recovery.service";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import { ForecastScenarioEvidenceError, ForecastUnavailableError } from "@/modules/model-forecast/model-forecast.errors";
import { ForecastModelRequestSchema } from "@/modules/model-forecast/model-forecast.schema";
import { forecastModelEpisode } from "@/modules/model-forecast/model-forecast.service";
import { forecastQaNow } from "./qa-now";
import { errorKind, logEvent } from "@/lib/logger";
import { tryAcquireOperation } from "@/lib/operation-gate";

export const dynamic = "force-dynamic";

/** Forecast can replay health rows in memory; diagnostics need persisted DailyModelState. */
const DEFAULT_RECOVERY_SEED = 20_260_824;

async function ensurePersistedModelDays(now?: Date): Promise<void> {
  try {
    let status = await getModelStatus();
    if (status.daysModeled === 0 || status.latestModeledDate === null) {
      try {
        await recalculateModelEpisode(now ? { now } : {});
        status = await getModelStatus();
      } catch (error) {
        // Strict production initialization is intentionally allowed to fail
        // here; the forecast-only bootstrap can still provide a provisional
        // result without persisting an episode or synthetic observations.
        if (!(error instanceof EpisodeInitializationError)) throw error;
        return;
      }
    }
    if (status.recoveryRequired) {
      try {
        await recoverModelEpisode({ seed: DEFAULT_RECOVERY_SEED, ...(now ? { now } : {}) });
      } catch (error) {
        // Recovery evidence is a quality improvement, not a reason to dead-end
        // a forecast that can run from an observed or bootstrap anchor.
        if (!(error instanceof ModelRecoveryEvidenceError)) throw error;
      }
    }
    if (status.latestModeledDate !== null && typeof status.episodeStartDate === "string") {
      await rebuildUnifiedExperimentalPhysiologyStateV1({
        fromDate: status.episodeStartDate,
        toDate: status.latestModeledDate,
      }).catch(() => {});
    }
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) return;
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = ForecastModelRequestSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  const release = tryAcquireOperation("forecast");
  if (!release) return Response.json({ error: "operation_in_progress" }, { status: 429, headers: { "Retry-After": "1" } });
  const now = forecastQaNow();
  try {
    await ensurePersistedModelDays(now);
    return Response.json(await forecastModelEpisode({ ...parsed.data, ...(now ? { now } : {}) }));
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) {
      return Response.json({ error: "no_active_episode" }, { status: 404 });
    }
    if (error instanceof ModelEpisodeNotFoundError) return Response.json({ error: "episode_not_found" }, { status: 404 });
    if (error instanceof ForecastUnavailableError) {
      return Response.json({
        error: "forecast_unavailable",
        reason: error.reason,
        message: error.reason === "missing-weight"
          ? "Додайте хоча б одне вимірювання ваги, щоб побудувати стартовий прогноз."
          : "Заповніть профіль, щоб побудувати прогноз.",
      }, { status: 422 });
    }
    if (error instanceof ForecastScenarioEvidenceError) {
      return Response.json({ error: "insufficient_scenario_evidence", message: error.message }, { status: 422 });
    }
    logEvent("error", "forecast_failed", { errorType: errorKind(error) });
    return Response.json({ error: "forecast_failed" }, { status: 500 });
  } finally {
    release();
  }
}
