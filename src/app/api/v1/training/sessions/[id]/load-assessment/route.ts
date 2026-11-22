import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { readJson, validationResponse } from "@/modules/days/day.http";
import { SessionIdParamsSchema, UpdateSessionLoadAssessmentSchema } from "@/modules/training/training.schema";
import { trainingService } from "@/modules/training/training.service";
import { trainingInternalError } from "@/modules/training/training.http";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isTrustedOrigin(request)) return originRejected();

  const parsed = SessionIdParamsSchema.safeParse(await params);
  if (!parsed.success) return validationResponse(parsed.error);
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const input = UpdateSessionLoadAssessmentSchema.safeParse(body);
  if (!input.success) return validationResponse(input.error);

  try {
    const result = await trainingService.recordCompletedSessionLoadAssessment(
      parsed.data.id,
      principal.profileId,
      input.data.status === "lighter" ? "LIGHTER" : "NOT_LIGHTER",
    );
    if (!result) return Response.json({ error: "completed_session_not_found" }, { status: 404 });
    return Response.json({ saved: result.saved, assessment: result.assessment });
  } catch {
    return trainingInternalError();
  }
}
