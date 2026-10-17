import { prisma } from "@/lib/db/prisma";
import type { ModelDatabaseClient } from "@/modules/model-episodes/model-episode.repository";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { ModelRecoveryRepository } from "@/modules/model-recovery/model-recovery.repository";
import {
  isTrainingRefreshPending,
  readTrainingRefreshVisibilityFence,
  trainingRefreshFenceChanged,
  trainingRefreshWorkerOwnsGeneration,
} from "@/modules/training/training-refresh-queue";
import { buildDiagnosticsDto, MODEL_DIAGNOSTICS_RECENT_WINDOW_DAYS } from "./model-diagnostics";
import { ModelDiagnosticsRepository } from "./model-diagnostics.repository";

export class TrainingRefreshPendingDiagnosticsError extends Error {
  constructor() {
    super("Training model refresh is pending");
    this.name = "TrainingRefreshPendingDiagnosticsError";
  }
}

export async function getModelDiagnostics(client: ModelDatabaseClient = prisma) {
  const trainingFence = await readTrainingRefreshVisibilityFence(client, 1);
  const episodes = new ModelEpisodeRepository(client);
  const episode = await episodes.getActive();
  if (!episode) throw new NoActiveModelEpisodeError();
  const status = await episodes.status(episode.id);
  if (!status) throw new NoActiveModelEpisodeError();
  const currentPrefixEndDate = status.productionCurrent
    ? episode.latestModeledDate
    : status.productionDirtyFromDate
      ? addCalendarDays(status.productionDirtyFromDate, -1)
      : null;
  const boundedCurrentPrefixEndDate = currentPrefixEndDate && currentPrefixEndDate >= episode.startDate
    ? currentPrefixEndDate
    : null;
  const latestCurrentModeledDate = status.latestModeledDate
    && boundedCurrentPrefixEndDate
    && status.latestModeledDate <= boundedCurrentPrefixEndDate
    ? status.latestModeledDate
    : null;
  const candidateWindowStart = latestCurrentModeledDate
    ? addCalendarDays(latestCurrentModeledDate, -(MODEL_DIAGNOSTICS_RECENT_WINDOW_DAYS - 1))
    : null;
  const windowStartDate = candidateWindowStart
    ? (candidateWindowStart < episode.startDate ? episode.startDate : candidateWindowStart)
    : null;
  const emptyEvidence = {
    modeledDayCount: 0, completeDayCount: 0, incompleteDayCount: 0,
    observedNutritionDayCount: 0, imputedNutritionDayCount: 0,
    unresolvedNutritionDayCount: 0, weightObservationCount: 0,
  };
  const [evidence, recovery] = await Promise.all([
    windowStartDate && latestCurrentModeledDate
      ? new ModelDiagnosticsRepository(client).loadEvidence(
        episode.id,
        windowStartDate,
        latestCurrentModeledDate,
        latestCurrentModeledDate,
      )
      : Promise.resolve(emptyEvidence),
    new ModelRecoveryRepository(client).latestStatus(episode.id),
  ]);
  const workerOwnsGeneration = await trainingRefreshWorkerOwnsGeneration(
    client,
    1,
    trainingFence?.requestedGeneration,
  );
  if ((isTrainingRefreshPending(trainingFence) && !workerOwnsGeneration)
      || await trainingRefreshFenceChanged(client, 1, trainingFence)) {
    // Deterministic and recovery snapshots form one composed current-state
    // response. A partial fallback could still expose the previous generation's
    // posterior or calibration as current, so fail closed for the whole read.
    throw new TrainingRefreshPendingDiagnosticsError();
  }
  return buildDiagnosticsDto({ episode, status, evidence, windowStartDate, recovery });
}
