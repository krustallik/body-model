import { getSessionPrincipal, isTrustedOrigin, originRejected } from "@/modules/auth/access";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { readJson, validationResponse } from "@/modules/days/day.http";
import { rejectStepperReconciliationV1 } from "@/modules/training/stepper-reconciliation.service";
import { recordExperimentalStepperActiveEnergyShadowsForWorkouts } from "@/modules/profile/experimental-stepper-active-energy-shadow.service";
import { publishActiveEnergyChangesV1 } from "@/modules/activity/active-energy-publication";

export const dynamic = "force-dynamic";

const RejectSchema = z.object({
  groupId: z.number().int().positive(),
});

export async function POST(request: Request): Promise<Response> {
  const principal = await getSessionPrincipal(request);
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isTrustedOrigin(request)) return originRejected();

  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = RejectSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const members = await prisma.stepperReconciliationCandidate.findMany({
      where: { profileId: principal.profileId, groupId: parsed.data.groupId },
      select: { manualWorkoutId: true, garminWorkoutId: true },
    });
    await rejectStepperReconciliationV1(prisma, { profileId: principal.profileId, groupId: parsed.data.groupId });
    await recordExperimentalStepperActiveEnergyShadowsForWorkouts({
      workoutIds: [...new Set(members.flatMap((pair) => [pair.manualWorkoutId, pair.garminWorkoutId]))],
      profileId: principal.profileId,
    });
    const published = await publishActiveEnergyChangesV1({ profileId: principal.profileId, activeEnergyCandidateScope: {
      strengthSessionIds: [],
      workoutIds: [...new Set(members.flatMap((pair) => [pair.manualWorkoutId, pair.garminWorkoutId]))],
    } });
    return Response.json({ ok: true, modelPublicationStatus: published ? "current" : "stale" });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}