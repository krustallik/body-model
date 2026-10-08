import { createPublicKey } from "node:crypto";
import {
  assertExactKeys,
  assertGitSha,
  assertNonEmptyString,
  assertSha256,
  assertUtcTimestamp,
  canonicalDigest,
  verifyCanonical,
} from "./canonical.mjs";

const OPERATION_DEFINITIONS = Object.freeze({
  "forward-migration": Object.freeze({
    preState: "migration-pending",
    postState: "migration-postflight-current",
    replayPolicy: "inspect-pending-set-before-migrate-and-never-repeat-partial-ddl",
    boundary: "durably-write-ddl-started-marker-then-authorize-immediately-before-prisma-spawn",
    preconditionKeys: ["releaseSha", "manifestId", "logicalProductionDbIdentityDigest", "pendingMigrationSetDigest", "markerState"],
    postconditionKeys: ["releaseSha", "manifestId", "logicalProductionDbIdentityDigest", "pendingMigrationSetDigest", "schemaDigest", "migrationHistoryDigest", "finalGuardReceiptDigest", "markerState"],
  }),
  "recovery-restore-in-place": Object.freeze({
    preState: "restore-required",
    postState: "exact-backup-restored",
    replayPolicy: "inspect-same-db-and-backup-before-reconcile-restore",
    preconditionKeys: ["logicalProductionDbIdentityDigest", "backupArtifactDigest", "observedSchemaDigest", "observedMigrationHistoryDigest"],
    postconditionKeys: ["logicalProductionDbIdentityDigest", "backupArtifactDigest", "schemaDigest", "migrationHistoryDigest", "readOnlyCompatibilityDigest"],
  }),
  "recovery-start-readonly-app": Object.freeze({
    preState: "captured-app-stopped",
    postState: "captured-app-healthy-readonly",
    replayPolicy: "inspect-exact-container-and-readonly-role-before-ensure-started",
    preconditionKeys: ["releaseSha", "imageDigest", "containerState", "databaseRoleMode"],
    postconditionKeys: ["releaseSha", "imageDigest", "containerId", "healthStatus", "databaseRoleMode"],
  }),
  "recovery-drain-and-enable-writers": Object.freeze({
    preState: "readonly-app-stopped-and-writers-drained",
    postState: "captured-app-healthy-writer-mode",
    replayPolicy: "observe-drain-and-image-state-before-ensuring-writer-mode",
    preconditionKeys: ["releaseSha", "imageDigest", "readonlyAppStopped", "activeWriterCount", "topologyDigest"],
    postconditionKeys: ["releaseSha", "imageDigest", "healthStatus", "writerMode", "activeWriterCount", "topologyDigest"],
  }),
  "recovery-verify-completion-gates": Object.freeze({
    preState: "writers-enabled",
    postState: "completion-gates-current",
    replayPolicy: "recompute-completion-from-current-host-and-database-state",
    preconditionKeys: ["recoveryCaseId", "journalGeneration", "logicalProductionDbIdentityDigest", "writerMode"],
    postconditionKeys: ["recoveryCaseId", "journalGeneration", "journalRecordDigest", "logicalProductionDbIdentityDigest", "healthStatus", "integrityDigest"],
  }),
  "recovery-open-traffic": Object.freeze({
    preState: "maintenance-route-on-bound-host",
    postState: "bound-rollback-image-serving",
    replayPolicy: "ensure-only-the-bound-rollback-target-receives-traffic",
    preconditionKeys: ["releaseSha", "imageDigest", "routeDigest", "markerState"],
    postconditionKeys: ["releaseSha", "imageDigest", "routeDigest", "trafficTargetImageDigest", "healthStatus", "markerState"],
  }),
  "ordinary-release": Object.freeze({
    preState: "release-not-serving",
    postState: "exact-release-healthy",
    replayPolicy: "inspect-exact-release-before-ensure-deployed",
    preconditionKeys: ["releaseSha", "canonicalMainSha", "currentImageDigest"],
    postconditionKeys: ["releaseSha", "imageDigest", "containerId", "healthStatus"],
  }),
  "traffic-maintenance": Object.freeze({
    preState: "route-not-maintenance",
    postState: "maintenance-route-active",
    replayPolicy: "inspect-route-and-app-state-before-ensure-maintenance",
    preconditionKeys: ["routeDigest", "markerDigest", "currentTarget"],
    postconditionKeys: ["routeDigest", "markerDigest", "maintenanceActive", "applicationStopped"],
  }),
  "traffic-serve": Object.freeze({
    preState: "maintenance-route-and-current-app",
    postState: "exact-current-v4-release-serving",
    replayPolicy: "inspect-v4-currentness-and-route-before-ensure-serving",
    boundary: "recheck-v4-currentness-immediately-before-authoritative-route-mutation",
    preconditionKeys: ["releaseSha", "imageDigest", "routeDigest", "unifiedV4CurrentnessDigest", "markerState"],
    postconditionKeys: ["releaseSha", "imageDigest", "routeDigest", "unifiedV4CurrentnessDigest", "healthStatus", "markerState"],
  }),
});

