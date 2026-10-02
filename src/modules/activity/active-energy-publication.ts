import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { getModelStatus, recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";

/** Publish canonical Active Energy changes through production and experimental readers in order. */
export async function publishActiveEnergyChangesV1(): Promise<void> {
  let status;
  try {
    status = await getModelStatus();
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) return;
    throw error;
  }
  await recalculateModelEpisode({ episodeId: status.episodeId });
  const current = await getModelStatus(status.episodeId);
  if (current.latestModeledDate === null) return;
  await rebuildUnifiedExperimentalPhysiologyStateV1({
    profileId: 1,
    fromDate: current.episodeStartDate,
    toDate: current.latestModeledDate,
  });
}
