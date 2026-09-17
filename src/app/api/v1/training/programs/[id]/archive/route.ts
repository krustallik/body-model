import { validationResponse } from "@/modules/days/day.http";
import { ProgramIdParamsSchema } from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
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
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
