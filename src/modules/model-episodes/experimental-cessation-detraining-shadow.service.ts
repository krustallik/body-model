import { prisma } from "@/lib/db/prisma";
import { rebuildRelativeMuscleEpisodeTrajectories } from "./relative-muscle-shadow-core.service";

/** Rebuilds both coordinated Relative Muscle trajectory rows for this date. */
export async function recordExperimentalCessationDetrainingShadow(input: {
  date: string;
  profileId?: number;
}): Promise<void> {
  await rebuildRelativeMuscleEpisodeTrajectories({ profileId: input.profileId, fromDate: input.date });
}

export async function recordExperimentalCessationDetrainingShadowForSession(input: {
  sessionId: number;
  profileId: number;
}): Promise<void> {
  const session = await prisma.strengthDiarySession.findFirst({
    where: { id: input.sessionId, profileId: input.profileId },
    select: {
      matchedWorkout: { select: { startAt: true } },
      webStartedAt: true,
    },
  });
  const instant = session?.matchedWorkout?.startAt ?? session?.webStartedAt ?? null;
  if (instant === null) return;
  await rebuildRelativeMuscleEpisodeTrajectories({ profileId: input.profileId, fromInstant: instant });
}

/** Historical edits resume only from a proven exact episode-local suffix. */
export async function rebuildAuthoritativeRelativeMuscleTrajectory(input: {
  fromDate?: string;
  fromInstant?: Date;
  profileId?: number;
}): Promise<void> {
  await rebuildRelativeMuscleEpisodeTrajectories(input);
}
