import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalDigest } from "../../scripts/production-recovery/canonical.mjs";
import { currentness, makeRecoveryCase, SOURCE_DIGEST } from "../helpers/recovery-health-currentness-fixture.mjs";
import { requireLoopbackTestDatabaseUrl } from "../helpers/require-loopback-test-database";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION } from "@/model/unified-experimental-physiology-v1/contracts";
import { currentPhysiologyV7Versions } from "@/modules/model-episodes/physiology-v7-persistence";
import { PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE } from "@/modules/model-episodes/physiology-v7-persistence.repository";

const databaseUrl = requireLoopbackTestDatabaseUrl(process.env.BODYCAST_RECOVERY_TEST_DATABASE_URL ?? process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const profileId = 1;
type RecoveryFenceRequest = {
  purpose: string;
  operationType: string;
  operationId: string;
  recoveryCaseId: string;
  journalGeneration: number;
  journalRecordDigest: string;
  logicalProductionDbIdentityDigest: string;
  releaseSha: string;
  imageDigest: string;
  profileId: number;
  unifiedLifecycleFenceNamespace: number;
  fenceSnapshotProtocol: "read-committed-post-lock-v1";
  execute: (evidence: Record<string, unknown>) => Promise<unknown>;
};
const dbIdentity = new URL(databaseUrl);
const logicalDatabaseDigest = canonicalDigest({
  purpose: "isolated-recovery-health-currentness-integration-database",
  host: dbIdentity.hostname,
  port: dbIdentity.port,
  database: decodeURIComponent(dbIdentity.pathname.slice(1)),
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForProfileAdvisoryLockWaiter(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE pid = ${pid} AND locktype = 'advisory' AND classid = ${PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE}::oid
          AND objid = ${profileId}::oid AND objsubid = 2 AND granted = false
      ) AS waiting
    `;
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected recovery or Health writer to wait on the PostgreSQL profile fence.");
}

async function acquireProfileFence(transaction: Prisma.TransactionClient): Promise<void> {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(${PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE}::integer, ${profileId}::integer) IS NULL AS acquired
  `;
}

async function transactionBackendPid(transaction: Prisma.TransactionClient): Promise<number> {
  const rows = await transaction.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
  if (!Number.isSafeInteger(rows[0]?.pid)) throw new Error("PostgreSQL did not return the current backend PID.");
  return rows[0].pid;
}

async function installDatabaseCurrentness({
  requestedGeneration = 8,
  completedGeneration = requestedGeneration,
  invalidationGeneration = 91,
  productionPublishedGeneration = invalidationGeneration,
  unifiedPublishedGeneration = invalidationGeneration,
  unifiedRolloutEpoch = 4,
  unifiedPublishedRolloutEpoch = unifiedRolloutEpoch,
  unifiedTargetRevision = UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
  productionStaleFromDate = null,
  publicationBlockedFromDate = null,
}: {
  requestedGeneration?: number;
  completedGeneration?: number;
  invalidationGeneration?: number;
  productionPublishedGeneration?: number;
  unifiedPublishedGeneration?: number;
  unifiedRolloutEpoch?: number;
  unifiedPublishedRolloutEpoch?: number;
  unifiedTargetRevision?: string;
  productionStaleFromDate?: string | null;
  publicationBlockedFromDate?: string | null;
} = {}) {
  await prisma.healthSyncRefreshJob.upsert({
    where: { profileId },
    create: { profileId, requestedGeneration, completedGeneration },
    update: {
      requestedGeneration,
      completedGeneration,
      leaseToken: null,
      leaseUntil: null,
      lastErrorType: null,
      lastErrorAt: null,
      nextAttemptAt: new Date(),
    },
  });
  await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId } });
  await prisma.physiologyV7Lifecycle.upsert({
    where: { profileId },
    create: {
      profileId,
      invalidationGeneration,
      productionStaleFromDate,
      productionPublishedGeneration,
      unifiedPublishedGeneration,
      unifiedTargetRevision,
      unifiedRolloutEpoch,
      unifiedPublishedRolloutEpoch,
      unifiedPublicationBlockedFromDate: publicationBlockedFromDate,
      unifiedPublicationBlockedSource: publicationBlockedFromDate === null ? null : "health",
      ...currentPhysiologyV7Versions,
    },
    update: {
      invalidationGeneration,
      productionStaleFromDate,
      productionPublishedGeneration,
      unifiedPublishedGeneration,
      unifiedTargetRevision,
      unifiedRolloutEpoch,
      unifiedPublishedRolloutEpoch,
      unifiedPublicationBlockedFromDate: publicationBlockedFromDate,
      unifiedPublicationBlockedSource: publicationBlockedFromDate === null ? null : "health",
    },
  });
}

