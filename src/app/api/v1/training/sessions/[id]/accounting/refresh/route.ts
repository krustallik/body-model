import { z } from "zod";
import { validationResponse } from "@/modules/days/day.http";
import { SessionIdParamsSchema } from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";
const BodySchema = z.object({ idempotencyKey: z.string().min(1).max(160).optional() }).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = SessionIdParamsSchema.safeParse(await params);
  if (!parsed.success) return validationResponse(parsed.error);
  let body: unknown = {};
  try { body = await request.json(); } catch { /* refresh also supports legacy empty requests */ }
  const payload = BodySchema.safeParse(body);
  if (!payload.success) return validationResponse(payload.error);
  try {
    const session = await trainingService.refreshSessionAccounting(parsed.data.id, undefined, payload.data.idempotencyKey);
    return Response.json({ session });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
