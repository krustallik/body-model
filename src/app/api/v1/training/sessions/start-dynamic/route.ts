import { readJson, validationResponse } from "@/modules/days/day.http";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { StartDynamicSessionSchema } from "@/modules/training/training.schema";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = StartDynamicSessionSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const session = await trainingService.startDynamicSession(undefined, parsed.data.timeZone);
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
