import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaHealthSyncRepository } from "@/modules/health/health.repository";
import { workoutSourceIdentity } from "@/modules/health/workout-source-identity";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const repository = new PrismaHealthSyncRepository(prisma);
const date = "2041-03-15";

async function clean(): Promise<void> {
  await prisma.strengthSet.deleteMany({
    where: { sessionExercise: { session: { webStartedAt: { gte: new Date(`${date}T00:00:00Z`) } } } },
  });
  await prisma.strengthSessionExercise.deleteMany({
    where: { session: { webStartedAt: { gte: new Date(`${date}T00:00:00Z`) } } },
  });
  await prisma.strengthDiarySession.deleteMany({
    where: { webStartedAt: { gte: new Date(`${date}T00:00:00Z`) } },
  });
  await prisma.programExercise.deleteMany({
    where: { programVersion: { program: { name: "integration-reconcile-program" } } },
  });
  await prisma.trainingProgram.updateMany({
    where: { name: "integration-reconcile-program" },
    data: { currentVersionId: null },
  });
  await prisma.trainingProgramVersion.deleteMany({
    where: { program: { name: "integration-reconcile-program" } },
  });
  await prisma.trainingProgram.deleteMany({ where: { name: "integration-reconcile-program" } });
  await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
  await deleteDailyHealthRows(prisma, date);
}

