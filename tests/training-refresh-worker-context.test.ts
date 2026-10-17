import { describe, expect, it, vi } from "vitest";
import {
  assertTrainingRefreshWorkerLeaseInTransaction,
  runWithTrainingRefreshWorkerLease,
  TrainingRefreshWorkerLeaseLostError,
} from "@/modules/training/training-refresh-worker-context";

const lease = { profileId: 1, requestedGeneration: 7, leaseToken: "lease-7" } as const;

describe("Training refresh transaction lease fence", () => {
  it("requires the exact live generation and token before a derived transaction writes", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ owned: false }]);
    const client = { $queryRaw: queryRaw } as never;

    await expect(runWithTrainingRefreshWorkerLease(
      lease,
      () => assertTrainingRefreshWorkerLeaseInTransaction(client, 1),
    )).rejects.toBeInstanceOf(TrainingRefreshWorkerLeaseLostError);
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("allows non-worker rebuild callers without consulting the durable queue", async () => {
    const queryRaw = vi.fn();
    const client = { $queryRaw: queryRaw } as never;

    await expect(assertTrainingRefreshWorkerLeaseInTransaction(client, 1)).resolves.toBeUndefined();
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
