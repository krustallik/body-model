import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  canonicalDigest,
  canonicalJson,
  sha256Hex,
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
} from "../scripts/production-recovery/journal.mjs";

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

function makeRecord(signing) {
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
    journalSchemaVersion: 1,
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
    legacyMarkerDigest: "6".repeat(64),
    legacyMarkerState: "ddl-started",
    transition: "bootstrap-failed-release",
    phase: null,
    authorizationId: null,
    authorizationEnvelopeDigest: null,
    policyAttestationDigest: null,
    nonceConsumption: null,
    restoreGrant: null,
    sourceEvidenceDigest: "5".repeat(64),
    workflowProvenance: { repository: "krustallik/body-model" },
    timestamp: "2026-10-07T00:00:00.000Z",
  }, signing);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("production recovery canonical and journal authority", () => {
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
