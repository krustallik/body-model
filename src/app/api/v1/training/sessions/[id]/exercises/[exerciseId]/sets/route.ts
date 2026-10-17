import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  CreateSetSchema,
  SessionExerciseParamsSchema,
} from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";
import { z } from "zod";

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
  const rawOperationId = request.headers.get("Idempotency-Key");
  if (rawOperationId === null) {
    return Response.json({ error: "idempotency_key_required" }, { status: 428 });
  }
  const operationId = z.string().uuid().safeParse(rawOperationId);
  if (!operationId.success) {
    return Response.json({ error: "invalid_idempotency_key" }, { status: 400 });
  }

  try {
    const set = await trainingService.createSet(
      routeParams.data.id,
      routeParams.data.exerciseId,
      parsed.data,
      undefined,
      operationId.data,
    );
    return Response.json({ operationId: operationId.data, state: "COMMITTED", set }, { status: 201 });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
