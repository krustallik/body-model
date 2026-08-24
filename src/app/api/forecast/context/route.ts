import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { getModelHistory, getModelStatus } from "@/modules/model-episodes/model-episode.service";
import type { DailyModelStateWrite } from "@/modules/model-episodes/model-episode.types";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { calculateGlycogenAssociatedMassKg } from "@/model/body-composition/state";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const status = await getModelStatus();
    const history = await getModelHistory({
      from: status.latestModeledDate ? addCalendarDays(status.latestModeledDate, -59) : undefined,
      to: status.latestModeledDate ?? undefined,
      limit: 60,
      offset: 0,
    });
    return Response.json({
      status,
      history: (history.days as Array<DailyModelStateWrite & { updatedAt: string }>).map((day) => ({
        date: day.date,
        modeledWeightKg: day.endWeightKg,
        fatMassKg: day.fatMassKg,
        leanTissueKg: day.leanTissueKg,
        glycogenAssociatedMassKg: day.glycogenKg === null ? null : calculateGlycogenAssociatedMassKg(day.glycogenKg),
        dataQuality: day.dataQuality,
      })),
      unknownIntervals: history.unknownIntervals,
    });
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) return Response.json({ error: "no_active_episode" }, { status: 404 });
    return Response.json({ error: "context_failed" }, { status: 500 });
  }
}
