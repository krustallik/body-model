import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { calculateEpisodeHistory } from "./episode-calculation";
import type { HistoricalModelSources, PersistedEpisode } from "./model-episode.types";
import { ModelEpisodeRepository } from "./model-episode.repository";
import { buildSimulationDays, eligibleHistoricalDonors } from "./simulation-input-builder";
import { stagedReplayFingerprintV1 } from "./staged-replay-v1";
import {
  activateVisibilityGenerationV1,
  rollbackVisibilityGenerationV1,
} from "./activation-rollback-v1";
import { prismaVisibilityStoreV1 } from "./activation-rollback-store";
import { CURRENT_MODEL_VERSION } from "./model-version";

export const SELECTION_V1_MODEL_VERSION = "bodycast-physiology-v7+selection-v1" as const;

/** Stable fingerprint of durable sources used for selection-v1 reconstruction. */
export function fingerprintHistoricalSourcesV1(sources: HistoricalModelSources): string {
  return stagedReplayFingerprintV1({
    days: sources.days.map((day) => ({
      date: day.date,
      weightKg: day.weightKg,
      walkingDistanceKm: day.walkingDistanceKm,
      workoutFeedObserved: day.workoutFeedObserved,
    })),
    workouts: (sources.workouts ?? []).map((workout) => ({
      id: workout.id,
      startAt: workout.startAt.toISOString(),
      endAt: workout.endAt.toISOString(),
      activeEnergyKcal: workout.activeEnergyKcal,
      manualStepCount: workout.manualStepCount ?? null,
      manualActiveEnergyKcal: workout.manualActiveEnergyKcal ?? null,
      bodyCastEstimateKcal: workout.bodyCastEstimateKcal ?? null,
      bodyCastEstimateFresh: workout.bodyCastEstimateFresh === true,
    })),
    webOnly: (sources.webOnlyStrengthSessions ?? []).map((session) => ({
      sessionId: session.sessionId,
      status: session.status,
      revision: session.revision,
      bodyCastEstimateKcal: session.bodyCastEstimateKcal,
    })),
    reconciliation: (sources.reconciliationLinks ?? []).map((link) => ({
      groupId: link.groupId,
      status: link.status,
      evaluationRevision: link.evaluationRevision,
      manualWorkoutId: link.manualWorkoutId,
      garminWorkoutId: link.garminWorkoutId,
    })),
    intervals: (sources.activityIntervals ?? []).map((row) => ({
      id: row.id,
      metric: row.metric,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      value: row.value,
    })),
  });
}

export type SelectionReconstructionV1 = {
  modelVersion: typeof SELECTION_V1_MODEL_VERSION;
  sourceRevision: string;
  status: "complete" | "stale-source";
  completed: Array<{ date: string; fingerprint: string; donorEligible: boolean }>;
  donorEligibleDates: string[];
};

/**
 * Reconstructs a date range under selection-v1 using real ModelEpisode loaders
 * and calculation. Does not flip the active production episode version.
 */
export async function reconstructSelectionHistoryV1(input: {
  repository: ModelEpisodeRepository;
  episode: PersistedEpisode;
  from: string;
  to: string;
  expectedSourceRevision?: string | null;
  unifiedStartOfDayMassKgByDate?: Readonly<Record<string, number | null>>;
}): Promise<SelectionReconstructionV1> {
  const sources = await input.repository.loadSources(input.from, input.to, input.episode.timezone);
  const sourceRevision = fingerprintHistoricalSourcesV1(sources);
  if (input.expectedSourceRevision != null && input.expectedSourceRevision !== sourceRevision) {
    return {
      modelVersion: SELECTION_V1_MODEL_VERSION,
      sourceRevision,
      status: "stale-source",
      completed: [],
      donorEligibleDates: [],
    };
  }
  const days = buildSimulationDays({
    from: input.from,
    to: input.to,
    sources,
    modelVersion: SELECTION_V1_MODEL_VERSION,
    timeZone: input.episode.timezone,
    unifiedStartOfDayMassKgByDate: input.unifiedStartOfDayMassKgByDate,
    baselineNutritionFallback: input.episode.baselineNutritionFallback,
  });
  const episode: PersistedEpisode = {
    ...input.episode,
    modelVersion: SELECTION_V1_MODEL_VERSION,
    active: false,
  };
  const history = calculateEpisodeHistory({ episode, days });
  const donorEligible = new Set(
    eligibleHistoricalDonors(SELECTION_V1_MODEL_VERSION, days).map((day) => day.input.date),
  );
  return {
    modelVersion: SELECTION_V1_MODEL_VERSION,
    sourceRevision,
    status: "complete",
    completed: history.dailyStates.map((state) => ({
      date: state.date,
      fingerprint: stagedReplayFingerprintV1({
        date: state.date,
        sourceQuality: state.sourceQuality.selectionV1 ?? null,
        energy: state.sourceQuality.workoutEnergyResolution?.energyCoverage ?? null,
      }),
      donorEligible: donorEligible.has(state.date),
    })),
    donorEligibleDates: [...donorEligible].sort(),
  };
}

