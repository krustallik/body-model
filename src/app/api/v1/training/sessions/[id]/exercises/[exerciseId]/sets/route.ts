import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  SessionExerciseNotFoundError,
  SessionNotFoundError,
  SetValidationError,
} from "@/modules/training/training.errors";
import {
  CreateSetSchema,
  SessionExerciseParamsSchema,
} from "@/modules/training/training.schema";
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
    if (error instanceof SessionExerciseNotFoundError || error instanceof SessionNotFoundError) {
      return Response.json({ error: error.code }, { status: 404 });
    }
    if (error instanceof SetValidationError) {
      return Response.json({ error: error.code, message: error.message }, { status: 400 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
