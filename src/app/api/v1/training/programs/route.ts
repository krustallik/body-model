import { readJson, validationResponse } from "@/modules/days/day.http";
import { CatalogExerciseNotFoundError } from "@/modules/training/training.errors";
import { CreateProgramSchema } from "@/modules/training/training.schema";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const programs = await trainingService.listPrograms();
    return Response.json({ programs });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
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
    if (error instanceof CatalogExerciseNotFoundError) {
      return Response.json({ error: error.code }, { status: 400 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
