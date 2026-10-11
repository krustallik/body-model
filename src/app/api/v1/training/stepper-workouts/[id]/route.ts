import { readJson, validationResponse } from "@/modules/days/day.http";
import { StepperWorkoutIdParamsSchema, UpdateStepperWorkoutSchema } from "@/modules/training/stepper-workout.schema";
import { stepperWorkoutRepository } from "@/modules/training/stepper-workout.repository";

export const dynamic = "force-dynamic";

async function parseId(params: Promise<{ id: string }>): Promise<number | Response> {
  const parsed = StepperWorkoutIdParamsSchema.safeParse(await params);
  return parsed.success ? parsed.data.id : validationResponse(parsed.error);
}

export async function PUT(request: Request, { params }: RouteContext<"/api/v1/training/stepper-workouts/[id]">): Promise<Response> {
  const id = await parseId(params);
  if (id instanceof Response) return id;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = UpdateStepperWorkoutSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const workout = await stepperWorkoutRepository.update(id, parsed.data);
    return workout ? Response.json({ workout }) : Response.json({ error: "not_found_or_read_only" }, { status: 404 });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext<"/api/v1/training/stepper-workouts/[id]">): Promise<Response> {
  const id = await parseId(params);
  if (id instanceof Response) return id;
  try {
    const result = await stepperWorkoutRepository.delete(id);
    return result.deleted
      ? new Response(null, {
        status: 204,
        headers: { "X-Model-Publication-Status": result.modelPublicationStatus ?? "not-run" },
      })
      : Response.json({ error: "not_found_or_read_only" }, { status: 404 });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
