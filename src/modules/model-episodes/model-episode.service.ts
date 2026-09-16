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
import type {
  HistoricalModelSources,
  PersistedEpisode,
  PreparedEpisodeInitialization,
} from "./model-episode.types";
import { ModelEpisodeRepository } from "./model-episode.repository";
import { addCalendarDays, latestCompletedLocalDate } from "./model-calendar";
import { CURRENT_MODEL_VERSION } from "./model-version";
import { buildSimulationDays } from "./simulation-input-builder";

const MINIMUM_AUTOMATIC_RESTART_DAYS = 3;

type ModelableRun = { startDate: string; endDate: string };

function modelableRuns(
  days: ReturnType<typeof buildSimulationDays>,
  ecfPolicy: Parameters<typeof missingPhysiologicalTransitionFields>[1],
): ModelableRun[] {
  const runs: ModelableRun[] = [];
  for (let index = 0; index < days.length;) {
    if (missingPhysiologicalTransitionFields(days[index].input, ecfPolicy).length > 0) {
      index += 1;
      continue;
    }
    const startIndex = index;
    while (index < days.length
        && missingPhysiologicalTransitionFields(days[index].input, ecfPolicy).length === 0) {
      index += 1;
    }
    if (index - startIndex >= MINIMUM_AUTOMATIC_RESTART_DAYS) {
      runs.push({
        startDate: days[startIndex].input.date,
        endDate: days[index - 1].input.date,
      });
    }
  }
  return runs;
}

function preferredModelableRunStart(
  days: ReturnType<typeof buildSimulationDays>,
  ecfPolicy: Parameters<typeof missingPhysiologicalTransitionFields>[1],
  sources: HistoricalModelSources,
): string | null {
  const starts = modelableRuns(days, ecfPolicy).flatMap((run) => {
    const anchored = inputSourcesInRange(sources, run).find((day) => (
      day.weightKg !== null && day.bodyFatPercent !== null
    ));
    if (!anchored) return [];
    const remainingDays = days.filter(({ input }) => (
      input.date >= anchored.date && input.date <= run.endDate
    )).length;
    return remainingDays >= MINIMUM_AUTOMATIC_RESTART_DAYS ? [anchored.date] : [];
  });
  // Always prefer the earliest retained modelable run. Choosing the newest run
  // when the active episode already starts on an older block flips 5↔11 on every
  // recalculate; gaps stay explicit via unknown-interval recovery.
  return starts[0] ?? null;
}

