import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { getModelStatus, recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import { logEvent } from "@/lib/logger";

export type CurrentActiveEnergyPublicationWindowV1 = {
  episodeId: number;
  episodeStartDate: string;
  latestModeledDate: string;
};

export type ProductionPublicationFenceV1 = {
  invalidationGeneration: number;
  updatedAt: string;
};

export type ActiveEnergyPublicationStatusV1 = "current" | "stale" | "not-run";

/** Rebuild production Active Energy without publishing the dependent Unified snapshot. */
export async function recalculateActiveEnergyChangesV1(input: {
  now?: Date;
  onProductionPublished?: (fence: ProductionPublicationFenceV1) => void;
} = {}): Promise<CurrentActiveEnergyPublicationWindowV1 | null> {
  let status;
  try {
    status = await getModelStatus();
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) return null;
    throw error;
  }
  await recalculateModelEpisode({
    episodeId: status.episodeId,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.onProductionPublished === undefined ? {} : { onProductionPublished: input.onProductionPublished }),
  });
  const current = await getModelStatus(status.episodeId);
  if (!current.productionCurrent || current.latestModeledDate === null) return null;
  return {
    episodeId: current.episodeId,
    episodeStartDate: current.episodeStartDate,
    latestModeledDate: current.latestModeledDate,
  };
}

/** Publish canonical Active Energy changes through production and Unified readers in order. */
export async function publishActiveEnergyChangesV1(input: {
  now?: Date;
  onProductionPublished?: (fence: ProductionPublicationFenceV1) => void;
} = {}): Promise<boolean> {
  const current = await recalculateActiveEnergyChangesV1(input);
  if (current === null) {
    logEvent("warn", "active_energy_publication_not_current", {
      reason: "production-generation-unavailable",
    });
    return false;
  }
  await rebuildUnifiedExperimentalPhysiologyStateV1({
    profileId: 1,
    fromDate: current.episodeStartDate,
    toDate: current.latestModeledDate,
  });
  return true;
}
