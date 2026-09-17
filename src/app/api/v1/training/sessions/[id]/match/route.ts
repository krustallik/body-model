import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  SessionNotFoundError,
  WorkoutAlreadyMatchedError,
  WorkoutNotEligibleError,
} from "@/modules/training/training.errors";
import {
  ManualMatchSchema,
  SessionIdParamsSchema,
} from "@/modules/training/training.schema";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const routeParams = SessionIdParamsSchema.safeParse(await params);
  if (!routeParams.success) return validationResponse(routeParams.error);

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = ManualMatchSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const session = await trainingService.manualMatch(routeParams.data.id, parsed.data);
    return Response.json({ session });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return Response.json({ error: error.code }, { status: 404 });
    }
    if (error instanceof WorkoutNotEligibleError) {
      return Response.json({ error: error.code }, { status: 400 });
    }
    if (error instanceof WorkoutAlreadyMatchedError) {
      return Response.json({ error: error.code }, { status: 409 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
