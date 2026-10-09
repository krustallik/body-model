import { assertExactKeys } from "./canonical.mjs";
import { issuePolicyAttestation } from "./authorization.mjs";

const SIGNING_REQUEST_KEYS = Object.freeze(["policy"]);

export function createOwnerPolicySigner(trustedConfig) {
  if (!trustedConfig || typeof trustedConfig.policySigner !== "function" || !trustedConfig.policyKeyId
    || !trustedConfig.signerName || !trustedConfig.policyVersion
    || typeof trustedConfig.consumeSingleUseRequest !== "function") {
    throw new Error("Pinned-owner recovery machine signer configuration is incomplete.");
  }

  return Object.freeze({
    async issue(request, options = {}) {
      assertExactKeys(request, SIGNING_REQUEST_KEYS, "Policy signer request");
      return issuePolicyAttestation({
        policy: request.policy,
        signerConfig: trustedConfig,
        now: options.now ?? Date.now(),
      });
    },
  });
}
