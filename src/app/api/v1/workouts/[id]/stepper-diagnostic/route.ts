import { stepperWorkoutDiagnosticRepository } from "@/modules/profile/stepper-workout-diagnostic.repository";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/v1/workouts/[id]/stepper-diagnostic">): Promise<Response> {
  const { id } = await context.params;
  const workoutId = Number(id);
  if (!Number.isSafeInteger(workoutId) || workoutId <= 0) return Response.json({ error: "invalid_workout_id" }, { status: 400 });
  try {
    const diagnostic = await stepperWorkoutDiagnosticRepository.get(workoutId);
    if (diagnostic === undefined) return Response.json({ error: "not_found" }, { status: 404 });
    if (diagnostic === null) return Response.json({ error: "not_stair_workout" }, { status: 404 });
    return Response.json({ diagnostic });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
