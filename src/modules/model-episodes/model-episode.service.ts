import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { missingPhysiologicalTransitionFields } from "@/model/physiological-simulator";
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

const MINIMUM_AUTOMATIC_RESTART_DAYS = 3;

function latestModelableRunStart(
  days: ReturnType<typeof buildSimulationDays>,
  ecfPolicy: Parameters<typeof missingPhysiologicalTransitionFields>[1],
): string | null {
  let startIndex = days.length;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (missingPhysiologicalTransitionFields(days[index].input, ecfPolicy).length > 0) break;
    startIndex = index;
  }
  return startIndex > 0 && days.length - startIndex >= MINIMUM_AUTOMATIC_RESTART_DAYS
    ? days[startIndex].input.date
    : null;
}

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
      repository.loadSources(addCalendarDays(startDate, -125), startDate),
    ]);
    const prepared = prepareEpisodeInitialization({
      profile,
      days: sources.days,
      sources,
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
    let episode = input.episodeId === undefined
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
    const historyStart = input.episodeId === undefined
      ? addCalendarDays(latestCompletedDate, -125)
      : episode.startDate;
    const sourceStart = historyStart < episode.startDate ? historyStart : episode.startDate;
    const sources = sourceStart <= latestCompletedDate
      ? await repository.loadSources(sourceStart, latestCompletedDate)
      : { days: [], snapshots: [], workIntervals: [], workouts: [] };

    if (input.episodeId === undefined && sourceStart <= latestCompletedDate) {
      const candidateDays = buildSimulationDays({
        from: sourceStart,
        to: latestCompletedDate,
        sources,
        baselineNutritionFallback: episode.baselineNutritionFallback,
        nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
        modelVersion: episode.modelVersion,
      });
      const restartDate = latestModelableRunStart(candidateDays, episode.ecfPolicy);
      if (restartDate !== null && restartDate !== episode.startDate) {
        const profile = await repository.getProfile();
        const prepared = prepareEpisodeInitialization({
          profile,
          days: sources.days,
          sources,
          startDate: restartDate,
          timezone: episode.timezone,
        });
        await repository.deactivateActive(input.now ?? new Date());
        episode = await repository.createPrepared(prepared);
      }
    }

    const builtDays = episode.startDate > latestCompletedDate
      ? []
      : buildSimulationDays({
        from: episode.startDate,
        to: latestCompletedDate,
        sources,
        baselineNutritionFallback: episode.baselineNutritionFallback,
        nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
        modelVersion: episode.modelVersion,
      });
    // Scientific initialization semantics are frozen per episode. Legacy v4
    // episodes must be explicitly reinitialized rather than silently relabeled v5.
    const calculation = calculateEpisodeHistory({ episode, days: builtDays });
    await repository.persistCalculation(episode.id, calculation, episode.modelVersion);
    // Recalculation follows all source mutations; stale conservatively until an
    // identical source/config/seed recovery resets the fingerprinted upsert.
    await repository.markRecoveryRunsStale(episode.id);
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
      resolvedUntil: calculation.latestModeledDate,
      continuityStatus: calculation.continuityStatus,
      recoveryRequired: calculation.unknownIntervals.length > 0,
      unknownIntervals: calculation.unknownIntervals,
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
