import {
  assertExactKeys,
  assertGitSha,
  assertNonEmptyString,
  assertSha256,
  assertUtcTimestamp,
  canonicalDigest,
} from "./canonical.mjs";
import { assertPinnedOwnerId } from "../github-owner-identity.mjs";

export const RECOVERY_STATES = Object.freeze([
  "ddl-started",
  "schema-applied",
  "app-ready",
  "restore-authorized",
  "restore-in-progress",
  "restore-verified",
  "recovery-authorized",
  "rollback-app-ready",
  "writers-enabled",
  "recovery-complete",
  "traffic-open",
  "recovery-finalized",
]);

export const JOURNAL_GENESIS_DIGEST = "0".repeat(64);
export const RECOVERY_AUTHORIZATION_SCHEMA_VERSION = 2;
export const PHASE_B_CAPABILITIES = Object.freeze([
  "complete-recovery",
  "enable-writers",
  "finalize-recovery",
  "mark-rollback-app-ready",
  "open-traffic",
]);

const JOURNAL_TRANSITIONS = Object.freeze({
  "bootstrap-failed-release": { from: [null], to: ["ddl-started", "schema-applied", "app-ready"] },
  "authorize-restore": { from: ["ddl-started", "schema-applied", "app-ready"], to: ["restore-authorized"] },
  "begin-restore": { from: ["restore-authorized"], to: ["restore-in-progress"] },
  "verify-restore": { from: ["restore-in-progress"], to: ["restore-verified"] },
  "authorize-recovery": { from: ["restore-verified"], to: ["recovery-authorized"] },
  "mark-rollback-app-ready": { from: ["recovery-authorized"], to: ["rollback-app-ready"] },
  "enable-writers": { from: ["rollback-app-ready"], to: ["writers-enabled"] },
  "complete-recovery": { from: ["writers-enabled"], to: ["recovery-complete"] },
  "open-traffic": { from: ["recovery-complete"], to: ["traffic-open"] },
  "finalize-recovery": { from: ["traffic-open"], to: ["recovery-finalized"] },
});

export function isAllowedJournalTransition(transition, priorState, nextState) {
  const rule = JOURNAL_TRANSITIONS[transition];
  return Boolean(rule && rule.from.includes(priorState) && rule.to.includes(nextState));
}

export const PHASE_A_CLAIM_KEYS = Object.freeze([
  "schemaVersion", "purpose", "capability", "repository", "workflowPath", "workflowId", "workflowRunId",
  "workflowRunAttempt", "workflowRef", "canonicalMainSha", "recoveryEnvironment", "recoveryCaseId", "failedReleaseSha",
  "manifestId", "priorJournalGeneration", "priorJournalRecordDigest", "priorMarkerSchemaVersion",
  "priorMarkerState", "priorMarkerDigest", "rollbackAppSha", "rollbackContainerId", "rollbackImageId",
  "rollbackImageDigest", "rollbackArtifactId", "rollbackArtifactDigest", "rollbackCaptureAttestationDigest",
  "composeProjectServiceIdentityDigest", "deployHostTopologyDigest", "backupArtifactId", "backupArtifactDigest",
  "hostBackupSha256", "backupSnapshotTimestamp", "logicalProductionDbIdentityDigest",
  "expectedPreDdlSchemaDigest", "expectedPreDdlMigrationHistoryDigest", "preflightEvidenceDigest", "ownerIdentity",
  "markerReaderRolloutReceiptDigest", "phaseAPolicyAttestationDigest", "phaseAPolicyAttestationNonce",
  "phaseAPolicyChallengeId", "phaseAPolicyChallengeDigest",
  "phaseAPolicyReviewedAt", "phaseAPolicyExpiresAt", "phaseAPolicyVersion", "hostRecoveryAuthorityIdentity",
  "hostRecoveryAuthorityKeyId", "issuedAt", "expiresAt", "authorizationId", "nonce",
]);

