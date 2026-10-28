import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  ManualMatchSchema,
  SessionIdParamsSchema,
} from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isTrustedOrigin(request)) return originRejected();

  const routeParams = SessionIdParamsSchema.safeParse(await params);
  if (!routeParams.success) return validationResponse(routeParams.error);

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = ManualMatchSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const session = await trainingService.manualMatch(routeParams.data.id, parsed.data, principal.profileId);
    return Response.json({ session });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}