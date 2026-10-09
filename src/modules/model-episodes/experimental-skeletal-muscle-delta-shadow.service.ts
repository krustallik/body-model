import { prisma } from "@/lib/db/prisma";
import { rebuildRelativeMuscleEpisodeTrajectories } from "./relative-muscle-shadow-core.service";

/** Rebuilds episode-owned daily and cumulative Relative Muscle shadow rows. */
export async function recordExperimentalSkeletalMuscleDeltaShadow(input: {
  date: string;
  profileId?: number;
}): Promise<void> {
  await rebuildRelativeMuscleEpisodeTrajectories({ profileId: input.profileId, fromDate: input.date });
}

export async function recordExperimentalSkeletalMuscleDeltaShadowForSession(input: {
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
  await rebuildRelativeMuscleEpisodeTrajectories({
    profileId: input.profileId,
    fromInstant: instant,
  });
}
