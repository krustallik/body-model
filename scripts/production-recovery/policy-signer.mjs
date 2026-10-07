import { assertExactKeys } from "./canonical.mjs";
import { issuePolicyAttestation } from "./authorization.mjs";

const SIGNING_REQUEST_KEYS = Object.freeze(["policy", "ownerApproval"]);

export function createIndependentPolicySigner(trustedConfig) {
  if (!trustedConfig || typeof trustedConfig.independentApprovalVerifier !== "function"
    || typeof trustedConfig.policySigner !== "function" || !trustedConfig.policyKeyId
    || !trustedConfig.signerName || !trustedConfig.policyVersion
    || typeof trustedConfig.consumeSingleUseRequest !== "function") {
    throw new Error("Independent owner-authenticated policy signer configuration is incomplete.");
  }

  return Object.freeze({
    async issue(request, options = {}) {
      assertExactKeys(request, SIGNING_REQUEST_KEYS, "Policy signer request");
      return issuePolicyAttestation({
        policy: request.policy,
        ownerApproval: request.ownerApproval,
        signerConfig: trustedConfig,
        now: options.now ?? Date.now(),
      });
    },
  });
}
