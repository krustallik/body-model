import { canonicalDigest } from "../../scripts/production-recovery/canonical.mjs";
import { createProductionOperationBroker } from "../../scripts/production-recovery/operation-broker.mjs";
import { OPERATION_ADAPTER_CONTRACT_DIGEST, OPERATION_CONTRACTS } from "../../scripts/production-recovery/operation-contracts.mjs";
export const OLD_APP_SHA = "f910d2a45dfa676fada5fab42c9e8946c97872b1";
export const DATABASE_DIGEST = "c".repeat(64);
export const IMAGE_DIGEST = "d".repeat(64);
export const SOURCE_DIGEST = "e".repeat(64);
export const ADAPTER = Object.freeze({ current: true, adapterDigest: "a".repeat(64), receiptDigest: "b".repeat(64),
  contractDigest: OPERATION_ADAPTER_CONTRACT_DIGEST, expiresAt: "2999-01-01T00:00:00.000Z" });

export function currentness(expected, overrides = {}) {
  return {
    schemaVersion: 2,
    purpose: "bodycast-recovery-health-sync-currentness",
    fenceSnapshotProtocol: "read-committed-post-lock-v1",
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

export function makeRecoveryCase({ databaseDigest = DATABASE_DIGEST, operationType = "recovery-open-traffic", overrides = {}, receipt = null, finalized = false,
  receiptedTransition = false,
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
    sourceEvidenceDigest, immutableRollbackArtifact, logicalProductionDbIdentityDigest: databaseDigest });
  const operationId = canonicalDigest({ recoveryCaseId, generation, transition, operationType, operationInputDigest });
  const intent = { schemaVersion: 1, operationType, operationInputDigest, operationId };
  const record = { recoveryCaseId, generation, recordDigest: journalRecordDigest,
    nextState: finalized ? "recovery-finalized" : transition === "open-traffic" ? "traffic-open"
      : transition === "mark-rollback-app-ready" ? "app-ready" : "recovery-complete", transition,
    sourceEvidenceDigest, rollbackAppSha: OLD_APP_SHA,
    immutableRollbackArtifact, logicalProductionDbIdentityDigest: databaseDigest,
    operationIntent: finalized ? null : intent,
    operationEvidenceId: finalized ? null : "recovery-health-evidence" };
  let observedState = receipt ? "post" : "pre";
  let effectCount = 0;
  let finalizeCount = 0;
  let committed = false;
  let inProfileFence = false;
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
      if (receiptedTransition) {
        return { receipt: { operationId: identity.operationId, outcomeDigest: "7".repeat(64) },
          outcome: null, executed: false };
      }
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
      logicalProductionDbIdentityDigest: databaseDigest, programlessSessionCount: 0,
      rollbackAppSupportsProgramlessSessions: false, programlessSessionCompatible: true,
      rollbackAppCapabilityDigest: "5".repeat(64), observedAt: new Date().toISOString(),
    }),
    withRecoveryCurrentnessFence: async (expected) => {
      fenceCalls.push(expected);
      if (expected.unifiedLifecycleFenceNamespace !== 927001) throw new Error("Unexpected recovery lifecycle fence namespace.");
      inProfileFence = true;
      try {
        if (typeof overrides.withRecoveryCurrentnessFence === "function") {
          return await overrides.withRecoveryCurrentnessFence(expected, currentness);
        }
        const raw = typeof overrides.currentness === "function"
          ? overrides.currentness(expected, fenceCalls.length)
          : currentness(expected, overrides.currentness ?? {});
        return await expected.execute(raw);
      } finally {
        inProfileFence = false;
      }
    },
    verifyUnifiedV4Currentness: async () => null,
    inspectFixedOperationState: async (_type, input) => operationObservation(input),
    loadEvidenceById: async () => evidence,
    loadAuthorizationById: async () => null,
    loadRolloutReceiptById: async () => null,
    executeFixedOperation: async (_type, input) => {
      await input.authorizeImmediatelyBeforeEffect();
      if (!inProfileFence) throw new Error("Recovery host effect escaped the profile currentness fence.");
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
