import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { validationResponse } from "@/modules/days/day.http";
import { SessionIdParamsSchema } from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = SessionIdParamsSchema.safeParse(await params);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const session = new URL(request.url).searchParams.get("readOnly") === "true"
      ? await trainingService.getSession(parsed.data.id, principal.profileId, { readOnly: true })
      : await trainingService.getSession(parsed.data.id, principal.profileId);
    return session
      ? Response.json({ session })
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch {
    return trainingInternalError();
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getSessionPrincipal(_request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isTrustedOrigin(_request)) return originRejected();

  const parsed = SessionIdParamsSchema.safeParse(await params);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const result = await trainingService.deleteDiarySession(parsed.data.id, principal.profileId);
    return Response.json({
      deleted: true,
      matchedWorkoutId: result.matchedWorkoutId,
    });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}