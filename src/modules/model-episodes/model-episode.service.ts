import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { missingPhysiologicalTransitionFields } from "@/model/physiological-simulator";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { calculateEpisodeHistory, type EpisodeCalculation } from "./episode-calculation";
import { prepareBootstrapEpisodeInitialization, prepareEpisodeInitialization } from "./episode-initialization";
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
import { getModelDiagnostics } from "@/modules/model-diagnostics/model-diagnostics.service";
import {
  episodeReadinessFromCalculation,
  episodeReadinessFromDiagnostics,
  shouldSwitchModelEpisode,
} from "./episode-switch-policy";
import { addCalendarDays, latestCompletedLocalDate } from "./model-calendar";
import { CURRENT_MODEL_VERSION } from "./model-version";
import { buildSimulationDays } from "./simulation-input-builder";
import { physiologyV7ShadowService } from "./physiology-v7-shadow.service";
import { rebuildFatWeightShadowV1 } from "./fat-weight-shadow-v1.service";
import { rebuildExperimentalFatWeightUncertaintyV1 } from "./experimental-fat-weight-uncertainty-shadow.service";
import { PhysiologyV7PersistenceRepository } from "./physiology-v7-persistence.repository";
import {
  invalidateActiveEnergyResolutionDatesV1,
  materializeActiveEnergyCandidatesV1,
  refreshCandidatesAfterProductionV1,
} from "@/modules/activity/active-energy-materialization";

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
      repository.loadSources(addCalendarDays(startDate, -125), startDate, timezone),
    ]);
    let prepared: PreparedEpisodeInitialization;
    try {
      prepared = prepareEpisodeInitialization({
        profile,
        days: sources.days,
        sources,
        startDate,
        timezone,
      });
    } catch (error) {
      if (!(error instanceof EpisodeInitializationError)
          || (error.reason !== "insufficient-baseline-data" && error.reason !== "insufficient-weight-bia")) {
        throw error;
      }
      // Keep the start action useful with short histories. This is an
      // explicit, auditable bootstrap episode: raw rows remain untouched,
      // fallback nutrition/body-fat assumptions live in episode provenance,
      // and initializationStatus stays `insufficient` until history grows.
      prepared = prepareBootstrapEpisodeInitialization({
        profile,
        days: sources.days,
        sources,
        startDate,
        timezone,
      });
    }
    await new PhysiologyV7PersistenceRepository(transaction).invalidateUnifiedPublication(prepared.profileId);
    await repository.deactivateActive(now);
    return repository.createPrepared(prepared);
  }, TRANSACTION_OPTIONS);
}

function unchangedActiveEpisodeResult(
  episode: PersistedEpisode,
  current: NonNullable<Awaited<ReturnType<ModelEpisodeRepository["status"]>>>,
) {
  return {
    status: "ok" as const,
    episodeId: episode.id,
    modelVersion: episode.modelVersion,
    calibrationStatus: episode.calibrationStatus,
    personalOffsetKcalPerDay: episode.personalOffsetKcalPerDay,
    activityCalibration: episode.activityCalibration,
    daysPersisted: current.daysModeled + current.incompleteDays,
    completeDays: current.daysModeled,
    incompleteDays: current.incompleteDays,
    observedNutritionDays: current.observedNutritionDays,
    imputedNutritionDays: current.imputedNutritionDays,
    unbridgeableNutritionDays: current.unbridgeableNutritionDays,
    latestModeledDate: current.latestModeledDate,
    resolvedUntil: current.latestModeledDate,
    continuityStatus: current.continuityStatus,
    recoveryRequired: current.recoveryRequired,
    unknownIntervals: current.unknownIntervals,
    // An unchanged active episode has no replay; use its persisted start as
    // the conservative boundary for post-replay candidate dependencies.
    effectiveReplayFromDate: episode.startDate,
    current,
  };
}

