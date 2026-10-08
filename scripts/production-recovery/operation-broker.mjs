import { randomBytes } from "node:crypto";
import { assertExactKeys, assertGitSha, assertNonEmptyString, assertSha256, assertUtcTimestamp, canonicalDigest, sha256Hex } from "./canonical.mjs";
import { executeReconciledHostOperation, OPERATION_ADAPTER_CONTRACT_DIGEST, OPERATION_CONTRACTS } from "./operation-contracts.mjs";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RECOVERY_EXECUTION_STEPS = Object.freeze({
  "begin-restore": "recovery-restore-in-place",
  "mark-rollback-app-ready": "recovery-start-readonly-app",
  "enable-writers": "recovery-drain-and-enable-writers",
  "complete-recovery": "recovery-verify-completion-gates",
  "open-traffic": "recovery-open-traffic",
});
const OPERATION_KEYS = Object.freeze({
  "ordinary-release": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "releaseMode"],
  "traffic-check": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "authorizationContextId"],
  "v3-postflight": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "authorizationContextId"],
  "migration-challenge": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "migrationManifestId", "authorizationContextId"],
  "migration-readiness": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "migrationManifestId"],
  "forward-migration": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "migrationManifestId", "authorizationContextId", "challengeId", "challengeDigest", "executionProof"],
  "traffic-maintenance": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "authorizationContextId"],
  "traffic-serve": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "authorizationContextId"],
  "recovery-state": ["schemaVersion", "operation", "requestId"],
  "recovery-bootstrap": ["schemaVersion", "operation", "requestId", "failedState", "evidenceId", "rolloutReceiptId"],
  "recovery-rebuild-projection": ["schemaVersion", "operation", "requestId"],
  "recovery-transition": ["schemaVersion", "operation", "requestId", "recoveryCaseId", "transition", "expectedGeneration", "expectedRecordDigest", "evidenceId", "authorizationEnvelope", "policyAttestation", "rolloutReceiptId"],
  "recovery-finalize": ["schemaVersion", "operation", "requestId", "recoveryCaseId", "expectedGeneration", "expectedRecordDigest", "evidenceId"],
  "recovery-operation-replay": ["schemaVersion", "operation", "requestId", "recoveryCaseId", "expectedGeneration", "expectedRecordDigest", "operationId"],
  "readiness": ["schemaVersion", "operation", "requestId"],
});

function validateRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Production operation request must be an object.");
  const expected = OPERATION_KEYS[request.operation];
  if (!expected) throw new Error("Production operation is not in the fixed operation allowlist.");
  assertExactKeys(request, expected, "Production operation request");
  if (request.schemaVersion !== 1) throw new Error("Production operation protocol version is unsupported.");
  assertNonEmptyString(request.requestId, "requestId");
  if (!SAFE_ID.test(request.requestId)) throw new Error("requestId must be an opaque fixed-format identifier.");
  if (request.releaseSha !== undefined) assertGitSha(request.releaseSha, "releaseSha");
  if (request.canonicalMainSha !== undefined) assertGitSha(request.canonicalMainSha, "canonicalMainSha");
  if (request.releaseMode !== undefined && !["serving", "non-serving"].includes(request.releaseMode)) {
    throw new Error("releaseMode must be serving or non-serving.");
  }
  if (request.operation === "recovery-bootstrap" && !["ddl-started", "schema-applied", "app-ready"].includes(request.failedState)) {
    throw new Error("Recovery bootstrap failed state is unsupported.");
  }
  if (request.operation === "recovery-transition") {
    for (const key of ["authorizationEnvelope", "policyAttestation"]) {
      const value = request[key];
      if (value !== null && (!value || typeof value !== "object" || Array.isArray(value))) {
        throw new Error(key + " must be a signed JSON object or null.");
      }
    }
  }
  if (request.expectedGeneration !== undefined && (!Number.isSafeInteger(request.expectedGeneration) || request.expectedGeneration < 0)) {
    throw new Error("expectedGeneration must be a non-negative safe integer.");
  }
  for (const key of ["expectedRecordDigest"]) if (request[key] !== undefined) assertSha256(request[key], key);
  if (request.operation === "recovery-operation-replay") assertSha256(request.operationId, "operationId");
  if (request.operation === "migration-challenge" || request.operation === "forward-migration") {
    if (!/^migration-[1-9][0-9]*-[1-9][0-9]*-[1-9][0-9]*$/.test(request.authorizationContextId ?? "")) {
      throw new Error("Migration authorization context must bind exact workflow, run, and attempt IDs.");
    }
  }
  if (request.operation === "forward-migration") {
    assertSha256(request.challengeId, "challengeId");
    assertSha256(request.challengeDigest, "challengeDigest");
    if (typeof request.executionProof !== "string" || request.executionProof.length === 0 || request.executionProof.length > 32_768
      || request.executionProof.split(".").length !== 3) throw new Error("A bounded fresh JWT execution proof is required for forward migration.");
  }
  for (const key of ["migrationManifestId", "authorizationContextId", "recoveryCaseId", "transition", "evidenceId", "rolloutReceiptId"]) {
    if (request[key] !== undefined && (!SAFE_ID.test(request[key]) || typeof request[key] !== "string")) {
      throw new Error(key + " must be an opaque fixed-format identifier.");
    }
  }
  return request;
}

/**
 * Root-service operation gate. It receives only closed typed requests and calls
 * host-installed callbacks; it never accepts a path, executable, shell string,
 * Compose arguments, Docker arguments, or Caddy config bytes from the release user.
 */
