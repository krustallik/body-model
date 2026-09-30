import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { prisma } from "@/lib/db/prisma";
import { getModelHistory, getModelStatus } from "@/modules/model-episodes/model-episode.service";
import type { ModelDaySourceQuality } from "@/modules/model-episodes/model-episode.types";
import { addCalendarDays, latestCompletedLocalDate } from "@/modules/model-episodes/model-calendar";
import { minimumGoalDate } from "@/modules/model-target-solver/goal-date";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
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
  filteredWeightKg: number | null;
  fatMassKg: number | null;
  leanTissueKg: number | null;
  glycogenKg: number | null;
  dataQuality: string;
  nutritionSource: string;
  sourceQuality: ModelDaySourceQuality | null;
  missingFields: string[];
};

export function GET(): Promise<Response>;
export function GET(request: Request): Promise<Response>;
export async function GET(request: Request = new Request("http://localhost")): Promise<Response> {
  try {
    const locale = new URL(request.url).searchParams.get("locale") === "uk" ? "uk" : "en";
    const status = await getModelStatus();
    const history = await getModelHistory({
      from: status.latestModeledDate ? addCalendarDays(status.latestModeledDate, -59) : undefined,
      to: status.latestModeledDate ?? undefined,
      limit: 60,
      offset: 0,
    });
    const days = history.days as HistoryDayRow[];
    const latestCompletedDate = latestCompletedLocalDate(
      new Date(),
      status.timezone ?? DEFAULT_TIME_ZONE,
    );
    const forecastStartDate = minimumGoalDate(latestCompletedDate);
    const observedWeights = await prisma.dailyHealthData.findMany({
      where: status.latestModeledDate
        ? { date: { gte: addCalendarDays(status.latestModeledDate, -59), lte: forecastStartDate } }
        : { date: { lte: forecastStartDate } },
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
      latestCompletedLocalDate: latestCompletedDate,
      history: days.map((day) => ({
        date: day.date,
        modeledWeightKg: day.endWeightKg,
        filteredWeightKg: day.filteredWeightKg,
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
        v7Cache: physiologyV7CacheChip(v7Status, locale),
        v7Compartments: physiologyV7CompartmentChips(v7Result, locale),
        latestDay: latestDay === null ? null : {
          date: latestDay.date,
          dataQuality: dataQualityChip(latestDay.dataQuality, locale),
          nutrition: nutritionSourceChip(latestDay.nutritionSource, locale),
          workoutFeed: workoutFeedProvenanceChip(
            latestDay.sourceQuality?.workoutFeedObserved ?? null,
            locale,
          ),
        },
      },
    });
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) return Response.json({ error: "no_active_episode" }, { status: 404 });
    return Response.json({ error: "context_failed" }, { status: 500 });
  }
}
