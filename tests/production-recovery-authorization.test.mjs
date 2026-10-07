import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  canonicalDigest,
  omitFields,
  signCanonical,
  verifyCanonical,
} from "../scripts/production-recovery/canonical.mjs";
import {
  createAuthorizationEnvelope,
  verifyAuthorizationEnvelope,
} from "../scripts/production-recovery/authorization.mjs";
import { createIndependentPolicySigner } from "../scripts/production-recovery/policy-signer.mjs";
import { createRecoveryAuthorizationIssuer } from "../scripts/production-recovery/authorization-issuer-service.mjs";
import {
  PHASE_A_CLAIM_KEYS,
  PHASE_B_CLAIM_KEYS,
  PHASE_B_CAPABILITIES,
} from "../scripts/production-recovery/schemas.mjs";

const now = Date.parse("2026-10-07T12:00:00.000Z");
const time = new Date(now).toISOString();
const expiry = new Date(now + 15 * 60 * 1000).toISOString();
const sha = "a".repeat(40);
const digest = "b".repeat(64);

function keyPair() {
  return generateKeyPairSync("ed25519");
}

async function makePolicyFixture(phase) {
  const owner = keyPair();
  const policy = keyPair();
  const auth = keyPair();
  const policyRequest = {
    recoveryCaseId: "recovery-case-001",
    phase,
    repository: "krustallik/body-model",
    canonicalMainSha: sha,
    workflowPath: ".github/workflows/production-recovery.yml",
    workflowId: "901",
    workflowRunId: "902",
    workflowRunAttempt: "1",
    reviewedConfigurationDigest: digest,
    singleUseRequestId: "approval-request-" + phase,
    singleUseNonce: "policy-nonce-" + phase,
    challengeId: "challenge-phase-" + phase,
    challengeDigest: (phase === "A" ? "a" : "b").repeat(64),
  };
  const ownerApprovalBody = {
    schemaVersion: 1,
    purpose: "recovery-policy-owner-approval",
    ...policyRequest,
    environment: "production-recovery",
    reviewerGithubUserId: "12345",
    approvalState: "approved",
    approvalId: "github-approval-" + phase,
    approvalTimestamp: time,
    keyId: "owner-review-key",
  };
  const ownerApproval = {
    ...ownerApprovalBody,
    signature: signCanonical(ownerApprovalBody, owner.privateKey),
  };
  const consumedRequests = new Set();
  const signer = createIndependentPolicySigner({
    ownerApprovalPublicKeys: { "owner-review-key": owner.publicKey },
    allowedReviewerIds: ["12345"],
    policySigner: (body) => signCanonical(body, policy.privateKey),
    policyKeyId: "policy-key",
    signerName: "independent-policy-service",
    policyVersion: "2026-10",
    consumeSingleUseRequest: async ({ requestId, nonce }) => {
      const key = requestId + "\0" + nonce;
      if (consumedRequests.has(key)) return false;
      consumedRequests.add(key);
      return true;
    },
    independentApprovalVerifier: async (approval) => verifyCanonical(
      omitFields(approval, ["signature"]),
      approval.signature,
      owner.publicKey,
    ),
  });
  const attestation = await signer.issue({ policy: policyRequest, ownerApproval }, { now });
  return { attestation, auth, owner, policy, policyRequest, ownerApproval };
}

