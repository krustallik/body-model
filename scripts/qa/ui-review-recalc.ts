import { recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";

async function main() {
  const result = await recalculateModelEpisode({ episodeId: 567 });
  console.log(JSON.stringify({
    daysPersisted: result.daysPersisted,
    completeDays: result.completeDays,
    incompleteDays: result.incompleteDays,
    latestModeledDate: result.latestModeledDate,
    continuityStatus: result.continuityStatus,
    recoveryRequired: result.recoveryRequired,
    unknownIntervals: result.unknownIntervals,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
