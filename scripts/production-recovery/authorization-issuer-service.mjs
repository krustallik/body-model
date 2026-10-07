import { randomUUID } from "node:crypto";
import { assertExactKeys, assertGitSha, assertNonEmptyString, assertSha256, assertUtcTimestamp, canonicalDigest, omitFields, verifyCanonical } from "./canonical.mjs";
import { createAuthorizationEnvelope } from "./authorization.mjs";
import {
  PHASE_A_CLAIM_KEYS,
  PHASE_B_CLAIM_KEYS,
  PHASE_B_CAPABILITIES,
  validatePhaseAClaims,
  validatePhaseBClaims,
  validatePolicyAttestation,
} from "./schemas.mjs";

const REQUEST_KEYS = Object.freeze([
  "schemaVersion", "purpose", "oidcToken", "recoveryCaseId", "phase", "challengeId", "challengeDigest", "policyAttestation",
]);
const CLAIM_KEYS = Object.freeze({ A: validatePhaseAClaims, B: validatePhaseBClaims });

function assertTrustedPolicy(policy, { phase, recoveryCase, workflow, policyPublicKeys, now, challengeId, challengeDigest }) {
  validatePolicyAttestation(policy);
  const key = policyPublicKeys?.[policy.keyId];
  if (!key || !verifyCanonical(omitFields(policy, ["signature"]), policy.signature, key)) {
    throw new Error("Independent policy attestation signature is invalid.");
  }
  const expected = {
    phase,
    recoveryCaseId: recoveryCase.recoveryCaseId,
    repository: workflow.repository,
    canonicalMainSha: workflow.canonicalMainSha,
    workflowPath: workflow.workflowPath,
    workflowId: workflow.workflowId,
    workflowRunId: workflow.workflowRunId,
    workflowRunAttempt: workflow.workflowRunAttempt,
    environment: "production-recovery",
    challengeId,
    challengeDigest,
  };
  for (const [keyName, value] of Object.entries(expected)) {
    if (policy[keyName] !== value) throw new Error("Policy attestation binding mismatch: " + keyName + ".");
  }
  if (Date.parse(policy.reviewedAt) > now || Date.parse(policy.expiresAt) <= now
    || Date.parse(policy.expiresAt) - Date.parse(policy.reviewedAt) > 30 * 60 * 1000) {
    throw new Error("Independent policy attestation is expired, future-dated, or exceeds 30 minutes.");
  }
}

/**
 * Dedicated phase-envelope issuer. Workflows select only a recovery case and
 * phase. All claims are assembled from trusted host evidence and authenticated
 * workflow/approval records; callers never provide the claim object or a key.
 */
