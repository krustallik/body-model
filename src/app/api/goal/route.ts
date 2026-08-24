import { readJson, validationResponse } from "@/modules/days/day.http";
import { ModelEpisodeNotFoundError, NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { forecastQaNow } from "@/app/api/forecast/qa-now";
import { GoalPlanningRequestSchema } from "@/modules/model-goal-planning/goal-planning.schema";
import { serializeGoalPlanningResult, toTargetSolverRequest } from "@/modules/model-goal-planning/goal-planning";
import { solveModelEpisodeTarget } from "@/modules/model-target-solver/model-target-solver.service";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = GoalPlanningRequestSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const now = forecastQaNow();
    const result = await solveModelEpisodeTarget({
      ...toTargetSolverRequest(parsed.data),
      ...(now ? { now } : {}),
    });
    return Response.json(serializeGoalPlanningResult(parsed.data, result));
  } catch (error) {
    if (error instanceof NoActiveModelEpisodeError) return Response.json({ error: "no_active_episode" }, { status: 404 });
    if (error instanceof ModelEpisodeNotFoundError) return Response.json({ error: "episode_not_found" }, { status: 404 });
    if (error instanceof RangeError) return Response.json({ error: "invalid_goal_date", message: error.message }, { status: 400 });
    return Response.json({ error: "goal_planning_failed" }, { status: 500 });
  }
}
