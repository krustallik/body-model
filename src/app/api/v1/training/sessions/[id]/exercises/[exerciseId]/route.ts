import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  DeleteSessionExerciseSchema,
  SessionExerciseParamsSchema,
  UpdateSessionExerciseSchema,
} from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; exerciseId: string }> };

export async function PATCH(request: Request, context: Ctx): Promise<Response> {
  const params = SessionExerciseParamsSchema.safeParse(await context.params);
  if (!params.success) return validationResponse(params.error);

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = UpdateSessionExerciseSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const session = await trainingService.updateSessionExercise(
      params.data.id,
      params.data.exerciseId,
      parsed.data,
    );
    return Response.json({ session });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}

export async function DELETE(request: Request, context: Ctx): Promise<Response> {
  const params = SessionExerciseParamsSchema.safeParse(await context.params);
  if (!params.success) return validationResponse(params.error);

  let confirm: unknown = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    confirm = body;
  } else {
    const url = new URL(request.url);
    if (url.searchParams.get("confirm") === "true") {
      confirm = { confirm: true };
    }
  }

  const parsed = DeleteSessionExerciseSchema.safeParse(confirm);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const session = await trainingService.deleteSessionExercise(
      params.data.id,
      params.data.exerciseId,
      parsed.data,
    );
    return Response.json({ session });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
