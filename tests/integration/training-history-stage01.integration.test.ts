import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPECTED_MS100_V1, EXPECTED_GOLDEN_V1 } from "../fixtures/training-history-stage01/expected-v1";
import { requireIsolatedStage01Database } from "../../src/modules/training/testing/require-isolated-database";
import {
  createTrainingHistoryStage01FixtureV1,
  TRAINING_HISTORY_STAGE01_CREATED_AT,
  TRAINING_HISTORY_STAGE01_PROFILE_ID,
} from "../fixtures/training-history-stage01/fixture-v1";

const SENTINEL_WORKOUT_ID = 15_000_001;
const SENTINEL_SOURCE_IDENTITY = "sentinel:stage01-cleanup-preservation-check";
const SENTINEL_SET_ID = 15_000_002;
const SENTINEL_PROGRAM_EXERCISE_ID = 15_000_003;
const SENTINEL_SESSION_EXERCISE_ID = 15_000_004;
const SENTINEL_PROGRAM_VERSION_ID = 15_000_005;
const SENTINEL_PROGRAM_CHANGE_ID = 15_000_006;
const SENTINEL_SUPERSEDED_WORKOUT_ID = 15_000_007;

describe("Training History Stage 01 PostgreSQL persistence", () => {
  let prisma: import("@prisma/client").PrismaClient | undefined;
  let persistence: typeof import("../../src/modules/training/testing/stage01-persistence") | undefined;
  let seededCounts: Awaited<ReturnType<NonNullable<typeof persistence>["seedStage01Namespace"]>> | undefined;

  beforeAll(async () => {
    requireIsolatedStage01Database(process.env.DATABASE_URL, process.env.BODYCAST_STAGE01_MODE, "test");
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    await prisma.$connect();
    persistence = await import("../../src/modules/training/testing/stage01-persistence");
    await persistence.cleanupStage01Namespace(prisma);
    seededCounts = await persistence.seedStage01Namespace(prisma);
  }, 60_000);

  afterAll(async () => {
    if (!prisma || !persistence) return;
    try {
      await persistence.cleanupStage01Namespace(prisma);
    } finally {
      await prisma.$disconnect();
    }
  }, 60_000);

  it("persists distinct exercise/set rows, snapshots, program versions, and runtime schema", async () => {
    const db = prisma!;
    const fixture = createTrainingHistoryStage01FixtureV1();
    expect(seededCounts).toMatchObject({
      namespace: fixture.namespace,
      profiles: 1,
      catalogExercises: fixture.catalogExercises.length,
      programs: 7,
      programVersions: 19,
      sessions: 51,
      workouts: 5,
      dailyHealthRows: 2,
    });
    expect(await db.strengthDiarySession.count({ where: { id: { in: fixture.sessions.map((row) => row.id) } } })).toBe(fixture.sessions.length);
    expect(await db.strengthSessionExercise.count({ where: { sessionId: { in: fixture.sessions.map((row) => row.id) } } })).toBe(seededCounts!.sessionExercises);
    expect(await db.strengthSet.count({ where: { sessionExercise: { sessionId: { in: fixture.sessions.map((row) => row.id) } } } })).toBe(seededCounts!.sets);
    expect(await db.programExercise.count({ where: { programVersionId: { in: fixture.programVersions.map((row) => row.id) } } })).toBe(seededCounts!.programExercises);
    expect(await db.strengthDiaryProgramChange.count({ where: { sessionId: { in: fixture.sessions.map((row) => row.id) } } })).toBe(fixture.programChanges.length);
    expect(await db.profile.findUnique({ where: { id: TRAINING_HISTORY_STAGE01_PROFILE_ID }, select: { id: true } })).toEqual({ id: TRAINING_HISTORY_STAGE01_PROFILE_ID });

    const emptyDiary = await db.strengthDiarySession.findUnique({ where: { id: fixture.sessions.find((row) => row.scenarioId === "edge-cases")!.id }, include: { exercises: true } });
    expect(emptyDiary?.entryMode).toBe("RETROSPECTIVE");
    expect(emptyDiary?.webStartedAt).toBeNull();
    expect(emptyDiary?.exercises).toHaveLength(0);
    expect(emptyDiary?.matchedWorkoutId).not.toBeNull();

    const customMapped = fixture.sessions.find((row) => row.scenarioId === "exercise-order" && row.weekNumber === 11)!.exercises.find((row) => row.snapshotStableKey === "seated_dumbbell_press" && row.stableKey === null)!;
    const persistedSnapshot = await db.strengthSessionExercise.findUnique({ where: { id: customMapped.id }, select: { muscleMappingSnapshot: true, sourceExerciseCatalogId: true, sortOrder: true } });
    expect(persistedSnapshot?.muscleMappingSnapshot).toEqual(customMapped.muscleMappingSnapshot);
    expect(persistedSnapshot?.sourceExerciseCatalogId).toBe(customMapped.sourceExerciseCatalogId);
    expect(persistedSnapshot?.sortOrder).toBe(customMapped.sortOrder);
    const catalog = await db.exerciseCatalog.findUnique({ where: { id: customMapped.sourceExerciseCatalogId }, select: { stableKey: true } });
    expect(catalog?.stableKey).toBeNull();

    const dailyRows = await db.dailyHealthData.findMany({ where: { id: { in: fixture.dailyHealthRows.map((row) => row.id) } }, orderBy: { date: "asc" } });
    expect(dailyRows.map((row) => [row.weightKg, row.steps])).toEqual([[null, 8421], [null, null]]);
    const sourceFallback = fixture.workouts.find((row) => row.scenario === "ms100-boundary" && row.externalId === null)!;
    expect(sourceFallback.sourceIdentity).toBe(EXPECTED_MS100_V1.intervals[0]!.sourceIdentity);
    expect((await db.workout.findUnique({ where: { id: sourceFallback.id }, select: { sourceIdentity: true } }))?.sourceIdentity).toBe(sourceFallback.sourceIdentity);
    const matchedPush = fixture.sessions.find((row) => row.scenarioId === "golden-push")!;
    const pushWorkout = await db.workout.findUnique({ where: { id: matchedPush.matchedWorkoutId! }, select: { externalId: true, sourceIdentity: true, type: true } });
    expect(pushWorkout).toEqual({ externalId: null, sourceIdentity: EXPECTED_GOLDEN_V1.push.sourceIdentity, type: "Traditional Strength Training" });

    const strengthSetColumns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'StrengthSet'
    `;
    const exerciseColumns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'StrengthSessionExercise'
    `;
    const setColumnNames = strengthSetColumns.map((row) => row.column_name);
    const exerciseColumnNames = exerciseColumns.map((row) => row.column_name);
    expect(setColumnNames).toEqual(expect.arrayContaining(["reps", "weightKg", "bandNominalResistanceKg", "rir"]));
    expect(setColumnNames).not.toContain("repsPerSide");
    expect(exerciseColumnNames).not.toContain("equipment");
    const migrationRows = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name
    `;
    expect(migrationRows.length).toBeGreaterThan(0);
  });

  it("deduplicates a repeated Workout source identity by the database unique key", async () => {
    const db = prisma!;
    const row = createTrainingHistoryStage01FixtureV1().workouts.find((workout) => workout.scenario === "ms100-boundary" && workout.externalId === null)!;
    const before = await db.workout.count({ where: { dailyHealthDataId: row.dailyHealthDataId } });
    const first = await db.workout.findUnique({ where: { dailyHealthDataId_sourceIdentity: { dailyHealthDataId: row.dailyHealthDataId, sourceIdentity: row.sourceIdentity } } });
    const upserted = await db.workout.upsert({
      where: { dailyHealthDataId_sourceIdentity: { dailyHealthDataId: row.dailyHealthDataId, sourceIdentity: row.sourceIdentity } },
      update: {},
      create: {
        dailyHealthDataId: row.dailyHealthDataId,
        sourceIdentity: row.sourceIdentity,
        type: row.type,
        startAt: new Date(row.startAt),
        endAt: new Date(row.endAt),
      },
    });
    expect(upserted.id).toBe(first?.id);
    expect(await db.workout.count({ where: { dailyHealthDataId: row.dailyHealthDataId } })).toBe(before);
    expect(await db.workout.count({ where: { dailyHealthDataId: row.dailyHealthDataId, sourceIdentity: row.sourceIdentity } })).toBe(1);
  });

  it("retains retrospective provenance and mapping snapshots after a set edit", async () => {
    const db = prisma!;
    const pull = createTrainingHistoryStage01FixtureV1().sessions.find((row) => row.scenarioId === "golden-pull")!;
    const before = await db.strengthDiarySession.findUnique({
      where: { id: pull.id },
      include: { matchedWorkout: true, exercises: { orderBy: { sortOrder: "asc" }, include: { sets: { orderBy: { setNumber: "asc" } } } } },
    });
    expect(before?.entryMode).toBe("RETROSPECTIVE");
    expect(before?.webStartedAt).toBeNull();
    expect(before?.matchedWorkout?.sourceIdentity).toBe("ext:stage01-golden-pull-source");
    const selectedExercise = before!.exercises[0]!;
    const snapshotBefore = JSON.stringify(selectedExercise.muscleMappingSnapshot);
    const selectedSet = selectedExercise.sets[0]!;
    try {
      await db.$transaction(async (tx) => {
        await tx.strengthSet.update({ where: { id: selectedSet.id }, data: { reps: selectedSet.reps + 1 } });
        await tx.strengthDiarySession.update({ where: { id: pull.id }, data: { revision: { increment: 1 } } });
      });
      const after = await db.strengthDiarySession.findUnique({
        where: { id: pull.id },
        include: { exercises: { where: { id: selectedExercise.id }, include: { sets: { where: { id: selectedSet.id } } } } },
      });
      expect(after?.revision).toBe(pull.revision + 1);
      expect(after?.exercises[0]?.muscleMappingSnapshot).toEqual(selectedExercise.muscleMappingSnapshot);
      expect(JSON.stringify(after?.exercises[0]?.muscleMappingSnapshot)).toBe(snapshotBefore);
      expect(after?.exercises[0]?.sets[0]?.reps).toBe(selectedSet.reps + 1);
    } finally {
      await db.$transaction(async (tx) => {
        await tx.strengthSet.update({ where: { id: selectedSet.id }, data: { reps: selectedSet.reps, updatedAt: selectedSet.updatedAt } });
        await tx.strengthDiarySession.update({ where: { id: pull.id }, data: { revision: pull.revision, updatedAt: before!.updatedAt } });
      });
    }
  });

  it("reseeds idempotently from fixed IDs without duplicating rows", async () => {
    const db = prisma!;
    const fixture = createTrainingHistoryStage01FixtureV1();
    const secondSeed = await persistence!.seedStage01Namespace(db);
    expect(secondSeed).toEqual(seededCounts);
    expect(await db.strengthDiarySession.count({ where: { id: { in: fixture.sessions.map((row) => row.id) } } })).toBe(fixture.sessions.length);
    expect(await db.workout.count({ where: { id: { in: fixture.workouts.map((row) => row.id) } } })).toBe(fixture.workouts.length);
    expect(await db.strengthSet.count({ where: { sessionExercise: { sessionId: { in: fixture.sessions.map((row) => row.id) } } } })).toBe(secondSeed.sets);
  });

  it("retains MS100 overlap and midnight boundary without diary set conversion", async () => {
    const db = prisma!;
    const ms100 = createTrainingHistoryStage01FixtureV1().workouts.filter((row) => row.scenario === "ms100-boundary");
    const rows = await db.workout.findMany({ where: { id: { in: ms100.map((row) => row.id) } }, orderBy: { startAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => ({
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      sourceIdentity: row.sourceIdentity,
      durationMinutes: row.durationMinutes,
      manualStepCount: row.manualStepCount,
    }))).toEqual(EXPECTED_MS100_V1.intervals.map((expected) => ({
      startAt: expected.startAt,
      endAt: expected.endAt,
      sourceIdentity: expected.sourceIdentity,
      durationMinutes: expected.durationMinutes,
      manualStepCount: expected.manualStepCount,
    })));
    expect(Math.min(...rows.map((row) => row.endAt.getTime())) - Math.max(...rows.map((row) => row.startAt.getTime())))
      .toBe(EXPECTED_MS100_V1.overlapMinutes * 60_000);
    const formatLocalDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bratislava" }).format(date);
    expect(formatLocalDate(rows[0]!.startAt)).toBe("2026-09-24");
    expect(formatLocalDate(rows[0]!.endAt)).toBe("2026-09-25");
    expect(rows.every((row) => row.externalId === null)).toBe(true);
    expect(rows.map((row) => row.manualStepCount === null || row.durationMinutes === null ? null : row.manualStepCount / row.durationMinutes))
      .toEqual(EXPECTED_MS100_V1.intervals.map((row) => row.cadenceStepsPerMinute));
    expect(rows.every((row) => row.energyKcal === null && row.activeEnergyKcal === null && row.manualActiveEnergyKcal === null)).toBe(true);
    expect(await db.heartRateSample.count({ where: { dailyHealthDataId: { in: ms100.map((row) => row.dailyHealthDataId) } } })).toBe(EXPECTED_MS100_V1.heartRateSamples);
    expect(await db.restingHeartRateSample.count({ where: { dailyHealthDataId: { in: ms100.map((row) => row.dailyHealthDataId) } } })).toBe(0);
    expect(await db.strengthDiarySession.count({ where: { matchedWorkoutId: { in: ms100.map((row) => row.id) } } })).toBe(0);
  });

  it("does not overwrite or delete a pre-existing default Profile during repeated seed and cleanup", async () => {
    const db = prisma!;
    await persistence!.cleanupStage01Namespace(db);
    const existing = await db.profile.findUnique({ where: { id: 1 } });
    const inserted = existing === null;
    const sentinel = existing
      ? await db.profile.update({ where: { id: 1 }, data: {
        sex: "female",
        dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
        heightCm: "170.00",
        locale: "uk",
        updatedAt: new Date("2020-01-01T00:00:00.000Z"),
      } })
      : await db.profile.create({
        data: {
          id: 1,
          sex: "female",
          dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
          heightCm: "170.00",
          locale: "uk",
          createdAt: new Date("2020-01-01T00:00:00.000Z"),
          updatedAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      });
    try {
      await persistence!.seedStage01Namespace(db);
      expect(await db.profile.findUnique({ where: { id: 1 } })).toEqual(sentinel);
      expect(await db.profile.findUnique({ where: { id: TRAINING_HISTORY_STAGE01_PROFILE_ID }, select: { id: true } }))
        .toEqual({ id: TRAINING_HISTORY_STAGE01_PROFILE_ID });
      await persistence!.seedStage01Namespace(db);
      expect(await db.profile.findUnique({ where: { id: 1 } })).toEqual(sentinel);
      await persistence!.cleanupStage01Namespace(db);
      expect(await db.profile.findUnique({ where: { id: 1 } })).toEqual(sentinel);
    } finally {
      await persistence!.cleanupStage01Namespace(db);
      if (inserted) await db.profile.delete({ where: { id: 1 } });
      else await db.profile.update({ where: { id: 1 }, data: {
        sex: existing!.sex,
        dateOfBirth: existing!.dateOfBirth,
        heightCm: existing!.heightCm,
        locale: existing!.locale,
        targetWeightKg: existing!.targetWeightKg,
        targetDate: existing!.targetDate,
        autoAdvanceExercises: existing!.autoAdvanceExercises,
        createdAt: existing!.createdAt,
        updatedAt: existing!.updatedAt,
      } });
      await persistence!.seedStage01Namespace(db);
    }
  });

  it("refuses fixed-ID parent mismatches before deleting any Stage 01 rows", async () => {
    const db = prisma!;
    const fixture = createTrainingHistoryStage01FixtureV1();
    const refuse = async (mutate: () => Promise<unknown>, restore: () => Promise<unknown>) => {
      await mutate();
      try {
        await expect(persistence!.cleanupStage01Namespace(db)).rejects.toThrow(/collision/);
      } finally {
        await restore();
      }
    };

    const workout = fixture.workouts[0]!;
    const workoutOriginal = await db.workout.findUniqueOrThrow({ where: { id: workout.id } });
    const otherDayId = fixture.dailyHealthRows.find((row) => row.id !== workout.dailyHealthDataId)!.id;
    await refuse(
      () => db.workout.update({ where: { id: workout.id }, data: { dailyHealthDataId: otherDayId } }),
      () => db.workout.update({ where: { id: workout.id }, data: { dailyHealthDataId: workoutOriginal.dailyHealthDataId, updatedAt: workoutOriginal.updatedAt } }),
    );

    const set = fixture.sessions.flatMap((session) => session.exercises.flatMap((exercise) => exercise.sets.map((row) => ({ row, exercise }))))[0]!;
    const otherExercise = fixture.sessions.flatMap((session) => session.exercises).find((exercise) => exercise.id !== set.exercise.id);
    const setOriginal = await db.strengthSet.findUniqueOrThrow({ where: { id: set.row.id } });
    await refuse(
      () => db.strengthSet.update({ where: { id: set.row.id }, data: { sessionExerciseId: otherExercise!.id, setNumber: 999 } }),
      () => db.strengthSet.update({ where: { id: set.row.id }, data: { sessionExerciseId: setOriginal.sessionExerciseId, setNumber: setOriginal.setNumber, updatedAt: setOriginal.updatedAt } }),
    );

    const planned = await db.programExercise.findFirstOrThrow({ where: { programVersionId: fixture.programVersions[0]!.id } });
    const otherVersionId = fixture.programVersions.find((row) => row.id !== planned.programVersionId)!.id;
    const plannedOriginal = { programVersionId: planned.programVersionId, sortOrder: planned.sortOrder, updatedAt: planned.updatedAt };
    await refuse(
      () => db.programExercise.update({ where: { id: planned.id }, data: { programVersionId: otherVersionId, sortOrder: 99 } }),
      () => db.programExercise.update({ where: { id: planned.id }, data: { ...plannedOriginal } }),
    );

    const sessionExercise = fixture.sessions.find((row) => row.exercises.length > 0)!.exercises[0]!;
    const sessionExerciseOriginal = await db.strengthSessionExercise.findUniqueOrThrow({ where: { id: sessionExercise.id } });
    const otherSessionId = fixture.sessions.find((row) => row.id !== sessionExerciseOriginal.sessionId)!.id;
    await refuse(
      () => db.strengthSessionExercise.update({ where: { id: sessionExercise.id }, data: { sessionId: otherSessionId, sortOrder: 99 } }),
      () => db.strengthSessionExercise.update({ where: { id: sessionExercise.id }, data: { sessionId: sessionExerciseOriginal.sessionId, sortOrder: sessionExerciseOriginal.sortOrder, updatedAt: sessionExerciseOriginal.updatedAt } }),
    );

    const version = fixture.programVersions[0]!;
    const versionOriginal = await db.trainingProgramVersion.findUniqueOrThrow({ where: { id: version.id } });
    const otherProgramId = fixture.programs.find((row) => row.id !== versionOriginal.programId)!.id;
    await refuse(
      () => db.trainingProgramVersion.update({ where: { id: version.id }, data: { programId: otherProgramId, versionNumber: 99 } }),
      () => db.trainingProgramVersion.update({ where: { id: version.id }, data: { programId: versionOriginal.programId, versionNumber: versionOriginal.versionNumber } }),
    );

    const session = fixture.sessions[0]!;
    const sessionOriginal = await db.strengthDiarySession.findUniqueOrThrow({ where: { id: session.id } });
    const otherProgram = fixture.programs.find((row) => row.id !== sessionOriginal.programId)!;
    await refuse(
      () => db.strengthDiarySession.update({ where: { id: session.id }, data: { programId: otherProgram.id, programVersionId: otherProgram.currentVersionId } }),
      () => db.strengthDiarySession.update({ where: { id: session.id }, data: { programId: sessionOriginal.programId, programVersionId: sessionOriginal.programVersionId, updatedAt: sessionOriginal.updatedAt } }),
    );

    const change = fixture.programChanges[0]!;
    const changeOriginal = await db.strengthDiaryProgramChange.findUniqueOrThrow({ where: { id: change.id } });
    const otherChangeSession = fixture.sessions.find((row) => row.id !== changeOriginal.sessionId)!.id;
    await refuse(
      () => db.strengthDiaryProgramChange.update({ where: { id: change.id }, data: { sessionId: otherChangeSession } }),
      () => db.strengthDiaryProgramChange.update({ where: { id: change.id }, data: { sessionId: changeOriginal.sessionId } }),
    );

    const day = fixture.dailyHealthRows[0]!;
    const dailyOriginal = await db.dailyHealthData.findUniqueOrThrow({ where: { id: day.id } });
    await refuse(
      () => db.dailyHealthData.update({ where: { id: day.id }, data: { rawPayload: { sentinel: "same ID, foreign payload" } } }),
      () => db.dailyHealthData.update({ where: { id: day.id }, data: { rawPayload: dailyOriginal.rawPayload as object, updatedAt: dailyOriginal.updatedAt } }),
    );

    expect(await db.strengthDiarySession.count({ where: { id: { in: fixture.sessions.map((row) => row.id) } } })).toBe(fixture.sessions.length);
    await persistence!.cleanupStage01Namespace(db);
    await persistence!.seedStage01Namespace(db);
  });

  it("refuses extra fixture-parent children before cascades and preserves each sentinel", async () => {
    const db = prisma!;
    const fixture = createTrainingHistoryStage01FixtureV1();
    const parentExercise = fixture.sessions.find((row) => row.exercises.length > 0)!.exercises[0]!;
    const parentSession = fixture.sessions.find((row) => row.exercises.some((exercise) => exercise.id === parentExercise.id))!;
    const parentVersion = fixture.programVersions[0]!;
    const unusedCatalog = fixture.catalogExercises.find((row) => !parentVersion.plannedExercises.some((exercise) => exercise.exerciseCatalogId === row.id))!;
    await db.strengthSet.create({
      data: { id: SENTINEL_SET_ID, sessionExerciseId: parentExercise.id, setNumber: 999, reps: 1, createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT), updatedAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT) },
    });
    await db.programExercise.create({
      data: { id: SENTINEL_PROGRAM_EXERCISE_ID, programVersionId: parentVersion.id, exerciseCatalogId: unusedCatalog.id, sortOrder: 99, plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT", createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT), updatedAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT) },
    });
    await db.strengthSessionExercise.create({
      data: { id: SENTINEL_SESSION_EXERCISE_ID, sessionId: parentSession.id, sourceExerciseCatalogId: unusedCatalog.id, snapshotExerciseName: "Stage 01 sentinel exercise", sortOrder: 99, plannedSets: 1, resistanceType: "EXTERNAL_WEIGHT", origin: "EXTRA", createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT), updatedAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT) },
    });
    await db.trainingProgramVersion.create({
      data: { id: SENTINEL_PROGRAM_VERSION_ID, programId: parentVersion.programId, versionNumber: 99, createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT) },
    });
    await db.strengthDiaryProgramChange.create({
      data: { id: SENTINEL_PROGRAM_CHANGE_ID, sessionId: parentSession.id, fromProgramId: parentSession.programId, fromProgramVersionId: parentSession.programVersionId, toProgramId: parentSession.programId, toProgramVersionId: parentSession.programVersionId, createdAt: new Date(TRAINING_HISTORY_STAGE01_CREATED_AT) },
    });
    const supersededWorkout = fixture.workouts[0]!;
    await db.workout.create({
      data: {
        id: SENTINEL_SUPERSEDED_WORKOUT_ID,
        dailyHealthDataId: supersededWorkout.dailyHealthDataId,
        sourceIdentity: "sentinel:stage01-superseded-workout-protection",
        type: "sentinel",
        startAt: new Date("2026-09-24T16:00:00.000Z"),
        endAt: new Date("2026-09-24T16:01:00.000Z"),
        supersededByWorkoutId: supersededWorkout.id,
      },
    });

    await expect(persistence!.cleanupStage01Namespace(db)).rejects.toThrow(/collision/);
    expect(await db.strengthSet.findUnique({ where: { id: SENTINEL_SET_ID } })).not.toBeNull();
    expect(await db.programExercise.findUnique({ where: { id: SENTINEL_PROGRAM_EXERCISE_ID } })).not.toBeNull();
    expect(await db.strengthSessionExercise.findUnique({ where: { id: SENTINEL_SESSION_EXERCISE_ID } })).not.toBeNull();
    expect(await db.trainingProgramVersion.findUnique({ where: { id: SENTINEL_PROGRAM_VERSION_ID } })).not.toBeNull();
    expect(await db.strengthDiaryProgramChange.findUnique({ where: { id: SENTINEL_PROGRAM_CHANGE_ID } })).not.toBeNull();
    expect(await db.workout.findUnique({ where: { id: SENTINEL_SUPERSEDED_WORKOUT_ID } })).not.toBeNull();

    await db.strengthSet.delete({ where: { id: SENTINEL_SET_ID } });
    await db.programExercise.delete({ where: { id: SENTINEL_PROGRAM_EXERCISE_ID } });
    await db.strengthSessionExercise.delete({ where: { id: SENTINEL_SESSION_EXERCISE_ID } });
    await db.strengthDiaryProgramChange.delete({ where: { id: SENTINEL_PROGRAM_CHANGE_ID } });
    await db.trainingProgramVersion.delete({ where: { id: SENTINEL_PROGRAM_VERSION_ID } });
    await db.workout.delete({ where: { id: SENTINEL_SUPERSEDED_WORKOUT_ID } });
    await persistence!.cleanupStage01Namespace(db);
    await persistence!.seedStage01Namespace(db);
  });

  it("cleans only the fixture namespace and preserves an unrelated sentinel", async () => {
    const db = prisma!;
    const fixture = createTrainingHistoryStage01FixtureV1();
    const dailyId = fixture.dailyHealthRows[0]!.id;
    expect(await db.workout.findUnique({ where: { id: SENTINEL_WORKOUT_ID } })).toBeNull();
    await db.workout.create({
      data: {
        id: SENTINEL_WORKOUT_ID,
        dailyHealthDataId: dailyId,
        sourceIdentity: SENTINEL_SOURCE_IDENTITY,
        type: "sentinel",
        startAt: new Date("2026-09-24T16:00:00.000Z"),
        endAt: new Date("2026-09-24T16:01:00.000Z"),
      },
    });
    const profileBeforeCleanup = await db.profile.findUnique({ where: { id: fixture.profiles[0]!.id } });
    const firstCleanup = await persistence!.cleanupStage01Namespace(db);
    expect(await db.workout.findUnique({ where: { id: SENTINEL_WORKOUT_ID }, select: { sourceIdentity: true } })).toEqual({ sourceIdentity: SENTINEL_SOURCE_IDENTITY });
    expect(await db.dailyHealthData.findUnique({ where: { id: dailyId } })).not.toBeNull();
    expect(await db.strengthDiarySession.count({ where: { id: { in: fixture.sessions.map((row) => row.id) } } })).toBe(0);
    expect(await db.profile.findUnique({ where: { id: fixture.profiles[0]!.id } })).toEqual(firstCleanup.deletedProfiles > 0 ? null : profileBeforeCleanup);
    await db.workout.delete({ where: { id: SENTINEL_WORKOUT_ID } });
    const finalCleanup = await persistence!.cleanupStage01Namespace(db);
    expect(await db.dailyHealthData.findUnique({ where: { id: dailyId } })).toBeNull();
    expect(await db.profile.findUnique({ where: { id: fixture.profiles[0]!.id } })).toEqual(finalCleanup.deletedProfiles > 0 ? null : profileBeforeCleanup);
    expect(await db.exerciseCatalog.count({ where: { stableKey: { not: null } } })).toBe(13);
  });
});