async function readFencedCurrentness(
  transaction: Prisma.TransactionClient,
  expected: RecoveryFenceRequest,
  buildCurrentness: typeof currentness,
) {
  const isolationRows = await transaction.$queryRaw<Array<{ isolation: string }>>`
    SELECT current_setting('transaction_isolation') AS isolation
  `;
  if (isolationRows[0]?.isolation !== "read committed") {
    throw new Error("Recovery currentness fence requires READ COMMITTED before taking the post-lock snapshot.");
  }
  const [queue, lifecycle, publicationBlockCount] = await Promise.all([
    transaction.healthSyncRefreshJob.findUnique({ where: { profileId } }),
    transaction.physiologyV7Lifecycle.findUnique({ where: { profileId } }),
    transaction.unifiedPublicationBlock.count({ where: { profileId } }),
  ]);
  // This test adapter supplies a stable fingerprint for its synthetic V4 fixture;
  // production source fingerprints remain part of the externally signed adapter conformance gate.
  const sourceDigest = canonicalDigest({
    profileId,
    invalidationGeneration: lifecycle?.invalidationGeneration ?? 0,
    publishedGeneration: lifecycle?.unifiedPublishedGeneration ?? null,
    rolloutEpoch: lifecycle?.unifiedRolloutEpoch ?? 0,
    publishedRolloutEpoch: lifecycle?.unifiedPublishedRolloutEpoch ?? null,
    publicationBlockCount,
  });
  const current = Boolean(lifecycle
    && lifecycle.unifiedTargetRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION
    && lifecycle.productionStaleFromDate === null
    && lifecycle.productionPublishedGeneration === lifecycle.invalidationGeneration
    && lifecycle.unifiedPublishedGeneration === lifecycle.invalidationGeneration
    && lifecycle.unifiedPublishedRolloutEpoch === lifecycle.unifiedRolloutEpoch
    && lifecycle.unifiedPublicationBlockedFromDate === null
    && publicationBlockCount === 0);
  return buildCurrentness(expected, {
    healthRequestedGeneration: queue?.requestedGeneration ?? 0,
    healthCompletedGeneration: queue?.completedGeneration ?? 0,
    healthLeasePresent: Boolean(queue?.leaseToken || queue?.leaseUntil),
    healthLastErrorType: queue?.lastErrorType ?? null,
    healthLastErrorAt: queue?.lastErrorAt?.toISOString() ?? null,
    unifiedTargetRevision: lifecycle?.unifiedTargetRevision ?? "missing",
    unifiedInvalidationGeneration: lifecycle?.invalidationGeneration ?? 0,
    unifiedProductionStaleFromDate: lifecycle ? lifecycle.productionStaleFromDate : "missing",
    unifiedProductionPublishedGeneration: lifecycle?.productionPublishedGeneration ?? null,
    unifiedPublishedGeneration: lifecycle?.unifiedPublishedGeneration ?? null,
    unifiedRolloutEpoch: lifecycle?.unifiedRolloutEpoch ?? 0,
    unifiedPublishedRolloutEpoch: lifecycle?.unifiedPublishedRolloutEpoch ?? null,
    unifiedPublicationBlockedFromDate: lifecycle ? lifecycle.unifiedPublicationBlockedFromDate : "missing",
    unifiedPublicationBlockCount: publicationBlockCount,
    unifiedPublishedSourceDigest: sourceDigest || SOURCE_DIGEST,
    unifiedCurrentSourceDigest: current ? sourceDigest || SOURCE_DIGEST : SOURCE_DIGEST,
    unifiedCurrent: current,
    observedAt: new Date().toISOString(),
  });
}