const CONFORMANCE_KEYS = Object.freeze([
  "schemaVersion", "purpose", "contractVersion", "contractDigest", "adapterDigest", "testSuiteDigest",
  "testRunId", "testedOperationTypes", "result", "issuedAt", "expiresAt", "signerKeyId", "signature",
]);

export const OPERATION_CONTRACT_VERSION = 2;
const OPERATION_EVIDENCE_SCHEMA_VERSION = 1;
export const OPERATION_CONTRACTS = OPERATION_DEFINITIONS;
export const OPERATION_ADAPTER_CONTRACT_DIGEST = canonicalDigest({
  contractVersion: OPERATION_CONTRACT_VERSION,
  operations: Object.fromEntries(Object.entries(OPERATION_DEFINITIONS).sort(([a], [b]) => a.localeCompare(b))),
});
const ACTIVE_OPERATIONS = new Map();

function assertDigestObject(value, keys, label) {
  assertExactKeys(value, keys, label);
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase().endsWith("digest")) assertSha256(item, label + "." + key);
    else if (key.endsWith("Sha")) assertGitSha(item, label + "." + key);
    else if (key === "journalGeneration" || key === "activeWriterCount") {
      if (!Number.isSafeInteger(item) || item < 0) throw new Error(label + "." + key + " is invalid.");
    } else if (key === "maintenanceActive" || key === "applicationStopped" || key === "readonlyAppStopped") {
      if (typeof item !== "boolean") throw new Error(label + "." + key + " is invalid.");
    } else if (item === null || typeof item !== "string" || item.length === 0) {
      throw new Error(label + "." + key + " is invalid.");
    }
  }
}

function assertOperationCondition(operationType, condition, bindings, label) {
  for (const key of ["releaseSha", "manifestId", "logicalProductionDbIdentityDigest", "recoveryCaseId",
    "journalGeneration", "journalRecordDigest", "backupArtifactDigest", "imageDigest", "routeDigest",
    "unifiedV4CurrentnessDigest"]) {
    if (bindings[key] !== undefined && Object.hasOwn(condition, key) && condition[key] !== bindings[key]) {
      throw new Error(label + " does not match its immutable " + key + " binding.");
    }
  }
  if (operationType === "forward-migration" && condition.markerState !== "none" && label.includes("precondition")) {
    throw new Error("Forward migration precondition must observe marker absence before the irreversible boundary.");
  }
  if (operationType === "forward-migration" && label.includes("postcondition") && condition.markerState !== "schema-applied") {
    throw new Error("Forward migration postcondition must prove the durable schema-applied release marker.");
  }
  if (label.includes("postcondition")) {
    if (["ordinary-release", "recovery-start-readonly-app", "recovery-drain-and-enable-writers", "traffic-serve"]
      .includes(operationType) && condition.healthStatus !== "healthy") {
      throw new Error("Host operation postcondition does not prove a healthy exact application state.");
    }
    if (operationType === "recovery-drain-and-enable-writers"
      && (condition.writerMode !== "enabled" || condition.activeWriterCount < 0)) {
      throw new Error("Writer operation postcondition is not the exact enabled-writer state.");
    }
    if (operationType === "traffic-maintenance" && (!condition.maintenanceActive || !condition.applicationStopped)) {
      throw new Error("Traffic maintenance postcondition does not prove maintenance routing and stopped application.");
    }
    if (operationType === "traffic-serve" && condition.markerState !== "app-ready") {
      throw new Error("Traffic serving requires the exact app-ready marker state.");
    }
  }
}

