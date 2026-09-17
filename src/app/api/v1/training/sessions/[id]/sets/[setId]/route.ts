import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  SessionNotFoundError,
  SetNotFoundError,
  SetValidationError,
} from "@/modules/training/training.errors";
import {
  SessionSetParamsSchema,
  UpdateSetSchema,
} from "@/modules/training/training.schema";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; setId: string }> },
): Promise<Response> {
  const routeParams = SessionSetParamsSchema.safeParse(await params);
  if (!routeParams.success) return validationResponse(routeParams.error);

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = UpdateSetSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const set = await trainingService.updateSet(
      routeParams.data.id,
      routeParams.data.setId,
      parsed.data,
    );
    return Response.json({ set });
  } catch (error) {
    if (error instanceof SetNotFoundError || error instanceof SessionNotFoundError) {
      return Response.json({ error: error.code }, { status: 404 });
    }
    if (error instanceof SetValidationError) {
      return Response.json({ error: error.code, message: error.message }, { status: 400 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; setId: string }> },
): Promise<Response> {
  const routeParams = SessionSetParamsSchema.safeParse(await params);
  if (!routeParams.success) return validationResponse(routeParams.error);

  try {
    await trainingService.deleteSet(routeParams.data.id, routeParams.data.setId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof SetNotFoundError || error instanceof SessionNotFoundError) {
      return Response.json({ error: error.code }, { status: 404 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
