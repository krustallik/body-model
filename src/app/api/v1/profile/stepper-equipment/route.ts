import { readJson, validationResponse } from "@/modules/days/day.http";
import { stepperEquipmentRepository } from "@/modules/profile/stepper-equipment.repository";
import { StepperEquipmentAssignmentInputSchema } from "@/modules/profile/stepper-equipment.schema";
import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json({ assignments: await stepperEquipmentRepository.list(principal.profileId) });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isTrustedOrigin(request)) return originRejected();
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = StepperEquipmentAssignmentInputSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    return Response.json({ assignment: await stepperEquipmentRepository.configureMs100(principal.profileId, parsed.data.effectiveFrom) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("effectiveFrom")) {
      return Response.json({ error: "invalid_effective_from" }, { status: 400 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
