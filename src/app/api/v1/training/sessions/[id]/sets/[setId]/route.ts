import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  SessionSetParamsSchema,
  UpdateSetSchema,
} from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
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
    return trainingErrorResponse(error) ?? trainingInternalError();
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
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
