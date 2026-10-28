import { stepperWorkoutDiagnosticRepository } from "@/modules/profile/stepper-workout-diagnostic.repository";
import { getSessionPrincipal } from "@/modules/auth/access";
import { prisma } from "@/lib/db/prisma";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import {
  isTrainingRefreshPending,
  readTrainingRefreshVisibilityFence,
  trainingRefreshFenceChanged,
} from "@/modules/training/training-refresh-queue";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/v1/workouts/[id]/stepper-diagnostic">): Promise<Response> {
  const principal = await getSessionPrincipal(_request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const workoutId = Number(id);
  if (!Number.isSafeInteger(workoutId) || workoutId <= 0) return Response.json({ error: "invalid_workout_id" }, { status: 400 });
  try {
    const fence = await readTrainingRefreshVisibilityFence(prisma, principal.profileId);
    if (isTrainingRefreshPending(fence)) {
      return Response.json({ error: "training_refresh_pending" }, { status: 503 });
    }
    const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
    const modelSourceFence = await lifecycle.readUnifiedPublicationFence(principal.profileId);
    if (modelSourceFence === null || await lifecycle.hasUnifiedPublicationBlocks(principal.profileId)) {
      return Response.json({ error: "model_refresh_pending" }, { status: 503 });
    }
    const diagnostic = await stepperWorkoutDiagnosticRepository.get(workoutId, principal.profileId);
    if (await trainingRefreshFenceChanged(prisma, principal.profileId, fence)) {
      return Response.json({ error: "training_refresh_pending" }, { status: 503 });
    }
    const currentModelSourceFence = await lifecycle.readUnifiedPublicationFence(principal.profileId);
    if (currentModelSourceFence === null
        || currentModelSourceFence.invalidationGeneration !== modelSourceFence.invalidationGeneration
        || currentModelSourceFence.updatedAt !== modelSourceFence.updatedAt
        || await lifecycle.hasUnifiedPublicationBlocks(principal.profileId)) {
      return Response.json({ error: "model_refresh_pending" }, { status: 503 });
    }
    if (diagnostic === undefined) return Response.json({ error: "not_found" }, { status: 404 });
    if (diagnostic === null) return Response.json({ error: "not_stair_workout" }, { status: 404 });
    return Response.json({ diagnostic });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
