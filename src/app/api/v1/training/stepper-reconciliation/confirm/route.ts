import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { readJson, validationResponse } from "@/modules/days/day.http";
import { confirmStepperReconciliationV1 } from "@/modules/training/stepper-reconciliation.service";
import { activateConfirmedReconciliationVisibilityV1 } from "@/modules/model-episodes/selection-v1-episode-ops";
import { recordExperimentalStepperActiveEnergyShadowsForWorkouts } from "@/modules/profile/experimental-stepper-active-energy-shadow.service";
import { publishActiveEnergyChangesV1 } from "@/modules/activity/active-energy-publication";

export const dynamic = "force-dynamic";

const ConfirmSchema = z.object({
  manualWorkoutId: z.number().int().positive(),
  garminWorkoutId: z.number().int().positive(),
  /** Authorized activation only. Ordinary confirm must leave visibility unchanged. */
  activateVisibility: z.boolean().optional(),
  generationId: z.string().min(1).max(80).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    await confirmStepperReconciliationV1(prisma, {
      manualWorkoutId: parsed.data.manualWorkoutId,
      garminWorkoutId: parsed.data.garminWorkoutId,
    });
    if (parsed.data.activateVisibility === true) {
      const generationId = parsed.data.generationId
        ?? `recon-${parsed.data.manualWorkoutId}-${parsed.data.garminWorkoutId}`;
      await activateConfirmedReconciliationVisibilityV1({
        client: prisma,
        generationId,
        manualWorkoutId: parsed.data.manualWorkoutId,
        garminWorkoutId: parsed.data.garminWorkoutId,
      });
    }
    await recordExperimentalStepperActiveEnergyShadowsForWorkouts({
      workoutIds: [parsed.data.manualWorkoutId, parsed.data.garminWorkoutId], profileId: 1,
    });
    await publishActiveEnergyChangesV1();
    return Response.json({ ok: true, activated: parsed.data.activateVisibility === true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    if (message.includes("requires") || message.includes("already confirmed")) {
      return Response.json({ error: message }, { status: 409 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
