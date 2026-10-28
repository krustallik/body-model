import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { getModelStatus, recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import type { ActiveEnergyCandidateScopeV1 } from "./active-energy-materialization";
import { logEvent } from "@/lib/logger";

export type CurrentActiveEnergyPublicationWindowV1 = {
  episodeId: number;
  episodeStartDate: string;
  latestModeledDate: string;
  effectiveReplayFromDate: string;
};

export type ProductionPublicationFenceV1 = {
  invalidationGeneration: number;
  updatedAt: string;
};

export type ActiveEnergyPublicationStatusV1 = "current" | "stale" | "not-run";

/** Rebuild production Active Energy without publishing the dependent Unified snapshot. */
export async function recalculateActiveEnergyChangesV1(input: {
  profileId: number;
  reuseCurrentProduction?: boolean;
  now?: Date;
  requireDependentStages?: boolean;
  activeEnergyCandidateScope?: ActiveEnergyCandidateScopeV1;
  onLifecycleFenceChanged?: (fence: ProductionPublicationFenceV1) => void | Promise<void>;
  onCandidateProcessed?: () => void | Promise<void>;
}): Promise<CurrentActiveEnergyPublicationWindowV1 | null> {
  let status;
  try {
    status = await getModelStatus(input.profileId);
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) return null;
    throw error;
  }
  if (input.reuseCurrentProduction && status.productionCurrent && status.latestModeledDate !== null) {
    return { episodeId: status.episodeId, episodeStartDate: status.episodeStartDate,
      latestModeledDate: status.latestModeledDate, effectiveReplayFromDate: status.episodeStartDate };
  }
  const production = await recalculateModelEpisode({
    profileId: input.profileId,
    episodeId: status.episodeId,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.requireDependentStages === undefined ? {} : { requireDependentStages: input.requireDependentStages }),
    ...(input.activeEnergyCandidateScope === undefined ? {} : { activeEnergyCandidateScope: input.activeEnergyCandidateScope }),
    ...(input.onLifecycleFenceChanged === undefined ? {} : { onLifecycleFenceChanged: input.onLifecycleFenceChanged }),
    ...(input.onCandidateProcessed === undefined ? {} : { onCandidateProcessed: input.onCandidateProcessed }),
  });
  const current = await getModelStatus(input.profileId, status.episodeId);
  if (!current.productionCurrent || current.latestModeledDate === null) return null;
  return {
    episodeId: current.episodeId,
    episodeStartDate: current.episodeStartDate,
    latestModeledDate: current.latestModeledDate,
    effectiveReplayFromDate: production.effectiveReplayFromDate,
  };
}

/** Publish canonical Active Energy changes through production and Unified readers in order. */
export async function publishActiveEnergyChangesV1(input: {
  profileId: number;
  reuseCurrentProduction?: boolean;
  now?: Date;
  activeEnergyCandidateScope?: ActiveEnergyCandidateScopeV1;
  onLifecycleFenceChanged?: (fence: ProductionPublicationFenceV1) => void | Promise<void>;
}): Promise<boolean> {
  const current = await recalculateActiveEnergyChangesV1(input);
  if (current === null) {
    logEvent("warn", "active_energy_publication_not_current", {
      reason: "production-generation-unavailable",
    });
    return false;
  }
  await rebuildUnifiedExperimentalPhysiologyStateV1({
    profileId: input.profileId,
    fromDate: current.episodeStartDate,
    toDate: current.latestModeledDate,
  });
  return true;
}
