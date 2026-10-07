import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertGitSha,
  assertExactKeys,
  assertNonEmptyString,
  assertSha256,
  assertUtcTimestamp,
  canonicalDigest,
  canonicalJson,
  omitFields,
  sha256Hex,
  signCanonical,
  verifyCanonical,
} from "./canonical.mjs";
import { isAllowedJournalTransition, JOURNAL_GENESIS_DIGEST, RECOVERY_STATES } from "./schemas.mjs";

const RECORD_NAME = /^generation-(\d{20})\.json$/;
const DIRECTORY_MUTEXES = new Map();
const LOCK_KEYS = Object.freeze(["schemaVersion", "pid", "token"]);
const JOURNAL_RECORD_KEYS = Object.freeze([
  "journalSchemaVersion", "generation", "priorGeneration", "priorRecordDigest", "priorState", "nextState",
  "canonicalMainSha", "recoveryCaseId", "manifestId", "failedReleaseSha", "rollbackAppSha", "immutableRollbackArtifact",
  "logicalProductionDbIdentityDigest", "composeProjectServiceIdentityDigest", "deployHostTopologyDigest",
  "markerReaderRolloutReceiptDigest", "legacyMarkerDigest", "legacyMarkerState", "transition", "phase",
  "authorizationId", "authorizationEnvelopeDigest", "policyAttestationDigest", "nonceConsumption", "restoreGrant",
  "sourceEvidenceDigest", "operationIntent", "operationEvidenceId", "workflowProvenance", "timestamp", "authorityVersion", "authorityKeyId",
  "authorityInstanceId", "recordDigest", "authoritySignature",
]);
const ARTIFACT_KEYS = Object.freeze([
  "failedReleaseSha", "rollbackAppSha", "rollbackContainerId", "rollbackImageId", "rollbackImageDigest",
  "rollbackArtifactId", "rollbackArtifactDigest", "rollbackCaptureAttestationDigest",
  "composeProjectServiceIdentityDigest", "deployHostTopologyDigest",
]);
const GRANT_KEYS = Object.freeze([
  "purpose", "authorizationId", "recoveryCaseId", "manifestId", "phaseAPolicyDigest", "phaseAEnvelopeDigest",
  "failedReleaseSha", "rollbackAppSha", "rollbackContainerId", "rollbackImageId", "rollbackImageDigest",
  "rollbackArtifactId", "rollbackArtifactDigest", "rollbackArtifact", "logicalProductionDbIdentityDigest",
  "expiresAt", "consumedNonceDigests",
]);
const MARKER_KEYS = Object.freeze([
  "schemaVersion", "journalGeneration", "journalRecordDigest", "state", "manifestId", "failedReleaseSha",
  "rollbackAppSha", "markerDigest",
]);

function isNoFollowAvailable() {
  return typeof fsConstants.O_NOFOLLOW === "number";
}

async function lstatRequired(filePath, label) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(label + " does not exist.");
    throw error;
  }
}

export async function assertSafePath(filePath, { allowMissingLeaf = false, requireRoot = false, privateMode = false } = {}) {
  const absolute = path.resolve(filePath);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT" && allowMissingLeaf && index === segments.length - 1) return absolute;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error("Symlink path is not allowed: " + current + ".");
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error("Path parent is not a directory: " + current + ".");
    if (index === segments.length - 1 && stat.isDirectory() === false && index < segments.length - 1) {
      throw new Error("Unsafe path component: " + current + ".");
    }
    if (requireRoot && process.platform !== "win32" && stat.uid !== 0) throw new Error("Path is not root-owned: " + current + ".");
    if (privateMode && process.platform !== "win32" && index === segments.length - 1 && (stat.mode & 0o077) !== 0) {
      throw new Error("Private state path must not grant group/other access.");
    }
  }
  if (!isNoFollowAvailable() && process.platform !== "win32") throw new Error("O_NOFOLLOW is unavailable.");
  return absolute;
}

