import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import {
  getModelDiagnostics,
  TrainingRefreshPendingDiagnosticsError,
} from "@/modules/model-diagnostics/model-diagnostics.service";
import { errorKind, logEvent } from "@/lib/logger";
import { getSessionPrincipal } from "@/modules/auth/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json(await getModelDiagnostics(principal.profileId));
  } catch (error) {
    if (error instanceof TrainingRefreshPendingDiagnosticsError) {
      return Response.json({ error: "training_refresh_pending" }, { status: 503 });
    }
    if (error instanceof NoActiveModelEpisodeError) {
      return Response.json({ error: "no_active_episode" }, { status: 404 });
    }
    logEvent("error", "diagnostics_failed", { errorType: errorKind(error) });
    return Response.json({ error: "diagnostics_failed" }, { status: 500 });
  }
}
