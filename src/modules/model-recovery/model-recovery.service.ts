import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { simulateDays } from "@/model/physiological-simulator";
import {
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { addCalendarDays, latestCompletedLocalDate } from "@/modules/model-episodes/model-calendar";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { analyzeStateContinuity } from "@/modules/model-episodes/unknown-intervals";
import { ModelRecoveryEvidenceError } from "./model-recovery.errors";
import { ModelRecoveryRepository } from "./model-recovery.repository";
import type { RecoverModelRequest } from "./model-recovery.schema";
import {
  recoveryConfigFingerprint,
  recoverySourceFingerprint,
  resolvedRecoveryConfig,
} from "./recovery-fingerprint";
import { recoverHistoricalTrajectories } from "./trajectory-recovery";

const RECOVERY_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 60_000,
} as const;

export async function recoverModelEpisode(
  input: RecoverModelRequest & { now?: Date },
  client: PrismaClient = prisma,
) {
  return client.$transaction(async (transaction) => {
    const episodes = new ModelEpisodeRepository(transaction);
    const recovery = new ModelRecoveryRepository(transaction);
    const episode = input.episodeId === undefined
      ? await episodes.getActive()
      : await episodes.getById(input.episodeId);
    if (!episode) {
      if (input.episodeId === undefined) throw new NoActiveModelEpisodeError();
      throw new ModelEpisodeNotFoundError();
    }

    const latestCompletedDate = latestCompletedLocalDate(input.now ?? new Date(), episode.timezone);
    if (episode.startDate > latestCompletedDate) {
      await recovery.markAllStale(episode.id);
      return { status: "not-required" as const, episodeId: episode.id, recoveryRequired: false };
    }
    const sources = await episodes.loadSources(episode.startDate, latestCompletedDate);
    const days = buildSimulationDays({
      from: episode.startDate,
      to: latestCompletedDate,
      sources,
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
    });
    const continuity = analyzeStateContinuity(days, episode.ecfPolicy);
    if (continuity.unknownIntervals.length === 0) {
      await recovery.markAllStale(episode.id);
      return { status: "not-required" as const, episodeId: episode.id, recoveryRequired: false };
    }

    const firstUnknownDate = continuity.unknownIntervals[0].startDate;
    const firstUnknownIndex = days.findIndex(({ input: day }) => day.date === firstUnknownDate);
    const config = resolvedRecoveryConfig(input.config);
    const donorFrom = addCalendarDays(firstUnknownDate, -config.donorLookbackDays);
    const donorTo = addCalendarDays(firstUnknownDate, -1);
    const donorSources = await episodes.loadSources(donorFrom, donorTo);
    const donorDays = buildSimulationDays({
      from: donorFrom,
      to: donorTo,
      sources: donorSources,
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
    });

    let recoveryInitialState = episode.initialState;
    if (continuity.resolvedDays.length > 0) {
      const replay = simulateDays({
        initialState: episode.initialState,
        parameters: episode.simulatorParameters,
        days: continuity.resolvedDays.map(({ input: day }) => day),
        options: { ecfPolicy: episode.ecfPolicy },
        personalization: {
          personalOffsetKcalPerDay: episode.personalOffsetKcalPerDay,
          activityCalibration: episode.activityCalibration,
        },
      });
      const anchor = replay.at(-1);
      if (!anchor || anchor.status !== "complete") {
        throw new ModelRecoveryEvidenceError("The deterministic recovery anchor could not be reconstructed.");
      }
      recoveryInitialState = anchor.endState;
    }

    let result;
    try {
      result = recoverHistoricalTrajectories({
        seed: input.seed,
        initialState: recoveryInitialState,
        parameters: episode.simulatorParameters,
        personalization: {
          personalOffsetKcalPerDay: episode.personalOffsetKcalPerDay,
          activityCalibration: episode.activityCalibration,
        },
        ecfPolicy: episode.ecfPolicy,
        days: days.slice(firstUnknownIndex),
        donorDays,
        config,
      });
    } catch (error) {
      throw new ModelRecoveryEvidenceError(
        error instanceof Error ? error.message : "Historical recovery failed.",
      );
    }
    const sourceFingerprint = recoverySourceFingerprint({ episode, days, donorDays });
    const persisted = await recovery.persist({
      episodeId: episode.id,
      firstUnknownDate,
      latestRecoveredDate: latestCompletedDate,
      config,
      configFingerprint: recoveryConfigFingerprint(config),
      sourceFingerprint,
      result,
    });
    return {
      status: "ok" as const,
      recoveryRequired: true,
      deterministicModelVersion: episode.modelVersion,
      recovery: persisted,
    };
  }, RECOVERY_TRANSACTION_OPTIONS);
}

export async function getModelRecoveryStatus(
  episodeId?: number,
  client: PrismaClient = prisma,
  now = new Date(),
) {
  const episodes = new ModelEpisodeRepository(client);
  const recoveryRepository = new ModelRecoveryRepository(client);
  const episode = episodeId === undefined ? await episodes.getActive() : await episodes.getById(episodeId);
  if (!episode) {
    if (episodeId === undefined) throw new NoActiveModelEpisodeError();
    throw new ModelEpisodeNotFoundError();
  }
  let recovery = await recoveryRepository.latestStatus(episode.id);
  if (recovery && !recovery.stale) {
    const latestCompletedDate = latestCompletedLocalDate(now, episode.timezone);
    const config = resolvedRecoveryConfig(recovery.config as Partial<ReturnType<typeof resolvedRecoveryConfig>>);
    const sources = await episodes.loadSources(episode.startDate, latestCompletedDate);
    const days = buildSimulationDays({
      from: episode.startDate,
      to: latestCompletedDate,
      sources,
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
    });
    const firstUnknownDate = analyzeStateContinuity(days, episode.ecfPolicy)
      .unknownIntervals[0]?.startDate;
    if (!firstUnknownDate) {
      await recoveryRepository.markAllStale(episode.id);
      recovery = await recoveryRepository.latestStatus(episode.id);
    } else {
      const donorFrom = addCalendarDays(firstUnknownDate, -config.donorLookbackDays);
      const donorTo = addCalendarDays(firstUnknownDate, -1);
      const donorSources = await episodes.loadSources(donorFrom, donorTo);
      const donorDays = buildSimulationDays({
        from: donorFrom,
        to: donorTo,
        sources: donorSources,
        baselineNutritionFallback: episode.baselineNutritionFallback,
        nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
      });
      if (recoverySourceFingerprint({ episode, days, donorDays }) !== recovery.sourceFingerprint) {
        await recoveryRepository.markAllStale(episode.id);
        recovery = await recoveryRepository.latestStatus(episode.id);
      }
    }
  }
  return {
    episodeId: episode.id,
    deterministicModelVersion: episode.modelVersion,
    recovery,
  };
}
