import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { getModelDiagnostics } from "@/modules/model-diagnostics/model-diagnostics.service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await getModelDiagnostics());
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) {
      return Response.json({ error: "no_active_episode" }, { status: 404 });
    }
    return Response.json({ error: "diagnostics_failed" }, { status: 500 });
  }
}

