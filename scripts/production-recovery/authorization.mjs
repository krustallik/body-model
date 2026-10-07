import {
  assertExactKeys,
  assertGitSha,
  assertNonEmptyString,
  assertSha256,
  assertUtcTimestamp,
  canonicalDigest,
  omitFields,
  signCanonical,
  verifyCanonical,
} from "./canonical.mjs";
import {
  OWNER_APPROVAL_KEYS,
  assertPolicyMatchesClaims,
  validatePhaseAClaims,
  validatePhaseBClaims,
  validatePolicyAttestation,
} from "./schemas.mjs";

const ENVELOPE_KEYS = Object.freeze(["schemaVersion", "phase", "keyId", "claims", "signature"]);

export function authorizationEnvelopeDigest(envelope) {
  assertExactKeys(envelope, ENVELOPE_KEYS, "Authorization envelope");
  return canonicalDigest(envelope);
}

export function createAuthorizationEnvelope(claims, phase, keyId, privateKey) {
  const validator = phase === "A" ? validatePhaseAClaims : phase === "B" ? validatePhaseBClaims : null;
  if (!validator) throw new Error("Recovery authorization phase must be A or B.");
  validator(claims);
  const unsigned = { schemaVersion: 1, phase, keyId, claims };
  return { ...unsigned, signature: signCanonical(unsigned, privateKey) };
}

export function verifyAuthorizationEnvelope(envelope, {
  phase,
  publicKeys,
  policyAttestation,
  policyPublicKeys,
  now = Date.now(),
  expectedBindings = {},
} = {}) {
  assertExactKeys(envelope, ENVELOPE_KEYS, "Authorization envelope");
  if (envelope.schemaVersion !== 1 || envelope.phase !== phase || (phase !== "A" && phase !== "B")) {
    throw new Error("Authorization envelope schema or phase is invalid.");
  }
  assertNonEmptyString(envelope.keyId, "envelope.keyId");
  const key = publicKeys?.[envelope.keyId];
  if (!key) throw new Error("Authorization signing key is not trusted for this phase.");
  const validator = phase === "A" ? validatePhaseAClaims : validatePhaseBClaims;
  validator(envelope.claims);
  const unsigned = omitFields(envelope, ["signature"]);
  if (!verifyCanonical(unsigned, envelope.signature, key)) throw new Error("Authorization envelope signature is invalid.");

  const claims = envelope.claims;
  for (const [keyName, expected] of Object.entries(expectedBindings)) {
    if (claims[keyName] !== expected) throw new Error("Authorization binding mismatch: " + keyName + ".");
  }
  if (Date.parse(claims.issuedAt) > now || Date.parse(claims.expiresAt) <= now) {
    throw new Error("Authorization envelope is from the future or expired.");
  }

  if (!policyAttestation || !policyPublicKeys) throw new Error("A signed per-phase environment policy attestation is required.");
  validatePolicyAttestation(policyAttestation);
  const phasePolicyPrefix = phase === "A" ? "phaseA" : "phaseB";
  const policyPublicKey = policyPublicKeys[policyAttestation.keyId];
  if (!policyPublicKey) throw new Error("Policy attestation key is not trusted.");
  const unsignedPolicy = omitFields(policyAttestation, ["signature"]);
  if (!verifyCanonical(unsignedPolicy, policyAttestation.signature, policyPublicKey)) {
    throw new Error("Policy attestation signature is invalid.");
  }
  assertPolicyMatchesClaims(policyAttestation, claims, phase, now);
  if (canonicalDigest(policyAttestation) !== claims[phasePolicyPrefix + "PolicyAttestationDigest"]) {
    throw new Error("Authorization envelope does not bind the exact policy attestation.");
  }
  return {
    phase,
    claims,
    envelopeDigest: authorizationEnvelopeDigest(envelope),
    policyDigest: canonicalDigest(policyAttestation),
  };
}

function validateOwnerApproval(approval, expected, allowedReviewerIds) {
  assertExactKeys(approval, OWNER_APPROVAL_KEYS, "Owner policy approval");
  if (approval.schemaVersion !== 1 || approval.purpose !== "recovery-policy-owner-approval" || approval.approvalState !== "approved") {
    throw new Error("Owner approval is not an authenticated approval.");
  }
  if (!allowedReviewerIds.includes(approval.reviewerGithubUserId)) throw new Error("Owner approver is not allowlisted.");
  for (const key of [
    "recoveryCaseId", "phase", "repository", "canonicalMainSha", "environment", "workflowPath", "workflowId",
    "workflowRunId", "workflowRunAttempt", "reviewedConfigurationDigest", "approvalId", "approvalTimestamp",
    "singleUseRequestId", "singleUseNonce", "keyId", "signature",
  ]) assertNonEmptyString(approval[key], "ownerApproval." + key);
  assertGitSha(approval.canonicalMainSha, "ownerApproval.canonicalMainSha");
  assertSha256(approval.reviewedConfigurationDigest, "ownerApproval.reviewedConfigurationDigest");
  assertUtcTimestamp(approval.approvalTimestamp, "ownerApproval.approvalTimestamp");
  if (approval.environment !== "production-recovery") throw new Error("Owner approval environment is invalid.");
  for (const [key, value] of Object.entries(expected)) {
    if (approval[key] !== value) throw new Error("Owner approval binding mismatch: " + key + ".");
  }
}

