import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";
import { randomUUID } from "node:crypto";

// Guard before importing modules that initialize the application Prisma singleton.
const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.DATABASE_URL);
process.env.DATABASE_URL = databaseUrl;

const { prisma } = await import("@/lib/db/prisma");
const { TrainingRepository } = await import("@/modules/training/training.repository");
const { TrainingService } = await import("@/modules/training/training.service");
const { enqueueTrainingSourceChangeInTransaction } = await import("@/modules/training/training-refresh-queue");
const { RESISTANCE } = await import("@/modules/training/training.constants");
const { sha256Canonical } = await import("@/modules/training/persisted-load-accounting-v1");
const profileId = 1;
const repository = new TrainingRepository(prisma);
const failedPublication = vi.fn(async () => { throw new Error("injected dependent refresh failure"); });
const training = new TrainingService(prisma, repository, failedPublication);
let sessionId: number | null = null;
let profileCreated = false;

describe("Training post-commit publication recovery on isolated PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const databaseIdentity = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const expectedDatabase = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    if (databaseIdentity[0]?.current_database !== expectedDatabase) {
      throw new Error("Application Prisma singleton is not connected to the guarded test database.");
    }
    const existingProfile = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true } });
    if (!existingProfile) {
      await prisma.profile.create({
        data: {
          id: profileId,
          sex: "female",
          dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
          heightCm: 170,
        },
      });
      profileCreated = true;
    } else if (await prisma.strengthDiarySession.count({ where: { profileId, status: "ACTIVE" } }) > 0) {
      throw new Error("The isolated test database has an active profile session; refusing to mutate it.");
    }
  });

  afterAll(async () => {
    if (sessionId !== null) {
      await prisma.strengthDiarySession.deleteMany({ where: { id: sessionId, profileId } });
    }
    if (profileCreated) {
      await prisma.$transaction([
        prisma.trainingSourceChange.deleteMany({ where: { profileId } }),
        prisma.trainingSetCreateOperation.deleteMany({ where: { profileId } }),
        prisma.profile.deleteMany({ where: { id: profileId } }),
      ]);
    }
    await prisma.$disconnect();
  });

  it("commits finish and completed-set edits while persisting durable dependent work", async () => {
    const session = await training.startDynamicSession(profileId, "Europe/Bratislava");
    sessionId = session.id;
    const exercise = await prisma.strengthSessionExercise.create({
      data: {
        sessionId: session.id,
        snapshotExerciseName: "Synthetic pull-up",
        sortOrder: 0,
        plannedSets: 0,
        resistanceType: "BODYWEIGHT",
        origin: "EXTRA",
      },
    });
    const created = await training.createSet(session.id, exercise.id, {
      reps: 10,
      loadAccountingOverride: { additionalLoadKg: 15 },
    }, profileId);
    const original = await prisma.strengthSet.findUniqueOrThrow({ where: { id: created.id } });

    const finished = await training.finishSession(session.id, profileId);
    expect(finished.status).toBe("COMPLETED");
    const queuedAfterFinish = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
    expect(queuedAfterFinish.requestedGeneration).toBeGreaterThan(queuedAfterFinish.completedGeneration);
    expect(await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: session.id }, select: { status: true, webEndedAt: true },
    })).toMatchObject({ status: "COMPLETED" });
    const persistedAfterFinish = await prisma.strengthSet.findUniqueOrThrow({ where: { id: created.id } });
    expect(persistedAfterFinish.loadAccountingOverride).toEqual({ additionalLoadKg: 15 });
    expect(persistedAfterFinish.completedAt).toEqual(original.completedAt);
    expect(await prisma.strengthSessionAccountingOperation.count({ where: { sessionId: session.id } })).toBeGreaterThan(0);

    failedPublication.mockClear();
    const pastDueAt = new Date(Date.now() - 60_000);
    await prisma.trainingRefreshJob.update({ where: { profileId }, data: { dueAt: pastDueAt } });
    const edited = await training.updateSet(session.id, created.id, {
      reps: 11,
      rir: 3,
      comment: "synthetic edit",
    }, profileId);
    expect(edited).toMatchObject({
      reps: 11,
      rir: 3,
      comment: "synthetic edit",
      loadAccountingOverride: { additionalLoadKg: 15 },
      completedAt: original.completedAt?.toISOString() ?? null,
    });
    const persistedAfterEdit = await prisma.strengthSet.findUniqueOrThrow({ where: { id: created.id } });
    expect(persistedAfterEdit).toMatchObject({ reps: 11, rir: 3, comment: "synthetic edit" });
    expect(persistedAfterEdit.loadAccountingOverride).toEqual({ additionalLoadKg: 15 });
    expect(persistedAfterEdit.completedAt).toEqual(original.completedAt);
    expect(failedPublication).not.toHaveBeenCalled();
    const queuedAfterEdit = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
    expect(queuedAfterEdit.requestedGeneration).toBeGreaterThan(queuedAfterFinish.requestedGeneration);
    expect(queuedAfterEdit.dueAt?.getTime()).toBeGreaterThan(pastDueAt.getTime() + 110_000);

    const operationId = randomUUID();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION public.test_pause_training_operation_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(1.2);
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_pause_training_operation_insert
      BEFORE INSERT ON "TrainingSetCreateOperation"
      FOR EACH ROW EXECUTE FUNCTION public.test_pause_training_operation_insert()
    `);
    try {
      const original = training.createSet(session.id, exercise.id, {
        reps: 8,
        loadAccountingOverride: { additionalLoadKg: 15 },
      }, profileId, operationId);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await training.getSetCreateOperation(operationId, profileId)).toEqual({ state: "NOT_FOUND" });
      const concurrentRetry = training.createSet(session.id, exercise.id, {
        reps: 8,
        loadAccountingOverride: { additionalLoadKg: 15 },
      }, profileId, operationId);
      const [originalSet, retriedSet] = await Promise.all([original, concurrentRetry]);
      expect(retriedSet.id).toBe(originalSet.id);
      expect(await prisma.trainingSetCreateOperation.count({ where: { profileId, operationId } })).toBe(1);
      expect(await prisma.strengthSet.count({
        where: { sessionExerciseId: exercise.id, reps: 8 },
      })).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_pause_training_operation_insert ON "TrainingSetCreateOperation"');
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS public.test_pause_training_operation_insert()");
    }

    const rejectedOperationId = randomUUID();
    const rejectedInput = { reps: 4, comment: rejectedOperationId };
    const rejectedDigest = sha256Canonical({
      version: 1,
      sessionId: session.id,
      exerciseId: exercise.id,
      requestedSetNumber: null,
      reps: rejectedInput.reps,
      weightKg: null,
      bandNominalResistanceKg: null,
      rir: null,
      comment: rejectedInput.comment,
      completedAt: null,
      loadAccountingOverride: null,
    });
    const rejected = await repository.createSet({
      profileId,
      operationId: rejectedOperationId,
      payloadDigest: rejectedDigest,
      sessionId: session.id,
      sessionExerciseId: exercise.id,
      expectedResistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      reps: rejectedInput.reps,
      weightKg: null,
      bandNominalResistanceKg: null,
      rir: null,
      comment: rejectedInput.comment,
      completedAt: new Date(),
      loadAccountingOverride: null,
    });
    expect(rejected).toEqual({ state: "REJECTED" });
    expect(await prisma.trainingSetCreateOperation.findUniqueOrThrow({
      where: { profileId_operationId: { profileId, operationId: rejectedOperationId } },
      select: { state: true, canonicalSetId: true },
    })).toEqual({ state: "REJECTED", canonicalSetId: null });
    const rejectedRetries = await Promise.allSettled([
      training.createSet(session.id, exercise.id, rejectedInput, profileId, rejectedOperationId),
      training.createSet(session.id, exercise.id, rejectedInput, profileId, rejectedOperationId),
    ]);
    expect(rejectedRetries.every((result) => result.status === "rejected")).toBe(true);
    expect(await prisma.strengthSet.count({
      where: { sessionExerciseId: exercise.id, comment: rejectedOperationId },
    })).toBe(0);
    expect(await training.getSetCreateOperation(rejectedOperationId, profileId)).toEqual({ state: "REJECTED" });

    const validationExercise = await prisma.strengthSessionExercise.create({
      data: {
        sessionId: session.id,
        snapshotExerciseName: "Synthetic validation transition",
        sortOrder: 20,
        plannedSets: 0,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: "EXTRA",
      },
    });
    const validationOperationId = randomUUID();
    const contextuallyInvalidInput = { reps: 3, weightKg: 12, comment: validationOperationId };
    await expect(training.createSet(
      session.id, validationExercise.id, contextuallyInvalidInput, profileId, validationOperationId,
    )).rejects.toThrow();
    expect(await prisma.trainingSetCreateOperation.findUniqueOrThrow({
      where: { profileId_operationId: { profileId, operationId: validationOperationId } },
      select: { state: true },
    })).toEqual({ state: "REJECTED" });
    await prisma.strengthSessionExercise.update({
      where: { id: validationExercise.id },
      data: { resistanceType: RESISTANCE.EXTERNAL_WEIGHT },
    });
    await expect(training.createSet(
      session.id, validationExercise.id, contextuallyInvalidInput, profileId, validationOperationId,
    )).rejects.toMatchObject({ code: "training_concurrent_mutation" });
    expect(await prisma.strengthSet.count({
      where: { sessionExerciseId: validationExercise.id, comment: validationOperationId },
    })).toBe(0);

    const [intentA, intentB] = await Promise.all([
      training.createSet(session.id, exercise.id, { reps: 7, loadAccountingOverride: { additionalLoadKg: 15 } }, profileId, randomUUID()),
      training.createSet(session.id, exercise.id, { reps: 7, loadAccountingOverride: { additionalLoadKg: 15 } }, profileId, randomUUID()),
    ]);
    expect(intentA.id).not.toBe(intentB.id);
    expect(await prisma.strengthSet.count({ where: { sessionExerciseId: exercise.id, reps: 7 } })).toBe(2);

    const tombstoneOperationId = randomUUID();
    const tombstonedSet = await training.createSet(session.id, exercise.id, {
      reps: 6,
      loadAccountingOverride: { additionalLoadKg: 15 },
    }, profileId, tombstoneOperationId);
    await training.deleteSet(session.id, tombstonedSet.id, profileId);
    await expect(training.createSet(session.id, exercise.id, {
      reps: 6,
      loadAccountingOverride: { additionalLoadKg: 15 },
    }, profileId, tombstoneOperationId)).rejects.toThrow();
    expect(await prisma.trainingSetCreateOperation.findUniqueOrThrow({
      where: { profileId_operationId: { profileId, operationId: tombstoneOperationId } },
      select: { state: true, canonicalSetId: true },
    })).toEqual({ state: "TOMBSTONED", canonicalSetId: tombstonedSet.id });
  });

  it("rolls back source, invalidation, enqueue, journal, and ledger when final acknowledgement fails", async () => {
    if (sessionId === null) throw new Error("The preceding isolated session fixture is required.");
    const exercise = await prisma.strengthSessionExercise.findFirstOrThrow({ where: { sessionId } });
    const operationId = randomUUID();
    const beforeJob = await prisma.trainingRefreshJob.findUnique({ where: { profileId }, select: { requestedGeneration: true } });
    const beforeSession = await prisma.strengthDiarySession.findUniqueOrThrow({
      where: { id: sessionId }, select: { accountingInputRevision: true, currentSnapshotRevision: true },
    });
    const beforeJournalCount = await prisma.trainingSourceChange.count({ where: { profileId } });
    const beforeLifecycle = await prisma.physiologyV7Lifecycle.findUnique({
      where: { profileId },
      select: {
        staleFromDate: true,
        invalidationGeneration: true,
        currentThroughDate: true,
        productionStaleFromDate: true,
        productionPublishedGeneration: true,
        unifiedPublicationBlockedFromDate: true,
        unifiedPublicationBlockedSource: true,
      },
    });
    const beforePublicationBlocks = await prisma.unifiedPublicationBlock.findMany({
      where: { profileId }, orderBy: [{ source: "asc" }, { sourceKey: "asc" }],
    });
    const beforeActiveEnergy = await prisma.activeEnergyCanonicalEvent.findMany({
      where: { profileId }, orderBy: { id: "asc" }, select: { id: true, isStale: true, updatedAt: true },
    });
    await prisma.$executeRawUnsafe("CREATE SEQUENCE public.test_training_operation_attempts START WITH 1");
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION public.test_fail_first_training_operation_commit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF nextval('public.test_training_operation_attempts') = 1 THEN
          RAISE EXCEPTION 'injected final ledger acknowledgement failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_first_training_operation_commit
      BEFORE UPDATE ON "TrainingSetCreateOperation"
      FOR EACH ROW WHEN (NEW.state = 'COMMITTED')
      EXECUTE FUNCTION public.test_fail_first_training_operation_commit()
    `);
    try {
      await expect(training.createSet(sessionId, exercise.id, { reps: 5, comment: operationId }, profileId, operationId)).rejects.toThrow();
      expect(await prisma.trainingSetCreateOperation.count({ where: { profileId, operationId } })).toBe(0);
      expect(await prisma.strengthSet.count({ where: { sessionExerciseId: exercise.id, comment: operationId } })).toBe(0);
      const afterSession = await prisma.strengthDiarySession.findUniqueOrThrow({
        where: { id: sessionId }, select: { accountingInputRevision: true, currentSnapshotRevision: true },
      });
      expect(afterSession).toEqual(beforeSession);
      const afterJob = await prisma.trainingRefreshJob.findUnique({ where: { profileId }, select: { requestedGeneration: true } });
      expect(afterJob?.requestedGeneration).toBe(beforeJob?.requestedGeneration);
      expect(await prisma.trainingSourceChange.count({ where: { profileId } })).toBe(beforeJournalCount);
      expect(await prisma.physiologyV7Lifecycle.findUnique({
        where: { profileId },
        select: {
          staleFromDate: true,
          invalidationGeneration: true,
          currentThroughDate: true,
          productionStaleFromDate: true,
          productionPublishedGeneration: true,
          unifiedPublicationBlockedFromDate: true,
          unifiedPublicationBlockedSource: true,
        },
      })).toEqual(beforeLifecycle);
      expect(await prisma.unifiedPublicationBlock.findMany({
        where: { profileId }, orderBy: [{ source: "asc" }, { sourceKey: "asc" }],
      })).toEqual(beforePublicationBlocks);
      expect(await prisma.activeEnergyCanonicalEvent.findMany({
        where: { profileId }, orderBy: { id: "asc" }, select: { id: true, isStale: true, updatedAt: true },
      })).toEqual(beforeActiveEnergy);

      const retry = await training.createSet(sessionId, exercise.id, { reps: 5, comment: operationId }, profileId, operationId);
      expect(await prisma.strengthSet.findUniqueOrThrow({ where: { id: retry.id }, select: { reps: true, comment: true } })).toEqual({ reps: 5, comment: operationId });
      expect(await prisma.trainingSetCreateOperation.count({ where: { profileId, operationId } })).toBe(1);
      expect(await prisma.trainingSourceChange.count({ where: { profileId } })).toBe(beforeJournalCount + 1);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_first_training_operation_commit ON "TrainingSetCreateOperation"');
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS public.test_fail_first_training_operation_commit()");
      await prisma.$executeRawUnsafe("DROP SEQUENCE IF EXISTS public.test_training_operation_attempts");
    }
  });

  it("rejects an exercise edit prepared before a concurrent set source revision", async () => {
    if (sessionId === null) throw new Error("The preceding isolated session fixture is required.");
    const before = await repository.findSessionForEdit(sessionId, profileId);
    if (!before) throw new Error("Session fixture disappeared.");
    const exercise = before.exercises[0];
    await training.createSet(sessionId, exercise.id, { reps: 4, comment: `revision-race-${randomUUID()}` }, profileId, randomUUID());
    const alternate = exercise.resistanceType === RESISTANCE.RESISTANCE_BAND
      ? RESISTANCE.EXTERNAL_WEIGHT
      : RESISTANCE.RESISTANCE_BAND;
    await expect(repository.updateSessionExercise({
      sessionId, exerciseId: exercise.id, resistanceType: alternate,
      expectedAccountingInputRevision: before.accountingInputRevision,
      orderedExerciseIds: before.exercises.map(({ id }) => id),
    })).rejects.toThrow("Training inputs changed while this request was being prepared");
    const after = await repository.findSessionExerciseDetail(sessionId, exercise.id, profileId);
    expect(after?.resistanceType).toBe(exercise.resistanceType);
  });

  it("durably rejects a create key when resistance validation used a stale type", async () => {
    if (sessionId === null) throw new Error("The preceding isolated session fixture is required.");
    const exercise = await repository.findSessionExercise(sessionId, (await repository.findSessionForEdit(sessionId, profileId))!.exercises[0].id, profileId);
    if (!exercise) throw new Error("Exercise fixture disappeared.");
    const alternate = exercise.resistanceType === RESISTANCE.RESISTANCE_BAND
      ? RESISTANCE.EXTERNAL_WEIGHT
      : RESISTANCE.RESISTANCE_BAND;
    await training.updateSessionExercise(sessionId, exercise.id, { resistanceType: alternate, confirmResistanceChange: true }, profileId);
    const operationId = randomUUID();
    const setCountBefore = await prisma.strengthSet.count({ where: { sessionExerciseId: exercise.id } });
    const rejected = await repository.createSet({
      profileId, operationId, payloadDigest: "a".repeat(64), sessionId,
      sessionExerciseId: exercise.id, expectedResistanceType: exercise.resistanceType as typeof alternate,
      reps: 5, weightKg: null, bandNominalResistanceKg: null, completedAt: new Date(),
    });
    expect(rejected).toEqual({ state: "REJECTED" });
    expect(await prisma.trainingSetCreateOperation.findUniqueOrThrow({
      where: { profileId_operationId: { profileId, operationId } },
      select: { state: true, canonicalSetId: true },
    })).toEqual({ state: "REJECTED", canonicalSetId: null });
    await expect(repository.createSet({
      profileId, operationId, payloadDigest: "a".repeat(64), sessionId,
      sessionExerciseId: exercise.id, expectedResistanceType: alternate,
      reps: 5, weightKg: null, bandNominalResistanceKg: null, completedAt: new Date(),
    })).rejects.toThrow("Training inputs changed while this request was being prepared");
    expect(await prisma.strengthSet.count({ where: { sessionExerciseId: exercise.id } })).toBe(setCountBefore);
  });

  it("records Health-linked Training evidence without resetting an existing Training debounce", async () => {
    if (sessionId === null) throw new Error("The preceding isolated session fixture is required.");
    const dueAt = new Date(Date.now() + 125_000);
    await prisma.trainingRefreshJob.update({ where: { profileId }, data: { dueAt } });
    const before = await prisma.trainingRefreshJob.findUniqueOrThrow({
      where: { profileId }, select: { requestedGeneration: true, dueAt: true },
    });
    await prisma.$transaction(async (tx) => {
      await enqueueTrainingSourceChangeInTransaction(tx, {
        profileId,
        operationKind: "health-linked-workout-reconciled",
        affectedSessionIds: [sessionId!],
        oldSourceIdentity: { kind: "health-workout", workoutId: 9001, sourceIdentity: "old" },
        newSourceIdentity: { kind: "health-workout", workoutId: 9001, sourceIdentity: "new" },
        oldEventInstants: { startAt: "2026-10-01T10:00:00.000Z" },
        newEventInstants: { startAt: "2026-10-01T10:30:00.000Z" },
        oldModelDates: ["2026-10-01"],
        newModelDates: ["2026-10-01"],
        deadlineMode: "health-fast",
      });
    });
    const after = await prisma.trainingRefreshJob.findUniqueOrThrow({
      where: { profileId }, select: { requestedGeneration: true, dueAt: true },
    });
    expect(after.requestedGeneration).toBe(before.requestedGeneration + 1);
    expect(after.dueAt).toEqual(before.dueAt);
    const journal = await prisma.trainingSourceChange.findFirstOrThrow({
      where: { profileId, generation: after.requestedGeneration },
    });
    expect(journal).toMatchObject({
      operationKind: "health-linked-workout-reconciled",
      affectedSessionIds: [sessionId],
      oldModelDates: ["2026-10-01"],
      newModelDates: ["2026-10-01"],
      acknowledgedAt: null,
    });
  });

  it("serializes concurrent independent set edits without losing either write", async () => {
    if (sessionId === null) throw new Error("The preceding isolated session fixture is required.");
    const set = await prisma.strengthSet.findFirstOrThrow({
      where: { sessionExercise: { sessionId } },
      orderBy: { id: "asc" },
    });
    const [repsEdit, noteEdit] = await Promise.all([
      training.updateSet(sessionId, set.id, { reps: 12 }, profileId),
      training.updateSet(sessionId, set.id, { rir: 4, comment: "concurrent edit" }, profileId),
    ]);
    expect([repsEdit.reps, noteEdit.reps]).toContain(12);
    const final = await prisma.strengthSet.findUniqueOrThrow({ where: { id: set.id } });
    expect(final).toMatchObject({ reps: 12, rir: 4, comment: "concurrent edit" });
    expect(final.loadAccountingOverride).toEqual({ additionalLoadKg: 15 });
  });
});
