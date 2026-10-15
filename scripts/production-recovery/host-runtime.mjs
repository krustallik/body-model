import { createRecoveryAuthority } from "./authority.mjs";
import { createProductionOperationBroker } from "./operation-broker.mjs";
import { createHostOperationServer, HOST_OPERATION_SOCKET_PATH } from "./host-service.mjs";
import { assertExactKeys } from "./canonical.mjs";
import { createAdapterConformanceVerifier } from "./operation-contracts.mjs";
import { verifyProgramlessSessionRollbackCompatibility } from "./schema-compatibility.mjs";

const AUTHORITY_CONFIG_KEYS = Object.freeze([
  "journalDirectory", "lockPath", "markerPath", "legacyMarkerPath", "receiptDirectory", "signing",
  "journalPublicKeys", "phaseAPublicKeys", "phaseBPublicKeys", "policyPublicKeys", "phaseWorkflowBindings", "requireRoot",
  "operationAdapterDigest", "operationAdapterConformancePublicKeys",
]);

const ADAPTER_FUNCTIONS = Object.freeze([
  // Must freshly resolve the GitHub canonical refs/heads/main SHA on every call;
  // a process-cached or local-only branch value is not an acceptable source.
  "verifyReviewedRelease", "readCanonicalMainTipSha", "verifyCurrentReaderRollout", "verifyRecoveryPreparation",
  "verifyForwardMigrationAuthorization", "loadEvidenceById", "loadAuthorizationById",
  "loadRolloutReceiptById", "loadOperationAdapterConformanceReceipt", "executeFixedOperation", "validateEvidence", "verifyRolloutReceipt",
  "verifyRestoreGrant", "captureMigrationExecutionState", "verifyMigrationExecutionProof",
  "verifyMigrationFinalGuards", "verifyUnifiedV4Currentness", "inspectFixedOperationState",
  "verifyRecoveryOperationFinalGuards", "withReadOnlyProductionTransaction",
  "resolveLogicalProductionDatabaseIdentity", "getProgramlessSessionCapabilityRepositoryPath",
]);

export function createProgramlessSessionRollbackCompatibilityVerifier(trustedHostAdapter) {
  if (!trustedHostAdapter
    || typeof trustedHostAdapter.withReadOnlyProductionTransaction !== "function"
    || typeof trustedHostAdapter.resolveLogicalProductionDatabaseIdentity !== "function"
    || typeof trustedHostAdapter.getProgramlessSessionCapabilityRepositoryPath !== "function") {
    throw new Error("Signed host adapter lacks the fixed read-only rollback compatibility primitives.");
  }
  return async ({ expectedLogicalProductionDbIdentityDigest, rollbackAppSha }) => {
    const repositoryPath = await trustedHostAdapter.getProgramlessSessionCapabilityRepositoryPath();
    if (typeof repositoryPath !== "string" || repositoryPath.length === 0) {
      throw new Error("The fixed host adapter did not provide the protected rollback capability repository path.");
    }
    return verifyProgramlessSessionRollbackCompatibility({
      withReadOnlyTransaction: trustedHostAdapter.withReadOnlyProductionTransaction,
      resolveLogicalDatabaseIdentity: trustedHostAdapter.resolveLogicalProductionDatabaseIdentity,
      expectedLogicalProductionDbIdentityDigest,
      repositoryPath,
      rollbackAppSha,
    });
  };
}

/**
 * Compose the installed root-owned authority, closed operation broker, and
 * systemd socket. Adapter code is part of the signed immutable package; no
 * adapter or executable is selected by a request from the release user.
 */
export function createRecoveryHostRuntime({
  authorityConfig,
  trustedHostAdapter,
  releaseGroupGid,
  socketPath,
  createServer = createHostOperationServer,
}) {
  if (!authorityConfig || typeof authorityConfig !== "object" || Array.isArray(authorityConfig)) {
    throw new Error("Installed recovery authority configuration is required.");
  }
  assertExactKeys(authorityConfig, ["authority"], "Installed recovery host configuration");
  assertExactKeys(authorityConfig.authority, AUTHORITY_CONFIG_KEYS, "Installed root authority configuration");
  if (authorityConfig.authority.requireRoot !== true || (socketPath && socketPath !== HOST_OPERATION_SOCKET_PATH)) {
    throw new Error("Production host authority requires root-only state and the fixed operation socket.");
  }
  if (!trustedHostAdapter || ADAPTER_FUNCTIONS.some((key) => typeof trustedHostAdapter[key] !== "function")) {
    throw new Error("Signed, fixed production host adapter is incomplete.");
  }
  const assertAdapterConformanceCurrent = createAdapterConformanceVerifier({
    loadReceipt: () => trustedHostAdapter.loadOperationAdapterConformanceReceipt(),
    adapterDigest: authorityConfig.authority.operationAdapterDigest,
    trustedPublicKeys: authorityConfig.authority.operationAdapterConformancePublicKeys,
    now: () => typeof trustedHostAdapter.now === "function" ? trustedHostAdapter.now() : Date.now(),
  });
  const authority = createRecoveryAuthority({
    ...authorityConfig.authority,
    validateEvidence: trustedHostAdapter.validateEvidence,
    verifyRolloutReceipt: trustedHostAdapter.verifyRolloutReceipt,
    verifyRestoreGrant: trustedHostAdapter.verifyRestoreGrant,
  });
  const verifyProgramlessSessionCompatibility = createProgramlessSessionRollbackCompatibilityVerifier(trustedHostAdapter);
  const broker = createProductionOperationBroker({
    authority,
    verifyReviewedRelease: trustedHostAdapter.verifyReviewedRelease,
    readCanonicalMainTipSha: trustedHostAdapter.readCanonicalMainTipSha,
    verifyCurrentReaderRollout: trustedHostAdapter.verifyCurrentReaderRollout,
    verifyRecoveryPreparation: trustedHostAdapter.verifyRecoveryPreparation,
    verifyForwardMigrationAuthorization: trustedHostAdapter.verifyForwardMigrationAuthorization,
    captureMigrationExecutionState: trustedHostAdapter.captureMigrationExecutionState,
    verifyMigrationExecutionProof: trustedHostAdapter.verifyMigrationExecutionProof,
    verifyMigrationFinalGuards: trustedHostAdapter.verifyMigrationFinalGuards,
    verifyUnifiedV4Currentness: trustedHostAdapter.verifyUnifiedV4Currentness,
    verifyRecoveryOperationFinalGuards: trustedHostAdapter.verifyRecoveryOperationFinalGuards,
    verifyProgramlessSessionRollbackCompatibility: verifyProgramlessSessionCompatibility,
    inspectFixedOperationState: trustedHostAdapter.inspectFixedOperationState,
    loadEvidenceById: trustedHostAdapter.loadEvidenceById,
    loadAuthorizationById: trustedHostAdapter.loadAuthorizationById,
    loadRolloutReceiptById: trustedHostAdapter.loadRolloutReceiptById,
    executeFixedOperation: trustedHostAdapter.executeFixedOperation,
    assertAdapterConformanceCurrent,
    now: trustedHostAdapter.now,
  });
  const server = createServer(broker, { socketPath, releaseGroupGid });
  return Object.freeze({
    authority,
    broker,
    server,
    async start() {
      // Reconcile only from the signed journal before accepting any request.
      await authority.reconcileOnStartup();
      await server.listenFromSystemd();
      return server;
    },
    async stop() { await server.close(); },
  });
}

export { ADAPTER_FUNCTIONS, AUTHORITY_CONFIG_KEYS };
