import { createRecoveryAuthority } from "./authority.mjs";
import { createProductionOperationBroker } from "./operation-broker.mjs";
import { createHostOperationServer, HOST_OPERATION_SOCKET_PATH } from "./host-service.mjs";
import { assertExactKeys } from "./canonical.mjs";

const AUTHORITY_CONFIG_KEYS = Object.freeze([
  "journalDirectory", "lockPath", "markerPath", "legacyMarkerPath", "receiptDirectory", "signing",
  "journalPublicKeys", "phaseAPublicKeys", "phaseBPublicKeys", "policyPublicKeys", "phaseWorkflowBindings", "requireRoot",
]);

const ADAPTER_FUNCTIONS = Object.freeze([
  "verifyReviewedRelease", "verifyCurrentReaderRollout", "verifyRecoveryPreparation",
  "verifyForwardMigrationAuthorization", "loadEvidenceById", "loadAuthorizationById",
  "loadRolloutReceiptById", "executeFixedOperation", "validateEvidence", "verifyRolloutReceipt",
  "verifyRestoreGrant",
]);

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
  const authority = createRecoveryAuthority({
    ...authorityConfig.authority,
    validateEvidence: trustedHostAdapter.validateEvidence,
    verifyRolloutReceipt: trustedHostAdapter.verifyRolloutReceipt,
    verifyRestoreGrant: trustedHostAdapter.verifyRestoreGrant,
  });
  const broker = createProductionOperationBroker({
    authority,
    verifyReviewedRelease: trustedHostAdapter.verifyReviewedRelease,
    verifyCurrentReaderRollout: trustedHostAdapter.verifyCurrentReaderRollout,
    verifyRecoveryPreparation: trustedHostAdapter.verifyRecoveryPreparation,
    verifyForwardMigrationAuthorization: trustedHostAdapter.verifyForwardMigrationAuthorization,
    loadEvidenceById: trustedHostAdapter.loadEvidenceById,
    loadAuthorizationById: trustedHostAdapter.loadAuthorizationById,
    loadRolloutReceiptById: trustedHostAdapter.loadRolloutReceiptById,
    executeFixedOperation: trustedHostAdapter.executeFixedOperation,
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
