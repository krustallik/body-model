import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const episode = await prisma.modelEpisode.findFirst({ where: { active: true } });
  const states = episode
    ? await prisma.dailyModelState.count({ where: { episodeId: episode.id } })
    : 0;
  const days = await prisma.dailyHealthData.count();
  const workouts = await prisma.workout.count();
  console.log(JSON.stringify({
    episode: episode && {
      id: episode.id,
      startDate: episode.startDate,
      latestModeledDate: episode.latestModeledDate,
      modelVersion: episode.modelVersion,
      active: episode.active,
    },
    states,
    days,
    workouts,
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