async function fsyncDirectory(directory) {
  const handle = await fs.open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function generationName(generation) {
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("Journal generation must be a positive safe integer.");
  return "generation-" + String(generation).padStart(20, "0") + ".json";
}

function unsignedRecord(record) {
  return omitFields(record, ["recordDigest", "authoritySignature"]);
}

function recordSignaturePayload(record) {
  return {
    recordDigest: record.recordDigest,
    generation: record.generation,
    authorityVersion: record.authorityVersion,
    authorityKeyId: record.authorityKeyId,
    authorityInstanceId: record.authorityInstanceId,
  };
}

function verifyRecord(record, publicKeys) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Journal record must be an object.");
  assertExactKeys(record, JOURNAL_RECORD_KEYS, "Journal record");
  if (record.journalSchemaVersion !== 1 || !Number.isSafeInteger(record.generation) || record.generation < 1
    || !Number.isSafeInteger(record.priorGeneration) || record.priorGeneration < 0) throw new Error("Journal schema or generation is invalid.");
  assertGitSha(record.failedReleaseSha, "journal.failedReleaseSha");
  assertGitSha(record.rollbackAppSha, "journal.rollbackAppSha");
  assertGitSha(record.canonicalMainSha, "journal.canonicalMainSha");
  for (const key of ["priorRecordDigest", "logicalProductionDbIdentityDigest", "composeProjectServiceIdentityDigest", "deployHostTopologyDigest",
    "markerReaderRolloutReceiptDigest", "legacyMarkerDigest", "sourceEvidenceDigest"]) assertSha256(record[key], "journal." + key);
  assertExactKeys(record.immutableRollbackArtifact, ARTIFACT_KEYS, "Immutable rollback artifact");
  assertGitSha(record.immutableRollbackArtifact.failedReleaseSha, "artifact.failedReleaseSha");
  assertGitSha(record.immutableRollbackArtifact.rollbackAppSha, "artifact.rollbackAppSha");
  for (const key of ["rollbackImageDigest", "rollbackArtifactDigest", "rollbackCaptureAttestationDigest",
    "composeProjectServiceIdentityDigest", "deployHostTopologyDigest"]) assertSha256(record.immutableRollbackArtifact[key], "artifact." + key);
  if (record.immutableRollbackArtifact.failedReleaseSha !== record.failedReleaseSha
    || record.immutableRollbackArtifact.rollbackAppSha !== record.rollbackAppSha) throw new Error("Journal artifact release bindings are inconsistent.");
  assertUtcTimestamp(record.timestamp, "journal.timestamp");
  if (record.priorState !== null && !RECOVERY_STATES.includes(record.priorState)) throw new Error("Journal prior state is unsupported.");
  if (record.phase !== null && record.phase !== "A" && record.phase !== "B") throw new Error("Journal phase is unsupported.");
  if (record.nonceConsumption !== null) {
    assertExactKeys(record.nonceConsumption, ["items"], "Journal nonce consumption");
    if (!Array.isArray(record.nonceConsumption.items) || record.nonceConsumption.items.length < 2) throw new Error("Journal nonce consumption is incomplete.");
    const nonceDigests = new Set();
    for (const item of record.nonceConsumption.items) {
      assertExactKeys(item, ["purpose", "nonceDigest", "authorizationId"], "Consumed authorization nonce");
      assertNonEmptyString(item.purpose, "nonce.purpose");
      assertSha256(item.nonceDigest, "nonce.nonceDigest");
      assertNonEmptyString(item.authorizationId, "nonce.authorizationId");
      if (nonceDigests.has(item.nonceDigest)) throw new Error("Journal record repeats a consumed nonce.");
      nonceDigests.add(item.nonceDigest);
    }
  }
  if (record.restoreGrant !== null) {
    assertExactKeys(record.restoreGrant, GRANT_KEYS, "Persisted restore grant");
    if (record.restoreGrant.purpose !== "restore-only" || record.restoreGrant.authorizationId.length === 0) throw new Error("Persisted restore grant is malformed.");
    assertUtcTimestamp(record.restoreGrant.expiresAt, "restoreGrant.expiresAt");
    assertExactKeys(record.restoreGrant.rollbackArtifact, ARTIFACT_KEYS, "Persisted rollback artifact");
    if (!Array.isArray(record.restoreGrant.consumedNonceDigests) || record.restoreGrant.consumedNonceDigests.length !== 2) {
      throw new Error("Persisted restore grant nonce binding is incomplete.");
    }
    for (const digest of record.restoreGrant.consumedNonceDigests) assertSha256(digest, "restoreGrant.consumedNonceDigest");
  }
  for (const key of ["authorizationEnvelopeDigest", "policyAttestationDigest"]) {
    if (record[key] !== null) assertSha256(record[key], "journal." + key);
  }
  if (record.operationIntent !== null) {
    assertExactKeys(record.operationIntent, ["schemaVersion", "operationId", "operationType", "operationInputDigest"], "Journal operation intent");
    if (record.operationIntent.schemaVersion !== 1) throw new Error("Journal operation intent schema is unsupported.");
    assertSha256(record.operationIntent.operationId, "journal.operationIntent.operationId");
    assertNonEmptyString(record.operationIntent.operationType, "journal.operationIntent.operationType");
    assertSha256(record.operationIntent.operationInputDigest, "journal.operationIntent.operationInputDigest");
    if (record.operationEvidenceId !== null) assertNonEmptyString(record.operationEvidenceId, "journal.operationEvidenceId");
  } else if (record.operationEvidenceId !== null) throw new Error("Journal operation evidence cannot exist without an operation intent.");
  for (const key of ["recoveryCaseId", "manifestId", "legacyMarkerState", "transition", "authorityVersion", "authorityKeyId", "authorityInstanceId", "authoritySignature"]) {
    assertNonEmptyString(record[key], "journal." + key);
  }
  const expectedDigest = canonicalDigest(unsignedRecord(record));
  if (record.recordDigest !== expectedDigest) throw new Error("Journal record digest is invalid.");
  if (typeof record.authorityKeyId !== "string" || !publicKeys?.[record.authorityKeyId]) {
    throw new Error("Journal authority key is not trusted.");
  }
  if (!verifyCanonical(recordSignaturePayload(record), record.authoritySignature, publicKeys[record.authorityKeyId])) {
    throw new Error("Journal authority signature is invalid.");
  }
  if (!RECOVERY_STATES.includes(record.nextState)) throw new Error("Journal state is unsupported.");
  if ((record.transition === "authorize-restore" && record.phase !== "A")
    || (record.transition === "authorize-recovery" && record.phase !== "B")
    || (!new Set(["authorize-restore", "authorize-recovery"]).has(record.transition) && record.phase !== null)) {
    throw new Error("Journal transition and authorization phase disagree.");
  }
  if (new Set(["authorize-restore", "authorize-recovery"]).has(record.transition)
    && (!record.authorizationId || !record.authorizationEnvelopeDigest || !record.policyAttestationDigest || !record.nonceConsumption)) {
    throw new Error("Authorization transition lacks its committed envelope, policy, or nonce evidence.");
  }
  return record;
}

