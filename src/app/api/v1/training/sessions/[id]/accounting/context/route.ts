import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { readJson, validationResponse } from "@/modules/days/day.http";
import { SessionIdParamsSchema, UpdateSessionAccountingContextSchema } from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

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
  const input = UpdateSessionAccountingContextSchema.safeParse(body);
  if (!input.success) return validationResponse(input.error);
  try {
    const session = await trainingService.updateSessionAccountingContext(parsed.data.id, input.data, principal.profileId);
    return Response.json({ session });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}