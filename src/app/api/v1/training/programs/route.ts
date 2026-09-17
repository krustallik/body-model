import { readJson, validationResponse } from "@/modules/days/day.http";
import { CreateProgramSchema, ProgramListQuerySchema } from "@/modules/training/training.schema";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(request?: Request): Promise<Response> {
  const url = new URL(request?.url ?? "http://localhost/api/v1/training/programs");
  const parsed = ProgramListQuerySchema.safeParse({
    includeArchived: url.searchParams.get("includeArchived") ?? undefined,
  });
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const programs = await trainingService.listPrograms({
      includeArchived: parsed.data.includeArchived,
    });
    return Response.json({ programs });
  } catch {
    return trainingInternalError();
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = CreateProgramSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const program = await trainingService.createProgram(parsed.data);
    return Response.json({ program }, { status: 201 });
  } catch (error) {
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
