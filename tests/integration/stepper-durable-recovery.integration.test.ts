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
let profileCreated = false;
let preexistingTrainingWork = false;
let previousTrainingRefreshJob: Awaited<ReturnType<typeof prisma.trainingRefreshJob.findUnique>> = null;

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
    previousTrainingRefreshJob = existingJob;
    preexistingTrainingWork = existingJob !== null
      && existingJob.requestedGeneration > existingJob.completedGeneration;
  });

  afterAll(async () => {
    if (createdBlock) {
      await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId, source: "stepper", sourceKey } });
    }
    await prisma.trainingSourceChange.deleteMany({
      where: { profileId, publicationBlockSourceKeys: { has: sourceKey } },
    });
    if (previousTrainingRefreshJob) {
      const job = previousTrainingRefreshJob;
      await prisma.trainingRefreshJob.update({
        where: { profileId },
        data: {
          requestedGeneration: job.requestedGeneration,
          completedGeneration: job.completedGeneration,
          dueAt: job.dueAt,
          dirtyFromDate: job.dirtyFromDate,
          dirtyToDate: job.dirtyToDate,
          affectedSessionIds: job.affectedSessionIds,
          leaseToken: job.leaseToken,
          leaseUntil: job.leaseUntil,
          nextAttemptAt: job.nextAttemptAt,
          attemptCount: job.attemptCount,
          lastAttemptAt: job.lastAttemptAt,
          lastErrorType: job.lastErrorType,
          lastErrorAt: job.lastErrorAt,
          lastProgressStage: job.lastProgressStage,
          lastProgressAt: job.lastProgressAt,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
      });
    } else {
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId } });
    }
    if (profileCreated) await prisma.profile.deleteMany({ where: { id: profileId } });
    await prisma.$disconnect();
  });

  it("recovers an old numeric block with no journal, then retains it as retryable after restart processing fails closed", async () => {
    const before = await prisma.trainingRefreshJob.findUnique({ where: { profileId } });
    await prisma.unifiedPublicationBlock.create({
      data: { profileId, source: "stepper", sourceKey, fromDate },
    });
    createdBlock = true;

    await reconcileLegacyStepperPublicationBlocksForRecovery();

    const job = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
    const change = await prisma.trainingSourceChange.findFirstOrThrow({
      where: { profileId, publicationBlockSourceKeys: { has: sourceKey } },
    });
    expect(job).toMatchObject({
      requestedGeneration: (before?.requestedGeneration ?? 0) + 1,
      completedGeneration: before?.completedGeneration ?? 0,
      dirtyFromDate: [before?.dirtyFromDate, fromDate].filter((date): date is string => date !== null && date !== undefined).sort()[0],
      dueAt: expect.any(Date),
    });
    if (before && before.requestedGeneration > before.completedGeneration && before.dueAt) {
      // Fast recovery preserves an already-pending Training debounce instead
      // of pulling another generation ahead of its existing trailing edge.
      expect(job.dueAt).toEqual(before.dueAt);
    } else {
      expect(job.dueAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    }
    expect(change).toMatchObject({
      operationKind: "stepper_workout_legacy_block_recovery",
      affectedWorkoutIds: [Number(sourceKey)],
      publicationBlockSourceKeys: [sourceKey],
      oldModelDates: [fromDate],
      newModelDates: [],
      acknowledgedAt: null,
    });

    // A pending job may have been left by an earlier integration fixture on
    // the singleton profile. Preserve that durable workload rather than
    // claiming it as a side effect of this recovery test.
    if (preexistingTrainingWork) {
      expect(job.requestedGeneration).toBeGreaterThan(job.completedGeneration);
      expect(job.leaseToken).toBeNull();
      expect(await prisma.unifiedPublicationBlock.findUniqueOrThrow({
        where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey } },
        select: { fromDate: true },
      })).toEqual({ fromDate });
      return;
    }

    // A restart poll sees the durable overdue queue. With no episode/source row
    // in this deliberately minimal fixture, rebuilding must fail closed and
    // retain both the raw block and unacknowledged source evidence for retry.
    await expect(processNextTrainingRefreshJob()).resolves.toBe(true);
    const afterFailedAttempt = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
    expect(afterFailedAttempt).toMatchObject({
      requestedGeneration: job.requestedGeneration,
      completedGeneration: job.completedGeneration,
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