export function createProductionOperationBroker({
  authority,
  verifyReviewedRelease,
  verifyCurrentReaderRollout,
  verifyRecoveryPreparation,
  verifyForwardMigrationAuthorization,
  captureMigrationExecutionState,
  verifyMigrationExecutionProof,
  verifyMigrationFinalGuards,
  verifyRecoveryOperationFinalGuards,
  verifyUnifiedV4Currentness,
  inspectFixedOperationState,
  loadEvidenceById,
  loadAuthorizationById,
  loadRolloutReceiptById,
  executeFixedOperation,
  assertAdapterConformanceCurrent,
  now = () => Date.now(),
}) {
  for (const [name, fn] of Object.entries({
    verifyReviewedRelease,
    verifyCurrentReaderRollout,
    verifyRecoveryPreparation,
    verifyForwardMigrationAuthorization,
    captureMigrationExecutionState,
    verifyMigrationExecutionProof,
    verifyMigrationFinalGuards,
    verifyRecoveryOperationFinalGuards,
    verifyUnifiedV4Currentness,
    inspectFixedOperationState,
    loadEvidenceById,
    loadAuthorizationById,
    loadRolloutReceiptById,
    executeFixedOperation,
    assertAdapterConformanceCurrent,
  })) if (typeof fn !== "function") throw new Error("Trusted host operation dependency is missing: " + name + ".");
  if (!authority || typeof authority.readAuthoritativeState !== "function") throw new Error("Root recovery authority is required.");

  async function requireReviewedRelease(releaseSha, canonicalMainSha) {
    if (await verifyReviewedRelease(releaseSha, canonicalMainSha) !== true) {
      throw new Error("Release tooling or target SHA is stale, unreviewed, or not canonical main.");
    }
  }

  async function currentState() {
    return authority.readAuthoritativeState();
  }

  async function requireAdapterConformance(preparation = null) {
    let adapterConformance;
    try {
      adapterConformance = await assertAdapterConformanceCurrent({ preparation });
    } catch (error) {
      throw new Error("Installed host adapter has no current verified operation-conformance evidence.", { cause: error });
    }
    const expiresAt = Date.parse(adapterConformance?.expiresAt);
    if (!adapterConformance || adapterConformance.current !== true
      || adapterConformance.contractDigest !== OPERATION_ADAPTER_CONTRACT_DIGEST
      || !Number.isFinite(expiresAt) || expiresAt <= now()) {
      throw new Error("Installed host adapter has no current verified operation-conformance evidence.");
    }
    assertSha256(adapterConformance.adapterDigest, "adapterConformance.adapterDigest");
    assertSha256(adapterConformance.receiptDigest, "adapterConformance.receiptDigest");
    if (preparation && (preparation.operationAdapterDigest !== adapterConformance.adapterDigest
      || preparation.operationAdapterConformanceDigest !== adapterConformance.receiptDigest)) {
      throw new Error("Recovery preparation does not bind the installed adapter's current conformance receipt.");
    }
    return adapterConformance;
  }

  async function requireMigrationPreparation() {
    const preparation = await verifyRecoveryPreparation({ allowAbsent: false });
    if (!preparation?.ready) throw new Error("Forward migration is blocked until recovery preparation is verified.");
    await requireAdapterConformance(preparation);
    return preparation;
  }

  const migrationSnapshotKeys = ["schemaVersion", "purpose", "releaseSha", "canonicalMainSha", "migrationManifestId",
    "logicalProductionDbIdentityDigest", "markerState", "markerDigest", "recoveryGeneration", "recoveryRecordDigest",
    "workflowId", "workflowRunId", "workflowRunAttempt", "pendingMigrationSetDigest", "pendingMigrationCount", "observedAt"];

  function validateMigrationSnapshot(snapshot, request, state, { expectedMarkerState = null } = {}) {
    assertExactKeys(snapshot, migrationSnapshotKeys, "Fresh migration live-state snapshot");
    if (snapshot.schemaVersion !== 1 || snapshot.purpose !== "bodycast-production-migration-live-state"
      || snapshot.releaseSha !== request.releaseSha || snapshot.canonicalMainSha !== request.canonicalMainSha
      || snapshot.migrationManifestId !== request.migrationManifestId || snapshot.markerState !== expectedMarkerState
      || (expectedMarkerState === null ? snapshot.markerDigest !== null : typeof snapshot.markerDigest !== "string")
      || snapshot.recoveryGeneration !== state.generation || snapshot.recoveryRecordDigest !== state.recordDigest) {
      throw new Error("Fresh migration live state does not match the exact release, manifest, marker, or authoritative recovery state.");
    }
    if (expectedMarkerState === null && state.legacyMarker) throw new Error("An existing release marker blocks a fresh migration challenge.");
    if (expectedMarkerState !== null && (!state.legacyMarker || state.legacyMarker.state !== expectedMarkerState
      || state.legacyMarker.releaseSha !== request.releaseSha || state.legacyMarker.manifestId !== request.migrationManifestId)) {
      throw new Error("The durable migration boundary marker does not match the exact release and manifest.");
    }
    assertSha256(snapshot.logicalProductionDbIdentityDigest, "migrationSnapshot.logicalProductionDbIdentityDigest");
    assertSha256(snapshot.pendingMigrationSetDigest, "migrationSnapshot.pendingMigrationSetDigest");
    if (expectedMarkerState !== null) assertSha256(snapshot.markerDigest, "migrationSnapshot.markerDigest");
    if (!Number.isSafeInteger(snapshot.pendingMigrationCount) || snapshot.pendingMigrationCount < 1) {
      throw new Error("Migration challenge does not contain a non-empty exact pending migration set.");
    }
    assertUtcTimestamp(snapshot.observedAt, "migrationSnapshot.observedAt");
    if (Date.parse(snapshot.observedAt) > now() + 30_000 || now() - Date.parse(snapshot.observedAt) > 30_000) {
      throw new Error("Fresh migration live-state snapshot is stale or from the future.");
    }
    const context = /^migration-([1-9][0-9]*)-([1-9][0-9]*)-([1-9][0-9]*)$/.exec(request.authorizationContextId);
    if (!context || snapshot.workflowId !== context[1] || snapshot.workflowRunId !== context[2]
      || String(snapshot.workflowRunAttempt) !== context[3]) {
      throw new Error("Fresh migration live state is not bound to the exact workflow run and attempt.");
    }
    if (!Number.isSafeInteger(snapshot.workflowRunAttempt) || snapshot.workflowRunAttempt < 1) {
      throw new Error("Fresh migration workflow attempt is invalid.");
    }
    if (state.activeRecovery || expectedMarkerState === null && state.blocking) {
      throw new Error("Authoritative recovery or marker state blocks a migration challenge.");
    }
    return snapshot;
  }

  function migrationStateDigest(snapshot) {
    const stable = Object.fromEntries(Object.entries(snapshot)
      .filter(([key]) => !["observedAt", "markerState", "markerDigest"].includes(key)));
    return canonicalDigest(stable);
  }

  async function captureMigrationSnapshot(request, { expectedMarkerState = null } = {}) {
    const state = await currentState();
    const snapshot = validateMigrationSnapshot(await captureMigrationExecutionState({
      releaseSha: request.releaseSha,
      canonicalMainSha: request.canonicalMainSha,
      migrationManifestId: request.migrationManifestId,
      authorizationContextId: request.authorizationContextId,
      expectedMarkerState,
    }), request, state, { expectedMarkerState });
    return { state, snapshot, digest: canonicalDigest(snapshot) };
  }

  function validateMigrationProofVerification(result, challenge, request) {
    const keys = ["schemaVersion", "purpose", "verified", "challengeId", "challengeDigest", "nonceDigest", "releaseSha",
      "canonicalMainSha", "migrationManifestId", "authorizationContextId", "workflowId", "workflowRunId",
      "workflowRunAttempt", "tokenDigest", "issuedAt", "expiresAt"];
    assertExactKeys(result, keys, "Verified migration execution proof");
    if (result.schemaVersion !== 1 || result.purpose !== "bodycast-production-migration-execution-proof"
      || result.verified !== true || result.challengeId !== challenge.challengeId || result.challengeDigest !== challenge.challengeDigest
      || result.nonceDigest !== sha256Hex(challenge.nonce) || result.releaseSha !== request.releaseSha
      || result.canonicalMainSha !== request.canonicalMainSha || result.migrationManifestId !== request.migrationManifestId
      || result.authorizationContextId !== request.authorizationContextId
      || result.workflowId !== challenge.workflowId || result.workflowRunId !== challenge.workflowRunId
      || result.workflowRunAttempt !== challenge.workflowRunAttempt
      || result.tokenDigest !== sha256Hex(request.executionProof)) {
      throw new Error("Execution proof verifier did not bind the exact challenge, release, manifest, and workflow attempt.");
    }
    assertSha256(result.tokenDigest, "executionProof.tokenDigest");
    assertUtcTimestamp(result.issuedAt, "executionProof.issuedAt");
    assertUtcTimestamp(result.expiresAt, "executionProof.expiresAt");
    const currentTime = now();
    const issuedAt = Date.parse(result.issuedAt);
    const expiresAt = Date.parse(result.expiresAt);
    if (issuedAt < Date.parse(challenge.issuedAt) || issuedAt > currentTime
      || currentTime - issuedAt > 2 * 60_000 || expiresAt <= currentTime || expiresAt - issuedAt > 10 * 60_000) {
      throw new Error("Migration execution proof is stale, expired, or excessively long-lived.");
    }
    return result;
  }

  function assertMigrationAuthorizationUnexpired(challenge, proof, checkedAt = now()) {
    if (!proof || Date.parse(challenge.issuedAt) > checkedAt || Date.parse(challenge.expiresAt) <= checkedAt
      || Date.parse(proof.issuedAt) > checkedAt || Date.parse(proof.expiresAt) <= checkedAt) {
      throw new Error("Migration challenge or execution proof expired at the migration effect boundary.");
    }
  }

  function validateUnifiedV4Currentness(result, request) {
    const keys = ["schemaVersion", "purpose", "profileId", "releaseSha", "canonicalMainSha", "modelRevision", "rolloutEpoch",
      "currentGeneration", "publishedGeneration", "publishedRolloutEpoch", "publishedSourceDigest", "currentSourceDigest", "current", "observedAt"];
    assertExactKeys(result, keys, "Unified V4 currentness evidence");
    if (result.schemaVersion !== 1 || result.purpose !== "bodycast-unified-v4-production-currentness"
      || !Number.isSafeInteger(result.profileId) || result.profileId < 1
      || result.releaseSha !== request.releaseSha || result.canonicalMainSha !== request.canonicalMainSha
      || result.modelRevision !== "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once"
      || result.current !== true || !Number.isSafeInteger(result.rolloutEpoch) || result.rolloutEpoch < 1
      || !Number.isSafeInteger(result.currentGeneration) || result.currentGeneration < 1
      || !Number.isSafeInteger(result.publishedGeneration) || result.publishedGeneration < 1
      || result.publishedRolloutEpoch !== result.rolloutEpoch
      || result.publishedGeneration !== result.currentGeneration) {
      throw new Error("Unified V4 is missing or stale at the authoritative traffic-serving boundary.");
    }
    assertSha256(result.publishedSourceDigest, "unifiedV4.publishedSourceDigest");
    assertSha256(result.currentSourceDigest, "unifiedV4.currentSourceDigest");
    if (result.publishedSourceDigest !== result.currentSourceDigest) {
      throw new Error("Unified V4 source changed after publication; serving is blocked.");
    }
    assertUtcTimestamp(result.observedAt, "unifiedV4.observedAt");
    if (Date.parse(result.observedAt) > now() + 30_000 || now() - Date.parse(result.observedAt) > 30_000) {
      throw new Error("Unified V4 currentness evidence is stale or from the future.");
    }
    return result;
  }

  function unifiedV4CurrentnessDigest(evidence) {
    const stableEvidence = Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== "observedAt"));
    return canonicalDigest(stableEvidence);
  }

  async function executeRecoveryOperation({ result, request, evidence, preparation, replay = false }) {
    const record = result.record;
    const intent = record.operationIntent;
    const bindings = {
      schemaVersion: 1,
      recoveryCaseId: record.recoveryCaseId,
      transition: record.transition,
      operationType: intent.operationType,
      sourceEvidenceDigest: record.sourceEvidenceDigest,
      immutableRollbackArtifact: record.immutableRollbackArtifact,
      logicalProductionDbIdentityDigest: record.logicalProductionDbIdentityDigest,
    };
    if (canonicalDigest(bindings) !== intent.operationInputDigest) {
      throw new Error("Committed recovery operation intent does not match its immutable operation inputs.");
    }
    await requireAdapterConformance(preparation);
    const execute = async ({ record: exactRecord, intent: exactIntent }) => executeReconciledHostOperation({
      operationType: exactIntent.operationType,
      operationId: exactIntent.operationId,
      operationInputDigest: exactIntent.operationInputDigest,
      recoveryCaseId: exactRecord.recoveryCaseId,
      journalGeneration: exactRecord.generation,
      journalRecordDigest: exactRecord.recordDigest,
      bindings,
      inspectFixedOperationState,
      authorizeImmediatelyBeforeEffect: async () => {
        if (await verifyRecoveryOperationFinalGuards({ operationType: exactIntent.operationType, record: exactRecord,
          intent: exactIntent, evidence, replay }) !== true) {
          throw new Error("Recovery operation final host-state guard did not pass immediately before the effect.");
        }
        await requireAdapterConformance(preparation);
      },
      executeFixedOperation: (operationType, operation) => executeFixedOperation(operationType, {
        ...operation,
        recoveryCaseId: exactRecord.recoveryCaseId,
        journalGeneration: exactRecord.generation,
        journalRecordDigest: exactRecord.recordDigest,
        evidenceId: replay ? exactRecord.operationEvidenceId : request.evidenceId,
        evidence,
        immutableRollbackArtifact: exactRecord.immutableRollbackArtifact,
        logicalProductionDbIdentityDigest: exactRecord.logicalProductionDbIdentityDigest,
        ...(replay ? { replayOnly: true } : {}),
      }),
    });
    const completion = await authority.executePendingOperation({ recoveryCaseId: record.recoveryCaseId,
      generation: record.generation, recordDigest: record.recordDigest, operationId: intent.operationId }, execute);
    if (!completion.receipt || !completion.outcome && completion.executed) {
      throw new Error("Recovery operation did not produce an authenticated completion receipt.");
    }
    return completion;
  }

  return Object.freeze({
    async dispatch(rawRequest) {
      const request = validateRequest(rawRequest);
      const state = await currentState();
      if (request.operation === "readiness") {
        const rollout = await verifyCurrentReaderRollout({ allowAbsent: true });
        const preparation = await verifyRecoveryPreparation({ allowAbsent: true });
        let conformanceCurrent = false;
        try {
          await requireAdapterConformance(preparation?.ready ? preparation : null);
          conformanceCurrent = true;
        } catch { /* Readiness reports stale or invalid conformance as fail-closed state. */ }
        return { ok: true, operation: "readiness", recoveryBlocking: state.blocking,
          activeRecovery: Boolean(state.activeRecovery), rolloutCurrent: rollout?.current === true,
          operationAdapterConformanceCurrent: conformanceCurrent,
          recoveryPrepared: preparation?.ready === true && conformanceCurrent,
          observedAt: new Date(now()).toISOString() };
      }
      if (request.operation === "recovery-state") return state;
      if (request.operation === "recovery-bootstrap") {
        const evidence = await loadEvidenceById(request.evidenceId);
        const rolloutReceipt = await loadRolloutReceiptById(request.rolloutReceiptId);
        return authority.bootstrapFailedRelease({ failedState: request.failedState, evidence, rolloutReceipt });
      }
      if (request.operation === "recovery-rebuild-projection") return authority.rebuildMarkerProjection();
      if (request.operation === "ordinary-release") {
        await requireReviewedRelease(request.releaseSha, request.canonicalMainSha);
        if (state.activeRecovery || state.blocking && !state.legacyMarker) {
          throw new Error("Active, malformed, or unreconciled V2 recovery state blocks ordinary deployment.");
        }
        if (state.legacyMarker && !(request.releaseMode === "non-serving"
          && request.releaseSha === state.legacyMarker.releaseSha
          && ["schema-applied", "app-ready"].includes(state.legacyMarker.state))) {
          throw new Error("A V1 forward-release marker permits only its exact non-serving deployment SHA.");
        }
        const rollout = await verifyCurrentReaderRollout({ allowAbsent: true });
        if (rollout && rollout.current !== true) throw new Error("Installed recovery authority reports stale reader tooling.");
        await requireAdapterConformance();
        const operationBindings = { releaseSha: request.releaseSha, canonicalMainSha: request.canonicalMainSha,
          releaseMode: request.releaseMode };
        const operationId = canonicalDigest({ operation: request.operation, ...operationBindings });
        return executeReconciledHostOperation({ operationType: request.operation, operationId,
          operationInputDigest: canonicalDigest(operationBindings), bindings: operationBindings, inspectFixedOperationState,
          authorizeImmediatelyBeforeEffect: async () => {
            await requireReviewedRelease(request.releaseSha, request.canonicalMainSha);
            const freshState = await currentState();
            if (freshState.blocking || freshState.activeRecovery) throw new Error("Recovery state changed before the ordinary release effect.");
            if (await verifyCurrentReaderRollout({ allowAbsent: true }).then((value) => value && value.current !== true)) {
              throw new Error("Reader rollout changed before the ordinary release effect.");
            }
            await requireAdapterConformance();
          },
          executeFixedOperation: (operationType, operation) => executeFixedOperation(operationType, {
            releaseSha: request.releaseSha, canonicalMainSha: request.canonicalMainSha, releaseMode: request.releaseMode, ...operation,
          }),
        });
      }
      if (request.operation === "traffic-check" || request.operation === "v3-postflight") {
        await requireReviewedRelease(request.releaseSha, request.canonicalMainSha);
        if (state.activeRecovery) throw new Error("V2 recovery state blocks ordinary rollout diagnostics.");
        if (request.operation === "v3-postflight"
          && (!state.legacyMarker || state.legacyMarker.state !== "app-ready" || state.legacyMarker.releaseSha !== request.releaseSha)) {
          throw new Error("V3 postflight requires the exact app-ready forward-release marker.");
        }
        const authorization = await loadAuthorizationById(request.authorizationContextId);
        if (await verifyForwardMigrationAuthorization(authorization, request) !== true) {
          throw new Error("Rollout diagnostics lack exact forward-release authorization.");
        }
        return executeFixedOperation(request.operation, {
          releaseSha: request.releaseSha, canonicalMainSha: request.canonicalMainSha,
          authorizationContextId: request.authorizationContextId,
        });
      }
      if (request.operation === "migration-challenge") {
        await requireReviewedRelease(request.releaseSha, request.canonicalMainSha);
        const liveState = await currentState();
        if (liveState.blocking || liveState.activeRecovery || liveState.legacyMarker) {
          throw new Error("Recovery or marker state blocks creation of a forward migration challenge.");
        }
        const rollout = await verifyCurrentReaderRollout({ allowAbsent: false });
        const preparation = await requireMigrationPreparation();
        if (!rollout?.current || !preparation?.ready) throw new Error("Migration challenge is blocked until current reader rollout and recovery preparation pass.");
        const authorization = await loadAuthorizationById(request.authorizationContextId);
        if (await verifyForwardMigrationAuthorization(authorization, request) !== true) {
          throw new Error("Migration challenge lacks the exact existing forward-migration authorization.");
        }
        const { snapshot } = await captureMigrationSnapshot(request);
        const nonce = randomBytes(32).toString("hex");
        const challengeId = sha256Hex("bodycast-production-migration-challenge\0" + nonce);
        const issuedAt = new Date(now()).toISOString();
        const expiresAt = new Date(now() + 2 * 60_000).toISOString();
        const challengeBody = {
          schemaVersion: 1,
          purpose: "bodycast-production-migration-challenge",
          challengeId,
          nonce,
          releaseSha: request.releaseSha,
          canonicalMainSha: request.canonicalMainSha,
          migrationManifestId: request.migrationManifestId,
          logicalProductionDbIdentityDigest: snapshot.logicalProductionDbIdentityDigest,
          markerState: snapshot.markerState,
          markerDigest: snapshot.markerDigest,
          recoveryGeneration: snapshot.recoveryGeneration,
          recoveryRecordDigest: snapshot.recoveryRecordDigest,
          workflowId: snapshot.workflowId,
          workflowRunId: snapshot.workflowRunId,
          workflowRunAttempt: snapshot.workflowRunAttempt,
          pendingMigrationSetDigest: snapshot.pendingMigrationSetDigest,
          pendingMigrationCount: snapshot.pendingMigrationCount,
          liveStateDigest: migrationStateDigest(snapshot),
          issuedAt,
          expiresAt,
        };
        const challenge = { ...challengeBody, challengeDigest: canonicalDigest(challengeBody) };
        if (typeof authority.issueMigrationChallenge !== "function") {
          throw new Error("Root authority cannot durably issue a one-time migration challenge.");
        }
        await authority.issueMigrationChallenge(challenge);
        return { ok: true, operation: "migration-challenge", challenge };
      }
      if (request.operation === "migration-readiness") {
        await requireReviewedRelease(request.releaseSha, request.canonicalMainSha);
        if (state.blocking) throw new Error("Recovery state blocks forward migration readiness.");
        const rollout = await verifyCurrentReaderRollout({ allowAbsent: false });
        const preparation = await verifyRecoveryPreparation({ allowAbsent: false });
        if (!rollout?.current || !preparation?.ready) {
          throw new Error("Forward migration readiness is blocked until authority, current reader rollout, and the read-only recovery role are prepared.");
        }
        await requireAdapterConformance(preparation);
        return { ok: true, migrationManifestId: request.migrationManifestId, recoveryPrepared: true };
      }
      if (request.operation === "forward-migration") {
        const markerBlocks = state.blocking || state.activeRecovery || Boolean(state.legacyMarker);
        let preparation = null;
        let authorization = null;
        if (!markerBlocks) {
          await requireReviewedRelease(request.releaseSha, request.canonicalMainSha);
          const rollout = await verifyCurrentReaderRollout({ allowAbsent: false });
          preparation = await requireMigrationPreparation();
          if (!rollout?.current || !preparation?.ready) throw new Error("Forward migration is blocked until recovery preparation is verified.");
          authorization = await loadAuthorizationById(request.authorizationContextId);
          if (await verifyForwardMigrationAuthorization(authorization, request) !== true) {
            throw new Error("Existing forward migration authorization is invalid or cross-used recovery authorization.");
          }
        }
        if (typeof authority.readMigrationChallenge !== "function"
          || typeof authority.readMigrationChallengeConsumption !== "function"
          || typeof authority.consumeMigrationChallenge !== "function"
          || typeof authority.readMigrationCompletion !== "function"
          || typeof authority.completeMigrationChallenge !== "function") {
          throw new Error("Root authority cannot verify, consume, and reconcile a durable one-time migration challenge.");
        }
        const challenge = await authority.readMigrationChallenge(request.challengeId);
        if (!challenge || challenge.challengeDigest !== request.challengeDigest) {
          throw new Error("Forward migration requires the exact broker-issued durable challenge.");
        }
        if (challenge.releaseSha !== request.releaseSha || challenge.canonicalMainSha !== request.canonicalMainSha
          || challenge.migrationManifestId !== request.migrationManifestId
          || challenge.workflowId !== request.authorizationContextId.split("-")[1]
          || challenge.workflowRunId !== request.authorizationContextId.split("-")[2]
          || String(challenge.workflowRunAttempt) !== request.authorizationContextId.split("-")[3]) {
          throw new Error("Migration challenge is bound to another release, manifest, or workflow attempt.");
        }
        const operationId = canonicalDigest({ operationType: "forward-migration", challengeId: challenge.challengeId,
          challengeDigest: challenge.challengeDigest, releaseSha: request.releaseSha, manifestId: request.migrationManifestId });
        const bindings = {
          releaseSha: request.releaseSha,
          manifestId: request.migrationManifestId,
          logicalProductionDbIdentityDigest: challenge.logicalProductionDbIdentityDigest,
          pendingMigrationSetDigest: challenge.pendingMigrationSetDigest,
          markerState: "none",
          challengeId: challenge.challengeId,
          challengeDigest: challenge.challengeDigest,
          authorizationContextId: request.authorizationContextId,
        };
        const operationInputDigest = canonicalDigest(bindings);
        const priorConsumption = await authority.readMigrationChallengeConsumption(request.challengeId);
        const tokenDigest = sha256Hex(request.executionProof);
        const authorizationContextId = `migration-${challenge.workflowId}-${challenge.workflowRunId}-${challenge.workflowRunAttempt}`;
        const consumptionMatches = priorConsumption && priorConsumption.challengeDigest === challenge.challengeDigest
          && priorConsumption.operationId === operationId && priorConsumption.operationInputDigest === operationInputDigest
          && priorConsumption.recoveryCaseId === null && priorConsumption.tokenDigest === tokenDigest
          && priorConsumption.releaseSha === request.releaseSha && priorConsumption.canonicalMainSha === request.canonicalMainSha
          && priorConsumption.migrationManifestId === request.migrationManifestId
          && priorConsumption.authorizationContextId === authorizationContextId
          && priorConsumption.logicalProductionDbIdentityDigest === challenge.logicalProductionDbIdentityDigest
          && priorConsumption.pendingMigrationSetDigest === challenge.pendingMigrationSetDigest;
        if (priorConsumption && !consumptionMatches) {
          throw new Error("Consumed migration challenge cannot reconcile another operation, release, database, or proof.");
        }

        if (markerBlocks) {
          if (state.activeRecovery || !state.legacyMarker
            || !["ddl-started", "schema-applied"].includes(state.legacyMarker.state)
            || state.legacyMarker.releaseSha !== request.releaseSha
            || state.legacyMarker.manifestId !== request.migrationManifestId) {
            throw new Error("Active or mismatched recovery state blocks migration reconciliation.");
          }
          if (!priorConsumption) {
            throw new Error("An expired or unconsumed migration challenge cannot execute or reconcile through an active marker.");
          }
          const preparation = await verifyRecoveryPreparation({ allowAbsent: false });
          if (!preparation?.ready) throw new Error("Read-only migration reconciliation requires verified recovery preparation.");
          await requireAdapterConformance(preparation);
          const existingReceipt = await authority.readMigrationCompletion(request.challengeId);
          const observedCompletion = await executeReconciledHostOperation({
            operationType: "forward-migration", operationId, operationInputDigest, bindings,
            inspectFixedOperationState,
            authorizeImmediatelyBeforeEffect: async () => {
              throw new Error("Migration reconciliation is read-only and cannot authorize DDL.");
            },
            executeFixedOperation: async () => {
              throw new Error("Migration reconciliation must never invoke the migration effect.");
            },
          });
          if (observedCompletion.result !== "already-satisfied") {
            throw new Error("Active-marker migration reconciliation did not prove the exact completed post-state.");
          }
          let receipt = existingReceipt;
          if (existingReceipt) {
            if (existingReceipt.operationId !== operationId || existingReceipt.operationInputDigest !== operationInputDigest
              || existingReceipt.tokenDigest !== tokenDigest
              || canonicalDigest(existingReceipt.operationSuccess.postcondition)
                !== canonicalDigest(observedCompletion.postcondition)) {
              throw new Error("Persisted migration completion receipt differs from current exact post-state.");
            }
          } else {
            receipt = await authority.completeMigrationChallenge({ challengeId: request.challengeId,
              challengeDigest: challenge.challengeDigest, operationId, operationInputDigest, tokenDigest,
              operationSuccess: observedCompletion });
          }
          return { ok: true, operation: "forward-migration", challengeId: challenge.challengeId,
            challengeDigest: challenge.challengeDigest, completion: receipt.operationSuccess,
            completionReceipt: receipt, reconciled: true };
        }

        if (state.blocking || state.activeRecovery || state.legacyMarker) throw new Error("Active recovery state blocks forward migration.");
        if (priorConsumption) throw new Error("A consumed migration challenge cannot authorize a new migration execution.");
        if (!preparation || !authorization) throw new Error("Forward migration is blocked until recovery preparation and authorization pass.");
        if (challenge.expiresAt === undefined || Date.parse(challenge.expiresAt) <= now()) {
          throw new Error("Forward migration challenge is stale or expired.");
        }
        let proof = null;
        let live = null;
        proof = validateMigrationProofVerification(await verifyMigrationExecutionProof(request.executionProof, {
          challenge, request, authorization,
        }), challenge, request);
        assertMigrationAuthorizationUnexpired(challenge, proof);
        live = await captureMigrationSnapshot(request);
        if (migrationStateDigest(live.snapshot) !== challenge.liveStateDigest) {
          throw new Error("Live database, marker, release, or migration state changed after the challenge was issued.");
        }
        if (await verifyMigrationFinalGuards({ request, authorization, challenge, proof, liveState: live.snapshot }) !== true) {
          throw new Error("Existing forward-migration final authorization/live guard did not pass after proof receipt.");
        }
        const operation = await executeReconciledHostOperation({
          operationType: "forward-migration", operationId, operationInputDigest, bindings,
          inspectFixedOperationState,
          authorizeImmediatelyBeforeEffect: async () => {
            if (priorConsumption) throw new Error("A consumed migration challenge may reconcile an exact post-state but cannot authorize another DDL attempt.");
            await requireReviewedRelease(request.releaseSha, request.canonicalMainSha);
            const boundary = await captureMigrationSnapshot(request, { expectedMarkerState: "ddl-started" });
            if (migrationStateDigest(boundary.snapshot) !== challenge.liveStateDigest) {
              throw new Error("Database, pending migration set, release, or authoritative recovery state changed before DDL.");
            }
            if (await verifyMigrationFinalGuards({ request, authorization, challenge, proof,
              liveState: boundary.snapshot }) !== true) throw new Error("Final migration guards no longer pass at the durable DDL boundary.");
            await requireAdapterConformance(preparation);
            assertMigrationAuthorizationUnexpired(challenge, proof, now());
            const consumed = await authority.consumeMigrationChallenge({ challengeId: request.challengeId,
              challengeDigest: challenge.challengeDigest, operationId, operationInputDigest, recoveryCaseId: null,
              tokenDigest, proofIssuedAt: proof.issuedAt, proofExpiresAt: proof.expiresAt,
              releaseSha: request.releaseSha, canonicalMainSha: request.canonicalMainSha,
              migrationManifestId: request.migrationManifestId, authorizationContextId: request.authorizationContextId,
              logicalProductionDbIdentityDigest: challenge.logicalProductionDbIdentityDigest,
              pendingMigrationSetDigest: challenge.pendingMigrationSetDigest });
            if (!consumed.consumed) throw new Error("Migration challenge was concurrently consumed; duplicate DDL is blocked.");
            await requireAdapterConformance(preparation);
            assertMigrationAuthorizationUnexpired(challenge, proof, now());
          },
          executeFixedOperation: (operationType, action) => executeFixedOperation(operationType, {
            releaseSha: request.releaseSha, canonicalMainSha: request.canonicalMainSha,
            migrationManifestId: request.migrationManifestId, authorizationContextId: request.authorizationContextId,
            challenge, executionProof: request.executionProof, proofVerification: proof,
            liveState: live?.snapshot ?? challenge, authorization, ...action,
          }),
        });
        if (operation.result !== "executed") {
          throw new Error("A new migration execution did not cross the single-use authorization boundary and cannot be receipted.");
        }
        const completionReceipt = await authority.completeMigrationChallenge({ challengeId: request.challengeId,
          challengeDigest: challenge.challengeDigest, operationId, operationInputDigest, tokenDigest,
          operationSuccess: operation });
        return { ok: true, operation: "forward-migration", challengeId: challenge.challengeId,
          challengeDigest: challenge.challengeDigest, completion: operation, completionReceipt };
      }
      if (request.operation === "traffic-maintenance" || request.operation === "traffic-serve") {
        await requireReviewedRelease(request.releaseSha, request.canonicalMainSha);
        if (state.activeRecovery) throw new Error("V2 recovery state blocks ordinary traffic mutations; use an authorized recovery transition.");
        if (state.legacyMarker && (state.legacyMarker.releaseSha !== request.releaseSha
          || request.operation === "traffic-serve" && state.legacyMarker.state !== "app-ready")) {
          throw new Error("Forward traffic operation does not match the exact V1 app-ready release.");
        }
        const authorization = await loadAuthorizationById(request.authorizationContextId);
        if (await verifyForwardMigrationAuthorization(authorization, request) !== true) {
          throw new Error("Traffic operation lacks current forward-release authorization.");
        }
        await requireAdapterConformance();
        let currentness = null;
        let currentnessDigest = null;
        if (request.operation === "traffic-serve") {
          currentness = validateUnifiedV4Currentness(await verifyUnifiedV4Currentness({
            releaseSha: request.releaseSha, canonicalMainSha: request.canonicalMainSha,
            authorizationContextId: request.authorizationContextId,
          }), request);
          currentnessDigest = unifiedV4CurrentnessDigest(currentness);
        }
        const bindings = {
          releaseSha: request.releaseSha,
          canonicalMainSha: request.canonicalMainSha,
          markerState: state.legacyMarker?.state ?? "none",
          ...(currentnessDigest ? { unifiedV4CurrentnessDigest: currentnessDigest } : {}),
        };
        const operationId = canonicalDigest({ operation: request.operation, releaseSha: request.releaseSha,
          canonicalMainSha: request.canonicalMainSha, authorizationContextId: request.authorizationContextId,
          unifiedV4CurrentnessDigest: currentnessDigest });
        const operationBindings = { releaseSha: request.releaseSha, canonicalMainSha: request.canonicalMainSha,
          authorizationContextId: request.authorizationContextId, unifiedV4CurrentnessDigest: currentnessDigest };
        const completion = await executeReconciledHostOperation({ operationType: request.operation, operationId,
          operationInputDigest: canonicalDigest(operationBindings),
          bindings: { ...bindings, ...(currentnessDigest ? { unifiedV4CurrentnessDigest: currentnessDigest } : {}) }, inspectFixedOperationState,
          authorizeImmediatelyBeforeEffect: async () => {
            await requireReviewedRelease(request.releaseSha, request.canonicalMainSha);
            const freshState = await currentState();
            const exactAppReadyMarker = request.operation === "traffic-serve" && freshState.legacyMarker?.state === "app-ready"
              && freshState.legacyMarker.releaseSha === request.releaseSha;
            if (freshState.activeRecovery || freshState.blocking && !exactAppReadyMarker) {
              throw new Error("Recovery/marker state changed before the authoritative traffic mutation.");
            }
            const freshAuthorization = await loadAuthorizationById(request.authorizationContextId);
            if (await verifyForwardMigrationAuthorization(freshAuthorization, request) !== true) {
              throw new Error("Traffic authorization changed before the authoritative route mutation.");
            }
            if (request.operation === "traffic-serve") {
              const immediatelyCurrent = validateUnifiedV4Currentness(await verifyUnifiedV4Currentness({
                releaseSha: request.releaseSha, canonicalMainSha: request.canonicalMainSha,
                authorizationContextId: request.authorizationContextId,
              }), request);
              if (unifiedV4CurrentnessDigest(immediatelyCurrent) !== currentnessDigest) {
                throw new Error("Unified V4 currentness changed before the authoritative serving boundary.");
              }
            }
            await requireAdapterConformance();
          },
          executeFixedOperation: (operationType, operation) => executeFixedOperation(operationType, {
            releaseSha: request.releaseSha, canonicalMainSha: request.canonicalMainSha,
            authorizationContextId: request.authorizationContextId, currentness,
            unifiedV4CurrentnessDigest: currentnessDigest, ...operation,
          }),
        });
        return { ok: true, operation: request.operation, completion };
      }
      if (request.operation === "recovery-transition") {
        let preparation = null;
        if (RECOVERY_EXECUTION_STEPS[request.transition]) {
          preparation = await verifyRecoveryPreparation({ allowAbsent: false });
          await requireAdapterConformance(preparation);
        }
        const rolloutReceipt = await loadRolloutReceiptById(request.rolloutReceiptId);
        const evidence = await loadEvidenceById(request.evidenceId);
        const envelope = request.authorizationEnvelope;
        const policyAttestation = request.policyAttestation;
        const result = await authority.applyTransition({
          transition: request.transition,
          recoveryCaseId: request.recoveryCaseId,
          expectedGeneration: request.expectedGeneration,
          expectedRecordDigest: request.expectedRecordDigest,
          evidence,
          operationEvidenceId: request.evidenceId,
          envelope,
          policyAttestation,
          rolloutReceipt,
        });
        const executionStep = RECOVERY_EXECUTION_STEPS[request.transition];
        if (executionStep) {
          if (result.record.operationIntent?.operationType !== executionStep
            || !OPERATION_CONTRACTS[result.record.operationIntent?.operationType]
            || typeof authority.executePendingOperation !== "function") {
            throw new Error("Committed recovery operation intent does not match the fixed host operation or receipt executor.");
          }
          const completion = await executeRecoveryOperation({ result, request, evidence, preparation });
          result.operationReceipt = completion.receipt;
          result.operationCompletion = completion.outcome;
        }
        return result;
      }
      if (request.operation === "recovery-operation-replay") {
        const preparation = await verifyRecoveryPreparation({ allowAbsent: false });
        await requireAdapterConformance(preparation);
        if (typeof authority.readPendingOperation !== "function" || typeof authority.executePendingOperation !== "function") {
          throw new Error("Recovery authority does not support durable operation replay receipts.");
        }
        const pending = await authority.readPendingOperation();
        if (!pending || pending.record.recoveryCaseId !== request.recoveryCaseId
          || pending.record.generation !== request.expectedGeneration || pending.record.recordDigest !== request.expectedRecordDigest
          || pending.intent.operationId !== request.operationId) {
          throw new Error("Operation replay request does not match the exact pending journal generation and operation ID.");
        }
        if (pending.receipt) return { ok: true, record: pending.record, operationReceipt: pending.receipt, replayed: false };
        const evidence = pending.operationEvidenceId ? await loadEvidenceById(pending.operationEvidenceId) : null;
        if (!evidence || canonicalDigest(evidence) !== pending.record.sourceEvidenceDigest) {
          throw new Error("Operation replay cannot load the exact evidence bound to the committed intent.");
        }
        const completion = await executeRecoveryOperation({
          result: { record: pending.record },
          request: { ...request, transition: pending.record.transition, evidenceId: pending.operationEvidenceId },
          evidence,
          preparation,
          replay: true,
        });
        return { ok: true, record: pending.record, operationReceipt: completion.receipt,
          operationCompletion: completion.outcome, replayed: completion.executed };
      }
      if (request.operation === "recovery-finalize") {
        const evidence = await loadEvidenceById(request.evidenceId);
        return authority.finalizeRecovery({
          recoveryCaseId: request.recoveryCaseId,
          expectedGeneration: request.expectedGeneration,
          expectedRecordDigest: request.expectedRecordDigest,
          evidence,
        });
      }
      throw new Error("Production operation is not implemented.");
    },
  });
}

export { OPERATION_KEYS, validateRequest as validateProductionOperationRequest };
