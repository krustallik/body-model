import {
  assertExactKeys,
  assertGitSha,
  assertNonEmptyString,
  assertSha256,
  canonicalDigest,
  omitFields,
  signCanonical,
  verifyCanonical,
} from "./canonical.mjs";
import {
  assertPolicyMatchesClaims,
  validatePhaseAClaims,
  validatePhaseBClaims,
  validatePolicyAttestation,
  RECOVERY_AUTHORIZATION_SCHEMA_VERSION,
} from "./schemas.mjs";
import { assertPinnedOwnerId, BODYCAST_OWNER_ID } from "../github-owner-identity.mjs";

const ENVELOPE_KEYS = Object.freeze(["schemaVersion", "phase", "keyId", "claims", "signature"]);

export function authorizationEnvelopeDigest(envelope) {
  assertExactKeys(envelope, ENVELOPE_KEYS, "Authorization envelope");
  return canonicalDigest(envelope);
}

export function createAuthorizationEnvelope(claims, phase, keyId, privateKey) {
  const validator = phase === "A" ? validatePhaseAClaims : phase === "B" ? validatePhaseBClaims : null;
  if (!validator) throw new Error("Recovery authorization phase must be A or B.");
  validator(claims);
  const unsigned = { schemaVersion: RECOVERY_AUTHORIZATION_SCHEMA_VERSION, phase, keyId, claims };
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
  if (envelope.schemaVersion !== RECOVERY_AUTHORIZATION_SCHEMA_VERSION || envelope.phase !== phase || (phase !== "A" && phase !== "B")) {
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

export async function issuePolicyAttestation({
  policy,
  signerConfig,
  now = Date.now(),
}) {
  assertExactKeys(policy, [
    "recoveryCaseId", "phase", "repository", "canonicalMainSha", "workflowPath", "workflowId", "workflowRunId",
    "workflowRunAttempt", "actorGithubUserId", "reviewedConfigurationDigest", "singleUseRequestId", "singleUseNonce",
    "challengeId", "challengeDigest",
  ], "Policy signing request");
  const {
    policySigner,
    consumeSingleUseRequest,
    policyKeyId,
    signerName,
    policyVersion,
    ownerGithubActorId = BODYCAST_OWNER_ID,
  } = signerConfig ?? {};
  if (policy.phase !== "A" && policy.phase !== "B") throw new Error("Policy phase is invalid.");
  assertPinnedOwnerId(ownerGithubActorId, "Configured recovery owner ID");
  assertPinnedOwnerId(policy.actorGithubUserId, "Authenticated recovery workflow actor ID");
  if (String(policy.actorGithubUserId) !== String(ownerGithubActorId)) throw new Error("Recovery workflow actor is not the pinned owner.");
  if (typeof consumeSingleUseRequest !== "function") {
    throw new Error("A durable single-use policy request consumer is required.");
  }
  if (typeof policySigner !== "function" || typeof policyKeyId !== "string" || typeof signerName !== "string"
    || typeof policyVersion !== "string") {
    throw new Error("Trusted policy signer configuration is incomplete.");
  }
  for (const [key, value] of Object.entries(policy)) {
    if (key.endsWith("Sha")) assertGitSha(value, "policy." + key);
    else if (key.endsWith("Digest")) assertSha256(value, "policy." + key);
    else assertNonEmptyString(value, "policy." + key);
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
    schemaVersion: RECOVERY_AUTHORIZATION_SCHEMA_VERSION,
    purpose: "recovery-owner-authorization-policy",
    recoveryCaseId: policy.recoveryCaseId,
    phase: policy.phase,
    repository: policy.repository,
    canonicalMainSha: policy.canonicalMainSha,
    environment: "production-recovery",
    workflowPath: policy.workflowPath,
    workflowId: policy.workflowId,
    workflowRunId: policy.workflowRunId,
    workflowRunAttempt: policy.workflowRunAttempt,
    authorizedActorGithubUserId: String(policy.actorGithubUserId),
    branchPolicy: "main-only",
    reviewedConfigurationDigest: policy.reviewedConfigurationDigest,
    reviewedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
    singleUseRequestId: policy.singleUseRequestId,
    singleUseNonce: policy.singleUseNonce,
    challengeId: policy.challengeId,
    challengeDigest: policy.challengeDigest,
    policyVersion,
    signer: signerName,
    keyId: policyKeyId,
  };
  const attestationSignature = await policySigner(omitFields(attestation, ["signature"]));
  if (typeof attestationSignature !== "string" || attestationSignature.length === 0) {
    throw new Error("Recovery machine signer did not produce a signature.");
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
