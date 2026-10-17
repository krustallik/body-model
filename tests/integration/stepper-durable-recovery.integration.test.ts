import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.DATABASE_URL);
process.env.DATABASE_URL = databaseUrl;
const { prisma } = await import("@/lib/db/prisma");
const { processNextTrainingRefreshJob, reconcileLegacyStepperPublicationBlocksForRecovery } = await import("@/modules/training/training-refresh-worker");

const profileId = 1;
const sourceKey = String(900_000_000 + randomInt(1, 99_999_999));
const fromDate = "2026-10-08";
let createdBlock = false;
let createdQueue = false;
let profileCreated = false;

describe("legacy Stepper publication block recovery on isolated PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const identity = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const expected = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    if (identity[0]?.current_database !== expected) throw new Error("Prisma is not connected to the guarded test database.");
    const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true } });
    if (!profile) {
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
    const existingJob = await prisma.trainingRefreshJob.findUnique({ where: { profileId } });
    if (existingJob?.requestedGeneration !== existingJob?.completedGeneration) {
      throw new Error("Refusing to mutate an isolated test database with pre-existing pending Training work.");
    }
  });

  afterAll(async () => {
    if (createdBlock) {
      await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId, source: "stepper", sourceKey } });
    }
    await prisma.trainingSourceChange.deleteMany({
      where: { profileId, publicationBlockSourceKeys: { has: sourceKey } },
    });
    if (createdQueue) await prisma.trainingRefreshJob.deleteMany({ where: { profileId } });
    if (profileCreated) await prisma.profile.deleteMany({ where: { id: profileId } });
    await prisma.$disconnect();
  });

  it("recovers an old numeric block with no journal, then retains it as retryable after restart processing fails closed", async () => {
    const before = await prisma.trainingRefreshJob.findUnique({ where: { profileId } });
    if (before !== null) throw new Error("This recovery fixture requires an empty Training queue.");
    await prisma.unifiedPublicationBlock.create({
      data: { profileId, source: "stepper", sourceKey, fromDate },
    });
    createdBlock = true;

    await reconcileLegacyStepperPublicationBlocksForRecovery();

    const job = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
    createdQueue = true;
    const change = await prisma.trainingSourceChange.findFirstOrThrow({
      where: { profileId, publicationBlockSourceKeys: { has: sourceKey } },
    });
    expect(job).toMatchObject({
      requestedGeneration: 1,
      completedGeneration: 0,
      dirtyFromDate: fromDate,
      dueAt: expect.any(Date),
    });
    expect(job.dueAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    expect(change).toMatchObject({
      operationKind: "stepper_workout_legacy_block_recovery",
      affectedWorkoutIds: [Number(sourceKey)],
      publicationBlockSourceKeys: [sourceKey],
      oldModelDates: [fromDate],
      newModelDates: [],
      acknowledgedAt: null,
    });

    // A restart poll sees the durable overdue queue. With no episode/source row
    // in this deliberately minimal fixture, rebuilding must fail closed and
    // retain both the raw block and unacknowledged source evidence for retry.
    await expect(processNextTrainingRefreshJob()).resolves.toBe(true);
    const afterFailedAttempt = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
    expect(afterFailedAttempt).toMatchObject({
      requestedGeneration: 1,
      completedGeneration: 0,
      leaseToken: null,
      lastErrorType: expect.any(String),
      nextAttemptAt: expect.any(Date),
    });
    expect(await prisma.trainingSourceChange.findUniqueOrThrow({
      where: { sourceChangeId: change.sourceChangeId },
      select: { acknowledgedAt: true },
    })).toEqual({ acknowledgedAt: null });
    expect(await prisma.unifiedPublicationBlock.findUniqueOrThrow({
      where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey } },
      select: { fromDate: true },
    })).toEqual({ fromDate });
  });
});
