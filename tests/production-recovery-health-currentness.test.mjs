import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../scripts/production-recovery/canonical.mjs";
import { createProductionOperationBroker } from "../scripts/production-recovery/operation-broker.mjs";
import { OPERATION_ADAPTER_CONTRACT_DIGEST, OPERATION_CONTRACTS } from "../scripts/production-recovery/operation-contracts.mjs";

const OLD_APP_SHA = "f910d2a45dfa676fada5fab42c9e8946c97872b1";
const DATABASE_DIGEST = "c".repeat(64);
const IMAGE_DIGEST = "d".repeat(64);
const SOURCE_DIGEST = "e".repeat(64);
const ADAPTER = Object.freeze({ current: true, adapterDigest: "a".repeat(64), receiptDigest: "b".repeat(64),
  contractDigest: OPERATION_ADAPTER_CONTRACT_DIGEST, expiresAt: "2999-01-01T00:00:00.000Z" });

function currentness(expected, overrides = {}) {
  return {
    schemaVersion: 1,
    purpose: "bodycast-recovery-health-sync-currentness",
    profileId: 1,
    operationType: expected.operationType,
    operationId: expected.operationId,
    recoveryCaseId: expected.recoveryCaseId,
    journalGeneration: expected.journalGeneration,
    journalRecordDigest: expected.journalRecordDigest,
    logicalProductionDbIdentityDigest: expected.logicalProductionDbIdentityDigest,
    releaseSha: expected.releaseSha,
    imageDigest: expected.imageDigest,
    healthRequestedGeneration: 8,
    healthCompletedGeneration: 8,
    healthLeasePresent: false,
    healthLastErrorType: null,
    healthLastErrorAt: null,
    unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
    unifiedInvalidationGeneration: 91,
    unifiedProductionStaleFromDate: null,
    unifiedProductionPublishedGeneration: 91,
    unifiedPublishedGeneration: 91,
    unifiedRolloutEpoch: 4,
    unifiedPublishedRolloutEpoch: 4,
    unifiedPublicationBlockedFromDate: null,
    unifiedPublicationBlockCount: 0,
    unifiedPublishedSourceDigest: SOURCE_DIGEST,
    unifiedCurrentSourceDigest: SOURCE_DIGEST,
    unifiedCurrent: true,
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRecoveryCase({ operationType = "recovery-open-traffic", overrides = {}, receipt = null, finalized = false,
  preparationOverrides = {}, adapterConformance = ADAPTER, finalizedRecordReader = true } = {}) {
  const transition = operationType === "recovery-open-traffic" ? "open-traffic"
    : operationType === "recovery-start-readonly-app" ? "mark-rollback-app-ready" : "complete-recovery";
  const recoveryCaseId = "recovery-health-case";
  const generation = 7;
  const journalRecordDigest = "f".repeat(64);
  const evidence = { type: transition, fixture: "exact-recovery-evidence" };
  const immutableRollbackArtifact = { rollbackArtifactId: "backup-fixture", rollbackArtifactDigest: "1".repeat(64),
    rollbackImageDigest: IMAGE_DIGEST };
  const sourceEvidenceDigest = canonicalDigest(evidence);
  const operationInputDigest = canonicalDigest({ schemaVersion: 1, recoveryCaseId, transition, operationType,
    sourceEvidenceDigest, immutableRollbackArtifact, logicalProductionDbIdentityDigest: DATABASE_DIGEST });
  const operationId = canonicalDigest({ recoveryCaseId, generation, transition, operationType, operationInputDigest });
  const intent = { schemaVersion: 1, operationType, operationInputDigest, operationId };
  const record = { recoveryCaseId, generation, recordDigest: journalRecordDigest,
    nextState: finalized ? "recovery-finalized" : transition === "open-traffic" ? "traffic-open"
      : transition === "mark-rollback-app-ready" ? "app-ready" : "recovery-complete", transition,
    sourceEvidenceDigest, rollbackAppSha: OLD_APP_SHA,
    immutableRollbackArtifact, logicalProductionDbIdentityDigest: DATABASE_DIGEST,
    operationIntent: finalized ? null : intent,
    operationEvidenceId: finalized ? null : "recovery-health-evidence" };
  let observedState = receipt ? "post" : "pre";
  let effectCount = 0;
  let finalizeCount = 0;
  let committed = false;
  let inHealthFence = false;
  let preparationCalls = 0;
  let conformanceCalls = 0;
  let finalizedRecordReads = 0;
  const fenceCalls = [];
  const operationDefinition = OPERATION_CONTRACTS[operationType];
  const conditionFor = (input, state) => {
    const values = {
      ...input.bindings,
      imageDigest: IMAGE_DIGEST,
      releaseSha: OLD_APP_SHA,
      healthStatus: "healthy",
      integrityDigest: "2".repeat(64),
      routeDigest: "3".repeat(64),
      trafficTargetImageDigest: IMAGE_DIGEST,
      markerState: "recovery-complete",
      writerMode: "enabled",
    };
    const keys = state === "pre" ? operationDefinition.preconditionKeys : operationDefinition.postconditionKeys;
    return Object.fromEntries(keys.map((key) => [key, values[key] ?? (key.toLowerCase().endsWith("digest") ? "4".repeat(64) : "fixture-value")]));
  };
  const operationObservation = (input) => {
    const state = observedState;
    const precondition = state === "pre" ? conditionFor(input, state) : null;
    const postcondition = state === "post" ? conditionFor(input, state) : null;
    return { schemaVersion: 1, purpose: "bodycast-host-operation-state", operationType,
      operationId, idempotencyKey: operationId, operationInputDigest, state,
      observedAt: new Date().toISOString(),
      stateDigest: canonicalDigest({ state: state === "pre" ? operationDefinition.preState : operationDefinition.postState,
        precondition, postcondition }), precondition, postcondition };
  };
  const authority = {
    readAuthoritativeState: async () => ({ blocking: !finalized, activeRecovery: !finalized, state: record.nextState }),
    readPendingOperation: async () => finalized ? null : ({ record, intent,
      operationEvidenceId: record.operationEvidenceId, receipt }),
    ...(finalizedRecordReader ? { readFinalizedRecoveryRecord: async (identity) => {
      finalizedRecordReads += 1;
      if (identity.recoveryCaseId !== record.recoveryCaseId || identity.generation !== record.generation
        || identity.recordDigest !== record.recordDigest) throw new Error("finalized record identity mismatch");
      return record;
    } } : {}),
    applyTransition: async () => { committed = true; return { record }; },
    executePendingOperation: async (identity, execute) => {
      const outcome = await execute({ record, intent });
      receipt = { operationId: identity.operationId, outcomeDigest: canonicalDigest(outcome) };
      return { receipt, outcome, executed: true };
    },
    finalizeRecovery: async (request) => { finalizeCount += 1; return { ok: true, request }; },
  };
  const broker = createProductionOperationBroker({
    authority,
    verifyReviewedRelease: async () => true,
    readCanonicalMainTipSha: async () => OLD_APP_SHA,
    verifyCurrentReaderRollout: async () => ({ current: true }),
    verifyRecoveryPreparation: async () => {
      preparationCalls += 1;
      return { ready: true, operationAdapterDigest: ADAPTER.adapterDigest,
        operationAdapterConformanceDigest: ADAPTER.receiptDigest, ...preparationOverrides };
    },
    verifyForwardMigrationAuthorization: async () => false,
    captureMigrationExecutionState: async () => { throw new Error("not used"); },
    verifyMigrationExecutionProof: async () => null,
    verifyMigrationFinalGuards: async () => false,
    verifyRecoveryOperationFinalGuards: async () => true,
    verifyProgramlessSessionRollbackCompatibility: async () => ({
      logicalProductionDbIdentityDigest: DATABASE_DIGEST, programlessSessionCount: 0,
      rollbackAppSupportsProgramlessSessions: false, programlessSessionCompatible: true,
      rollbackAppCapabilityDigest: "5".repeat(64), observedAt: new Date().toISOString(),
    }),
    withRecoveryCurrentnessFence: async (expected) => {
      fenceCalls.push(expected);
      expect(expected.healthSyncFenceNamespace).toBe(0x42434153);
      expect(expected.unifiedLifecycleFenceNamespace).toBe(927001);
      inHealthFence = true;
      try {
        const raw = typeof overrides.currentness === "function"
          ? overrides.currentness(expected, fenceCalls.length)
          : currentness(expected, overrides.currentness ?? {});
        return await expected.execute(raw);
      } finally {
        inHealthFence = false;
      }
    },
    verifyUnifiedV4Currentness: async () => null,
    inspectFixedOperationState: async (_type, input) => operationObservation(input),
    loadEvidenceById: async () => evidence,
    loadAuthorizationById: async () => null,
    loadRolloutReceiptById: async () => null,
    executeFixedOperation: async (_type, input) => {
      await input.authorizeImmediatelyBeforeEffect();
      expect(inHealthFence).toBe(true);
      effectCount += 1;
      observedState = "post";
      const postcondition = conditionFor(input, "post");
      return { schemaVersion: 1, purpose: "bodycast-host-operation-success", operationType,
        operationId, idempotencyKey: operationId, operationInputDigest, result: "executed", postcondition };
    },
    assertAdapterConformanceCurrent: async () => { conformanceCalls += 1; return adapterConformance; },
  });
  const request = { schemaVersion: 1, operation: "recovery-operation-replay", requestId: "health-replay-1",
    recoveryCaseId, expectedGeneration: generation, expectedRecordDigest: journalRecordDigest, operationId };
  return { broker, request, fenceCalls, effectCount: () => effectCount, finalizeCount: () => finalizeCount,
    finalizedRecordReads: () => finalizedRecordReads,
    preparationCalls: () => preparationCalls, conformanceCalls: () => conformanceCalls,
    committed: () => committed, record, intent };
}

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
      expect(fixture.fenceCalls).toHaveLength(2);
      expect(fixture.fenceCalls.every((call) => call.operationId === fixture.intent.operationId
        && call.releaseSha === OLD_APP_SHA && call.imageDigest === IMAGE_DIGEST
        && call.logicalProductionDbIdentityDigest === DATABASE_DIGEST)).toBe(true);
    },
  );

  it("blocks traffic when the queue is complete but V4 publication is stale", async () => {
    const fixture = makeRecoveryCase({ overrides: { currentness: { unifiedCurrent: false,
      unifiedPublishedGeneration: 90, unifiedPublishedSourceDigest: "6".repeat(64) } } });
    await expect(fixture.broker.dispatch(fixture.request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.effectCount()).toBe(0);
  });

  it("rechecks currentness under the effect fence and rejects a Health generation change between checks", async () => {
    const fixture = makeRecoveryCase({ overrides: { currentness: (expected, call) => currentness(expected,
      call === 1 ? {} : { healthRequestedGeneration: 9, healthCompletedGeneration: 8 }) } });
    await expect(fixture.broker.dispatch(fixture.request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.fenceCalls).toHaveLength(2);
    expect(fixture.effectCount()).toBe(0);
  });

  it("rejects a Unified V4 invalidation between recovery preflight and effect fence", async () => {
    const fixture = makeRecoveryCase({ overrides: { currentness: (expected, call) => currentness(expected,
      call === 1 ? {} : { unifiedCurrent: false, unifiedInvalidationGeneration: 92,
        unifiedProductionPublishedGeneration: 91, unifiedPublishedGeneration: 91 }) } });
    await expect(fixture.broker.dispatch(fixture.request)).rejects.toThrow(/idle Health refresh queue and fresh, unblocked Unified V4/);
    expect(fixture.fenceCalls).toHaveLength(2);
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
    expect(fixture.fenceCalls).toHaveLength(3);
    expect(fixture.effectCount()).toBe(1);
  });
});
