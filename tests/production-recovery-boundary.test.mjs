import { afterEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalDigest, canonicalJson, signCanonical, verifyCanonical } from "../scripts/production-recovery/canonical.mjs";
import { createProductionOperationBroker, validateProductionOperationRequest } from "../scripts/production-recovery/operation-broker.mjs";
import { parseOperationArguments } from "../scripts/production-recovery/host-operation-client.mjs";
import { createReaderRolloutReceipt, createReaderRolloutVerifier, REQUIRED_READER_ROLLOUT_FIXTURES } from "../scripts/production-recovery/rollout.mjs";
import { writeImmutableReceipt } from "../scripts/production-recovery/journal.mjs";
import {
  compareAuthorityVersions,
  installAuthorityPackageFixture,
  installAuthorityPackageFromRaw,
  verifyAuthorityInstallArtifact,
  verifyAuthorityInstallationReceipt,
  verifyInstalledAuthorityPackage,
} from "../scripts/production-recovery/install-provenance.mjs";
import { createFileBackedPolicyNonceConsumer } from "../scripts/production-recovery/policy-nonce-store.mjs";
import { quoteIdentifier, verifyReadOnlySchemaCompatibility } from "../scripts/production-recovery/schema-compatibility.mjs";
import { createRecoveryPolicySignerService } from "../scripts/production-recovery/policy-signer-service.mjs";
import { captureImmutableRollbackArtifact, assertExactRollbackArtifact } from "../scripts/production-recovery/artifact-identity.mjs";
import { createLogicalDatabaseIdentity, verifySameLogicalDatabaseIdentity } from "../scripts/production-recovery/database-identity.mjs";
import { createWriterDrainVerifier, verifyWriterDrainEvidence } from "../scripts/production-recovery/writer-drain.mjs";
import { createRecoveryHostRuntime, AUTHORITY_CONFIG_KEYS } from "../scripts/production-recovery/host-runtime.mjs";

const roots = [];
async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bodycast-boundary-test-"));
  roots.push(root);
  return root;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

function brokerFixture({ blocking = false, prepared = true, rolloutCurrent = true, releaseValid = true } = {}) {
  const calls = [];
  const authority = { readAuthoritativeState: async () => ({ blocking, generation: 0 }) };
  const broker = createProductionOperationBroker({
    authority,
    verifyReviewedRelease: async () => releaseValid,
    verifyCurrentReaderRollout: async ({ allowAbsent }) => allowAbsent && !rolloutCurrent ? null : { current: rolloutCurrent },
    verifyRecoveryPreparation: async ({ allowAbsent }) => allowAbsent && !prepared ? null : { ready: prepared },
    verifyForwardMigrationAuthorization: async (authorization) => authorization?.purpose === "forward-migration",
    loadEvidenceById: async (id) => ({ type: "evidence-fixture", id }),
    loadAuthorizationById: async (id) => id === "auth-1" ? { purpose: "forward-migration" } : { id },
    loadRolloutReceiptById: async (id) => ({ id }),
    executeFixedOperation: async (operation, payload) => {
      calls.push({ operation, payload });
      return { operation, accepted: true };
    },
  });
  return { broker, calls };
}

