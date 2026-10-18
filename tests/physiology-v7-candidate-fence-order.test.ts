import { describe, expect, it, vi } from "vitest";
import {
  persistUnifiedShadowCandidateV1,
  type UnifiedSourceFenceV1,
} from "@/modules/model-episodes/physiology-v7-persistence.repository";

describe("generation candidate persistence lock boundary", () => {
  it("runs candidate progress before taking the shared source/job lock", async () => {
    const events: string[] = [];
    let profileLockHeld = false;
    const fence: UnifiedSourceFenceV1 = {
      invalidationGeneration: 4,
      unifiedPublishedGeneration: 3,
      unifiedTargetRevision: "test-revision",
      unifiedRolloutEpoch: 2,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublicationBlockedFromDate: null,
      unifiedPublicationBlockedSource: null,
      updatedAt: "2026-10-16T10:00:00.000Z",
    };
    const lifecycle = {
      findUnique: vi.fn().mockResolvedValue({
        ...fence,
        updatedAt: new Date(fence.updatedAt),
      }),
    };
    const transaction = {
      physiologyV7Lifecycle: lifecycle,
      $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join(" ");
        if (sql.includes("pg_advisory_xact_lock")) {
          profileLockHeld = true;
          events.push("profile-lock");
        }
        return 1;
      }),
    };
    const client = {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<boolean>) => callback(transaction)),
    };

    await persistUnifiedShadowCandidateV1({
      client: client as never,
      profileId: 1,
      expectedFence: fence,
      persist: async () => {
        events.push("candidate-start");
        expect(profileLockHeld).toBe(false);
        // This represents the durable worker progress UPDATE that used to
        // contend with a job row already locked by the candidate transaction.
        events.push("worker-progress");
        expect(profileLockHeld).toBe(false);
        events.push("candidate-finished");
        return true;
      },
    });

    expect(events.indexOf("candidate-finished")).toBeLessThan(events.indexOf("profile-lock"));
    expect(lifecycle.findUnique).toHaveBeenCalledTimes(2);
  });
});
