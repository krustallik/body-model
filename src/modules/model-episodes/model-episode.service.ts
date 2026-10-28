import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { errorDiagnosticFields, logEvent } from "@/lib/logger";
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
import { rebuildRelativeMuscleEpisodeTrajectories } from "./relative-muscle-shadow-core.service";
import { PhysiologyV7PersistenceRepository, readUnifiedSourceFenceV1, assertUnifiedSourceFenceV1, type ActiveEnergyConvergenceOwnerToken } from "./physiology-v7-persistence.repository";
import {
  assertTrainingRefreshWorkerLeaseInTransaction,
} from "@/modules/training/training-refresh-worker-context";
import {
  invalidateActiveEnergyResolutionDatesV1,
  materializeActiveEnergyCandidatesV1,
  refreshCandidatesAfterProductionV1,
  type ActiveEnergyCandidateScopeV1,
  type ActiveEnergyModelChangedDayV1,
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
    profileId: number;
    startDate?: string;
    timezone?: string;
    now?: Date;
  },
  client: PrismaClient = prisma,
) {
  const timezone = input.timezone ?? DEFAULT_TIME_ZONE;
  const now = input.now ?? new Date();
  const latestCompletedDate = latestCompletedLocalDate(now, timezone);
  const startDate = input.startDate ?? latestCompletedDate;
  if (startDate > latestCompletedDate) {
    throw new EpisodeInitializationError("start-date-not-complete");
  }

  const episode = await client.$transaction(async (transaction) => {
    const repository = new ModelEpisodeRepository(input.profileId, transaction);
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
    await new PhysiologyV7PersistenceRepository(transaction).lockProfile(prepared.profileId);
    await new PhysiologyV7PersistenceRepository(transaction).invalidateUnifiedPublication(prepared.profileId);
    await repository.deactivateActive(now);
    return repository.createPrepared(prepared);
  }, TRANSACTION_OPTIONS);
  if (client === prisma) {
    await rebuildRelativeMuscleEpisodeTrajectories({
      profileId: episode.profileId,
      fromDate: episode.startDate,
    }).catch(() => {});
  }
  return episode;
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
    activeEnergyModelChangedDays: [] as ActiveEnergyModelChangedDayV1[],
    strengthHorizonChangedEpisodeId: null as number | null,
    sourceReplayChanged: false,
    current,
  };
}

