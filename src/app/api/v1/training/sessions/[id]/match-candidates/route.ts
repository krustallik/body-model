import { validationResponse } from "@/modules/days/day.http";
import { SessionNotFoundError } from "@/modules/training/training.errors";
import { SessionIdParamsSchema } from "@/modules/training/training.schema";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = SessionIdParamsSchema.safeParse(await params);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const candidates = await trainingService.listMatchCandidates(parsed.data.id);
    return Response.json({ candidates });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return Response.json({ error: error.code }, { status: 404 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
