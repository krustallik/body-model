import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  CreateStepperWorkoutSchema,
  StepperWorkoutListQuerySchema,
} from "@/modules/training/stepper-workout.schema";
import { stepperWorkoutRepository } from "@/modules/training/stepper-workout.repository";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = StepperWorkoutListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const [workouts, totalCount] = await Promise.all([
      stepperWorkoutRepository.list(principal.profileId, parsed.data),
      stepperWorkoutRepository.count(principal.profileId),
    ]);
    return Response.json({ workouts, totalCount });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isTrustedOrigin(request)) return originRejected();

  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = CreateStepperWorkoutSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  const rawOperationId = request.headers.get("Idempotency-Key");
  if (rawOperationId === null) return Response.json({ error: "idempotency_key_required" }, { status: 428 });
  const operationId = z.string().uuid().safeParse(rawOperationId);
  if (!operationId.success) return Response.json({ error: "invalid_idempotency_key" }, { status: 400 });
  try {
    const workout = await stepperWorkoutRepository.create(principal.profileId, parsed.data, operationId.data);
    return Response.json({ operationId: operationId.data, state: "COMMITTED", workout }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "StepperCreateOperationConflictError") {
      return Response.json({ error: "idempotency_key_payload_mismatch" }, { status: 409 });
    }
    if (error instanceof Error && error.name === "StepperCreateOperationTombstonedError") {
      return Response.json({ error: "operation_tombstoned" }, { status: 410 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}