import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  ActiveSessionExistsError,
  ProgramArchivedError,
  ProgramNotFoundError,
} from "@/modules/training/training.errors";
import { StartSessionSchema } from "@/modules/training/training.schema";
import { trainingService } from "@/modules/training/training.service";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = StartSessionSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);

  try {
    const session = await trainingService.startSession(parsed.data.programId);
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    if (error instanceof ActiveSessionExistsError) {
      return Response.json(
        { error: error.code, activeSessionId: error.activeSessionId },
        { status: 409 },
      );
    }
    if (error instanceof ProgramNotFoundError || error instanceof ProgramArchivedError) {
      return Response.json({ error: error.code }, { status: 404 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
