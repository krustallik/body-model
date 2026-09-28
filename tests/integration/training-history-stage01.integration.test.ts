import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireIsolatedStage01Database } from "../../src/modules/training/testing/require-isolated-database";
import { createTrainingHistoryStage01FixtureV1 } from "../fixtures/training-history-stage01/fixture-v1";

const SENTINEL_WORKOUT_ID = 15_000_001;
const SENTINEL_SOURCE_IDENTITY = "sentinel:stage01-cleanup-preservation-check";

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
    expect(dailyRows.map((row) => [row.weightKg, row.steps])).toEqual([[null, null], [null, null]]);
    const sourceFallback = fixture.workouts.find((row) => row.externalId === null)!;
    expect(sourceFallback.sourceIdentity).toMatch(/^fp:/);
    expect((await db.workout.findUnique({ where: { id: sourceFallback.id }, select: { sourceIdentity: true } }))?.sourceIdentity).toBe(sourceFallback.sourceIdentity);

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
    const row = createTrainingHistoryStage01FixtureV1().workouts[0]!;
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
    expect(rows[0]!.startAt.getTime()).toBeLessThan(rows[1]!.startAt.getTime());
    expect(rows[1]!.startAt.getTime()).toBeLessThan(rows[0]!.endAt.getTime());
    const formatLocalDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bratislava" }).format(date);
    expect(formatLocalDate(rows[0]!.startAt)).toBe("2026-09-24");
    expect(formatLocalDate(rows[0]!.endAt)).toBe("2026-09-25");
    expect(rows.find((row) => row.manualStepCount === 100)).toBeDefined();
    expect(await db.strengthDiarySession.count({ where: { matchedWorkoutId: { in: ms100.map((row) => row.id) } } })).toBe(0);
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
    await persistence!.cleanupStage01Namespace(db);
    expect(await db.workout.findUnique({ where: { id: SENTINEL_WORKOUT_ID }, select: { sourceIdentity: true } })).toEqual({ sourceIdentity: SENTINEL_SOURCE_IDENTITY });
    expect(await db.dailyHealthData.findUnique({ where: { id: dailyId } })).not.toBeNull();
    expect(await db.strengthDiarySession.count({ where: { id: { in: fixture.sessions.map((row) => row.id) } } })).toBe(0);
    await db.workout.delete({ where: { id: SENTINEL_WORKOUT_ID } });
    await persistence!.cleanupStage01Namespace(db);
    expect(await db.dailyHealthData.findUnique({ where: { id: dailyId } })).toBeNull();
    expect(await db.profile.findUnique({ where: { id: fixture.profiles[0]!.id } })).toBeNull();
    expect(await db.exerciseCatalog.count({ where: { stableKey: { not: null } } })).toBe(13);
  });
});
