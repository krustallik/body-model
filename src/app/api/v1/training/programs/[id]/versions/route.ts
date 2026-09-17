import { validationResponse } from "@/modules/days/day.http";
import { ProgramIdParamsSchema } from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx): Promise<Response> {
  const params = ProgramIdParamsSchema.safeParse(await context.params);
  if (!params.success) return validationResponse(params.error);

  try {
    const versions = await trainingService.listProgramVersions(params.data.id);
    return Response.json({ versions });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