function assertPostconditionBindings(operationType, postcondition, bindings) {
  assertOperationCondition(operationType, postcondition, bindings, "Host operation postcondition");
  const artifact = bindings.immutableRollbackArtifact;
  if (artifact) {
    if (["recovery-start-readonly-app", "recovery-drain-and-enable-writers", "recovery-open-traffic"].includes(operationType)
      && postcondition.imageDigest !== artifact.rollbackImageDigest) {
      throw new Error("Host operation postcondition does not match the captured rollback image.");
    }
    if (operationType === "recovery-restore-in-place" && postcondition.backupArtifactDigest !== artifact.rollbackArtifactDigest) {
      throw new Error("Restore postcondition does not match the immutable backup binding.");
    }
  }
  if (bindings.unifiedV4CurrentnessDigest !== undefined
    && postcondition.unifiedV4CurrentnessDigest !== bindings.unifiedV4CurrentnessDigest) {
    throw new Error("Traffic postcondition does not bind the exact Unified V4 currentness evidence.");
  }
}

export function validateOperationObservation(raw, operation) {
  const definition = OPERATION_DEFINITIONS[operation.operationType];
  if (!definition) throw new Error("Host operation type has no reviewed replay contract.");
  assertExactKeys(raw, ["schemaVersion", "purpose", "operationType", "operationId", "idempotencyKey", "operationInputDigest",
    "state", "observedAt", "stateDigest", "precondition", "postcondition"], "Host operation state observation");
  if (raw.schemaVersion !== OPERATION_EVIDENCE_SCHEMA_VERSION || raw.purpose !== "bodycast-host-operation-state"
    || raw.operationType !== operation.operationType || raw.operationId !== operation.operationId
    || raw.idempotencyKey !== operation.operationId || raw.operationInputDigest !== operation.operationInputDigest) {
    throw new Error("Host operation state observation is not bound to the exact operation intent.");
  }
  if (!["pre", "post", "other"].includes(raw.state)) throw new Error("Host operation state is unknown.");
  assertUtcTimestamp(raw.observedAt, "operationObservation.observedAt");
  const state = raw.state === "pre" ? definition.preState : raw.state === "post" ? definition.postState : "other";
  if (raw.state === "pre") {
    assertDigestObject(raw.precondition, definition.preconditionKeys, "Host operation precondition");
    assertOperationCondition(operation.operationType, raw.precondition, operation.bindings ?? {}, "Host operation precondition");
    if (raw.postcondition !== null) throw new Error("Pre-state observation must not include a postcondition.");
  } else if (raw.state === "post") {
    if (raw.precondition !== null) throw new Error("Post-state observation must not include a precondition.");
    assertDigestObject(raw.postcondition, definition.postconditionKeys, "Host operation postcondition");
    assertPostconditionBindings(operation.operationType, raw.postcondition, operation.bindings ?? {});
  } else if (raw.precondition !== null || raw.postcondition !== null) {
    throw new Error("Unexpected host state must not be represented as a valid pre/postcondition.");
  }
  const expectedStateDigest = canonicalDigest({ state, precondition: raw.precondition, postcondition: raw.postcondition });
  if (raw.stateDigest !== expectedStateDigest) throw new Error("Host operation state observation digest is invalid.");
  return Object.freeze({ ...raw, normalizedState: raw.state });
}

function validateAdapterResult(raw, operation) {
  assertExactKeys(raw, ["schemaVersion", "purpose", "operationType", "operationId", "idempotencyKey", "operationInputDigest",
    "result", "postcondition"], "Host adapter operation result");
  if (raw.schemaVersion !== OPERATION_EVIDENCE_SCHEMA_VERSION || raw.purpose !== "bodycast-host-operation-success"
    || raw.operationType !== operation.operationType || raw.operationId !== operation.operationId
    || raw.idempotencyKey !== operation.operationId || raw.operationInputDigest !== operation.operationInputDigest
    || !["executed", "already-satisfied"].includes(raw.result)) {
    throw new Error("Host adapter returned a false, malformed, or differently-bound operation result.");
  }
  assertDigestObject(raw.postcondition, OPERATION_DEFINITIONS[operation.operationType].postconditionKeys,
    "Host adapter postcondition");
  assertPostconditionBindings(operation.operationType, raw.postcondition, operation.bindings ?? {});
  return raw;
}

