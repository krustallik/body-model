import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { readJson, validationResponse } from "@/modules/days/day.http";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { StartDynamicSessionSchema } from "@/modules/training/training.schema";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isTrustedOrigin(request)) return originRejected();

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = StartDynamicSessionSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const session = await trainingService.startDynamicSession(principal.profileId, parsed.data.timeZone);
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}