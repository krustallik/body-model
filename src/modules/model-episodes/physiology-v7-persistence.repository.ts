import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { PhysiologyDayResultV7 } from "@/model/physiology-v7/daily-runtime-v7";
import {
  currentPhysiologyV7Versions,
  deserializePhysiologyDayResultV7,
  mergeEarliestStaleDate,
  persistedResultFingerprint,
  serializePhysiologyDayResultV7,
  versionsAreCurrent,
} from "./physiology-v7-persistence";
import { addCalendarDays } from "./model-calendar";
import {
  getHealthSyncRefreshWorkerLease,
  HealthSyncRefreshWorkerLeaseLostError,
} from "@/modules/health/health-sync-worker-context";

export const PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE = 927001;

type DbClient = PrismaClient | Prisma.TransactionClient;
type LifecycleInvalidationState = {
  profileId: number;
  staleFromDate: string | null;
  invalidationGeneration: number;
  currentThroughDate: string | null;
  productionStaleFromDate: string | null;
  productionPublishedGeneration: number | null;
  unifiedPublishedGeneration: number | null;
};

function isPrismaClient(client: DbClient): client is PrismaClient {
  return "$transaction" in client;
}

export class PhysiologyV7ConcurrentSourceChangeError extends Error {
  constructor() {
    super("v7 durable sources changed during rebuild; result remains stale");
  }
}

export type UnifiedSourceFenceV1 = {
  invalidationGeneration: number;
  unifiedPublishedGeneration: number | null;
  unifiedTargetRevision: string;
  unifiedRolloutEpoch: number;
  unifiedPublishedRolloutEpoch: number | null;
  unifiedPublicationBlockedFromDate: string | null;
  unifiedPublicationBlockedSource: string | null;
  updatedAt: string;
};

