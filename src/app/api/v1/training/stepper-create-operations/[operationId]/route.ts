import { getSessionPrincipal } from "@/modules/auth/access";
import { z } from "zod";
import { stepperWorkoutRepository } from "@/modules/training/stepper-workout.repository";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ operationId: string }> },
): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { operationId: rawOperationId } = await params;
  const parsed = z.string().uuid().safeParse(rawOperationId);
  if (!parsed.success) return Response.json({ error: "invalid_operation_id" }, { status: 400 });
  const payloadDigest = new URL(request.url).searchParams.get("payloadDigest");
  const parsedDigest = z.string().regex(/^[a-f0-9]{64}$/).safeParse(payloadDigest);
  if (!parsedDigest.success) return Response.json({ error: "invalid_payload_digest" }, { status: 400 });
  try {
    const result = await stepperWorkoutRepository.resolveCreateOperation(principal.profileId, {
      operationId: parsed.data,
      payloadDigest: parsedDigest.data,
    });
    if (result.state === "NOT_FOUND") return Response.json({ state: result.state }, { status: 404 });
    if (result.state === "TOMBSTONED") return Response.json({ state: result.state }, { status: 410 });
    if (result.state === "CONFLICT") return Response.json({ state: result.state }, { status: 409 });
    return Response.json(result, { status: 200 });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
