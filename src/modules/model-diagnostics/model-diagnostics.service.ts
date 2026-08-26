import { prisma } from "@/lib/db/prisma";
import type { ModelDatabaseClient } from "@/modules/model-episodes/model-episode.repository";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { ModelRecoveryRepository } from "@/modules/model-recovery/model-recovery.repository";
import { buildDiagnosticsDto } from "./model-diagnostics";
import { ModelDiagnosticsRepository } from "./model-diagnostics.repository";

export async function getModelDiagnostics(client: ModelDatabaseClient = prisma) {
  const episodes = new ModelEpisodeRepository(client);
  const episode = await episodes.getActive();
  if (!episode) throw new NoActiveModelEpisodeError();
  const status = await episodes.status(episode.id);
  if (!status) throw new NoActiveModelEpisodeError();
  const candidateWindowStart = episode.latestModeledDate ? addCalendarDays(episode.latestModeledDate, -27) : null;
  const windowStartDate = candidateWindowStart
    ? (candidateWindowStart < episode.startDate ? episode.startDate : candidateWindowStart)
    : null;
  const emptyEvidence = {
    modeledDayCount: 0, completeDayCount: 0, incompleteDayCount: 0,
    observedNutritionDayCount: 0, imputedNutritionDayCount: 0,
    unresolvedNutritionDayCount: 0, weightObservationCount: 0,
  };
  const [evidence, recovery] = await Promise.all([
    windowStartDate && episode.latestModeledDate
      ? new ModelDiagnosticsRepository(client).loadEvidence(episode.id, windowStartDate, episode.latestModeledDate)
      : Promise.resolve(emptyEvidence),
    new ModelRecoveryRepository(client).latestStatus(episode.id),
  ]);
  return buildDiagnosticsDto({ episode, status, evidence, windowStartDate, recovery });
}
