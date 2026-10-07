import { assertExactKeys, assertGitSha, assertNonEmptyString, assertSha256 } from "./canonical.mjs";

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
  "migration-readiness": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "migrationManifestId"],
  "forward-migration": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "migrationManifestId", "authorizationContextId"],
  "traffic-maintenance": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "authorizationContextId"],
  "traffic-serve": ["schemaVersion", "operation", "requestId", "releaseSha", "canonicalMainSha", "authorizationContextId"],
  "recovery-state": ["schemaVersion", "operation", "requestId"],
  "recovery-bootstrap": ["schemaVersion", "operation", "requestId", "failedState", "evidenceId", "rolloutReceiptId"],
  "recovery-rebuild-projection": ["schemaVersion", "operation", "requestId"],
  "recovery-transition": ["schemaVersion", "operation", "requestId", "transition", "expectedGeneration", "expectedRecordDigest", "evidenceId", "authorizationEnvelope", "policyAttestation", "rolloutReceiptId"],
  "recovery-finalize": ["schemaVersion", "operation", "requestId", "expectedGeneration", "expectedRecordDigest", "evidenceId"],
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
  for (const key of ["migrationManifestId", "authorizationContextId", "transition", "evidenceId", "rolloutReceiptId"]) {
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
  loadEvidenceById,
  loadAuthorizationById,
  loadRolloutReceiptById,
  executeFixedOperation,
  now = () => Date.now(),
}) {
  for (const [name, fn] of Object.entries({
    verifyReviewedRelease,
    verifyCurrentReaderRollout,
    verifyRecoveryPreparation,
    verifyForwardMigrationAuthorization,
    loadEvidenceById,
    loadAuthorizationById,
    loadRolloutReceiptById,
    executeFixedOperation,
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

  return Object.freeze({
    async dispatch(rawRequest) {
      const request = validateRequest(rawRequest);
      const state = await currentState();
      if (request.operation === "readiness") {
        const rollout = await verifyCurrentReaderRollout({ allowAbsent: true });
        const preparation = await verifyRecoveryPreparation({ allowAbsent: true });
        return { ok: true, operation: "readiness", recoveryBlocking: state.blocking,
          activeRecovery: Boolean(state.activeRecovery), rolloutCurrent: rollout?.current === true,
          recoveryPrepared: preparation?.ready === true,
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
        return executeFixedOperation("ordinary-release", {
          releaseSha: request.releaseSha, canonicalMainSha: request.canonicalMainSha, releaseMode: request.releaseMode,
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
      if (request.operation === "migration-readiness") {
        await requireReviewedRelease(request.releaseSha, request.canonicalMainSha);
        if (state.blocking) throw new Error("Recovery state blocks forward migration readiness.");
        const rollout = await verifyCurrentReaderRollout({ allowAbsent: false });
        const preparation = await verifyRecoveryPreparation({ allowAbsent: false });
        if (!rollout?.current || !preparation?.ready) {
          throw new Error("Forward migration readiness is blocked until authority, current reader rollout, and the read-only recovery role are prepared.");
        }
        return { ok: true, migrationManifestId: request.migrationManifestId, recoveryPrepared: true };
      }
      if (request.operation === "forward-migration") {
        await requireReviewedRelease(request.releaseSha, request.canonicalMainSha);
        if (state.blocking) throw new Error("Active recovery state blocks forward migration.");
        const rollout = await verifyCurrentReaderRollout({ allowAbsent: false });
        const preparation = await verifyRecoveryPreparation({ allowAbsent: false });
        if (!rollout?.current || !preparation?.ready) throw new Error("Forward migration is blocked until recovery preparation is verified.");
        const authorization = await loadAuthorizationById(request.authorizationContextId);
        if (await verifyForwardMigrationAuthorization(authorization, request) !== true) {
          throw new Error("Existing forward migration authorization is invalid or cross-used recovery authorization.");
        }
        return executeFixedOperation("forward-migration", {
          releaseSha: request.releaseSha,
          canonicalMainSha: request.canonicalMainSha,
          migrationManifestId: request.migrationManifestId,
          authorizationContextId: request.authorizationContextId,
        });
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
        return executeFixedOperation(request.operation, {
          releaseSha: request.releaseSha,
          canonicalMainSha: request.canonicalMainSha,
          authorizationContextId: request.authorizationContextId,
        });
      }
      if (request.operation === "recovery-transition") {
        const rolloutReceipt = await loadRolloutReceiptById(request.rolloutReceiptId);
        const evidence = await loadEvidenceById(request.evidenceId);
        const envelope = request.authorizationEnvelope;
        const policyAttestation = request.policyAttestation;
        const result = await authority.applyTransition({
          transition: request.transition,
          expectedGeneration: request.expectedGeneration,
          expectedRecordDigest: request.expectedRecordDigest,
          evidence,
          envelope,
          policyAttestation,
          rolloutReceipt,
        });
        const executionStep = RECOVERY_EXECUTION_STEPS[request.transition];
        if (executionStep) {
          await executeFixedOperation(executionStep, {
            recoveryCaseId: result.record.recoveryCaseId,
            generation: result.record.generation,
            recordDigest: result.record.recordDigest,
            evidenceId: request.evidenceId,
          });
        }
        return result;
      }
      if (request.operation === "recovery-finalize") {
        const evidence = await loadEvidenceById(request.evidenceId);
        return authority.finalizeRecovery({
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
