import { afterEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalDigest, canonicalJson, sha256Hex, signCanonical, verifyCanonical } from "../scripts/production-recovery/canonical.mjs";
import { createProductionOperationBroker, validateProductionOperationRequest } from "../scripts/production-recovery/operation-broker.mjs";
import { parseOperationArguments } from "../scripts/production-recovery/host-operation-client.mjs";
import { createReaderRolloutReceipt, createReaderRolloutVerifier, REQUIRED_READER_ROLLOUT_FIXTURES } from "../scripts/production-recovery/rollout.mjs";
import { writeImmutableReceipt } from "../scripts/production-recovery/journal.mjs";
import {
  compareAuthorityVersions,
  installAuthorityPackageFixture,
  installAuthorityPackageFromRaw,
  verifyAuthorityInstallArtifact,
  verifyAuthorityInstallationReceipt,
  verifyInstalledAuthorityPackage,
} from "../scripts/production-recovery/install-provenance.mjs";
import { createFileBackedPolicyNonceConsumer } from "../scripts/production-recovery/policy-nonce-store.mjs";
import { quoteIdentifier, verifyReadOnlySchemaCompatibility } from "../scripts/production-recovery/schema-compatibility.mjs";
import { createRecoveryPolicySignerService } from "../scripts/production-recovery/policy-signer-service.mjs";
import { captureImmutableRollbackArtifact, assertExactRollbackArtifact } from "../scripts/production-recovery/artifact-identity.mjs";
import { createLogicalDatabaseIdentity, verifySameLogicalDatabaseIdentity } from "../scripts/production-recovery/database-identity.mjs";
import { createWriterDrainVerifier, verifyWriterDrainEvidence } from "../scripts/production-recovery/writer-drain.mjs";
import { createRecoveryHostRuntime, AUTHORITY_CONFIG_KEYS } from "../scripts/production-recovery/host-runtime.mjs";
import { OPERATION_ADAPTER_CONTRACT_DIGEST, OPERATION_CONTRACTS } from "../scripts/production-recovery/operation-contracts.mjs";

const roots = [];
async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bodycast-boundary-test-"));
  roots.push(root);
  return root;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

const FIXTURE_ADAPTER = Object.freeze({ current: true, adapterDigest: "a".repeat(64), receiptDigest: "b".repeat(64),
  contractDigest: OPERATION_ADAPTER_CONTRACT_DIGEST, expiresAt: "2999-01-01T00:00:00.000Z" });
const UNUSED_ADAPTER_CALLBACKS = Object.freeze({
  verifyReviewedRelease: async () => true,
  readCanonicalMainTipSha: async () => "a".repeat(40),
  verifyCurrentReaderRollout: async () => ({ current: true }),
  verifyRecoveryPreparation: async () => ({ ready: true, operationAdapterDigest: FIXTURE_ADAPTER.adapterDigest,
    operationAdapterConformanceDigest: FIXTURE_ADAPTER.receiptDigest }),
  verifyForwardMigrationAuthorization: async () => false,
  captureMigrationExecutionState: async () => { throw new Error("not used"); },
  verifyMigrationExecutionProof: async () => null,
  verifyMigrationFinalGuards: async () => false,
  verifyRecoveryOperationFinalGuards: async () => true,
  verifyUnifiedV4Currentness: async () => null,
  inspectFixedOperationState: async () => { throw new Error("not used"); },
  loadEvidenceById: async (id) => ({ type: "evidence-fixture", id }),
  loadAuthorizationById: async () => null,
  loadRolloutReceiptById: async (id) => ({ id, receiptDigest: "e".repeat(64) }),
  executeFixedOperation: async () => { throw new Error("not used"); },
  assertAdapterConformanceCurrent: async () => FIXTURE_ADAPTER,
});
const RESTORE_PRECONDITION = Object.freeze({ logicalProductionDbIdentityDigest: "c".repeat(64),
  backupArtifactDigest: "e".repeat(64), observedSchemaDigest: "8".repeat(64), observedMigrationHistoryDigest: "9".repeat(64) });
const RESTORE_POSTCONDITION = Object.freeze({ logicalProductionDbIdentityDigest: "c".repeat(64),
  backupArtifactDigest: "e".repeat(64), schemaDigest: "1".repeat(64), migrationHistoryDigest: "2".repeat(64),
  readOnlyCompatibilityDigest: "3".repeat(64) });

function restoreObservation(input, state) {
  const definition = OPERATION_CONTRACTS["recovery-restore-in-place"];
  const precondition = state === "pre" ? RESTORE_PRECONDITION : null;
  const postcondition = state === "post" ? RESTORE_POSTCONDITION : null;
  return { schemaVersion: 1, purpose: "bodycast-host-operation-state", operationType: "recovery-restore-in-place",
    operationId: input.operationId, idempotencyKey: input.operationId, operationInputDigest: input.operationInputDigest,
    state, observedAt: new Date().toISOString(),
    stateDigest: canonicalDigest({ state: state === "pre" ? definition.preState : definition.postState, precondition, postcondition }),
    precondition, postcondition };
}

function recoveryOperationIntent(evidence, artifact, { generation = 3, recoveryCaseId = "case-1" } = {}) {
  const transition = "begin-restore";
  const operationType = "recovery-restore-in-place";
  const sourceEvidenceDigest = canonicalDigest(evidence);
  const operationInputDigest = canonicalDigest({ schemaVersion: 1, recoveryCaseId, transition, operationType,
    sourceEvidenceDigest, immutableRollbackArtifact: artifact, logicalProductionDbIdentityDigest: "c".repeat(64) });
  const operationId = canonicalDigest({ recoveryCaseId, generation, transition, operationType, operationInputDigest });
  return { transition, operationType, sourceEvidenceDigest, operationInputDigest, operationId };
}