export const PHASE_B_CLAIM_KEYS = Object.freeze([
  "schemaVersion", "purpose", "capabilitySet", "repository", "workflowPath", "workflowId", "workflowRunId",
  "workflowRunAttempt", "workflowRef", "canonicalMainSha", "recoveryEnvironment", "recoveryCaseId", "failedReleaseSha", "manifestId",
  "phaseAAuthorizationId", "phaseAEnvelopeDigest", "phaseAJournalGeneration", "phaseAJournalRecordDigest",
  "restoreInProgressJournalGeneration", "restoreInProgressJournalRecordDigest", "restoreVerifiedJournalGeneration",
  "restoreVerifiedJournalRecordDigest", "restoreEvidenceArtifactId", "restoreEvidenceArtifactDigest",
  "restoreResultDigest", "backupArtifactId", "backupArtifactDigest", "hostBackupSha256", "backupSnapshotTimestamp",
  "actualRestoredLogicalDbIdentityDigest", "liveDbObservationsDigest", "expectedRestoredSchemaDigest",
  "actualRestoredSchemaDigest", "expectedMigrationHistoryDigest", "actualMigrationHistoryDigest",
  "writerDrainDigest", "topologyDigest", "observedAt", "rollbackAppSha", "rollbackContainerId", "rollbackImageId",
  "rollbackImageDigest", "rollbackArtifactId", "rollbackArtifactDigest", "rollbackCaptureAttestationDigest",
  "composeProjectServiceIdentityDigest", "deployHostTopologyDigest", "ownerIdentity", "markerReaderRolloutReceiptDigest",
  "phaseBPolicyAttestationDigest", "phaseBPolicyAttestationNonce", "phaseBPolicyReviewedAt", "phaseBPolicyExpiresAt",
  "phaseBPolicyVersion", "hostRecoveryAuthorityIdentity", "hostRecoveryAuthorityKeyId", "issuedAt", "expiresAt",
  "phaseBPolicyChallengeId", "phaseBPolicyChallengeDigest", "authorizationId", "nonce",
]);

export const POLICY_ATTESTATION_KEYS = Object.freeze([
  "schemaVersion", "purpose", "recoveryCaseId", "phase", "repository", "canonicalMainSha", "environment",
  "workflowPath", "workflowId", "workflowRunId", "workflowRunAttempt", "authorizedActorGithubUserId",
  "branchPolicy", "reviewedConfigurationDigest", "reviewedAt", "expiresAt",
  "singleUseRequestId", "singleUseNonce", "challengeId", "challengeDigest", "policyVersion", "signer", "keyId", "signature",
]);

const OWNER_IDENTITY_CLAIM_KEYS = Object.freeze([
  "environment", "githubActorId", "workflowRunId", "workflowRunAttempt", "challengeId", "challengeDigest", "singleUseNonce",
]);

const digestClaimKeys = new Set([
  "priorJournalRecordDigest", "priorMarkerDigest", "rollbackImageDigest", "rollbackArtifactDigest",
  "rollbackCaptureAttestationDigest", "composeProjectServiceIdentityDigest", "deployHostTopologyDigest",
  "backupArtifactDigest", "hostBackupSha256", "logicalProductionDbIdentityDigest", "expectedPreDdlSchemaDigest",
  "expectedPreDdlMigrationHistoryDigest", "preflightEvidenceDigest", "phaseAEnvelopeDigest",
  "phaseAJournalRecordDigest", "restoreInProgressJournalRecordDigest", "restoreVerifiedJournalRecordDigest",
  "restoreEvidenceArtifactDigest", "restoreResultDigest", "liveDbObservationsDigest", "expectedRestoredSchemaDigest",
  "actualRestoredSchemaDigest", "expectedMigrationHistoryDigest", "actualMigrationHistoryDigest", "writerDrainDigest",
  "topologyDigest", "markerReaderRolloutReceiptDigest", "phaseAPolicyAttestationDigest",
  "phaseBPolicyAttestationDigest", "phaseAPolicyChallengeDigest", "phaseBPolicyChallengeDigest", "challengeDigest",
]);

const gitShaClaimKeys = new Set(["canonicalMainSha", "failedReleaseSha", "rollbackAppSha"]);

function validateOwnerIdentity(value, label) {
  assertExactKeys(value, OWNER_IDENTITY_CLAIM_KEYS, label);
  for (const key of OWNER_IDENTITY_CLAIM_KEYS) assertNonEmptyString(value[key], label + "." + key);
  assertPinnedOwnerId(value.githubActorId, label + ".githubActorId");
  assertSha256(value.challengeDigest, label + ".challengeDigest");
  if (!Number.isSafeInteger(Number(value.workflowRunAttempt)) || Number(value.workflowRunAttempt) < 1) {
    throw new Error(label + ".workflowRunAttempt must be a positive integer.");
  }
}