function inputSourcesInRange(
  sources: HistoricalModelSources,
  run: ModelableRun,
) {
  return sources.days
    .filter(({ date }) => date >= run.startDate && date <= run.endDate)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function prepareRestartFromFrozenEpisode(input: {
  episode: PersistedEpisode;
  sources: HistoricalModelSources;
  startDate: string;
}): PreparedEpisodeInitialization {
  const observed = input.sources.days.find(({ date }) => date === input.startDate);
  const fallbackNutrition = input.episode.baselineNutritionFallback ?? (
    observed?.caloriesKcal != null
    && observed.proteinG != null
    && observed.fatG != null
    && observed.carbsG != null
      ? {
          caloriesKcal: observed.caloriesKcal,
          proteinG: observed.proteinG,
          fatG: observed.fatG,
          carbsG: observed.carbsG,
        }
      : null
  );
  if (!fallbackNutrition) throw new EpisodeInitializationError("insufficient-baseline-data");

  return {
    profileId: input.episode.profileId,
    startDate: input.startDate,
    timezone: input.episode.timezone,
    modelVersion: CURRENT_MODEL_VERSION,
    ecfPolicy: input.episode.ecfPolicy,
    baseline: {
      baselineEnergyIntakeKcalPerDay: input.episode.baselineEnergyIntakeKcalPerDay,
      baselineCarbIntakeG: input.episode.baselineCarbIntakeG,
      fallbackNutrition,
      diagnostics: {
        method: "quality-ranked-variable-window-v5",
        windowStartDate: input.episode.baselineWindowStartDate,
        windowEndDate: input.episode.baselineWindowEndDate,
        windowDays: Math.max(1, input.episode.baselineNutritionDayCount),
        completeNutritionDayCount: input.episode.baselineNutritionDayCount,
        weightObservationCount: input.episode.baselineWeightObservationCount,
        weightObservationSpanDays: Math.max(0, input.episode.baselineWeightObservationCount - 1),
        medianWeightKg: input.episode.initialState.weightFilterState.estimatedWeightKg,
        weightTrendKgPerWeek: input.episode.baselineWeightTrendKgPerWeek,
        weightTrendPercentPerWeek: input.episode.baselineWeightTrendPercentPerWeek,
        maximumAbsoluteWeightTrendPercentPerWeek: 0.25,
      },
    },
    initialState: input.episode.initialState,
    simulatorParameters: input.episode.simulatorParameters,
    initialRmrKcalPerDay: input.episode.initialRmrKcalPerDay,
    bodyFatObservationCount: 0,
    bodyFatSpreadPercent: 0,
    nutritionMaxBridgeDays: input.episode.nutritionMaxBridgeDays,
    observedReferenceNutrition: fallbackNutrition,
    energyHomeostasisReferenceKcalPerDay:
      input.episode.simulatorParameters.baselineEnergyIntakeKcalPerDay,
    glycogenReferenceCarbIntakeG:
      input.episode.simulatorParameters.glycogenParameters.baselineCarbIntakeG,
    initialPersonalOffsetKcalPerDay: input.episode.initialPersonalOffsetKcalPerDay ?? 0,
    appliedPersonalOffsetKcalPerDay: input.episode.personalOffsetKcalPerDay,
    initializationApplicationReason: "validated-default-zero",
    initializationStatus: "insufficient",
    initializationDiagnostics: {
      reason: "post-gap-restart-reused-frozen-episode",
      sourceEpisodeId: input.episode.id,
    },
  };
}

function prepareHistoricalEpisode(input: {
  profile: Parameters<typeof prepareEpisodeInitialization>[0]["profile"];
  sources: HistoricalModelSources;
  startDate: string;
  timezone: string;
}): PreparedEpisodeInitialization {
  try {
    return prepareEpisodeInitialization({
      profile: input.profile,
      days: input.sources.days,
      sources: input.sources,
      startDate: input.startDate,
      timezone: input.timezone,
    });
  } catch (error) {
    if (!(error instanceof EpisodeInitializationError)
        || error.reason !== "insufficient-baseline-data") throw error;
    // Retention can leave the first usable day without a preceding 28-day
    // baseline. A one-day bootstrap is explicit and auditable; later history
    // still calibrates normally instead of being silently thrown away.
    return prepareEpisodeInitialization({
      profile: input.profile,
      days: input.sources.days,
      sources: input.sources,
      startDate: input.startDate,
      timezone: input.timezone,
      baselineConfig: {
        windowDays: 1,
        lookbackDays: 1,
        minimumCompleteNutritionDays: 1,
        minimumWeightObservations: 1,
        minimumWeightSpanDays: 1,
        maximumAbsoluteWeightTrendPercentPerWeek: 0.25,
      },
    });
  }
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
      // Restart eligibility must use current semantics. Otherwise a legacy
      // episode can never see a modern rest day (observed workout feed + no
      // strength event) as zero, so it remains permanently stuck before the
      // very gap that should cause a new current-version episode.
      const candidateDays = buildSimulationDays({
        from: sourceStart,
        to: latestCompletedDate,
        sources,
        baselineNutritionFallback: episode.baselineNutritionFallback,
        nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
        modelVersion: CURRENT_MODEL_VERSION,
      });
      const restartDate = preferredModelableRunStart(
        candidateDays,
        episode.ecfPolicy,
        sources,
      );
      if (restartDate !== null && restartDate !== episode.startDate) {
        const profile = await repository.getProfile();
        let prepared: PreparedEpisodeInitialization;
        try {
          prepared = prepareHistoricalEpisode({
            profile,
            sources,
            startDate: restartDate,
            timezone: episode.timezone,
          });
        } catch (error) {
          if (!(error instanceof EpisodeInitializationError)
              || error.reason !== "insufficient-baseline-data") throw error;
          prepared = prepareRestartFromFrozenEpisode({ episode, sources, startDate: restartDate });
        }
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
