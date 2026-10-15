import { describe, expect, it } from "vitest";
import { currentness, DATABASE_DIGEST, IMAGE_DIGEST, makeRecoveryCase, OLD_APP_SHA } from "./helpers/recovery-health-currentness-fixture.mjs";
describe("recovery Health queue and Unified V4 gates", () => {
  it.each(["recovery-start-readonly-app", "recovery-open-traffic"])(
    "blocks %s with zero programless sessions when the Health queue is pending",
    async (operationType) => {
      const fixture = makeRecoveryCase({ operationType,
        overrides: { currentness: { healthCompletedGeneration: 7, healthRequestedGeneration: 8 } } });
      await expect(fixture.broker.dispatch(fixture.request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
      expect(fixture.effectCount()).toBe(0);
    },
  );

  it.each(["recovery-open-traffic", "recovery-verify-completion-gates"])(
    "allows %s only when the queue is complete and V4 current",
    async (operationType) => {
      const fixture = makeRecoveryCase({ operationType });
      const result = await fixture.broker.dispatch(fixture.request);
      expect(result.operationCompletion).toMatchObject({ result: "executed" });
      expect(fixture.effectCount()).toBe(1);
      expect(fixture.fenceCalls).toHaveLength(1);
      expect(fixture.fenceCalls.every((call) => call.operationId === fixture.intent.operationId
        && call.releaseSha === OLD_APP_SHA && call.imageDigest === IMAGE_DIGEST
        && call.logicalProductionDbIdentityDigest === DATABASE_DIGEST
        && call.fenceSnapshotProtocol === "read-committed-post-lock-v1")).toBe(true);
    },
  );

  it("rechecks a receipted transition under the currentness fence before returning success", async () => {
    const fixture = makeRecoveryCase({ receiptedTransition: true });
    const request = { schemaVersion: 1, operation: "recovery-transition", requestId: "already-receipted-transition",
      recoveryCaseId: fixture.record.recoveryCaseId, transition: fixture.record.transition,
      expectedGeneration: fixture.record.generation - 1, expectedRecordDigest: "9".repeat(64),
      evidenceId: fixture.record.operationEvidenceId, authorizationEnvelope: null, policyAttestation: null,
      rolloutReceiptId: "rollout-health" };

    const result = await fixture.broker.dispatch(request);

    expect(result.operationReceipt.operationId).toBe(fixture.intent.operationId);
    expect(result.operationCompletion).toBeNull();
    expect(fixture.fenceCalls).toHaveLength(1);
    expect(fixture.effectCount()).toBe(0);
  });

  it("blocks traffic when the queue is complete but V4 publication is stale", async () => {
    const fixture = makeRecoveryCase({ overrides: { currentness: { unifiedCurrent: false,
      unifiedPublishedGeneration: 90, unifiedPublishedSourceDigest: "6".repeat(64) } } });
    await expect(fixture.broker.dispatch(fixture.request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.effectCount()).toBe(0);
  });

  it("blocks traffic when lifecycle markers are current but the V4 source fingerprint changed", async () => {
    const fixture = makeRecoveryCase({ overrides: { currentness: {
      unifiedPublishedSourceDigest: "6".repeat(64),
      unifiedCurrentSourceDigest: "7".repeat(64),
    } } });
    await expect(fixture.broker.dispatch(fixture.request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.effectCount()).toBe(0);
  });

  it.each([
    ["logical database identity", { logicalProductionDbIdentityDigest: "6".repeat(64) }],
    ["rollback app SHA", { releaseSha: "a".repeat(40) }],
    ["rollback image digest", { imageDigest: "7".repeat(64) }],
    ["operation ID", { operationId: "8".repeat(64) }],
    ["operation type", { operationType: "recovery-complete" }],
    ["journal generation", { journalGeneration: 8 }],
    ["journal record digest", { journalRecordDigest: "9".repeat(64) }],
    ["fence snapshot protocol", { fenceSnapshotProtocol: "repeatable-read-before-lock" }],
    ["legacy evidence schema", { schemaVersion: 1 }],
  ])("fails closed when currentness evidence is bound to a different %s", async (_binding, evidenceOverride) => {
    const fixture = makeRecoveryCase({ overrides: { currentness: evidenceOverride } });
    await expect(fixture.broker.dispatch(fixture.request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.effectCount()).toBe(0);
  });

  it("rejects a Health generation change visible at the fenced read", async () => {
    const fixture = makeRecoveryCase({ overrides: { currentness: {
      healthRequestedGeneration: 9, healthCompletedGeneration: 8,
    } } });
    await expect(fixture.broker.dispatch(fixture.request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.fenceCalls).toHaveLength(1);
    expect(fixture.effectCount()).toBe(0);
  });

  it("rejects a Unified V4 invalidation visible at the fenced read", async () => {
    const fixture = makeRecoveryCase({ overrides: { currentness: {
      unifiedCurrent: false, unifiedInvalidationGeneration: 92,
      unifiedProductionPublishedGeneration: 91, unifiedPublishedGeneration: 91,
    } } });
    await expect(fixture.broker.dispatch(fixture.request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.fenceCalls).toHaveLength(1);
    expect(fixture.effectCount()).toBe(0);
  });

  it("does not let a receipted replay bypass current queue and V4 guards", async () => {
    const fixture = makeRecoveryCase({ receipt: { operationId: "already-completed" },
      overrides: { currentness: { healthLeasePresent: true } } });
    await expect(fixture.broker.dispatch(fixture.request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.fenceCalls).toHaveLength(1);
    expect(fixture.effectCount()).toBe(0);
  });

  it("keeps finalized recovery marker-removal retries behind current Health/V4 guards", async () => {
    const fixture = makeRecoveryCase({ finalized: true,
      overrides: { currentness: { healthRequestedGeneration: 9, healthCompletedGeneration: 8 } } });
    const request = { schemaVersion: 1, operation: "recovery-finalize", requestId: "finalize-health-retry",
      recoveryCaseId: fixture.record.recoveryCaseId, expectedGeneration: fixture.record.generation,
      expectedRecordDigest: fixture.record.recordDigest, evidenceId: "finalize-evidence" };
    await expect(fixture.broker.dispatch(request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.fenceCalls).toHaveLength(1);
    expect(fixture.finalizedRecordReads()).toBe(1);
    expect(fixture.finalizeCount()).toBe(0);
  });

  it("fails closed when a finalized journal tail cannot be read by exact identity", async () => {
    const fixture = makeRecoveryCase({ finalized: true, finalizedRecordReader: false });
    const request = { schemaVersion: 1, operation: "recovery-finalize", requestId: "finalize-no-tail-reader",
      recoveryCaseId: fixture.record.recoveryCaseId, expectedGeneration: fixture.record.generation,
      expectedRecordDigest: fixture.record.recordDigest, evidenceId: "finalize-evidence" };
    await expect(fixture.broker.dispatch(request)).rejects.toThrow(/cannot read the exact finalized journal tail/);
    expect(fixture.fenceCalls).toHaveLength(0);
    expect(fixture.finalizeCount()).toBe(0);
  });

  it.each([false, true])("requires fresh adapter conformance before %s finalization", async (finalized) => {
    const fixture = makeRecoveryCase({ finalized, receipt: { operationId: "open-traffic-receipt" },
      preparationOverrides: { operationAdapterConformanceDigest: "8".repeat(64) } });
    const request = { schemaVersion: 1, operation: "recovery-finalize", requestId: `finalize-stale-${finalized}`,
      recoveryCaseId: fixture.record.recoveryCaseId, expectedGeneration: fixture.record.generation,
      expectedRecordDigest: fixture.record.recordDigest, evidenceId: "finalize-evidence" };
    await expect(fixture.broker.dispatch(request)).rejects.toThrow(/does not bind the installed adapter's current conformance receipt/);
    expect(fixture.fenceCalls).toHaveLength(1);
    expect(fixture.fenceCalls[0]?.operationType).toBe("recovery-finalize");
    expect(fixture.finalizeCount()).toBe(0);
    expect(fixture.conformanceCalls()).toBe(1);
  });

  it("fails closed when adapter conformance evidence is unavailable during finalization", async () => {
    const fixture = makeRecoveryCase({ finalized: true, adapterConformance: null });
    const request = { schemaVersion: 1, operation: "recovery-finalize", requestId: "finalize-no-adapter-receipt",
      recoveryCaseId: fixture.record.recoveryCaseId, expectedGeneration: fixture.record.generation,
      expectedRecordDigest: fixture.record.recordDigest, evidenceId: "finalize-evidence" };
    await expect(fixture.broker.dispatch(request)).rejects.toThrow(/no current verified operation-conformance evidence/);
    expect(fixture.finalizeCount()).toBe(0);
    expect(fixture.fenceCalls).toHaveLength(1);
  });

  it.each([false, true])("finalizes %s recovery only with current conformance and exact currentness evidence", async (finalized) => {
    const fixture = makeRecoveryCase({ finalized, receipt: { operationId: "open-traffic-receipt" } });
    const request = { schemaVersion: 1, operation: "recovery-finalize", requestId: `finalize-current-${finalized}`,
      recoveryCaseId: fixture.record.recoveryCaseId, expectedGeneration: fixture.record.generation,
      expectedRecordDigest: fixture.record.recordDigest, evidenceId: "finalize-evidence" };
    const result = await fixture.broker.dispatch(request);
    expect(result.ok).toBe(true);
    expect(fixture.finalizeCount()).toBe(1);
    expect(fixture.fenceCalls).toHaveLength(1);
    expect(fixture.fenceCalls[0]?.operationType).toBe("recovery-finalize");
    expect(fixture.preparationCalls()).toBe(1);
    expect(fixture.conformanceCalls()).toBe(1);
  });

  it("leaves a committed transition pending when currentness fails, then permits only a freshly guarded replay", async () => {
    let currentnessCalls = 0;
    const fixture = makeRecoveryCase({ overrides: { currentness: (expected) => {
      currentnessCalls += 1;
      return currentness(expected, currentnessCalls === 1
        ? { healthRequestedGeneration: 9, healthCompletedGeneration: 8 } : {});
    } } });
    const transitionRequest = { schemaVersion: 1, operation: "recovery-transition", requestId: "complete-health-transition",
      recoveryCaseId: fixture.record.recoveryCaseId, transition: fixture.record.transition,
      expectedGeneration: fixture.record.generation - 1, expectedRecordDigest: "9".repeat(64),
      evidenceId: fixture.record.operationEvidenceId, authorizationEnvelope: null, policyAttestation: null,
      rolloutReceiptId: "rollout-health" };
    await expect(fixture.broker.dispatch(transitionRequest)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.committed()).toBe(true);
    expect(fixture.fenceCalls).toHaveLength(1);
    expect(fixture.effectCount()).toBe(0);

    const replayRequest = { schemaVersion: 1, operation: "recovery-operation-replay", requestId: "complete-health-replay",
      recoveryCaseId: fixture.record.recoveryCaseId, expectedGeneration: fixture.record.generation,
      expectedRecordDigest: fixture.record.recordDigest, operationId: fixture.intent.operationId };
    const replay = await fixture.broker.dispatch(replayRequest);
    expect(replay.operationCompletion).toMatchObject({ result: "executed" });
    expect(fixture.committed()).toBe(true);
    expect(fixture.fenceCalls).toHaveLength(2);
    expect(fixture.effectCount()).toBe(1);
  });
});
