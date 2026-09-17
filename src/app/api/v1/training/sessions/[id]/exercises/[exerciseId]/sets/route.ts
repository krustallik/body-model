import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  CreateSetSchema,
  SessionExerciseParamsSchema,
} from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> },
): Promise<Response> {
  const routeParams = SessionExerciseParamsSchema.safeParse(await params);
  if (!routeParams.success) return validationResponse(routeParams.error);

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = CreateSetSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const set = await trainingService.createSet(
      routeParams.data.id,
      routeParams.data.exerciseId,
      parsed.data,
    );
    return Response.json({ set }, { status: 201 });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