describe("Workout stable reconciliation with PostgreSQL", () => {
  beforeAll(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("preserves Workout.id on repeat sync and field updates", async () => {
    await repository.syncDay({
      date,
      workouts: [{
        externalId: "stable-strength-1",
        type: "Traditional Strength Training",
        startAt: "2041-03-15T17:00:00+01:00",
        endAt: "2041-03-15T18:00:00+01:00",
        activeEnergyKcal: 300,
      }],
    }, undefined, {
      timezone: "Europe/Bratislava",
      receivedAt: new Date("2041-03-15T20:00:00Z"),
      syncedAt: null,
    });

    const first = await prisma.workout.findFirstOrThrow({
      where: { dailyHealthData: { date }, externalId: "stable-strength-1" },
    });
    expect(first.sourceIdentity).toBe("ext:stable-strength-1");

    await repository.syncDay({
      date,
      workouts: [{
        externalId: "stable-strength-1",
        type: "Traditional Strength Training",
        startAt: "2041-03-15T17:00:00+01:00",
        endAt: "2041-03-15T18:05:00+01:00",
        activeEnergyKcal: 340,
      }],
    }, undefined, {
      timezone: "Europe/Bratislava",
      receivedAt: new Date("2041-03-15T20:05:00Z"),
      syncedAt: null,
    });

    const second = await prisma.workout.findFirstOrThrow({
      where: { dailyHealthData: { date }, externalId: "stable-strength-1" },
    });
    expect(second.id).toBe(first.id);
    expect(second.activeEnergyKcal).toBe(340);
    expect(second.endAt.toISOString()).toBe("2041-03-15T17:05:00.000Z");
  });

  it("deletes unmatched workouts missing from the next authoritative feed", async () => {
    await repository.syncDay({
      date,
      workouts: [
        {
          externalId: "stable-strength-1",
          type: "Traditional Strength Training",
          startAt: "2041-03-15T17:00:00+01:00",
          endAt: "2041-03-15T18:05:00+01:00",
          activeEnergyKcal: 340,
        },
        {
          externalId: "unlinked-stair",
          type: "Stair Climbing",
          startAt: "2041-03-15T08:00:00+01:00",
          endAt: "2041-03-15T08:20:00+01:00",
          activeEnergyKcal: 120,
        },
      ],
    }, undefined, {
      timezone: "Europe/Bratislava",
      receivedAt: new Date("2041-03-15T20:10:00Z"),
      syncedAt: null,
    });

    await repository.syncDay({
      date,
      workouts: [{
        externalId: "stable-strength-1",
        type: "Traditional Strength Training",
        startAt: "2041-03-15T17:00:00+01:00",
        endAt: "2041-03-15T18:05:00+01:00",
        activeEnergyKcal: 340,
      }],
    }, undefined, {
      timezone: "Europe/Bratislava",
      receivedAt: new Date("2041-03-15T20:15:00Z"),
      syncedAt: null,
    });

    const remaining = await prisma.workout.findMany({
      where: { dailyHealthData: { date } },
      orderBy: { startAt: "asc" },
    });
    expect(remaining.map((row) => row.externalId)).toEqual(["stable-strength-1"]);
  });

  it("keeps diary-linked workouts missing from feed without reassociating", async () => {
    const linked = await prisma.workout.findFirstOrThrow({
      where: { dailyHealthData: { date }, externalId: "stable-strength-1" },
    });

    const catalog = await prisma.exerciseCatalog.findFirstOrThrow({
      where: { isActive: true },
    });
    const program = await prisma.trainingProgram.create({
      data: {
        name: "integration-reconcile-program",
        versions: {
          create: {
            versionNumber: 1,
            exercises: {
              create: [{
                exerciseCatalogId: catalog.id,
                sortOrder: 0,
                plannedSets: 3,
                resistanceType: "EXTERNAL_WEIGHT",
              }],
            },
          },
        },
      },
      include: { versions: true },
    });
    const versionId = program.versions[0]!.id;
    await prisma.trainingProgram.update({
      where: { id: program.id },
      data: { currentVersionId: versionId },
    });

    const session = await prisma.strengthDiarySession.create({
      data: {
        programId: program.id,
        programVersionId: versionId,
        status: "COMPLETED",
        webStartedAt: new Date("2041-03-15T17:00:00+01:00"),
        webEndedAt: new Date("2041-03-15T18:05:00+01:00"),
        matchedWorkoutId: linked.id,
        matchStatus: "MATCHED",
        matchMethod: "MANUAL",
        matchedAt: new Date("2041-03-15T20:20:00Z"),
        exercises: {
          create: [{
            sourceExerciseCatalogId: catalog.id,
            snapshotExerciseName: catalog.name,
            sortOrder: 0,
            plannedSets: 3,
            resistanceType: "EXTERNAL_WEIGHT",
          }],
        },
      },
    });

    // Authoritative feed no longer includes the previously linked strength workout.
    await repository.syncDay({
      date,
      workouts: [{
        externalId: "other-strength-same-day",
        type: "Traditional Strength Training",
        startAt: "2041-03-15T10:00:00+01:00",
        endAt: "2041-03-15T11:00:00+01:00",
        activeEnergyKcal: 200,
      }],
    }, undefined, {
      timezone: "Europe/Bratislava",
      receivedAt: new Date("2041-03-15T20:25:00Z"),
      syncedAt: null,
    });

    const retained = await prisma.workout.findUnique({ where: { id: linked.id } });
    expect(retained).not.toBeNull();
    expect(retained?.externalId).toBe("stable-strength-1");
    expect(retained?.sourceIdentity).toBe(workoutSourceIdentity({
      externalId: "stable-strength-1",
      type: "Traditional Strength Training",
      startAt: linked.startAt,
      endAt: linked.endAt,
    }));

    const refreshedSession = await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(refreshedSession.matchedWorkoutId).toBe(linked.id);
    expect(refreshedSession.matchMethod).toBe("MANUAL");

    const other = await prisma.workout.findFirstOrThrow({
      where: { dailyHealthData: { date }, externalId: "other-strength-same-day" },
    });
    expect(other.id).not.toBe(linked.id);
  });

  it("scopes sourceIdentity uniqueness per dailyHealthDataId, not globally", async () => {
    const otherDate = "2041-03-16";
    await prisma.healthSyncSnapshot.deleteMany({ where: { date: otherDate } });
    await deleteDailyHealthRows(prisma, otherDate);

    await repository.syncDay({
      date: otherDate,
      workouts: [{
        externalId: "stable-strength-1",
        type: "Traditional Strength Training",
        startAt: "2041-03-16T17:00:00+01:00",
        endAt: "2041-03-16T18:00:00+01:00",
        activeEnergyKcal: 250,
      }],
    }, undefined, {
      timezone: "Europe/Bratislava",
      receivedAt: new Date("2041-03-16T20:00:00Z"),
      syncedAt: null,
    });

    const sameIdentityDifferentDays = await prisma.workout.findMany({
      where: { sourceIdentity: "ext:stable-strength-1" },
      include: { dailyHealthData: { select: { date: true } } },
      orderBy: { startAt: "asc" },
    });
    expect(sameIdentityDifferentDays.map((row) => row.dailyHealthData.date).sort()).toEqual([
      date,
      otherDate,
    ]);

    await prisma.healthSyncSnapshot.deleteMany({ where: { date: otherDate } });
    await deleteDailyHealthRows(prisma, otherDate);
  });
});