/** Full deterministic rebuild; reads, calculation, and replacement share one DB snapshot. */
async function recalculateModelEpisodeProduction(
  input: { episodeId?: number; now?: Date } = {},
  client: PrismaClient = prisma,
) {
  let shadowInput: { profileId: number; fromDate: string; toDate: string; timeZone: string; productionEpisodeId: number; productionModelVersion: string } | null = null;
  const production = await client.$transaction(async (transaction) => {
    const repository = new ModelEpisodeRepository(transaction);
    let episode = input.episodeId === undefined
      ? await repository.getActive()
      : await repository.getById(input.episodeId);
    if (!episode) {
      if (input.episodeId === undefined) throw new NoActiveModelEpisodeError();
      throw new ModelEpisodeNotFoundError();
    }
    const lifecycle = new PhysiologyV7PersistenceRepository(transaction);
    await lifecycle.lockProfile(episode.profileId);
    const publicationState = await lifecycle.ensureLifecycle(episode.profileId, episode.startDate);
    const expectedGeneration = publicationState.invalidationGeneration;
    const latestCompletedDate = latestCompletedLocalDate(
      input.now ?? new Date(),
      episode.timezone,
    );
    const historyStart = input.episodeId === undefined
      ? addCalendarDays(latestCompletedDate, -125)
      : episode.startDate;
    const sourceStart = historyStart < episode.startDate ? historyStart : episode.startDate;
    const sources = sourceStart <= latestCompletedDate
      ? await repository.loadSources(sourceStart, latestCompletedDate, episode.timezone)
      : { days: [], snapshots: [], workIntervals: [], workouts: [] };

    let candidateCalculation: EpisodeCalculation | null = null;
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
        timeZone: episode.timezone,
      });
      const restartDate = preferredModelableRunStart(
        candidateDays,
        episode.ecfPolicy,
        sources,
      );
      if (restartDate !== null
          && (restartDate !== episode.startDate || episode.modelVersion !== CURRENT_MODEL_VERSION)) {
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

        // Calculate the proposed episode without creating a row or touching
        // the active episode. Its current-state availability and 28-day
        // coverage use the same Diagnostics rules as the active episode.
        const candidateBuiltDays = buildSimulationDays({
          from: prepared.startDate,
          to: latestCompletedDate,
          sources,
          baselineNutritionFallback: prepared.baseline.fallbackNutrition,
          nutritionGapPolicy: { maxBridgeDays: prepared.nutritionMaxBridgeDays },
          modelVersion: prepared.modelVersion,
          timeZone: prepared.timezone,
        });
        candidateCalculation = calculateEpisodeHistory({
          episode: {
            ecfPolicy: prepared.ecfPolicy,
            initialState: prepared.initialState,
            simulatorParameters: prepared.simulatorParameters,
            personalOffsetKcalPerDay: prepared.appliedPersonalOffsetKcalPerDay ?? 0,
            initialPersonalOffsetKcalPerDay: prepared.initialPersonalOffsetKcalPerDay ?? 0,
            modelVersion: prepared.modelVersion,
          },
          days: candidateBuiltDays,
        });
        const [currentDiagnostics, currentStatus] = await Promise.all([
          getModelDiagnostics(transaction),
          repository.status(episode.id),
        ]);
        if (!currentStatus) throw new NoActiveModelEpisodeError();

        const currentReadiness = episodeReadinessFromDiagnostics(currentDiagnostics);
        const candidateReadiness = episodeReadinessFromCalculation({
          calculation: candidateCalculation,
          startDate: prepared.startDate,
        });
        if (!shouldSwitchModelEpisode(currentReadiness, candidateReadiness)) {
          // Rejection is read-only: do not stale recoveries, persist states,
          // rewrite the active episode, or consume an episode ID.
          return unchangedActiveEpisodeResult(episode, currentStatus);
        }

        // Both changes and the candidate calculation are committed atomically.
        // PostgreSQL SERIALIZABLE plus the one-active partial unique index make
        // concurrent switches fail closed rather than publish two active rows.
        await lifecycle.invalidateUnifiedPublication(episode.profileId);
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
        timeZone: episode.timezone,
      });
    let resume: Parameters<typeof calculateEpisodeHistory>[0]["resume"];
    const dirtyFromDate = publicationState.productionStaleFromDate;
    if (dirtyFromDate !== null && dirtyFromDate > episode.startDate && dirtyFromDate <= latestCompletedDate) {
      const predecessorDate = addCalendarDays(dirtyFromDate, -1);
      const predecessor = await transaction.dailyModelState.findUnique({
        where: { episodeId_date: { episodeId: episode.id, date: predecessorDate } },
        select: {
          id: true, date: true, status: true, modelVersion: true,
          fatMassKg: true, leanTissueKg: true, glycogenKg: true,
          extracellularFluidDeviationLiters: true,
          adaptiveThermogenesisKcalPerDay: true,
          filteredWeightKg: true, weightFilterVarianceKg2: true,
        },
      });
      const priorCalibrationFingerprint = episode.calibrationDiagnostics
        && typeof episode.calibrationDiagnostics === "object"
        && !Array.isArray(episode.calibrationDiagnostics)
        && typeof (episode.calibrationDiagnostics as { calibrationInputFingerprint?: unknown }).calibrationInputFingerprint === "string"
        ? (episode.calibrationDiagnostics as { calibrationInputFingerprint: string }).calibrationInputFingerprint
        : null;
      if (predecessor !== null && predecessor.status === "complete"
          && predecessor.modelVersion === episode.modelVersion
          && predecessor.date === predecessorDate
          && predecessor.fatMassKg !== null && predecessor.leanTissueKg !== null
          && predecessor.glycogenKg !== null && predecessor.extracellularFluidDeviationLiters !== null
          && predecessor.adaptiveThermogenesisKcalPerDay !== null
          && predecessor.filteredWeightKg !== null && predecessor.weightFilterVarianceKg2 !== null
          && [predecessor.fatMassKg, predecessor.leanTissueKg, predecessor.glycogenKg,
            predecessor.extracellularFluidDeviationLiters, predecessor.adaptiveThermogenesisKcalPerDay,
            predecessor.filteredWeightKg, predecessor.weightFilterVarianceKg2].every(Number.isFinite)) {
        resume = {
          fromDate: dirtyFromDate,
          predecessorDate,
          predecessorState: {
            fatMassKg: predecessor.fatMassKg,
            leanTissueKg: predecessor.leanTissueKg,
            glycogenKg: predecessor.glycogenKg,
            baselineExtracellularFluidLiters: episode.initialState.baselineExtracellularFluidLiters,
            extracellularFluidDeviationLiters: predecessor.extracellularFluidDeviationLiters,
            adaptiveThermogenesisKcalPerDay: predecessor.adaptiveThermogenesisKcalPerDay,
            weightFilterState: {
              estimatedWeightKg: predecessor.filteredWeightKg,
              varianceKg2: predecessor.weightFilterVarianceKg2,
            },
          },
          persistedCalibrationInputFingerprint: priorCalibrationFingerprint,
        };
      }
    }
    // Scientific initialization semantics are frozen per episode. Legacy v4
    // episodes must be explicitly reinitialized rather than silently relabeled v5.
    const calculation = candidateCalculation ?? calculateEpisodeHistory({ episode, days: builtDays, resume });
    await repository.persistCalculation(
      episode.id,
      calculation,
      episode.modelVersion,
      calculation.replayMode === "suffix" ? resume?.fromDate : undefined,
    );
    await lifecycle.publishProduction({ profileId: episode.profileId, expectedGeneration });
    // Recalculation follows all source mutations; stale conservatively until an
    // identical source/config/seed recovery resets the fingerprinted upsert.
    await repository.markRecoveryRunsStale(episode.id);
    const status = await repository.status(episode.id);
    shadowInput = {
      profileId: episode.profileId,
      fromDate: episode.startDate,
      toDate: latestCompletedDate,
      timeZone: episode.timezone,
      productionEpisodeId: episode.id,
      productionModelVersion: episode.modelVersion,
    };
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
      // Candidate refresh dependency must use the effective replay boundary.
      // An invalid D-1 predecessor forces a full replay from episode.startDate,
      // which can create the mass consumed by a Stepper workout on D.
      effectiveReplayFromDate: calculation.replayMode === "suffix"
        ? resume?.fromDate ?? episode.startDate
        : episode.startDate,
      current: status,
    };
  }, TRANSACTION_OPTIONS);
  // Post-commit shadow rebuild: preserve the legacy result on failure, but do
  // not publish a response while dependency-relevant rebuilds are still
  // running in the background.
  const committedShadowInput = shadowInput as { profileId: number; fromDate: string; toDate: string; timeZone: string; productionEpisodeId: number; productionModelVersion: string } | null;
  if (client === prisma && committedShadowInput !== null && committedShadowInput.fromDate <= committedShadowInput.toDate) {
    await physiologyV7ShadowService.run(committedShadowInput).catch(() => {});
    await rebuildFatWeightShadowV1(committedShadowInput).catch(() => {});
    await rebuildExperimentalFatWeightUncertaintyV1(committedShadowInput).catch(() => {});
  }
  return production;
}

