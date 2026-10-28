import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.DATABASE_URL);
process.env.DATABASE_URL = databaseUrl;
const { prisma } = await import("@/lib/db/prisma");
const { StepperWorkoutRepository, StepperCreateOperationConflictError } = await import("@/modules/training/stepper-workout.repository");

const profileId = 1;
const operationId = randomUUID();
const startAt = "2098-11-17T08:00:00.000Z";
const input = { startAt, durationMinutes: 24, manualStepCount: 1800 };
const repository = new StepperWorkoutRepository(prisma);
let workoutId: number | null = null;
let createdQueue = false;
let profileCreated = false;

describe("Stepper create idempotency on isolated PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const identity = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const expected = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    if (identity[0]?.current_database !== expected) throw new Error("Prisma is not connected to the guarded test database.");
    const existingJob = await prisma.trainingRefreshJob.findUnique({ where: { profileId } });
    if (existingJob?.requestedGeneration !== existingJob?.completedGeneration) {
      throw new Error("Refusing to mutate an isolated test database with pending Training work.");
    }
    if (!(await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true } }))) {
      await prisma.profile.create({
        data: {
          id: profileId,
          sex: "female",
          dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
          heightCm: 170,
        },
      });
      profileCreated = true;
    }
  });

  afterAll(async () => {
    if (workoutId !== null) {
      await prisma.stepperCreateOperation.deleteMany({ where: { profileId, operationId } });
      await prisma.trainingSourceChange.deleteMany({ where: { profileId, affectedWorkoutIds: { has: workoutId } } });
      await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId, source: "stepper", sourceKey: String(workoutId) } });
      await prisma.workout.deleteMany({ where: { id: workoutId } });
    }
    if (createdQueue) await prisma.trainingRefreshJob.deleteMany({ where: { profileId } });
    if (profileCreated) await prisma.profile.deleteMany({ where: { id: profileId } });
    await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS test_pause_stepper_operation_insert ON \"StepperCreateOperation\"");
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS public.test_pause_stepper_operation_insert()");
    await prisma.$disconnect();
  });

  it("serializes GET-not-found and a concurrent same-key POST while the original transaction is open", async () => {
    const initialJob = await prisma.trainingRefreshJob.findUnique({ where: { profileId } });
    if (initialJob !== null) throw new Error("This fixture requires an empty durable Training queue.");
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION public.test_pause_stepper_operation_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."operationId" = '${operationId}' THEN PERFORM pg_sleep(1.2); END IF;
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_pause_stepper_operation_insert
      BEFORE INSERT ON "StepperCreateOperation"
      FOR EACH ROW EXECUTE FUNCTION public.test_pause_stepper_operation_insert()
    `);
    try {
      const original = repository.create(profileId, input, operationId);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await expect(repository.resolveCreateOperation(profileId, { operationId })).resolves.toEqual({ state: "NOT_FOUND" });
      const retry = repository.create(profileId, input, operationId);
      const [originalWorkout, canonicalRetry] = await Promise.all([original, retry]);
      workoutId = originalWorkout.id;
      expect(canonicalRetry.id).toBe(originalWorkout.id);
      expect(await prisma.stepperCreateOperation.count({ where: { profileId, operationId } })).toBe(1);
      expect(await prisma.workout.count({ where: { sourceIdentity: `manual:stepper:${operationId}` } })).toBe(1);
      const canonical = await repository.resolveCreateOperation(profileId, { operationId });
      expect(canonical).toMatchObject({ state: "COMMITTED", workout: { id: originalWorkout.id } });
      const job = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
      createdQueue = true;
      const sourceChange = await prisma.trainingSourceChange.findFirstOrThrow({
        where: { profileId, affectedWorkoutIds: { has: originalWorkout.id } },
      });
      expect(job.requestedGeneration).toBeGreaterThan(job.completedGeneration);
      expect(sourceChange).toMatchObject({
        operationKind: "stepper_workout_create",
        affectedWorkoutIds: [originalWorkout.id],
        publicationBlockSourceKeys: [String(originalWorkout.id)],
        acknowledgedAt: null,
      });

      await expect(repository.create(profileId, { ...input, durationMinutes: 25 }, operationId))
        .rejects.toBeInstanceOf(StepperCreateOperationConflictError);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_pause_stepper_operation_insert ON "StepperCreateOperation"');
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS public.test_pause_stepper_operation_insert()");
    }
  });

  it("recovers a committed create by canonical operation lookup after a simulated lost response", async () => {
    if (workoutId === null) throw new Error("The preceding commit fixture is required.");
    const resolved = await repository.resolveCreateOperation(profileId, { operationId });
    expect(resolved).toMatchObject({ state: "COMMITTED", workout: { id: workoutId } });
    expect(await prisma.workout.count({ where: { sourceIdentity: `manual:stepper:${operationId}` } })).toBe(1);
  });
});
