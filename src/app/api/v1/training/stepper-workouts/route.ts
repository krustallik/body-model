import { readJson, validationResponse } from "@/modules/days/day.http";
import { CreateStepperWorkoutSchema } from "@/modules/training/stepper-workout.schema";
import { stepperWorkoutRepository } from "@/modules/training/stepper-workout.repository";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ workouts: await stepperWorkoutRepository.list() });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = CreateStepperWorkoutSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    return Response.json({ workout: await stepperWorkoutRepository.create(parsed.data) }, { status: 201 });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
