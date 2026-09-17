import { readJson, validationResponse } from "@/modules/days/day.http";
import { BulkCreateFromWorkoutsSchema } from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = BulkCreateFromWorkoutsSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const result = await trainingService.bulkCreateSessionsFromWorkouts(parsed.data);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