/** Capture a lifecycle CAS token before computing any persisted Unified child. */
export async function readUnifiedSourceFenceV1(
  client: DbClient,
  profileId: number,
): Promise<UnifiedSourceFenceV1 | null> {
  const row = await client.physiologyV7Lifecycle.findUnique({
    where: { profileId },
    select: {
      invalidationGeneration: true,
      unifiedPublishedGeneration: true,
      unifiedTargetRevision: true,
      unifiedRolloutEpoch: true,
      unifiedPublishedRolloutEpoch: true,
      unifiedPublicationBlockedFromDate: true,
      unifiedPublicationBlockedSource: true,
      updatedAt: true,
    },
  });
  return row === null ? null : {
    invalidationGeneration: row.invalidationGeneration,
    unifiedPublishedGeneration: row.unifiedPublishedGeneration,
    unifiedTargetRevision: row.unifiedTargetRevision,
    unifiedRolloutEpoch: row.unifiedRolloutEpoch,
    unifiedPublishedRolloutEpoch: row.unifiedPublishedRolloutEpoch,
    unifiedPublicationBlockedFromDate: row.unifiedPublicationBlockedFromDate,
    unifiedPublicationBlockedSource: row.unifiedPublicationBlockedSource,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Must run after lockProfile in the final candidate transaction. */
export async function assertUnifiedSourceFenceV1(
  client: DbClient,
  profileId: number,
  expected: UnifiedSourceFenceV1 | null,
): Promise<void> {
  const current = await readUnifiedSourceFenceV1(client, profileId);
  if (stableFence(current) !== stableFence(expected)) throw new PhysiologyV7ConcurrentSourceChangeError();
}

/** Persist one derived child under the shared source fence and invalidate only Unified. */
export async function persistUnifiedShadowCandidateV1(input: {
  client: PrismaClient;
  profileId: number;
  expectedFence: UnifiedSourceFenceV1 | null;
  persist: (tx: Prisma.TransactionClient) => Promise<boolean>;
}): Promise<boolean> {
  return input.client.$transaction(async (tx) => {
    const lifecycle = new PhysiologyV7PersistenceRepository(tx);
    await lifecycle.lockProfile(input.profileId);
    await assertUnifiedSourceFenceV1(tx, input.profileId, input.expectedFence);
    const changed = await input.persist(tx);
    if (changed) await lifecycle.invalidateUnifiedPublication(input.profileId);
    return changed;
  });
}

function stableFence(value: UnifiedSourceFenceV1 | null): string {
  if (value === null) return "null";
  return JSON.stringify([
    value.invalidationGeneration,
    value.unifiedPublishedGeneration,
    value.unifiedTargetRevision,
    value.unifiedRolloutEpoch,
    value.unifiedPublishedRolloutEpoch,
    value.unifiedPublicationBlockedFromDate,
    value.unifiedPublicationBlockedSource,
    value.updatedAt,
  ]);
}

export class PhysiologyV7PersistenceRepository {
  constructor(private readonly client: DbClient = prisma) {}

  private async withProfileLock<T>(profileId: number, action: (client: DbClient) => Promise<T>): Promise<T> {
    if (isPrismaClient(this.client)) {
      return this.client.$transaction(async (tx) => {
        const repository = new PhysiologyV7PersistenceRepository(tx);
        await repository.lockProfile(profileId);
        return action(tx);
      });
    }
    await this.lockProfile(profileId);
    return action(this.client);
  }

  private async refreshUnifiedPublicationBlockSummary(client: DbClient, profileId: number): Promise<void> {
    const lifecycle = await client.physiologyV7Lifecycle.findUnique({ where: { profileId }, select: { profileId: true } });
    if (!lifecycle) return;
    const blocks = await client.unifiedPublicationBlock.findMany({
      where: { profileId }, orderBy: [{ fromDate: "asc" }, { source: "asc" }], select: { fromDate: true, source: true },
    });
    const firstDate = blocks[0]?.fromDate ?? null;
    const firstSources = [...new Set(blocks.filter((block) => block.fromDate === firstDate).map((block) => block.source))];
    const firstSource = firstSources.length === 0 ? null : firstSources.length === 1 ? firstSources[0]! : "multiple";
    await client.$executeRaw`
      UPDATE "PhysiologyV7Lifecycle"
      SET "unifiedPublicationBlockedFromDate" = ${firstDate},
          "unifiedPublicationBlockedSource" = ${firstSource},
          "unifiedPublishedGeneration" = CASE WHEN CAST(${firstDate} AS date) IS NULL THEN "unifiedPublishedGeneration" ELSE NULL END,
          "unifiedPublishedRolloutEpoch" = CASE WHEN CAST(${firstDate} AS date) IS NULL THEN "unifiedPublishedRolloutEpoch" ELSE NULL END,
          "updatedAt" = GREATEST("updatedAt" + INTERVAL '1 millisecond', CURRENT_TIMESTAMP)
      WHERE "profileId" = ${profileId}
    `;
  }

  async lockProfile(profileId: number): Promise<void> {
    const workerLease = getHealthSyncRefreshWorkerLease();
    if (workerLease && (workerLease.profileId !== profileId || isPrismaClient(this.client))) {
      throw new HealthSyncRefreshWorkerLeaseLostError();
    }
    // Recovery takes this same transaction-scoped profile lock while checking
    // Health queue and Unified currentness, then holds it through its effect.
    // Worker mutations additionally validate and row-lock their exact durable
    // lease through the lifecycle mutation.
    await this.client.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${PHYSIOLOGY_V7_PROFILE_LOCK_NAMESPACE} AS integer), CAST(${profileId} AS integer))`;
    if (workerLease) {
      const ownedJobs = await this.client.$queryRaw<Array<{ profileId: number }>>`
        SELECT "profileId"
        FROM "HealthSyncRefreshJob"
        WHERE "profileId" = ${workerLease.profileId}
          AND "requestedGeneration" = ${workerLease.requestedGeneration}
          AND "leaseToken" = ${workerLease.leaseToken}
          AND "leaseUntil" > ${new Date()}
        FOR UPDATE
      `;
      if (ownedJobs.length !== 1) throw new HealthSyncRefreshWorkerLeaseLostError();
    }
  }

  /**
   * Water-only derived-state inputs do not stale production TDEE, but they do
   * make the published Unified snapshot unusable. Keep this publication gate
   * in the source mutation transaction and under the same profile lock used by
   * Unified readers/writers; updatedAt is the existing row's CAS marker.
   */
  async invalidateUnifiedPublication(profileId: number): Promise<void> {
    if (!this.client.physiologyV7Lifecycle || typeof this.client.$executeRaw !== "function") return;
    await this.lockProfile(profileId);
    await this.client.$executeRaw`
      UPDATE "PhysiologyV7Lifecycle"
      SET "unifiedPublishedGeneration" = NULL,
          "unifiedPublishedRolloutEpoch" = NULL,
          "updatedAt" = GREATEST("updatedAt" + INTERVAL '1 millisecond', CURRENT_TIMESTAMP)
      WHERE "profileId" = ${profileId}
    `;
  }

  /** Persist a failed required child refresh so a later unrelated writer cannot publish over it. */
  async blockUnifiedPublication(input: {
    profileId: number;
    fromDate: string;
    source: "health" | "training" | "day" | "stepper";
    sourceKey: string;
  }): Promise<void> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fromDate) || input.sourceKey.length < 1 || input.sourceKey.length > 100) {
      throw new Error("Unified publication block identity is malformed.");
    }
    await this.withProfileLock(input.profileId, async (client) => {
      const lifecycle = await client.physiologyV7Lifecycle.findUnique({ where: { profileId: input.profileId }, select: { profileId: true } });
      if (!lifecycle) return;
      const existing = await client.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: { profileId: input.profileId, source: input.source, sourceKey: input.sourceKey } },
        select: { fromDate: true },
      });
      const earliestFromDate = existing?.fromDate !== undefined && existing.fromDate < input.fromDate
        ? existing.fromDate
        : input.fromDate;
      await client.unifiedPublicationBlock.upsert({
        where: { profileId_source_sourceKey: { profileId: input.profileId, source: input.source, sourceKey: input.sourceKey } },
        create: { profileId: input.profileId, source: input.source, sourceKey: input.sourceKey, fromDate: earliestFromDate },
        update: { fromDate: earliestFromDate, revision: { increment: 1 } },
      });
      await this.refreshUnifiedPublicationBlockSummary(client, input.profileId);
    });
  }

  async readUnifiedPublicationBlockToken(input: {
    profileId: number;
    source: "health" | "training" | "day" | "stepper";
    sourceKey: string;
  }): Promise<{ revision: number; fromDate: string } | null> {
    return this.client.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId: input.profileId, source: input.source, sourceKey: input.sourceKey } },
      select: { revision: true, fromDate: true },
    });
  }

  /** A cleared source fence need not be recreated when another durable fence
   * still blocks the shared candidate. That other operation will retry the
   * final publication after its own dependencies are refreshed. */
  async hasUnifiedPublicationBlocks(profileId: number): Promise<boolean> {
    return (await this.client.unifiedPublicationBlock.findFirst({
      where: { profileId }, select: { profileId: true },
    })) !== null;
  }

  async readUnifiedPublicationFence(profileId: number): Promise<{ invalidationGeneration: number; updatedAt: string } | null> {
    const lifecycle = await this.client.physiologyV7Lifecycle.findUnique({
      where: { profileId }, select: { invalidationGeneration: true, updatedAt: true },
    });
    return lifecycle === null ? null : {
      invalidationGeneration: lifecycle.invalidationGeneration,
      updatedAt: lifecycle.updatedAt.toISOString(),
    };
  }

  /** Restore a cleared source fence only while its generation is still current and unpublished. */
  async restoreUnifiedPublicationBlocksIfCurrent(input: {
    profileId: number;
    expectedGeneration: number;
    expectedUpdatedAt: string;
    blocks: readonly { fromDate: string; source: "health"; sourceKey: string }[];
  }): Promise<boolean> {
    if (input.blocks.length === 0) return false;
    for (const block of input.blocks) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(block.fromDate) || block.sourceKey.length < 1 || block.sourceKey.length > 100) {
        throw new Error("Unified publication block identity is malformed.");
      }
    }
    return this.withProfileLock(input.profileId, async (client) => {
      const lifecycle = await client.physiologyV7Lifecycle.findUnique({
        where: { profileId: input.profileId },
        select: {
          invalidationGeneration: true,
          updatedAt: true,
          productionStaleFromDate: true,
          productionPublishedGeneration: true,
          unifiedPublishedGeneration: true,
          unifiedRolloutEpoch: true,
          unifiedPublishedRolloutEpoch: true,
          unifiedPublicationBlockedFromDate: true,
        },
      });
      if (!lifecycle || lifecycle.invalidationGeneration !== input.expectedGeneration
          || lifecycle.updatedAt.toISOString() !== input.expectedUpdatedAt) return false;
      const alreadyCurrent = lifecycle.productionStaleFromDate === null
        && lifecycle.productionPublishedGeneration === input.expectedGeneration
        && lifecycle.unifiedPublishedGeneration === input.expectedGeneration
        && lifecycle.unifiedPublishedRolloutEpoch === lifecycle.unifiedRolloutEpoch
        && lifecycle.unifiedPublicationBlockedFromDate === null;
      if (alreadyCurrent) return false;
      if (await client.unifiedPublicationBlock.findFirst({
        where: { profileId: input.profileId }, select: { profileId: true },
      })) return false;

      for (const block of input.blocks) {
        await client.unifiedPublicationBlock.create({
          data: {
            profileId: input.profileId,
            source: block.source,
            sourceKey: block.sourceKey,
            fromDate: block.fromDate,
          },
        });
      }
      await this.refreshUnifiedPublicationBlockSummary(client, input.profileId);
      return true;
    });
  }

  /** A retry clears only the exact durable source operation it fully reprocessed. */
  async clearUnifiedPublicationBlock(input: {
    profileId: number;
    source: "health" | "training" | "day" | "stepper";
    sourceKey: string;
    expectedRevision: number;
    expectedFromDate: string;
  }): Promise<boolean> {
    return this.withProfileLock(input.profileId, async (client) => {
      const changed = await client.unifiedPublicationBlock.deleteMany({
        where: {
          profileId: input.profileId, source: input.source, sourceKey: input.sourceKey,
          revision: input.expectedRevision, fromDate: input.expectedFromDate,
        },
      });
      if (changed.count > 0) await this.refreshUnifiedPublicationBlockSummary(client, input.profileId);
      return changed.count === 1;
    });
  }

  async ensureLifecycle(profileId: number, requestedFromDate: string) {
    const current = await this.client.physiologyV7Lifecycle.upsert({
      where: { profileId },
      create: {
        profileId,
        staleFromDate: requestedFromDate,
        productionStaleFromDate: requestedFromDate,
        ...currentPhysiologyV7Versions,
      },
      update: {},
    });
    if (versionsAreCurrent(current)) return current;
    const earliest = await this.client.physiologyV7DailyResult.findFirst({
      where: { profileId }, orderBy: { date: "asc" }, select: { date: true },
    });
    return this.client.physiologyV7Lifecycle.update({
      where: { profileId },
      data: {
        staleFromDate: mergeEarliestStaleDate(current.staleFromDate, earliest?.date ?? requestedFromDate),
        invalidationGeneration: { increment: 1 },
        ...currentPhysiologyV7Versions,
      },
    });
  }

  async invalidate(profileId: number, affectedDate: string): Promise<LifecycleInvalidationState> {
    if (isPrismaClient(this.client)) {
      return this.client.$transaction((transaction) =>
        new PhysiologyV7PersistenceRepository(transaction).invalidate(profileId, affectedDate));
    }

    // The lifecycle bootstrap/version check and the invalidation update share
    // the caller's source transaction. The profile lock also serializes that
    // bootstrap with concurrent rebuild preparation; the date merge itself is
    // still performed atomically by PostgreSQL below.
    await this.lockProfile(profileId);
    await this.ensureLifecycle(profileId, affectedDate);

    const earliestDirtyDate = Prisma.sql`
      CASE
        WHEN "staleFromDate" IS NULL THEN ${affectedDate}
        ELSE LEAST("staleFromDate", ${affectedDate})
      END
    `;
    const earliestProductionDirtyDate = Prisma.sql`
      CASE
        WHEN "productionStaleFromDate" IS NULL THEN ${affectedDate}
        ELSE LEAST("productionStaleFromDate", ${affectedDate})
      END
    `;
    const updated = await this.client.$queryRaw<LifecycleInvalidationState[]>`
      UPDATE "PhysiologyV7Lifecycle"
      SET
        "staleFromDate" = ${earliestDirtyDate},
        "productionStaleFromDate" = ${earliestProductionDirtyDate},
        "currentThroughDate" = CASE
          WHEN "currentThroughDate" IS NOT NULL
            AND "currentThroughDate" >= ${earliestDirtyDate}
          THEN TO_CHAR((${earliestDirtyDate})::date - 1, 'YYYY-MM-DD')
          ELSE "currentThroughDate"
        END,
        "invalidationGeneration" = "invalidationGeneration" + 1,
        "unifiedPublishedGeneration" = NULL,
        "unifiedPublishedRolloutEpoch" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "profileId" = ${profileId}
      RETURNING "profileId", "staleFromDate", "invalidationGeneration", "currentThroughDate",
        "productionStaleFromDate", "productionPublishedGeneration", "unifiedPublishedGeneration"
    `;
    const lifecycle = updated[0];
    if (lifecycle === undefined) {
      throw new Error(`physiology lifecycle missing for profile ${profileId} during invalidation`);
    }
    return lifecycle;
  }

  async publishProduction(input: {
    profileId: number;
    expectedGeneration: number;
  }): Promise<void> {
    const result = await this.client.physiologyV7Lifecycle.updateMany({
      where: { profileId: input.profileId, invalidationGeneration: input.expectedGeneration },
      data: {
        productionStaleFromDate: null,
        productionPublishedGeneration: input.expectedGeneration,
      },
    });
    if (result.count !== 1) throw new PhysiologyV7ConcurrentSourceChangeError();
  }

  async readRange(profileId: number, fromDate: string, toDate: string) {
    const [lifecycle, rows] = await Promise.all([
      this.client.physiologyV7Lifecycle.findUnique({ where: { profileId } }),
      this.client.physiologyV7DailyResult.findMany({
        where: { profileId, date: { gte: fromDate, lte: toDate } },
        orderBy: { date: "asc" },
      }),
    ]);
    const lifecycleCompatible = lifecycle === null || versionsAreCurrent(lifecycle);
    return rows.map((row) => {
      const compatible = versionsAreCurrent(row);
      const stale = !compatible || !lifecycleCompatible || (lifecycle?.staleFromDate !== null
        && lifecycle?.staleFromDate !== undefined && row.date >= lifecycle.staleFromDate);
      return {
        status: stale ? "stale" as const : "current" as const,
        date: row.date,
        resultFingerprint: row.resultFingerprint,
        result: deserializePhysiologyDayResultV7(row.result),
      };
    });
  }

  async readDay(profileId: number, date: string) {
    const rows = await this.readRange(profileId, date, date);
    return rows[0] ?? { status: "missing" as const, date, resultFingerprint: null, result: null };
  }

  async persistRange(input: {
    profileId: number;
    expectedGeneration: number;
    rebuiltThroughDate: string;
    days: readonly PhysiologyDayResultV7[];
  }): Promise<void> {
    const lifecycle = await this.client.physiologyV7Lifecycle.findUniqueOrThrow({
      where: { profileId: input.profileId },
    });
    if (lifecycle.invalidationGeneration !== input.expectedGeneration) {
      throw new PhysiologyV7ConcurrentSourceChangeError();
    }
    for (const day of input.days) {
      const resultFingerprint = persistedResultFingerprint(day);
      const data = {
        sourceFingerprint: day.inputSourceFingerprint,
        priorStateFingerprint: day.priorStateFingerprint,
        resultFingerprint,
        ...currentPhysiologyV7Versions,
        result: serializePhysiologyDayResultV7(day) as Prisma.InputJsonValue,
        computedAt: new Date(),
      };
      await this.client.physiologyV7DailyResult.upsert({
        where: { profileId_date: { profileId: input.profileId, date: day.date } },
        create: { profileId: input.profileId, date: day.date, ...data },
        update: data,
      });
    }
    const firstRebuiltDate = input.days[0]?.date;
    if (firstRebuiltDate === undefined || firstRebuiltDate > input.rebuiltThroughDate) {
      throw new RangeError("persisted v7 rebuild must contain its rebuilt range");
    }
    const staleWasRebuilt = lifecycle.staleFromDate !== null && lifecycle.staleFromDate >= firstRebuiltDate
      && lifecycle.staleFromDate <= input.rebuiltThroughDate;
    // Partial replay at the stale point leaves its dependent suffix stale.
    const staleFromDate = staleWasRebuilt && lifecycle.currentThroughDate !== null
      && lifecycle.currentThroughDate > input.rebuiltThroughDate
      ? addCalendarDays(input.rebuiltThroughDate, 1)
      : lifecycle.staleFromDate !== null && lifecycle.staleFromDate > input.rebuiltThroughDate
        ? lifecycle.staleFromDate
        : null;
    const currentThroughDate = staleFromDate === null
      ? input.rebuiltThroughDate
      : input.rebuiltThroughDate;
    const promoted = await this.client.physiologyV7Lifecycle.updateMany({
      where: { profileId: input.profileId, invalidationGeneration: input.expectedGeneration },
      data: {
        staleFromDate,
        currentThroughDate,
        ...currentPhysiologyV7Versions,
      },
    });
    if (promoted.count !== 1) throw new PhysiologyV7ConcurrentSourceChangeError();
  }
}

export const physiologyV7PersistenceRepository = new PhysiologyV7PersistenceRepository();