export async function executeReconciledHostOperation({
  operationId,
  operationInputDigest,
  ...options
}) {
  assertSha256(operationId, "operationId");
  assertSha256(operationInputDigest, "operationInputDigest");
  const active = ACTIVE_OPERATIONS.get(operationId);
  if (active) {
    if (active.operationInputDigest !== operationInputDigest) {
      throw new Error("Concurrent host operation reuses an operation ID for different immutable inputs.");
    }
    return active.promise;
  }
  const promise = executeReconciledHostOperationOnce({ ...options, operationId, operationInputDigest });
  ACTIVE_OPERATIONS.set(operationId, { operationInputDigest, promise });
  try { return await promise; }
  finally {
    if (ACTIVE_OPERATIONS.get(operationId)?.promise === promise) ACTIVE_OPERATIONS.delete(operationId);
  }
}

async function executeReconciledHostOperationOnce({
  operationType,
  operationId,
  operationInputDigest,
  recoveryCaseId = null,
  journalGeneration = null,
  journalRecordDigest = null,
  bindings = {},
  inspectFixedOperationState,
  executeFixedOperation,
  authorizeImmediatelyBeforeEffect,
}) {
  const definition = OPERATION_DEFINITIONS[operationType];
  if (!definition || typeof inspectFixedOperationState !== "function" || typeof executeFixedOperation !== "function") {
    throw new Error("A reviewed host operation contract, state inspector, and executor are required.");
  }
  assertSha256(operationId, "operationId");
  assertSha256(operationInputDigest, "operationInputDigest");
  const operation = { operationType, operationId, operationInputDigest, bindings };
  const inspect = async () => validateOperationObservation(
    await inspectFixedOperationState(operationType, {
      schemaVersion: OPERATION_EVIDENCE_SCHEMA_VERSION,
      operationType,
      operationId,
      idempotencyKey: operationId,
      operationInputDigest,
      replayPolicy: definition.replayPolicy,
      expectedPreState: definition.preState,
      expectedPostState: definition.postState,
      bindings,
    }), operation);
  let observed = await inspect();
  let result = "already-satisfied";
  if (observed.normalizedState !== "post") {
    if (observed.normalizedState !== "pre") throw new Error("Actual host state matches neither the exact precondition nor postcondition; replay is blocked.");
    if (typeof authorizeImmediatelyBeforeEffect !== "function") throw new Error("An authoritative pre-effect guard is required for this host operation.");
    let authorizedAtBoundary = false;
    const authorizeAtBoundary = async () => {
      if (authorizedAtBoundary) throw new Error("Host adapter attempted to reuse the one-time pre-effect authorization.");
      await authorizeImmediatelyBeforeEffect();
      authorizedAtBoundary = true;
    };
    const adapterResult = validateAdapterResult(await executeFixedOperation(operationType, {
      operationId, idempotencyKey: operationId, operationInputDigest,
      replayPolicy: definition.replayPolicy, expectedPreState: definition.preState,
      expectedPostState: definition.postState, boundary: definition.boundary ?? "authorize-immediately-before-effect",
      authorizeImmediatelyBeforeEffect: authorizeAtBoundary, bindings,
    }), operation);
    if (!authorizedAtBoundary) throw new Error("Host adapter returned without executing the authoritative pre-effect guard.");
    observed = await inspect();
    if (observed.normalizedState !== "post"
      || canonicalDigest(observed.postcondition) !== canonicalDigest(adapterResult.postcondition)) {
      throw new Error("Host operation did not reconcile to its exact operation-specific postcondition.");
    }
    result = adapterResult.result;
  }
  const success = {
    schemaVersion: OPERATION_EVIDENCE_SCHEMA_VERSION,
    purpose: "bodycast-host-operation-success",
    operationType,
    recoveryCaseId,
    journalGeneration,
    journalRecordDigest,
    operationId,
    idempotencyKey: operationId,
    operationInputDigest,
    result,
    postcondition: observed.postcondition,
    postconditionDigest: canonicalDigest(observed.postcondition),
  };
  validateOperationSuccess(success, { operationType, operationId, operationInputDigest, recoveryCaseId,
    journalGeneration, journalRecordDigest, bindings });
  return success;
}