function makeDatabaseFencedRecoveryCase({
  beforeFenceAcquisition,
  beforeBrokerExecution,
  isolationLevel = "ReadCommitted",
}: {
  beforeFenceAcquisition?: (pid: number, transaction: Prisma.TransactionClient) => void | Promise<void>;
  beforeBrokerExecution?: () => Promise<void>;
  isolationLevel?: "ReadCommitted" | "RepeatableRead";
} = {}) {
  return makeRecoveryCase({
    databaseDigest: logicalDatabaseDigest,
    overrides: {
      withRecoveryCurrentnessFence: async (expected: RecoveryFenceRequest, buildCurrentness) => prisma.$transaction(async (transaction) => {
        const pid = await transactionBackendPid(transaction);
        await beforeFenceAcquisition?.(pid, transaction);
        await acquireProfileFence(transaction);
        const evidence = await readFencedCurrentness(transaction, expected, buildCurrentness);
        await beforeBrokerExecution?.();
        return expected.execute(evidence);
      }, { isolationLevel }),
    },
  });
}

describe("production recovery Health/V4 currentness on isolated PostgreSQL", () => {
  let originalProfile: Awaited<ReturnType<typeof prisma.profile.findUnique>>;
  let originalQueue: Awaited<ReturnType<typeof prisma.healthSyncRefreshJob.findUnique>>;
  let originalLifecycle: Awaited<ReturnType<typeof prisma.physiologyV7Lifecycle.findUnique>>;
  let originalPublicationBlocks: Awaited<ReturnType<typeof prisma.unifiedPublicationBlock.findMany>>;

  beforeAll(async () => {
    originalProfile = await prisma.profile.findUnique({ where: { id: profileId } });
    originalQueue = await prisma.healthSyncRefreshJob.findUnique({ where: { profileId } });
    originalLifecycle = await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId } });
    originalPublicationBlocks = await prisma.unifiedPublicationBlock.findMany({ where: { profileId } });
    await prisma.profile.upsert({
      where: { id: profileId },
      create: { id: profileId, sex: "male", dateOfBirth: new Date("1990-01-01T00:00:00.000Z"), heightCm: 180 },
      update: {},
    });
  });

  afterAll(async () => {
    await prisma.healthSyncRefreshJob.deleteMany({ where: { profileId } });
    if (originalQueue) await prisma.healthSyncRefreshJob.create({ data: originalQueue });
    await prisma.unifiedPublicationBlock.deleteMany({ where: { profileId } });
    if (originalPublicationBlocks.length > 0) {
      await prisma.unifiedPublicationBlock.createMany({ data: originalPublicationBlocks, skipDuplicates: true });
    }
    await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId } });
    if (originalLifecycle) await prisma.physiologyV7Lifecycle.create({ data: originalLifecycle });
    if (!originalProfile) await prisma.profile.deleteMany({ where: { id: profileId } });
    await prisma.$disconnect();
  });

  it("denies traffic after a Health generation commits before recovery acquires the fence", async () => {
    await installDatabaseCurrentness({ requestedGeneration: 8, completedGeneration: 8 });
    const writerHeld = deferred();
    const releaseWriter = deferred();
    let healthWriter: Promise<void> | undefined;
    let recovery: Promise<Record<string, unknown>> | undefined;
    try {
      healthWriter = prisma.$transaction(async (transaction) => {
        await acquireProfileFence(transaction);
        await transaction.healthSyncRefreshJob.update({
          where: { profileId },
          data: { requestedGeneration: 9, nextAttemptAt: new Date() },
        });
        writerHeld.resolve();
        await releaseWriter.promise;
      });
      await writerHeld.promise;
      const recoveryBackend = deferred<number>();
      const fixture = makeDatabaseFencedRecoveryCase({ beforeFenceAcquisition: (pid) => recoveryBackend.resolve(pid) });
      recovery = fixture.broker.dispatch(fixture.request);
      await waitForProfileAdvisoryLockWaiter(await recoveryBackend.promise);
      releaseWriter.resolve();
      await healthWriter;
      await expect(recovery).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
      expect(fixture.effectCount()).toBe(0);
    } finally {
      releaseWriter.resolve();
      await Promise.allSettled([...(healthWriter ? [healthWriter] : []), ...(recovery ? [recovery] : [])]);
    }
  });

  it("denies traffic when persisted Unified V4 publication is stale", async () => {
    await installDatabaseCurrentness({
      invalidationGeneration: 92,
      productionPublishedGeneration: 91,
      unifiedPublishedGeneration: 91,
    });
    const fixture = makeDatabaseFencedRecoveryCase();
    await expect(fixture.broker.dispatch(fixture.request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.effectCount()).toBe(0);
  });

  it("rejects a repeatable-read snapshot established before a Health writer commits and before the profile fence is acquired", async () => {
    await installDatabaseCurrentness({ requestedGeneration: 8, completedGeneration: 8 });
    const writerHeld = deferred();
    const releaseWriter = deferred();
    const recoveryBackend = deferred<number>();
    let healthWriter: Promise<void> | undefined;
    let recovery: Promise<Record<string, unknown>> | undefined;
    try {
      healthWriter = prisma.$transaction(async (transaction) => {
        await acquireProfileFence(transaction);
        await transaction.healthSyncRefreshJob.update({
          where: { profileId },
          data: { requestedGeneration: 9, nextAttemptAt: new Date() },
        });
        writerHeld.resolve();
        await releaseWriter.promise;
      }, { isolationLevel: "ReadCommitted" });
      await writerHeld.promise;

      const fixture = makeDatabaseFencedRecoveryCase({
        isolationLevel: "RepeatableRead",
        beforeFenceAcquisition: async (pid, transaction) => {
          const staleSnapshot = await transaction.healthSyncRefreshJob.findUnique({ where: { profileId } });
          expect(staleSnapshot?.requestedGeneration).toBe(8);
          recoveryBackend.resolve(pid);
        },
      });
      recovery = fixture.broker.dispatch(fixture.request);
      await waitForProfileAdvisoryLockWaiter(await recoveryBackend.promise);
      releaseWriter.resolve();
      await healthWriter;
      await expect(recovery).rejects.toThrow(/requires READ COMMITTED before taking the post-lock snapshot/);
      expect(fixture.effectCount()).toBe(0);
    } finally {
      releaseWriter.resolve();
      await Promise.allSettled([...(healthWriter ? [healthWriter] : []), ...(recovery ? [recovery] : [])]);
    }
  });

  it("opens traffic with current queue/V4 lifecycle evidence while a later Health generation waits behind the same fence", async () => {
    await installDatabaseCurrentness({ requestedGeneration: 8, completedGeneration: 8 });
    const currentnessRead = deferred();
    const writerBackend = deferred<number>();
    const resumeBroker = deferred();
    let recovery: Promise<Record<string, unknown>> | undefined;
    let healthWriter: Promise<void> | undefined;
    const writerHeld = deferred();
    try {
      const fixture = makeDatabaseFencedRecoveryCase({ beforeBrokerExecution: async () => {
        currentnessRead.resolve();
        await resumeBroker.promise;
      } });
      recovery = fixture.broker.dispatch(fixture.request);
      await currentnessRead.promise;

      healthWriter = prisma.$transaction(async (transaction) => {
        writerBackend.resolve(await transactionBackendPid(transaction));
        await acquireProfileFence(transaction);
        await transaction.healthSyncRefreshJob.update({
          where: { profileId },
          data: { requestedGeneration: 9, nextAttemptAt: new Date() },
        });
        writerHeld.resolve();
      });
      await waitForProfileAdvisoryLockWaiter(await writerBackend.promise);
      expect(fixture.effectCount()).toBe(0);
      resumeBroker.resolve();

      await expect(recovery).resolves.toMatchObject({ operationCompletion: { result: "executed" } });
      await writerHeld.promise;
      await healthWriter;
      expect(fixture.effectCount()).toBe(1);
      await expect(prisma.healthSyncRefreshJob.findUniqueOrThrow({ where: { profileId } }))
        .resolves.toMatchObject({ requestedGeneration: 9, completedGeneration: 8 });
    } finally {
      resumeBroker.resolve();
      await Promise.allSettled([...(healthWriter ? [healthWriter] : []), ...(recovery ? [recovery] : [])]);
    }
  });
});