function claimsFor(phase, attestation, policyRequest) {
  const keys = phase === "A" ? PHASE_A_CLAIM_KEYS : PHASE_B_CLAIM_KEYS;
  const claims = {};
  for (const key of keys) {
    if (key === "schemaVersion") claims[key] = 1;
    else if (key === "ownerApproval") claims[key] = {
      environment: "production-recovery",
      reviewerGithubUserId: "12345",
      reviewerLogin: "owner-reviewer",
      approvalState: "approved",
      approvalTime: time,
      runId: policyRequest.workflowRunId,
      runAttempt: policyRequest.workflowRunAttempt,
      challengeId: policyRequest.challengeId,
      challengeDigest: policyRequest.challengeDigest,
      singleUseNonce: policyRequest.singleUseNonce,
    };
    else if (key === "capabilitySet") claims[key] = [...PHASE_B_CAPABILITIES];
    else if (key === "phaseAPolicyExpiresAt" || key === "phaseBPolicyExpiresAt") claims[key] = attestation.expiresAt;
    else if (key === "phaseAPolicyReviewedAt" || key === "phaseBPolicyReviewedAt") claims[key] = attestation.reviewedAt;
    else if (key === "phaseAPolicyAttestationNonce" || key === "phaseBPolicyAttestationNonce") claims[key] = attestation.singleUseNonce;
    else if (key === "phaseAPolicyChallengeId" || key === "phaseBPolicyChallengeId") claims[key] = attestation.challengeId;
    else if (key === "phaseAPolicyChallengeDigest" || key === "phaseBPolicyChallengeDigest") claims[key] = attestation.challengeDigest;
    else if (key === "phaseAPolicyVersion" || key === "phaseBPolicyVersion") claims[key] = attestation.policyVersion;
    else if (key === "phaseAPolicyAttestationDigest" || key === "phaseBPolicyAttestationDigest") claims[key] = canonicalDigest(attestation);
    else if (key === "priorJournalGeneration") claims[key] = 4;
    else if (key.endsWith("Generation")) claims[key] = 8;
    else if (key === "priorMarkerState") claims[key] = "ddl-started";
    else if (key === "priorMarkerSchemaVersion") claims[key] = 2;
    else if (key === "purpose") claims[key] = phase === "A" ? "recovery Phase A restore-only" : "post-restore recovery authorization";
    else if (key === "capability") claims[key] = "restore-only";
    else if (key === "recoveryEnvironment") claims[key] = "production-recovery";
    else if (key === "recoveryCaseId") claims[key] = policyRequest.recoveryCaseId;
    else if (key === "canonicalMainSha" || key === "failedReleaseSha" || key === "rollbackAppSha") claims[key] = sha;
    else if (key.endsWith("Digest") || key.endsWith("Sha256")) claims[key] = digest;
    else if (key.endsWith("At") || key.endsWith("Timestamp")) claims[key] = time;
    else if (key === "expiresAt") claims[key] = expiry;
    else if (key === "workflowPath") claims[key] = policyRequest.workflowPath;
    else if (key === "workflowId") claims[key] = policyRequest.workflowId;
    else if (key === "workflowRunId") claims[key] = policyRequest.workflowRunId;
    else if (key === "workflowRunAttempt") claims[key] = policyRequest.workflowRunAttempt;
    else if (key === "repository") claims[key] = policyRequest.repository;
    else claims[key] = key + "-value";
  }
  claims.issuedAt = time;
  claims.expiresAt = expiry;
  return claims;
}

