import { readJson, validationResponse } from "@/modules/days/day.http";
import { ModelEpisodeNotFoundError, NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import {
  getModelStatus,
  recalculateModelEpisode,
} from "@/modules/model-episodes/model-episode.service";
import { ForecastScenarioEvidenceError } from "@/modules/model-forecast/model-forecast.errors";
import { ForecastModelRequestSchema } from "@/modules/model-forecast/model-forecast.schema";
import { forecastModelEpisode } from "@/modules/model-forecast/model-forecast.service";
import { forecastQaNow } from "./qa-now";
import { errorKind, logEvent } from "@/lib/logger";
import { tryAcquireOperation } from "@/lib/operation-gate";

export const dynamic = "force-dynamic";

/** Forecast can replay health rows in memory; diagnostics need persisted DailyModelState. */
async function ensurePersistedModelDays(now?: Date): Promise<void> {
  try {
    const status = await getModelStatus();
    if (status.daysModeled > 0 && status.latestModeledDate !== null) return;
    await recalculateModelEpisode(now ? { now } : {});
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
  try {
    const now = forecastQaNow();
    await ensurePersistedModelDays(now);
    return Response.json(await forecastModelEpisode({ ...parsed.data, ...(now ? { now } : {}) }));
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) return Response.json({ error: "no_active_episode" }, { status: 404 });
    if (error instanceof ModelEpisodeNotFoundError) return Response.json({ error: "episode_not_found" }, { status: 404 });
    if (error instanceof ForecastScenarioEvidenceError) {
      return Response.json({ error: "insufficient_scenario_evidence", message: error.message }, { status: 422 });
    }
    logEvent("error", "forecast_failed", { errorType: errorKind(error) });
    return Response.json({ error: "forecast_failed" }, { status: 500 });
  } finally {
    release();
  }
}
