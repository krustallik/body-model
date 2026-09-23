import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { prisma } from "@/lib/db/prisma";
import { getModelHistory, getModelStatus } from "@/modules/model-episodes/model-episode.service";
import type { ModelDaySourceQuality } from "@/modules/model-episodes/model-episode.types";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { calculateGlycogenAssociatedMassKg } from "@/model/body-composition/state";
import {
  dataQualityChip,
  nutritionSourceChip,
  physiologyV7CacheChip,
  physiologyV7CompartmentChips,
  workoutFeedProvenanceChip,
} from "@/modules/provenance/provenance-presentation";

export const dynamic = "force-dynamic";

type HistoryDayRow = {
  date: string;
  endWeightKg: number | null;
  fatMassKg: number | null;
  leanTissueKg: number | null;
  glycogenKg: number | null;
  dataQuality: string;
  nutritionSource: string;
  sourceQuality: ModelDaySourceQuality | null;
  missingFields: string[];
};

export async function GET(): Promise<Response> {
  try {
    const status = await getModelStatus();
    const history = await getModelHistory({
      from: status.latestModeledDate ? addCalendarDays(status.latestModeledDate, -59) : undefined,
      to: status.latestModeledDate ?? undefined,
      limit: 60,
      offset: 0,
    });
    const days = history.days as HistoryDayRow[];
    const observedWeights = await prisma.dailyHealthData.findMany({
      where: status.latestModeledDate
        ? { date: { gte: addCalendarDays(status.latestModeledDate, -59) } }
        : undefined,
      orderBy: { date: "asc" },
      select: { date: true, weightKg: true },
    }).catch(() => [] as Array<{ date: string; weightKg: number | null }>);
    const latestDate = status.latestModeledDate;
    const latestDay = latestDate === null
      ? null
      : days.find((day) => day.date === latestDate) ?? null;
    const v7 = latestDate === null
      ? null
      : await new PhysiologyV7PersistenceRepository().readDay(1, latestDate).catch(() => null);
    const v7Status = v7 === null ? "missing" as const : v7.status;
    const v7Result = v7?.result ?? null;
    return Response.json({
      status,
      history: days.map((day) => ({
        date: day.date,
        modeledWeightKg: day.endWeightKg,
        fatMassKg: day.fatMassKg,
        leanTissueKg: day.leanTissueKg,
        glycogenAssociatedMassKg: day.glycogenKg === null
          ? null
          : calculateGlycogenAssociatedMassKg(day.glycogenKg),
        dataQuality: day.dataQuality,
        nutritionSource: day.nutritionSource,
        workoutFeedObserved: day.sourceQuality?.workoutFeedObserved ?? null,
        missingFields: day.missingFields,
      })),
      observedWeights: observedWeights
        .filter((day) => day.weightKg !== null && Number.isFinite(day.weightKg) && day.weightKg > 0)
        .map((day) => ({ date: day.date, weightKg: day.weightKg })),
      unknownIntervals: history.unknownIntervals,
      provenance: {
        v7Cache: physiologyV7CacheChip(v7Status),
        v7Compartments: physiologyV7CompartmentChips(v7Result),
        latestDay: latestDay === null ? null : {
          date: latestDay.date,
          dataQuality: dataQualityChip(latestDay.dataQuality),
          nutrition: nutritionSourceChip(latestDay.nutritionSource),
          workoutFeed: workoutFeedProvenanceChip(
            latestDay.sourceQuality?.workoutFeedObserved ?? null,
          ),
        },
      },
    });
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) return Response.json({ error: "no_active_episode" }, { status: 404 });
    return Response.json({ error: "context_failed" }, { status: 500 });
  }
}