describe("production recovery install, rollout, and operation boundaries", () => {
  it("rejects arbitrary commands, paths, extra fields, and malformed typed requests", () => {
    expect(() => validateProductionOperationRequest({ schemaVersion: 1, operation: "docker", command: "docker rm -f all" }))
      .toThrow(/allowlist/);
    expect(() => validateProductionOperationRequest({
      schemaVersion: 1, operation: "ordinary-release", requestId: "req-1", releaseSha: "a".repeat(40),
      canonicalMainSha: "b".repeat(40), path: "/tmp/marker",
    })).toThrow(/closed schema/);
    expect(() => parseOperationArguments(["ordinary-release", "--request-id", "x", "--release-sha", "a".repeat(40),
      "--canonical-main-sha", "b".repeat(40), "--command", "docker"])).toThrow(/argument set/);
    const envelope = { claims: { purpose: "recovery Phase A restore-only" }, signature: "signature" };
    const parsed = parseOperationArguments([
      "recovery-transition", "--request-id", "phase-a", "--recovery-case-id", "case-1", "--transition", "authorize-restore",
      "--expected-generation", "1", "--expected-record-digest", "a".repeat(64), "--evidence-id", "evidence-1",
      "--authorization-envelope-b64", Buffer.from(JSON.stringify(envelope)).toString("base64"),
      "--policy-attestation-b64", Buffer.from("null").toString("base64"), "--rollout-receipt-id", "receipt-1",
    ]);
    expect(parsed.authorizationEnvelope).toEqual(envelope);
    expect(parsed.policyAttestation).toBeNull();
    expect(() => parseOperationArguments([
      "recovery-transition", "--request-id", "phase-a", "--recovery-case-id", "case-1", "--transition", "authorize-restore",
      "--expected-generation", "1", "--expected-record-digest", "a".repeat(64), "--evidence-id", "evidence-1",
      "--authorization-envelope-b64", Buffer.from('{"z":1,"a":2}').toString("base64"),
      "--policy-attestation-b64", Buffer.from("null").toString("base64"), "--rollout-receipt-id", "receipt-1",
    ])).toThrow(/canonical JSON/);
  });

  it("keeps ordinary release available before preparation but blocks on active recovery state", async () => {
    const fixture = brokerFixture({ prepared: false, rolloutCurrent: false });
    const result = await fixture.broker.dispatch({
      schemaVersion: 1, operation: "ordinary-release", requestId: "deploy-1", releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40),
      releaseMode: "serving",
    });
    expect(result).toEqual({ operation: "ordinary-release", accepted: true });
    expect(fixture.calls).toHaveLength(1);

    const readiness = await fixture.broker.dispatch({ schemaVersion: 1, operation: "readiness", requestId: "ready-1" });
    expect(readiness).toMatchObject({ recoveryBlocking: false, rolloutCurrent: false, recoveryPrepared: false });
    await expect(fixture.broker.dispatch({
      schemaVersion: 1, operation: "migration-readiness", requestId: "migrate-ready-1",
      releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40), migrationManifestId: "manifest-v6",
    })).rejects.toThrow(/Forward migration readiness is blocked/);

    const blocked = brokerFixture({ blocking: true });
    await expect(blocked.broker.dispatch({
      schemaVersion: 1, operation: "ordinary-release", requestId: "deploy-2", releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40),
      releaseMode: "serving",
    })).rejects.toThrow(/recovery state blocks/);
    expect(blocked.calls).toHaveLength(0);
  });

  it("blocks forward migration until recovery prerequisites and forward-only authorization pass", async () => {
    const request = {
      schemaVersion: 1, operation: "forward-migration", requestId: "migration-1", releaseSha: "a".repeat(40),
      canonicalMainSha: "a".repeat(40), migrationManifestId: "manifest-v6", authorizationContextId: "auth-1",
    };
    const missing = brokerFixture({ prepared: false });
    await expect(missing.broker.dispatch(request)).rejects.toThrow(/recovery preparation/);
    expect(missing.calls).toHaveLength(0);

    const ready = brokerFixture();
    expect(await ready.broker.dispatch(request)).toMatchObject({ accepted: true, operation: "forward-migration" });
    expect(ready.calls[0]).toEqual({ operation: "forward-migration", payload: {
      releaseSha: "a".repeat(40), canonicalMainSha: "a".repeat(40), migrationManifestId: "manifest-v6", authorizationContextId: "auth-1",
    } });

    const stale = brokerFixture({ releaseValid: false });
    await expect(stale.broker.dispatch(request)).rejects.toThrow(/stale, unreviewed/);
    expect(stale.calls).toHaveLength(0);
  });

  it("passes only evidence identifiers through the fixed recovery transition interface", async () => {
    const calls = [];
    const broker = createProductionOperationBroker({
      authority: {
        readAuthoritativeState: async () => ({ blocking: true }),
        applyTransition: async (request) => { calls.push(request); return { record: { generation: 2 } }; },
      },
      verifyReviewedRelease: async () => true,
      verifyCurrentReaderRollout: async () => ({ current: true }),
      verifyRecoveryPreparation: async () => ({ ready: true }),
      verifyForwardMigrationAuthorization: async () => false,
      loadEvidenceById: async (id) => ({ type: "authorize-restore", id }),
      loadAuthorizationById: async (id) => ({ id }),
      loadRolloutReceiptById: async (id) => ({ id, receiptDigest: "c".repeat(64) }),
      executeFixedOperation: async () => { throw new Error("not used"); },
    });
    const request = {
      schemaVersion: 1, operation: "recovery-transition", requestId: "restore-1", recoveryCaseId: "case-1", transition: "authorize-restore",
      expectedGeneration: 1, expectedRecordDigest: "b".repeat(64), evidenceId: "evidence-1",
      authorizationEnvelope: { id: "envelope-1" }, policyAttestation: { id: "policy-1" }, rolloutReceiptId: "receipt-1",
    };
    await broker.dispatch({ schemaVersion: 1, operation: "readiness", requestId: "ready-1" });
    const result = await broker.dispatch(request);
    expect(result.record.generation).toBe(2);
    expect(calls[0]).toMatchObject({
      transition: "authorize-restore", expectedGeneration: 1, expectedRecordDigest: "b".repeat(64),
      evidence: { id: "evidence-1" }, envelope: { id: "envelope-1" }, policyAttestation: { id: "policy-1" },
      rolloutReceipt: { id: "receipt-1" },
    });
    await expect(broker.dispatch({ ...request, path: "/var/lib/bodycast/recovery/journal" })).rejects.toThrow(/closed schema/);
  });

  it("runs post-authorization mutations only through fixed host execution steps", async () => {
    const calls = [];
    const broker = createProductionOperationBroker({
      authority: {
        readAuthoritativeState: async () => ({ blocking: true, activeRecovery: true }),
        applyTransition: async (request) => ({ record: {
          recoveryCaseId: request.recoveryCaseId, generation: 3, recordDigest: "f".repeat(64), nextState: "restore-in-progress",
          immutableRollbackArtifact: { rollbackArtifactId: "fixture-rollback-artifact" }, logicalProductionDbIdentityDigest: "c".repeat(64),
          operationIntent: { operationId: "a".repeat(64), operationInputDigest: "b".repeat(64), operationType: "recovery-restore-in-place" },
        } }),
        executePendingOperation: async (request, execute) => {
          const outcome = await execute({
            record: { recoveryCaseId: request.recoveryCaseId, generation: request.generation,
              recordDigest: request.recordDigest, operationEvidenceId: "begin-evidence",
              immutableRollbackArtifact: { rollbackArtifactId: "fixture-rollback-artifact" },
              logicalProductionDbIdentityDigest: "c".repeat(64) },
            intent: { operationId: request.operationId, operationInputDigest: "b".repeat(64), operationType: "recovery-restore-in-place" },
          });
          return { receipt: { operationId: request.operationId, outcomeDigest: canonicalDigest(outcome) }, executed: true };
        },
      },
      verifyReviewedRelease: async () => true,
      verifyCurrentReaderRollout: async () => ({ current: true }),
      verifyRecoveryPreparation: async () => ({ ready: true }),
      verifyForwardMigrationAuthorization: async () => false,
      loadEvidenceById: async () => ({ type: "begin-restore" }),
      loadAuthorizationById: async () => null,
      loadRolloutReceiptById: async () => ({ receiptDigest: "e".repeat(64) }),
      executeFixedOperation: async (operation, payload) => { calls.push({ operation, payload }); return { started: true }; },
    });
    const result = await broker.dispatch({
      schemaVersion: 1, operation: "recovery-transition", requestId: "restore-1", recoveryCaseId: "case-1", transition: "begin-restore",
      expectedGeneration: 2, expectedRecordDigest: "d".repeat(64), evidenceId: "begin-evidence",
      authorizationEnvelope: null, policyAttestation: null, rolloutReceiptId: "rollout-1",
    });
    expect(result.record.nextState).toBe("restore-in-progress");
    expect(calls).toEqual([{
      operation: "recovery-restore-in-place",
      payload: { operationId: "a".repeat(64), idempotencyKey: "a".repeat(64), operationInputDigest: "b".repeat(64),
        replayPolicy: "reconcile-same-logical-database-to-same-bound-backup", recoveryCaseId: "case-1",
        generation: 3, recordDigest: "f".repeat(64), immutableRollbackArtifact: { rollbackArtifactId: "fixture-rollback-artifact" },
        logicalProductionDbIdentityDigest: "c".repeat(64), evidenceId: "begin-evidence", evidence: { type: "begin-restore" } },
    }]);
    calls.length = 0;
    await expect(broker.dispatch({
      schemaVersion: 1, operation: "recovery-transition", requestId: "restore-2", recoveryCaseId: "case-1", transition: "begin-restore",
      expectedGeneration: 2, expectedRecordDigest: "d".repeat(64), evidenceId: "../../etc/passwd",
      authorizationEnvelope: null, policyAttestation: null, rolloutReceiptId: "rollout-1",
    })).rejects.toThrow(/opaque fixed-format/);
    expect(calls).toHaveLength(0);
  });

  it("replays only the exact pending journal operation and reuses its idempotency key", async () => {
    const evidence = { type: "begin-restore", backupArtifactId: "backup-fixture-1" };
    const operationId = "a".repeat(64);
    const operationInputDigest = "b".repeat(64);
    let receipt = null;
    let evidenceMutated = false;
    const executionCalls = [];
    const record = {
      recoveryCaseId: "case-1", generation: 3, recordDigest: "f".repeat(64),
      sourceEvidenceDigest: canonicalDigest(evidence),
      immutableRollbackArtifact: { rollbackArtifactId: "fixture-rollback-artifact" },
      logicalProductionDbIdentityDigest: "c".repeat(64),
      operationIntent: { schemaVersion: 1, operationId, operationInputDigest, operationType: "recovery-restore-in-place" },
    };
    const authority = {
      readAuthoritativeState: async () => ({ blocking: true, activeRecovery: true }),
      readPendingOperation: async () => ({ record, intent: record.operationIntent, operationEvidenceId: "evidence-1", receipt }),
      executePendingOperation: async (identity, execute) => {
        const outcome = await execute({ record, intent: record.operationIntent });
        receipt = { operationId: identity.operationId, outcomeDigest: canonicalDigest(outcome) };
        return { receipt, executed: true };
      },
    };
    const broker = createProductionOperationBroker({
      authority,
      verifyReviewedRelease: async () => true,
      verifyCurrentReaderRollout: async () => ({ current: true }),
      verifyRecoveryPreparation: async () => ({ ready: true }),
      verifyForwardMigrationAuthorization: async () => true,
      loadEvidenceById: async () => evidenceMutated ? { ...evidence, backupArtifactId: "different-backup" } : evidence,
      loadAuthorizationById: async () => null,
      loadRolloutReceiptById: async () => null,
      executeFixedOperation: async (operation, payload) => {
        executionCalls.push({ operation, payload });
        return { operationId: payload.operationId, state: "reconciled" };
      },
    });
    const request = {
      schemaVersion: 1, operation: "recovery-operation-replay", requestId: "replay-1", recoveryCaseId: "case-1",
      expectedGeneration: 3, expectedRecordDigest: record.recordDigest, operationId,
    };
    await expect(broker.dispatch({ ...request, operationId: "c".repeat(64) })).rejects.toThrow(/exact pending journal generation/);
    evidenceMutated = true;
    await expect(broker.dispatch({ ...request, requestId: "replay-mutated-evidence" })).rejects.toThrow(/exact evidence bound/);
    expect(executionCalls).toHaveLength(0);
    evidenceMutated = false;
    const replayed = await broker.dispatch(request);
    expect(replayed.replayed).toBe(true);
    expect(executionCalls).toHaveLength(1);
    expect(executionCalls[0]).toMatchObject({
      operation: "recovery-restore-in-place",
      payload: { operationId, idempotencyKey: operationId, operationInputDigest,
        replayPolicy: "reconcile-same-logical-database-to-same-bound-backup", recoveryCaseId: "case-1",
        generation: 3, recordDigest: record.recordDigest, immutableRollbackArtifact: record.immutableRollbackArtifact,
        logicalProductionDbIdentityDigest: record.logicalProductionDbIdentityDigest, evidenceId: "evidence-1", evidence },
    });
    const duplicate = await broker.dispatch({ ...request, requestId: "replay-duplicate" });
    expect(duplicate.replayed).toBe(false);
    expect(executionCalls).toHaveLength(1);
  });

  it("requires root-only authority state, the fixed socket, and a complete signed host adapter", () => {
    const authority = Object.fromEntries(AUTHORITY_CONFIG_KEYS.map((key) => [key, key === "requireRoot" ? true : {}]));
    expect(() => createRecoveryHostRuntime({ authorityConfig: { authority }, trustedHostAdapter: {} }))
      .toThrow(/fixed production host adapter/);
    expect(() => createRecoveryHostRuntime({ authorityConfig: { authority: { ...authority, requireRoot: false } }, trustedHostAdapter: {} }))
      .toThrow(/root-only state/);
    expect(() => createRecoveryHostRuntime({
      authorityConfig: { authority }, trustedHostAdapter: {}, socketPath: "C:\\temp\\untrusted.sock",
    })).toThrow(/fixed operation socket/);
  });

  it("verifies immutable authority package digests, signer, allowlist, and monotonic version", async () => {
    const signer = generateKeyPairSync("ed25519");
    const authoritySigner = generateKeyPairSync("ed25519");
    const binary = Buffer.from("signed authority executable");
    const authorityConfig = Object.fromEntries(AUTHORITY_CONFIG_KEYS.map((key) => [key,
      key === "requireRoot" ? true
        : key === "signing" ? { privateKey: authoritySigner.privateKey.export({ type: "pkcs8", format: "pem" }), authorityVersion: "1.2.0",
          authorityKeyId: "root-key-1", authorityInstanceId: "fixture-authority" }
          : key === "journalPublicKeys" ? { "root-key-1": authoritySigner.publicKey.export({ type: "spki", format: "pem" }) }
          : {}]));
    const packageConfig = { authority: authorityConfig, host: { releaseGroupGid: 1001, adapter: { id: "reviewed-fixture-adapter" } } };
    const config = Buffer.from(canonicalJson(packageConfig));
    const unsigned = {
      schemaVersion: 1,
      purpose: "bodycast-production-recovery-authority-package",
      packageName: "bodycast-production-recovery-authority",
      authorityVersion: "1.2.0",
      authorityKeyId: "root-key-1",
      binaryDigest: sha256(binary),
      configDigest: sha256(config),
      sourceRepository: "krustallik/body-model",
      sourceMainSha: "a".repeat(40),
      buildWorkflowPath: ".github/workflows/authority-package.yml",
      buildWorkflowId: "301",
      buildWorkflowRunId: "302",
      buildWorkflowRunAttempt: "1",
      issuedAt: "2026-10-07T12:00:00.000Z",
      expiresAt: "2026-10-08T12:00:00.000Z",
      signerKeyId: "provenance-key",
    };
    const provenance = { ...unsigned, signature: signCanonical(unsigned, signer.privateKey) };
    const verified = verifyAuthorityInstallArtifact({
      provenance, binaryBytes: binary, configBytes: config,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey },
      allowedAuthorityVersions: ["1.2.0", "1.3.0"], minimumAllowedVersion: "1.0.0",
      currentInstallation: { authorityVersion: "1.1.9" }, now: Date.parse("2026-10-07T12:30:00.000Z"),
    });
    expect(verified).toMatchObject({ authorityVersion: "1.2.0", authorityKeyId: "root-key-1" });
    expect(() => verifyAuthorityInstallArtifact({
      provenance, binaryBytes: Buffer.from("modified"), configBytes: config,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0", now: Date.parse("2026-10-07T12:30:00.000Z"),
    })).toThrow(/digest/);
    expect(() => verifyAuthorityInstallArtifact({
      provenance, binaryBytes: binary, configBytes: config,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0", currentInstallation: { authorityVersion: "1.3.0" },
      now: Date.parse("2026-10-07T12:30:00.000Z"),
    })).toThrow(/downgrade/);
    expect(() => verifyAuthorityInstallArtifact({
      provenance, binaryBytes: binary, configBytes: config,
      trustedProvenanceKeys: { "different-key": signer.publicKey }, allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0", now: Date.parse("2026-10-07T12:30:00.000Z"),
    })).toThrow(/not trusted/);
    const mismatchedVersionConfig = Buffer.from(canonicalJson({
      ...packageConfig,
      authority: { ...authorityConfig, signing: { ...authorityConfig.signing, authorityVersion: "1.2.1" } },
    }));
    const mismatchedVersionUnsigned = { ...unsigned, configDigest: sha256(mismatchedVersionConfig) };
    const mismatchedVersionProvenance = { ...mismatchedVersionUnsigned, signature: signCanonical(mismatchedVersionUnsigned, signer.privateKey) };
    expect(() => verifyAuthorityInstallArtifact({
      provenance: mismatchedVersionProvenance, binaryBytes: binary, configBytes: mismatchedVersionConfig,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0", now: Date.parse("2026-10-07T12:30:00.000Z"),
    })).toThrow(/version or key ID/);
    const mismatchedKeyConfig = Buffer.from(canonicalJson({
      ...packageConfig,
      authority: { ...authorityConfig, signing: { ...authorityConfig.signing, authorityKeyId: "other-root-key" } },
    }));
    const mismatchedKeyUnsigned = { ...unsigned, configDigest: sha256(mismatchedKeyConfig) };
    const mismatchedKeyProvenance = { ...mismatchedKeyUnsigned, signature: signCanonical(mismatchedKeyUnsigned, signer.privateKey) };
    expect(() => verifyAuthorityInstallArtifact({
      provenance: mismatchedKeyProvenance, binaryBytes: binary, configBytes: mismatchedKeyConfig,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey }, allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0", now: Date.parse("2026-10-07T12:30:00.000Z"),
    })).toThrow(/version or key ID/);
    expect(compareAuthorityVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);

    const receiptKey = generateKeyPairSync("ed25519");
    const receipt = {
      receiptSchemaVersion: 1,
      purpose: "bodycast-production-recovery-authority-installation",
      authorityVersion: verified.authorityVersion,
      binaryDigest: verified.binaryDigest,
      configDigest: verified.configDigest,
      authorityKeyId: verified.authorityKeyId,
      installationPath: "/usr/local/lib/bodycast/production-recovery/v1.2.0",
      installedAt: "2026-10-07T12:31:00.000Z",
      previousAuthorityVersion: "1.1.9",
      minimumAllowedVersion: "1.0.0",
      provenanceDigest: verified.provenanceDigest,
      signerKeyId: "installer-key",
    };
    const signedReceipt = { ...receipt, signature: signCanonical(receipt, receiptKey.privateKey) };
    expect(verifyAuthorityInstallationReceipt(signedReceipt, { "installer-key": receiptKey.publicKey }, {
      minimumAllowedVersion: "1.0.0", allowedAuthorityVersions: ["1.2.0"],
    })).toBe(true);

    const installationRoot = path.join(await tempRoot(), "authority-install");
    const rejectedInstallRoot = path.join(await tempRoot(), "authority-install-rejected");
    await expect(installAuthorityPackageFixture({
      provenance: { ...provenance, signature: "forged-signature" },
      binaryBytes: binary,
      configBytes: config,
      installationRoot: rejectedInstallRoot,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey },
      minimumAllowedVersion: "1.0.0",
      now: Date.parse("2026-10-07T12:30:00.000Z"),
      receiptSigner: { keyId: "installer-key", privateKey: receiptKey.privateKey, publicKey: receiptKey.publicKey },
      trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"],
      syncDirectory: async () => {},
    })).rejects.toThrow(/signature/);
    await expect(fs.stat(rejectedInstallRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await installAuthorityPackageFixture({
      provenance,
      binaryBytes: binary,
      configBytes: config,
      installationRoot,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey },
      minimumAllowedVersion: "1.0.0",
      now: Date.parse("2026-10-07T12:30:00.000Z"),
      receiptSigner: { keyId: "installer-key", privateKey: receiptKey.privateKey, publicKey: receiptKey.publicKey },
      trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"],
      syncDirectory: async () => {},
    });
    const installed = await verifyInstalledAuthorityPackage({
      installationRoot,
      trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0",
      requireRoot: false,
    });
    expect(installed).toMatchObject({ authorityVersion: "1.2.0", binaryDigest: verified.binaryDigest, configDigest: verified.configDigest });
    expect(installed.receipt.provenanceDigest).toBe(verified.provenanceDigest);
    await expect(installAuthorityPackageFromRaw({
      provenance: {}, binaryBytes: Buffer.from("untrusted"), configBytes: Buffer.from("{}"),
      verifiedArtifact: verified,
    })).rejects.toThrow(/closed schema/);
    const olderConfig = Buffer.from(canonicalJson({
      ...packageConfig,
      authority: { ...authorityConfig, signing: { ...authorityConfig.signing, authorityVersion: "1.1.9" } },
    }));
    const olderUnsigned = { ...unsigned, authorityVersion: "1.1.9", configDigest: sha256(olderConfig) };
    const olderProvenance = { ...olderUnsigned, signature: signCanonical(olderUnsigned, signer.privateKey) };
    const olderVerified = verifyAuthorityInstallArtifact({
      provenance: olderProvenance, binaryBytes: binary, configBytes: olderConfig,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey },
      allowedAuthorityVersions: ["1.1.9", "1.2.0"], minimumAllowedVersion: "1.0.0",
    });
    expect(olderVerified.authorityVersion).toBe("1.1.9");
    await expect(installAuthorityPackageFixture({
      provenance: olderProvenance,
      binaryBytes: binary,
      configBytes: olderConfig,
      installationRoot,
      trustedProvenanceKeys: { "provenance-key": signer.publicKey },
      trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      minimumAllowedVersion: "1.0.0",
      receiptSigner: { keyId: "installer-key", privateKey: receiptKey.privateKey, publicKey: receiptKey.publicKey },
      allowedAuthorityVersions: ["1.1.9", "1.2.0"],
      now: Date.parse("2026-10-07T12:30:00.000Z"),
      syncDirectory: async () => {},
    })).rejects.toThrow(/downgrade/);
    await fs.writeFile(path.join(installationRoot, "v1.2.0", "bodycast-recovery-authority"), "tampered");
    await expect(verifyInstalledAuthorityPackage({
      installationRoot,
      trustedInstallationKeys: { "installer-key": receiptKey.publicKey },
      allowedAuthorityVersions: ["1.2.0"],
      minimumAllowedVersion: "1.0.0",
      requireRoot: false,
    })).rejects.toThrow(/bytes or version pointer/);
  });

  it("issues rollout evidence only for a current signed receipt and invalidates it on tooling drift", async () => {
    const authority = generateKeyPairSync("ed25519");
    const installed = [{ path: "deploy.sh", gitBlobSha: "a".repeat(40), contentSha256: "b".repeat(64) }];
    const reviewedManifest = ["deploy.sh"];
    const installation = {
      authorityVersion: "1.0.0", authorityKeyId: "root-key", authorityInstanceId: "host-1",
      authorityBinaryDigest: "c".repeat(64), authorityConfigDigest: "d".repeat(64), installationReceiptDigest: "e".repeat(64),
    };
    const evidence = {
      compatibilityFixtures: Object.fromEntries(REQUIRED_READER_ROLLOUT_FIXTURES.map((fixture) => [fixture, true])),
      entrypointManifestVerified: true,
      staleCheckoutRejected: true,
      hostTopologyVerified: true,
      authorityInstallVerified: true,
    };
    const body = createReaderRolloutReceipt({
      repository: "krustallik/body-model", canonicalMainSha: "a".repeat(40), reviewedManifest,
      installedEntrypoints: installed, hostTopologyIdentityDigest: "f".repeat(64), authorityInstallation: installation,
      evidence, issuedAt: "2026-10-07T12:00:00.000Z", expiresAt: "2026-10-08T12:00:00.000Z",
    });
    const root = await tempRoot();
    const saved = await writeImmutableReceipt(root, "rollout.json", body, {
      privateKey: authority.privateKey,
      publicKeys: { "root-key": authority.publicKey },
      syncDirectory: async () => {},
    });
    const expected = {
      repository: body.repository, canonicalMainSha: body.canonicalMainSha,
      reviewedManifestDigest: body.reviewedManifestDigest, entrypointsDigest: body.entrypointsDigest,
      hostTopologyIdentityDigest: body.hostTopologyIdentityDigest, authorityVersion: body.authorityVersion,
      authorityBinaryDigest: body.authorityBinaryDigest, authorityConfigDigest: body.authorityConfigDigest,
      installationReceiptDigest: body.installationReceiptDigest, evidenceDigest: canonicalDigest(evidence),
    };
    const verify = createReaderRolloutVerifier({
      publicKeys: { "root-key": authority.publicKey }, expected,
      loadInstalledEntrypoints: async () => installed,
      now: () => Date.parse("2026-10-07T13:00:00.000Z"),
    });
    expect((await verify(saved.receipt)).receiptDigest).toBe(saved.receipt.receiptDigest);
    await expect(createReaderRolloutVerifier({
      publicKeys: { "root-key": authority.publicKey }, expected,
      loadInstalledEntrypoints: async () => [...installed, { path: "changed", gitBlobSha: "1".repeat(40), contentSha256: "2".repeat(64) }],
    })(saved.receipt)).rejects.toThrow(/drifted/);
    expect(() => createReaderRolloutReceipt({
      repository: body.repository, canonicalMainSha: body.canonicalMainSha,
      reviewedManifest, installedEntrypoints: installed, hostTopologyIdentityDigest: "f".repeat(64),
      authorityInstallation: installation,
      evidence: { ...evidence, compatibilityFixtures: { ...evidence.compatibilityFixtures, futureV2SchemaBlocks: false } },
      issuedAt: "2026-10-07T12:00:00.000Z", expiresAt: "2026-10-08T12:00:00.000Z",
    })).toThrow(/fixtures are incomplete/);
  });

  it("durably consumes policy request IDs and nonces under one exclusive lock", async () => {
    const root = await tempRoot();
    const state = path.join(root, "nonces");
    await fs.mkdir(state, { mode: 0o700 });
    const consume = createFileBackedPolicyNonceConsumer(state, { syncDirectory: async () => {} });
    const binding = { recoveryCaseId: "case-1", phase: "A", requestId: "request-1", nonce: "nonce-1", policyDigest: "a".repeat(64) };
    expect(await consume(binding)).toBe(true);
    expect(await consume(binding)).toBe(false);
    expect(await consume({ ...binding, requestId: "request-2" })).toBe(false);
    const records = await fs.readdir(state);
    expect(records.filter((name) => name.startsWith("request-") && name.endsWith(".json"))).toHaveLength(1);
  });

  it("requires read-only transaction, exact logical DB identity, schema, and migration history", async () => {
    const columns = [
      { name: "id", dataType: "integer", udtName: "int4", isNullable: false, ordinalPosition: 1 },
      { name: "profile_id", dataType: "integer", udtName: "int4", isNullable: false, ordinalPosition: 2 },
    ];
    const migrationRows = [{
      migration_name: "20261006130000_unified_v4_glycogen_water_rollout",
      checksum: "migration-checksum",
      finished_at: "2026-10-06T11:00:00.000Z",
      rolled_back_at: null,
    }];
    const schemaSnapshot = [{ schema: "public", table: "profile", columns }];
    const expected = {
      schemaVersion: 1,
      logicalProductionDbIdentityDigest: "a".repeat(64),
      expectedSchemaDigest: canonicalDigest(schemaSnapshot),
      expectedMigrationHistoryDigest: canonicalDigest([{
        migrationName: migrationRows[0].migration_name,
        checksum: migrationRows[0].checksum,
        finishedAt: migrationRows[0].finished_at,
        rolledBackAt: null,
      }]),
      migrationNames: [migrationRows[0].migration_name],
      requiredRelations: [{ schema: "public", table: "profile", columns }],
    };
    const statements = [];
    const result = await verifyReadOnlySchemaCompatibility({
      expected,
      resolveLogicalDatabaseIdentity: async () => ({ identityDigest: "a".repeat(64), observationsDigest: "b".repeat(64) }),
      withReadOnlyTransaction: async (callback) => callback(async (sql) => {
        statements.push(sql);
        if (sql.startsWith("SELECT column_name")) return columns.map((column) => ({
          column_name: column.name, data_type: column.dataType, udt_name: column.udtName,
          is_nullable: column.isNullable ? "YES" : "NO", ordinal_position: column.ordinalPosition,
        }));
        if (sql.startsWith('SELECT migration_name')) return migrationRows;
        return [];
      }),
    });
    expect(result).toMatchObject({ schemaCompatible: true, requiredRelationsChecked: 1, migrationCount: 1 });
    expect(statements[0]).toBe("SET TRANSACTION READ ONLY");
    expect(statements.some((sql) => sql.includes('SELECT "id", "profile_id" FROM "public"."profile" LIMIT 0'))).toBe(true);
    await expect(verifyReadOnlySchemaCompatibility({
      expected: { ...expected, logicalProductionDbIdentityDigest: "f".repeat(64) },
      resolveLogicalDatabaseIdentity: async () => ({ identityDigest: "a".repeat(64) }),
      withReadOnlyTransaction: async (callback) => callback(async () => []),
    })).rejects.toThrow(/logical production database/);
    expect(() => quoteIdentifier('profile"; DROP TABLE profile;--', "table")).toThrow(/identifier/);
  });

  it("lets only a separately authenticated protected-environment review create policy attestations", async () => {
    const owner = generateKeyPairSync("ed25519");
    const policy = generateKeyPairSync("ed25519");
    const timestamp = "2026-10-07T12:00:00.000Z";
    const configurationSnapshot = {
      environment: "production-recovery", branchPolicy: "main-only", preventSelfReview: true,
      adminBypassDisabled: true, reviewers: ["12345"],
    };
    const workflow = {
      repository: "krustallik/body-model", ref: "refs/heads/main", canonicalMainSha: "a".repeat(40),
      environment: "production-recovery", workflowPath: ".github/workflows/production-recovery-phase-a.yml",
      workflowId: "901", workflowRunId: "902", workflowRunAttempt: "1", actorGithubUserId: "777",
    };
    const challengeWorkflow = { ...workflow, environment: undefined };
    const environment = {
      environment: "production-recovery", branchPolicy: "main-only", preventSelfReview: true,
      adminBypassDisabled: true, allowlistedReviewerGithubUserIds: ["12345"], configurationSnapshot,
    };
    const expectedDigest = canonicalDigest(configurationSnapshot);
    const challenges = new Map();
    const consumed = new Set();
    const service = createRecoveryPolicySignerService({
      verifyWorkflowOidc: async (token, options) => options.audience === "bodycast-production-recovery-policy"
        ? token === "valid-github-oidc-token" ? workflow : token === "challenge-github-oidc-token" ? challengeWorkflow : null : null,
      loadRecoveryCase: async (id) => ({ recoveryCaseId: id, phase: "A", canonicalMainSha: workflow.canonicalMainSha,
        repository: workflow.repository, status: "awaiting-owner-policy-review" }),
      readProtectedEnvironmentConfiguration: async () => environment,
      createPhaseChallenge: async (challenge, challengeDigest) => { challenges.set(challenge.challengeId, { challenge, challengeDigest }); return true; },
      loadPhaseChallenge: async (id) => challenges.get(id),
      loadAuthenticatedOwnerApproval: async ({ challenge }) => {
        const approvalBody = {
          schemaVersion: 1, purpose: "recovery-policy-owner-approval", recoveryCaseId: "case-001", phase: "A",
          repository: workflow.repository, canonicalMainSha: workflow.canonicalMainSha, environment: workflow.environment,
          workflowPath: workflow.workflowPath, workflowId: workflow.workflowId, workflowRunId: workflow.workflowRunId,
          workflowRunAttempt: workflow.workflowRunAttempt, reviewedConfigurationDigest: expectedDigest,
          reviewerGithubUserId: "12345", approvalState: "approved", approvalId: "deployment-approval-71",
          approvalTimestamp: timestamp, singleUseRequestId: challenge.singleUseRequestId,
          singleUseNonce: challenge.singleUseNonce, challengeId: challenge.challengeId,
          challengeDigest: challenge.challengeDigest, keyId: "owner-key",
        };
        return { ...approvalBody, signature: signCanonical(approvalBody, owner.privateKey) };
      },
      verifyAuthenticatedOwnerApproval: async ({ candidate }) => verifyCanonical(
        Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "signature")), candidate.signature, owner.publicKey,
      ),
      consumeSingleUseRequest: async ({ requestId, nonce }) => {
        const key = requestId + "\0" + nonce;
        if (consumed.has(key)) return false;
        consumed.add(key);
        return true;
      },
      policySigner: (body) => signCanonical(body, policy.privateKey),
      ownerApprovalPublicKeys: { "owner-key": owner.publicKey }, allowedReviewerIds: ["12345"],
      policyKeyId: "policy-key", signerName: "independent-policy-service", policyVersion: "1.0.0",
      repository: workflow.repository,
      phaseWorkflowBindings: { A: { workflowPath: workflow.workflowPath, workflowId: workflow.workflowId },
        B: { workflowPath: ".github/workflows/production-recovery-phase-b.yml", workflowId: "902" } },
      now: () => Date.parse(timestamp),
      createNonce: () => "c".repeat(64),
      createId: () => "challenge-unique-001",
    });
    const challengeResult = await service.createChallenge({
      schemaVersion: 1, purpose: "create-recovery-phase-challenge", oidcToken: "challenge-github-oidc-token",
      recoveryCaseId: "case-001", phase: "A",
    });
    const policyRequest = {
      schemaVersion: 1, purpose: "request-recovery-environment-policy", oidcToken: "valid-github-oidc-token",
      recoveryCaseId: "case-001", phase: "A", challengeId: challengeResult.challenge.challengeId,
      challengeDigest: challengeResult.challengeDigest,
    };
    const attestation = await service.issue(policyRequest);
    expect(attestation.phase).toBe("A");
    expect(attestation.reviewedConfigurationDigest).toBe(expectedDigest);
    expect(attestation.reviewedReviewerGithubUserId).toBe("12345");
    expect(verifyCanonical(Object.fromEntries(Object.entries(attestation).filter(([key]) => key !== "signature")),
      attestation.signature, policy.publicKey)).toBe(true);

    await expect(service.issue({ ...policyRequest, ownerApproval: { approved: true } })).rejects.toThrow(/closed schema/);
    await expect(service.issue({ ...policyRequest, oidcToken: "caller-made-approval-flag" })).rejects.toThrow(/canonical recovery phase/);
    expect(consumed.size).toBe(1);
    expect(attestation.singleUseNonce).toBe("c".repeat(64));
    expect(attestation.challengeDigest).toBe(challengeResult.challengeDigest);
    await expect(service.issue({ ...policyRequest, phase: "B" })).rejects.toThrow(/workflow|phase|case/i);
  });

  it("captures only the exact currently serving immutable rollback image and rejects rebuilds or retention gaps", () => {
    const imageDigest = "a".repeat(64);
    const observation = {
      containerId: "container-123",
      releaseShaLabel: "b".repeat(40),
      imageId: "sha256:" + "c".repeat(64),
      repositoryDigest: "ghcr.io/bodycast/app@sha256:" + imageDigest,
      artifactId: "oci://ghcr.io/bodycast/app@sha256:" + imageDigest,
      artifactDigest: imageDigest,
      composeProjectServiceIdentityDigest: "d".repeat(64),
      deployHostTopologyDigest: "e".repeat(64),
      capturedAt: "2026-10-07T12:00:00.000Z",
      retainedUntil: "2026-11-07T12:00:00.000Z",
    };
    const captured = captureImmutableRollbackArtifact(observation, {
      failedReleaseSha: "f".repeat(40), expectedRollbackAppSha: observation.releaseShaLabel,
      recoveryMustRemainAvailableUntil: "2026-10-20T12:00:00.000Z",
    });
    expect(captured).toMatchObject({
      failedReleaseSha: "f".repeat(40), rollbackAppSha: observation.releaseShaLabel,
      rollbackArtifactId: observation.artifactId, rollbackArtifactDigest: imageDigest,
    });
    expect(assertExactRollbackArtifact(captured, { ...captured })).toBe(true);
    expect(() => assertExactRollbackArtifact(captured, { ...captured, rollbackImageId: "sha256:" + "9".repeat(64) }))
      .toThrow(/rebuilt images/);
    expect(() => captureImmutableRollbackArtifact({ ...observation, releaseShaLabel: "1".repeat(40) }, {
      failedReleaseSha: "f".repeat(40), expectedRollbackAppSha: observation.releaseShaLabel,
      recoveryMustRemainAvailableUntil: "2026-10-20T12:00:00.000Z",
    })).toThrow(/pre-maintenance SHA/);
    expect(() => captureImmutableRollbackArtifact({ ...observation, retainedUntil: "2026-10-08T00:00:00.000Z" }, {
      failedReleaseSha: "f".repeat(40), expectedRollbackAppSha: observation.releaseShaLabel,
      recoveryMustRemainAvailableUntil: "2026-10-20T12:00:00.000Z",
    })).toThrow(/retention expires/);
  });

  it("binds restore to the same logical DB identity while treating IP, port, and server version as observations", () => {
    const identity = {
      deployRootIdentity: "deploy-root-1", hostTopologyIdentity: "host-prod-1", composeProjectIdentity: "bodycast-prod",
      composeConfigurationDigest: "a".repeat(64), databaseService: "db", storageVolumeIdentity: "volume-prod-1",
      databaseName: "bodycast", applicationRoleIdentity: "bodycast-app", recoveryReadOnlyRoleIdentity: "bodycast-recovery-readonly",
      backendNetworkIdentity: "bodycast-backend-prod", applicationDatabaseBindingDigest: "b".repeat(64),
    };
    const digest = createLogicalDatabaseIdentity(identity).identityDigest;
    const result = verifySameLogicalDatabaseIdentity(identity, {
      ...identity, databaseOid: 12345, host: "10.0.0.10", port: 5432, serverVersion: "16.3",
    });
    expect(result.identityDigest).toBe(digest);
    expect(result.observationsDigest).toBe(canonicalDigest({ databaseOid: 12345, host: "10.0.0.10", port: 5432, serverVersion: "16.3" }));
    expect(() => verifySameLogicalDatabaseIdentity(identity, { ...identity, storageVolumeIdentity: "different-volume" }))
      .toThrow(/same logical in-place/);
    expect(() => verifySameLogicalDatabaseIdentity(identity, { ...identity, hostnameOverride: "untrusted" }))
      .toThrow(/unsupported fields/);
  });

  it("requires two stable PostgreSQL writer-free observations after stopping the read-only app", async () => {
    const logicalIdentity = { deploy: "stable" };
    const topology = { backend: "prod-network" };
    let observation = 0;
    let stopped = false;
    const sample = (count) => ({
      schemaVersion: 1, purpose: "recovery-writer-drain", logicalProductionDbIdentityDigest: "a".repeat(64),
      topologyDigest: "b".repeat(64), observedAt: "2026-10-07T12:00:00.000Z", appContainerStopped: true,
      readOnlyRecoveryAppStopped: true, restartDisabled: true, activeAppWriterSessions: 0,
      readOnlyRecoveryAppSessions: 0, otherDatabaseWriters: count, writerRoleIdentity: "bodycast-app",
      observationSequence: ++observation, logicalIdentity, topology,
    });
    const makeDrain = (writerCounts) => {
      let sampleIndex = 0;
      return createWriterDrainVerifier({
        stopReadOnlyApp: async ({ expectedContainerId, restartDisabled }) => { stopped = expectedContainerId === "container" && restartDisabled; },
        observePostgres: async () => sample(writerCounts[sampleIndex++]),
        recheckTopology: async () => topology,
        waitForStableSample: async () => {},
      });
    };
    const result = await makeDrain([0, 0])({
      rollbackContainerId: "container", logicalProductionDbIdentityDigest: "a".repeat(64),
      topologyDigest: "b".repeat(64), expectedWriterRoleIdentity: "bodycast-app",
      now: Date.parse("2026-10-07T12:00:00.000Z"),
    });
    expect(stopped).toBe(true);
    expect(result.observationSequence).toBe(2);

    const reconnect = {
      schemaVersion: 1, purpose: "recovery-writer-drain", logicalProductionDbIdentityDigest: "a".repeat(64),
      topologyDigest: "b".repeat(64), observedAt: "2026-10-07T12:00:00.000Z", appContainerStopped: true,
      readOnlyRecoveryAppStopped: true, restartDisabled: true, activeAppWriterSessions: 0,
      readOnlyRecoveryAppSessions: 0, otherDatabaseWriters: 1, writerRoleIdentity: "bodycast-app", observationSequence: 2,
    };
    expect(() => verifyWriterDrainEvidence(reconnect, {
      logicalProductionDbIdentityDigest: "a".repeat(64), topologyDigest: "b".repeat(64),
      expectedWriterRoleIdentity: "bodycast-app", now: Date.parse("2026-10-07T12:00:00.000Z"),
    })).toThrow(/active database writer/);
    observation = 0;
    await expect(makeDrain([0, 1])({
      rollbackContainerId: "container", logicalProductionDbIdentityDigest: "a".repeat(64),
      topologyDigest: "b".repeat(64), expectedWriterRoleIdentity: "bodycast-app",
      now: Date.parse("2026-10-07T12:00:00.000Z"),
    })).rejects.toThrow(/active database writer/);
  });
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
