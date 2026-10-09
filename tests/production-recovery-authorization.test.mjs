import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { canonicalDigest, signCanonical } from "../scripts/production-recovery/canonical.mjs";
import { createAuthorizationEnvelope, verifyAuthorizationEnvelope } from "../scripts/production-recovery/authorization.mjs";
import { createOwnerPolicySigner } from "../scripts/production-recovery/policy-signer.mjs";
import { createRecoveryAuthorizationIssuer } from "../scripts/production-recovery/authorization-issuer-service.mjs";
import { PHASE_A_CLAIM_KEYS, PHASE_B_CLAIM_KEYS, PHASE_B_CAPABILITIES } from "../scripts/production-recovery/schemas.mjs";

const now = Date.parse("2026-10-07T12:00:00.000Z");
const time = new Date(now).toISOString();
const expiry = new Date(now + 15 * 60 * 1000).toISOString();
const sha = "a".repeat(40);
const digest = "b".repeat(64);
const ownerId = "126446430";

function keyPair() { return generateKeyPairSync("ed25519"); }

function makePolicyRequest(phase, actorGithubUserId = ownerId) {
  return {
    recoveryCaseId: "recovery-case-001", phase, repository: "krustallik/body-model", canonicalMainSha: sha,
    workflowPath: ".github/workflows/production-recovery-phase-" + phase.toLowerCase() + ".yml",
    workflowId: phase === "A" ? "901" : "903", workflowRunId: "902", workflowRunAttempt: "1",
    actorGithubUserId, reviewedConfigurationDigest: digest, singleUseRequestId: "authorization-request-" + phase,
    singleUseNonce: "policy-nonce-" + phase, challengeId: "challenge-phase-" + phase,
    challengeDigest: (phase === "A" ? "a" : "b").repeat(64),
  };
}

async function makePolicyFixture(phase, actorGithubUserId = ownerId, consume = async () => true) {
  const policy = keyPair();
  const auth = keyPair();
  const policyRequest = makePolicyRequest(phase, actorGithubUserId);
  const signer = createOwnerPolicySigner({
    ownerGithubActorId: ownerId,
    policySigner: (body) => signCanonical(body, policy.privateKey),
    policyKeyId: "policy-key", signerName: "bodycast-recovery-machine-signer", policyVersion: "2026-10",
    consumeSingleUseRequest: consume,
  });
  const attestation = await signer.issue({ policy: policyRequest }, { now });
  return { attestation, auth, policy, policyRequest };
}

