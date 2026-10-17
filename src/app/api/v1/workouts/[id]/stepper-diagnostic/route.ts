import { stepperWorkoutDiagnosticRepository } from "@/modules/profile/stepper-workout-diagnostic.repository";
import { prisma } from "@/lib/db/prisma";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import {
  isTrainingRefreshPending,
  readTrainingRefreshVisibilityFence,
  trainingRefreshFenceChanged,
} from "@/modules/training/training-refresh-queue";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/v1/workouts/[id]/stepper-diagnostic">): Promise<Response> {
  const { id } = await context.params;
  const workoutId = Number(id);
  if (!Number.isSafeInteger(workoutId) || workoutId <= 0) return Response.json({ error: "invalid_workout_id" }, { status: 400 });
  try {
    const fence = await readTrainingRefreshVisibilityFence(prisma, 1);
    if (isTrainingRefreshPending(fence)) {
      return Response.json({ error: "training_refresh_pending" }, { status: 503 });
    }
    const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
    const modelSourceFence = await lifecycle.readUnifiedPublicationFence(1);
    if (modelSourceFence === null || await lifecycle.hasUnifiedPublicationBlocks(1)) {
      return Response.json({ error: "model_refresh_pending" }, { status: 503 });
    }
    const diagnostic = await stepperWorkoutDiagnosticRepository.get(workoutId);
    if (await trainingRefreshFenceChanged(prisma, 1, fence)) {
      return Response.json({ error: "training_refresh_pending" }, { status: 503 });
    }
    const currentModelSourceFence = await lifecycle.readUnifiedPublicationFence(1);
    if (currentModelSourceFence === null
        || currentModelSourceFence.invalidationGeneration !== modelSourceFence.invalidationGeneration
        || currentModelSourceFence.updatedAt !== modelSourceFence.updatedAt
        || await lifecycle.hasUnifiedPublicationBlocks(1)) {
      return Response.json({ error: "model_refresh_pending" }, { status: 503 });
    }
    if (diagnostic === undefined) return Response.json({ error: "not_found" }, { status: 404 });
    if (diagnostic === null) return Response.json({ error: "not_stair_workout" }, { status: 404 });
    return Response.json({ diagnostic });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
