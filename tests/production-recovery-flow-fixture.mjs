import { afterEach, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  authorizationEnvelopeDigest,
  createAuthorizationEnvelope,
} from "../scripts/production-recovery/authorization.mjs";
import { createRecoveryAuthority } from "../scripts/production-recovery/authority.mjs";
import { canonicalDigest, signCanonical } from "../scripts/production-recovery/canonical.mjs";
import { writeImmutableReceipt, verifyImmutableReceipt } from "../scripts/production-recovery/journal.mjs";
import { createOwnerPolicySigner } from "../scripts/production-recovery/policy-signer.mjs";
import { OPERATION_CONTRACTS } from "../scripts/production-recovery/operation-contracts.mjs";
import { PHASE_A_CLAIM_KEYS, PHASE_B_CLAIM_KEYS, PHASE_B_CAPABILITIES } from "../scripts/production-recovery/schemas.mjs";

const roots = [];
const syncDirectory = async () => {};
const fixedNow = Date.parse("2026-10-07T12:00:00.000Z");
const nowIso = new Date(fixedNow).toISOString();
const authorizationExpiry = new Date(fixedNow + 10 * 60_000).toISOString();

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bodycast-recovery-flow-"));
  roots.push(root);
  return root;
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

function makePolicy(phase, workflowRunId, workflowPath, policyKey, consumed) {
  const request = {
    recoveryCaseId: "recovery-case-001",
    phase,
    repository: "krustallik/body-model",
    canonicalMainSha: "a".repeat(40),
    workflowPath,
    workflowId: phase === "A" ? "901" : "902",
    workflowRunId,
    workflowRunAttempt: "1",
    actorGithubUserId: "126446430",
    reviewedConfigurationDigest: "b".repeat(64),
    singleUseRequestId: "policy-request-" + phase,
    singleUseNonce: "policy-nonce-" + phase,
    challengeId: "challenge-phase-" + phase,
    challengeDigest: (phase === "A" ? "a" : "b").repeat(64),
  };
  const signer = createOwnerPolicySigner({
    policySigner: (body) => signCanonical(body, policyKey.privateKey),
    consumeSingleUseRequest: async ({ requestId, nonce }) => {
      const identity = requestId + "\0" + nonce;
      if (consumed.has(identity)) return false;
      consumed.add(identity);
      return true;
    },
    policyKeyId: "policy-key",
    signerName: "isolated-test-policy-signer",
    policyVersion: "1.0.0",
  });
  return signer.issue({ policy: request }, { now: fixedNow });
}

function makeClaims(phase, attestation, policyRequest, bindings) {
  const keys = phase === "A" ? PHASE_A_CLAIM_KEYS : PHASE_B_CLAIM_KEYS;
  const claims = {};
  for (const key of keys) {
    if (key === "schemaVersion") claims[key] = 2;
    else if (key === "ownerIdentity") claims[key] = {
      environment: "production-recovery",
      githubActorId: "126446430",
      workflowRunId: policyRequest.workflowRunId,
      workflowRunAttempt: policyRequest.workflowRunAttempt,
      challengeId: attestation.challengeId,
      challengeDigest: attestation.challengeDigest,
      singleUseNonce: attestation.singleUseNonce,
    };
    else if (key === "capabilitySet") claims[key] = [...PHASE_B_CAPABILITIES];
    else if (key === "priorMarkerSchemaVersion") claims[key] = 2;
    else if (key.endsWith("Generation")) claims[key] = 1;
    else if (key === "purpose") claims[key] = phase === "A" ? "recovery Phase A restore-only" : "post-restore recovery authorization";
    else if (key === "capability") claims[key] = "restore-only";
    else if (key === "recoveryEnvironment") claims[key] = "production-recovery";
    else if (key === "priorMarkerState") claims[key] = "ddl-started";
    else if (key === "canonicalMainSha") claims[key] = "a".repeat(40);
    else if (key === "failedReleaseSha") claims[key] = "b".repeat(40);
    else if (key === "rollbackAppSha") claims[key] = "c".repeat(40);
    else if (key === "repository") claims[key] = "krustallik/body-model";
    else if (key === "workflowRef") claims[key] = "refs/heads/main";
    else if (key === "workflowPath") claims[key] = policyRequest.workflowPath;
    else if (key === "workflowId") claims[key] = policyRequest.workflowId;
    else if (key === "workflowRunId") claims[key] = policyRequest.workflowRunId;
    else if (key === "workflowRunAttempt") claims[key] = policyRequest.workflowRunAttempt;
    else if (key === "expiresAt") claims[key] = authorizationExpiry;
    else if (key.endsWith("PolicyReviewedAt")) claims[key] = attestation.reviewedAt;
    else if (key.endsWith("PolicyExpiresAt")) claims[key] = attestation.expiresAt;
    else if (key.endsWith("PolicyAttestationNonce")) claims[key] = attestation.singleUseNonce;
    else if (key.endsWith("PolicyChallengeId")) claims[key] = attestation.challengeId;
    else if (key.endsWith("PolicyChallengeDigest")) claims[key] = attestation.challengeDigest;
    else if (key.endsWith("PolicyVersion")) claims[key] = attestation.policyVersion;
    else if (key.endsWith("PolicyAttestationDigest")) claims[key] = canonicalDigest(attestation);
    else if (key === "issuedAt" || key === "backupSnapshotTimestamp" || key === "observedAt"
      || key === "phaseAPolicyReviewedAt" || key === "phaseBPolicyReviewedAt") claims[key] = nowIso;
    else if (key.endsWith("At") || key.endsWith("Timestamp")) claims[key] = nowIso;
    else if (key.endsWith("Digest") || key.endsWith("Sha256")) claims[key] = "d".repeat(64);
    else claims[key] = key + "-fixture";
  }
  claims.issuedAt = nowIso;
  claims.expiresAt = authorizationExpiry;
  return Object.assign(claims, bindings);
}

