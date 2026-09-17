import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  ProgramIdParamsSchema,
  UpdateProgramSchema,
} from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = ProgramIdParamsSchema.safeParse(await params);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const program = await trainingService.getProgram(parsed.data.id);
    return program
      ? Response.json({ program })
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch {
    return trainingInternalError();
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const routeParams = ProgramIdParamsSchema.safeParse(await params);
  if (!routeParams.success) return validationResponse(routeParams.error);

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = UpdateProgramSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const program = await trainingService.updateProgram(routeParams.data.id, parsed.data);
    return Response.json({ program });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
