import { validationResponse } from "@/modules/days/day.http";
import { SessionExerciseParamsSchema } from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> },
): Promise<Response> {
  const routeParams = SessionExerciseParamsSchema.safeParse(await params);
  if (!routeParams.success) return validationResponse(routeParams.error);

  try {
    const entries = await trainingService.getExerciseHistory(
      routeParams.data.id,
      routeParams.data.exerciseId,
    );
    return Response.json({ entries });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
