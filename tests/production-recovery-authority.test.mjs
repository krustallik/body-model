import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  canonicalDigest,
  canonicalJson,
  sha256Hex,
  signCanonical,
  verifyCanonical,
} from "../scripts/production-recovery/canonical.mjs";
import {
  commitJournalRecord,
  createSignedJournalRecord,
  readJournal,
  readMarkerProjection,
  verifyJournalFilesystemCapabilities,
  writeImmutableReceipt,
  writeMarkerProjection,
  verifyImmutableReceipt,
} from "../scripts/production-recovery/journal.mjs";
import { createRecoveryAuthority } from "../scripts/production-recovery/authority.mjs";
import { executeReconciledHostOperation } from "../scripts/production-recovery/operation-contracts.mjs";

const tempRoots = [];
const noDirectorySync = async () => {};

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bodycast-recovery-test-"));
  tempRoots.push(root);
  return root;
}

function signingFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKey,
    signing: {
      privateKey,
      authorityVersion: "1.0.0",
      authorityKeyId: "test-root-key",
      authorityInstanceId: "test-authority",
    },
    publicKeys: { "test-root-key": publicKey },
  };
}

function makeRecord(signing, { legacyMarkerDigest = "6".repeat(64) } = {}) {
  const artifact = {
    rollbackAppSha: "a".repeat(40),
    failedReleaseSha: "b".repeat(40),
    rollbackContainerId: "container-1",
    rollbackImageId: "sha256:" + "c".repeat(64),
    rollbackImageDigest: "d".repeat(64),
    rollbackArtifactId: "oci://bodycast/app@sha256:" + "d".repeat(64),
    rollbackArtifactDigest: "e".repeat(64),
    rollbackCaptureAttestationDigest: "f".repeat(64),
    composeProjectServiceIdentityDigest: "1".repeat(64),
    deployHostTopologyDigest: "2".repeat(64),
  };
  return createSignedJournalRecord({
    journalSchemaVersion: 2,
    generation: 1,
    priorGeneration: 0,
    priorRecordDigest: "0".repeat(64),
    priorState: null,
    nextState: "ddl-started",
    canonicalMainSha: "9".repeat(40),
    recoveryCaseId: "case-001",
    manifestId: "case-001",
    failedReleaseSha: artifact.failedReleaseSha,
    rollbackAppSha: artifact.rollbackAppSha,
    immutableRollbackArtifact: artifact,
    logicalProductionDbIdentityDigest: "3".repeat(64),
    composeProjectServiceIdentityDigest: artifact.composeProjectServiceIdentityDigest,
    deployHostTopologyDigest: artifact.deployHostTopologyDigest,
    markerReaderRolloutReceiptDigest: "4".repeat(64),
    legacyMarkerDigest,
    legacyMarkerState: "ddl-started",
    transition: "bootstrap-failed-release",
    phase: null,
    authorizationId: null,
    authorizationEnvelopeDigest: null,
    policyAttestationDigest: null,
    nonceConsumption: null,
    restoreGrant: null,
    sourceEvidenceDigest: "5".repeat(64),
    operationIntent: null,
    operationEvidenceId: null,
    workflowProvenance: { repository: "krustallik/body-model" },
    timestamp: "2026-10-07T00:00:00.000Z",
  }, signing);
}

function makeLegacyRecord(signing) {
  const record = makeRecord(signing);
  const fields = { ...record, journalSchemaVersion: 1 };
  delete fields.operationIntent;
  delete fields.operationEvidenceId;
  delete fields.recordDigest;
  delete fields.authoritySignature;
  return createSignedJournalRecord(fields, signing);
}

