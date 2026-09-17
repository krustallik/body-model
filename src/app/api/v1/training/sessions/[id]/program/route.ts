import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  ChangeSessionProgramSchema,
  SessionIdParamsSchema,
} from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx): Promise<Response> {
  const params = SessionIdParamsSchema.safeParse(await context.params);
  if (!params.success) return validationResponse(params.error);

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = ChangeSessionProgramSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const session = await trainingService.changeSessionProgram(params.data.id, parsed.data);
    return Response.json({ session });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
