import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  CatalogExerciseNotFoundError,
  ProgramNotFoundError,
} from "@/modules/training/training.errors";
import {
  ProgramIdParamsSchema,
  UpdateProgramSchema,
} from "@/modules/training/training.schema";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

async function parseId(params: Promise<{ id: string }>): Promise<number | Response> {
  const parsed = ProgramIdParamsSchema.safeParse(await params);
  return parsed.success ? parsed.data.id : validationResponse(parsed.error);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = await parseId(params);
  if (id instanceof Response) return id;

  try {
    const program = await trainingService.getProgram(id);
    return program
      ? Response.json({ program })
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = await parseId(params);
  if (id instanceof Response) return id;

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = UpdateProgramSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const program = await trainingService.updateProgram(id, parsed.data);
    return Response.json({ program });
  } catch (error) {
    if (error instanceof ProgramNotFoundError) {
      return Response.json({ error: error.code }, { status: 404 });
    }
    if (error instanceof CatalogExerciseNotFoundError) {
      return Response.json({ error: error.code }, { status: 400 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