/**
 * Reconstructs selection-v1 history and persists DailyModelState rows for the
 * episode. Does not activate production readers unless confirmActivation is true.
 * Ordinary sync must never call this with confirmActivation.
 */
export async function persistSelectionEpisodeHistoryV1(input: {
  client: PrismaClient;
  repository: ModelEpisodeRepository;
  episode: PersistedEpisode;
  from: string;
  to: string;
  generationId: string;
  expectedSourceRevision?: string | null;
  unifiedStartOfDayMassKgByDate?: Readonly<Record<string, number | null>>;
  /**
   * When true, journals prior modelVersion and flips the episode to selection-v1.
   * Production activation remains unauthorized unless an operator sets this
   * explicitly against an isolated / approved environment.
   */
  confirmActivation?: boolean;
}): Promise<SelectionReconstructionV1 & {
  persisted: boolean;
  activated: boolean;
  previousModelVersion: string | null;
}> {
  const sources = await input.repository.loadSources(input.from, input.to, input.episode.timezone);
  const sourceRevision = fingerprintHistoricalSourcesV1(sources);
  if (input.expectedSourceRevision != null && input.expectedSourceRevision !== sourceRevision) {
    return {
      modelVersion: SELECTION_V1_MODEL_VERSION,
      sourceRevision,
      status: "stale-source",
      completed: [],
      donorEligibleDates: [],
      persisted: false,
      activated: false,
      previousModelVersion: null,
    };
  }
  const days = buildSimulationDays({
    from: input.from,
    to: input.to,
    sources,
    modelVersion: SELECTION_V1_MODEL_VERSION,
    timeZone: input.episode.timezone,
    unifiedStartOfDayMassKgByDate: input.unifiedStartOfDayMassKgByDate,
    baselineNutritionFallback: input.episode.baselineNutritionFallback,
  });
  const calcEpisode: PersistedEpisode = {
    ...input.episode,
    modelVersion: SELECTION_V1_MODEL_VERSION,
    active: input.episode.active,
  };
  const history = calculateEpisodeHistory({ episode: calcEpisode, days });
  const donorEligible = new Set(
    eligibleHistoricalDonors(SELECTION_V1_MODEL_VERSION, days).map((day) => day.input.date),
  );
  const completed = history.dailyStates.map((state) => ({
    date: state.date,
    fingerprint: stagedReplayFingerprintV1({
      date: state.date,
      sourceQuality: state.sourceQuality.selectionV1 ?? null,
      energy: state.sourceQuality.workoutEnergyResolution?.energyCoverage ?? null,
    }),
    donorEligible: donorEligible.has(state.date),
  }));

  const activate = input.confirmActivation === true;
  const previousModelVersion = input.episode.modelVersion;
  if (activate) {
    await input.client.activationRollbackEntry.createMany({
      data: [
        {
          generationId: input.generationId,
          recordKind: "model-episode",
          recordId: input.episode.id,
          field: "modelVersion",
          previousValue: previousModelVersion,
          newValue: SELECTION_V1_MODEL_VERSION,
          sourceRevision,
        },
        {
          generationId: input.generationId,
          recordKind: "model-episode",
          recordId: input.episode.id,
          field: "donorFingerprints",
          previousValue: [],
          newValue: completed,
          sourceRevision,
        },
      ],
    });
  }

  await input.repository.persistCalculation(
    input.episode.id,
    history,
    activate ? SELECTION_V1_MODEL_VERSION : undefined,
  );

  return {
    modelVersion: SELECTION_V1_MODEL_VERSION,
    sourceRevision,
    status: "complete",
    completed,
    donorEligibleDates: [...donorEligible].sort(),
    persisted: true,
    activated: activate,
    previousModelVersion: activate ? previousModelVersion : null,
  };
}