function validateClaims(claims, keys, phase) {
  assertExactKeys(claims, keys, "Phase " + phase + " claims");
  for (const [key, value] of Object.entries(claims)) {
    if (key === "ownerIdentity") {
      validateOwnerIdentity(value, "Phase " + phase + " ownerIdentity");
    } else if (key === "capabilitySet") {
      if (phase !== "B" || !Array.isArray(value)
        || value.length !== PHASE_B_CAPABILITIES.length
        || value.some((entry, index) => entry !== PHASE_B_CAPABILITIES[index])) {
        throw new Error("Phase B capabilitySet must equal the exact sorted recovery transition set.");
      }
    } else if (key === "schemaVersion") {
      if (value !== RECOVERY_AUTHORIZATION_SCHEMA_VERSION) throw new Error("Recovery authorization claims schema version is unsupported.");
    } else if (key === "priorMarkerSchemaVersion") {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("priorMarkerSchemaVersion must be a positive safe integer.");
    } else if (key.endsWith("Generation") || key === "priorJournalGeneration") {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(key + " must be a non-negative safe integer.");
    } else if (digestClaimKeys.has(key)) {
      assertSha256(value, key);
    } else if (gitShaClaimKeys.has(key)) {
      assertGitSha(value, key);
    } else {
      assertNonEmptyString(value, key);
    }
  }

  if (phase === "A") {
    if (claims.purpose !== "recovery Phase A restore-only" || claims.capability !== "restore-only") {
      throw new Error("Phase A purpose/capability is invalid.");
    }
  } else if (claims.purpose !== "post-restore recovery authorization") {
    throw new Error("Phase B purpose is invalid.");
  }
  if (claims.recoveryEnvironment !== "production-recovery") throw new Error("recoveryEnvironment is invalid.");
  if (claims.ownerIdentity.environment !== claims.recoveryEnvironment
    || claims.ownerIdentity.workflowRunId !== claims.workflowRunId
    || claims.ownerIdentity.workflowRunAttempt !== claims.workflowRunAttempt) {
    throw new Error("Pinned owner OIDC identity does not bind the exact workflow run and attempt.");
  }
  if (phase === "A" && !["ddl-started", "schema-applied", "app-ready"].includes(claims.priorMarkerState)) {
    throw new Error("Phase A can authorize restore only from a failed normal release state.");
  }
  if (phase === "A" && claims.priorMarkerSchemaVersion !== 2) {
    throw new Error("Phase A must bind the supported V2 marker projection.");
  }
  assertUtcTimestamp(claims.issuedAt, "issuedAt");
  assertUtcTimestamp(claims.expiresAt, "expiresAt");
  if (Date.parse(claims.expiresAt) <= Date.parse(claims.issuedAt)
    || Date.parse(claims.expiresAt) - Date.parse(claims.issuedAt) > 30 * 60 * 1000) {
    throw new Error("Authorization issue/expiry interval is invalid or exceeds 30 minutes.");
  }
  if (phase === "A") {
    assertUtcTimestamp(claims.backupSnapshotTimestamp, "backupSnapshotTimestamp");
    assertUtcTimestamp(claims.phaseAPolicyReviewedAt, "phaseAPolicyReviewedAt");
    assertUtcTimestamp(claims.phaseAPolicyExpiresAt, "phaseAPolicyExpiresAt");
  } else {
    assertUtcTimestamp(claims.backupSnapshotTimestamp, "backupSnapshotTimestamp");
    assertUtcTimestamp(claims.observedAt, "observedAt");
    assertUtcTimestamp(claims.phaseBPolicyReviewedAt, "phaseBPolicyReviewedAt");
    assertUtcTimestamp(claims.phaseBPolicyExpiresAt, "phaseBPolicyExpiresAt");
  }
}

export function validatePhaseAClaims(claims) {
  validateClaims(claims, PHASE_A_CLAIM_KEYS, "A");
  return claims;
}

export function validatePhaseBClaims(claims) {
  validateClaims(claims, PHASE_B_CLAIM_KEYS, "B");
  return claims;
}

