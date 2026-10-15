import type { Prisma } from "@prisma/client";

/** Shared with the protected recovery host adapter's exclusive DB fence. */
export const HEALTH_SYNC_FENCE_NAMESPACE = 0x42434153;

/**
 * Serialize Health source writes against recovery's read-only currentness gate.
 * The transaction-scoped shared advisory lock is held through the atomic raw
 * input, lifecycle invalidation, and durable refresh-job transaction.
 */
export async function acquireHealthSyncPersistenceFence(
  transaction: Pick<Prisma.TransactionClient, "$queryRaw">,
  profileId: number,
): Promise<void> {
  await transaction.$queryRaw`WITH acquired AS MATERIALIZED (
    SELECT pg_advisory_xact_lock_shared(${HEALTH_SYNC_FENCE_NAMESPACE}::integer, ${profileId}::integer)
  ) SELECT 1::integer FROM acquired`;
}