/**
 * Rolls back a selection-v1 episode activation using the exact journal.
 * Rebuilds daily states under the restored model version.
 */
export async function rollbackSelectionEpisodeActivationV1(input: {
  client: PrismaClient;
  repository: ModelEpisodeRepository;
  episode: PersistedEpisode;
  from: string;
  to: string;
  generationId: string;
  unifiedStartOfDayMassKgByDate?: Readonly<Record<string, number | null>>;
}): Promise<{ restoredModelVersion: string; conflicts: boolean }> {
  const journal = await input.client.activationRollbackEntry.findMany({
    where: {
      generationId: input.generationId,
      recordKind: "model-episode",
      recordId: input.episode.id,
      field: "modelVersion",
    },
    orderBy: { id: "asc" },
  });
  const versionEntry = journal[0];
  if (versionEntry === undefined) {
    return { restoredModelVersion: input.episode.modelVersion, conflicts: true };
  }
  const restoredModelVersion = typeof versionEntry.previousValue === "string"
    ? versionEntry.previousValue
    : CURRENT_MODEL_VERSION;
  if (input.episode.modelVersion !== SELECTION_V1_MODEL_VERSION
    && input.episode.modelVersion !== restoredModelVersion) {
    return { restoredModelVersion: input.episode.modelVersion, conflicts: true };
  }

  const sources = await input.repository.loadSources(input.from, input.to, input.episode.timezone);
  const days = buildSimulationDays({
    from: input.from,
    to: input.to,
    sources,
    modelVersion: restoredModelVersion,
    timeZone: input.episode.timezone,
    unifiedStartOfDayMassKgByDate: input.unifiedStartOfDayMassKgByDate,
    baselineNutritionFallback: input.episode.baselineNutritionFallback,
  });
  const history = calculateEpisodeHistory({
    episode: { ...input.episode, modelVersion: restoredModelVersion },
    days,
  });
  await input.repository.persistCalculation(input.episode.id, history, restoredModelVersion);
  return { restoredModelVersion, conflicts: false };
}

/** Activates confirmed reconciliation visibility with an exact rollback journal.
 * Hides the manual audit duplicate; Garmin remains the canonical visible workout.
 * Does not run on ordinary confirm — only when activation is explicitly authorized.
 */
export async function activateConfirmedReconciliationVisibilityV1(input: {
  client: PrismaClient | Prisma.TransactionClient;
  generationId: string;
  manualWorkoutId: number;
  garminWorkoutId: number;
}): Promise<{ applied: number }> {
  const store = prismaVisibilityStoreV1(input.client);
  return activateVisibilityGenerationV1({
    store,
    generationId: input.generationId,
    changes: [{
      // Manual is superseded by canonical Garmin, not the reverse.
      recordId: input.manualWorkoutId,
      supersedingWorkoutId: input.garminWorkoutId,
    }],
  });
}

export async function rollbackActivationGenerationV1(input: {
  client: PrismaClient;
  generationId: string;
}): Promise<{ restored: number; conflicts: number[] }> {
  return rollbackVisibilityGenerationV1({
    store: prismaVisibilityStoreV1(input.client),
    generationId: input.generationId,
  });
}

export function visibilityRevisionV1(input: {
  hiddenFromHistory: boolean;
  syncProtected: boolean;
  supersededByWorkoutId: number | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 32);
}