export function validatePolicyAttestation(attestation) {
  assertExactKeys(attestation, POLICY_ATTESTATION_KEYS, "Recovery environment policy attestation");
  if (attestation.schemaVersion !== 2 || attestation.purpose !== "recovery-owner-authorization-policy") {
    throw new Error("Policy attestation schema or purpose is unsupported.");
  }
  if (attestation.phase !== "A" && attestation.phase !== "B") throw new Error("Policy attestation phase is invalid.");
  if (attestation.environment !== "production-recovery") throw new Error("Policy attestation environment is invalid.");
  if (attestation.branchPolicy !== "main-only") throw new Error("Policy branch policy must be main-only.");
  for (const key of ["recoveryCaseId", "repository", "workflowPath", "workflowId", "workflowRunId", "workflowRunAttempt",
    "authorizedActorGithubUserId", "singleUseRequestId", "singleUseNonce", "challengeId", "policyVersion", "signer", "keyId", "signature"]) {
    assertNonEmptyString(attestation[key], "policy." + key);
  }
  assertPinnedOwnerId(attestation.authorizedActorGithubUserId, "Policy authorized actor ID");
  assertGitSha(attestation.canonicalMainSha, "policy.canonicalMainSha");
  assertSha256(attestation.reviewedConfigurationDigest, "policy.reviewedConfigurationDigest");
  assertSha256(attestation.challengeDigest, "policy.challengeDigest");
  assertUtcTimestamp(attestation.reviewedAt, "policy.reviewedAt");
  assertUtcTimestamp(attestation.expiresAt, "policy.expiresAt");
  const lifetime = Date.parse(attestation.expiresAt) - Date.parse(attestation.reviewedAt);
  if (lifetime <= 0 || lifetime > 30 * 60 * 1000) throw new Error("Policy attestation must be valid for at most 30 minutes.");
  return attestation;
}

export function assertPolicyMatchesClaims(attestation, claims, phase, now = Date.now()) {
  validatePolicyAttestation(attestation);
  const policyPhase = phase;
  const prefix = phase === "A" ? "phaseA" : "phaseB";
  const expected = {
    recoveryCaseId: claims.recoveryCaseId,
    phase: policyPhase,
    repository: claims.repository,
    canonicalMainSha: claims.canonicalMainSha,
    workflowPath: claims.workflowPath,
    workflowId: claims.workflowId,
    workflowRunId: claims.workflowRunId,
    workflowRunAttempt: claims.workflowRunAttempt,
    authorizedActorGithubUserId: claims.ownerIdentity.githubActorId,
    reviewedAt: claims[prefix + "PolicyReviewedAt"],
    expiresAt: claims[prefix + "PolicyExpiresAt"],
    singleUseNonce: claims[prefix + "PolicyAttestationNonce"],
    challengeId: claims[prefix + "PolicyChallengeId"],
    challengeDigest: claims[prefix + "PolicyChallengeDigest"],
    policyVersion: claims[prefix + "PolicyVersion"],
  };
  for (const [key, value] of Object.entries(expected)) {
    if (attestation[key] !== value) throw new Error("Policy attestation binding mismatch: " + key + ".");
  }
  if (attestation.environment !== claims.recoveryEnvironment) throw new Error("Policy environment binding mismatch.");
  if (claims.ownerIdentity.challengeId !== attestation.challengeId
    || claims.ownerIdentity.challengeDigest !== attestation.challengeDigest
    || claims.ownerIdentity.singleUseNonce !== attestation.singleUseNonce) {
    throw new Error("Pinned owner identity and signed phase envelope do not bind the same nonce challenge.");
  }
  if (attestation.workflowRunId !== claims.ownerIdentity.workflowRunId
    || attestation.workflowRunAttempt !== claims.ownerIdentity.workflowRunAttempt) {
    throw new Error("Policy attestation does not bind the authenticated owner workflow run.");
  }
  const digestClaim = claims[prefix + "PolicyAttestationDigest"];
  if (canonicalDigest(attestation) !== digestClaim) throw new Error("Policy attestation digest binding mismatch.");
  if (Date.parse(attestation.expiresAt) <= now) throw new Error("Policy attestation is expired.");
  if (Date.parse(attestation.reviewedAt) > now) {
    throw new Error("Owner authorization timestamp is from the future.");
  }
  return true;
}
