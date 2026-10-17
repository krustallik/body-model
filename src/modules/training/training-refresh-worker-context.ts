import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";

export type TrainingRefreshWorkerLease = Readonly<{
  profileId: number;
  requestedGeneration: number;
  leaseToken: string;
}>;

const currentLease = new AsyncLocalStorage<TrainingRefreshWorkerLease>();

export class TrainingRefreshWorkerLeaseLostError extends Error {
  constructor() {
    super("Training refresh worker no longer owns the durable generation under the physiology profile fence.");
    this.name = "TrainingRefreshWorkerLeaseLostError";
  }
}

/** Makes the exact claimed job identity available to every fenced write transaction. */
export function runWithTrainingRefreshWorkerLease<T>(
  lease: TrainingRefreshWorkerLease,
  action: () => Promise<T>,
): Promise<T> {
  return currentLease.run(lease, action);
}

export function getTrainingRefreshWorkerLease(): TrainingRefreshWorkerLease | undefined {
  return currentLease.getStore();
}

/** Recheck the exact worker lease inside the same profile-fenced write transaction. */
export async function assertTrainingRefreshWorkerLeaseInTransaction(
  client: Prisma.TransactionClient,
  profileId: number,
): Promise<void> {
  const lease = currentLease.getStore();
  if (lease === undefined) return;
  if (lease.profileId !== profileId) throw new TrainingRefreshWorkerLeaseLostError();
  const rows = await client.$queryRaw<Array<{ owned: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "TrainingRefreshJob"
      WHERE "profileId" = ${lease.profileId}
        AND "requestedGeneration" = ${lease.requestedGeneration}
        AND "requestedGeneration" > "completedGeneration"
        AND "leaseToken" = ${lease.leaseToken}
        AND "leaseUntil" > clock_timestamp()
    ) AS owned
  `;
  if (rows[0]?.owned !== true) throw new TrainingRefreshWorkerLeaseLostError();
}
