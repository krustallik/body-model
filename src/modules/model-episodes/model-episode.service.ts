import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { calculateEpisodeHistory } from "./episode-calculation";
import { prepareEpisodeInitialization } from "./episode-initialization";
import {
  EpisodeInitializationError,
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "./model-episode.errors";
import type { ModelHistoryQuery } from "./model-episode.schema";
import { ModelEpisodeRepository } from "./model-episode.repository";
import { addCalendarDays, latestCompletedLocalDate } from "./model-calendar";
import { buildSimulationDays } from "./simulation-input-builder";

const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 30_000,
} as const;

/** Starts a new auditable episode and deactivates, rather than mutating, the old one. */
export async function initializeNewModelEpisode(
  input: {
    startDate?: string;
    timezone?: string;
    now?: Date;
  } = {},
  client: PrismaClient = prisma,
) {
  const timezone = input.timezone ?? DEFAULT_TIME_ZONE;
  const now = input.now ?? new Date();
  const latestCompletedDate = latestCompletedLocalDate(now, timezone);
  const startDate = input.startDate ?? latestCompletedDate;
  if (startDate > latestCompletedDate) {
    throw new EpisodeInitializationError("start-date-not-complete");
  }

  return client.$transaction(async (transaction) => {
    const repository = new ModelEpisodeRepository(transaction);
    const [profile, sources] = await Promise.all([
      repository.getProfile(),
      repository.loadSources(addCalendarDays(startDate, -89), startDate),
    ]);
    const prepared = prepareEpisodeInitialization({
      profile,
      days: sources.days,
      startDate,
      timezone,
    });
    await repository.deactivateActive(now);
    return repository.createPrepared(prepared);
  }, TRANSACTION_OPTIONS);
}

/** Full deterministic rebuild; reads, calculation, and replacement share one DB snapshot. */
export async function recalculateModelEpisode(
  input: { episodeId?: number; now?: Date } = {},
  client: PrismaClient = prisma,
) {
  return client.$transaction(async (transaction) => {
    const repository = new ModelEpisodeRepository(transaction);
    const episode = input.episodeId === undefined
      ? await repository.getActive()
      : await repository.getById(input.episodeId);
    if (!episode) {
      if (input.episodeId === undefined) throw new NoActiveModelEpisodeError();
      throw new ModelEpisodeNotFoundError();
    }
    const latestCompletedDate = latestCompletedLocalDate(
      input.now ?? new Date(),
      episode.timezone,
    );
    const sources = episode.startDate <= latestCompletedDate
      ? await repository.loadSources(episode.startDate, latestCompletedDate)
      : { days: [], snapshots: [], workIntervals: [] };
    const sourceDates = [
      ...sources.days.map(({ date }) => date),
      ...sources.snapshots.map(({ date }) => date),
      ...sources.workIntervals.map(({ date }) => date),
    ];
    const finalSourceDate = sourceDates.sort().at(-1) ?? null;
    const builtDays = finalSourceDate === null
      ? []
      : buildSimulationDays({
        from: episode.startDate,
        to: finalSourceDate,
        sources,
        baselineNutritionFallback: episode.baselineNutritionFallback,
        nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
      });
    const calculation = calculateEpisodeHistory({ episode, days: builtDays });
    await repository.persistCalculation(episode.id, calculation);
    const status = await repository.status(episode.id);
    return {
      status: "ok" as const,
      episodeId: episode.id,
      modelVersion: episode.modelVersion,
      calibrationStatus: calculation.calibration.status,
      personalOffsetKcalPerDay:
        calculation.calibration.parameters.personalOffsetKcalPerDay,
      activityCalibration:
        calculation.calibration.parameters.activityCalibration,
      daysPersisted: calculation.dailyStates.length,
      completeDays: calculation.dailyStates.filter(({ status }) => status === "complete").length,
      incompleteDays:
        calculation.dailyStates.filter(({ status }) => status !== "complete").length,
      observedNutritionDays:
        calculation.dailyStates.filter(({ nutrition }) => nutrition.source === "observed").length,
      imputedNutritionDays: calculation.dailyStates.filter(({ nutrition }) => (
        nutrition.source === "imputed-local" || nutrition.source === "imputed-fallback"
      )).length,
      unbridgeableNutritionDays:
        calculation.dailyStates.filter(({ nutrition }) => nutrition.source === "missing").length,
      latestModeledDate: calculation.latestModeledDate,
      current: status,
    };
  }, TRANSACTION_OPTIONS);
}

export async function getModelStatus(
  episodeId?: number,
  client: PrismaClient = prisma,
) {
  const result = await new ModelEpisodeRepository(client).status(episodeId);
  if (!result) {
    if (episodeId === undefined) throw new NoActiveModelEpisodeError();
    throw new ModelEpisodeNotFoundError();
  }
  return result;
}

export async function getModelHistory(
  query: ModelHistoryQuery,
  client: PrismaClient = prisma,
) {
  const result = await new ModelEpisodeRepository(client).history(query);
  if (!result) {
    if (query.episodeId === undefined) throw new NoActiveModelEpisodeError();
    throw new ModelEpisodeNotFoundError();
  }
  return { ...result, limit: query.limit, offset: query.offset };
}
