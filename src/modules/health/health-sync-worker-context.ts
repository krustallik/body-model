import { AsyncLocalStorage } from "node:async_hooks";

export type HealthSyncRefreshWorkerLease = Readonly<{
  profileId: number;
  requestedGeneration: number;
  leaseToken: string;
}>;

const currentLease = new AsyncLocalStorage<HealthSyncRefreshWorkerLease>();

export class HealthSyncRefreshWorkerLeaseLostError extends Error {
  constructor() {
    super("Health sync refresh worker no longer owns the durable generation under the Unified lifecycle fence.");
    this.name = "HealthSyncRefreshWorkerLeaseLostError";
  }
}

/** Keep the exact durable job identity available to transaction-level lifecycle mutations. */
export function runWithHealthSyncRefreshWorkerLease<T>(
  lease: HealthSyncRefreshWorkerLease,
  action: () => Promise<T>,
): Promise<T> {
  return currentLease.run(lease, action);
}

export function getHealthSyncRefreshWorkerLease(): HealthSyncRefreshWorkerLease | undefined {
  return currentLease.getStore();
}