/** Deterministic rebuild; private candidates publish only under the latest source fence. */
async function recalculateModelEpisodeProduction(
  input: {
    profileId: number;
    episodeId?: number;
    now?: Date;
    requireDependentStages?: boolean;
    onCandidateProcessed?: () => void | Promise<void>;
    convergenceOwner?: ActiveEnergyConvergenceOwnerToken;
  },
  client: PrismaClient = prisma,
) {
  let shadowInput: {
    profileId: number; fromDate: string; toDate: string; timeZone: string;
    productionEpisodeId: number; productionModelVersion: string; relativeMuscleFromDate: string;
    onCandidateProcessed?: () => void | Promise<void>;
  } | null = null;
  // Lifecycle bootstrap/version upgrade may write the lifecycle row. Keep
  // that short operation under the shared profile fence in its own committed
  // transaction, so the long candidate transaction never holds a lifecycle
  // row lock while later waiting for that same profile fence.
  await client.$transaction(async (transaction) => {
    const repository = new ModelEpisodeRepository(input.profileId, transaction);
    const episode = input.episodeId === undefined
      ? await repository.getActive()
      : await repository.getById(input.episodeId);
    if (!episode) {
      if (input.episodeId === undefined) throw new NoActiveModelEpisodeError();
      throw new ModelEpisodeNotFoundError();
    }
    const lifecycle = new PhysiologyV7PersistenceRepository(transaction);
    await lifecycle.lockProfile(episode.profileId);
    await lifecycle.ensureLifecycle(episode.profileId, episode.startDate);
  }, {
    isolationLevel: input.convergenceOwner
      ? Prisma.TransactionIsolationLevel.ReadCommitted
      : Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 10_000,
  });
  const production = await client.$transaction(async (transaction) => {
    const repository = new ModelEpisodeRepository(input.profileId, transaction);
    let episode = input.episodeId === undefined
      ? await repository.getActive()
      : await repository.getById(input.episodeId);
    if (!episode) {
      if (input.episodeId === undefined) throw new NoActiveModelEpisodeError();
      throw new ModelEpisodeNotFoundError();
    }
    const lifecycle = new PhysiologyV7PersistenceRepository(transaction);
    // Owned replay uses the existing source-generation/timestamp CAS instead
    // of a long SERIALIZABLE snapshot of the heartbeat-mutated queue row.
    // Capture before every consumed episode/source read; raw writers change
    // this fence atomically with their source mutation. A final check under
    // the profile + exact job-row locks rolls back all private candidates if
    // anything changed. Unowned episode switching remains SERIALIZABLE.
    const sourceFence = input.convergenceOwner
      ? await readUnifiedSourceFenceV1(transaction, episode.profileId)
      : null;
    if (input.convergenceOwner) {
      if (sourceFence === null || input.episodeId === undefined) {
        throw new Error("Owned production replay requires an existing episode and source fence");
      }
      episode = await repository.getById(input.episodeId);
      if (!episode) throw new ModelEpisodeNotFoundError();
    }
    // Candidate production rows are transaction-private until commit. Keep the
    // same rows-before-profile-lock ordering for worker and non-worker rebuilds
    // so a concurrent rebuild cannot hold the profile fence while waiting for
    // these rows as the Training worker waits in the reverse direction.
    await assertTrainingRefreshWorkerLeaseInTransaction(transaction, episode.profileId);
    const publicationState = await transaction.physiologyV7Lifecycle.findUnique({
      where: { profileId: episode.profileId },
      select: { invalidationGeneration: true, productionStaleFromDate: true },
    });
    if (!publicationState) throw new Error(`physiology lifecycle missing for profile ${episode.profileId}`);
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
    let deferCandidateSwitchForNonCurrentIncumbent = false;
    let activeEpisodeSwitched = false;
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
          getModelDiagnostics(input.profileId, transaction),
          repository.status(episode.id),
        ]);
        if (!currentStatus) throw new NoActiveModelEpisodeError();

        // A non-current incumbent has no trustworthy comparison baseline.
        // The only exception is first publication with no persisted model
        // rows, where the candidate is the initial build rather than a
        // replacement of historical output.
        const canBootstrapUnpublishedEpisode = !currentStatus.productionCurrent
          && currentStatus.productionDirtyFromDate === null
          && await transaction.dailyModelState.count({ where: { episodeId: episode.id } }) === 0;
        if (!currentStatus.productionCurrent && !canBootstrapUnpublishedEpisode) {
          // The persisted incumbent cannot be compared or replaced from
          // current evidence. Rebuild it first, then reconsider a candidate
          // against a current baseline on the next request.
          candidateCalculation = null;
          deferCandidateSwitchForNonCurrentIncumbent = true;
        } else {
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
          await repository.deactivateActive(input.now ?? new Date());
          episode = await repository.createPrepared(prepared);
          activeEpisodeSwitched = true;
        }
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
    if (deferCandidateSwitchForNonCurrentIncumbent && calculation.dailyStates.length === 0) {
      // A zero-row replay cannot make persisted stale rows current. Preserve
      // them and keep publication non-current rather than deleting the rows
      // or publishing an empty replacement as successful current evidence.
      const currentStatus = await repository.status(episode.id);
      if (!currentStatus) throw new NoActiveModelEpisodeError();
      return unchangedActiveEpisodeResult(episode, currentStatus);
    }
    const energyReplayFromDate = calculation.replayMode === "suffix"
      ? resume?.fromDate ?? episode.startDate
      : episode.startDate;
    const priorEnergyRows = await transaction.dailyModelState.findMany({
      where: { episodeId: episode.id, date: { gte: energyReplayFromDate } },
      select: { date: true, status: true, modelVersion: true, dynamicRmrKcalPerDay: true, endWeightKg: true, filteredWeightKg: true },
    });
    const priorEnergyByDate = new Map(priorEnergyRows.map((row) => [row.date, row]));
    await repository.persistCalculation(
      episode.id,
      calculation,
      episode.modelVersion,
      calculation.replayMode === "suffix" ? resume?.fromDate : undefined,
    );
    // Compare the rows that candidate writers will actually read after commit,
    // avoiding false dependencies from pre-persistence floating-point noise.
    const persistedEnergyRows = await transaction.dailyModelState.findMany({
      where: { episodeId: episode.id, date: { gte: energyReplayFromDate } },
      select: { date: true, status: true, modelVersion: true, dynamicRmrKcalPerDay: true, endWeightKg: true, filteredWeightKg: true },
    });
    const persistedEnergyByDate = new Map(persistedEnergyRows.map((row) => [row.date, row]));
    const activeEnergyModelChangedDays: ActiveEnergyModelChangedDayV1[] = [
      ...persistedEnergyRows.flatMap((row) => {
        const prior = priorEnergyByDate.get(row.date);
        const statusOrVersionChanged = !prior || prior.status !== row.status || prior.modelVersion !== row.modelVersion;
        const strengthRmrChanged = statusOrVersionChanged
          || prior?.dynamicRmrKcalPerDay !== row.dynamicRmrKcalPerDay;
        const modelMassChanged = statusOrVersionChanged
          || (prior?.filteredWeightKg ?? prior?.endWeightKg ?? null)
            !== (row.filteredWeightKg ?? row.endWeightKg ?? null);
        return strengthRmrChanged || modelMassChanged
          ? [{ episodeId: episode.id, date: row.date, strengthRmrChanged, modelMassChanged }]
          : [];
      }),
      ...priorEnergyRows.filter(({ date }) => !persistedEnergyByDate.has(date))
        .map(({ date }) => ({ episodeId: episode.id, date, strengthRmrChanged: true, modelMassChanged: true })),
    ];
    // Recalculation follows all source mutations; stale conservatively until an
    // identical source/config/seed recovery resets the fingerprinted upsert.
    await repository.markRecoveryRunsStale(episode.id);
    // Candidate writes above are transaction-private. Taking the shared
    // profile/job fence after them means Training CRUD is blocked only for the
    // final generation CAS and commit, never for the historical calculation.
    await lifecycle.lockProfile(episode.profileId);
    await assertTrainingRefreshWorkerLeaseInTransaction(transaction, episode.profileId);
    if (input.convergenceOwner) {
      await assertUnifiedSourceFenceV1(transaction, episode.profileId, sourceFence);
    }
    if (activeEpisodeSwitched) await lifecycle.invalidateUnifiedPublication(episode.profileId);
    await lifecycle.publishProduction({
      profileId: episode.profileId,
      expectedGeneration,
      ...(input.convergenceOwner === undefined ? {} : { convergenceOwner: input.convergenceOwner }),
    });
    shadowInput = {
      profileId: episode.profileId,
      fromDate: episode.startDate,
      toDate: latestCompletedDate,
      timeZone: episode.timezone,
      productionEpisodeId: episode.id,
      productionModelVersion: episode.modelVersion,
      relativeMuscleFromDate: calculation.replayMode === "suffix"
        ? resume?.fromDate ?? episode.startDate
        : episode.startDate,
      onCandidateProcessed: input.onCandidateProcessed,
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
      activeEnergyModelChangedDays,
      strengthHorizonChangedEpisodeId: episode.latestModeledDate !== calculation.latestModeledDate
        ? episode.id
        : null,
      sourceReplayChanged: dirtyFromDate !== null,
      current: null,
    };
  }, {
    ...TRANSACTION_OPTIONS,
    isolationLevel: input.convergenceOwner
      ? Prisma.TransactionIsolationLevel.ReadCommitted
      : TRANSACTION_OPTIONS.isolationLevel,
  });
  const current = production.current ?? await new ModelEpisodeRepository(input.profileId, client).status(production.episodeId);
  const productionResult = { ...production, current };
  // Post-commit shadow rebuild: preserve the legacy result on failure, but do
  // not publish a response while dependency-relevant rebuilds are still
  // running in the background.
  const committedShadowInput = shadowInput as {
    profileId: number; fromDate: string; toDate: string; timeZone: string;
    productionEpisodeId: number; productionModelVersion: string; relativeMuscleFromDate: string;
    onCandidateProcessed?: () => void | Promise<void>;
  } | null;
  if (client === prisma && committedShadowInput !== null && committedShadowInput.fromDate <= committedShadowInput.toDate) {
    const required = input.requireDependentStages === true;
    const rebuildRequiredStages = async () => {
      await physiologyV7ShadowService.run({
        ...committedShadowInput,
        throwAfterDiagnostic: required,
        onProgress: committedShadowInput.onCandidateProcessed,
      });
      await rebuildFatWeightShadowV1({
        ...committedShadowInput,
        onProgress: committedShadowInput.onCandidateProcessed,
      });
      await rebuildExperimentalFatWeightUncertaintyV1({
        ...committedShadowInput,
        onProgress: committedShadowInput.onCandidateProcessed,
      });
      await rebuildRelativeMuscleEpisodeTrajectories({
        profileId: committedShadowInput.profileId,
        fromDate: committedShadowInput.relativeMuscleFromDate,
        onCandidateProcessed: committedShadowInput.onCandidateProcessed,
      });
    };
    if (required) await rebuildRequiredStages();
    else await rebuildRequiredStages().catch(() => {});
  }
  return productionResult;
}

