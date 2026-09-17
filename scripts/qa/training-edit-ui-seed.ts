/**
 * Local seed for Training Diary edit UX review.
 * Creates a program with 7 exercises + retrospective session linked to a workout.
 *
 * Usage (host against Docker Postgres):
 *   $env:DATABASE_URL='postgresql://bodycast:change_me@127.0.0.1:5432/bodycast'
 *   npx tsx scripts/qa/training-edit-ui-seed.ts
 */
import { PrismaClient } from "@prisma/client";
import { workoutSourceIdentity } from "@/modules/health/workout-source-identity";

const prisma = new PrismaClient();

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.includes("localhost") && !databaseUrl.includes("127.0.0.1")) {
    throw new Error("training-edit-ui-seed refuses non-localhost DATABASE_URL");
  }

  await prisma.profile.upsert({
    where: { id: 1 },
    update: { locale: "uk" },
    create: {
      id: 1,
      sex: "male",
      dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
      heightCm: 180,
      locale: "uk",
    },
  });

  const catalog = await prisma.exerciseCatalog.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
    take: 7,
  });
  if (catalog.length < 7) {
    throw new Error(`Need ≥7 catalog exercises, found ${catalog.length}. Run migrations first.`);
  }

  const existing = await prisma.trainingProgram.findFirst({
    where: { profileId: 1, name: { in: ["Тисни", "Тисни UI Review"] }, archivedAt: null },
  });
  if (existing) {
    await prisma.strengthDiarySession.deleteMany({ where: { programId: existing.id } });
    await prisma.trainingProgram.delete({ where: { id: existing.id } });
  }

  const program = await prisma.trainingProgram.create({
    data: {
      profileId: 1,
      name: "Тисни",
      versions: {
        create: {
          versionNumber: 1,
          exercises: {
            create: catalog.map((item, index) => ({
              exerciseCatalogId: item.id,
              sortOrder: index,
              plannedSets: 3 + (index % 2),
              resistanceType: index % 3 === 0
                ? "EXTERNAL_WEIGHT"
                : index % 3 === 1
                  ? "RESISTANCE_BAND"
                  : "BODYWEIGHT",
            })),
          },
        },
      },
    },
    include: { versions: { include: { exercises: true } } },
  });
  const version = program.versions[0]!;
  await prisma.trainingProgram.update({
    where: { id: program.id },
    data: { currentVersionId: version.id },
  });

  const day = await prisma.dailyHealthData.upsert({
    where: { date: "2026-09-16" },
    update: {
      strengthTrainingMinutes: 62,
    },
    create: {
      date: "2026-09-16",
      weightKg: 88.2,
      caloriesKcal: 2400,
      proteinG: 160,
      fatG: 70,
      carbsG: 240,
      steps: 8000,
      walkingDistanceKm: 5.2,
      strengthTrainingMinutes: 62,
      rawPayload: { source: "bodycast-training-edit-ui-seed" },
    },
  });

  const startAt = new Date("2026-09-16T10:44:00.000Z");
  const endAt = new Date("2026-09-16T11:46:00.000Z");
  const externalId = "ui-review-strength-16";
  const type = "Traditional Strength Training";
  const sourceIdentity = workoutSourceIdentity({ externalId, type, startAt, endAt });

  const workout = await prisma.workout.upsert({
    where: {
      dailyHealthDataId_sourceIdentity: {
        dailyHealthDataId: day.id,
        sourceIdentity,
      },
    },
    update: {
      externalId,
      startAt,
      endAt,
      durationMinutes: 62,
      activeEnergyKcal: 562,
    },
    create: {
      dailyHealthDataId: day.id,
      externalId,
      sourceIdentity,
      type,
      startAt,
      endAt,
      durationMinutes: 62,
      activeEnergyKcal: 562,
    },
  });

  await prisma.strengthDiarySession.deleteMany({ where: { matchedWorkoutId: workout.id } });

  const session = await prisma.strengthDiarySession.create({
    data: {
      profileId: 1,
      status: "COMPLETED",
      entryMode: "RETROSPECTIVE",
      revision: 1,
      programId: program.id,
      programVersionId: version.id,
      webStartedAt: null,
      webEndedAt: null,
      matchStatus: "MATCHED",
      matchMethod: "DIRECT_BACKFILL",
      matchedAt: new Date(),
      matchedWorkoutId: workout.id,
      exercises: {
        create: version.exercises.map((exercise) => ({
          sourceExerciseCatalogId: exercise.exerciseCatalogId,
          snapshotExerciseName: catalog.find((row) => row.id === exercise.exerciseCatalogId)?.name ?? "Exercise",
          sortOrder: exercise.sortOrder,
          plannedSets: exercise.plannedSets,
          resistanceType: exercise.resistanceType,
          origin: "PLANNED",
        })),
      },
    },
  });

  console.log(JSON.stringify({
    ok: true,
    programId: program.id,
    sessionId: session.id,
    workoutId: workout.id,
    editUrl: `http://127.0.0.1:3000/training/sessions/${session.id}/edit`,
    backfillUrl: "http://127.0.0.1:3000/training/backfill",
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
