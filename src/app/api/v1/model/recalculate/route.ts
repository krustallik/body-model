import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";
import { modelPrincipal } from "@/modules/model-episodes/model-http";
import { RecalculateModelRequestSchema } from "@/modules/model-episodes/model-episode.schema";
import { recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";
import { ModelRecoveryEvidenceError } from "@/modules/model-recovery/model-recovery.errors";
import { recoverModelEpisode } from "@/modules/model-recovery/model-recovery.service";
import { errorDiagnosticFields, logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

const DEFAULT_RECOVERY_SEED = 20_260_824;

export async function POST(request: Request): Promise<Response> {
  const principal = await modelPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = RecalculateModelRequestSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const result = await recalculateModelEpisode({ ...parsed.data, profileId: principal.profileId });
    const {
      activeEnergyModelChangedDays: _activeEnergyModelChangedDays,
      sourceReplayChanged: _sourceReplayChanged,
      ...responseResult
    } = result;
    void _activeEnergyModelChangedDays;
    void _sourceReplayChanged;
    if (!result.recoveryRequired) return Response.json(responseResult);
    try {
      const recovery = await recoverModelEpisode({
        seed: DEFAULT_RECOVERY_SEED,
        episodeId: result.episodeId,
        profileId: principal.profileId,
      });
      return Response.json({ ...responseResult, recovery });
    } catch (error) {
      if (error instanceof ModelRecoveryEvidenceError) {
        return Response.json({
          ...responseResult,
          recovery: {
            status: "insufficient_recovery_evidence",
            message: error.message,
          },
        });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) {
      return Response.json({ error: "no_active_episode" }, { status: 404 });
    }
    if (error instanceof ModelEpisodeNotFoundError) {
      return Response.json({ error: "episode_not_found" }, { status: 404 });
    }
    logEvent("error", "recalculation_failed", errorDiagnosticFields(error));
    return Response.json({ error: "recalculation_failed" }, { status: 500 });
  }
}