function brokerFixture({ blocking = false, prepared = true, rolloutCurrent = true, releaseValid = true,
  canonicalMainTipShaProvider = async () => "a".repeat(40),
  v4Evidence, now = () => Date.now(), proofResultOverride, adapterConformance = FIXTURE_ADAPTER,
  onMigrationFinalGuard, onAtomicMigrationConsumption, onAfterMigrationConsumption, onOperationCompletion,
  operationState = null, operationPostconditionOverride = null } = {}) {
  const calls = [];
  const states = new Map();
  const migrationGuardCalls = [];
  const migrationEvents = [];
  const routeEffects = [];
  const ordinaryReleaseEffects = [];
  let liveMarker = null;
  let pendingMigrationSetDigest = "f".repeat(64);
  const challenges = new Map();
  const consumedChallenges = new Map();
  const migrationCompletions = new Map();
  let migrationPostconditionOverride = operationPostconditionOverride;
  let operationStateOverride = operationState;
  const authority = {
    readAuthoritativeState: async () => ({ blocking: blocking || Boolean(liveMarker), activeRecovery: false,
      generation: 0, recordDigest: "0".repeat(64), legacyMarker: liveMarker }),
    issueMigrationChallenge: async (challenge) => { challenges.set(challenge.challengeId, challenge); },
    readMigrationChallenge: async (id) => challenges.get(id) ?? null,
    readMigrationChallengeConsumption: async (id) => consumedChallenges.get(id) ?? null,
    consumeMigrationChallenge: async (value) => {
      await onAtomicMigrationConsumption?.(value);
      const challenge = challenges.get(value.challengeId);
      const atomicTime = now();
      if (!challenge || challenge.challengeDigest !== value.challengeDigest
        || Date.parse(challenge.expiresAt) <= atomicTime || Date.parse(value.proofExpiresAt) <= atomicTime) {
        throw new Error("Migration challenge or proof expired at atomic consumption.");
      }
      if (consumedChallenges.has(value.challengeId)) {
        const existing = consumedChallenges.get(value.challengeId);
        if (Object.entries(value).some(([key, item]) => existing[key] !== item)) throw new Error("Consumed migration challenge mismatch.");
        return { consumed: false, receipt: existing };
      }
      const receipt = { ...value, consumedAt: new Date(atomicTime).toISOString() };
      consumedChallenges.set(value.challengeId, receipt);
      await onAfterMigrationConsumption?.(receipt);
      return { consumed: true, receipt };
    },
    readMigrationCompletion: async (id) => migrationCompletions.get(id) ?? null,
    completeMigrationChallenge: async (value) => {
      await onOperationCompletion?.(value);
      const existing = migrationCompletions.get(value.challengeId);
      if (existing) {
        if (canonicalDigest(existing.operationSuccess) !== canonicalDigest(value.operationSuccess)) {
          throw new Error("Migration completion outcome mismatch.");
        }
        return existing;
      }
      const receipt = { purpose: "bodycast-production-migration-completion", ...value };
      migrationCompletions.set(value.challengeId, receipt);
      return receipt;
    },
  };
  function operationObservation(operationType, input, state) {
    const definition = OPERATION_CONTRACTS[operationType];
    const precondition = operationType === "ordinary-release" ? {
      releaseSha: input.bindings.releaseSha,
      canonicalMainSha: input.bindings.canonicalMainSha,
      canonicalMainFence: input.bindings.canonicalMainFence,
      currentImageDigest: "f".repeat(64),
    } : operationType === "forward-migration" ? {
      releaseSha: input.bindings.releaseSha, manifestId: input.bindings.manifestId,
      logicalProductionDbIdentityDigest: input.bindings.logicalProductionDbIdentityDigest,
      pendingMigrationSetDigest: input.bindings.pendingMigrationSetDigest, markerState: "none",
    } : operationType === "traffic-serve" ? {
      releaseSha: input.bindings.releaseSha, imageDigest: "c".repeat(64), routeDigest: "f".repeat(64),
      unifiedV4CurrentnessDigest: input.bindings.unifiedV4CurrentnessDigest, markerState: input.bindings.markerState,
    } : null;
    const postcondition = operationType === "ordinary-release" ? {
      releaseSha: input.bindings.releaseSha,
      imageDigest: "c".repeat(64),
      containerId: "container-fixture",
      healthStatus: "healthy",
    } : operationType === "forward-migration" ? {
      releaseSha: input.bindings.releaseSha, manifestId: input.bindings.manifestId,
      logicalProductionDbIdentityDigest: input.bindings.logicalProductionDbIdentityDigest,
      pendingMigrationSetDigest: input.bindings.pendingMigrationSetDigest, schemaDigest: "1".repeat(64),
      migrationHistoryDigest: "2".repeat(64), finalGuardReceiptDigest: "3".repeat(64), markerState: "schema-applied",
    } : operationType === "traffic-serve" ? {
      releaseSha: input.bindings.releaseSha, imageDigest: "c".repeat(64), routeDigest: "f".repeat(64),
      unifiedV4CurrentnessDigest: input.bindings.unifiedV4CurrentnessDigest, healthStatus: "healthy", markerState: "app-ready",
    } : null;
    const actualPostcondition = operationType === "forward-migration" && migrationPostconditionOverride
      ? { ...postcondition, ...migrationPostconditionOverride } : postcondition;
    const normalizedState = state === "pre" ? definition.preState : state === "post" ? definition.postState : "other";
    const selectedPre = state === "pre" ? precondition : null;
    const selectedPost = state === "post" ? actualPostcondition : null;
    return { schemaVersion: 1, purpose: "bodycast-host-operation-state", operationType,
      operationId: input.operationId, idempotencyKey: input.operationId, operationInputDigest: input.operationInputDigest,
      state, observedAt: new Date(now()).toISOString(),
      stateDigest: canonicalDigest({ state: normalizedState, precondition: selectedPre, postcondition: selectedPost }),
      precondition: selectedPre, postcondition: selectedPost };
  }
  const broker = createProductionOperationBroker({
    authority,
    verifyReviewedRelease: async () => releaseValid,
    readCanonicalMainTipSha: canonicalMainTipShaProvider,
    verifyCurrentReaderRollout: async ({ allowAbsent }) => allowAbsent && !rolloutCurrent ? null : { current: rolloutCurrent },
    verifyRecoveryPreparation: async ({ allowAbsent }) => {
      if (allowAbsent && !prepared) return null;
      const current = typeof adapterConformance === "function" ? adapterConformance() : adapterConformance;
      return { ready: prepared, operationAdapterDigest: current?.adapterDigest ?? FIXTURE_ADAPTER.adapterDigest,
        operationAdapterConformanceDigest: current?.receiptDigest ?? FIXTURE_ADAPTER.receiptDigest };
    },
    verifyForwardMigrationAuthorization: async (authorization) => authorization?.purpose === "forward-migration",
    captureMigrationExecutionState: async ({ releaseSha, canonicalMainSha, migrationManifestId, authorizationContextId,
      expectedMarkerState = null }) => {
      const match = /^migration-([1-9][0-9]*)-([1-9][0-9]*)-([1-9][0-9]*)$/.exec(authorizationContextId ?? "");
      return { schemaVersion: 1, purpose: "bodycast-production-migration-live-state", releaseSha, canonicalMainSha,
        migrationManifestId, logicalProductionDbIdentityDigest: "d".repeat(64), markerState: expectedMarkerState,
        markerDigest: expectedMarkerState ? liveMarker?.digest ?? "e".repeat(64) : null, recoveryGeneration: 0,
        recoveryRecordDigest: "0".repeat(64), workflowId: match?.[1] ?? "1", workflowRunId: match?.[2] ?? "2",
        workflowRunAttempt: Number(match?.[3] ?? 1), pendingMigrationSetDigest, pendingMigrationCount: 2,
        observedAt: new Date().toISOString() };
    },
    verifyMigrationExecutionProof: async (token, { challenge, request }) => {
      const verified = { schemaVersion: 1, purpose: "bodycast-production-migration-execution-proof",
        verified: token === "header.payload.signature", challengeId: challenge.challengeId,
        challengeDigest: challenge.challengeDigest, nonceDigest: sha256Hex(challenge.nonce),
        releaseSha: request.releaseSha, canonicalMainSha: request.canonicalMainSha,
        migrationManifestId: request.migrationManifestId, authorizationContextId: request.authorizationContextId,
        workflowId: challenge.workflowId, workflowRunId: challenge.workflowRunId,
        workflowRunAttempt: challenge.workflowRunAttempt, tokenDigest: sha256Hex(token),
        issuedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 60_000).toISOString() };
      return typeof proofResultOverride === "function" ? proofResultOverride(verified) : { ...verified, ...proofResultOverride };
    },
    verifyMigrationFinalGuards: async (evidence) => {
      migrationGuardCalls.push(evidence);
      if (evidence.liveState?.markerState === "ddl-started") migrationEvents.push("boundary-guard-passed");
      await onMigrationFinalGuard?.(evidence);
      return true;
    },
    verifyRecoveryOperationFinalGuards: async () => true,
    verifyUnifiedV4Currentness: async ({ releaseSha, canonicalMainSha }) => {
      if (v4Evidence === null) return null;
      if (typeof v4Evidence === "function") return v4Evidence({ releaseSha, canonicalMainSha });
      return v4Evidence ?? ({ schemaVersion: 1, purpose: "bodycast-unified-v4-production-currentness", profileId: 1,
        releaseSha, canonicalMainSha, modelRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
        rolloutEpoch: 2, currentGeneration: 7, publishedGeneration: 7, publishedRolloutEpoch: 2,
        publishedSourceDigest: "d".repeat(64), currentSourceDigest: "d".repeat(64), current: true,
        observedAt: new Date(now()).toISOString() });
    },
    now,
    inspectFixedOperationState: async (operationType, input) => {
      const selectedState = typeof operationStateOverride === "function"
        ? operationStateOverride(operationType, input) : operationStateOverride;
      return operationObservation(operationType, input, selectedState ?? states.get(input.operationId) ?? "pre");
    },
    assertAdapterConformanceCurrent: async ({ preparation } = {}) => {
      const current = typeof adapterConformance === "function" ? adapterConformance() : adapterConformance;
      if (!current?.current || current.contractDigest !== OPERATION_ADAPTER_CONTRACT_DIGEST
        || current.adapterDigest !== FIXTURE_ADAPTER.adapterDigest || Date.parse(current.expiresAt) <= now()) {
        throw new Error("Adapter conformance is stale or invalid.");
      }
      if (preparation && (preparation.operationAdapterDigest !== current.adapterDigest
        || preparation.operationAdapterConformanceDigest !== current.receiptDigest)) {
        throw new Error("Preparation conformance binding is stale.");
      }
      return current;
    },
    loadEvidenceById: async (id) => ({ type: "evidence-fixture", id }),
    loadAuthorizationById: async (id) => id === "auth-1" || String(id).startsWith("migration-")
      ? { purpose: "forward-migration" } : { id },
    loadRolloutReceiptById: async (id) => ({ id }),
    executeFixedOperation: async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation === "ordinary-release") {
        await payload.authorizeImmediatelyBeforeEffect();
        ordinaryReleaseEffects.push(payload.operationId);
        const postcondition = { releaseSha: payload.releaseSha, imageDigest: "c".repeat(64),
          containerId: "container-fixture", healthStatus: "healthy" };
        states.set(payload.operationId, "post");
        return { schemaVersion: 1, purpose: "bodycast-host-operation-success", operationType: operation,
          operationId: payload.operationId, idempotencyKey: payload.operationId,
          operationInputDigest: payload.operationInputDigest, result: "executed", postcondition };
      }
      if (operation === "forward-migration") {
        const challenge = payload.challenge;
        liveMarker = { state: "ddl-started", releaseSha: payload.releaseSha, manifestId: payload.migrationManifestId,
          digest: "e".repeat(64) };
        migrationEvents.push("ddl-started-marker-written");
        await payload.authorizeImmediatelyBeforeEffect();
        migrationEvents.push("prisma-spawn-authorized");
        const postcondition = { releaseSha: payload.releaseSha, manifestId: payload.migrationManifestId,
          logicalProductionDbIdentityDigest: challenge.logicalProductionDbIdentityDigest,
          pendingMigrationSetDigest: challenge.pendingMigrationSetDigest, schemaDigest: "1".repeat(64),
          migrationHistoryDigest: "2".repeat(64), finalGuardReceiptDigest: "3".repeat(64), markerState: "schema-applied" };
        liveMarker = { ...liveMarker, state: "schema-applied" };
        states.set(payload.operationId, "post");
        return { schemaVersion: 1, purpose: "bodycast-host-operation-success", operationType: operation,
          operationId: payload.operationId, idempotencyKey: payload.operationId,
          operationInputDigest: payload.operationInputDigest, result: "executed", postcondition };
      }
      if (operation === "traffic-serve") {
        await payload.authorizeImmediatelyBeforeEffect();
        routeEffects.push({ operationId: payload.operationId, releaseSha: payload.releaseSha,
          currentnessDigest: payload.unifiedV4CurrentnessDigest });
        const postcondition = { releaseSha: payload.releaseSha, imageDigest: "c".repeat(64), routeDigest: "f".repeat(64),
          unifiedV4CurrentnessDigest: payload.unifiedV4CurrentnessDigest, healthStatus: "healthy",
          markerState: payload.bindings.markerState };
        states.set(payload.operationId, "post");
        return { schemaVersion: 1, purpose: "bodycast-host-operation-success", operationType: operation,
          operationId: payload.operationId, idempotencyKey: payload.operationId,
          operationInputDigest: payload.operationInputDigest, result: "executed", postcondition };
      }
      return { operation, accepted: true };
    },
  });
  return { broker, calls, authority, migrationGuardCalls, migrationEvents, routeEffects, ordinaryReleaseEffects,
    setPendingMigrationSetDigest(value) { pendingMigrationSetDigest = value; },
    setLiveMarker(value) { liveMarker = value; },
    setOperationState(value) { operationStateOverride = value; },
    setMigrationPostconditionOverride(value) { migrationPostconditionOverride = value; },
    getMigrationCompletion(id) { return migrationCompletions.get(id) ?? null; },
    getMigrationConsumption(id) { return [...consumedChallenges.values()].find((value) => value.challengeId === id) ?? null; } };
}

