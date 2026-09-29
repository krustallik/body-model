import { readJson, validationResponse } from "@/modules/days/day.http";
import {
  CreateStepperWorkoutSchema,
  StepperWorkoutListQuerySchema,
} from "@/modules/training/stepper-workout.schema";
import { stepperWorkoutRepository } from "@/modules/training/stepper-workout.repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const parsed = StepperWorkoutListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const [workouts, totalCount] = await Promise.all([
      stepperWorkoutRepository.list(parsed.data),
      stepperWorkoutRepository.count(),
    ]);
    return Response.json({ workouts, totalCount });
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