/**
 * Rebuild production history after deterministic Active Energy materialization.
 * Active Energy candidates whose resolution depends on replayed production
 * state are refreshed and replayed until canonical resolutions stabilize.
 */
export async function recalculateModelEpisode(
  input: {
    profileId: number;
    episodeId?: number;
    now?: Date;
    requireDependentStages?: boolean;
    activeEnergyCandidateScope?: ActiveEnergyCandidateScopeV1;
    onLifecycleFenceChanged?: (fence: { invalidationGeneration: number; updatedAt: string }) => void | Promise<void>;
    onCandidateProcessed?: () => void | Promise<void>;
    /** Deterministic integration seam after a committed production pass. */
    afterProductionPassBeforeCandidateRefresh?: () => void | Promise<void>;
  },
  client: PrismaClient = prisma,
) {
  const publishLifecycleFence = async () => {
    if (input.onLifecycleFenceChanged === undefined) return null;
    const fence = await new PhysiologyV7PersistenceRepository(client).readUnifiedPublicationFence(input.profileId);
    if (fence !== null) await input.onLifecycleFenceChanged(fence);
    return fence;
  };
  if (client !== prisma) {
    const production = await recalculateModelEpisodeProduction(input, client);
    await publishLifecycleFence();
    return production;
  }
  const status = await getModelStatus(input.profileId, input.episodeId, client);
  const profileId = input.profileId;
  const lifecycleRepository = new PhysiologyV7PersistenceRepository(client);
  const convergenceBlock = await lifecycleRepository.beginActiveEnergyConvergence({
    profileId,
    fromDate: status.episodeStartDate,
  });
  let renewal: Promise<void> | null = null;
  let renewalFailure: unknown;
  const heartbeat = setInterval(() => {
    if (renewal !== null) return;
    renewal = lifecycleRepository.renewActiveEnergyConvergence({ profileId, owner: convergenceBlock })
      .catch((error: unknown) => { renewalFailure = error; })
      .finally(() => { renewal = null; });
  }, 20_000);
  heartbeat.unref();
  try {
    await publishLifecycleFence();
    const materialized = await materializeActiveEnergyCandidatesV1(profileId, {
      ...(input.activeEnergyCandidateScope === undefined ? {} : { candidateScope: input.activeEnergyCandidateScope }),
      activeEnergyConvergenceOwner: convergenceBlock,
      onLifecycleFenceChanged: input.onLifecycleFenceChanged,
      onCandidateProcessed: async () => {
        await lifecycleRepository.renewActiveEnergyConvergence({ profileId, owner: convergenceBlock });
        await input.onCandidateProcessed?.();
      },
    });
    await invalidateActiveEnergyResolutionDatesV1(profileId, materialized.changedDates, convergenceBlock);
    await publishLifecycleFence();
    const maxRefreshPasses = Math.max(2, materialized.convergenceCandidateCount + 2);
    const effectiveReplayFromDates: string[] = [];
    for (let pass = 0; pass < maxRefreshPasses; pass += 1) {
      if (renewalFailure !== undefined) throw renewalFailure;
      await lifecycleRepository.renewActiveEnergyConvergence({ profileId, owner: convergenceBlock });
      const production = await recalculateModelEpisodeProduction({
        ...input,
        episodeId: status.episodeId,
        convergenceOwner: convergenceBlock,
      }, client);
      effectiveReplayFromDates.push(production.effectiveReplayFromDate);
      // The production transaction may commit a new lifecycle timestamp before
      // candidate refresh completes. Keep the recovery CAS tied to this exact
      // committed fence if a later refresh step fails.
      await publishLifecycleFence();
      await input.afterProductionPassBeforeCandidateRefresh?.();
      await lifecycleRepository.renewActiveEnergyConvergence({ profileId, owner: convergenceBlock });
      const changedDates = await refreshCandidatesAfterProductionV1(profileId, production.effectiveReplayFromDate, {
        activeEnergyConvergenceOwner: convergenceBlock,
        modelChangedDays: production.activeEnergyModelChangedDays,
        ...(production.strengthHorizonChangedEpisodeId === null
          ? {} : { strengthHorizonChangedEpisodeId: production.strengthHorizonChangedEpisodeId }),
        sourceReplayChanged: production.sourceReplayChanged,
        onLifecycleFenceChanged: input.onLifecycleFenceChanged,
        onCandidateProcessed: async () => {
          await lifecycleRepository.renewActiveEnergyConvergence({ profileId, owner: convergenceBlock });
          await input.onCandidateProcessed?.();
        },
      });
      if (changedDates.length === 0) {
        if (renewalFailure !== undefined) throw renewalFailure;
        const lifecycle = await client.physiologyV7Lifecycle.findUnique({
          where: { profileId },
          select: { invalidationGeneration: true },
        });
        if (!lifecycle || !await lifecycleRepository.finishActiveEnergyConvergence({
          profileId,
          expectedGeneration: lifecycle.invalidationGeneration,
          expectedRevision: convergenceBlock.revision,
          expectedFromDate: convergenceBlock.fromDate,
          expectedOwnerToken: convergenceBlock.ownerToken,
        })) {
          throw new Error("Active Energy convergence lost its source or publication fence");
        }
        await publishLifecycleFence();
        return {
          ...production,
          effectiveReplayFromDate: [...effectiveReplayFromDates].sort()[0] ?? production.effectiveReplayFromDate,
        };
      }
      await invalidateActiveEnergyResolutionDatesV1(profileId, changedDates, convergenceBlock);
      await publishLifecycleFence();
    }
    throw new Error("Active Energy candidates did not converge after production replay");
  } finally {
    clearInterval(heartbeat);
    await renewal;
    await lifecycleRepository.expireActiveEnergyConvergence(profileId, convergenceBlock)
      .catch((error: unknown) => logEvent("warn", "active_energy_owner_withdrawal_failed", errorDiagnosticFields(error)));
  }
}

export async function getModelStatus(
  profileId: number,
  episodeId?: number,
  client: PrismaClient = prisma,
) {
  const result = await new ModelEpisodeRepository(profileId, client).status(episodeId);
  if (!result) {
    if (episodeId === undefined) throw new NoActiveModelEpisodeError();
    throw new ModelEpisodeNotFoundError();
  }
  return result;
}

export async function getModelHistory(
  query: ModelHistoryQuery & { profileId: number },
  client: PrismaClient = prisma,
) {
  const result = await new ModelEpisodeRepository(query.profileId, client).history(query);
  if (!result) {
    if (query.episodeId === undefined) throw new NoActiveModelEpisodeError();
    throw new ModelEpisodeNotFoundError();
  }
  return { ...result, limit: query.limit, offset: query.offset };
}
