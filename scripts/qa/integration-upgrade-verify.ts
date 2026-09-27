import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const mode = process.argv[2] ?? "seed";
  if (mode === "seed") {
    await prisma.profile.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        sex: "male",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        heightCm: 180,
        locale: "en",
      },
    });
    const day = await prisma.dailyHealthData.upsert({
      where: { date: "2099-01-01" },
      create: {
        date: "2099-01-01",
        weightKg: 80,
        caloriesKcal: 2000,
        rawPayload: { marker: "upgrade-baseline" },
      },
      update: {
        weightKg: 80,
        caloriesKcal: 2000,
        rawPayload: { marker: "upgrade-baseline" },
      },
    });
    const existing = await prisma.workout.findFirst({
      where: { sourceIdentity: "ext:upgrade-baseline" },
    });
    const workout = existing ?? await prisma.workout.create({
      data: {
        dailyHealthDataId: day.id,
        sourceIdentity: "ext:upgrade-baseline",
        type: "Stair Climbing",
        startAt: new Date("2099-01-01T10:00:00.000Z"),
        endAt: new Date("2099-01-01T11:00:00.000Z"),
        durationMinutes: 60,
        activeEnergyKcal: 300,
        hiddenFromHistory: false,
      },
    });
    console.log(JSON.stringify({ mode, day: day.date, workoutId: workout.id, kcal: workout.activeEnergyKcal }, null, 2));
    return;
  }

  const day = await prisma.dailyHealthData.findUnique({ where: { date: "2099-01-01" } });
  const workout = await prisma.workout.findFirst({ where: { sourceIdentity: "ext:upgrade-baseline" } });
  const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    "select indexname from pg_indexes where schemaname = 'public' and (indexname ilike '%reconcil%' or indexname ilike '%supersed%' or indexname ilike '%sourceidentity%') order by 1",
  );
  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    "select tablename from pg_tables where schemaname = 'public' and tablename ilike '%reconcil%' order by 1",
  );
  console.log(JSON.stringify({
    mode,
    preservedDayWeight: day?.weightKg ?? null,
    preservedWorkoutKcal: workout?.activeEnergyKcal ?? null,
    tables,
    indexes,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