export function validateOperationSuccess(raw, expected) {
  assertExactKeys(raw, ["schemaVersion", "purpose", "operationType", "recoveryCaseId", "journalGeneration", "journalRecordDigest",
    "operationId", "idempotencyKey", "operationInputDigest", "result", "postcondition", "postconditionDigest"],
  "Validated host operation success");
  if (raw.schemaVersion !== OPERATION_EVIDENCE_SCHEMA_VERSION || raw.purpose !== "bodycast-host-operation-success"
    || raw.operationType !== expected.operationType || raw.operationId !== expected.operationId
    || raw.idempotencyKey !== expected.operationId || raw.operationInputDigest !== expected.operationInputDigest
    || raw.recoveryCaseId !== (expected.recoveryCaseId ?? null)
    || raw.journalGeneration !== (expected.journalGeneration ?? null)
    || raw.journalRecordDigest !== (expected.journalRecordDigest ?? null)
    || !["executed", "already-satisfied"].includes(raw.result)) {
    throw new Error("Host operation success result does not match its exact intent and journal binding.");
  }
  assertDigestObject(raw.postcondition, OPERATION_DEFINITIONS[expected.operationType]?.postconditionKeys ?? [],
    "Validated host operation postcondition");
  assertPostconditionBindings(expected.operationType, raw.postcondition, expected.bindings ?? {});
  if (raw.postconditionDigest !== canonicalDigest(raw.postcondition)) throw new Error("Validated host operation postcondition digest is invalid.");
  return raw;
}

export function verifyOperationAdapterConformance(receipt, { adapterDigest, trustedPublicKeys, now = Date.now() } = {}) {
  assertExactKeys(receipt, CONFORMANCE_KEYS, "Host adapter conformance receipt");
  if (receipt.schemaVersion !== 1 || receipt.purpose !== "bodycast-production-host-adapter-conformance"
    || receipt.contractVersion !== OPERATION_CONTRACT_VERSION || receipt.contractDigest !== OPERATION_ADAPTER_CONTRACT_DIGEST
    || receipt.adapterDigest !== adapterDigest || receipt.result !== "passed"
    || !Array.isArray(receipt.testedOperationTypes)
    || canonicalDigest(receipt.testedOperationTypes) !== canonicalDigest(Object.keys(OPERATION_DEFINITIONS).sort())) {
    throw new Error("Host adapter conformance evidence does not cover this exact adapter and operation contract.");
  }
  assertSha256(receipt.adapterDigest, "adapterConformance.adapterDigest");
  assertSha256(receipt.contractDigest, "adapterConformance.contractDigest");
  assertSha256(receipt.testSuiteDigest, "adapterConformance.testSuiteDigest");
  assertNonEmptyString(receipt.testRunId, "adapterConformance.testRunId");
  assertNonEmptyString(receipt.signerKeyId, "adapterConformance.signerKeyId");
  assertUtcTimestamp(receipt.issuedAt, "adapterConformance.issuedAt");
  assertUtcTimestamp(receipt.expiresAt, "adapterConformance.expiresAt");
  if (Date.parse(receipt.issuedAt) > now || Date.parse(receipt.expiresAt) <= now
    || Date.parse(receipt.expiresAt) - Date.parse(receipt.issuedAt) > 90 * 24 * 60 * 60 * 1000) {
    throw new Error("Host adapter conformance evidence is stale, future-dated, or excessively long-lived.");
  }
  const key = trustedPublicKeys?.[receipt.signerKeyId];
  if (!key) throw new Error("Host adapter conformance signer is not trusted.");
  createPublicKey(key);
  const unsigned = Object.fromEntries(Object.entries(receipt).filter(([name]) => name !== "signature"));
  if (!verifyCanonical(unsigned, receipt.signature, key)) throw new Error("Host adapter conformance signature is invalid.");
  return Object.freeze({ current: true, adapterDigest: receipt.adapterDigest,
    contractDigest: receipt.contractDigest, receiptDigest: canonicalDigest(receipt) });
}

export function operationContract(operationType) {
  const value = OPERATION_DEFINITIONS[operationType];
  if (!value) throw new Error("Host operation type has no reviewed operation-specific contract.");
  return value;
}

export { CONFORMANCE_KEYS };