export function createRecoveryAuthorizationIssuer({
  verifyWorkflowOidc,
  loadRecoveryCase,
  loadPhaseFacts,
  loadAuthenticatedOwnerApproval,
  verifyAuthenticatedOwnerApproval,
  policyPublicKeys,
  allowedReviewerIds,
  phaseWorkflowBindings,
  phaseSigners,
  repository,
  now = () => Date.now(),
  createId = () => randomUUID(),
}) {
  for (const [name, fn] of Object.entries({
    verifyWorkflowOidc, loadRecoveryCase, loadPhaseFacts, loadAuthenticatedOwnerApproval, verifyAuthenticatedOwnerApproval,
  })) if (typeof fn !== "function") throw new Error("Trusted recovery authorization issuer dependency is missing: " + name + ".");
  if (!policyPublicKeys || !Array.isArray(allowedReviewerIds) || allowedReviewerIds.length === 0
    || !phaseWorkflowBindings?.A || !phaseWorkflowBindings?.B || !phaseSigners?.A || !phaseSigners?.B || !repository) {
    throw new Error("Trusted recovery authorization issuer configuration is incomplete.");
  }

  return Object.freeze({
    async issue(rawRequest) {
      assertExactKeys(rawRequest, REQUEST_KEYS, "Recovery authorization issuer request");
      if (rawRequest.schemaVersion !== 1 || rawRequest.purpose !== "issue-recovery-phase-authorization") {
        throw new Error("Recovery authorization issuer request schema or purpose is invalid.");
      }
      if (rawRequest.phase !== "A" && rawRequest.phase !== "B") throw new Error("Recovery authorization phase is invalid.");
      for (const key of ["oidcToken", "recoveryCaseId", "challengeId"]) assertNonEmptyString(rawRequest[key], "request." + key);
      assertSha256(rawRequest.challengeDigest, "request.challengeDigest");
      if (rawRequest.oidcToken.length > 32_768 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rawRequest.recoveryCaseId)
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rawRequest.challengeId)) {
        throw new Error("Recovery authorization issuer request exceeds protocol bounds.");
      }

      const phase = rawRequest.phase;
      const workflow = await verifyWorkflowOidc(rawRequest.oidcToken, { audience: "bodycast-production-recovery-authorization" });
      const binding = phaseWorkflowBindings[phase];
      if (!workflow || workflow.repository !== repository || workflow.ref !== "refs/heads/main"
        || workflow.environment !== "production-recovery" || workflow.workflowPath !== binding.workflowPath
        || workflow.workflowId !== binding.workflowId) {
        throw new Error("Workflow OIDC is not from the exact protected recovery phase on canonical main.");
      }
      assertGitSha(workflow.canonicalMainSha, "workflow.canonicalMainSha");
      for (const key of ["workflowRunId", "workflowRunAttempt", "actorGithubUserId"]) assertNonEmptyString(workflow[key], "workflow." + key);

      const recoveryCase = await loadRecoveryCase(rawRequest.recoveryCaseId);
      if (!recoveryCase || recoveryCase.recoveryCaseId !== rawRequest.recoveryCaseId
        || recoveryCase.phase !== phase || recoveryCase.repository !== repository
        || recoveryCase.canonicalMainSha !== workflow.canonicalMainSha
        || recoveryCase.status !== "awaiting-owner-policy-review") {
        throw new Error("Recovery case is absent, stale, or not ready for this phase.");
      }
      assertUtcTimestamp(recoveryCase.expiresAt, "recoveryCase.expiresAt");
      if (Date.parse(recoveryCase.expiresAt) <= now()) throw new Error("Recovery case has expired.");
      const policy = rawRequest.policyAttestation;
      assertTrustedPolicy(policy, { phase, recoveryCase, workflow, policyPublicKeys, now: now(),
        challengeId: rawRequest.challengeId, challengeDigest: rawRequest.challengeDigest });
      const approval = await loadAuthenticatedOwnerApproval({ workflow, recoveryCase, policy, phase,
        challenge: { challengeId: rawRequest.challengeId, challengeDigest: rawRequest.challengeDigest, singleUseNonce: policy.singleUseNonce } });
      if (!approval || String(approval.reviewerGithubUserId) !== policy.reviewedReviewerGithubUserId
        || String(approval.reviewerGithubUserId) === String(workflow.actorGithubUserId)
        || approval.approvalId !== policy.ownerApprovalId || approval.approvalTimestamp !== policy.ownerApprovalTimestamp
        || approval.challengeId !== policy.challengeId || approval.challengeDigest !== policy.challengeDigest
        || approval.singleUseNonce !== policy.singleUseNonce
        || !allowedReviewerIds.map(String).includes(String(approval.reviewerGithubUserId))) {
        throw new Error("Independent owner approval is missing, self-reviewed, or not allowlisted.");
      }
      if (await verifyAuthenticatedOwnerApproval({ approval, workflow, recoveryCase, policy,
        challenge: { challengeId: policy.challengeId, challengeDigest: policy.challengeDigest, singleUseNonce: policy.singleUseNonce } }) !== true) {
        throw new Error("Owner approval does not match the independently authenticated policy review.");
      }

      const facts = await loadPhaseFacts({ recoveryCase, phase, workflow, policy, approval,
        challenge: { challengeId: policy.challengeId, challengeDigest: policy.challengeDigest, singleUseNonce: policy.singleUseNonce } });
      const evidenceId = phase === "A" ? recoveryCase.phaseAAuthorizationEvidenceId : recoveryCase.phaseBAuthorizationEvidenceId;
      const rolloutReceiptId = recoveryCase.markerReaderRolloutReceiptId;
      for (const [label, value] of [["authorization evidence", evidenceId], ["reader rollout receipt", rolloutReceiptId]]) {
        assertNonEmptyString(value, label);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(label + " ID is not in the fixed opaque format.");
      }
      const validator = CLAIM_KEYS[phase];
      const allowed = phase === "A"
        ? new Set(["schemaVersion", "purpose", "capability", "repository", "workflowPath", "workflowId", "workflowRunId", "workflowRunAttempt", "workflowRef", "canonicalMainSha", "recoveryEnvironment", "ownerApproval", "phaseAPolicyAttestationDigest", "phaseAPolicyAttestationNonce", "phaseAPolicyChallengeId", "phaseAPolicyChallengeDigest", "phaseAPolicyReviewedAt", "phaseAPolicyExpiresAt", "phaseAPolicyVersion", "hostRecoveryAuthorityIdentity", "hostRecoveryAuthorityKeyId", "issuedAt", "expiresAt", "authorizationId", "nonce"])
        : new Set(["schemaVersion", "purpose", "capabilitySet", "repository", "workflowPath", "workflowId", "workflowRunId", "workflowRunAttempt", "workflowRef", "canonicalMainSha", "recoveryEnvironment", "ownerApproval", "phaseBPolicyAttestationDigest", "phaseBPolicyAttestationNonce", "phaseBPolicyChallengeId", "phaseBPolicyChallengeDigest", "phaseBPolicyReviewedAt", "phaseBPolicyExpiresAt", "phaseBPolicyVersion", "hostRecoveryAuthorityIdentity", "hostRecoveryAuthorityKeyId", "issuedAt", "expiresAt", "authorizationId", "nonce"]);
      const expectedFactKeys = phase === "A" ? PHASE_A_CLAIM_KEYS : PHASE_B_CLAIM_KEYS;
      const factKeys = expectedFactKeys.filter((key) => !allowed.has(key));
      assertExactKeys(facts, factKeys, "Trusted phase " + phase + " recovery facts");
      const timestamp = new Date(now()).toISOString();
      const policyPrefix = phase === "A" ? "phaseAPolicy" : "phaseBPolicy";
      const signer = phaseSigners[phase];
      const claims = {
        ...facts,
        schemaVersion: 1,
        purpose: phase === "A" ? "recovery Phase A restore-only" : "post-restore recovery authorization",
        ...(phase === "A" ? { capability: "restore-only" } : { capabilitySet: [...PHASE_B_CAPABILITIES] }),
        repository,
        workflowPath: workflow.workflowPath,
        workflowId: workflow.workflowId,
        workflowRunId: workflow.workflowRunId,
        workflowRunAttempt: workflow.workflowRunAttempt,
        workflowRef: workflow.ref,
        canonicalMainSha: workflow.canonicalMainSha,
        recoveryEnvironment: "production-recovery",
        ownerApproval: {
          environment: "production-recovery",
          reviewerGithubUserId: String(approval.reviewerGithubUserId),
          reviewerLogin: approval.reviewerLogin,
          approvalState: "approved",
          approvalTime: approval.approvalTimestamp,
          runId: workflow.workflowRunId,
          runAttempt: workflow.workflowRunAttempt,
          challengeId: policy.challengeId,
          challengeDigest: policy.challengeDigest,
          singleUseNonce: policy.singleUseNonce,
        },
        [policyPrefix + "AttestationDigest"]: canonicalDigest(policy),
        [policyPrefix + "AttestationNonce"]: policy.singleUseNonce,
        [policyPrefix + "ChallengeId"]: policy.challengeId,
        [policyPrefix + "ChallengeDigest"]: policy.challengeDigest,
        [policyPrefix + "ReviewedAt"]: policy.reviewedAt,
        [policyPrefix + "ExpiresAt"]: policy.expiresAt,
        [policyPrefix + "Version"]: policy.policyVersion,
        hostRecoveryAuthorityIdentity: recoveryCase.hostRecoveryAuthorityIdentity,
        hostRecoveryAuthorityKeyId: recoveryCase.hostRecoveryAuthorityKeyId,
        issuedAt: timestamp,
        expiresAt: new Date(Math.min(now() + 10 * 60 * 1000, Date.parse(policy.expiresAt), Date.parse(recoveryCase.expiresAt))).toISOString(),
        authorizationId: "recovery-auth-" + phase + "-" + createId(),
        nonce: createId().replaceAll("-", "") + createId().replaceAll("-", ""),
      };
      validator(claims);
      return Object.freeze({
        envelope: createAuthorizationEnvelope(claims, phase, signer.keyId, signer.privateKey),
        policyAttestation: policy,
        authorizationId: claims.authorizationId,
        evidenceId,
        rolloutReceiptId,
        phase,
        recoveryCaseId: recoveryCase.recoveryCaseId,
        issuedAt: timestamp,
        expiresAt: claims.expiresAt,
      });
    },
  });
}