export async function readJournal(journalDirectory, { publicKeys, requireRoot = false } = {}) {
  const directory = await assertSafePath(journalDirectory, { requireRoot, privateMode: requireRoot });
  const names = await fs.readdir(directory);
  const generations = [];
  for (const name of names) {
    const match = RECORD_NAME.exec(name);
    if (match) generations.push({ name, generation: Number(match[1]) });
    else if (name.startsWith("generation-")) throw new Error("Journal contains an invalid generation filename.");
  }
  generations.sort((a, b) => a.generation - b.generation);
  let previous = null;
  for (let index = 0; index < generations.length; index += 1) {
    const entry = generations[index];
    const expectedGeneration = index + 1;
    if (entry.generation !== expectedGeneration) throw new Error("Journal generation chain has a gap or duplicate.");
    const filePath = path.join(directory, entry.name);
    const stat = await lstatRequired(filePath, "Journal generation");
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Journal generation is not a regular file.");
    if (requireRoot && process.platform !== "win32" && stat.uid !== 0) throw new Error("Journal generation is not root-owned.");
    const bytes = await fs.readFile(filePath);
    const record = JSON.parse(bytes.toString("utf8"));
    if (canonicalJson(record) !== bytes.toString("utf8")) throw new Error("Journal generation is not canonically encoded.");
    verifyRecord(record, publicKeys);
    if (record.generation !== expectedGeneration) throw new Error("Journal filename and generation disagree.");
    const priorGeneration = previous?.generation ?? 0;
    const priorDigest = previous?.recordDigest ?? JOURNAL_GENESIS_DIGEST;
    const priorState = previous?.nextState ?? null;
    if (record.priorGeneration !== priorGeneration || record.priorRecordDigest !== priorDigest) {
      throw new Error("Journal predecessor binding is invalid.");
    }
    if (record.priorState !== priorState) throw new Error("Journal prior state is invalid.");
    if (!isAllowedJournalTransition(record.transition, record.priorState, record.nextState)) {
      throw new Error("Journal contains a skipped, backward, or unsupported state transition.");
    }
    if (previous && (
      record.canonicalMainSha !== previous.canonicalMainSha
      || record.recoveryCaseId !== previous.recoveryCaseId
      || record.markerReaderRolloutReceiptDigest !== previous.markerReaderRolloutReceiptDigest
      || record.legacyMarkerDigest !== previous.legacyMarkerDigest
      || record.legacyMarkerState !== previous.legacyMarkerState
      || record.failedReleaseSha !== previous.failedReleaseSha
      || record.rollbackAppSha !== previous.rollbackAppSha
      || record.logicalProductionDbIdentityDigest !== previous.logicalProductionDbIdentityDigest
      || canonicalJson(record.immutableRollbackArtifact) !== canonicalJson(previous.immutableRollbackArtifact)
      || record.manifestId !== previous.manifestId
    )) throw new Error("Journal recovery bindings changed within the chain.");
    previous = record;
  }
  return { directory, records: generations.length, tail: previous };
}

