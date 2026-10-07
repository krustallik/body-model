import { assertExactKeys, assertGitSha, assertNonEmptyString, canonicalDigest } from "./canonical.mjs";
import { issuePolicyAttestation } from "./authorization.mjs";

const REQUEST_KEYS = Object.freeze([
  "schemaVersion", "purpose", "oidcToken", "recoveryCaseId", "phase", "singleUseRequestId", "singleUseNonce",
]);

/**
 * Server-side policy issuer. Workflow credentials can present a GitHub OIDC
 * token, but cannot submit approval/configuration claims or a signing key.
 */
export function createRecoveryPolicySignerService({
  verifyWorkflowOidc,
  loadRecoveryCase,
  readProtectedEnvironmentConfiguration,
  loadAuthenticatedOwnerApproval,
  verifyAuthenticatedOwnerApproval,
  consumeSingleUseRequest,
  policySigner,
  ownerApprovalPublicKeys,
  allowedReviewerIds,
  policyKeyId,
  signerName,
  policyVersion,
  repository,
  phaseWorkflowBindings,
  now = () => Date.now(),
}) {
  const required = {
    verifyWorkflowOidc,
    loadRecoveryCase,
    readProtectedEnvironmentConfiguration,
    loadAuthenticatedOwnerApproval,
    verifyAuthenticatedOwnerApproval,
    consumeSingleUseRequest,
    policySigner,
  };
  for (const [name, value] of Object.entries(required)) if (typeof value !== "function") {
    throw new Error("Trusted recovery policy service dependency is missing: " + name + ".");
  }
  if (!Array.isArray(allowedReviewerIds) || allowedReviewerIds.length === 0 || !ownerApprovalPublicKeys
    || !policyKeyId || !signerName || !policyVersion || !repository || !phaseWorkflowBindings?.A || !phaseWorkflowBindings?.B) {
    throw new Error("Trusted recovery policy service configuration is incomplete.");
  }

  return Object.freeze({
    async issue(rawRequest) {
      assertExactKeys(rawRequest, REQUEST_KEYS, "Policy signer service request");
      if (rawRequest.schemaVersion !== 1 || rawRequest.purpose !== "request-recovery-environment-policy") {
        throw new Error("Policy signer request schema or purpose is invalid.");
      }
      if (rawRequest.phase !== "A" && rawRequest.phase !== "B") throw new Error("Policy signer phase is invalid.");
      for (const key of ["oidcToken", "recoveryCaseId", "singleUseRequestId", "singleUseNonce"]) {
        assertNonEmptyString(rawRequest[key], "request." + key);
      }
      if (rawRequest.oidcToken.length > 32_768 || [rawRequest.recoveryCaseId, rawRequest.singleUseRequestId, rawRequest.singleUseNonce]
        .some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))) {
        throw new Error("Policy signer request identifiers or OIDC token exceed their protocol bounds.");
      }
      const workflow = await verifyWorkflowOidc(rawRequest.oidcToken, { audience: "bodycast-production-recovery-policy" });
      if (!workflow || workflow.repository !== repository || workflow.ref !== "refs/heads/main"
        || workflow.environment !== "production-recovery") {
        throw new Error("Workflow OIDC token is not from the protected canonical-main recovery environment.");
      }
      assertGitSha(workflow.canonicalMainSha, "workflow.canonicalMainSha");
      const binding = phaseWorkflowBindings[rawRequest.phase];
      if (workflow.workflowPath !== binding.workflowPath || workflow.workflowId !== binding.workflowId) {
        throw new Error("Workflow path or ID is not authorized for this recovery phase.");
      }
      for (const key of ["workflowRunId", "workflowRunAttempt", "actorGithubUserId"]) assertNonEmptyString(workflow[key], "workflow." + key);

      const recoveryCase = await loadRecoveryCase(rawRequest.recoveryCaseId);
      if (!recoveryCase || recoveryCase.recoveryCaseId !== rawRequest.recoveryCaseId
        || recoveryCase.phase !== rawRequest.phase || recoveryCase.canonicalMainSha !== workflow.canonicalMainSha
        || recoveryCase.repository !== repository || recoveryCase.status !== "awaiting-owner-policy-review") {
        throw new Error("Recovery case is absent, stale, or not awaiting this phase's owner review.");
      }

      const environment = await readProtectedEnvironmentConfiguration("production-recovery");
      if (!environment || environment.environment !== "production-recovery" || environment.branchPolicy !== "main-only"
        || environment.preventSelfReview !== true || environment.adminBypassDisabled !== true
        || !Array.isArray(environment.allowlistedReviewerGithubUserIds) || !environment.configurationSnapshot) {
        throw new Error("Protected environment configuration does not meet the independently reviewed recovery policy.");
      }
      const reviewerAllowlist = [...environment.allowlistedReviewerGithubUserIds].map(String).sort();
      const configuredAllowlist = [...allowedReviewerIds].map(String).sort();
      if (canonicalDigest(reviewerAllowlist) !== canonicalDigest(configuredAllowlist)) {
        throw new Error("Protected environment reviewer allowlist differs from the trusted signer policy.");
      }
      const configurationDigest = canonicalDigest(environment.configurationSnapshot);
      const approval = await loadAuthenticatedOwnerApproval({
        workflow,
        recoveryCase,
        environment,
        phase: rawRequest.phase,
      });
      if (!approval || approval.reviewerGithubUserId === workflow.actorGithubUserId) {
        throw new Error("The protected-environment reviewer must be distinct from the workflow actor.");
      }
      const policy = {
        recoveryCaseId: rawRequest.recoveryCaseId,
        phase: rawRequest.phase,
        repository,
        canonicalMainSha: workflow.canonicalMainSha,
        workflowPath: workflow.workflowPath,
        workflowId: workflow.workflowId,
        workflowRunId: workflow.workflowRunId,
        workflowRunAttempt: workflow.workflowRunAttempt,
        reviewedConfigurationDigest: configurationDigest,
        singleUseRequestId: rawRequest.singleUseRequestId,
        singleUseNonce: rawRequest.singleUseNonce,
      };
      return issuePolicyAttestation({
        policy,
        ownerApproval: approval,
        signerConfig: {
          ownerApprovalPublicKeys,
          allowedReviewerIds: configuredAllowlist,
          policySigner,
          consumeSingleUseRequest,
          policyKeyId,
          signerName,
          policyVersion,
          independentApprovalVerifier: (candidate) => verifyAuthenticatedOwnerApproval({ candidate, workflow, recoveryCase, environment }),
        },
        now: now(),
      });
    },
  });
}

export { REQUEST_KEYS as POLICY_SIGNER_SERVICE_REQUEST_KEYS };