export async function issuePolicyAttestation({
  policy,
  ownerApproval,
  signerConfig,
  now = Date.now(),
}) {
  assertExactKeys(policy, [
    "recoveryCaseId", "phase", "repository", "canonicalMainSha", "workflowPath", "workflowId", "workflowRunId",
    "workflowRunAttempt", "reviewedConfigurationDigest", "singleUseRequestId", "singleUseNonce",
  ], "Policy signing request");
  const {
    ownerApprovalPublicKeys,
    allowedReviewerIds,
    policySigner,
    consumeSingleUseRequest,
    policyKeyId,
    signerName,
    policyVersion,
    independentApprovalVerifier,
  } = signerConfig ?? {};
  if (policy.phase !== "A" && policy.phase !== "B") throw new Error("Policy phase is invalid.");
  if (typeof independentApprovalVerifier !== "function") {
    throw new Error("An independent authenticated owner-approval verifier is required.");
  }
  if (typeof consumeSingleUseRequest !== "function") {
    throw new Error("A durable single-use policy request consumer is required.");
  }
  if (typeof policySigner !== "function" || typeof policyKeyId !== "string" || typeof signerName !== "string"
    || typeof policyVersion !== "string" || !Array.isArray(allowedReviewerIds) || allowedReviewerIds.length === 0) {
    throw new Error("Trusted policy signer configuration is incomplete.");
  }
  const expected = {
    recoveryCaseId: policy.recoveryCaseId,
    phase: policy.phase,
    repository: policy.repository,
    canonicalMainSha: policy.canonicalMainSha,
    environment: "production-recovery",
    workflowPath: policy.workflowPath,
    workflowId: policy.workflowId,
    workflowRunId: policy.workflowRunId,
    workflowRunAttempt: policy.workflowRunAttempt,
    reviewedConfigurationDigest: policy.reviewedConfigurationDigest,
    singleUseRequestId: policy.singleUseRequestId,
    singleUseNonce: policy.singleUseNonce,
  };
  validateOwnerApproval(ownerApproval, expected, allowedReviewerIds);
  const ownerKey = ownerApprovalPublicKeys?.[ownerApproval.keyId];
  if (!ownerKey || !verifyCanonical(omitFields(ownerApproval, ["signature"]), ownerApproval.signature, ownerKey)) {
    throw new Error("Independent owner approval signature is invalid.");
  }
  if (await independentApprovalVerifier(ownerApproval) !== true) {
    throw new Error("Independent owner approval could not be authenticated.");
  }
  if (Date.parse(ownerApproval.approvalTimestamp) > now || now - Date.parse(ownerApproval.approvalTimestamp) > 30 * 60 * 1000) {
    throw new Error("Owner approval is stale or from the future.");
  }
  const consumed = await consumeSingleUseRequest({
    recoveryCaseId: policy.recoveryCaseId,
    phase: policy.phase,
    requestId: policy.singleUseRequestId,
    nonce: policy.singleUseNonce,
    policyDigest: canonicalDigest(policy),
  });
  if (consumed !== true) throw new Error("Policy request ID/nonce was already consumed.");
  if (!policySigner || typeof policySigner !== "function") throw new Error("Dedicated policy signer is unavailable.");
  const attestation = {
    schemaVersion: 1,
    purpose: "recovery-environment-policy-review",
    recoveryCaseId: policy.recoveryCaseId,
    phase: policy.phase,
    repository: policy.repository,
    canonicalMainSha: policy.canonicalMainSha,
    environment: "production-recovery",
    workflowPath: policy.workflowPath,
    workflowId: policy.workflowId,
    workflowRunId: policy.workflowRunId,
    workflowRunAttempt: policy.workflowRunAttempt,
    allowlistedReviewerGithubUserIds: [...allowedReviewerIds].sort(),
    reviewedReviewerGithubUserId: ownerApproval.reviewerGithubUserId,
    ownerApprovalId: ownerApproval.approvalId,
    ownerApprovalTimestamp: ownerApproval.approvalTimestamp,
    preventSelfReviewRequired: true,
    adminBypassRequiredDisabled: true,
    branchPolicy: "main-only",
    reviewedConfigurationDigest: policy.reviewedConfigurationDigest,
    reviewedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
    singleUseRequestId: policy.singleUseRequestId,
    singleUseNonce: policy.singleUseNonce,
    policyVersion,
    signer: signerName,
    keyId: policyKeyId,
  };
  const attestationSignature = await policySigner(omitFields(attestation, ["signature"]));
  if (typeof attestationSignature !== "string" || attestationSignature.length === 0) {
    throw new Error("Dedicated policy signer did not produce a signature.");
  }
  const complete = { ...attestation, signature: attestationSignature };
  validatePolicyAttestation(complete);
  return complete;
}

export function verifyPhaseEnvelopeCrossUse(envelope, expectedPhase) {
  if (envelope?.phase !== expectedPhase) throw new Error("Recovery authorization cannot be used across phases.");
  if (expectedPhase !== "A" && expectedPhase !== "B") throw new Error("Recovery authorization phase is unsupported.");
  return true;
}