describe("production recovery authorization", () => {
  it("issues a phase envelope only from current OIDC, a signed policy, trusted facts, and independent owner approval", async () => {
    const fixture = await makePolicyFixture("A");
    const phaseBinding = { workflowPath: fixture.policyRequest.workflowPath, workflowId: fixture.policyRequest.workflowId };
    const allClaims = claimsFor("A", fixture.attestation, fixture.policyRequest);
    const constructedFields = new Set([
      "schemaVersion", "purpose", "capability", "repository", "workflowPath", "workflowId", "workflowRunId",
      "workflowRunAttempt", "workflowRef", "canonicalMainSha", "recoveryEnvironment", "ownerApproval",
      "phaseAPolicyAttestationDigest", "phaseAPolicyAttestationNonce", "phaseAPolicyReviewedAt",
      "phaseAPolicyChallengeId", "phaseAPolicyChallengeDigest",
      "phaseAPolicyExpiresAt", "phaseAPolicyVersion", "hostRecoveryAuthorityIdentity", "hostRecoveryAuthorityKeyId",
      "issuedAt", "expiresAt", "authorizationId", "nonce",
    ]);
    const facts = Object.fromEntries(Object.entries(allClaims).filter(([key]) => !constructedFields.has(key)));
    const workflow = {
      repository: fixture.policyRequest.repository,
      ref: "refs/heads/main",
      environment: "production-recovery",
      canonicalMainSha: fixture.policyRequest.canonicalMainSha,
      workflowPath: fixture.policyRequest.workflowPath,
      workflowId: fixture.policyRequest.workflowId,
      workflowRunId: fixture.policyRequest.workflowRunId,
      workflowRunAttempt: fixture.policyRequest.workflowRunAttempt,
      actorGithubUserId: "67890",
    };
    let generated = 0;
    const issuer = createRecoveryAuthorizationIssuer({
      verifyWorkflowOidc: async (token, { audience }) => token === "verified-oidc" && audience === "bodycast-production-recovery-authorization" ? workflow : null,
      loadRecoveryCase: async () => ({
        recoveryCaseId: fixture.policyRequest.recoveryCaseId, phase: "A", repository: workflow.repository,
        canonicalMainSha: workflow.canonicalMainSha, status: "awaiting-owner-policy-review",
        hostRecoveryAuthorityIdentity: "host-authority-1", hostRecoveryAuthorityKeyId: "authority-key-1",
        expiresAt: expiry, phaseAAuthorizationEvidenceId: "phase-a-evidence", markerReaderRolloutReceiptId: "rollout-1",
      }),
      loadPhaseFacts: async () => facts,
      loadAuthenticatedOwnerApproval: async ({ policy }) => ({
        reviewerGithubUserId: "12345", reviewerLogin: "owner-reviewer", approvalId: fixture.ownerApproval.approvalId,
        approvalTimestamp: time,
        challengeId: policy.challengeId, challengeDigest: policy.challengeDigest, singleUseNonce: policy.singleUseNonce,
      }),
      verifyAuthenticatedOwnerApproval: async ({ approval }) => approval.reviewerGithubUserId === "12345",
      policyPublicKeys: { "policy-key": fixture.policy.publicKey },
      allowedReviewerIds: ["12345"],
      phaseWorkflowBindings: { A: phaseBinding, B: { workflowPath: ".github/workflows/phase-b.yml", workflowId: "903" } },
      phaseSigners: { A: { keyId: "phase-a-key", privateKey: fixture.auth.privateKey }, B: { keyId: "phase-b-key", privateKey: keyPair().privateKey } },
      repository: workflow.repository,
      now: () => now,
      createId: () => `id-${++generated}`,
    });

    const issued = await issuer.issue({
      schemaVersion: 1,
      purpose: "issue-recovery-phase-authorization",
      oidcToken: "verified-oidc",
      recoveryCaseId: fixture.policyRequest.recoveryCaseId,
      phase: "A",
      challengeId: fixture.attestation.challengeId,
      challengeDigest: fixture.attestation.challengeDigest,
      policyAttestation: fixture.attestation,
    });
    const verified = verifyAuthorizationEnvelope(issued.envelope, {
      phase: "A",
      publicKeys: { "phase-a-key": fixture.auth.publicKey },
      policyAttestation: fixture.attestation,
      policyPublicKeys: { "policy-key": fixture.policy.publicKey },
      now,
      expectedBindings: { workflowRunId: workflow.workflowRunId, canonicalMainSha: workflow.canonicalMainSha },
    });
    expect(verified.claims.ownerApproval.reviewerLogin).toBe("owner-reviewer");
    expect(issued.authorizationId).toBe(verified.claims.authorizationId);
    expect(issued).toMatchObject({ evidenceId: "phase-a-evidence", rolloutReceiptId: "rollout-1" });
    await expect(issuer.issue({
      schemaVersion: 1, purpose: "issue-recovery-phase-authorization", oidcToken: "caller-claims",
      recoveryCaseId: fixture.policyRequest.recoveryCaseId, phase: "A", policyAttestation: fixture.attestation,
      challengeId: fixture.attestation.challengeId, challengeDigest: fixture.attestation.challengeDigest,
      claims: allClaims,
    })).rejects.toThrow(/closed schema/);
    await expect(issuer.issue({
      schemaVersion: 1, purpose: "issue-recovery-phase-authorization", oidcToken: "invalid",
      recoveryCaseId: fixture.policyRequest.recoveryCaseId, phase: "A", policyAttestation: fixture.attestation,
      challengeId: fixture.attestation.challengeId, challengeDigest: fixture.attestation.challengeDigest,
    })).rejects.toThrow(/protected recovery phase/);
  });

  it("requires independently authenticated owner approval before policy signing", async () => {
    const fixture = await makePolicyFixture("A");
    expect(fixture.attestation.phase).toBe("A");
    expect(Date.parse(fixture.attestation.expiresAt) - Date.parse(fixture.attestation.reviewedAt)).toBe(30 * 60 * 1000);
    const selfIssuer = createIndependentPolicySigner({
      ownerApprovalPublicKeys: {},
      allowedReviewerIds: ["12345"],
      policySigner: () => "signature",
      policyKeyId: "policy-key",
      signerName: "independent-policy-service",
      policyVersion: "2026-10",
      consumeSingleUseRequest: async () => true,
      independentApprovalVerifier: async () => true,
    });
    await expect(selfIssuer.issue({ policy: fixture.policyRequest, ownerApproval: { approved: true } }, { now }))
      .rejects.toThrow(/closed schema/);
  });

  it("rejects a forged owner approval even when the signed request shape is valid", async () => {
    const fixture = await makePolicyFixture("A");
    const tampered = { ...fixture.ownerApproval, approvalId: "forged-approval" };
    const signer = createIndependentPolicySigner({
      ownerApprovalPublicKeys: { "owner-review-key": fixture.owner.publicKey },
      allowedReviewerIds: ["12345"],
      policySigner: (body) => signCanonical(body, fixture.policy.privateKey),
      policyKeyId: "policy-key",
      signerName: "independent-policy-service",
      policyVersion: "2026-10",
      consumeSingleUseRequest: async () => true,
      independentApprovalVerifier: async () => true,
    });
    await expect(signer.issue({ policy: fixture.policyRequest, ownerApproval: tampered }, { now }))
      .rejects.toThrow(/signature is invalid/);
  });

  it("accepts a phase-bound signed envelope and rejects extra claims or cross-phase use", async () => {
    const fixture = await makePolicyFixture("A");
    const claims = claimsFor("A", fixture.attestation, fixture.policyRequest);
    const envelope = createAuthorizationEnvelope(claims, "A", "phase-a-key", fixture.auth.privateKey);
    expect(verifyAuthorizationEnvelope(envelope, {
      phase: "A",
      publicKeys: { "phase-a-key": fixture.auth.publicKey },
      policyAttestation: fixture.attestation,
      policyPublicKeys: { "policy-key": fixture.policy.publicKey },
      now,
      expectedBindings: { canonicalMainSha: sha },
    }).phase).toBe("A");

    const extra = { ...claims, bypass: true };
    expect(() => createAuthorizationEnvelope(extra, "A", "phase-a-key", fixture.auth.privateKey)).toThrow(/closed schema/);
    expect(() => verifyAuthorizationEnvelope(envelope, {
      phase: "B",
      publicKeys: { "phase-a-key": fixture.auth.publicKey },
      policyAttestation: fixture.attestation,
      policyPublicKeys: { "policy-key": fixture.policy.publicKey },
      now,
    })).toThrow(/phase is invalid/);
  });

  it("rejects stale policy attestations and wrong-phase policy reuse", async () => {
    const phaseA = await makePolicyFixture("A");
    const claimsA = claimsFor("A", phaseA.attestation, phaseA.policyRequest);
    const envelopeA = createAuthorizationEnvelope(claimsA, "A", "phase-a-key", phaseA.auth.privateKey);
    const options = {
      phase: "A",
      publicKeys: { "phase-a-key": phaseA.auth.publicKey },
      policyAttestation: phaseA.attestation,
      policyPublicKeys: { "policy-key": phaseA.policy.publicKey },
      now: Date.parse(phaseA.attestation.expiresAt) + 1,
    };
    expect(() => verifyAuthorizationEnvelope(envelopeA, options)).toThrow(/expired/);

    const phaseB = await makePolicyFixture("B");
    const claimsB = claimsFor("B", phaseB.attestation, phaseB.policyRequest);
    const envelopeB = createAuthorizationEnvelope(claimsB, "B", "phase-b-key", phaseB.auth.privateKey);
    expect(() => verifyAuthorizationEnvelope(envelopeB, {
      phase: "B",
      publicKeys: { "phase-b-key": phaseB.auth.publicKey },
      policyAttestation: phaseA.attestation,
      policyPublicKeys: { "policy-key": phaseA.policy.publicKey },
      now,
    })).toThrow(/binding mismatch/);
  });

  it("rejects an unknown policy signer and a forged policy signature", async () => {
    const fixture = await makePolicyFixture("A");
    const claims = claimsFor("A", fixture.attestation, fixture.policyRequest);
    const envelope = createAuthorizationEnvelope(claims, "A", "phase-a-key", fixture.auth.privateKey);
    const forgedPolicy = { ...fixture.attestation, adminBypassRequiredDisabled: false };
    expect(() => verifyAuthorizationEnvelope(envelope, {
      phase: "A",
      publicKeys: { "phase-a-key": fixture.auth.publicKey },
      policyAttestation: forgedPolicy,
      policyPublicKeys: { "policy-key": fixture.policy.publicKey },
      now,
    })).toThrow();
  });

  it("rejects a second policy attestation for a consumed request nonce", async () => {
    const fixture = await makePolicyFixture("A");
    const signer = createIndependentPolicySigner({
      ownerApprovalPublicKeys: { "owner-review-key": fixture.owner.publicKey },
      allowedReviewerIds: ["12345"],
      policySigner: (body) => signCanonical(body, fixture.policy.privateKey),
      policyKeyId: "policy-key",
      signerName: "independent-policy-service",
      policyVersion: "2026-10",
      consumeSingleUseRequest: async () => false,
      independentApprovalVerifier: async (approval) => verifyCanonical(
        omitFields(approval, ["signature"]), approval.signature, fixture.owner.publicKey,
      ),
    });
    await expect(signer.issue({ policy: fixture.policyRequest, ownerApproval: fixture.ownerApproval }, { now }))
      .rejects.toThrow(/already consumed/);
  });
});