/**
 * Rebuild production history after deterministic Active Energy materialization.
 * Stepper estimates that need newly current D-1 mass are refreshed and replayed
 * until their canonical resolutions remain stable across a production pass.
 */
export async function recalculateModelEpisode(
  input: { episodeId?: number; now?: Date } = {},
  client: PrismaClient = prisma,
) {
  if (client !== prisma) {
    const production = await recalculateModelEpisodeProduction(input, client);
    const { effectiveReplayFromDate: _effectiveReplayFromDate, ...result } = production;
    void _effectiveReplayFromDate;
    return result;
  }
  const status = await getModelStatus(input.episodeId, client);
  const profileId = 1;
  const materialized = await materializeActiveEnergyCandidatesV1(profileId);
  await invalidateActiveEnergyResolutionDatesV1(profileId, materialized.changedDates);
  const eligibleRefreshes = materialized.stepperWorkoutIds.length
    + materialized.strengthSessionIds.length + materialized.strengthWorkoutIds.length;
  const maxRefreshPasses = Math.max(2, eligibleRefreshes + 2);
  for (let pass = 0; pass < maxRefreshPasses; pass += 1) {
    const production = await recalculateModelEpisodeProduction({ ...input, episodeId: status.episodeId }, client);
    const changedDates = await refreshCandidatesAfterProductionV1(profileId, production.effectiveReplayFromDate);
    if (changedDates.length === 0) {
      const { effectiveReplayFromDate: _effectiveReplayFromDate, ...result } = production;
      void _effectiveReplayFromDate;
      return result;
    }
    await invalidateActiveEnergyResolutionDatesV1(profileId, changedDates);
  }
  throw new Error("Stepper historical mass candidates did not converge after production replay");
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
