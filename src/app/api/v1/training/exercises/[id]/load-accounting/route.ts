import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  CatalogExerciseIdParamsSchema,
  UpdateCatalogLoadAccountingConfigSchema,
} from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const routeParams = CatalogExerciseIdParamsSchema.safeParse(await params);
  if (!routeParams.success) return validationResponse(routeParams.error);
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = UpdateCatalogLoadAccountingConfigSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    await trainingService.updateCatalogLoadAccountingConfig(routeParams.data.id, parsed.data);
    return Response.json({ ok: true });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
