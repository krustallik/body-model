import { readJson, validationResponse } from "@/modules/days/day.http";
import { stepperEquipmentRepository } from "@/modules/profile/stepper-equipment.repository";
import { StepperEquipmentAssignmentInputSchema } from "@/modules/profile/stepper-equipment.schema";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ assignments: await stepperEquipmentRepository.list() });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = StepperEquipmentAssignmentInputSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    return Response.json({ assignment: await stepperEquipmentRepository.configureMs100(parsed.data.effectiveFrom) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("effectiveFrom")) {
      return Response.json({ error: "invalid_effective_from" }, { status: 400 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