function nextRequest(authority, transition, evidence, extra = {}) {
  return authority.readAuthoritativeState().then((state) => ({
    transition,
    recoveryCaseId: state.recoveryCaseId ?? "recovery-case-001",
    expectedGeneration: state.generation,
    expectedRecordDigest: state.recordDigest,
    evidence,
    ...extra,
  }));
}

export async function runProductionRecoveryFlowFixture({
  logicalDatabaseIdentityDigest = null,
  restoredSchemaDigest = null,
  migrationHistoryDigest = null,
  afterRestoreBegins = async () => {},
  beforeRestoreVerified = async ({ expectedSchemaDigest, expectedMigrationHistoryDigest, logicalDatabaseIdentityDigest }) => ({
    schemaCompatible: true,
    readOnly: true,
    logicalProductionDbIdentityDigest: logicalDatabaseIdentityDigest,
    actualSchemaDigest: expectedSchemaDigest,
    actualMigrationHistoryDigest: expectedMigrationHistoryDigest,
  }),
  afterRestoreVerified = async () => {},
} = {}) {
    const root = await tempRoot();
    const journalDirectory = path.join(root, "state", "journal");
    const receiptDirectory = path.join(root, "state", "receipts");
    const markerDirectory = path.join(root, "state", "projection");
    const legacyDirectory = path.join(root, "legacy");
    await Promise.all([journalDirectory, receiptDirectory, markerDirectory, legacyDirectory].map((directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 })));
    const journalKey = generateKeyPairSync("ed25519");
    const phaseAKey = generateKeyPairSync("ed25519");
    const phaseBKey = generateKeyPairSync("ed25519");
    const policyKey = generateKeyPairSync("ed25519");
    const authorityPublicKeys = { "authority-key": journalKey.publicKey };
    const authoritySigning = {
      privateKey: journalKey.privateKey,
      authorityVersion: "1.0.0",
      authorityKeyId: "authority-key",
      authorityInstanceId: "fixture-host-authority",
    };
    const rolloutDigest = "e".repeat(64);
    const legacyMarkerPath = path.join(legacyDirectory, "bodycast-production-schema-cutover");
    const v2MarkerPath = path.join(markerDirectory, "marker-v2.json");
    const lockPath = path.join(root, "state", "recovery.lock");
    const artifact = {
      failedReleaseSha: "b".repeat(40),
      rollbackAppSha: "c".repeat(40),
      rollbackContainerId: "container-immutable-001",
      rollbackImageId: "sha256:" + "1".repeat(64),
      rollbackImageDigest: "2".repeat(64),
      rollbackArtifactId: "oci://bodycast/app@sha256:" + "2".repeat(64),
      rollbackArtifactDigest: "3".repeat(64),
      rollbackCaptureAttestationDigest: "4".repeat(64),
      composeProjectServiceIdentityDigest: "5".repeat(64),
      deployHostTopologyDigest: "6".repeat(64),
    };
    const databaseIdentityDigest = logicalDatabaseIdentityDigest ?? "7".repeat(64);
    const expectedRestoredSchemaDigest = restoredSchemaDigest ?? "8".repeat(64);
    const expectedMigrationHistoryDigest = migrationHistoryDigest ?? "9".repeat(64);
    const evidenceByType = new Map();
    function evidence(type, details = {}) {
      const result = { type, evidenceId: type + "-evidence", ...details };
      evidenceByType.set(type, result);
      return result;
    }
    const legacyMarker = `schemaVersion=1\nmanifestId=recovery-case-001\nreleaseSha=${artifact.failedReleaseSha}\nstate=ddl-started\n`;
    await fs.writeFile(legacyMarkerPath, legacyMarker, { mode: 0o600 });
    const bootEvidence = evidence("pre-maintenance-release-capture", {
      repository: "krustallik/body-model",
      canonicalMainSha: "a".repeat(40),
      recoveryCaseId: "recovery-case-001",
      manifestId: "recovery-case-001",
      failedReleaseSha: artifact.failedReleaseSha,
      rollbackAppSha: artifact.rollbackAppSha,
      immutableRollbackArtifact: artifact,
      logicalProductionDbIdentityDigest: databaseIdentityDigest,
      composeProjectServiceIdentityDigest: artifact.composeProjectServiceIdentityDigest,
      deployHostTopologyDigest: artifact.deployHostTopologyDigest,
      markerReaderRolloutReceiptDigest: rolloutDigest,
    });
    const receiptBody = {
      receiptSchemaVersion: 1,
      purpose: "marker-reader-rollout",
      repository: "krustallik/body-model",
      canonicalMainSha: "a".repeat(40),
      authorityKeyId: "authority-key",
      authorityInstanceId: "fixture-host-authority",
    };
    const rollout = await writeImmutableReceipt(receiptDirectory, "rollout.json", receiptBody, {
      privateKey: journalKey.privateKey,
      publicKeys: authorityPublicKeys,
      syncDirectory,
    });
    const verifiedRolloutDigest = rollout.receipt.receiptDigest;
    bootEvidence.markerReaderRolloutReceiptDigest = verifiedRolloutDigest;
    evidenceByType.set(bootEvidence.type, bootEvidence);
    const usedPolicy = new Set();
    let failLegacyDirectorySync = false;
    const syncFixtureDirectory = async (directory) => {
      if (failLegacyDirectorySync && path.resolve(directory) === path.resolve(legacyDirectory)) {
        failLegacyDirectorySync = false;
        throw new Error("simulated legacy marker directory fsync failure");
      }
    };
    const authority = createRecoveryAuthority({
      journalDirectory,
      receiptDirectory,
      markerPath: v2MarkerPath,
      legacyMarkerPath,
      lockPath,
      signing: authoritySigning,
      journalPublicKeys: authorityPublicKeys,
      phaseAPublicKeys: { "phase-a-key": phaseAKey.publicKey },
      phaseBPublicKeys: { "phase-b-key": phaseBKey.publicKey },
      policyPublicKeys: { "policy-key": policyKey.publicKey },
      phaseWorkflowBindings: {
        A: { repository: "krustallik/body-model", workflowPath: ".github/workflows/production-recovery-phase-a.yml", workflowId: "901" },
        B: { repository: "krustallik/body-model", workflowPath: ".github/workflows/production-recovery-phase-b.yml", workflowId: "902" },
      },
      validateEvidence: async (transition, supplied) => {
        const trusted = evidenceByType.get(supplied.type);
        if (!trusted || canonicalDigest(trusted) !== canonicalDigest(supplied)) throw new Error("Fixture evidence source did not authenticate the exact input.");
        if (transition === "verify-restore" && supplied.actualRestoredLogicalDbIdentityDigest !== databaseIdentityDigest) {
          throw new Error("Restore evidence changes the logical database identity.");
        }
        if (transition === "verify-restore") {
          const proof = supplied.compatibilityProof;
          if (!proof?.schemaCompatible || proof.readOnly !== true
            || proof.logicalProductionDbIdentityDigest !== databaseIdentityDigest
            || proof.actualSchemaDigest !== expectedRestoredSchemaDigest
            || proof.actualMigrationHistoryDigest !== expectedMigrationHistoryDigest) {
            throw new Error("Restore verification requires a matching read-only identity, schema, and migration-history proof.");
          }
        }
        return true;
      },
      verifyRolloutReceipt: async (receipt, sourceEvidence) => {
        verifyImmutableReceipt(receipt, authorityPublicKeys);
        if (receipt.receiptDigest !== verifiedRolloutDigest || sourceEvidence.markerReaderRolloutReceiptDigest !== verifiedRolloutDigest) {
          throw new Error("Reader rollout receipt is stale.");
        }
        return receipt;
      },
      verifyRestoreGrant: async (grant) => grant.purpose === "restore-only" && grant.rollbackAppSha === artifact.rollbackAppSha,
      requireRoot: false,
      syncDirectory: syncFixtureDirectory,
      now: () => fixedNow,
    });

    const fixtureOperationSuccess = (record, intent) => {
      const artifact = record.immutableRollbackArtifact;
      const postcondition = Object.fromEntries(OPERATION_CONTRACTS[intent.operationType].postconditionKeys.map((key) => {
        if (key === "releaseSha") return [key, record.rollbackAppSha];
        if (key === "imageDigest" || key === "trafficTargetImageDigest") return [key, artifact.rollbackImageDigest];
        if (key === "backupArtifactDigest") return [key, artifact.rollbackArtifactDigest];
        if (key === "logicalProductionDbIdentityDigest") return [key, record.logicalProductionDbIdentityDigest];
        if (key === "recoveryCaseId") return [key, record.recoveryCaseId];
        if (key === "journalGeneration") return [key, record.generation];
        if (key === "journalRecordDigest") return [key, record.recordDigest];
        if (key === "healthStatus") return [key, "healthy"];
        if (key === "databaseRoleMode") return [key, "read-only"];
        if (key === "writerMode") return [key, "enabled"];
        if (key === "activeWriterCount") return [key, 0];
        if (key === "containerId") return [key, artifact.rollbackContainerId];
        if (key === "topologyDigest") return [key, artifact.deployHostTopologyDigest];
        if (key.endsWith("Digest")) return [key, canonicalDigest({ key, recordDigest: record.recordDigest })];
        if (key.endsWith("Sha")) return [key, record.rollbackAppSha];
        return [key, "fixture-" + key];
      }));
      return {
        schemaVersion: 1,
        purpose: "bodycast-host-operation-success",
        operationType: intent.operationType,
        recoveryCaseId: record.recoveryCaseId,
        journalGeneration: record.generation,
        journalRecordDigest: record.recordDigest,
        operationId: intent.operationId,
        idempotencyKey: intent.operationId,
        operationInputDigest: intent.operationInputDigest,
        result: "executed",
        postcondition,
        postconditionDigest: canonicalDigest(postcondition),
      };
    };

    const applyFixtureTransition = async (request) => {
      const result = await authority.applyTransition({ recoveryCaseId: "recovery-case-001", ...request });
      if (result.record.operationIntent) await authority.executePendingOperation({
        recoveryCaseId: result.record.recoveryCaseId,
        generation: result.record.generation,
        recordDigest: result.record.recordDigest,
        operationId: result.record.operationIntent.operationId,
      }, async ({ record, intent }) => fixtureOperationSuccess(record, intent));
      return result;
    };

    const boot = await authority.bootstrapFailedRelease({ failedState: "ddl-started", evidence: bootEvidence, rolloutReceipt: rollout.receipt });
    expect(boot.record.generation).toBe(1);
    expect(boot.marker.state).toBe("ddl-started");
    expect((await authority.readAuthoritativeState()).blocking).toBe(true);

    const phaseAPolicy = await makePolicy("A", "run-phase-a", ".github/workflows/production-recovery-phase-a.yml", policyKey, usedPolicy);
    const phaseAPolicyRequest = {
      recoveryCaseId: "recovery-case-001", workflowPath: ".github/workflows/production-recovery-phase-a.yml",
      workflowId: "901", workflowRunId: "run-phase-a", workflowRunAttempt: "1",
    };
    const phaseAClaims = makeClaims("A", phaseAPolicy, phaseAPolicyRequest, {
      recoveryCaseId: "recovery-case-001",
      manifestId: "recovery-case-001",
      priorJournalGeneration: boot.record.generation,
      priorJournalRecordDigest: boot.record.recordDigest,
      priorMarkerSchemaVersion: 2,
      priorMarkerState: boot.record.nextState,
      priorMarkerDigest: boot.marker.markerDigest,
      rollbackAppSha: artifact.rollbackAppSha,
      failedReleaseSha: artifact.failedReleaseSha,
      rollbackContainerId: artifact.rollbackContainerId,
      rollbackImageId: artifact.rollbackImageId,
      rollbackImageDigest: artifact.rollbackImageDigest,
      rollbackArtifactId: artifact.rollbackArtifactId,
      rollbackArtifactDigest: artifact.rollbackArtifactDigest,
      rollbackCaptureAttestationDigest: artifact.rollbackCaptureAttestationDigest,
      composeProjectServiceIdentityDigest: artifact.composeProjectServiceIdentityDigest,
      deployHostTopologyDigest: artifact.deployHostTopologyDigest,
      logicalProductionDbIdentityDigest: databaseIdentityDigest,
      markerReaderRolloutReceiptDigest: verifiedRolloutDigest,
      phaseAPolicyAttestationDigest: canonicalDigest(phaseAPolicy),
      phaseAPolicyAttestationNonce: phaseAPolicy.singleUseNonce,
      phaseAPolicyReviewedAt: phaseAPolicy.reviewedAt,
      phaseAPolicyExpiresAt: phaseAPolicy.expiresAt,
      phaseAPolicyVersion: phaseAPolicy.policyVersion,
      authorizationId: "phase-a-auth-001",
      nonce: "phase-a-nonce-unique",
      hostRecoveryAuthorityIdentity: "fixture-host-authority",
      hostRecoveryAuthorityKeyId: "authority-key",
    });
    const phaseAEnvelope = createAuthorizationEnvelope(phaseAClaims, "A", "phase-a-key", phaseAKey.privateKey);
    const badPhaseAClaims = { ...phaseAClaims, priorMarkerDigest: "9".repeat(64) };
    const badPhaseAEnvelope = createAuthorizationEnvelope(badPhaseAClaims, "A", "phase-a-key", phaseAKey.privateKey);
    const authorizeEvidence = evidence("authorize-restore", {
      recoveryCaseId: "recovery-case-001",
      markerReaderRolloutReceiptDigest: verifiedRolloutDigest,
    });
    await expect(applyFixtureTransition(await nextRequest(authority, "authorize-restore", authorizeEvidence, {
      envelope: badPhaseAEnvelope, policyAttestation: phaseAPolicy, rolloutReceipt: rollout.receipt,
    }))).rejects.toThrow(/priorMarkerDigest/);
    expect((await authority.readAuthoritativeState()).generation).toBe(1);

    const phaseARecord = await applyFixtureTransition(await nextRequest(authority, "authorize-restore", authorizeEvidence, {
      envelope: phaseAEnvelope, policyAttestation: phaseAPolicy, rolloutReceipt: rollout.receipt,
    }));
    expect(phaseARecord.record.nextState).toBe("restore-authorized");
    expect(phaseARecord.record.nonceConsumption.items).toHaveLength(2);
    const restoreInProgressEvidence = evidence("begin-restore", { recoveryCaseId: "recovery-case-001" });
    const restoreInProgress = await applyFixtureTransition(await nextRequest(authority, "begin-restore", restoreInProgressEvidence));
    expect(restoreInProgress.record.nextState).toBe("restore-in-progress");
    await afterRestoreBegins({
      logicalDatabaseIdentityDigest: databaseIdentityDigest,
      authorityState: await authority.readAuthoritativeState(),
    });
    const compatibilityProof = await beforeRestoreVerified({
      logicalDatabaseIdentityDigest: databaseIdentityDigest,
      expectedSchemaDigest: expectedRestoredSchemaDigest,
      expectedMigrationHistoryDigest,
      authorityState: await authority.readAuthoritativeState(),
    });
    const restoreVerifiedEvidence = evidence("verify-restore", {
      recoveryCaseId: "recovery-case-001",
      actualRestoredLogicalDbIdentityDigest: databaseIdentityDigest,
      expectedRestoredSchemaDigest,
      actualRestoredSchemaDigest: compatibilityProof.actualSchemaDigest,
      expectedMigrationHistoryDigest,
      actualMigrationHistoryDigest: compatibilityProof.actualMigrationHistoryDigest,
      compatibilityProof,
    });
    const restoreVerified = await applyFixtureTransition(await nextRequest(authority, "verify-restore", restoreVerifiedEvidence));
    expect(restoreVerified.record.nextState).toBe("restore-verified");
    await afterRestoreVerified({
      logicalDatabaseIdentityDigest: databaseIdentityDigest,
      expectedSchemaDigest: expectedRestoredSchemaDigest,
      expectedMigrationHistoryDigest,
      authorityState: await authority.readAuthoritativeState(),
    });

    const phaseBPolicy = await makePolicy("B", "run-phase-b", ".github/workflows/production-recovery-phase-b.yml", policyKey, usedPolicy);
    const phaseBPolicyRequest = {
      recoveryCaseId: "recovery-case-001", workflowPath: ".github/workflows/production-recovery-phase-b.yml",
      workflowId: "902", workflowRunId: "run-phase-b", workflowRunAttempt: "1",
    };
    const phaseBClaims = makeClaims("B", phaseBPolicy, phaseBPolicyRequest, {
      recoveryCaseId: "recovery-case-001",
      manifestId: "recovery-case-001",
      canonicalMainSha: "a".repeat(40),
      failedReleaseSha: artifact.failedReleaseSha,
      rollbackAppSha: artifact.rollbackAppSha,
      phaseAAuthorizationId: phaseARecord.record.authorizationId,
      phaseAEnvelopeDigest: authorizationEnvelopeDigest(phaseAEnvelope),
      phaseAJournalGeneration: phaseARecord.record.generation,
      phaseAJournalRecordDigest: phaseARecord.record.recordDigest,
      restoreInProgressJournalGeneration: restoreInProgress.record.generation,
      restoreInProgressJournalRecordDigest: restoreInProgress.record.recordDigest,
      restoreVerifiedJournalGeneration: restoreVerified.record.generation,
      restoreVerifiedJournalRecordDigest: restoreVerified.record.recordDigest,
      rollbackContainerId: artifact.rollbackContainerId,
      rollbackImageId: artifact.rollbackImageId,
      rollbackImageDigest: artifact.rollbackImageDigest,
      rollbackArtifactId: artifact.rollbackArtifactId,
      rollbackArtifactDigest: artifact.rollbackArtifactDigest,
      rollbackCaptureAttestationDigest: artifact.rollbackCaptureAttestationDigest,
      composeProjectServiceIdentityDigest: artifact.composeProjectServiceIdentityDigest,
      deployHostTopologyDigest: artifact.deployHostTopologyDigest,
      actualRestoredLogicalDbIdentityDigest: databaseIdentityDigest,
      expectedRestoredSchemaDigest,
      actualRestoredSchemaDigest: expectedRestoredSchemaDigest,
      expectedMigrationHistoryDigest,
      actualMigrationHistoryDigest: expectedMigrationHistoryDigest,
      markerReaderRolloutReceiptDigest: verifiedRolloutDigest,
      phaseBPolicyAttestationDigest: canonicalDigest(phaseBPolicy),
      phaseBPolicyAttestationNonce: phaseBPolicy.singleUseNonce,
      phaseBPolicyReviewedAt: phaseBPolicy.reviewedAt,
      phaseBPolicyExpiresAt: phaseBPolicy.expiresAt,
      phaseBPolicyVersion: phaseBPolicy.policyVersion,
      authorizationId: "phase-b-auth-001",
      nonce: "phase-b-nonce-unique",
      hostRecoveryAuthorityIdentity: "fixture-host-authority",
      hostRecoveryAuthorityKeyId: "authority-key",
    });
    const phaseBEnvelope = createAuthorizationEnvelope(phaseBClaims, "B", "phase-b-key", phaseBKey.privateKey);
    const recoveryAuthorizationEvidence = evidence("authorize-recovery", {
      recoveryCaseId: "recovery-case-001",
      markerReaderRolloutReceiptDigest: verifiedRolloutDigest,
    });
    const recoveryAuthorized = await applyFixtureTransition(await nextRequest(authority, "authorize-recovery", recoveryAuthorizationEvidence, {
      envelope: phaseBEnvelope, policyAttestation: phaseBPolicy, rolloutReceipt: rollout.receipt,
    }));
    expect(recoveryAuthorized.record.nextState).toBe("recovery-authorized");
    expect(recoveryAuthorized.record.nonceConsumption.items).toHaveLength(2);
    await expect(authority.applyTransition(await nextRequest(authority, "enable-writers", evidence("enable-writers"))))
      .rejects.toThrow(/not allowed/);

    const rollbackReadyEvidence = evidence("mark-rollback-app-ready", {
      rollbackImageDigest: artifact.rollbackImageDigest,
      databaseRole: "bodycast_recovery_readonly",
      readOnlySchemaCompatibilityDigest: "a1".repeat(32),
      publicRoute: false,
    });
    const rollbackReady = await applyFixtureTransition(await nextRequest(authority, "mark-rollback-app-ready", rollbackReadyEvidence));
    const writerEvidence = evidence("enable-writers", {
      rollbackImageDigest: artifact.rollbackImageDigest,
      readOnlyAppStopped: true,
      writerDrainDigest: "b1".repeat(32),
      existingWriterRole: true,
    });
    const writersEnabled = await applyFixtureTransition(await nextRequest(authority, "enable-writers", writerEvidence));
    const completeEvidence = evidence("complete-recovery", { appHealth: "healthy", integrityDigest: "c1".repeat(32) });
    const recoveryComplete = await applyFixtureTransition(await nextRequest(authority, "complete-recovery", completeEvidence));
    const trafficEvidence = evidence("open-traffic", { trafficTarget: "bodycast-app-prod", topologyDigest: "6".repeat(64) });
    const trafficOpen = await applyFixtureTransition(await nextRequest(authority, "open-traffic", trafficEvidence));
    expect([rollbackReady.record.nextState, writersEnabled.record.nextState, recoveryComplete.record.nextState, trafficOpen.record.nextState])
      .toEqual(["rollback-app-ready", "writers-enabled", "recovery-complete", "traffic-open"]);

    const finalEvidence = evidence("finalize-recovery", {
      phaseAAuthorizationId: "phase-a-auth-001",
      phaseBAuthorizationId: "phase-b-auth-001",
      fullRecoveryLineageDigest: canonicalDigest([
        boot.record, phaseARecord.record, restoreInProgress.record, restoreVerified.record,
        recoveryAuthorized.record, rollbackReady.record, writersEnabled.record, recoveryComplete.record, trafficOpen.record,
      ].map(({ generation, recordDigest }) => ({ generation, recordDigest }))),
      backupArtifactIdentity: { id: "backup-001", digest: "e1".repeat(32) },
      schemaHistoryVerificationDigest: "f1".repeat(32),
      writerTopologyEvidenceDigest: "11".repeat(32),
      trafficTarget: "bodycast-app-prod",
      healthResult: "healthy",
    });
    const finalizeRequest = await nextRequest(authority, "finalize-recovery", finalEvidence);
    failLegacyDirectorySync = true;
    await expect(authority.finalizeRecovery(finalizeRequest)).rejects.toThrow(/simulated legacy marker directory fsync/);
    expect(await fs.lstat(v2MarkerPath)).toBeTruthy();
    expect((await authority.readAuthoritativeState()).blocking).toBe(true);

    const retryFinalizeRequest = await nextRequest(authority, "finalize-recovery", finalEvidence);
    const finalized = await authority.finalizeRecovery(retryFinalizeRequest);
    expect(finalized.record.nextState).toBe("recovery-finalized");
    expect(finalized.receipt.purpose).toBe("bodycast-production-recovery-completion");
    expect(verifyImmutableReceipt(finalized.receipt, authorityPublicKeys)).toBe(true);
    expect(await fs.lstat(v2MarkerPath).catch(() => null)).toBeNull();
    expect(await fs.lstat(legacyMarkerPath).catch(() => null)).toBeNull();
    const finalizedAgain = await authority.finalizeRecovery(await nextRequest(authority, "finalize-recovery", finalEvidence));
    expect(finalizedAgain.record.generation).toBe(finalized.record.generation);
    expect(finalizedAgain.receipt.receiptDigest).toBe(finalized.receipt.receiptDigest);
    expect(finalizedAgain.markerRemoved).toBe(true);
    const changedFinalEvidence = { ...finalEvidence, healthResult: "different-health-result" };
    evidenceByType.set(changedFinalEvidence.type, changedFinalEvidence);
    await expect(authority.finalizeRecovery(await nextRequest(authority, "finalize-recovery", changedFinalEvidence)))
      .rejects.toThrow(/retry evidence differs/);
    expect((await authority.readAuthoritativeState()).blocking).toBe(false);
}
