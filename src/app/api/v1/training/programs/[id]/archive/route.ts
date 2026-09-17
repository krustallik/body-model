import { validationResponse } from "@/modules/days/day.http";
import { ProgramNotFoundError } from "@/modules/training/training.errors";
import { ProgramIdParamsSchema } from "@/modules/training/training.schema";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = ProgramIdParamsSchema.safeParse(await params);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const program = await trainingService.archiveProgram(parsed.data.id);
    return Response.json({ program });
  } catch (error) {
    if (error instanceof ProgramNotFoundError) {
      return Response.json({ error: error.code }, { status: 404 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
