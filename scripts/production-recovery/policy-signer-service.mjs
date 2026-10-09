import { randomBytes, randomUUID } from "node:crypto";
import { assertExactKeys, assertGitSha, assertNonEmptyString, assertSha256, canonicalDigest } from "./canonical.mjs";
import { issuePolicyAttestation } from "./authorization.mjs";
import { assertPinnedOwnerId, BODYCAST_OWNER_ID } from "../github-owner-identity.mjs";

const CHALLENGE_REQUEST_KEYS = Object.freeze([
  "schemaVersion", "purpose", "oidcToken", "recoveryCaseId", "phase",
]);
const POLICY_REQUEST_KEYS = Object.freeze([
  "schemaVersion", "purpose", "oidcToken", "recoveryCaseId", "phase", "challengeId", "challengeDigest",
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function assertPhaseWorkflow(workflow, phase, binding, repository, { requireEnvironment, ownerGithubActorId }) {
  if (!workflow || workflow.repository !== repository || workflow.ref !== "refs/heads/main"
    || workflow.eventName !== "workflow_dispatch"
    || workflow.workflowPath !== binding.workflowPath || workflow.workflowId !== binding.workflowId
    || (requireEnvironment ? workflow.environment !== "production-recovery" : Boolean(workflow.environment))) {
    throw new Error("Workflow OIDC is not from the exact canonical owner recovery phase and required environment boundary.");
  }
  assertGitSha(workflow.canonicalMainSha, "workflow.canonicalMainSha");
  if (String(workflow.repositoryOwnerId) !== String(BODYCAST_OWNER_ID)) {
    throw new Error("Recovery workflow OIDC repository owner does not match the pinned canonical owner ID.");
  }
  assertPinnedOwnerId(workflow.actorGithubUserId, "Authenticated recovery workflow actor ID");
  if (String(workflow.actorGithubUserId) !== String(ownerGithubActorId)) throw new Error("Recovery workflow actor is not the pinned owner.");
  for (const key of ["workflowRunId", "workflowRunAttempt"]) {
    assertNonEmptyString(workflow[key], "workflow." + key);
  }
  if (!/^[1-9][0-9]*$/.test(String(workflow.workflowRunId))
    || !/^[1-9][0-9]*$/.test(String(workflow.workflowRunAttempt))) {
    throw new Error("Recovery workflow run ID or attempt is invalid.");
  }
}

function assertEnvironmentPolicy(environment) {
  if (!environment || environment.environment !== "production-recovery" || environment.branchPolicy !== "main-only"
    || !environment.configurationSnapshot) {
    throw new Error("Recovery environment must be present with a main-only deployment branch policy.");
  }
  const requiredReviewers = environment.requiredReviewers ?? [];
  if (!Array.isArray(requiredReviewers) || requiredReviewers.length !== 0) {
    throw new Error("Owner-only recovery environment must not require a second human reviewer.");
  }
  return canonicalDigest(environment.configurationSnapshot);
}

/**
 * Trusted server-side challenge issuer and machine policy signer. The nonce is
 * generated and persisted here, never accepted from workflow input.
 */
export function createRecoveryPolicySignerService({
  verifyWorkflowOidc,
  loadRecoveryCase,
  readProtectedEnvironmentConfiguration,
  createPhaseChallenge,
  loadPhaseChallenge,
  consumeSingleUseRequest,
  policySigner,
  ownerGithubActorId = BODYCAST_OWNER_ID,
  policyKeyId,
  signerName,
  policyVersion,
  repository,
  phaseWorkflowBindings,
  now = () => Date.now(),
  createNonce = () => randomBytes(32).toString("hex"),
  createId = () => randomUUID(),
}) {
  const required = {
    verifyWorkflowOidc, loadRecoveryCase, readProtectedEnvironmentConfiguration, createPhaseChallenge,
    loadPhaseChallenge, consumeSingleUseRequest, policySigner,
  };
  for (const [name, value] of Object.entries(required)) if (typeof value !== "function") {
    throw new Error("Trusted recovery policy service dependency is missing: " + name + ".");
  }
  assertPinnedOwnerId(ownerGithubActorId, "Configured recovery owner ID");
  if (!policyKeyId || !signerName || !policyVersion || !repository || !phaseWorkflowBindings?.A || !phaseWorkflowBindings?.B) {
    throw new Error("Trusted recovery policy service configuration is incomplete.");
  }

  return Object.freeze({
    async createChallenge(rawRequest) {
      assertExactKeys(rawRequest, CHALLENGE_REQUEST_KEYS, "Recovery challenge request");
      if (rawRequest.schemaVersion !== 1 || rawRequest.purpose !== "create-recovery-phase-challenge"
        || !["A", "B"].includes(rawRequest.phase)) throw new Error("Recovery challenge request schema is invalid.");
      assertNonEmptyString(rawRequest.oidcToken, "request.oidcToken");
      assertNonEmptyString(rawRequest.recoveryCaseId, "request.recoveryCaseId");
      if (rawRequest.oidcToken.length > 32_768 || !ID_PATTERN.test(rawRequest.recoveryCaseId)) {
        throw new Error("Recovery challenge request exceeds protocol bounds.");
      }
      const phase = rawRequest.phase;
      const workflow = await verifyWorkflowOidc(rawRequest.oidcToken, { audience: "bodycast-production-recovery-policy" });
      assertPhaseWorkflow(workflow, phase, phaseWorkflowBindings[phase], repository, { requireEnvironment: false, ownerGithubActorId });
      const recoveryCase = await loadRecoveryCase(rawRequest.recoveryCaseId);
      if (!recoveryCase || recoveryCase.recoveryCaseId !== rawRequest.recoveryCaseId || recoveryCase.phase !== phase
        || recoveryCase.canonicalMainSha !== workflow.canonicalMainSha || recoveryCase.repository !== repository
        || recoveryCase.status !== "awaiting-owner-policy-review") {
        throw new Error("Recovery case is absent, stale, or not awaiting this phase's owner authorization.");
      }
      const environment = await readProtectedEnvironmentConfiguration("production-recovery");
      const reviewedConfigurationDigest = assertEnvironmentPolicy(environment);
      const createdAt = new Date(now()).toISOString();
      const expiresAt = new Date(now() + 30 * 60 * 1000).toISOString();
      const nonce = createNonce();
      if (typeof nonce !== "string" || !/^[a-f0-9]{64,128}$/.test(nonce)) throw new Error("Trusted challenge nonce generator returned an invalid nonce.");
      const challenge = Object.freeze({
        schemaVersion: 1,
        purpose: "bodycast-production-recovery-owner-authorization-challenge",
        challengeId: "challenge-" + createId(),
        recoveryCaseId: rawRequest.recoveryCaseId,
        phase,
        repository,
        canonicalMainSha: workflow.canonicalMainSha,
        workflowPath: workflow.workflowPath,
        workflowId: workflow.workflowId,
        workflowRunId: workflow.workflowRunId,
        workflowRunAttempt: workflow.workflowRunAttempt,
        actorGithubUserId: String(workflow.actorGithubUserId),
        workflowRef: workflow.ref,
        singleUseRequestId: "policy-request-" + createId(),
        singleUseNonce: nonce,
        recoveryCaseSnapshotDigest: canonicalDigest(recoveryCase),
        reviewedConfigurationDigest,
        createdAt,
        expiresAt,
      });
      const challengeDigest = canonicalDigest(challenge);
      if (await createPhaseChallenge(challenge, challengeDigest) !== true) {
        throw new Error("Durable recovery challenge persistence rejected the new challenge.");
      }
      return Object.freeze({ challenge, challengeDigest });
    },

    async issue(rawRequest) {
      assertExactKeys(rawRequest, POLICY_REQUEST_KEYS, "Policy signer service request");
      if (rawRequest.schemaVersion !== 1 || rawRequest.purpose !== "request-recovery-owner-policy"
        || !["A", "B"].includes(rawRequest.phase)) throw new Error("Policy signer request schema or purpose is invalid.");
      for (const key of ["oidcToken", "recoveryCaseId", "challengeId"]) assertNonEmptyString(rawRequest[key], "request." + key);
      assertSha256(rawRequest.challengeDigest, "request.challengeDigest");
      if (rawRequest.oidcToken.length > 32_768 || !ID_PATTERN.test(rawRequest.recoveryCaseId) || !ID_PATTERN.test(rawRequest.challengeId)) {
        throw new Error("Policy signer request identifiers or OIDC token exceed their protocol bounds.");
      }
      const phase = rawRequest.phase;
      const workflow = await verifyWorkflowOidc(rawRequest.oidcToken, { audience: "bodycast-production-recovery-policy" });
      assertPhaseWorkflow(workflow, phase, phaseWorkflowBindings[phase], repository, { requireEnvironment: true, ownerGithubActorId });
      const recoveryCase = await loadRecoveryCase(rawRequest.recoveryCaseId);
      if (!recoveryCase || recoveryCase.recoveryCaseId !== rawRequest.recoveryCaseId || recoveryCase.phase !== phase
        || recoveryCase.canonicalMainSha !== workflow.canonicalMainSha || recoveryCase.repository !== repository
        || recoveryCase.status !== "awaiting-owner-policy-review") {
        throw new Error("Recovery case is absent, stale, or not awaiting this phase's owner authorization.");
      }
      const challenge = await loadPhaseChallenge(rawRequest.challengeId);
      if (!challenge || challenge.challenge.challengeId !== rawRequest.challengeId
        || canonicalDigest(challenge.challenge) !== challenge.challengeDigest
        || challenge.challengeDigest !== rawRequest.challengeDigest
        || challenge.challenge.recoveryCaseId !== rawRequest.recoveryCaseId || challenge.challenge.phase !== phase
        || challenge.challenge.repository !== repository || challenge.challenge.canonicalMainSha !== workflow.canonicalMainSha
        || challenge.challenge.workflowPath !== workflow.workflowPath || challenge.challenge.workflowId !== workflow.workflowId
        || challenge.challenge.workflowRunId !== workflow.workflowRunId
        || challenge.challenge.workflowRunAttempt !== workflow.workflowRunAttempt
        || challenge.challenge.actorGithubUserId !== String(workflow.actorGithubUserId)
        || challenge.challenge.recoveryCaseSnapshotDigest !== canonicalDigest(recoveryCase)) {
        throw new Error("Persisted challenge is stale, altered, cross-run, cross-case, or cross-phase.");
      }
      if (Date.parse(challenge.challenge.expiresAt) <= now() || Date.parse(challenge.challenge.createdAt) > now()) {
        throw new Error("Persisted recovery challenge is expired or future-dated.");
      }
      const environment = await readProtectedEnvironmentConfiguration("production-recovery");
      const configurationDigest = assertEnvironmentPolicy(environment);
      if (configurationDigest !== challenge.challenge.reviewedConfigurationDigest) {
        throw new Error("Protected environment configuration changed after challenge publication.");
      }
      const policy = {
        recoveryCaseId: rawRequest.recoveryCaseId,
        phase,
        repository,
        canonicalMainSha: workflow.canonicalMainSha,
        workflowPath: workflow.workflowPath,
        workflowId: workflow.workflowId,
        workflowRunId: workflow.workflowRunId,
        workflowRunAttempt: workflow.workflowRunAttempt,
        actorGithubUserId: String(workflow.actorGithubUserId),
        reviewedConfigurationDigest: configurationDigest,
        singleUseRequestId: challenge.challenge.singleUseRequestId,
        singleUseNonce: challenge.challenge.singleUseNonce,
        challengeId: challenge.challenge.challengeId,
        challengeDigest: challenge.challengeDigest,
      };
      return issuePolicyAttestation({
        policy,
        signerConfig: {
          policySigner,
          consumeSingleUseRequest,
          policyKeyId,
          signerName,
          policyVersion,
          ownerGithubActorId,
        },
        now: now(),
      });
    },
  });
}

export { POLICY_REQUEST_KEYS as POLICY_SIGNER_SERVICE_REQUEST_KEYS, CHALLENGE_REQUEST_KEYS as RECOVERY_CHALLENGE_REQUEST_KEYS };
