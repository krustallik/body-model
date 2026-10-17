import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import {
  runWithTrainingRefreshWorkerLease,
  TrainingRefreshWorkerLeaseLostError,
} from "@/modules/training/training-refresh-worker-context";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.DATABASE_URL);
process.env.DATABASE_URL = databaseUrl;
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const {
  reconcileLegacyStepperPublicationBlocksForRecovery,
  runTrainingRefreshLivenessRecovery,
} = await import("@/modules/training/training-refresh-worker");
const profileId = 1;

function jsonDbValue(value: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : value as Prisma.InputJsonValue;
}

describe("Training refresh stalled lease recovery on isolated PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (database[0]?.name !== decodeURIComponent(new URL(databaseUrl).pathname.slice(1))) {
      throw new Error("The liveness recovery test is not connected to the guarded isolated database.");
    }
    if (!await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true } })) {
      await prisma.profile.create({
        data: { id: profileId, sex: "female", dateOfBirth: new Date("1990-01-01T00:00:00.000Z"), heightCm: 170 },
      });
    }
  });

  afterAll(async () => prisma.$disconnect());

  it("revokes a stalled live lease and lets the poller reclaim the same overdue generation", async () => {
    const priorQueue = await prisma.trainingRefreshJob.findUnique({ where: { profileId } });
    const priorChanges = await prisma.trainingSourceChange.findMany({ where: { profileId } });
    const overdueDueAt = new Date(0);
    const leaseToken = randomUUID();
    try {
      await prisma.trainingSourceChange.deleteMany({ where: { profileId } });
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId } });
      await prisma.trainingRefreshJob.create({
        data: {
          profileId,
          requestedGeneration: 1,
          completedGeneration: 0,
          dueAt: overdueDueAt,
          dirtyFromDate: "2026-10-01",
          dirtyToDate: "2026-10-01",
          affectedSessionIds: [],
          nextAttemptAt: new Date(0),
          attemptCount: 1,
          leaseToken,
          leaseUntil: new Date(Date.now() + 10 * 60_000),
          lastProgressStage: "synthetic-stall",
          lastProgressAt: new Date(Date.now() - 11 * 60_000),
        },
      });

      await expect(runTrainingRefreshLivenessRecovery({
        afterClaim: async () => { throw new Error("synthetic takeover observed"); },
      })).rejects.toThrow("synthetic takeover observed");

      const reclaimed = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
      expect(reclaimed).toMatchObject({
        requestedGeneration: 1,
        completedGeneration: 0,
        dueAt: overdueDueAt,
        attemptCount: 2,
        lastErrorType: "StalledWorkerProgress",
        lastProgressStage: "claimed",
      });
      expect(reclaimed.leaseToken).not.toBe(leaseToken);
      expect(reclaimed.leaseUntil?.getTime()).toBeGreaterThan(Date.now());

      await expect(runWithTrainingRefreshWorkerLease({
        profileId,
        requestedGeneration: 1,
        leaseToken,
      }, () => prisma.$transaction(async (tx) => {
        await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      }))).rejects.toBeInstanceOf(TrainingRefreshWorkerLeaseLostError);
    } finally {
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId } });
      await prisma.trainingSourceChange.deleteMany({ where: { profileId } });
      if (priorChanges.length > 0) {
        await prisma.trainingSourceChange.createMany({
          data: priorChanges.map((row) => ({
            ...row,
            oldSourceIdentity: jsonDbValue(row.oldSourceIdentity),
            newSourceIdentity: jsonDbValue(row.newSourceIdentity),
            oldEventInstants: jsonDbValue(row.oldEventInstants),
            newEventInstants: jsonDbValue(row.newEventInstants),
          })),
        });
      }
      if (priorQueue) await prisma.trainingRefreshJob.create({ data: priorQueue });
    }
  });

  it("independently reclaims an already-expired lease while another poller is unavailable", async () => {
    const priorQueue = await prisma.trainingRefreshJob.findUnique({ where: { profileId } });
    const priorChanges = await prisma.trainingSourceChange.findMany({ where: { profileId } });
    const expiredToken = randomUUID();
    try {
      await prisma.trainingSourceChange.deleteMany({ where: { profileId } });
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId } });
      await prisma.trainingRefreshJob.create({
        data: {
          profileId,
          requestedGeneration: 4,
          completedGeneration: 3,
          dueAt: new Date(0),
          dirtyFromDate: "2026-10-01",
          dirtyToDate: "2026-10-01",
          affectedSessionIds: [],
          nextAttemptAt: new Date(0),
          attemptCount: 1,
          leaseToken: expiredToken,
          leaseUntil: new Date(Date.now() - 1_000),
          lastProgressStage: "expired-worker",
          lastProgressAt: new Date(Date.now() - 11 * 60_000),
        },
      });

      await expect(runTrainingRefreshLivenessRecovery({
        afterClaim: async () => { throw new Error("independent reclaim observed"); },
      })).rejects.toThrow("independent reclaim observed");

      const reclaimed = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
      expect(reclaimed).toMatchObject({
        requestedGeneration: 4,
        completedGeneration: 3,
        dueAt: new Date(0),
        attemptCount: 2,
        lastProgressStage: "claimed",
      });
      expect(reclaimed.leaseToken).not.toBe(expiredToken);
    } finally {
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId } });
      await prisma.trainingSourceChange.deleteMany({ where: { profileId } });
      if (priorChanges.length > 0) {
        await prisma.trainingSourceChange.createMany({
          data: priorChanges.map((row) => ({
            ...row,
            oldSourceIdentity: jsonDbValue(row.oldSourceIdentity),
            newSourceIdentity: jsonDbValue(row.newSourceIdentity),
            oldEventInstants: jsonDbValue(row.oldEventInstants),
            newEventInstants: jsonDbValue(row.newEventInstants),
          })),
        });
      }
      if (priorQueue) await prisma.trainingRefreshJob.create({ data: priorQueue });
    }
  });

  it("recovers a lingering legacy Stepper block when its matching journal is already acknowledged", async () => {
    const sourceKey = String(1_900_000_000 + Math.floor(Math.random() * 10_000_000));
    const priorQueue = await prisma.trainingRefreshJob.findUnique({ where: { profileId } });
    const priorBlock = await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey } },
    });
    const oldDate = "2026-05-17";
    const journalId = randomUUID();
    const durableSession = await prisma.strengthDiarySession.create({
      data: { profileId, status: "CANCELLED", entryMode: "RETROSPECTIVE", matchStatus: "UNMATCHED" },
      select: { id: true },
    });
    try {
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId } });
      await prisma.unifiedPublicationBlock.upsert({
        where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey } },
        create: { profileId, source: "stepper", sourceKey, fromDate: oldDate },
        update: { fromDate: oldDate },
      });
      await prisma.trainingSourceChange.create({
        data: {
          sourceChangeId: journalId,
          profileId,
          generation: 1,
          operationKind: "stepper_workout_legacy_history",
          publicationBlockSourceKeys: [sourceKey],
          affectedSessionIds: [durableSession.id],
          oldModelDates: [oldDate],
          newModelDates: [],
          acknowledgedAt: new Date(),
        },
      });

      await reconcileLegacyStepperPublicationBlocksForRecovery();
      const firstRecovery = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } });
      expect(firstRecovery).toMatchObject({
        requestedGeneration: 1,
        completedGeneration: 0,
        dirtyFromDate: oldDate,
        affectedSessionIds: [durableSession.id],
      });
      const recoveredJournal = await prisma.trainingSourceChange.findFirstOrThrow({
        where: { profileId, operationKind: "stepper_workout_legacy_block_recovery", publicationBlockSourceKeys: { has: sourceKey } },
      });
      expect(recoveredJournal).toMatchObject({
        acknowledgedAt: null,
        oldModelDates: [oldDate],
        newModelDates: [],
        affectedSessionIds: [durableSession.id],
        affectedWorkoutIds: [Number(sourceKey)],
      });

      await reconcileLegacyStepperPublicationBlocksForRecovery();
      expect(await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId } })).toMatchObject({
        requestedGeneration: firstRecovery.requestedGeneration,
        dirtyFromDate: oldDate,
      });
      expect(await prisma.trainingSourceChange.count({
        where: { profileId, operationKind: "stepper_workout_legacy_block_recovery", publicationBlockSourceKeys: { has: sourceKey } },
      })).toBe(1);
    } finally {
      await prisma.trainingSourceChange.deleteMany({ where: { sourceChangeId: { in: [journalId] } } });
      await prisma.trainingSourceChange.deleteMany({
        where: { profileId, operationKind: "stepper_workout_legacy_block_recovery", publicationBlockSourceKeys: { has: sourceKey } },
      });
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId } });
      await prisma.strengthDiarySession.delete({ where: { id: durableSession.id } });
      if (priorQueue) await prisma.trainingRefreshJob.create({ data: priorQueue });
      if (priorBlock) {
        await prisma.unifiedPublicationBlock.upsert({
          where: { profileId_source_sourceKey: { profileId, source: "stepper", sourceKey } },
          create: priorBlock,
          update: priorBlock,
        });
      } else {
        await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId, source: "stepper", sourceKey } });
      }
    }
  });
});
