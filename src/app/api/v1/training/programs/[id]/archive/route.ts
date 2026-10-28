import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";

import { validationResponse } from "@/modules/days/day.http";
import { ProgramIdParamsSchema } from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getSessionPrincipal(_request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isTrustedOrigin(_request)) return originRejected();
  const parsed = ProgramIdParamsSchema.safeParse(await params);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const program = await trainingService.archiveProgram(parsed.data.id, principal.profileId);
    return Response.json({ program });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}