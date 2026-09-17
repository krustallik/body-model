import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaHealthSyncRepository } from "@/modules/health/health.repository";
import {
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  MATCH_METHOD,
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
} from "@/modules/training/training.constants";
import { TrainingService } from "@/modules/training/training.service";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const health = new PrismaHealthSyncRepository(prisma);
const training = new TrainingService(prisma);

const date = "2042-06-01";
const PROGRAM_A = "integration-retro-program-a";
const PROGRAM_B = "integration-retro-program-b";
const PROGRAM_BULK = "integration-retro-program-bulk";

async function clean(): Promise<void> {
  const programNames = [PROGRAM_A, PROGRAM_B, PROGRAM_BULK];
  await prisma.strengthSet.deleteMany({
    where: {
      sessionExercise: {
        session: { program: { name: { in: programNames } } },
      },
    },
  });
  await prisma.strengthDiaryProgramChange.deleteMany({
    where: { session: { program: { name: { in: programNames } } } },
  });
  await prisma.strengthSessionExercise.deleteMany({
    where: { session: { program: { name: { in: programNames } } } },
  });
  await prisma.strengthDiarySession.deleteMany({
    where: { program: { name: { in: programNames } } },
  });
  await prisma.programExercise.deleteMany({
    where: { programVersion: { program: { name: { in: programNames } } } },
  });
  await prisma.trainingProgram.updateMany({
    where: { name: { in: programNames } },
    data: { currentVersionId: null },
  });
  await prisma.trainingProgramVersion.deleteMany({
    where: { program: { name: { in: programNames } } },
  });
  await prisma.trainingProgram.deleteMany({ where: { name: { in: programNames } } });
  await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
  await deleteDailyHealthRows(prisma, date);
}

async function seedCatalogTrio() {
  const names = [
    "integration-retro-external",
    "integration-retro-band",
    "integration-retro-bodyweight",
  ];
  const rows = [];
  for (const name of names) {
    const row = await prisma.exerciseCatalog.upsert({
      where: { profileId_name: { profileId: 1, name } },
      create: { profileId: 1, name, isActive: true },
      update: { isActive: true, archivedAt: null },
    });
    rows.push(row);
  }
  return {
    external: rows[0]!,
    band: rows[1]!,
    bodyweight: rows[2]!,
  };
}

