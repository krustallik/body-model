import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";
import { persistActiveEnergyCanonicalResolutionV1 } from "@/model/activity/active-energy-canonical.repository";
import { ActiveEnergyConvergenceBusyError, PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { runWithHealthSyncRefreshWorkerLease } from "@/modules/health/health-sync-worker-context";
import { reconcileOrphanActiveEnergyConvergenceBlocks } from "@/modules/training/training-refresh-worker";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.DATABASE_URL);
process.env.DATABASE_URL = databaseUrl;
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const profileId = 1;
const sourceKey = "convergence";

describe("Active Energy convergence publication fence on isolated PostgreSQL", () => {
  let lifecycleBefore: Prisma.PhysiologyV7LifecycleGetPayload<Record<string, never>> | null = null;
  let blockBefore: { revision: number; fromDate: string } | null = null;
  const dirtyDate = "2026-01-01";
  let profileCreated = false;
  let lifecycleExistedBefore = false;

  beforeAll(async () => {
    await prisma.$connect();
    const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    const expected = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    if (identity[0]?.name !== expected) throw new Error("Active Energy fence test escaped its guarded database.");
    if (!await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true } })) {
      await prisma.profile.create({
        data: { id: profileId, sex: "female", dateOfBirth: new Date("1990-01-01T00:00:00.000Z"), heightCm: 170 },
      });
      profileCreated = true;
    }
    lifecycleBefore = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId } });
    lifecycleExistedBefore = lifecycleBefore !== null;
    if (!lifecycleBefore) {
      await new PhysiologyV7PersistenceRepository(prisma).ensureLifecycle(profileId, dirtyDate);
      lifecycleBefore = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    }
    blockBefore = await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "active_energy", sourceKey } },
      select: { revision: true, fromDate: true },
    });
  });

  beforeEach(async () => {
    await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId, source: "active_energy", sourceKey } });
  });

  afterAll(async () => {
    if (blockBefore) {
      await prisma.unifiedPublicationBlock.upsert({
        where: { profileId_source_sourceKey: { profileId, source: "active_energy", sourceKey } },
        create: { profileId, source: "active_energy", sourceKey, ...blockBefore },
        update: blockBefore,
      });
    } else {
      await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId, source: "active_energy", sourceKey } });
    }
    if (lifecycleBefore && lifecycleExistedBefore) {
      const data = { ...lifecycleBefore } as Record<string, unknown>;
      delete data.profileId;
      await prisma.physiologyV7Lifecycle.update({
        where: { profileId },
        data: data as Prisma.PhysiologyV7LifecycleUpdateInput,
      });
    } else if (!lifecycleExistedBefore) {
      await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId } });
    }
    if (profileCreated) await prisma.profile.deleteMany({ where: { id: profileId } });
    await prisma.$disconnect();
  });

  it("keeps readers stale through a committed production pass and rejects an old clear after invalidation", async () => {
    await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId, source: "active_energy", sourceKey } });
    await prisma.physiologyV7Lifecycle.update({
      where: { profileId },
      data: {
        productionStaleFromDate: null,
        productionPublishedGeneration: lifecycleBefore!.invalidationGeneration,
        invalidationGeneration: lifecycleBefore!.invalidationGeneration,
      },
    });
    const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
    const token = await lifecycle.beginActiveEnergyConvergence({ profileId, fromDate: dirtyDate });
    expect(await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "active_energy", sourceKey }))
      .toMatchObject({ revision: token.revision, fromDate: token.fromDate });

    const generationBeforeConcurrentEdit = lifecycleBefore!.invalidationGeneration;
    await lifecycle.invalidate(profileId, dirtyDate);
    const cleared = await lifecycle.finishActiveEnergyConvergence({
      profileId,
      expectedGeneration: generationBeforeConcurrentEdit,
      expectedRevision: token.revision,
      expectedFromDate: token.fromDate,
      expectedOwnerToken: token.ownerToken,
    });
    expect(cleared).toBe(false);
    expect(await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "active_energy", sourceKey }))
      .toMatchObject({ revision: token.revision, fromDate: token.fromDate });
  });

  it("survives repository restart after a failed pass and clears only after current generation is stable", async () => {
    const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
    const token = await lifecycle.beginActiveEnergyConvergence({ profileId, fromDate: dirtyDate });

    const generation = lifecycleBefore!.invalidationGeneration;
    await prisma.physiologyV7Lifecycle.update({
      where: { profileId },
      data: { productionStaleFromDate: null, productionPublishedGeneration: generation, invalidationGeneration: generation },
    });
    const cleared = await lifecycle.finishActiveEnergyConvergence({
      profileId,
      expectedGeneration: generation,
      expectedRevision: token.revision,
      expectedFromDate: token.fromDate,
      expectedOwnerToken: token.ownerToken,
    });
    expect(cleared).toBe(true);
    expect(await lifecycle.readUnifiedPublicationBlockToken({ profileId, source: "active_energy", sourceKey })).toBeNull();
  });

  it("rejects a stale convergence owner before production publication", async () => {
    const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
    const oldOwner = await lifecycle.beginActiveEnergyConvergence({ profileId, fromDate: dirtyDate });
    await expect(lifecycle.beginActiveEnergyConvergence({ profileId, fromDate: dirtyDate }))
      .rejects.toBeInstanceOf(ActiveEnergyConvergenceBusyError);
    await prisma.unifiedPublicationBlock.update({
      where: { profileId_source_sourceKey: { profileId, source: "active_energy", sourceKey } },
      data: { ownerLeaseUntil: new Date(Date.now() - 1000) },
    });
    const currentOwner = await lifecycle.beginActiveEnergyConvergence({ profileId, fromDate: dirtyDate });
    expect(currentOwner.revision).toBeGreaterThan(oldOwner.revision);
    await expect(lifecycle.assertActiveEnergyConvergenceOwner(profileId, oldOwner))
      .rejects.toThrow("Active Energy convergence owner lease was lost");
    await lifecycle.assertActiveEnergyConvergenceOwner(profileId, currentOwner);
    await expect(prisma.$transaction(async (tx) => {
      const transactionLifecycle = new PhysiologyV7PersistenceRepository(tx);
      await transactionLifecycle.lockProfile(profileId);
      await transactionLifecycle.publishProduction({
        profileId,
        expectedGeneration: lifecycleBefore!.invalidationGeneration,
        convergenceOwner: oldOwner,
      });
    })).rejects.toThrow("Active Energy convergence owner lease was lost");
  });

  it("admits one concurrent owner, renews it, and safely recovers after withdrawal", async () => {
    const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
    const attempts = await Promise.allSettled(Array.from({ length: 3 }, () =>
      lifecycle.beginActiveEnergyConvergence({ profileId, fromDate: dirtyDate })));
    const winners = attempts.filter((item) => item.status === "fulfilled");
    expect(winners).toHaveLength(1);
    for (const item of attempts) if (item.status === "rejected") expect(item.reason).toBeInstanceOf(ActiveEnergyConvergenceBusyError);
    const owner = winners[0]!.value;
    await prisma.unifiedPublicationBlock.update({
      where: { profileId_source_sourceKey: { profileId, source: "active_energy", sourceKey } },
      data: { ownerLeaseUntil: new Date(Date.now() + 10000) },
    });
    await lifecycle.renewActiveEnergyConvergence({ profileId, owner });
    const renewed = await prisma.unifiedPublicationBlock.findUniqueOrThrow({
      where: { profileId_source_sourceKey: { profileId, source: "active_energy", sourceKey } },
    });
    expect(renewed.ownerLeaseUntil!.getTime()).toBeGreaterThan(Date.now() + 100000);
    await lifecycle.expireActiveEnergyConvergence(profileId, owner);
    const successor = await lifecycle.beginActiveEnergyConvergence({ profileId, fromDate: dirtyDate });
    await lifecycle.expireActiveEnergyConvergence(profileId, owner);
    await lifecycle.assertActiveEnergyConvergenceOwner(profileId, successor);
    await expect(lifecycle.renewActiveEnergyConvergence({ profileId, owner })).rejects.toThrow("owner lease was lost");
  });

  it("reproduces SQLSTATE 40001 when a Serializable snapshot late-locks its heartbeat-mutated Health job", async () => {
    const before = await prisma.healthSyncRefreshJob.findUnique({ where: { profileId } });
    const leaseToken = "00000000-0000-4000-8000-000000000099";
    const data = { requestedGeneration: 90001, completedGeneration: 90000, leaseToken,
      leaseUntil: new Date(Date.now() + 300000) };
    await prisma.healthSyncRefreshJob.upsert({ where: { profileId }, create: { profileId, ...data }, update: data });
    try {
      await expect(runWithHealthSyncRefreshWorkerLease({ profileId, requestedGeneration: 90001, leaseToken }, () =>
        prisma.$transaction(async (tx) => {
          await tx.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
          // A separate connection is exactly how the worker heartbeat writes.
          await prisma.healthSyncRefreshJob.update({ where: { profileId }, data: {
            leaseUntil: new Date(Date.now() + 310000),
          } });
          await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
      )).rejects.toMatchObject({ code: "P2010", meta: { code: "40001" } });
    } finally {
      if (before) await prisma.healthSyncRefreshJob.update({ where: { profileId }, data: before });
      else await prisma.healthSyncRefreshJob.delete({ where: { profileId } });
    }
  });

  it("keeps PostgreSQL canonical resolution stable when a losing input fingerprint changes", async () => {
    const logicalEventKey = "test:canonical-selected-source-fingerprint-stability";
    const inputFingerprintBefore = "a".repeat(64);
    const inputFingerprintAfter = "b".repeat(64);
    const selectedSourceFingerprint = "c".repeat(64);
    const losingSourceFingerprint = "e".repeat(64);
    const changedSelectedSourceFingerprint = "d".repeat(64);
    const where = { profileId, logicalEventKey };
    await prisma.activeEnergyCanonicalEvent.deleteMany({ where });
    try {
      const first = await persistActiveEnergyCanonicalResolutionV1(prisma, {
        profileId,
        logicalEventKey,
        eventKind: "strength",
        occurrenceAt: new Date("2026-01-01T12:00:00.000Z"),
        modelDate: "2026-01-01",
        modelTimeZone: "UTC",
        inputFingerprint: inputFingerprintBefore,
        aliases: [],
        candidates: [{
          source: "bodycast-strength-estimate",
          sourceIdentity: "test:selected-estimate-source",
          sourceFingerprint: selectedSourceFingerprint,
          valueKcal: 100,
          provenance: { source: "test-estimate" },
        }, {
          source: "device-kcal",
          sourceIdentity: "test:losing-device-source",
          sourceFingerprint: losingSourceFingerprint,
          valueKcal: 100,
          provenance: { source: "test-device-v1" },
        }],
      });
      const replay = await persistActiveEnergyCanonicalResolutionV1(prisma, {
        profileId,
        logicalEventKey,
        eventKind: "strength",
        occurrenceAt: new Date("2026-01-01T12:00:00.000Z"),
        modelDate: "2026-01-01",
        modelTimeZone: "UTC",
        inputFingerprint: inputFingerprintAfter,
        aliases: [],
        candidates: [{
          source: "bodycast-strength-estimate",
          sourceIdentity: "test:selected-estimate-source",
          sourceFingerprint: selectedSourceFingerprint,
          valueKcal: 100,
          provenance: { source: "test-estimate" },
        }, {
          source: "device-kcal",
          sourceIdentity: "test:losing-device-source",
          sourceFingerprint: "f".repeat(64),
          valueKcal: 110,
          provenance: { source: "test-device-v2" },
        }],
      });

      expect(first).toEqual({ eventId: expect.any(Number), revision: 1, current: true });
      expect(replay).toEqual({ eventId: first.eventId, revision: 1, current: true });
      expect(await prisma.activeEnergyResolutionRevision.count({ where: { eventId: first.eventId } })).toBe(1);

      const changedSelectedSource = await persistActiveEnergyCanonicalResolutionV1(prisma, {
        profileId,
        logicalEventKey,
        eventKind: "strength",
        occurrenceAt: new Date("2026-01-01T12:00:00.000Z"),
        modelDate: "2026-01-01",
        modelTimeZone: "UTC",
        inputFingerprint: inputFingerprintAfter,
        aliases: [],
        candidates: [{
          source: "bodycast-strength-estimate",
          sourceIdentity: "test:selected-estimate-source",
          sourceFingerprint: changedSelectedSourceFingerprint,
          valueKcal: 100,
          provenance: { source: "test-estimate" },
        }],
      });
      expect(changedSelectedSource).toEqual({ eventId: first.eventId, revision: 2, current: true });
      expect(await prisma.activeEnergyResolutionRevision.count({ where: { eventId: first.eventId } })).toBe(2);
    } finally {
      await prisma.activeEnergyCanonicalEvent.deleteMany({ where });
    }
  });

  it("recreates a durable worker job for an orphan convergence fence and is idempotent while pending", async () => {
    const recoveryProfileId = profileId;
    const priorQueue = await prisma.trainingRefreshJob.findUnique({ where: { profileId: recoveryProfileId } });
    const priorHealthQueue = await prisma.healthSyncRefreshJob.findUnique({ where: { profileId: recoveryProfileId } });
    const priorChanges = await prisma.trainingSourceChange.findMany({ where: { profileId: recoveryProfileId } });
    const priorFence = await prisma.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId: recoveryProfileId, source: "active_energy", sourceKey } },
    });
    try {
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId: recoveryProfileId } });
      await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId: recoveryProfileId } });
      await prisma.trainingSourceChange.deleteMany({ where: { profileId: recoveryProfileId } });
      const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
      const token = await lifecycle.beginActiveEnergyConvergence({ profileId: recoveryProfileId, fromDate: dirtyDate });

      await reconcileOrphanActiveEnergyConvergenceBlocks();
      expect(await prisma.trainingRefreshJob.findUnique({ where: { profileId: recoveryProfileId } })).toBeNull();
      await prisma.$executeRaw`
        UPDATE "UnifiedPublicationBlock" SET "ownerLeaseUntil" = TIMESTAMPTZ '2000-01-01 00:00:00+00'
        WHERE "profileId" = ${recoveryProfileId} AND "source" = 'active_energy' AND "sourceKey" = ${sourceKey}
      `;
      await prisma.healthSyncRefreshJob.upsert({
        where: { profileId: recoveryProfileId },
        create: { profileId: recoveryProfileId, requestedGeneration: 1, completedGeneration: 0, fromDate: dirtyDate, toDate: dirtyDate, sourceDates: [dirtyDate] },
        update: { requestedGeneration: 1, completedGeneration: 0, fromDate: dirtyDate, toDate: dirtyDate, sourceDates: [dirtyDate] },
      });
      await reconcileOrphanActiveEnergyConvergenceBlocks();
      expect(await prisma.trainingRefreshJob.findUnique({ where: { profileId: recoveryProfileId } })).toBeNull();
      await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId: recoveryProfileId } });

      await reconcileOrphanActiveEnergyConvergenceBlocks();
      const firstJob = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: recoveryProfileId } });
      const firstEvidence = await prisma.trainingSourceChange.findMany({
        where: { profileId: recoveryProfileId, operationKind: "active_energy_convergence_recovery" },
      });
      expect(firstJob).toMatchObject({ requestedGeneration: 1, completedGeneration: 0, dirtyFromDate: dirtyDate });
      expect(firstEvidence).toHaveLength(1);
      expect(firstEvidence[0]).toMatchObject({
        affectedSessionIds: [],
        affectedWorkoutIds: [],
        publicationBlockSourceKeys: [sourceKey],
        oldModelDates: [dirtyDate],
      });

      await reconcileOrphanActiveEnergyConvergenceBlocks();
      const secondJob = await prisma.trainingRefreshJob.findUniqueOrThrow({ where: { profileId: recoveryProfileId } });
      expect(secondJob.requestedGeneration).toBe(firstJob.requestedGeneration);
      expect(await prisma.trainingSourceChange.count({
        where: { profileId: recoveryProfileId, operationKind: "active_energy_convergence_recovery" },
      })).toBe(1);
      expect(await lifecycle.readUnifiedPublicationBlockToken({
        profileId: recoveryProfileId, source: "active_energy", sourceKey,
      })).toMatchObject({ revision: token.revision, fromDate: token.fromDate });
    } finally {
      await prisma.trainingSourceChange.deleteMany({ where: { profileId: recoveryProfileId } });
      await prisma.trainingRefreshJob.deleteMany({ where: { profileId: recoveryProfileId } });
      if (priorChanges.length > 0) await prisma.trainingSourceChange.createMany({ data: priorChanges.map((change) => ({
        ...change,
        oldSourceIdentity: change.oldSourceIdentity === null ? Prisma.DbNull : change.oldSourceIdentity as Prisma.InputJsonValue,
        newSourceIdentity: change.newSourceIdentity === null ? Prisma.DbNull : change.newSourceIdentity as Prisma.InputJsonValue,
        oldEventInstants: change.oldEventInstants === null ? Prisma.DbNull : change.oldEventInstants as Prisma.InputJsonValue,
        newEventInstants: change.newEventInstants === null ? Prisma.DbNull : change.newEventInstants as Prisma.InputJsonValue,
      })) });
      if (priorQueue) await prisma.trainingRefreshJob.create({ data: priorQueue });
      if (priorHealthQueue) await prisma.healthSyncRefreshJob.create({ data: priorHealthQueue });
      if (priorFence) {
        await prisma.unifiedPublicationBlock.upsert({
          where: { profileId_source_sourceKey: { profileId: recoveryProfileId, source: "active_energy", sourceKey } },
          create: priorFence,
          update: priorFence,
        });
      } else {
        await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId: recoveryProfileId, source: "active_energy", sourceKey } });
      }
    }
  });
});
