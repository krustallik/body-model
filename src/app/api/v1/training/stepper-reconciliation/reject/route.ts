import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { readJson, validationResponse } from "@/modules/days/day.http";
import { rejectStepperReconciliationV1 } from "@/modules/training/stepper-reconciliation.service";

export const dynamic = "force-dynamic";

const RejectSchema = z.object({
  groupId: z.number().int().positive(),
});

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = RejectSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    await rejectStepperReconciliationV1(prisma, { groupId: parsed.data.groupId });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