async function acquireExclusiveLock(lockPath, { requireRoot = false, syncDirectory = fsyncDirectory } = {}) {
  const absolute = await assertSafePath(lockPath, { allowMissingLeaf: true, requireRoot });
  const parent = path.dirname(absolute);
  const token = randomUUID();
  let handle;
  try {
    handle = await fs.open(absolute,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    // A stale lock is deliberately not reaped here: checking PID liveness and
    // unlinking a shared lock path has a TOCTOU race between contenders. A host
    // owner must inspect and recover a stranded lock under the separate procedure.
    const stat = await lstatRequired(absolute, "Recovery lock");
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Recovery lock path is unsafe.");
    try {
      const lock = JSON.parse(await fs.readFile(absolute, "utf8"));
      assertExactKeys(lock, LOCK_KEYS, "Recovery lock");
      if (lock.schemaVersion !== 1 || !Number.isSafeInteger(lock.pid) || typeof lock.token !== "string") {
        throw new Error("Recovery lock is malformed.");
      }
    } catch (lockError) {
      throw new Error("Recovery lock exists and is invalid; authority operations remain blocked: " + lockError.message);
    }
    throw new Error("Another or stranded recovery authority operation holds the exclusive lock; manual reviewed recovery is required.");
  }
  const lock = { schemaVersion: 1, pid: process.pid, token };
  try {
    await handle.writeFile(canonicalJson(lock));
    await handle.sync();
    await syncDirectory(parent);
    return { absolute, parent, handle, token, syncDirectory };
  } catch (error) {
    await handle.close();
    await fs.rm(absolute, { force: true });
    await syncDirectory(parent);
    throw error;
  }
}

async function releaseExclusiveLock(lock) {
  await lock.handle.close();
  try {
    const current = JSON.parse(await fs.readFile(lock.absolute, "utf8"));
    if (current.token !== lock.token) throw new Error("Recovery lock ownership changed.");
    await fs.unlink(lock.absolute);
    await lock.syncDirectory(lock.parent);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function withExclusiveRecoveryLock(lockPath, operation, options = {}) {
  const key = path.resolve(lockPath);
  const previous = DIRECTORY_MUTEXES.get(key) ?? Promise.resolve();
  let unlock;
  const current = new Promise((resolve) => { unlock = resolve; });
  const queueEntry = previous.then(() => current);
  DIRECTORY_MUTEXES.set(key, queueEntry);
  await previous;
  let lock;
  try {
    lock = await acquireExclusiveLock(key, options);
    return await operation();
  } finally {
    if (lock) await releaseExclusiveLock(lock);
    unlock();
    if (DIRECTORY_MUTEXES.get(key) === queueEntry) DIRECTORY_MUTEXES.delete(key);
  }
}

export async function verifyJournalFilesystemCapabilities(directory, { syncDirectory = fsyncDirectory } = {}) {
  const target = await assertSafePath(directory);
  const nonce = randomUUID();
  const temp = path.join(target, ".capability-" + nonce + ".tmp");
  const linked = path.join(target, ".capability-" + nonce + ".link");
  let handle;
  try {
    handle = await fs.open(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile("bodycast-recovery-fs-capability\n");
    await handle.sync();
    await fs.link(temp, linked);
    await syncDirectory(target);
    const bytes = await fs.readFile(linked, "utf8");
    if (bytes !== "bodycast-recovery-fs-capability\n") throw new Error("Hard-link probe content did not match.");
    let duplicateRejected = false;
    try {
      await fs.link(temp, linked);
    } catch (error) {
      duplicateRejected = error?.code === "EEXIST";
    }
    if (!duplicateRejected) throw new Error("Hard-link creation did not reject an existing final path.");
    return { sameFilesystem: true, hardLinks: true, oExcl: true, fileFsync: true, directoryFsync: true };
  } finally {
    await handle?.close();
    await fs.rm(temp, { force: true });
    await fs.rm(linked, { force: true });
    await syncDirectory(target);
  }
}

export function createSignedJournalRecord(fields, {
  privateKey,
  authorityVersion,
  authorityKeyId,
  authorityInstanceId,
}) {
  const record = {
    operationIntent: null,
    operationEvidenceId: null,
    ...fields,
    authorityVersion,
    authorityKeyId,
    authorityInstanceId,
  };
  record.recordDigest = canonicalDigest(record);
  record.authoritySignature = signCanonical(recordSignaturePayload(record), privateKey);
  return record;
}

export async function commitJournalRecord(journalDirectory, record, { publicKeys, requireRoot = false, syncDirectory = fsyncDirectory } = {}) {
  const directory = await assertSafePath(journalDirectory, { requireRoot, privateMode: requireRoot });
  const verified = verifyRecord(record, publicKeys);
  const finalPath = path.join(directory, generationName(verified.generation));
  const existing = await fs.lstat(finalPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("Existing journal generation path is unsafe.");
    throw Object.assign(new Error("Journal generation already exists; refusing overwrite."), { code: "EEXIST" });
  }
  const tempPath = path.join(directory, ".generation-" + String(verified.generation).padStart(20, "0") + "-" + randomUUID() + ".tmp");
  let handle;
  try {
    handle = await fs.open(tempPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(canonicalJson(verified));
    await handle.sync();
    await fs.link(tempPath, finalPath);
    await syncDirectory(directory);
    return { finalPath, record: verified };
  } finally {
    await handle?.close();
    await fs.rm(tempPath, { force: true });
    await syncDirectory(directory);
  }
}

function markerBodyFromRecord(record) {
  const marker = {
    schemaVersion: 2,
    journalGeneration: record.generation,
    journalRecordDigest: record.recordDigest,
    state: record.nextState,
    manifestId: record.manifestId,
    failedReleaseSha: record.failedReleaseSha,
    rollbackAppSha: record.rollbackAppSha,
  };
  marker.markerDigest = canonicalDigest(marker);
  return marker;
}

export async function writeMarkerProjection(markerPath, record, { requireRoot = false, syncDirectory = fsyncDirectory } = {}) {
  const absolute = await assertSafePath(markerPath, { allowMissingLeaf: true, requireRoot });
  const parent = path.dirname(absolute);
  const current = await fs.lstat(absolute).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (current && (!current.isFile() || current.isSymbolicLink())) throw new Error("Marker projection path is unsafe.");
  const marker = markerBodyFromRecord(record);
  const tempPath = absolute + ".tmp-" + randomUUID();
  let handle;
  try {
    handle = await fs.open(tempPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(canonicalJson(marker));
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, absolute);
    await syncDirectory(parent);
    return marker;
  } finally {
    await handle?.close();
    await fs.rm(tempPath, { force: true });
  }
}

export async function readMarkerProjection(markerPath, journalTail, { requireRoot = false } = {}) {
  let stat;
  try {
    stat = await fs.lstat(markerPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { absent: true, blocking: false };
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Existing marker path is not a regular file.");
  if (requireRoot && process.platform !== "win32" && stat.uid !== 0) throw new Error("Marker projection is not root-owned.");
  const bytes = await fs.readFile(markerPath, "utf8");
  const marker = JSON.parse(bytes);
  assertExactKeys(marker, MARKER_KEYS, "Marker projection");
  if (canonicalJson(marker) !== bytes) throw new Error("Marker projection is not canonically encoded.");
  if (marker.schemaVersion !== 2 || !Number.isSafeInteger(marker.journalGeneration) || marker.journalGeneration < 1) {
    throw new Error("Marker projection schema or generation is unsupported.");
  }
  assertSha256(marker.journalRecordDigest, "marker.journalRecordDigest");
  assertGitSha(marker.failedReleaseSha, "marker.failedReleaseSha");
  assertGitSha(marker.rollbackAppSha, "marker.rollbackAppSha");
  assertNonEmptyString(marker.manifestId, "marker.manifestId");
  const unsigned = omitFields(marker, ["markerDigest"]);
  if (canonicalDigest(unsigned) !== marker.markerDigest) throw new Error("Marker projection digest is invalid.");
  if (!RECOVERY_STATES.includes(marker.state)) throw new Error("Marker projection state is unsupported.");
  if (!journalTail || marker.journalGeneration !== journalTail.generation || marker.journalRecordDigest !== journalTail.recordDigest
    || marker.state !== journalTail.nextState || marker.failedReleaseSha !== journalTail.failedReleaseSha
    || marker.rollbackAppSha !== journalTail.rollbackAppSha || marker.manifestId !== journalTail.manifestId) {
    throw new Error("Marker projection does not match the authoritative journal tail.");
  }
  return { absent: false, blocking: true, marker };
}

export async function removeMarkerProjection(markerPath, expectedMarker, { requireRoot = false, syncDirectory = fsyncDirectory } = {}) {
  const absolute = await assertSafePath(markerPath, { requireRoot });
  const parent = path.dirname(absolute);
  const stat = await lstatRequired(absolute, "Active marker projection");
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Marker projection path is unsafe.");
  const current = JSON.parse(await fs.readFile(absolute, "utf8"));
  if (canonicalJson(current) !== canonicalJson(expectedMarker)) throw new Error("Active marker changed before finalization.");
  await fs.unlink(absolute);
  await syncDirectory(parent);
}

export async function writeImmutableReceipt(directory, name, receipt, { privateKey, publicKeys, requireRoot = false, syncDirectory = fsyncDirectory } = {}) {
  if (!/^[a-z0-9][a-z0-9.-]{0,127}\.json$/.test(name)) throw new Error("Receipt name is invalid.");
  const absoluteDirectory = await assertSafePath(directory, { requireRoot, privateMode: requireRoot });
  const finalPath = path.join(absoluteDirectory, name);
  const existing = await fs.lstat(finalPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("Existing receipt path is unsafe.");
    const bytes = await fs.readFile(finalPath);
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (canonicalJson(parsed) !== bytes.toString("utf8")) throw new Error("Existing receipt is not canonical.");
    if (canonicalDigest(omitFields(parsed, ["receiptDigest", "authoritySignature"])) !== canonicalDigest(receipt)) {
      throw new Error("Existing receipt name is bound to different completion evidence.");
    }
    if (canonicalDigest(omitFields(parsed, ["receiptDigest", "authoritySignature"])) !== parsed.receiptDigest) {
      throw new Error("Existing receipt digest is invalid.");
    }
    if (publicKeys && !verifyCanonical({
      receiptDigest: parsed.receiptDigest,
      authorityKeyId: parsed.authorityKeyId,
      authorityInstanceId: parsed.authorityInstanceId,
    }, parsed.authoritySignature, publicKeys[parsed.authorityKeyId])) throw new Error("Existing receipt signature is invalid.");
    return { finalPath, receipt: parsed, existing: true };
  }
  const signed = { ...receipt };
  signed.receiptDigest = canonicalDigest(signed);
  signed.authoritySignature = signCanonical({
    receiptDigest: signed.receiptDigest,
    authorityKeyId: signed.authorityKeyId,
    authorityInstanceId: signed.authorityInstanceId,
  }, privateKey);
  const tempPath = path.join(absoluteDirectory, ".receipt-" + randomUUID() + ".tmp");
  let handle;
  try {
    handle = await fs.open(tempPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(canonicalJson(signed));
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.link(tempPath, finalPath);
    await syncDirectory(absoluteDirectory);
    return { finalPath, receipt: signed, existing: false };
  } finally {
    await handle?.close();
    await fs.rm(tempPath, { force: true });
    await syncDirectory(absoluteDirectory);
  }
}

export function verifyImmutableReceipt(receipt, publicKeys) {
  if (!receipt || typeof receipt !== "object") throw new Error("Receipt is malformed.");
  const digest = canonicalDigest(omitFields(receipt, ["receiptDigest", "authoritySignature"]));
  if (receipt.receiptDigest !== digest) throw new Error("Receipt digest is invalid.");
  if (!verifyCanonical({
    receiptDigest: receipt.receiptDigest,
    authorityKeyId: receipt.authorityKeyId,
    authorityInstanceId: receipt.authorityInstanceId,
  }, receipt.authoritySignature, publicKeys?.[receipt.authorityKeyId])) {
    throw new Error("Receipt authority signature is invalid.");
  }
  return true;
}

export function digestFileContents(bytes) {
  return sha256Hex(bytes);
}

export { RECORD_NAME, MARKER_KEYS, fsyncDirectory };