function claimsFor(phase, attestation, policyRequest) {
  const keys = phase === "A" ? PHASE_A_CLAIM_KEYS : PHASE_B_CLAIM_KEYS;
  const claims = {};
  for (const key of keys) {
    if (key === "schemaVersion") claims[key] = 2;
    else if (key === "ownerIdentity") claims[key] = {
      environment: "production-recovery", githubActorId: ownerId,
      workflowRunId: policyRequest.workflowRunId, workflowRunAttempt: policyRequest.workflowRunAttempt,
      challengeId: policyRequest.challengeId, challengeDigest: policyRequest.challengeDigest,
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
    else if (["canonicalMainSha", "failedReleaseSha", "rollbackAppSha"].includes(key)) claims[key] = sha;
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

describe("production recovery owner authorization", () => {
  it.each(["A", "B"])("issues an exact owner-bound Phase %s envelope from trusted OIDC and signed machine evidence", async (phase) => {
    const fixture = await makePolicyFixture(phase);
    const policyRequest = fixture.policyRequest;
    const workflow = {
      repository: policyRequest.repository, ref: "refs/heads/main", environment: "production-recovery",
      canonicalMainSha: sha, workflowPath: policyRequest.workflowPath, workflowId: policyRequest.workflowId,
      workflowRunId: policyRequest.workflowRunId, workflowRunAttempt: policyRequest.workflowRunAttempt,
      actorGithubUserId: ownerId, repositoryOwnerId: ownerId, eventName: "workflow_dispatch",
    };
    const allClaims = claimsFor(phase, fixture.attestation, policyRequest);
    const constructed = new Set([
      "schemaVersion", "purpose", "capability", "capabilitySet", "repository", "workflowPath", "workflowId",
      "workflowRunId", "workflowRunAttempt", "workflowRef", "canonicalMainSha", "recoveryEnvironment", "ownerIdentity",
      `phase${phase}PolicyAttestationDigest`, `phase${phase}PolicyAttestationNonce`, `phase${phase}PolicyReviewedAt`,
      `phase${phase}PolicyChallengeId`, `phase${phase}PolicyChallengeDigest`, `phase${phase}PolicyExpiresAt`,
      `phase${phase}PolicyVersion`, "hostRecoveryAuthorityIdentity", "hostRecoveryAuthorityKeyId", "issuedAt", "expiresAt", "authorizationId", "nonce",
    ]);
    const facts = Object.fromEntries(Object.entries(allClaims).filter(([key]) => !constructed.has(key)));
    const issuer = createRecoveryAuthorizationIssuer({
      verifyWorkflowOidc: async (token, { audience }) => token === "verified-owner-oidc" && audience === "bodycast-production-recovery-authorization" ? workflow : null,
      loadRecoveryCase: async () => ({ recoveryCaseId: policyRequest.recoveryCaseId, phase, repository: workflow.repository,
        canonicalMainSha: sha, status: "awaiting-owner-policy-review", hostRecoveryAuthorityIdentity: "host-authority-1",
        hostRecoveryAuthorityKeyId: "authority-key-1", expiresAt: expiry,
        phaseAAuthorizationEvidenceId: "phase-a-evidence", phaseBAuthorizationEvidenceId: "phase-b-evidence",
        markerReaderRolloutReceiptId: "rollout-1" }),
      loadPhaseFacts: async () => facts,
      policyPublicKeys: { "policy-key": fixture.policy.publicKey },
      phaseWorkflowBindings: { A: { workflowPath: makePolicyRequest("A").workflowPath, workflowId: "901" },
        B: { workflowPath: makePolicyRequest("B").workflowPath, workflowId: "903" } },
      phaseSigners: { A: { keyId: "phase-a-key", privateKey: fixture.auth.privateKey }, B: { keyId: "phase-b-key", privateKey: fixture.auth.privateKey } },
      repository: workflow.repository, now: () => now, createId: (() => { let n = 0; return () => `id-${++n}`; })(),
    });
    const issued = await issuer.issue({ schemaVersion: 1, purpose: "issue-recovery-phase-authorization",
      oidcToken: "verified-owner-oidc", recoveryCaseId: policyRequest.recoveryCaseId, phase,
      challengeId: fixture.attestation.challengeId, challengeDigest: fixture.attestation.challengeDigest,
      policyAttestation: fixture.attestation });
    const verified = verifyAuthorizationEnvelope(issued.envelope, { phase,
      publicKeys: { [phase === "A" ? "phase-a-key" : "phase-b-key"]: fixture.auth.publicKey },
      policyAttestation: fixture.attestation, policyPublicKeys: { "policy-key": fixture.policy.publicKey }, now,
      expectedBindings: { workflowRunId: workflow.workflowRunId, canonicalMainSha: workflow.canonicalMainSha } });
    expect(verified.claims.ownerIdentity.githubActorId).toBe(ownerId);
    expect(verified.claims.ownerIdentity.singleUseNonce).toBe(fixture.attestation.singleUseNonce);
    expect(issued.authorizationId).toBe(verified.claims.authorizationId);
    expect(issued).toMatchObject({ evidenceId: phase === "A" ? "phase-a-evidence" : "phase-b-evidence", rolloutReceiptId: "rollout-1" });
    await expect(issuer.issue({ schemaVersion: 1, purpose: "issue-recovery-phase-authorization", oidcToken: "invalid",
      recoveryCaseId: policyRequest.recoveryCaseId, phase, challengeId: fixture.attestation.challengeId,
      challengeDigest: fixture.attestation.challengeDigest, policyAttestation: fixture.attestation })).rejects.toThrow(/protected recovery phase/);
  });

  it("rejects a non-owner actor before issuing any recovery authorization", async () => {
    const fixture = await makePolicyFixture("A");
    const signer = createOwnerPolicySigner({
      policySigner: () => "never", policyKeyId: "policy-key", signerName: "machine", policyVersion: "v1",
      consumeSingleUseRequest: async () => true,
    });
    await expect(signer.issue({ policy: makePolicyRequest("A", "24680") }, { now })).rejects.toThrow(/pinned BodyCast owner/);
    expect(fixture.attestation.authorizedActorGithubUserId).toBe(ownerId);
  });

  it("rejects a tampered policy signature, a cross-phase envelope, expiry, and nonce replay", async () => {
    const fixture = await makePolicyFixture("A");
    const claims = claimsFor("A", fixture.attestation, fixture.policyRequest);
    const envelope = createAuthorizationEnvelope(claims, "A", "phase-a-key", fixture.auth.privateKey);
    const options = { phase: "A", publicKeys: { "phase-a-key": fixture.auth.publicKey },
      policyAttestation: fixture.attestation, policyPublicKeys: { "policy-key": fixture.policy.publicKey }, now };
    expect(() => verifyAuthorizationEnvelope(envelope, { ...options, phase: "B" })).toThrow(/phase is invalid/);
    expect(() => verifyAuthorizationEnvelope(envelope, { ...options, now: Date.parse(fixture.attestation.expiresAt) + 1 })).toThrow(/expired/);
    expect(() => verifyAuthorizationEnvelope(envelope, { ...options,
      policyAttestation: { ...fixture.attestation, authorizedActorGithubUserId: "24680" } })).toThrow();
    const replaySigner = createOwnerPolicySigner({ policySigner: () => "signature", policyKeyId: "policy-key",
      signerName: "machine", policyVersion: "v1", consumeSingleUseRequest: async () => false });
    await expect(replaySigner.issue({ policy: fixture.policyRequest }, { now })).rejects.toThrow(/already consumed/);
  });
});
