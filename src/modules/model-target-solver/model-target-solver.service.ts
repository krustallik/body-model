import { type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ModelEpisodeNotFoundError, NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { latestCompletedLocalDate } from "@/modules/model-episodes/model-calendar";
import { forecastModelEpisodeWithInternalArtifacts } from "@/modules/model-forecast/model-forecast.service";
import type { ForecastModelRequest } from "@/modules/model-forecast/model-forecast.schema";
import { TargetSolverRequestSchema } from "./target-solver.schema";
import { solveWeightTarget } from "./target-solver";
import { goalHorizonDays } from "./goal-date";
import type { TargetSolverRequest } from "./target-solver.types";

export async function solveModelEpisodeTarget(
  request: TargetSolverRequest & { now?: Date },
  client: PrismaClient = prisma,
) {
  const { now, ...requestBody } = request;
  const parsed = TargetSolverRequestSchema.parse(requestBody) as TargetSolverRequest;
  const episodes = new ModelEpisodeRepository(client);
  const episode = parsed.episodeId === undefined
    ? await episodes.getActive() : await episodes.getById(parsed.episodeId);
  if (!episode) {
    if (parsed.episodeId === undefined) throw new NoActiveModelEpisodeError();
    throw new ModelEpisodeNotFoundError();
  }
  const latestCompletedDate = latestCompletedLocalDate(now ?? new Date(), episode.timezone);
  const horizonDays = goalHorizonDays(latestCompletedDate, parsed.goal.goalDate);
  return solveWeightTarget({
    request: parsed,
    horizonDays,
    evaluateForecast: async ({ scenario, pathCount }) => {
      const evaluation = await forecastModelEpisodeWithInternalArtifacts({
        episodeId: parsed.episodeId,
        horizonDays,
        seed: parsed.seed,
        scenario: scenario as unknown as ForecastModelRequest["scenario"],
        config: { ...parsed.forecastConfig, pathCount },
        now,
      }, client);
      return "result" in evaluation ? {
        forecast: evaluation.result,
        initialPhysiologicalBodyWeightKg: evaluation.initialPhysiologicalBodyWeightKg,
        terminalPhysiologicalBodyWeightSamplesKg: evaluation.terminalPhysiologicalBodyWeightSamplesKg,
      } : evaluation;
    },
  });
}