async function createProgram(
  name: string,
  exercises: Array<{
    catalogId: number;
    plannedSets: number;
    resistanceType: string;
    sortOrder: number;
  }>,
) {
  const program = await prisma.trainingProgram.create({
    data: {
      name,
      versions: {
        create: {
          versionNumber: 1,
          exercises: {
            create: exercises.map((exercise) => ({
              exerciseCatalogId: exercise.catalogId,
              sortOrder: exercise.sortOrder,
              plannedSets: exercise.plannedSets,
              resistanceType: exercise.resistanceType,
            })),
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
  return { id: program.id, versionId };
}

describe("Retrospective Training Diary with PostgreSQL", () => {
  beforeAll(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("creates retrospective diary, persists mixed sets, changes program safely, retains link when sync omits workout", async () => {
    const catalog = await seedCatalogTrio();

    await health.syncDay({
      date,
      workouts: [{
        externalId: "retro-strength-1",
        type: "Traditional Strength Training",
        startAt: "2042-06-01T17:00:00+02:00",
        endAt: "2042-06-01T18:10:00+02:00",
        activeEnergyKcal: 312,
      }],
    }, undefined, {
      timezone: "Europe/Bratislava",
      receivedAt: new Date("2042-06-01T20:00:00Z"),
      syncedAt: null,
    });

    const workoutBefore = await prisma.workout.findFirstOrThrow({
      where: { dailyHealthData: { date }, externalId: "retro-strength-1" },
    });
    const garminSnapshot = {
      id: workoutBefore.id,
      startAt: workoutBefore.startAt.toISOString(),
      endAt: workoutBefore.endAt.toISOString(),
      durationMinutes: workoutBefore.durationMinutes,
      activeEnergyKcal: workoutBefore.activeEnergyKcal,
      type: workoutBefore.type,
      externalId: workoutBefore.externalId,
      sourceIdentity: workoutBefore.sourceIdentity,
    };

    const programA = await createProgram(PROGRAM_A, [
      {
        catalogId: catalog.external.id,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        sortOrder: 0,
      },
      {
        catalogId: catalog.band.id,
        plannedSets: 3,
        resistanceType: RESISTANCE.RESISTANCE_BAND,
        sortOrder: 1,
      },
      {
        catalogId: catalog.bodyweight.id,
        plannedSets: 3,
        resistanceType: RESISTANCE.BODYWEIGHT,
        sortOrder: 2,
      },
    ]);

    const created = await training.createSessionFromWorkout({
      workoutId: workoutBefore.id,
      programId: programA.id,
    });

    expect(created.entryMode).toBe(ENTRY_MODE.RETROSPECTIVE);
    expect(created.status).toBe(SESSION_STATUS.COMPLETED);
    expect(created.matchedWorkoutId).toBe(workoutBefore.id);
    expect(created.webStartedAt).toBeNull();
    expect(created.webEndedAt).toBeNull();
    expect(created.matchStatus).toBe(MATCH_STATUS.MATCHED);
    expect(created.matchMethod).toBe(MATCH_METHOD.DIRECT_BACKFILL);
    expect(created.revision).toBe(1);

    const externalExercise = created.exercises.find(
      (exercise) => exercise.sourceExerciseCatalogId === catalog.external.id,
    );
    const bandExercise = created.exercises.find(
      (exercise) => exercise.sourceExerciseCatalogId === catalog.band.id,
    );
    const bodyExercise = created.exercises.find(
      (exercise) => exercise.sourceExerciseCatalogId === catalog.bodyweight.id,
    );
    expect(externalExercise && bandExercise && bodyExercise).toBeTruthy();

    await training.createSet(created.id, externalExercise!.id, {
      reps: 10,
      weightKg: 30,
    });
    await training.createSet(created.id, bandExercise!.id, {
      reps: 12,
      bandNominalResistanceKg: 108,
    });
    await training.createSet(created.id, bodyExercise!.id, {
      reps: 20,
    });

    const reread = await training.getSession(created.id);
    expect(reread).not.toBeNull();
    expect(reread!.revision).toBeGreaterThanOrEqual(4);
    const externalSets = reread!.exercises.find((e) => e.id === externalExercise!.id)!.sets;
    const bandSets = reread!.exercises.find((e) => e.id === bandExercise!.id)!.sets;
    const bodySets = reread!.exercises.find((e) => e.id === bodyExercise!.id)!.sets;
    expect(externalSets).toEqual([expect.objectContaining({ reps: 10, weightKg: 30 })]);
    expect(bandSets).toEqual([
      expect.objectContaining({ reps: 12, bandNominalResistanceKg: 108, weightKg: null }),
    ]);
    expect(bodySets).toEqual([
      expect.objectContaining({ reps: 20, weightKg: null, bandNominalResistanceKg: null }),
    ]);

    // Program B: keep external (same resistance), change band catalog exercise to
    // RESISTANCE_BAND→EXTERNAL_WEIGHT mismatch on same catalog id is tested via
    // renaming band exercise resistance; drop bodyweight so it becomes EXTRA;
    // add a new planned exercise.
    const programB = await createProgram(PROGRAM_B, [
      {
        catalogId: catalog.external.id,
        plannedSets: 4,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        sortOrder: 0,
      },
      {
        catalogId: catalog.band.id,
        plannedSets: 3,
        // Same catalog as recorded band sets, different resistance → no silent conversion.
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        sortOrder: 1,
      },
    ]);
    // Bodyweight omitted from Program B so its recorded sets survive as EXTRA.
    const revisionBeforeChange = reread!.revision;
    const changed = await training.changeSessionProgram(created.id, {
      programId: programB.id,
      programVersionId: programB.versionId,
    });

    expect(changed.programId).toBe(programB.id);
    expect(changed.revision).toBeGreaterThan(revisionBeforeChange);

    const keptExternal = changed.exercises.find(
      (exercise) =>
        exercise.sourceExerciseCatalogId === catalog.external.id
        && exercise.resistanceType === RESISTANCE.EXTERNAL_WEIGHT
        && exercise.origin === EXERCISE_ORIGIN.PLANNED,
    );
    expect(keptExternal?.sets).toEqual([
      expect.objectContaining({ reps: 10, weightKg: 30 }),
    ]);

    const orphanBand = changed.exercises.find(
      (exercise) =>
        exercise.sourceExerciseCatalogId === catalog.band.id
        && exercise.resistanceType === RESISTANCE.RESISTANCE_BAND
        && exercise.origin === EXERCISE_ORIGIN.EXTRA,
    );
    expect(orphanBand?.sets).toEqual([
      expect.objectContaining({ reps: 12, bandNominalResistanceKg: 108, weightKg: null }),
    ]);

    const plannedBandMismatch = changed.exercises.find(
      (exercise) =>
        exercise.sourceExerciseCatalogId === catalog.band.id
        && exercise.resistanceType === RESISTANCE.EXTERNAL_WEIGHT
        && exercise.origin === EXERCISE_ORIGIN.PLANNED,
    );
    expect(plannedBandMismatch?.sets).toEqual([]);

    const orphanBody = changed.exercises.find(
      (exercise) =>
        exercise.sourceExerciseCatalogId === catalog.bodyweight.id
        && exercise.origin === EXERCISE_ORIGIN.EXTRA,
    );
    expect(orphanBody?.sets).toEqual([
      expect.objectContaining({ reps: 20 }),
    ]);

    const audit = await prisma.strengthDiaryProgramChange.findMany({
      where: { sessionId: created.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      fromProgramId: programA.id,
      fromProgramVersionId: programA.versionId,
      toProgramId: programB.id,
      toProgramVersionId: programB.versionId,
    });

    const workoutAfterDiary = await prisma.workout.findUniqueOrThrow({
      where: { id: garminSnapshot.id },
    });
    expect(workoutAfterDiary.startAt.toISOString()).toBe(garminSnapshot.startAt);
    expect(workoutAfterDiary.endAt.toISOString()).toBe(garminSnapshot.endAt);
    expect(workoutAfterDiary.durationMinutes).toBe(garminSnapshot.durationMinutes);
    expect(workoutAfterDiary.activeEnergyKcal).toBe(garminSnapshot.activeEnergyKcal);
    expect(workoutAfterDiary.type).toBe(garminSnapshot.type);
    expect(workoutAfterDiary.externalId).toBe(garminSnapshot.externalId);
    expect(workoutAfterDiary.sourceIdentity).toBe(garminSnapshot.sourceIdentity);

    // Authoritative sync omits the linked historical workout → retain + keep link.
    await health.syncDay({
      date,
      workouts: [{
        externalId: "other-strength-same-day",
        type: "Traditional Strength Training",
        startAt: "2042-06-01T10:00:00+02:00",
        endAt: "2042-06-01T11:00:00+02:00",
        activeEnergyKcal: 180,
      }],
    }, undefined, {
      timezone: "Europe/Bratislava",
      receivedAt: new Date("2042-06-01T21:00:00Z"),
      syncedAt: null,
    });

    const retained = await prisma.workout.findUnique({ where: { id: garminSnapshot.id } });
    expect(retained).not.toBeNull();
    expect(retained!.startAt.toISOString()).toBe(garminSnapshot.startAt);
    expect(retained!.endAt.toISOString()).toBe(garminSnapshot.endAt);
    expect(retained!.durationMinutes).toBe(garminSnapshot.durationMinutes);
    expect(retained!.activeEnergyKcal).toBe(garminSnapshot.activeEnergyKcal);

    const linkedSession = await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(linkedSession.matchedWorkoutId).toBe(garminSnapshot.id);
    expect(linkedSession.matchMethod).toBe(MATCH_METHOD.DIRECT_BACKFILL);
    expect(linkedSession.entryMode).toBe(ENTRY_MODE.RETROSPECTIVE);
  });

  it("bulk create-from-workouts is idempotent per Workout and mixes created/existing safely", async () => {
    const catalog = await seedCatalogTrio();
    const program = await createProgram(PROGRAM_BULK, [
      {
        catalogId: catalog.external.id,
        plannedSets: 2,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        sortOrder: 0,
      },
    ]);

    await health.syncDay({
      date,
      workouts: [
        {
          externalId: "retro-bulk-1",
          type: "Traditional Strength Training",
          startAt: "2042-06-01T07:00:00+02:00",
          endAt: "2042-06-01T08:00:00+02:00",
          activeEnergyKcal: 200,
        },
        {
          externalId: "retro-bulk-2",
          type: "Traditional Strength Training",
          startAt: "2042-06-01T09:00:00+02:00",
          endAt: "2042-06-01T10:00:00+02:00",
          activeEnergyKcal: 210,
        },
        {
          externalId: "retro-bulk-3",
          type: "Traditional Strength Training",
          startAt: "2042-06-01T11:00:00+02:00",
          endAt: "2042-06-01T12:00:00+02:00",
          activeEnergyKcal: 220,
        },
      ],
    }, undefined, {
      timezone: "Europe/Bratislava",
      receivedAt: new Date("2042-06-01T22:00:00Z"),
      syncedAt: null,
    });

    const workouts = await prisma.workout.findMany({
      where: {
        dailyHealthData: { date },
        externalId: { in: ["retro-bulk-1", "retro-bulk-2", "retro-bulk-3"] },
      },
      orderBy: { startAt: "asc" },
    });
    expect(workouts).toHaveLength(3);
    const [w1, w2, w3] = workouts;

    // Seed one already-linked diary for w1.
    const first = await training.createSessionFromWorkout({
      workoutId: w1!.id,
      programId: program.id,
    });

    const bulk = await training.bulkCreateSessionsFromWorkouts({
      workoutIds: [w1!.id, w2!.id, w3!.id],
      programId: program.id,
    });

    /**
     * Bulk semantics (documented by this integration contract):
     * - Processed sequentially per unique workoutId (not one all-or-nothing DB txn).
     * - Already-linked workout → return existing session; listed in existingSessionIds.
     * - New eligible workout → create RETROSPECTIVE COMPLETED diary; listed in createdSessionIds.
     * - Domain TrainingError for one id → recorded in rejected[]; other ids continue.
     * - Each successful create is independently durable (no rollback of earlier creates
     *   if a later id fails). Partial success is intentional, not corrupt state:
     *   every created row remains a valid 1:1 matched retrospective session.
     * - Repeated identical request creates zero additional sessions (idempotent).
     * - DB unique(matchedWorkoutId) enforces one diary per Workout.
     */
    expect(bulk.existingSessionIds).toEqual([first.id]);
    expect(bulk.createdSessionIds).toHaveLength(2);
    expect(bulk.rejected).toEqual([]);
    expect(new Set(bulk.sessions.map((session) => session.matchedWorkoutId))).toEqual(
      new Set([w1!.id, w2!.id, w3!.id]),
    );

    const repeat = await training.bulkCreateSessionsFromWorkouts({
      workoutIds: [w1!.id, w2!.id, w3!.id],
      programId: program.id,
    });
    expect(repeat.createdSessionIds).toEqual([]);
    expect(repeat.existingSessionIds.sort()).toEqual(
      [...bulk.sessions.map((session) => session.id)].sort(),
    );
    expect(repeat.rejected).toEqual([]);

    const diaryCount = await prisma.strengthDiarySession.count({
      where: { matchedWorkoutId: { in: [w1!.id, w2!.id, w3!.id] } },
    });
    expect(diaryCount).toBe(3);

    const linkedTwice = await training.bulkCreateSessionsFromWorkouts({
      workoutIds: [w2!.id, w2!.id],
      programId: program.id,
    });
    expect(linkedTwice.sessions).toHaveLength(1);
    expect(linkedTwice.createdSessionIds).toEqual([]);
    expect(
      await prisma.strengthDiarySession.count({ where: { matchedWorkoutId: w2!.id } }),
    ).toBe(1);
  });
});