describe("production recovery install, rollout, and operation boundaries", () => {
  it("rejects arbitrary commands, paths, extra fields, and malformed typed requests", () => {
    expect(() => validateProductionOperationRequest({ schemaVersion: 1, operation: "docker", command: "docker rm -f all" }))
      .toThrow(/allowlist/);
    expect(() => validateProductionOperationRequest({
      schemaVersion: 1, operation: "ordinary-release", requestId: "req-1", releaseSha: "a".repeat(40),
      canonicalMainSha: "b".repeat(40), path: "/tmp/marker",
    })).toThrow(/closed schema/);
    expect(() => parseOperationArguments(["ordinary-release", "--request-id", "x", "--release-sha", "a".repeat(40),
      "--canonical-main-sha", "b".repeat(40), "--command", "docker"])).toThrow(/argument set/);
    expect(() => parseOperationArguments(["ordinary-release", "--request-id", "old-client",
      "--release-sha", "a".repeat(40), "--canonical-main-sha", "a".repeat(40),
      "--release-mode", "serving"])).toThrow(/incomplete|unknown fields/);
    const envelope = { claims: { purpose: "recovery Phase A restore-only" }, signature: "signature" };
    const parsed = parseOperationArguments([
      "recovery-transition", "--request-id", "phase-a", "--recovery-case-id", "case-1", "--transition", "authorize-restore",
      "--expected-generation", "1", "--expected-record-digest", "a".repeat(64), "--evidence-id", "evidence-1",
      "--authorization-envelope-b64", Buffer.from(JSON.stringify(envelope)).toString("base64"),
      "--policy-attestation-b64", Buffer.from("null").toString("base64"), "--rollout-receipt-id", "receipt-1",
    ]);
    expect(parsed.authorizationEnvelope).toEqual(envelope);
    expect(parsed.policyAttestation).toBeNull();
    expect(() => parseOperationArguments([
      "recovery-transition", "--request-id", "phase-a", "--recovery-case-id", "case-1", "--transition", "authorize-restore",
      "--expected-generation", "1", "--expected-record-digest", "a".repeat(64), "--evidence-id", "evidence-1",
      "--authorization-envelope-b64", Buffer.from('{"z":1,"a":2}').toString("base64"),
      "--policy-attestation-b64", Buffer.from("null").toString("base64"), "--rollout-receipt-id", "receipt-1",
    ])).toThrow(/canonical JSON/);
  });

  it("keeps ordinary release available before preparation but blocks on active recovery state", async () => {
    const fixture = brokerFixture({ prepared: false, rolloutCurrent: false });
    const result = await fixture.broker.dispatch({
      schemaVersion: 1, operation: "ordinary-release", requestId: "deploy-1", releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40),
      releaseMode: "serving", canonicalMainFence: "fresh-current-main-v1",
    });
    expect(result).toMatchObject({ purpose: "bodycast-host-operation-success", operationType: "ordinary-release",
      operationId: expect.any(String), result: "executed", postcondition: { healthStatus: "healthy" } });
    expect(fixture.calls).toHaveLength(1);

    const readiness = await fixture.broker.dispatch({ schemaVersion: 1, operation: "readiness", requestId: "ready-1" });
    expect(readiness).toMatchObject({ recoveryBlocking: false, rolloutCurrent: false, recoveryPrepared: false });
    await expect(fixture.broker.dispatch({
      schemaVersion: 1, operation: "migration-readiness", requestId: "migrate-ready-1",
      releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40), migrationManifestId: "manifest-v6",
    })).rejects.toThrow(/Forward migration readiness is blocked/);

    const missingConformance = brokerFixture({ adapterConformance: null });
    const unprepared = await missingConformance.broker.dispatch({ schemaVersion: 1, operation: "readiness", requestId: "ready-no-adapter-proof" });
    expect(unprepared.recoveryPrepared).toBe(false);
    await expect(missingConformance.broker.dispatch({
      schemaVersion: 1, operation: "migration-readiness", requestId: "migrate-ready-no-adapter-proof",
      releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40), migrationManifestId: "manifest-v6",
    })).rejects.toThrow(/no current verified operation-conformance evidence/);

    const blocked = brokerFixture({ blocking: true });
    await expect(blocked.broker.dispatch({
      schemaVersion: 1, operation: "ordinary-release", requestId: "deploy-2", releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40),
      releaseMode: "serving", canonicalMainFence: "fresh-current-main-v1",
    })).rejects.toThrow(/recovery state blocks/);
    expect(blocked.calls).toHaveLength(0);
  });

  it("rechecks live canonical main at the host effect boundary and blocks a superseded release", async () => {
    let reads = 0;
    const fixture = brokerFixture({ canonicalMainTipShaProvider: async () => {
      reads += 1;
      return reads === 1 ? "a".repeat(40) : "b".repeat(40);
    } });

    await expect(fixture.broker.dispatch({
      schemaVersion: 1, operation: "ordinary-release", requestId: "deploy-main-advanced",
      releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40), releaseMode: "serving",
      canonicalMainFence: "fresh-current-main-v1",
    })).rejects.toThrow(/Refusing stale ordinary release/);

    expect(reads).toBe(2);
    expect(fixture.ordinaryReleaseEffects).toHaveLength(0);
  });

  it("fails closed before host operation inspection when canonical main is already newer", async () => {
    const fixture = brokerFixture({ canonicalMainTipShaProvider: async () => "b".repeat(40) });
    await expect(fixture.broker.dispatch({
      schemaVersion: 1, operation: "ordinary-release", requestId: "deploy-already-stale",
      releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40), releaseMode: "serving",
      canonicalMainFence: "fresh-current-main-v1",
    })).rejects.toThrow(/Refusing stale ordinary release/);
    expect(fixture.calls).toHaveLength(0);
    expect(fixture.ordinaryReleaseEffects).toHaveLength(0);
  });

  it("revalidates adapter conformance at readiness, mutation, and the final effect boundary", async () => {
    let clockNow = Date.now();
    let currentReceipt = { ...FIXTURE_ADAPTER, expiresAt: new Date(clockNow + 1_000).toISOString() };
    const refreshed = brokerFixture({ now: () => clockNow, adapterConformance: () => currentReceipt });
    const initiallyReady = await refreshed.broker.dispatch({ schemaVersion: 1, operation: "readiness", requestId: "ready-current-adapter" });
    expect(initiallyReady.operationAdapterConformanceCurrent).toBe(true);
    clockNow += 1_001;
    const expiredReadiness = await refreshed.broker.dispatch({ schemaVersion: 1, operation: "readiness", requestId: "ready-expired-adapter" });
    expect(expiredReadiness).toMatchObject({ operationAdapterConformanceCurrent: false, recoveryPrepared: false });
    await expect(refreshed.broker.dispatch({ schemaVersion: 1, operation: "ordinary-release", requestId: "expired-adapter-deploy",
      releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40), releaseMode: "serving",
      canonicalMainFence: "fresh-current-main-v1" }))
      .rejects.toThrow(/no current verified operation-conformance evidence/);
    expect(refreshed.ordinaryReleaseEffects).toHaveLength(0);

    currentReceipt = { ...FIXTURE_ADAPTER, receiptDigest: "c".repeat(64), expiresAt: new Date(clockNow + 60_000).toISOString() };
    const restoredReadiness = await refreshed.broker.dispatch({ schemaVersion: 1, operation: "readiness", requestId: "ready-refreshed-adapter" });
    expect(restoredReadiness.operationAdapterConformanceCurrent).toBe(true);

    let conformanceReads = 0;
    const finalBoundary = brokerFixture({ adapterConformance: () => {
      conformanceReads += 1;
      return { ...FIXTURE_ADAPTER, expiresAt: new Date(conformanceReads === 1 ? Date.now() + 60_000 : Date.now() - 1).toISOString() };
    } });
    await expect(finalBoundary.broker.dispatch({ schemaVersion: 1, operation: "ordinary-release", requestId: "expires-at-effect",
      releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40), releaseMode: "serving",
      canonicalMainFence: "fresh-current-main-v1" }))
      .rejects.toThrow(/no current verified operation-conformance evidence/);
    expect(conformanceReads).toBe(2);
    expect(finalBoundary.ordinaryReleaseEffects).toHaveLength(0);

    for (const invalid of [
      { ...FIXTURE_ADAPTER, adapterDigest: "f".repeat(64) },
      { ...FIXTURE_ADAPTER, contractDigest: "f".repeat(64) },
    ]) {
      const wrongIdentity = brokerFixture({ adapterConformance: invalid });
      const readiness = await wrongIdentity.broker.dispatch({ schemaVersion: 1, operation: "readiness", requestId: "ready-wrong-adapter" });
      expect(readiness.operationAdapterConformanceCurrent).toBe(false);
    }
  });

  it("blocks forward migration until recovery prerequisites and forward-only authorization pass", async () => {
    const request = {
      schemaVersion: 1, operation: "forward-migration", requestId: "migration-1", releaseSha: "a".repeat(40),
      canonicalMainSha: "a".repeat(40), migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1",
      challengeId: "a".repeat(64), challengeDigest: "b".repeat(64), executionProof: "header.payload.signature",
    };
    const missing = brokerFixture({ prepared: false });
    await expect(missing.broker.dispatch(request)).rejects.toThrow(/recovery preparation/);
    expect(missing.calls).toHaveLength(0);

    const ready = brokerFixture();
    const missingChallenge = { ...request };
    delete missingChallenge.challengeId;
    await expect(ready.broker.dispatch(missingChallenge)).rejects.toThrow(/closed schema|challengeId/);
    expect(ready.calls).toHaveLength(0);

    const stale = brokerFixture({ releaseValid: false });
    await expect(stale.broker.dispatch(request)).rejects.toThrow(/stale, unreviewed/);
    expect(stale.calls).toHaveLength(0);
  });

  it("requires a fresh migration challenge, exact proof, unchanged state, and a durable marker boundary before Prisma", async () => {
    const releaseSha = "a".repeat(40);
    const challengeRequest = { schemaVersion: 1, operation: "migration-challenge", requestId: "migration-challenge-1",
      releaseSha, canonicalMainSha: releaseSha, migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1" };
    const issue = async (fixture) => fixture.broker.dispatch(challengeRequest);
    const makeForward = (challenge, proof = "header.payload.signature") => ({ schemaVersion: 1,
      operation: "forward-migration", requestId: "migration-forward-1", releaseSha, canonicalMainSha: releaseSha,
      migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1",
      challengeId: challenge.challengeId, challengeDigest: challenge.challengeDigest, executionProof: proof });

    const absent = brokerFixture();
    const absentRequest = { ...challengeRequest, operation: "forward-migration", challengeId: undefined,
      challengeDigest: undefined, executionProof: undefined };
    delete absentRequest.challengeId;
    delete absentRequest.challengeDigest;
    delete absentRequest.executionProof;
    await expect(absent.broker.dispatch(absentRequest)).rejects.toThrow(/closed schema|challengeId/);
    expect(absent.calls).toHaveLength(0);

    let clockNow = Date.now();
    const expired = brokerFixture({ now: () => clockNow });
    const expiredChallenge = (await issue(expired)).challenge;
    clockNow += 2 * 60_000 + 1;
    await expect(expired.broker.dispatch(makeForward(expiredChallenge))).rejects.toThrow(/stale or expired/);
    expect(expired.calls).toHaveLength(0);
    expect(expired.migrationGuardCalls).toHaveLength(0);

    const wrongProof = brokerFixture();
    const wrongProofChallenge = (await issue(wrongProof)).challenge;
    await expect(wrongProof.broker.dispatch(makeForward(wrongProofChallenge, "wrong.payload.signature")))
      .rejects.toThrow(/proof verifier did not bind|execution proof/);
    expect(wrongProof.calls).toHaveLength(0);

    const otherChallengeProof = brokerFixture({ proofResultOverride: { challengeId: "f".repeat(64) } });
    const otherChallenge = (await issue(otherChallengeProof)).challenge;
    await expect(otherChallengeProof.broker.dispatch(makeForward(otherChallenge)))
      .rejects.toThrow(/proof verifier did not bind/);
    expect(otherChallengeProof.calls).toHaveLength(0);

    const wrongTokenDigest = brokerFixture({ proofResultOverride: { tokenDigest: "9".repeat(64) } });
    const wrongTokenDigestChallenge = (await issue(wrongTokenDigest)).challenge;
    await expect(wrongTokenDigest.broker.dispatch(makeForward(wrongTokenDigestChallenge)))
      .rejects.toThrow(/proof verifier did not bind/);
    expect(wrongTokenDigest.calls).toHaveLength(0);

    const changedDb = brokerFixture();
    const changedDbChallenge = (await issue(changedDb)).challenge;
    changedDb.setPendingMigrationSetDigest("9".repeat(64));
    await expect(changedDb.broker.dispatch(makeForward(changedDbChallenge))).rejects.toThrow(/state changed after the challenge/);
    expect(changedDb.calls).toHaveLength(0);

    const changedMarker = brokerFixture();
    const changedMarkerChallenge = (await issue(changedMarker)).challenge;
    changedMarker.setLiveMarker({ state: "ddl-started", releaseSha, manifestId: "manifest-v6", digest: "e".repeat(64) });
    await expect(changedMarker.broker.dispatch(makeForward(changedMarkerChallenge))).rejects.toThrow(/recovery state|marker/);
    expect(changedMarker.calls).toHaveLength(0);

    const valid = brokerFixture();
    const challenge = (await issue(valid)).challenge;
    const forward = makeForward(challenge);
    const result = await valid.broker.dispatch(forward);
    expect(result.completion).toMatchObject({ result: "executed", operationType: "forward-migration",
      operationId: expect.any(String), postcondition: { markerState: "schema-applied" } });
    expect(valid.migrationEvents).toEqual(["ddl-started-marker-written", "boundary-guard-passed", "prisma-spawn-authorized"]);
    expect(valid.migrationGuardCalls).toHaveLength(2);
    expect(valid.migrationGuardCalls.at(-1).liveState.markerState).toBe("ddl-started");
    expect(valid.calls.filter((call) => call.operation === "forward-migration")).toHaveLength(1);

    const reconciled = await valid.broker.dispatch({ ...forward, requestId: "migration-forward-retry" });
    expect(reconciled).toMatchObject({ reconciled: true, completion: { result: "executed" },
      completionReceipt: result.completionReceipt });
    await expect(valid.broker.dispatch({ ...forward, executionProof: "another.payload.proof" }))
      .rejects.toThrow(/cannot reconcile another operation, release, database, or proof/);
    valid.setLiveMarker(null);
    await expect(valid.broker.dispatch({ ...forward, requestId: "migration-forward-consumed-without-marker" }))
      .rejects.toThrow(/consumed migration challenge cannot authorize a new migration execution/);
    expect(valid.calls.filter((call) => call.operation === "forward-migration")).toHaveLength(1);
  });

  it("rechecks challenge and proof expiry through final guards, atomic consumption, and the final effect boundary", async () => {
    const releaseSha = "a".repeat(40);
    const challengeRequest = { schemaVersion: 1, operation: "migration-challenge", requestId: "expiry-boundary-challenge",
      releaseSha, canonicalMainSha: releaseSha, migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1" };
    const makeForward = (challenge, requestId) => ({ schemaVersion: 1, operation: "forward-migration", requestId,
      releaseSha, canonicalMainSha: releaseSha, migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1",
      challengeId: challenge.challengeId, challengeDigest: challenge.challengeDigest, executionProof: "header.payload.signature" });
    const runFinalGuardExpiry = async (advance) => {
      let clockNow = Date.now();
      const fixture = brokerFixture({ now: () => clockNow, onMigrationFinalGuard: async (evidence) => {
        if (evidence.liveState?.markerState === "ddl-started") advance({ set: (value) => { clockNow = value; }, ...evidence });
      } });
      const challenge = (await fixture.broker.dispatch(challengeRequest)).challenge;
      const request = makeForward(challenge, "expiry-final-guard-forward");
      await expect(fixture.broker.dispatch(request)).rejects.toThrow(/expired/);
      expect(fixture.calls.filter((call) => call.operation === "forward-migration")).toHaveLength(1);
      expect(fixture.migrationEvents).toEqual(["ddl-started-marker-written", "boundary-guard-passed"]);
      expect(fixture.getMigrationConsumption(challenge.challengeId)).toBeNull();
    };

    await runFinalGuardExpiry(({ set, challenge }) => set(Date.parse(challenge.expiresAt) + 1));
    await runFinalGuardExpiry(({ set, proof }) => set(Date.parse(proof.expiresAt) + 1));

    let atomicClock = Date.now();
    const expiryAtAtomicConsume = brokerFixture({ now: () => atomicClock,
      onAtomicMigrationConsumption: async ({ challengeId }) => {
        // The signed verifier has returned and the final live guards passed; the authority lock observes this later time.
        const issued = expiryAtAtomicConsumeChallenge;
        if (issued?.challengeId === challengeId) atomicClock = Date.parse(issued.expiresAt) + 1;
      } });
    let expiryAtAtomicConsumeChallenge = null;
    expiryAtAtomicConsumeChallenge = (await expiryAtAtomicConsume.broker.dispatch(challengeRequest)).challenge;
    await expect(expiryAtAtomicConsume.broker.dispatch(makeForward(expiryAtAtomicConsumeChallenge, "expiry-atomic-forward")))
      .rejects.toThrow(/expired at atomic consumption/);
    expect(expiryAtAtomicConsume.getMigrationConsumption(expiryAtAtomicConsumeChallenge.challengeId)).toBeNull();
    expect(expiryAtAtomicConsume.migrationEvents).toEqual(["ddl-started-marker-written", "boundary-guard-passed"]);

    let postConsumeClock = Date.now();
    let postConsumeChallenge = null;
    const expiryAfterConsume = brokerFixture({ now: () => postConsumeClock,
      onAfterMigrationConsumption: async () => { postConsumeClock = Date.parse(postConsumeChallenge.expiresAt) + 1; } });
    postConsumeChallenge = (await expiryAfterConsume.broker.dispatch(challengeRequest)).challenge;
    await expect(expiryAfterConsume.broker.dispatch(makeForward(postConsumeChallenge, "expiry-after-consume-forward")))
      .rejects.toThrow(/expired at the migration effect boundary/);
    expect(expiryAfterConsume.getMigrationConsumption(postConsumeChallenge.challengeId)).toBeTruthy();
    expect(expiryAfterConsume.migrationEvents).toEqual(["ddl-started-marker-written", "boundary-guard-passed"]);
  });

  it("reconciles a completed migration after the response is lost without issuing DDL again", async () => {
    let loseFirstReceipt = true;
    const releaseSha = "a".repeat(40);
    const fixture = brokerFixture({ onOperationCompletion: async () => {
      if (loseFirstReceipt) {
        loseFirstReceipt = false;
        throw new Error("simulated lost completion response");
      }
    } });
    const challengeRequest = { schemaVersion: 1, operation: "migration-challenge", requestId: "lost-challenge",
      releaseSha, canonicalMainSha: releaseSha, migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1" };
    const challenge = (await fixture.broker.dispatch(challengeRequest)).challenge;
    const forward = { schemaVersion: 1, operation: "forward-migration", requestId: "lost-forward", releaseSha,
      canonicalMainSha: releaseSha, migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1",
      challengeId: challenge.challengeId, challengeDigest: challenge.challengeDigest, executionProof: "header.payload.signature" };
    await expect(fixture.broker.dispatch(forward)).rejects.toThrow(/simulated lost completion response/);
    expect(fixture.getMigrationConsumption(challenge.challengeId)).toBeTruthy();
    expect(fixture.getMigrationCompletion(challenge.challengeId)).toBeNull();
    expect(fixture.calls.filter((call) => call.operation === "forward-migration")).toHaveLength(1);

    const [reconciled, concurrentReconciliation] = await Promise.all([
      fixture.broker.dispatch({ ...forward, requestId: "lost-forward-reconcile" }),
      fixture.broker.dispatch({ ...forward, requestId: "lost-forward-reconcile-concurrent" }),
    ]);
    expect(reconciled).toMatchObject({ reconciled: true, completion: { result: "already-satisfied" },
      completionReceipt: { purpose: "bodycast-production-migration-completion" } });
    expect(concurrentReconciliation.completionReceipt).toEqual(reconciled.completionReceipt);
    expect(fixture.getMigrationCompletion(challenge.challengeId)).toBe(reconciled.completionReceipt);
    expect(fixture.calls.filter((call) => call.operation === "forward-migration")).toHaveLength(1);
    expect(fixture.migrationEvents.filter((event) => event === "prisma-spawn-authorized")).toHaveLength(1);
  });

  it("rejects migration reconciliation for a different binding or an incomplete post-state", async () => {
    const releaseSha = "a".repeat(40);
    const fixture = brokerFixture();
    const challenge = (await fixture.broker.dispatch({ schemaVersion: 1, operation: "migration-challenge",
      requestId: "binding-challenge", releaseSha, canonicalMainSha: releaseSha,
      migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1" })).challenge;
    const forward = { schemaVersion: 1, operation: "forward-migration", requestId: "binding-forward", releaseSha,
      canonicalMainSha: releaseSha, migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1",
      challengeId: challenge.challengeId, challengeDigest: challenge.challengeDigest, executionProof: "header.payload.signature" };
    await fixture.broker.dispatch(forward);

    await expect(fixture.broker.dispatch({ ...forward, requestId: "binding-other-proof", executionProof: "other.payload.proof" }))
      .rejects.toThrow(/cannot reconcile another operation, release, database, or proof/);
    await expect(fixture.broker.dispatch({ ...forward, requestId: "binding-other-release", releaseSha: "b".repeat(40),
      canonicalMainSha: "b".repeat(40) })).rejects.toThrow(/bound to another release, manifest, or workflow attempt/);
    await expect(fixture.broker.dispatch({ ...forward, requestId: "binding-other-manifest", migrationManifestId: "manifest-v7" }))
      .rejects.toThrow(/bound to another release, manifest, or workflow attempt/);
    await expect(fixture.broker.dispatch({ ...forward, requestId: "binding-other-challenge", challengeId: "f".repeat(64),
      challengeDigest: "f".repeat(64) })).rejects.toThrow(/exact broker-issued durable challenge/);

    fixture.setMigrationPostconditionOverride({ logicalProductionDbIdentityDigest: "9".repeat(64) });
    await expect(fixture.broker.dispatch({ ...forward, requestId: "binding-other-database" })).rejects.toThrow(/immutable logicalProductionDbIdentityDigest/);
    fixture.setMigrationPostconditionOverride(null);
    fixture.setOperationState("other");
    await expect(fixture.broker.dispatch({ ...forward, requestId: "binding-incomplete-state" }))
      .rejects.toThrow(/neither the exact precondition nor postcondition/);
    expect(fixture.calls.filter((call) => call.operation === "forward-migration")).toHaveLength(1);
    expect(fixture.migrationEvents.filter((event) => event === "prisma-spawn-authorized")).toHaveLength(1);
  });

  it("allows expired consumed proof only for exact read-only reconciliation and blocks expired unconsumed challenges", async () => {
    let clockNow = Date.now();
    const fixture = brokerFixture({ now: () => clockNow });
    const releaseSha = "a".repeat(40);
    const challengeRequest = { schemaVersion: 1, operation: "migration-challenge", requestId: "expiry-reconcile-challenge",
      releaseSha, canonicalMainSha: releaseSha, migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1" };
    const challenge = (await fixture.broker.dispatch(challengeRequest)).challenge;
    const forward = { schemaVersion: 1, operation: "forward-migration", requestId: "expiry-reconcile-forward", releaseSha,
      canonicalMainSha: releaseSha, migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1",
      challengeId: challenge.challengeId, challengeDigest: challenge.challengeDigest, executionProof: "header.payload.signature" };
    await fixture.broker.dispatch(forward);
    clockNow = Date.parse(challenge.expiresAt) + 1;
    const reconciled = await fixture.broker.dispatch({ ...forward, requestId: "expiry-reconcile-retry" });
    expect(reconciled.reconciled).toBe(true);
    expect(fixture.calls.filter((call) => call.operation === "forward-migration")).toHaveLength(1);

    let unconsumedNow = Date.now();
    const unconsumed = brokerFixture({ now: () => unconsumedNow });
    const unconsumedChallenge = (await unconsumed.broker.dispatch({ ...challengeRequest, requestId: "unconsumed-challenge" })).challenge;
    unconsumedNow = Date.parse(unconsumedChallenge.expiresAt) + 1;
    const unconsumedForward = { ...forward, requestId: "unconsumed-forward", challengeId: unconsumedChallenge.challengeId,
      challengeDigest: unconsumedChallenge.challengeDigest };
    await expect(unconsumed.broker.dispatch(unconsumedForward)).rejects.toThrow(/stale or expired/);
    unconsumed.setLiveMarker({ state: "ddl-started", releaseSha, manifestId: "manifest-v6", digest: "e".repeat(64) });
    await expect(unconsumed.broker.dispatch({ ...unconsumedForward, requestId: "unconsumed-reconcile" }))
      .rejects.toThrow(/expired or unconsumed/);
    expect(unconsumed.calls.filter((call) => call.operation === "forward-migration")).toHaveLength(0);
  });

  it("requires current adapter conformance for read-only lost-response inspection", async () => {
    let clockNow = Date.now();
    const conformance = { ...FIXTURE_ADAPTER, expiresAt: new Date(clockNow + 5_000).toISOString() };
    const fixture = brokerFixture({ now: () => clockNow, adapterConformance: () => conformance });
    const releaseSha = "a".repeat(40);
    const challenge = (await fixture.broker.dispatch({ schemaVersion: 1, operation: "migration-challenge",
      requestId: "inspect-conformance-challenge", releaseSha, canonicalMainSha: releaseSha,
      migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1" })).challenge;
    const forward = { schemaVersion: 1, operation: "forward-migration", requestId: "inspect-conformance-forward", releaseSha,
      canonicalMainSha: releaseSha, migrationManifestId: "manifest-v6", authorizationContextId: "migration-1-2-1",
      challengeId: challenge.challengeId, challengeDigest: challenge.challengeDigest, executionProof: "header.payload.signature" };
    await fixture.broker.dispatch(forward);
    clockNow += 5_001;
    await expect(fixture.broker.dispatch({ ...forward, requestId: "inspect-conformance-retry" }))
      .rejects.toThrow(/no current verified operation-conformance evidence/);
    expect(fixture.calls.filter((call) => call.operation === "forward-migration")).toHaveLength(1);
    expect(fixture.migrationEvents.filter((event) => event === "prisma-spawn-authorized")).toHaveLength(1);
  });

  it("gates the authoritative traffic-serve boundary on current Unified V4 state", async () => {
    const releaseSha = "a".repeat(40);
    const request = { schemaVersion: 1, operation: "traffic-serve", requestId: "serve-1", releaseSha,
      canonicalMainSha: releaseSha, authorizationContextId: "migration-1-2-1" };
    const marker = { state: "app-ready", releaseSha, manifestId: "manifest-v6", digest: "e".repeat(64) };

    const allowed = brokerFixture();
    allowed.setLiveMarker(marker);
    const served = await allowed.broker.dispatch(request);
    expect(served.completion).toMatchObject({ result: "executed", operationType: "traffic-serve",
      postcondition: { markerState: "app-ready", healthStatus: "healthy" } });
    expect(allowed.routeEffects).toHaveLength(1);

    for (const v4Evidence of [null,
      { schemaVersion: 1, purpose: "bodycast-unified-v4-production-currentness", profileId: 1,
        releaseSha, canonicalMainSha: releaseSha, modelRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
        rolloutEpoch: 2, currentGeneration: 7, publishedGeneration: 6, publishedRolloutEpoch: 2,
        publishedSourceDigest: "d".repeat(64), currentSourceDigest: "d".repeat(64), current: true,
        observedAt: new Date().toISOString() },
    ]) {
      const blocked = brokerFixture({ v4Evidence });
      blocked.setLiveMarker(marker);
      await expect(blocked.broker.dispatch(request)).rejects.toThrow();
      expect(blocked.routeEffects).toHaveLength(0);
    }

    let checks = 0;
    const baseEvidence = { schemaVersion: 1, purpose: "bodycast-unified-v4-production-currentness", profileId: 1,
      releaseSha, canonicalMainSha: releaseSha, modelRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      rolloutEpoch: 2, currentGeneration: 7, publishedGeneration: 7, publishedRolloutEpoch: 2,
      publishedSourceDigest: "d".repeat(64), currentSourceDigest: "d".repeat(64), current: true,
      observedAt: new Date().toISOString() };
    const changed = brokerFixture({ v4Evidence: () => {
      checks += 1;
      return checks === 1 ? baseEvidence : { ...baseEvidence, currentGeneration: 8, publishedGeneration: 8 };
    } });
    changed.setLiveMarker(marker);
    await expect(changed.broker.dispatch(request)).rejects.toThrow(/currentness changed/);
    expect(changed.routeEffects).toHaveLength(0);
  });

  it("passes only evidence identifiers through the fixed recovery transition interface", async () => {
    const calls = [];
    const broker = createProductionOperationBroker({
      authority: {
        readAuthoritativeState: async () => ({ blocking: true }),
        applyTransition: async (request) => { calls.push(request); return { record: { generation: 2 } }; },
      },
      ...UNUSED_ADAPTER_CALLBACKS,
      verifyReviewedRelease: async () => true,
      verifyCurrentReaderRollout: async () => ({ current: true }),
      verifyRecoveryPreparation: async () => ({ ready: true, operationAdapterDigest: FIXTURE_ADAPTER.adapterDigest,
        operationAdapterConformanceDigest: FIXTURE_ADAPTER.receiptDigest }),
      verifyForwardMigrationAuthorization: async () => false,
      captureMigrationExecutionState: async () => { throw new Error("not used"); },
      verifyMigrationExecutionProof: async () => null,
      verifyMigrationFinalGuards: async () => false,
      verifyRecoveryOperationFinalGuards: async () => true,
      verifyUnifiedV4Currentness: async () => null,
      inspectFixedOperationState: async () => { throw new Error("not used"); },
      adapterConformance: FIXTURE_ADAPTER,
      loadEvidenceById: async (id) => ({ type: "authorize-restore", id }),
      loadAuthorizationById: async (id) => ({ id }),
      loadRolloutReceiptById: async (id) => ({ id, receiptDigest: "c".repeat(64) }),
      executeFixedOperation: async () => { throw new Error("not used"); },
    });
    const request = {
      schemaVersion: 1, operation: "recovery-transition", requestId: "restore-1", recoveryCaseId: "case-1", transition: "authorize-restore",
      expectedGeneration: 1, expectedRecordDigest: "b".repeat(64), evidenceId: "evidence-1",
      authorizationEnvelope: { id: "envelope-1" }, policyAttestation: { id: "policy-1" }, rolloutReceiptId: "receipt-1",
    };
    await broker.dispatch({ schemaVersion: 1, operation: "readiness", requestId: "ready-1" });
    const result = await broker.dispatch(request);
    expect(result.record.generation).toBe(2);
    expect(calls[0]).toMatchObject({
      transition: "authorize-restore", expectedGeneration: 1, expectedRecordDigest: "b".repeat(64),
      evidence: { id: "evidence-1" }, envelope: { id: "envelope-1" }, policyAttestation: { id: "policy-1" },
      rolloutReceipt: { id: "receipt-1" },
    });
    await expect(broker.dispatch({ ...request, path: "/var/lib/bodycast/recovery/journal" })).rejects.toThrow(/closed schema/);
  });

  it("runs post-authorization mutations only through fixed host execution steps", async () => {
    const calls = [];
    const evidence = { type: "begin-restore" };
    const artifact = { rollbackArtifactId: "fixture-rollback-artifact", rollbackArtifactDigest: "e".repeat(64),
      rollbackImageDigest: "d".repeat(64) };
    const intent = recoveryOperationIntent(evidence, artifact);
    let applied = false;
    const record = { recoveryCaseId: "case-1", generation: 3, recordDigest: "f".repeat(64), nextState: "restore-in-progress",
      transition: intent.transition, sourceEvidenceDigest: intent.sourceEvidenceDigest, operationEvidenceId: "begin-evidence",
      manifestId: "case-1", rollbackAppSha: "a".repeat(40), immutableRollbackArtifact: artifact,
      logicalProductionDbIdentityDigest: "c".repeat(64), operationIntent: { schemaVersion: 1,
        operationType: intent.operationType, operationInputDigest: intent.operationInputDigest, operationId: intent.operationId } };
    const broker = createProductionOperationBroker({
      authority: {
        readAuthoritativeState: async () => ({ blocking: true, activeRecovery: true }),
        applyTransition: async () => ({ record }),
        executePendingOperation: async (request, execute) => {
          const outcome = await execute({ record, intent: record.operationIntent });
          return { receipt: { operationId: request.operationId, outcomeDigest: canonicalDigest(outcome) }, outcome, executed: true };
        },
      },
      ...UNUSED_ADAPTER_CALLBACKS,
      verifyCurrentReaderRollout: async () => ({ current: true }),
      verifyRecoveryPreparation: async () => ({ ready: true, operationAdapterDigest: FIXTURE_ADAPTER.adapterDigest,
        operationAdapterConformanceDigest: FIXTURE_ADAPTER.receiptDigest }),
      loadEvidenceById: async () => evidence,
      loadAuthorizationById: async () => null,
      loadRolloutReceiptById: async () => ({ receiptDigest: "e".repeat(64) }),
      inspectFixedOperationState: async (_operation, input) => restoreObservation(input, applied ? "post" : "pre"),
      executeFixedOperation: async (operation, payload) => {
        calls.push({ operation, payload });
        await payload.authorizeImmediatelyBeforeEffect();
        applied = true;
        return { schemaVersion: 1, purpose: "bodycast-host-operation-success", operationType: operation,
          operationId: payload.operationId, idempotencyKey: payload.operationId, operationInputDigest: payload.operationInputDigest,
          result: "executed", postcondition: RESTORE_POSTCONDITION };
      },
    });
    const result = await broker.dispatch({
      schemaVersion: 1, operation: "recovery-transition", requestId: "restore-1", recoveryCaseId: "case-1", transition: "begin-restore",
      expectedGeneration: 2, expectedRecordDigest: "d".repeat(64), evidenceId: "begin-evidence",
      authorizationEnvelope: null, policyAttestation: null, rolloutReceiptId: "rollout-1",
    });
    expect(result.record.nextState).toBe("restore-in-progress");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ operation: intent.operationType, payload: { operationId: intent.operationId,
      idempotencyKey: intent.operationId, operationInputDigest: intent.operationInputDigest,
      replayPolicy: OPERATION_CONTRACTS[intent.operationType].replayPolicy, recoveryCaseId: "case-1",
      journalGeneration: 3, journalRecordDigest: "f".repeat(64), immutableRollbackArtifact: artifact,
      logicalProductionDbIdentityDigest: "c".repeat(64), evidenceId: "begin-evidence", evidence } });
    calls.length = 0;
    await expect(broker.dispatch({
      schemaVersion: 1, operation: "recovery-transition", requestId: "restore-2", recoveryCaseId: "case-1", transition: "begin-restore",
      expectedGeneration: 2, expectedRecordDigest: "d".repeat(64), evidenceId: "../../etc/passwd",
      authorizationEnvelope: null, policyAttestation: null, rolloutReceiptId: "rollout-1",
    })).rejects.toThrow(/opaque fixed-format/);
    expect(calls).toHaveLength(0);
  });

  it("replays only the exact pending journal operation and reuses its idempotency key", async () => {
    const evidence = { type: "begin-restore", backupArtifactId: "backup-fixture-1" };
    const artifact = { rollbackArtifactId: "fixture-rollback-artifact", rollbackArtifactDigest: "e".repeat(64),
      rollbackImageDigest: "d".repeat(64) };
    const intentFields = recoveryOperationIntent(evidence, artifact);
    const { operationId, operationInputDigest, operationType, transition, sourceEvidenceDigest } = intentFields;
    let receipt = null;
    let evidenceMutated = false;
    const executionCalls = [];
    const record = {
      recoveryCaseId: "case-1", generation: 3, recordDigest: "f".repeat(64),
      transition, manifestId: "case-1", rollbackAppSha: "a".repeat(40), sourceEvidenceDigest,
      immutableRollbackArtifact: artifact,
      logicalProductionDbIdentityDigest: "c".repeat(64),
      operationIntent: { schemaVersion: 1, operationId, operationInputDigest, operationType },
    };
    const authority = {
      readAuthoritativeState: async () => ({ blocking: true, activeRecovery: true }),
      readPendingOperation: async () => ({ record, intent: record.operationIntent, operationEvidenceId: "evidence-1", receipt }),
      executePendingOperation: async (identity, execute) => {
        const outcome = await execute({ record, intent: record.operationIntent });
        receipt = { operationId: identity.operationId, outcomeDigest: canonicalDigest(outcome) };
        return { receipt, outcome, executed: true };
      },
    };
    const broker = createProductionOperationBroker({
      authority,
      ...UNUSED_ADAPTER_CALLBACKS,
      verifyReviewedRelease: async () => true,
      verifyCurrentReaderRollout: async () => ({ current: true }),
      verifyRecoveryPreparation: async () => ({ ready: true, operationAdapterDigest: FIXTURE_ADAPTER.adapterDigest,
        operationAdapterConformanceDigest: FIXTURE_ADAPTER.receiptDigest }),
      verifyForwardMigrationAuthorization: async () => true,
      loadEvidenceById: async () => evidenceMutated ? { ...evidence, backupArtifactId: "different-backup" } : evidence,
      loadAuthorizationById: async () => null,
      loadRolloutReceiptById: async () => null,
      inspectFixedOperationState: async (_operation, input) => restoreObservation(input, "post"),
      executeFixedOperation: async (operation, payload) => { executionCalls.push({ operation, payload });
        throw new Error("Completed restore state must be receipted without a duplicate destructive effect"); },
    });
    const request = {
      schemaVersion: 1, operation: "recovery-operation-replay", requestId: "replay-1", recoveryCaseId: "case-1",
      expectedGeneration: 3, expectedRecordDigest: record.recordDigest, operationId,
    };
    await expect(broker.dispatch({ ...request, operationId: "c".repeat(64) })).rejects.toThrow(/exact pending journal generation/);
    evidenceMutated = true;
    await expect(broker.dispatch({ ...request, requestId: "replay-mutated-evidence" })).rejects.toThrow(/exact evidence bound/);
    expect(executionCalls).toHaveLength(0);
    evidenceMutated = false;
    const replayed = await broker.dispatch(request);
    expect(replayed.replayed).toBe(true);
    expect(executionCalls).toHaveLength(0);
    const duplicate = await broker.dispatch({ ...request, requestId: "replay-duplicate" });
    expect(duplicate.replayed).toBe(false);
    expect(executionCalls).toHaveLength(0);
  });

  it("requires root-only authority state, the fixed socket, and a complete signed host adapter", () => {
    const authority = Object.fromEntries(AUTHORITY_CONFIG_KEYS.map((key) => [key, key === "requireRoot" ? true : {}]));
    expect(() => createRecoveryHostRuntime({ authorityConfig: { authority }, trustedHostAdapter: {} }))
      .toThrow(/fixed production host adapter/);
    expect(() => createRecoveryHostRuntime({ authorityConfig: { authority: { ...authority, requireRoot: false } }, trustedHostAdapter: {} }))
      .toThrow(/root-only state/);
    expect(() => createRecoveryHostRuntime({
      authorityConfig: { authority }, trustedHostAdapter: {}, socketPath: "C:\\temp\\untrusted.sock",
    })).toThrow(/fixed operation socket/);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "requires root for the fixed production installer when called by a non-root POSIX user",
    async () => {
      await expect(installAuthorityPackageFromRaw({
        provenance: {}, binaryBytes: Buffer.from("untrusted"), configBytes: Buffer.from("{}"),
      })).rejects.toThrow("Authority package installation requires root.");
    },
  );

  it("does not let callers override fixed installer root policy or destination", async () => {
    const rawInput = { provenance: {}, binaryBytes: Buffer.from("untrusted"), configBytes: Buffer.from("{}") };
    await expect(installAuthorityPackageFromRaw({ ...rawInput, requireRoot: false })).rejects.toThrow(/closed schema/);
    await expect(installAuthorityPackageFromRaw({ ...rawInput, installationRoot: await tempRoot() })).rejects.toThrow(/closed schema/);
  });

  it("verifies immutable authority package digests, signer, allowlist, and monotonic version", async () => {
    const signer = generateKeyPairSync("ed25519");
    const authoritySigner = generateKeyPairSync("ed25519");
    const binary = Buffer.from("signed authority executable");
    const authorityConfig = Object.fromEntries(AUTHORITY_CONFIG_KEYS.map((key) => [key,
      key === "requireRoot" ? true
        : key === "signing" ? { privateKey: authoritySigner.privateKey.export({ type: "pkcs8", format: "pem" }), authorityVersion: "1.2.0",
          authorityKeyId: "root-key-1", authorityInstanceId: "fixture-authority" }
          : key === "journalPublicKeys" ? { "root-key-1": authoritySigner.publicKey.export({ type: "spki", format: "pem" }) }
          : {}]));
    authorityConfig.operationAdapterDigest = sha256(binary);
    authorityConfig.operationAdapterConformancePublicKeys = {
      "adapter-conformance-key": signer.publicKey.export({ type: "spki", format: "pem" }),
    };
    const packageConfig = { authority: authorityConfig, host: { releaseGroupGid: 1001, adapter: { id: "reviewed-fixture-adapter" } } };
    const config = Buffer.from(canonicalJson(packageConfig));
    const unsigned = {
      schemaVersion: 1,
      purpose: "bodycast-production-recovery-authority-package",
      packageName: "bodycast-production-recovery-authority",
      authorityVersion: "1.2.0",
      authorityKeyId: "root-key-1",
      binaryDigest: sha256(binary),
      configDigest: sha256(config),
      sourceRepository: "krustallik/body-model",
      sourceMainSha: "a".repeat(40),
      buildWorkflowPath: ".github/workflows/authority-package.yml",
      buildWorkflowId: "301",
      buildWorkflowRunId: "302",
      buildWorkflowRunAttempt: "1",
      issuedAt: "2026-10-07T12:00:00.000Z",
      expiresAt: "2026-10-08T12:00:00.000Z",
      signerKeyId: "provenance-key",
    };
    const provenance = { ...unsigned, signature: signCanonical(unsigned, signer.privateKey) };
    const verified = verifyAuthorityInstallArtifact({
      provenance, binaryBytes: binary, configBytes: config,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey },
      allowedAuthorityVersions: ["1.2.0", "1.3.0"], minimumAllowedVersion: "1.0.0",
      currentInstallation: { authorityVersion: "1.1.9" }, now: Date.parse("2026-10-07T12:30:00.000Z"),
    });
    expect(verified).toMatchObject({ authorityVersion: "1.2.0", authorityKeyId: "root-key-1" });
    expect(() => verifyAuthorityInstallArtifact({
      provenance, binaryBytes: Buffer.from("modified"), configBytes: config,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0", now: Date.parse("2026-10-07T12:30:00.000Z"),
    })).toThrow(/digest/);
    expect(() => verifyAuthorityInstallArtifact({
      provenance, binaryBytes: binary, configBytes: config,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0", currentInstallation: { authorityVersion: "1.3.0" },
      now: Date.parse("2026-10-07T12:30:00.000Z"),
    })).toThrow(/downgrade/);
    expect(() => verifyAuthorityInstallArtifact({
      provenance, binaryBytes: binary, configBytes: config,
      trustedProvenanceKeys: { "different-key": signer.publicKey }, allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0", now: Date.parse("2026-10-07T12:30:00.000Z"),
    })).toThrow(/not trusted/);
    const mismatchedVersionConfig = Buffer.from(canonicalJson({
      ...packageConfig,
      authority: { ...authorityConfig, signing: { ...authorityConfig.signing, authorityVersion: "1.2.1" } },
    }));
    const mismatchedVersionUnsigned = { ...unsigned, configDigest: sha256(mismatchedVersionConfig) };
    const mismatchedVersionProvenance = { ...mismatchedVersionUnsigned, signature: signCanonical(mismatchedVersionUnsigned, signer.privateKey) };
    expect(() => verifyAuthorityInstallArtifact({
      provenance: mismatchedVersionProvenance, binaryBytes: binary, configBytes: mismatchedVersionConfig,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0", now: Date.parse("2026-10-07T12:30:00.000Z"),
    })).toThrow(/version or key ID/);
    const mismatchedKeyConfig = Buffer.from(canonicalJson({
      ...packageConfig,
      authority: { ...authorityConfig, signing: { ...authorityConfig.signing, authorityKeyId: "other-root-key" } },
    }));
    const mismatchedKeyUnsigned = { ...unsigned, configDigest: sha256(mismatchedKeyConfig) };
    const mismatchedKeyProvenance = { ...mismatchedKeyUnsigned, signature: signCanonical(mismatchedKeyUnsigned, signer.privateKey) };
    expect(() => verifyAuthorityInstallArtifact({
      provenance: mismatchedKeyProvenance, binaryBytes: binary, configBytes: mismatchedKeyConfig,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0", now: Date.parse("2026-10-07T12:30:00.000Z"),
    })).toThrow(/version or key ID/);
    expect(compareAuthorityVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);

    const receiptKey = generateKeyPairSync("ed25519");
    const receipt = {
      receiptSchemaVersion: 1,
      purpose: "bodycast-production-recovery-authority-installation",
      authorityVersion: verified.authorityVersion,
      binaryDigest: verified.binaryDigest,
      configDigest: verified.configDigest,
      authorityKeyId: verified.authorityKeyId,
      installationPath: "/usr/local/lib/bodycast/production-recovery/v1.2.0",
      installedAt: "2026-10-07T12:31:00.000Z",
      previousAuthorityVersion: "1.1.9",
      minimumAllowedVersion: "1.0.0",
      provenanceDigest: verified.provenanceDigest,
      signerKeyId: "installer-key",
    };
    const signedReceipt = { ...receipt, signature: signCanonical(receipt, receiptKey.privateKey) };
    expect(verifyAuthorityInstallationReceipt(signedReceipt, { "installer-key": receiptKey.publicKey }, {
      minimumAllowedVersion: "1.0.0", allowedAuthorityVersions: ["1.2.0"],
    })).toBe(true);

    const installationRoot = path.join(await tempRoot(), "authority-install");
    const rejectedInstallRoot = path.join(await tempRoot(), "authority-install-rejected");
    const emptyExistingRoot = path.join(await tempRoot(), "authority-install-empty");
    await fs.mkdir(emptyExistingRoot, { recursive: true, mode: 0o700 });
    const emptyExistingRootStat = await fs.lstat(emptyExistingRoot);
    expect(emptyExistingRootStat.isDirectory()).toBe(true);
    expect(emptyExistingRootStat.isSymbolicLink()).toBe(false);
    if (process.platform !== "win32") {
      expect(emptyExistingRootStat.uid).toBe(process.getuid());
      expect(emptyExistingRootStat.mode & 0o077).toBe(0);
    }
    const installFixtureAt = (root) => installAuthorityPackageFixture({
      provenance, binaryBytes: binary, configBytes: config, installationRoot: root,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"], minimumAllowedVersion: "1.0.0",
      receiptSigner: { keyId: "installer-key", privateKey: receiptKey.privateKey, publicKey: receiptKey.publicKey },
      now: Date.parse("2026-10-07T12:30:00.000Z"), syncDirectory: async () => {},
    });
    await installFixtureAt(emptyExistingRoot);
    expect((await verifyInstalledAuthorityPackage({
      installationRoot: emptyExistingRoot, trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"], minimumAllowedVersion: "1.0.0", requireRoot: false,
    })).authorityVersion).toBe("1.2.0");
    if (process.platform !== "win32") {
      const installedRootStat = await fs.lstat(emptyExistingRoot);
      expect(installedRootStat.uid).toBe(process.getuid());
      expect(installedRootStat.mode & 0o077).toBe(0);

      const permissiveRoot = path.join(await tempRoot(), "authority-install-permissive");
      await fs.mkdir(permissiveRoot, { recursive: true, mode: 0o700 });
      await fs.chmod(permissiveRoot, 0o755);
      await expect(installFixtureAt(permissiveRoot))
        .rejects.toThrow(/Private state path must not grant group\/other access/);
      expect(await fs.readdir(permissiveRoot)).toEqual([]);

      const symlinkTarget = path.join(await tempRoot(), "authority-install-symlink-target");
      await fs.mkdir(symlinkTarget, { recursive: true, mode: 0o700 });
      const symlinkRoot = path.join(await tempRoot(), "authority-install-symlink");
      await fs.symlink(symlinkTarget, symlinkRoot, "dir");
      await expect(installFixtureAt(symlinkRoot)).rejects.toThrow(/Symlink path is not allowed/);
      expect(await fs.readdir(symlinkTarget)).toEqual([]);

      const unsafeParentTarget = await tempRoot();
      const unsafeTargetRoot = path.join(unsafeParentTarget, "authority-install");
      await fs.mkdir(unsafeTargetRoot, { recursive: true, mode: 0o700 });
      const unsafeParentLink = path.join(await tempRoot(), "authority-install-parent-link");
      await fs.symlink(unsafeParentTarget, unsafeParentLink, "dir");
      await expect(installFixtureAt(path.join(unsafeParentLink, "authority-install")))
        .rejects.toThrow(/Symlink path is not allowed/);
      expect(await fs.readdir(unsafeTargetRoot)).toEqual([]);
    }

    const pointerOnlyRoot = path.join(await tempRoot(), "authority-install-pointer-only");
    await fs.mkdir(pointerOnlyRoot, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(pointerOnlyRoot, "current-version"), "v1.2.0\n", { mode: 0o600 });
    await expect(installAuthorityPackageFixture({
      provenance, binaryBytes: binary, configBytes: config, installationRoot: pointerOnlyRoot,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"], minimumAllowedVersion: "1.0.0",
      receiptSigner: { keyId: "installer-key", privateKey: receiptKey.privateKey, publicKey: receiptKey.publicKey },
      now: Date.parse("2026-10-07T12:30:00.000Z"), syncDirectory: async () => {},
    })).rejects.toThrow();
    await expect(fs.stat(path.join(pointerOnlyRoot, "v1.2.0"))).rejects.toMatchObject({ code: "ENOENT" });

    const receiptOnlyRoot = path.join(await tempRoot(), "authority-install-receipt-only");
    const receiptOnlyVersion = path.join(receiptOnlyRoot, "v1.2.0");
    await fs.mkdir(receiptOnlyVersion, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(receiptOnlyRoot, "current-version"), "v1.2.0\n", { mode: 0o600 });
    await fs.writeFile(path.join(receiptOnlyVersion, "installation-receipt.json"), canonicalJson(signedReceipt), { mode: 0o600 });
    await expect(installAuthorityPackageFixture({
      provenance, binaryBytes: binary, configBytes: config, installationRoot: receiptOnlyRoot,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"], minimumAllowedVersion: "1.0.0",
      receiptSigner: { keyId: "installer-key", privateKey: receiptKey.privateKey, publicKey: receiptKey.publicKey },
      now: Date.parse("2026-10-07T12:30:00.000Z"), syncDirectory: async () => {},
    })).rejects.toThrow();
    await expect(fs.stat(path.join(receiptOnlyVersion, "bodycast-recovery-authority"))).rejects.toMatchObject({ code: "ENOENT" });

    await expect(installAuthorityPackageFixture({
      provenance: { ...provenance, signature: "forged-signature" },
      binaryBytes: binary,
      configBytes: config,
      installationRoot: rejectedInstallRoot,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey },
      minimumAllowedVersion: "1.0.0",
      now: Date.parse("2026-10-07T12:30:00.000Z"),
      receiptSigner: { keyId: "installer-key", privateKey: receiptKey.privateKey, publicKey: receiptKey.publicKey },
      trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"],
      syncDirectory: async () => {},
    })).rejects.toThrow(/signature/);
    await expect(fs.stat(rejectedInstallRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await installAuthorityPackageFixture({
      provenance,
      binaryBytes: binary,
      configBytes: config,
      installationRoot,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey },
      minimumAllowedVersion: "1.0.0",
      now: Date.parse("2026-10-07T12:30:00.000Z"),
      receiptSigner: { keyId: "installer-key", privateKey: receiptKey.privateKey, publicKey: receiptKey.publicKey },
      trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"],
      syncDirectory: async () => {},
    });
    const installed = await verifyInstalledAuthorityPackage({
      installationRoot,
      trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0",
      requireRoot: false,
    });
    expect(installed).toMatchObject({ authorityVersion: "1.2.0", binaryDigest: verified.binaryDigest, configDigest: verified.configDigest });
    expect(installed.receipt.provenanceDigest).toBe(verified.provenanceDigest);
    await expect(installAuthorityPackageFromRaw({
      provenance: {}, binaryBytes: Buffer.from("untrusted"), configBytes: Buffer.from("{}"),
      verifiedArtifact: verified,
    })).rejects.toThrow(/closed schema/);
    const olderConfig = Buffer.from(canonicalJson({
      ...packageConfig,
      authority: { ...authorityConfig, signing: { ...authorityConfig.signing, authorityVersion: "1.1.9" } },
    }));
    const olderUnsigned = { ...unsigned, authorityVersion: "1.1.9", configDigest: sha256(olderConfig) };
    const olderProvenance = { ...olderUnsigned, signature: signCanonical(olderUnsigned, signer.privateKey) };
    const olderVerified = verifyAuthorityInstallArtifact({
      provenance: olderProvenance, binaryBytes: binary, configBytes: olderConfig,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey },
      allowedAuthorityVersions: ["1.1.9", "1.2.0"], minimumAllowedVersion: "1.0.0",
      now: Date.parse("2026-10-07T12:30:00.000Z"),
    });
    expect(olderVerified.authorityVersion).toBe("1.1.9");
    const incompleteDowngradeRoot = path.join(await tempRoot(), "authority-install-incomplete-downgrade");
    await fs.mkdir(incompleteDowngradeRoot, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(incompleteDowngradeRoot, "current-version"), "v1.2.0\n", { mode: 0o600 });
    await expect(installAuthorityPackageFixture({
      provenance: olderProvenance, binaryBytes: binary, configBytes: olderConfig, installationRoot: incompleteDowngradeRoot,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      minimumAllowedVersion: "1.0.0", allowedAuthorityVersions: ["1.1.9", "1.2.0"],
      receiptSigner: { keyId: "installer-key", privateKey: receiptKey.privateKey, publicKey: receiptKey.publicKey },
      now: Date.parse("2026-10-07T12:30:00.000Z"), syncDirectory: async () => {},
    })).rejects.toThrow();
    await expect(fs.stat(path.join(incompleteDowngradeRoot, "v1.1.9"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(installAuthorityPackageFixture({
      provenance: olderProvenance,
      binaryBytes: binary,
      configBytes: olderConfig,
      installationRoot,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey },
      trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      minimumAllowedVersion: "1.0.0",
      receiptSigner: { keyId: "installer-key", privateKey: receiptKey.privateKey, publicKey: receiptKey.publicKey },
      allowedAuthorityVersions: ["1.1.9", "1.2.0"],
      now: Date.parse("2026-10-07T12:30:00.000Z"),
      syncDirectory: async () => {},
    })).rejects.toThrow(/downgrade/);
    await fs.writeFile(path.join(installationRoot, "v1.2.0", "bodycast-recovery-authority"), "tampered");
    await expect(verifyInstalledAuthorityPackage({
      installationRoot,
      trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0",
      requireRoot: false,
    })).rejects.toThrow(/bytes or version pointer/);
  });

  it("issues rollout evidence only for a current signed receipt and invalidates it on tooling drift", async () => {
    const authority = generateKeyPairSync("ed25519");
    const installed = [{ path: "deploy.sh", gitBlobSha: "a".repeat(40), contentSha256: "b".repeat(64) }];
    const reviewedManifest = ["deploy.sh"];
    const installation = {
      authorityVersion: "1.0.0", authorityKeyId: "root-key", authorityInstanceId: "host-1",
      authorityBinaryDigest: "c".repeat(64), authorityConfigDigest: "d".repeat(64), installationReceiptDigest: "e".repeat(64),
    };
    const evidence = {
      compatibilityFixtures: Object.fromEntries(REQUIRED_READER_ROLLOUT_FIXTURES.map((fixture) => [fixture, true])),
      entrypointManifestVerified: true,
      staleCheckoutRejected: true,
      hostTopologyVerified: true,
      authorityInstallVerified: true,
    };
    const body = createReaderRolloutReceipt({
      repository: "krustallik/body-model", canonicalMainSha: "a".repeat(40), reviewedManifest,
      installedEntrypoints: installed, hostTopologyIdentityDigest: "f".repeat(64), authorityInstallation: installation,
      evidence, issuedAt: "2026-10-07T12:00:00.000Z", expiresAt: "2026-10-08T12:00:00.000Z",
    });
    const root = await tempRoot();
    const saved = await writeImmutableReceipt(root, "rollout.json", body, {
      privateKey: authority.privateKey,
      publicKeys: { "root-key": authority.publicKey },
      syncDirectory: async () => {},
    });
    const expected = {
      repository: body.repository, canonicalMainSha: body.canonicalMainSha,
      reviewedManifestDigest: body.reviewedManifestDigest, entrypointsDigest: body.entrypointsDigest,
      hostTopologyIdentityDigest: body.hostTopologyIdentityDigest, authorityVersion: body.authorityVersion,
      authorityBinaryDigest: body.authorityBinaryDigest, authorityConfigDigest: body.authorityConfigDigest,
      installationReceiptDigest: body.installationReceiptDigest, evidenceDigest: canonicalDigest(evidence),
    };
    const verify = createReaderRolloutVerifier({
      publicKeys: { "root-key": authority.publicKey }, expected,
      loadInstalledEntrypoints: async () => installed,
      now: () => Date.parse("2026-10-07T13:00:00.000Z"),
    });
    expect((await verify(saved.receipt)).receiptDigest).toBe(saved.receipt.receiptDigest);
    await expect(createReaderRolloutVerifier({
      publicKeys: { "root-key": authority.publicKey }, expected,
      loadInstalledEntrypoints: async () => [...installed, { path: "changed", gitBlobSha: "1".repeat(40), contentSha256: "2".repeat(64) }],
      now: () => Date.parse("2026-10-07T13:00:00.000Z"),
    })(saved.receipt)).rejects.toThrow(/drifted/);
    expect(() => createReaderRolloutReceipt({
      repository: body.repository, canonicalMainSha: body.canonicalMainSha,
      reviewedManifest, installedEntrypoints: installed, hostTopologyIdentityDigest: "f".repeat(64),
      authorityInstallation: installation,
      evidence: { ...evidence, compatibilityFixtures: { ...evidence.compatibilityFixtures, futureV2SchemaBlocks: false } },
      issuedAt: "2026-10-07T12:00:00.000Z", expiresAt: "2026-10-08T12:00:00.000Z",
    })).toThrow(/fixtures are incomplete/);
  });

  it("durably consumes policy request IDs and nonces under one exclusive lock", async () => {
    const root = await tempRoot();
    const state = path.join(root, "nonces");
    await fs.mkdir(state, { mode: 0o700 });
    const consume = createFileBackedPolicyNonceConsumer(state, { syncDirectory: async () => {} });
    const binding = { recoveryCaseId: "case-1", phase: "A", requestId: "request-1", nonce: "nonce-1", policyDigest: "a".repeat(64) };
    expect(await consume(binding)).toBe(true);
    expect(await consume(binding)).toBe(false);
    expect(await consume({ ...binding, requestId: "request-2" })).toBe(false);
    const records = await fs.readdir(state);
    expect(records.filter((name) => name.startsWith("request-") && name.endsWith(".json"))).toHaveLength(1);
  });

  it("requires read-only transaction, exact logical DB identity, schema, and migration history", async () => {
    const columns = [
      { name: "id", dataType: "integer", udtName: "int4", isNullable: false, ordinalPosition: 1 },
      { name: "profile_id", dataType: "integer", udtName: "int4", isNullable: false, ordinalPosition: 2 },
    ];
    const migrationRows = [{
      migration_name: "20261006130000_unified_v4_glycogen_water_rollout",
      checksum: "migration-checksum",
      finished_at: "2026-10-06T11:00:00.000Z",
      rolled_back_at: null,
    }];
    const schemaSnapshot = [{ schema: "public", table: "profile", columns }];
    const expected = {
      schemaVersion: 1,
      logicalProductionDbIdentityDigest: "a".repeat(64),
      expectedSchemaDigest: canonicalDigest(schemaSnapshot),
      expectedMigrationHistoryDigest: canonicalDigest([{
        migrationName: migrationRows[0].migration_name,
        checksum: migrationRows[0].checksum,
        finishedAt: migrationRows[0].finished_at,
        rolledBackAt: null,
      }]),
      migrationNames: [migrationRows[0].migration_name],
      requiredRelations: [{ schema: "public", table: "profile", columns }],
    };
    const statements = [];
    const result = await verifyReadOnlySchemaCompatibility({
      expected,
      resolveLogicalDatabaseIdentity: async () => ({ identityDigest: "a".repeat(64), observationsDigest: "b".repeat(64) }),
      withReadOnlyTransaction: async (callback) => callback(async (sql) => {
        statements.push(sql);
        if (sql.startsWith("SELECT column_name")) return columns.map((column) => ({
          column_name: column.name, data_type: column.dataType, udt_name: column.udtName,
          is_nullable: column.isNullable ? "YES" : "NO", ordinal_position: column.ordinalPosition,
        }));
        if (sql.startsWith('SELECT migration_name')) return migrationRows;
        return [];
      }),
    });
    expect(result).toMatchObject({ schemaCompatible: true, requiredRelationsChecked: 1, migrationCount: 1 });
    expect(statements[0]).toBe("SET TRANSACTION READ ONLY");
    expect(statements.some((sql) => sql.includes('SELECT "id", "profile_id" FROM "public"."profile" LIMIT 0'))).toBe(true);
    await expect(verifyReadOnlySchemaCompatibility({
      expected: { ...expected, logicalProductionDbIdentityDigest: "f".repeat(64) },
      resolveLogicalDatabaseIdentity: async () => ({ identityDigest: "a".repeat(64) }),
      withReadOnlyTransaction: async (callback) => callback(async () => []),
    })).rejects.toThrow(/logical production database/);
    expect(() => quoteIdentifier('profile"; DROP TABLE profile;--', "table")).toThrow(/identifier/);
  });

  it("lets only a separately authenticated protected-environment review create policy attestations", async () => {
    const owner = generateKeyPairSync("ed25519");
    const policy = generateKeyPairSync("ed25519");
    const timestamp = "2026-10-07T12:00:00.000Z";
    const configurationSnapshot = {
      environment: "production-recovery", branchPolicy: "main-only", preventSelfReview: true,
      adminBypassDisabled: true, reviewers: ["12345"],
    };
    const workflow = {
      repository: "krustallik/body-model", ref: "refs/heads/main", canonicalMainSha: "a".repeat(40),
      environment: "production-recovery", workflowPath: ".github/workflows/production-recovery-phase-a.yml",
      workflowId: "901", workflowRunId: "902", workflowRunAttempt: "1", actorGithubUserId: "777",
    };
    const challengeWorkflow = { ...workflow, environment: undefined };
    const environment = {
      environment: "production-recovery", branchPolicy: "main-only", preventSelfReview: true,
      adminBypassDisabled: true, allowlistedReviewerGithubUserIds: ["12345"], configurationSnapshot,
    };
    const expectedDigest = canonicalDigest(configurationSnapshot);
    const challenges = new Map();
    const consumed = new Set();
    const service = createRecoveryPolicySignerService({
      verifyWorkflowOidc: async (token, options) => options.audience === "bodycast-production-recovery-policy"
        ? token === "valid-github-oidc-token" ? workflow : token === "challenge-github-oidc-token" ? challengeWorkflow : null : null,
      loadRecoveryCase: async (id) => ({ recoveryCaseId: id, phase: "A", canonicalMainSha: workflow.canonicalMainSha,
        repository: workflow.repository, status: "awaiting-owner-policy-review" }),
      readProtectedEnvironmentConfiguration: async () => environment,
      createPhaseChallenge: async (challenge, challengeDigest) => { challenges.set(challenge.challengeId, { challenge, challengeDigest }); return true; },
      loadPhaseChallenge: async (id) => challenges.get(id),
      loadAuthenticatedOwnerApproval: async ({ challenge }) => {
        const approvalBody = {
          schemaVersion: 1, purpose: "recovery-policy-owner-approval", recoveryCaseId: "case-001", phase: "A",
          repository: workflow.repository, canonicalMainSha: workflow.canonicalMainSha, environment: workflow.environment,
          workflowPath: workflow.workflowPath, workflowId: workflow.workflowId, workflowRunId: workflow.workflowRunId,
          workflowRunAttempt: workflow.workflowRunAttempt, reviewedConfigurationDigest: expectedDigest,
          reviewerGithubUserId: "12345", approvalState: "approved", approvalId: "deployment-approval-71",
          approvalTimestamp: timestamp, singleUseRequestId: challenge.singleUseRequestId,
          singleUseNonce: challenge.singleUseNonce, challengeId: challenge.challengeId,
          challengeDigest: challenge.challengeDigest, keyId: "owner-key",
        };
        return { ...approvalBody, signature: signCanonical(approvalBody, owner.privateKey) };
      },
      verifyAuthenticatedOwnerApproval: async ({ candidate }) => verifyCanonical(
        Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "signature")), candidate.signature, owner.publicKey,
      ),
      consumeSingleUseRequest: async ({ requestId, nonce }) => {
        const key = requestId + "\0" + nonce;
        if (consumed.has(key)) return false;
        consumed.add(key);
        return true;
      },
      policySigner: (body) => signCanonical(body, policy.privateKey),
      ownerApprovalPublicKeys: { "owner-key": owner.publicKey }, allowedReviewerIds: ["12345"],
      policyKeyId: "policy-key", signerName: "independent-policy-service", policyVersion: "1.0.0",
      repository: workflow.repository,
      phaseWorkflowBindings: { A: { workflowPath: workflow.workflowPath, workflowId: workflow.workflowId },
        B: { workflowPath: ".github/workflows/production-recovery-phase-b.yml", workflowId: "902" } },
      now: () => Date.parse(timestamp),
      createNonce: () => "c".repeat(64),
      createId: () => "challenge-unique-001",
    });
    const challengeResult = await service.createChallenge({
      schemaVersion: 1, purpose: "create-recovery-phase-challenge", oidcToken: "challenge-github-oidc-token",
      recoveryCaseId: "case-001", phase: "A",
    });
    const policyRequest = {
      schemaVersion: 1, purpose: "request-recovery-environment-policy", oidcToken: "valid-github-oidc-token",
      recoveryCaseId: "case-001", phase: "A", challengeId: challengeResult.challenge.challengeId,
      challengeDigest: challengeResult.challengeDigest,
    };
    const attestation = await service.issue(policyRequest);
    expect(attestation.phase).toBe("A");
    expect(attestation.reviewedConfigurationDigest).toBe(expectedDigest);
    expect(attestation.reviewedReviewerGithubUserId).toBe("12345");
    expect(verifyCanonical(Object.fromEntries(Object.entries(attestation).filter(([key]) => key !== "signature")),
      attestation.signature, policy.publicKey)).toBe(true);

    await expect(service.issue({ ...policyRequest, ownerApproval: { approved: true } })).rejects.toThrow(/closed schema/);
    await expect(service.issue({ ...policyRequest, oidcToken: "caller-made-approval-flag" })).rejects.toThrow(/canonical recovery phase/);
    expect(consumed.size).toBe(1);
    expect(attestation.singleUseNonce).toBe("c".repeat(64));
    expect(attestation.challengeDigest).toBe(challengeResult.challengeDigest);
    await expect(service.issue({ ...policyRequest, phase: "B" })).rejects.toThrow(/workflow|phase|case/i);
  });

  it("captures only the exact currently serving immutable rollback image and rejects rebuilds or retention gaps", () => {
    const imageDigest = "a".repeat(64);
    const observation = {
      containerId: "container-123",
      releaseShaLabel: "b".repeat(40),
      imageId: "sha256:" + "c".repeat(64),
      repositoryDigest: "ghcr.io/bodycast/app@sha256:" + imageDigest,
      artifactId: "oci://ghcr.io/bodycast/app@sha256:" + imageDigest,
      artifactDigest: imageDigest,
      composeProjectServiceIdentityDigest: "d".repeat(64),
      deployHostTopologyDigest: "e".repeat(64),
      capturedAt: "2026-10-07T12:00:00.000Z",
      retainedUntil: "2026-11-07T12:00:00.000Z",
    };
    const captured = captureImmutableRollbackArtifact(observation, {
      failedReleaseSha: "f".repeat(40), expectedRollbackAppSha: observation.releaseShaLabel,
      recoveryMustRemainAvailableUntil: "2026-10-20T12:00:00.000Z",
    });
    expect(captured).toMatchObject({
      failedReleaseSha: "f".repeat(40), rollbackAppSha: observation.releaseShaLabel,
      rollbackArtifactId: observation.artifactId, rollbackArtifactDigest: imageDigest,
    });
    expect(assertExactRollbackArtifact(captured, { ...captured })).toBe(true);
    expect(() => assertExactRollbackArtifact(captured, { ...captured, rollbackImageId: "sha256:" + "9".repeat(64) }))
      .toThrow(/rebuilt images/);
    expect(() => captureImmutableRollbackArtifact({ ...observation, releaseShaLabel: "1".repeat(40) }, {
      failedReleaseSha: "f".repeat(40), expectedRollbackAppSha: observation.releaseShaLabel,
      recoveryMustRemainAvailableUntil: "2026-10-20T12:00:00.000Z",
    })).toThrow(/pre-maintenance SHA/);
    expect(() => captureImmutableRollbackArtifact({ ...observation, retainedUntil: "2026-10-08T00:00:00.000Z" }, {
      failedReleaseSha: "f".repeat(40), expectedRollbackAppSha: observation.releaseShaLabel,
      recoveryMustRemainAvailableUntil: "2026-10-20T12:00:00.000Z",
    })).toThrow(/retention expires/);
  });

  it("binds restore to the same logical DB identity while treating IP, port, and server version as observations", () => {
    const identity = {
      deployRootIdentity: "deploy-root-1", hostTopologyIdentity: "host-prod-1", composeProjectIdentity: "bodycast-prod",
      composeConfigurationDigest: "a".repeat(64), databaseService: "db", storageVolumeIdentity: "volume-prod-1",
      databaseName: "bodycast", applicationRoleIdentity: "bodycast-app", recoveryReadOnlyRoleIdentity: "bodycast-recovery-readonly",
      backendNetworkIdentity: "bodycast-backend-prod", applicationDatabaseBindingDigest: "b".repeat(64),
    };
    const digest = createLogicalDatabaseIdentity(identity).identityDigest;
    const result = verifySameLogicalDatabaseIdentity(identity, {
      ...identity, databaseOid: 12345, host: "10.0.0.10", port: 5432, serverVersion: "16.3",
    });
    expect(result.identityDigest).toBe(digest);
    expect(result.observationsDigest).toBe(canonicalDigest({ databaseOid: 12345, host: "10.0.0.10", port: 5432, serverVersion: "16.3" }));
    expect(() => verifySameLogicalDatabaseIdentity(identity, { ...identity, storageVolumeIdentity: "different-volume" }))
      .toThrow(/same logical in-place/);
    expect(() => verifySameLogicalDatabaseIdentity(identity, { ...identity, hostnameOverride: "untrusted" }))
      .toThrow(/unsupported fields/);
  });

  it("requires two stable PostgreSQL writer-free observations after stopping the read-only app", async () => {
    const logicalIdentity = { deploy: "stable" };
    const topology = { backend: "prod-network" };
    let observation = 0;
    let stopped = false;
    const sample = (count) => ({
      schemaVersion: 1, purpose: "recovery-writer-drain", logicalProductionDbIdentityDigest: "a".repeat(64),
      topologyDigest: "b".repeat(64), observedAt: "2026-10-07T12:00:00.000Z", appContainerStopped: true,
      readOnlyRecoveryAppStopped: true, restartDisabled: true, activeAppWriterSessions: 0,
      readOnlyRecoveryAppSessions: 0, otherDatabaseWriters: count, writerRoleIdentity: "bodycast-app",
      observationSequence: ++observation, logicalIdentity, topology,
    });
    const makeDrain = (writerCounts) => {
      let sampleIndex = 0;
      return createWriterDrainVerifier({
        stopReadOnlyApp: async ({ expectedContainerId, restartDisabled }) => { stopped = expectedContainerId === "container" && restartDisabled; },
        observePostgres: async () => sample(writerCounts[sampleIndex++]),
        recheckTopology: async () => topology,
        waitForStableSample: async () => {},
      });
    };
    const result = await makeDrain([0, 0])({
      rollbackContainerId: "container", logicalProductionDbIdentityDigest: "a".repeat(64),
      topologyDigest: "b".repeat(64), expectedWriterRoleIdentity: "bodycast-app",
      now: Date.parse("2026-10-07T12:00:00.000Z"),
    });
    expect(stopped).toBe(true);
    expect(result.observationSequence).toBe(2);

    const reconnect = {
      schemaVersion: 1, purpose: "recovery-writer-drain", logicalProductionDbIdentityDigest: "a".repeat(64),
      topologyDigest: "b".repeat(64), observedAt: "2026-10-07T12:00:00.000Z", appContainerStopped: true,
      readOnlyRecoveryAppStopped: true, restartDisabled: true, activeAppWriterSessions: 0,
      readOnlyRecoveryAppSessions: 0, otherDatabaseWriters: 1, writerRoleIdentity: "bodycast-app", observationSequence: 2,
    };
    expect(() => verifyWriterDrainEvidence(reconnect, {
      logicalProductionDbIdentityDigest: "a".repeat(64), topologyDigest: "b".repeat(64),
      expectedWriterRoleIdentity: "bodycast-app", now: Date.parse("2026-10-07T12:00:00.000Z"),
    })).toThrow(/active database writer/);
    observation = 0;
    await expect(makeDrain([0, 1])({
      rollbackContainerId: "container", logicalProductionDbIdentityDigest: "a".repeat(64),
      topologyDigest: "b".repeat(64), expectedWriterRoleIdentity: "bodycast-app",
      now: Date.parse("2026-10-07T12:00:00.000Z"),
    })).rejects.toThrow(/active database writer/);
  });
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