async function makePendingOperationAuthority() {
  const root = await makeTempRoot();
  const journalDirectory = path.join(root, "journal");
  const receiptDirectory = path.join(root, "receipts");
  const projectionDirectory = path.join(root, "projection");
  const legacyDirectory = path.join(root, "legacy");
  await Promise.all([journalDirectory, receiptDirectory, projectionDirectory, legacyDirectory]
    .map((directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 })));
  const keys = signingFixture();
  const markerPath = path.join(projectionDirectory, "marker-v2.json");
  const legacyMarkerPath = path.join(legacyDirectory, "marker-v1");
  const legacyBytes = Buffer.from(`schemaVersion=1\nmanifestId=case-001\nreleaseSha=${"b".repeat(40)}\nstate=ddl-started\n`);
  await fs.writeFile(legacyMarkerPath, legacyBytes, { mode: 0o600 });
  const legacyMarkerDigest = sha256Hex(legacyBytes);
  const first = makeRecord(keys.signing, { legacyMarkerDigest });
  await commitJournalRecord(journalDirectory, first, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync });
  await writeMarkerProjection(markerPath, first, { syncDirectory: noDirectorySync });
  const nonceItems = ["7", "8"].map((digit) => ({
    purpose: "environment-policy-phase-a",
    nonceDigest: digit.repeat(64),
    authorizationId: "auth-a",
  }));
  const artifact = first.immutableRollbackArtifact;
  const grant = {
    purpose: "restore-only", authorizationId: "auth-a", recoveryCaseId: "case-001", manifestId: "case-001",
    phaseAPolicyDigest: "9".repeat(64), phaseAEnvelopeDigest: "a".repeat(64), failedReleaseSha: first.failedReleaseSha,
    rollbackAppSha: first.rollbackAppSha, rollbackContainerId: artifact.rollbackContainerId, rollbackImageId: artifact.rollbackImageId,
    rollbackImageDigest: artifact.rollbackImageDigest, rollbackArtifactId: artifact.rollbackArtifactId,
    rollbackArtifactDigest: artifact.rollbackArtifactDigest, rollbackArtifact: artifact,
    logicalProductionDbIdentityDigest: first.logicalProductionDbIdentityDigest,
    expiresAt: "2030-01-01T00:00:00.000Z", consumedNonceDigests: nonceItems.map(({ nonceDigest }) => nonceDigest),
  };
  const firstDigest = first.recordDigest;
  const firstBody = { ...first };
  delete firstBody.recordDigest;
  delete firstBody.authoritySignature;
  const second = createSignedJournalRecord({
    ...firstBody, generation: 2, priorGeneration: 1, priorRecordDigest: firstDigest, priorState: "ddl-started",
    nextState: "restore-authorized", transition: "authorize-restore", phase: "A", authorizationId: "auth-a",
    authorizationEnvelopeDigest: "a".repeat(64), policyAttestationDigest: "9".repeat(64), nonceConsumption: { items: nonceItems },
    restoreGrant: grant, sourceEvidenceDigest: canonicalDigest({ type: "authorize-restore" }), operationIntent: null,
    operationEvidenceId: null, timestamp: "2026-10-07T00:00:01.000Z",
  }, keys.signing);
  await commitJournalRecord(journalDirectory, second, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync });
  await writeMarkerProjection(markerPath, second, { syncDirectory: noDirectorySync });
  const evidence = { type: "begin-restore", recoveryCaseId: "case-001", artifactId: artifact.rollbackArtifactId };
  const operationType = "recovery-restore-in-place";
  const operationInputDigest = canonicalDigest({
    schemaVersion: 1, recoveryCaseId: "case-001", transition: "begin-restore", operationType,
    sourceEvidenceDigest: canonicalDigest(evidence), immutableRollbackArtifact: artifact,
    logicalProductionDbIdentityDigest: first.logicalProductionDbIdentityDigest,
  });
  const operationIntent = {
    schemaVersion: 1, operationType, operationInputDigest,
    operationId: canonicalDigest({ recoveryCaseId: "case-001", generation: 3, transition: "begin-restore", operationType, operationInputDigest }),
  };
  const secondDigest = second.recordDigest;
  const secondBody = { ...second };
  delete secondBody.recordDigest;
  delete secondBody.authoritySignature;
  const third = createSignedJournalRecord({
    ...secondBody, generation: 3, priorGeneration: 2, priorRecordDigest: secondDigest, priorState: "restore-authorized",
    nextState: "restore-in-progress", transition: "begin-restore", phase: null, authorizationId: null,
    authorizationEnvelopeDigest: null, policyAttestationDigest: null, nonceConsumption: null,
    sourceEvidenceDigest: canonicalDigest(evidence), operationIntent, operationEvidenceId: "begin-evidence",
    timestamp: "2026-10-07T00:00:02.000Z",
  }, keys.signing);
  await commitJournalRecord(journalDirectory, third, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync });
  await writeMarkerProjection(markerPath, third, { syncDirectory: noDirectorySync });
  const authority = createRecoveryAuthority({
    journalDirectory, lockPath: path.join(root, "recovery.lock"), markerPath, legacyMarkerPath, receiptDirectory,
    signing: keys.signing, journalPublicKeys: keys.publicKeys, phaseAPublicKeys: keys.publicKeys,
    phaseBPublicKeys: keys.publicKeys, policyPublicKeys: keys.publicKeys,
    phaseWorkflowBindings: { A: { repository: "krustallik/body-model", workflowPath: "phase-a.yml", workflowId: "1" },
      B: { repository: "krustallik/body-model", workflowPath: "phase-b.yml", workflowId: "2" } },
    validateEvidence: async () => true, verifyRolloutReceipt: async () => true, verifyRestoreGrant: async () => true,
    requireRoot: false, syncDirectory: noDirectorySync,
  });
  return { authority, record: third, evidence, root, keys };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("production recovery canonical and journal authority", () => {
  it("persists migration challenges and consumes each nonce for one exact operation and proof", async () => {
    const root = await makeTempRoot();
    const journalDirectory = path.join(root, "journal");
    const receiptDirectory = path.join(root, "receipts");
    const markerDirectory = path.join(root, "projection");
    const legacyDirectory = path.join(root, "legacy");
    await Promise.all([journalDirectory, receiptDirectory, markerDirectory, legacyDirectory]
      .map((directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 })));
    const keys = signingFixture();
    const fixedNow = Date.parse("2026-10-08T12:00:00.000Z");
    const authorityOptions = {
      journalDirectory,
      receiptDirectory,
      markerPath: path.join(markerDirectory, "marker-v2.json"),
      legacyMarkerPath: path.join(legacyDirectory, "marker-v1"),
      lockPath: path.join(root, "recovery.lock"),
      signing: keys.signing,
      journalPublicKeys: keys.publicKeys,
      phaseAPublicKeys: keys.publicKeys,
      phaseBPublicKeys: keys.publicKeys,
      policyPublicKeys: keys.publicKeys,
      phaseWorkflowBindings: {
        A: { repository: "krustallik/body-model", workflowPath: "phase-a.yml", workflowId: "1" },
        B: { repository: "krustallik/body-model", workflowPath: "phase-b.yml", workflowId: "2" },
      },
      validateEvidence: async () => true,
      verifyRolloutReceipt: async () => true,
      verifyRestoreGrant: async () => true,
      requireRoot: false,
      syncDirectory: noDirectorySync,
      now: () => fixedNow,
    };
    const authority = createRecoveryAuthority(authorityOptions);
    const authorityAfterRestart = createRecoveryAuthority(authorityOptions);
    const challengeId = canonicalDigest({ purpose: "migration-challenge-test", nonce: "1".repeat(64) });
    const unsignedChallenge = {
      schemaVersion: 1,
      purpose: "bodycast-production-migration-challenge",
      challengeId,
      nonce: "1".repeat(64),
      releaseSha: "a".repeat(40),
      canonicalMainSha: "a".repeat(40),
      migrationManifestId: "active-energy-unified-v2",
      logicalProductionDbIdentityDigest: "b".repeat(64),
      markerState: null,
      markerDigest: null,
      recoveryGeneration: 0,
      recoveryRecordDigest: "0".repeat(64),
      workflowId: "901",
      workflowRunId: "902",
      workflowRunAttempt: 1,
      pendingMigrationSetDigest: "c".repeat(64),
      pendingMigrationCount: 2,
      liveStateDigest: canonicalDigest({ releaseSha: "a".repeat(40), pending: 2 }),
      issuedAt: new Date(fixedNow).toISOString(),
      expiresAt: new Date(fixedNow + 60_000).toISOString(),
    };
    const challenge = { ...unsignedChallenge, challengeDigest: canonicalDigest(unsignedChallenge) };
    const issued = await authority.issueMigrationChallenge(challenge);
    expect(verifyImmutableReceipt(issued, keys.publicKeys)).toBe(true);
    expect(await authorityAfterRestart.readMigrationChallenge(challengeId)).toEqual(challenge);

    const operationId = "d".repeat(64);
    const tokenDigest = "e".repeat(64);
    const consume = { challengeId, challengeDigest: challenge.challengeDigest, operationId, tokenDigest };
    const concurrent = await Promise.all([
      authority.consumeMigrationChallenge(consume),
      authorityAfterRestart.consumeMigrationChallenge(consume),
    ]);
    expect(concurrent.filter(({ consumed }) => consumed)).toHaveLength(1);
    expect(concurrent.filter(({ consumed }) => !consumed)).toHaveLength(1);
    const consumption = await authorityAfterRestart.readMigrationChallengeConsumption(challengeId);
    expect(verifyImmutableReceipt(consumption, keys.publicKeys)).toBe(true);
    expect(consumption).toMatchObject({ challengeId, challengeDigest: challenge.challengeDigest, operationId, tokenDigest });
    await expect(authority.consumeMigrationChallenge({ ...consume, operationId: "f".repeat(64) }))
      .rejects.toThrow(/cannot authorize another operation or proof/);
    await expect(authority.consumeMigrationChallenge({ ...consume, tokenDigest: "9".repeat(64) }))
      .rejects.toThrow(/cannot authorize another operation or proof/);
  });

  it("verifies exact journal v1 and v2 schemas and rejects mixed or mutated version chains", async () => {
    const root = await makeTempRoot();
    const keys = signingFixture();
    const legacyDirectory = path.join(root, "legacy-journal");
    const v2Directory = path.join(root, "v2-journal");
    const mixedDirectory = path.join(root, "mixed-journal");
    const legacyExtraDirectory = path.join(root, "legacy-extra");
    const v2MissingDirectory = path.join(root, "v2-missing");
    await Promise.all([legacyDirectory, v2Directory, mixedDirectory, legacyExtraDirectory, v2MissingDirectory]
      .map((directory) => fs.mkdir(directory)));
    const legacy = makeLegacyRecord(keys.signing);
    await commitJournalRecord(legacyDirectory, legacy, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync });
    expect((await readJournal(legacyDirectory, { publicKeys: keys.publicKeys })).tail.journalSchemaVersion).toBe(1);

    const v2 = makeRecord(keys.signing);
    await commitJournalRecord(v2Directory, v2, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync });
    expect((await readJournal(v2Directory, { publicKeys: keys.publicKeys })).tail.journalSchemaVersion).toBe(2);

    const legacyWithV2Fields = { ...legacy, operationIntent: null, operationEvidenceId: null };
    await expect(commitJournalRecord(legacyExtraDirectory, legacyWithV2Fields,
      { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync })).rejects.toThrow(/closed schema/);
    const v2MissingEvidence = { ...v2 };
    delete v2MissingEvidence.operationEvidenceId;
    await expect(commitJournalRecord(v2MissingDirectory, v2MissingEvidence,
      { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync })).rejects.toThrow(/closed schema/);

    await fs.writeFile(path.join(mixedDirectory, "generation-00000000000000000001.json"), canonicalJson(legacy));
    await fs.writeFile(path.join(mixedDirectory, "generation-00000000000000000002.json"), canonicalJson(v2));
    await expect(readJournal(mixedDirectory, { publicKeys: keys.publicKeys })).rejects.toThrow(/mixes schema versions/);
  });

  it("keeps supported journal v1 readable but read-only for authority mutations", async () => {
    const root = await makeTempRoot();
    const journalDirectory = path.join(root, "journal");
    const receiptDirectory = path.join(root, "receipts");
    const markerPath = path.join(root, "marker.json");
    const legacyMarkerPath = path.join(root, "legacy-marker");
    await Promise.all([journalDirectory, receiptDirectory].map((directory) => fs.mkdir(directory, { mode: 0o700 })));
    const keys = signingFixture();
    const legacy = makeLegacyRecord(keys.signing);
    await commitJournalRecord(journalDirectory, legacy, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync });
    const authority = createRecoveryAuthority({
      journalDirectory, lockPath: path.join(root, "authority.lock"), markerPath, legacyMarkerPath, receiptDirectory,
      signing: keys.signing, journalPublicKeys: keys.publicKeys, phaseAPublicKeys: keys.publicKeys,
      phaseBPublicKeys: keys.publicKeys, policyPublicKeys: keys.publicKeys,
      phaseWorkflowBindings: { A: { repository: "krustallik/body-model", workflowPath: "phase-a.yml", workflowId: "1" },
        B: { repository: "krustallik/body-model", workflowPath: "phase-b.yml", workflowId: "2" } },
      validateEvidence: async () => true, verifyRolloutReceipt: async () => true, verifyRestoreGrant: async () => true,
      requireRoot: false, syncDirectory: noDirectorySync,
    });
    await expect(authority.applyTransition({ recoveryCaseId: legacy.recoveryCaseId, transition: "begin-restore",
      expectedGeneration: legacy.generation, expectedRecordDigest: legacy.recordDigest, evidence: { type: "begin-restore" } }))
      .rejects.toThrow(/Legacy journal schema is read-only/);
    expect((await authority.readAuthoritativeState()).generation).toBe(legacy.generation);
  });

  it("keeps an unreceipted operation blocking, retries the same intent, and does not duplicate completed effects", async () => {
    const { authority, record } = await makePendingOperationAuthority();
    const identity = { recoveryCaseId: "case-001", generation: record.generation, recordDigest: record.recordDigest,
      operationId: record.operationIntent.operationId };
    expect((await authority.readPendingOperation()).receipt).toBeNull();
    await expect(authority.applyTransition({
      recoveryCaseId: "different-case", transition: "verify-restore", expectedGeneration: record.generation,
      expectedRecordDigest: record.recordDigest, evidence: { type: "verify-restore" },
    })).rejects.toThrow(/selector does not match/);
    expect((await authority.readAuthoritativeState()).generation).toBe(record.generation);
    await expect(authority.executePendingOperation({ ...identity, operationId: "e".repeat(64) }, async () => ({ ok: true })))
      .rejects.toThrow(/exact current journal operation intent/);
    let externallyAppliedOperationId = null;
    let destructiveEffectCount = 0;
    const observedOperationIds = [];
    const artifact = record.immutableRollbackArtifact;
    const postcondition = { logicalProductionDbIdentityDigest: record.logicalProductionDbIdentityDigest,
      backupArtifactDigest: artifact.rollbackArtifactDigest, schemaDigest: "1".repeat(64),
      migrationHistoryDigest: "2".repeat(64), readOnlyCompatibilityDigest: "3".repeat(64) };
    const precondition = { logicalProductionDbIdentityDigest: record.logicalProductionDbIdentityDigest,
      backupArtifactDigest: artifact.rollbackArtifactDigest, observedSchemaDigest: "8".repeat(64),
      observedMigrationHistoryDigest: "9".repeat(64) };
    const reconcileSameOperation = async ({ record: exactRecord, intent }) => executeReconciledHostOperation({
      operationType: intent.operationType, operationId: intent.operationId, operationInputDigest: intent.operationInputDigest,
      recoveryCaseId: exactRecord.recoveryCaseId, journalGeneration: exactRecord.generation,
      journalRecordDigest: exactRecord.recordDigest,
      bindings: { recoveryCaseId: exactRecord.recoveryCaseId, manifestId: exactRecord.manifestId,
        releaseSha: exactRecord.rollbackAppSha, logicalProductionDbIdentityDigest: exactRecord.logicalProductionDbIdentityDigest,
        immutableRollbackArtifact: exactRecord.immutableRollbackArtifact },
      inspectFixedOperationState: async (_operationType, operation) => {
        const state = externallyAppliedOperationId === operation.operationId ? "post" : "pre";
        const selectedPrecondition = state === "pre" ? precondition : null;
        const selectedPostcondition = state === "post" ? postcondition : null;
        return { schemaVersion: 1, purpose: "bodycast-host-operation-state", operationType: intent.operationType,
          operationId: operation.operationId, idempotencyKey: operation.operationId,
          operationInputDigest: operation.operationInputDigest, state, observedAt: "2026-10-07T00:00:03.000Z",
          stateDigest: canonicalDigest({ state: state === "pre" ? "restore-required" : "exact-backup-restored",
            precondition: selectedPrecondition, postcondition: selectedPostcondition }),
          precondition: selectedPrecondition, postcondition: selectedPostcondition };
      },
      authorizeImmediatelyBeforeEffect: async () => {},
      executeFixedOperation: async (operationType, operation) => {
        observedOperationIds.push(operation.operationId);
        if (externallyAppliedOperationId !== null && externallyAppliedOperationId !== operation.operationId) {
          throw new Error("cannot reconcile a different destructive operation");
        }
        await operation.authorizeImmediatelyBeforeEffect();
        externallyAppliedOperationId = operation.operationId;
        destructiveEffectCount += 1;
        throw new Error("simulated process crash after external restore succeeds but before receipt acknowledgement");
      },
    });
    await expect(authority.executePendingOperation(identity, reconcileSameOperation)).rejects.toThrow(/process crash/);
    await expect(authority.applyTransition({
      recoveryCaseId: "case-001", transition: "verify-restore", expectedGeneration: record.generation,
      expectedRecordDigest: record.recordDigest, evidence: { type: "verify-restore" },
    })).rejects.toThrow(/no authenticated completion receipt/);

    const retried = await authority.executePendingOperation(identity, reconcileSameOperation);
    expect(retried.executed).toBe(true);
    expect(retried.receipt).toMatchObject({
      operationId: record.operationIntent.operationId,
      journalGeneration: record.generation,
      journalRecordDigest: record.recordDigest,
      operationInputDigest: record.operationIntent.operationInputDigest,
    });
    const duplicate = await authority.executePendingOperation(identity, async () => {
      throw new Error("a completed operation must never execute a second time");
    });
    expect(duplicate.executed).toBe(false);
    expect(observedOperationIds).toEqual([record.operationIntent.operationId]);
    expect(destructiveEffectCount).toBe(1);
    const next = await authority.applyTransition({
      recoveryCaseId: "case-001", transition: "verify-restore", expectedGeneration: record.generation,
      expectedRecordDigest: record.recordDigest, evidence: { type: "verify-restore" },
    });
    expect(next.record.nextState).toBe("restore-verified");
  });

  it("rejects an operation receipt signed for a different journal record", async () => {
    const { authority, record, root, keys } = await makePendingOperationAuthority();
    const postcondition = { logicalProductionDbIdentityDigest: record.logicalProductionDbIdentityDigest,
      backupArtifactDigest: record.immutableRollbackArtifact.rollbackArtifactDigest, schemaDigest: "1".repeat(64),
      migrationHistoryDigest: "2".repeat(64), readOnlyCompatibilityDigest: "3".repeat(64) };
    const operationSuccess = { schemaVersion: 1, purpose: "bodycast-host-operation-success",
      operationType: record.operationIntent.operationType, recoveryCaseId: record.recoveryCaseId,
      journalGeneration: record.generation, journalRecordDigest: record.recordDigest,
      operationId: record.operationIntent.operationId, idempotencyKey: record.operationIntent.operationId,
      operationInputDigest: record.operationIntent.operationInputDigest, result: "already-satisfied", postcondition,
      postconditionDigest: canonicalDigest(postcondition) };
    const body = {
      receiptSchemaVersion: 1,
      purpose: "bodycast-production-recovery-operation-completion",
      recoveryCaseId: "case-001",
      journalGeneration: record.generation,
      journalRecordDigest: "f".repeat(64),
      operationId: record.operationIntent.operationId,
      operationType: record.operationIntent.operationType,
      operationInputDigest: record.operationIntent.operationInputDigest,
      operationSuccess,
      outcomeDigest: canonicalDigest(operationSuccess),
      timestamp: "2026-10-07T00:00:03.000Z",
      authorityVersion: keys.signing.authorityVersion,
      authorityKeyId: keys.signing.authorityKeyId,
      authorityInstanceId: keys.signing.authorityInstanceId,
    };
    const receiptDigest = canonicalDigest(body);
    const signature = signCanonical({ receiptDigest, authorityKeyId: keys.signing.authorityKeyId,
      authorityInstanceId: keys.signing.authorityInstanceId }, keys.signing.privateKey);
    const receipt = { ...body, receiptDigest, authoritySignature: signature };
    await fs.writeFile(path.join(root, "receipts", "operation-" + record.operationIntent.operationId + ".json"), canonicalJson(receipt));
    await expect(authority.readPendingOperation()).rejects.toThrow(/does not bind the exact committed operation intent/);
  });

  it("canonicalizes object keys and rejects non-JSON or unsafe numeric values", () => {
    expect(canonicalJson({ z: 1, a: { y: true, x: null } })).toBe('{"a":{"x":null,"y":true},"z":1}');
    expect(canonicalDigest({ a: 1, b: 2 })).toBe(canonicalDigest({ b: 2, a: 1 }));
    expect(() => canonicalJson({ secret: undefined })).toThrow(/undefined/);
    expect(() => canonicalJson({ fraction: 1.25 })).toThrow(/safe integer/);
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("creates exactly one no-overwrite generation under concurrent commits", async () => {
    const root = await makeTempRoot();
    const journal = path.join(root, "journal");
    await fs.mkdir(journal, { mode: 0o700 });
    const keys = signingFixture();
    const record = makeRecord(keys.signing);
    const results = await Promise.allSettled([
      commitJournalRecord(journal, record, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync }),
      commitJournalRecord(journal, record, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected.reason.code).toBe("EEXIST");
    const state = await readJournal(journal, { publicKeys: keys.publicKeys });
    expect(state.records).toBe(1);
    expect(state.tail.recordDigest).toBe(record.recordDigest);
  });

  it("ignores orphan temp files but rejects a truncated committed generation", async () => {
    const root = await makeTempRoot();
    const journal = path.join(root, "journal");
    await fs.mkdir(journal);
    const keys = signingFixture();
    await fs.writeFile(path.join(journal, ".generation-00000000000000000001-orphan.tmp"), "{");
    expect((await readJournal(journal, { publicKeys: keys.publicKeys })).records).toBe(0);
    const record = makeRecord(keys.signing);
    await commitJournalRecord(journal, record, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync });
    await fs.writeFile(path.join(journal, "generation-00000000000000000001.json"), "{");
    await expect(readJournal(journal, { publicKeys: keys.publicKeys })).rejects.toThrow();
  });

  it("fails closed on chain gaps, tampering, and unsupported generation names", async () => {
    const root = await makeTempRoot();
    const journal = path.join(root, "journal");
    await fs.mkdir(journal);
    const keys = signingFixture();
    await fs.writeFile(path.join(journal, "generation-00000000000000000002.json"), "{}");
    await expect(readJournal(journal, { publicKeys: keys.publicKeys })).rejects.toThrow(/gap/);
    await fs.rm(path.join(journal, "generation-00000000000000000002.json"));
    await fs.writeFile(path.join(journal, "generation-2.json"), "{}");
    await expect(readJournal(journal, { publicKeys: keys.publicKeys })).rejects.toThrow(/filename/);
  });

  it("projects state from a committed generation and rejects stale or forged markers", async () => {
    const root = await makeTempRoot();
    const journal = path.join(root, "journal");
    await fs.mkdir(journal);
    const markerPath = path.join(root, "marker.json");
    const keys = signingFixture();
    const record = makeRecord(keys.signing);
    await commitJournalRecord(journal, record, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync });
    const marker = await writeMarkerProjection(markerPath, record, { syncDirectory: noDirectorySync });
    expect((await readMarkerProjection(markerPath, record)).marker).toEqual(marker);
    await expect(readMarkerProjection(path.join(root, "missing.json"), record)).resolves.toMatchObject({ absent: true });
    const forged = { ...marker, state: "traffic-open" };
    await fs.writeFile(markerPath, canonicalJson(forged));
    await expect(readMarkerProjection(markerPath, record)).rejects.toThrow(/digest/);
    await writeMarkerProjection(markerPath, record, { syncDirectory: noDirectorySync });
    const unrelatedTail = { ...record, recordDigest: "6".repeat(64) };
    await expect(readMarkerProjection(markerPath, unrelatedTail)).rejects.toThrow(/journal tail/);
  });

  it("uses hard links with EEXIST and verifies required filesystem capabilities", async () => {
    const root = await makeTempRoot();
    const journal = path.join(root, "journal");
    await fs.mkdir(journal);
    await expect(verifyJournalFilesystemCapabilities(journal, { syncDirectory: noDirectorySync }))
      .resolves.toMatchObject({ sameFilesystem: true, hardLinks: true, oExcl: true, fileFsync: true, directoryFsync: true });
    const keys = signingFixture();
    const record = makeRecord(keys.signing);
    await commitJournalRecord(journal, record, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync });
    await expect(commitJournalRecord(journal, record, { publicKeys: keys.publicKeys, syncDirectory: noDirectorySync }))
      .rejects.toMatchObject({ code: "EEXIST" });
  });

  it("writes immutable authenticated receipts and rejects a different receipt under the same name", async () => {
    const root = await makeTempRoot();
    const receipts = path.join(root, "receipts");
    await fs.mkdir(receipts);
    const keys = signingFixture();
    const body = {
      receiptSchemaVersion: 1,
      recoveryCaseId: "case-001",
      journalGeneration: 9,
      journalRecordDigest: "7".repeat(64),
      authorityKeyId: "test-root-key",
      authorityInstanceId: "test-authority",
    };
    const first = await writeImmutableReceipt(receipts, "case-001.json", body, {
      privateKey: keys.privateKey,
      publicKeys: keys.publicKeys,
      syncDirectory: noDirectorySync,
    });
    expect(verifyCanonical({ receiptDigest: first.receipt.receiptDigest, authorityKeyId: first.receipt.authorityKeyId, authorityInstanceId: first.receipt.authorityInstanceId },
      first.receipt.authoritySignature, keys.publicKey)).toBe(true);
    await expect(writeImmutableReceipt(receipts, "case-001.json", { ...body, journalGeneration: 10 }, {
      privateKey: keys.privateKey,
      publicKeys: keys.publicKeys,
      syncDirectory: noDirectorySync,
    })).rejects.toThrow(/different completion evidence/);
  });
});
