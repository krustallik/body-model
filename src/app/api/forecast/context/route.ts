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
  isTrainingRefreshPending,
  readTrainingRefreshVisibilityFence,
  trainingRefreshFenceChanged,
  trainingRefreshWorkerOwnsGeneration,
} from "@/modules/training/training-refresh-queue";
import {
  dataQualityChip,
  nutritionSourceChip,
  physiologyV7CacheChip,
  physiologyV7CompartmentChips,
  workoutFeedProvenanceChip,
} from "@/modules/provenance/provenance-presentation";
import { getSessionPrincipal } from "@/modules/auth/access";

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

export async function GET(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  const profileId = principal.profileId;
  try {
    const trainingFence = await readTrainingRefreshVisibilityFence(prisma, profileId);
    const locale = new URL(request.url).searchParams.get("locale") === "uk" ? "uk" : "en";
    const status = await getModelStatus(profileId);
    const history = await getModelHistory({
      profileId,
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
        ? { profileId, date: { gte: addCalendarDays(status.latestModeledDate, -59), lte: forecastStartDate } }
        : { profileId, date: { lte: forecastStartDate } },
      orderBy: { date: "asc" },
      select: { date: true, weightKg: true },
    }).catch(() => [] as Array<{ date: string; weightKg: number | null }>);
    const latestDate = status.latestModeledDate;
    const latestDay = latestDate === null
      ? null
      : days.find((day) => day.date === latestDate) ?? null;
    const v7 = latestDate === null
      ? null
      : await new PhysiologyV7PersistenceRepository().readDay(profileId, latestDate).catch(() => null);
    const workerOwnsGeneration = await trainingRefreshWorkerOwnsGeneration(
      prisma,
      profileId,
      trainingFence?.requestedGeneration,
    );
    if ((isTrainingRefreshPending(trainingFence) && !workerOwnsGeneration)
        || await trainingRefreshFenceChanged(prisma, profileId, trainingFence)) {
      return Response.json({ error: "training_refresh_pending" }, { status: 503 });
    }
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
