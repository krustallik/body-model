import path from "node:path";
import fs from "node:fs/promises";
import { assertExactKeys, assertSha256, canonicalDigest, sha256Hex } from "./canonical.mjs";
import {
  commitJournalRecord,
  createSignedJournalRecord,
  readJournal,
  readMarkerProjection,
  removeMarkerProjection,
  withExclusiveRecoveryLock,
  writeImmutableReceipt,
  writeMarkerProjection,
  verifyImmutableReceipt,
  verifyJournalFilesystemCapabilities,
} from "./journal.mjs";
import {
  JOURNAL_GENESIS_DIGEST,
} from "./schemas.mjs";
import { verifyAuthorizationEnvelope } from "./authorization.mjs";

const FAILED_NORMAL_STATES = new Set(["ddl-started", "schema-applied", "app-ready"]);
const TRANSITIONS = Object.freeze({
  "authorize-restore": { from: FAILED_NORMAL_STATES, to: "restore-authorized", phase: "A" },
  "begin-restore": { from: new Set(["restore-authorized"]), to: "restore-in-progress" },
  "verify-restore": { from: new Set(["restore-in-progress"]), to: "restore-verified" },
  "authorize-recovery": { from: new Set(["restore-verified"]), to: "recovery-authorized", phase: "B" },
  "mark-rollback-app-ready": { from: new Set(["recovery-authorized"]), to: "rollback-app-ready" },
  "enable-writers": { from: new Set(["rollback-app-ready"]), to: "writers-enabled" },
  "complete-recovery": { from: new Set(["writers-enabled"]), to: "recovery-complete" },
  "open-traffic": { from: new Set(["recovery-complete"]), to: "traffic-open" },
  "finalize-recovery": { from: new Set(["traffic-open"]), to: "recovery-finalized" },
});
const RECOVERY_OPERATION_TYPES = Object.freeze({
  "begin-restore": "recovery-restore-in-place",
  "mark-rollback-app-ready": "recovery-start-readonly-app",
  "enable-writers": "recovery-drain-and-enable-writers",
  "complete-recovery": "recovery-verify-completion-gates",
  "open-traffic": "recovery-open-traffic",
});

const BASE_BINDINGS = Object.freeze([
  "canonicalMainSha", "recoveryCaseId", "manifestId", "failedReleaseSha", "rollbackAppSha", "immutableRollbackArtifact",
  "logicalProductionDbIdentityDigest", "composeProjectServiceIdentityDigest", "deployHostTopologyDigest",
  "markerReaderRolloutReceiptDigest", "legacyMarkerDigest", "legacyMarkerState",
]);

function timestamp(now) {
  return new Date(now).toISOString();
}

function stableBindings(value) {
  const result = {};
  for (const key of BASE_BINDINGS) {
    if (value?.[key] === undefined) throw new Error("Missing authoritative recovery binding: " + key + ".");
    result[key] = value[key];
  }
  return result;
}

function currentState(tail) {
  return tail?.nextState ?? null;
}

function assertExpectedHead(request, tail) {
  const expectedGeneration = tail?.generation ?? 0;
  const expectedDigest = tail?.recordDigest ?? JOURNAL_GENESIS_DIGEST;
  if (request.expectedGeneration !== expectedGeneration || request.expectedRecordDigest !== expectedDigest) {
    throw new Error("Recovery request does not match the authoritative journal predecessor.");
  }
}

function assertEvidenceType(evidence, expectedType) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || evidence.type !== expectedType) {
    throw new Error("Typed source evidence is required for " + expectedType + ".");
  }
}

function consumedNonceDigests(records) {
  const result = new Set();
  for (const record of records) {
    for (const item of record.nonceConsumption?.items ?? []) result.add(item.nonceDigest);
  }
  return result;
}

function authorizationNonceItems(phase, envelope) {
  const claims = envelope.claims;
  const policyNonce = phase === "A" ? claims.phaseAPolicyAttestationNonce : claims.phaseBPolicyAttestationNonce;
  return [
    { purpose: "recovery-phase-" + phase.toLowerCase(), nonceDigest: sha256Hex(claims.nonce), authorizationId: claims.authorizationId },
    { purpose: "environment-policy-phase-" + phase.toLowerCase(), nonceDigest: sha256Hex(policyNonce), authorizationId: claims.authorizationId },
  ];
}

function makeGrant(verified, nonceItems) {
  const claims = verified.claims;
  return {
    purpose: "restore-only",
    authorizationId: claims.authorizationId,
    recoveryCaseId: claims.recoveryCaseId,
    manifestId: claims.manifestId,
    phaseAPolicyDigest: verified.policyDigest,
    phaseAEnvelopeDigest: verified.envelopeDigest,
    failedReleaseSha: claims.failedReleaseSha,
    rollbackAppSha: claims.rollbackAppSha,
    rollbackContainerId: claims.rollbackContainerId,
    rollbackImageId: claims.rollbackImageId,
    rollbackImageDigest: claims.rollbackImageDigest,
    rollbackArtifactId: claims.rollbackArtifactId,
    rollbackArtifactDigest: claims.rollbackArtifactDigest,
    rollbackArtifact: {
      failedReleaseSha: claims.failedReleaseSha,
      rollbackAppSha: claims.rollbackAppSha,
      rollbackContainerId: claims.rollbackContainerId,
      rollbackImageId: claims.rollbackImageId,
      rollbackImageDigest: claims.rollbackImageDigest,
      rollbackArtifactId: claims.rollbackArtifactId,
      rollbackArtifactDigest: claims.rollbackArtifactDigest,
      rollbackCaptureAttestationDigest: claims.rollbackCaptureAttestationDigest,
      composeProjectServiceIdentityDigest: claims.composeProjectServiceIdentityDigest,
      deployHostTopologyDigest: claims.deployHostTopologyDigest,
    },
    logicalProductionDbIdentityDigest: claims.logicalProductionDbIdentityDigest,
    expiresAt: claims.expiresAt,
    consumedNonceDigests: nonceItems.map((item) => item.nonceDigest),
  };
}

function assertGrantCurrent(grant, record, now) {
  if (!grant || grant.purpose !== "restore-only" || Date.parse(grant.expiresAt) <= now) {
    throw new Error("Persisted Phase A restore grant is missing or expired.");
  }
  if (grant.failedReleaseSha !== record.failedReleaseSha || grant.rollbackAppSha !== record.rollbackAppSha
    || grant.logicalProductionDbIdentityDigest !== record.logicalProductionDbIdentityDigest
    || canonicalDigest(grant.rollbackArtifact) !== canonicalDigest(record.immutableRollbackArtifact)) {
    throw new Error("Persisted Phase A grant no longer matches recovery bindings.");
  }
}

function makeRecord({
  tail,
  fields,
  nextState,
  transition,
  phase = null,
  authorizationId = null,
  authorizationEnvelopeDigest = null,
  policyAttestationDigest = null,
  grant = null,
  nonceConsumption = null,
  evidence,
  operationIntent = null,
  operationEvidenceId = null,
  workflowProvenance = null,
  now,
  signing,
}) {
  const bindings = tail ? {
    canonicalMainSha: tail.canonicalMainSha,
    recoveryCaseId: tail.recoveryCaseId,
    manifestId: tail.manifestId,
    failedReleaseSha: tail.failedReleaseSha,
    rollbackAppSha: tail.rollbackAppSha,
    immutableRollbackArtifact: tail.immutableRollbackArtifact,
    logicalProductionDbIdentityDigest: tail.logicalProductionDbIdentityDigest,
    composeProjectServiceIdentityDigest: tail.composeProjectServiceIdentityDigest,
    deployHostTopologyDigest: tail.deployHostTopologyDigest,
    markerReaderRolloutReceiptDigest: tail.markerReaderRolloutReceiptDigest,
    legacyMarkerDigest: tail.legacyMarkerDigest,
    legacyMarkerState: tail.legacyMarkerState,
  } : stableBindings(fields);
  const previousGrant = grant ?? tail?.restoreGrant ?? null;
  const body = {
    journalSchemaVersion: 1,
    generation: (tail?.generation ?? 0) + 1,
    priorGeneration: tail?.generation ?? 0,
    priorRecordDigest: tail?.recordDigest ?? JOURNAL_GENESIS_DIGEST,
    priorState: currentState(tail),
    nextState,
    ...bindings,
    transition,
    phase,
    authorizationId,
    authorizationEnvelopeDigest,
    policyAttestationDigest,
    nonceConsumption,
    restoreGrant: previousGrant,
    sourceEvidenceDigest: canonicalDigest(evidence),
    operationIntent,
    operationEvidenceId,
    workflowProvenance,
    timestamp: timestamp(now),
  };
  return createSignedJournalRecord(body, signing);
}

function assertTransitionAllowed(transition, state) {
  const definition = TRANSITIONS[transition];
  if (!definition || !definition.from.has(state)) {
    throw new Error("Recovery transition is not allowed from the current state.");
  }
  return definition;
}

function validateArtifactBinding(claims, record) {
  const artifact = record.immutableRollbackArtifact;
  const expected = {
    rollbackAppSha: artifact.rollbackAppSha,
    rollbackContainerId: artifact.rollbackContainerId,
    rollbackImageId: artifact.rollbackImageId,
    rollbackImageDigest: artifact.rollbackImageDigest,
    rollbackArtifactId: artifact.rollbackArtifactId,
    rollbackArtifactDigest: artifact.rollbackArtifactDigest,
    rollbackCaptureAttestationDigest: artifact.rollbackCaptureAttestationDigest,
    composeProjectServiceIdentityDigest: artifact.composeProjectServiceIdentityDigest,
    deployHostTopologyDigest: artifact.deployHostTopologyDigest,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (claims[key] !== value) throw new Error("Rollback artifact binding mismatch: " + key + ".");
  }
}

async function readLegacyV1Marker(markerPath) {
  const stat = await fs.lstat(markerPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Legacy release marker is not a regular file.");
  const bytes = await fs.readFile(markerPath);
  const lines = bytes.toString("utf8").replace(/\n$/, "").split("\n");
  if (lines.length !== 4 || lines[0] !== "schemaVersion=1"
    || !lines[1].startsWith("manifestId=") || !lines[2].startsWith("releaseSha=") || !lines[3].startsWith("state=")) {
    throw new Error("Legacy release marker is malformed or unsupported.");
  }
  const marker = {
    schemaVersion: 1,
    manifestId: lines[1].slice("manifestId=".length),
    releaseSha: lines[2].slice("releaseSha=".length),
    state: lines[3].slice("state=".length),
  };
  if (!/^[a-f0-9]{40}$/.test(marker.releaseSha)
    || !["ddl-started", "schema-applied", "app-ready"].includes(marker.state)) {
    throw new Error("Legacy release marker values are unsupported.");
  }
  return { marker, digest: sha256Hex(bytes) };
}

async function fsyncParent(directory) {
  const handle = await fs.open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function removeExactLegacyMarker(markerPath, expectedDigest, expectedMarker, syncDirectory) {
  let current;
  try {
    current = await readLegacyV1Marker(markerPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (current.digest !== expectedDigest || canonicalDigest(current.marker) !== canonicalDigest(expectedMarker)) {
    throw new Error("Legacy release marker changed from the recovery case captured at bootstrap.");
  }
  await fs.unlink(markerPath);
  await syncDirectory(path.dirname(markerPath));
  return true;
}

async function legacyMarkerExists(markerPath) {
  try {
    await fs.lstat(markerPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function verifyCompletionReceipt(receipt, publicKeys, tail) {
  assertExactKeys(receipt, [
    "receiptSchemaVersion", "purpose", "journalGeneration", "journalRecordDigest", "fullRecoveryLineageDigest",
    "failedReleaseSha", "rollbackAppSha", "immutableRollbackArtifact", "backupArtifactIdentity",
    "phaseAAuthorizationId", "phaseBAuthorizationId", "restoredLogicalProductionDbIdentityDigest",
    "schemaHistoryVerificationDigest", "writerTopologyEvidenceDigest", "trafficTarget", "healthResult", "timestamp",
    "authorityVersion", "authorityKeyId", "authorityInstanceId", "receiptDigest", "authoritySignature",
  ], "Recovery completion receipt");
  verifyImmutableReceipt(receipt, publicKeys);
  if (receipt.receiptSchemaVersion !== 1 || receipt.purpose !== "bodycast-production-recovery-completion"
    || receipt.journalGeneration !== tail.generation || receipt.journalRecordDigest !== tail.recordDigest
    || receipt.failedReleaseSha !== tail.failedReleaseSha || receipt.rollbackAppSha !== tail.rollbackAppSha
    || receipt.restoredLogicalProductionDbIdentityDigest !== tail.logicalProductionDbIdentityDigest
    || canonicalDigest(receipt.immutableRollbackArtifact) !== canonicalDigest(tail.immutableRollbackArtifact)) {
    throw new Error("Completion receipt does not bind the finalized journal lineage.");
  }
}

export function createRecoveryAuthority(config) {
  const {
    journalDirectory,
    lockPath,
    markerPath,
    legacyMarkerPath,
    receiptDirectory,
    signing,
    journalPublicKeys,
    phaseAPublicKeys,
    phaseBPublicKeys,
    policyPublicKeys,
    phaseWorkflowBindings,
    validateEvidence,
    verifyRolloutReceipt,
    verifyRestoreGrant,
    requireRoot = false,
    syncDirectory,
    now = () => Date.now(),
  } = config;
  if (!journalDirectory || !lockPath || !markerPath || !legacyMarkerPath || !receiptDirectory) throw new Error("Authority state paths are incomplete.");
  if (!signing?.privateKey || !signing.authorityVersion || !signing.authorityKeyId || !signing.authorityInstanceId) {
    throw new Error("Root authority signing identity is required.");
  }
  if (typeof validateEvidence !== "function" || typeof verifyRolloutReceipt !== "function") {
    throw new Error("Authority evidence and rollout receipt verifiers are required.");
  }
  if (!phaseWorkflowBindings?.A || !phaseWorkflowBindings?.B) throw new Error("Closed Phase A/B workflow bindings are required.");

  const lockOptions = { requireRoot, ...(syncDirectory ? { syncDirectory } : {}) };
  const storageOptions = { requireRoot, ...(syncDirectory ? { syncDirectory } : {}) };

  async function readValidatedJournal() {
    return readJournal(journalDirectory, { publicKeys: journalPublicKeys, requireRoot });
  }

  async function readOperationReceipt(record) {
    if (!record.operationIntent) return null;
    const receiptPath = path.join(receiptDirectory, "operation-" + record.operationIntent.operationId + ".json");
    let receipt;
    try { receipt = JSON.parse(await fs.readFile(receiptPath, "utf8")); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    assertExactKeys(receipt, ["receiptSchemaVersion", "purpose", "recoveryCaseId", "journalGeneration", "journalRecordDigest",
      "operationId", "operationType", "operationInputDigest", "outcomeDigest", "timestamp", "authorityVersion",
      "authorityKeyId", "authorityInstanceId", "receiptDigest", "authoritySignature"], "Host operation receipt");
    verifyImmutableReceipt(receipt, journalPublicKeys);
    const intent = record.operationIntent;
    if (receipt.receiptSchemaVersion !== 1 || receipt.purpose !== "bodycast-production-recovery-operation-completion"
      || receipt.recoveryCaseId !== record.recoveryCaseId || receipt.journalGeneration !== record.generation
      || receipt.journalRecordDigest !== record.recordDigest || receipt.operationId !== intent.operationId
      || receipt.operationType !== intent.operationType || receipt.operationInputDigest !== intent.operationInputDigest) {
      throw new Error("Host operation receipt does not bind the exact committed operation intent.");
    }
    assertSha256(receipt.outcomeDigest, "operationReceipt.outcomeDigest");
    return receipt;
  }

  async function writeOperationReceipt(record, outcome) {
    const operationId = record.operationIntent.operationId;
    const outcomeDigest = canonicalDigest(outcome ?? { ok: true });
    const existing = await readOperationReceipt(record);
    if (existing) {
      if (existing.outcomeDigest !== outcomeDigest) throw new Error("Operation replay returned a different completion result.");
      return existing;
    }
    const receipt = {
      receiptSchemaVersion: 1,
      purpose: "bodycast-production-recovery-operation-completion",
      recoveryCaseId: record.recoveryCaseId,
      journalGeneration: record.generation,
      journalRecordDigest: record.recordDigest,
      operationId,
      operationType: record.operationIntent.operationType,
      operationInputDigest: record.operationIntent.operationInputDigest,
      outcomeDigest,
      timestamp: timestamp(now()),
      authorityVersion: signing.authorityVersion,
      authorityKeyId: signing.authorityKeyId,
      authorityInstanceId: signing.authorityInstanceId,
    };
    const stored = await writeImmutableReceipt(receiptDirectory, "operation-" + operationId + ".json", receipt,
      { ...storageOptions, privateKey: signing.privateKey, publicKeys: journalPublicKeys });
    await readOperationReceipt(record);
    return stored.receipt;
  }

  async function executePendingOperation({ recoveryCaseId, generation, recordDigest, operationId }, execute) {
    if (typeof execute !== "function") throw new Error("A fixed host operation executor is required.");
    return withExclusiveRecoveryLock(lockPath, async () => {
      const journal = await readValidatedJournal();
      const record = journal.tail;
      if (!record || record.recoveryCaseId !== recoveryCaseId || record.generation !== generation
        || record.recordDigest !== recordDigest || record.operationIntent?.operationId !== operationId) {
        throw new Error("Host executor does not match the exact current journal operation intent.");
      }
      const existing = await readOperationReceipt(record);
      if (existing) return { receipt: existing, outcome: null, executed: false };
      // The journal lock serializes first execution and every retry. After a crash,
      // the fixed adapter receives the same operation ID and must first observe the
      // exact target state; it may repeat only the operation-specific idempotent
      // ensure/reconcile step, never blindly replay a destructive command.
      const outcome = await execute({ record, intent: record.operationIntent });
      const receipt = await writeOperationReceipt(record, outcome ?? { ok: true });
      return { receipt, outcome: outcome ?? { ok: true }, executed: true };
    }, lockOptions);
  }

  async function readPendingOperation() {
    return withExclusiveRecoveryLock(lockPath, async () => {
      const journal = await readValidatedJournal();
      const record = journal.tail;
      if (!record?.operationIntent) return null;
      const receipt = await readOperationReceipt(record);
      return { record, intent: record.operationIntent, operationEvidenceId: record.operationEvidenceId, receipt };
    }, lockOptions);
  }

  async function bootstrapFailedRelease(request) {
    return withExclusiveRecoveryLock(lockPath, async () => {
      const journal = await readValidatedJournal();
      if (journal.tail) throw new Error("Recovery journal is already initialized.");
      if (!FAILED_NORMAL_STATES.has(request.failedState)) throw new Error("Failed release state is unsupported.");
      const orphanProjection = await readMarkerProjection(markerPath, null, { requireRoot });
      if (!orphanProjection.absent) throw new Error("A V2 marker exists without an authoritative journal; bootstrap is blocked.");
      const legacy = await readLegacyV1Marker(legacyMarkerPath);
      assertEvidenceType(request.evidence, "pre-maintenance-release-capture");
      if (legacy.marker.state !== request.failedState || legacy.marker.releaseSha !== request.evidence.failedReleaseSha
        || legacy.marker.manifestId !== request.evidence.manifestId
        || request.evidence.recoveryCaseId !== request.evidence.manifestId) {
        throw new Error("Existing V1 failure marker does not match the captured recovery case.");
      }
      const rollout = await verifyRolloutReceipt(request.rolloutReceipt, request.evidence);
      const rolloutDigest = rollout?.receiptDigest;
      if (!rolloutDigest || rolloutDigest !== request.evidence.markerReaderRolloutReceiptDigest
        || rollout.repository !== request.evidence.repository
        || rollout.canonicalMainSha !== request.evidence.canonicalMainSha) {
        throw new Error("Pre-maintenance capture does not bind a current marker-reader rollout receipt.");
      }
      await verifyJournalFilesystemCapabilities(journalDirectory, storageOptions);
      await validateEvidence("bootstrap-failed-release", request.evidence);
      const bindings = stableBindings({
        ...request.evidence,
        legacyMarkerDigest: legacy.digest,
        legacyMarkerState: legacy.marker.state,
      });
      if (bindings.immutableRollbackArtifact.rollbackAppSha !== bindings.rollbackAppSha
        || bindings.immutableRollbackArtifact.failedReleaseSha !== bindings.failedReleaseSha) {
        throw new Error("Captured rollback artifact does not match the failed release evidence.");
      }
      const record = makeRecord({
        tail: null,
        fields: bindings,
        nextState: request.failedState,
        transition: "bootstrap-failed-release",
        evidence: request.evidence,
        workflowProvenance: request.workflowProvenance,
        now: now(),
        signing,
      });
      await commitJournalRecord(journalDirectory, record, { ...storageOptions, publicKeys: journalPublicKeys });
      const marker = await writeMarkerProjection(markerPath, record, storageOptions);
      return { record, marker };
    }, lockOptions);
  }

  async function applyTransition(request) {
    if (request.transition === "finalize-recovery") throw new Error("Use the dedicated finalization operation.");
    return withExclusiveRecoveryLock(lockPath, async () => {
      const journal = await readValidatedJournal();
      const tail = journal.tail;
      if (!tail) throw new Error("Recovery journal is not initialized.");
      if (request.recoveryCaseId !== tail.recoveryCaseId) throw new Error("Recovery case selector does not match the authoritative journal case.");
      assertExpectedHead(request, tail);
      if (tail.operationIntent && !(await readOperationReceipt(tail))) {
        throw new Error("The prior committed host operation has no authenticated completion receipt; replay it before another transition.");
      }
      const currentProjection = await readMarkerProjection(markerPath, tail, { requireRoot });
      if (currentProjection.absent) throw new Error("Active marker projection is missing; rebuild it before a transition.");
      const transition = request.transition;
      const definition = assertTransitionAllowed(transition, tail.nextState);
      let evidence = request.evidence;
      assertEvidenceType(evidence, transition);
      await validateEvidence(transition, evidence, tail);
      let verifiedAuthorization = null;
      let nonceConsumption = null;
      let grant = tail.restoreGrant ?? null;
      let authorizationId = null;
      let workflowProvenance = evidence.workflowProvenance ?? null;

      if (definition.phase) {
        const rolloutReceipt = await verifyRolloutReceipt(request.rolloutReceipt, evidence);
        const rolloutDigest = rolloutReceipt?.receiptDigest;
        if (!rolloutDigest || rolloutDigest !== tail.markerReaderRolloutReceiptDigest) {
          throw new Error("Current reader-rollout receipt is missing, stale, or differs from the journal binding.");
        }
        const phase = definition.phase;
        const publicKeys = phase === "A" ? phaseAPublicKeys : phaseBPublicKeys;
        const workflowBinding = phaseWorkflowBindings[phase];
        const expectedBindings = {
          failedReleaseSha: tail.failedReleaseSha,
          rollbackAppSha: tail.rollbackAppSha,
          markerReaderRolloutReceiptDigest: rolloutDigest,
          recoveryCaseId: tail.recoveryCaseId,
          manifestId: tail.manifestId,
          canonicalMainSha: tail.canonicalMainSha,
          repository: workflowBinding.repository,
          workflowPath: workflowBinding.workflowPath,
          workflowId: workflowBinding.workflowId,
          workflowRef: "refs/heads/main",
          hostRecoveryAuthorityIdentity: signing.authorityInstanceId,
          hostRecoveryAuthorityKeyId: signing.authorityKeyId,
        };
        if (phase === "A") Object.assign(expectedBindings, {
          logicalProductionDbIdentityDigest: tail.logicalProductionDbIdentityDigest,
          priorJournalGeneration: tail.generation,
          priorJournalRecordDigest: tail.recordDigest,
          priorMarkerState: tail.nextState,
          priorMarkerSchemaVersion: currentProjection.marker.schemaVersion,
          priorMarkerDigest: currentProjection.marker.markerDigest,
        });
        else Object.assign(expectedBindings, {
          actualRestoredLogicalDbIdentityDigest: tail.logicalProductionDbIdentityDigest,
          restoreVerifiedJournalGeneration: tail.generation,
          restoreVerifiedJournalRecordDigest: tail.recordDigest,
        });
        verifiedAuthorization = verifyAuthorizationEnvelope(request.envelope, {
          phase,
          publicKeys,
          policyAttestation: request.policyAttestation,
          policyPublicKeys,
          now: now(),
          expectedBindings,
        });
        validateArtifactBinding(verifiedAuthorization.claims, tail);
        const entries = authorizationNonceItems(phase, request.envelope);
        if (new Set(entries.map((entry) => entry.nonceDigest)).size !== entries.length) {
          throw new Error("Authorization and policy nonces must be distinct within a phase.");
        }
        const allRecords = await readAllRecords(journalDirectory, journalPublicKeys, requireRoot);
        const consumed = consumedNonceDigests(allRecords);
        if (entries.some((entry) => consumed.has(entry.nonceDigest))) throw new Error("Authorization nonce was already consumed.");
        nonceConsumption = { items: entries };
        authorizationId = verifiedAuthorization.claims.authorizationId;
        workflowProvenance = {
          repository: verifiedAuthorization.claims.repository,
          workflowPath: verifiedAuthorization.claims.workflowPath,
          workflowId: verifiedAuthorization.claims.workflowId,
          workflowRunId: verifiedAuthorization.claims.workflowRunId,
          workflowRunAttempt: verifiedAuthorization.claims.workflowRunAttempt,
          canonicalMainSha: verifiedAuthorization.claims.canonicalMainSha,
        };
        if (phase === "A") grant = makeGrant(verifiedAuthorization, entries);
      } else if (transition === "begin-restore") {
        assertGrantCurrent(grant, tail, now());
        if (typeof verifyRestoreGrant !== "function" || await verifyRestoreGrant(grant, evidence, tail) !== true) {
          throw new Error("Fresh restore preconditions did not validate against the persisted Phase A grant.");
        }
      }

      if (transition === "authorize-recovery") {
        const allRecords = await readAllRecords(journalDirectory, journalPublicKeys, requireRoot);
        const phaseARecord = allRecords.find((record) => record.transition === "authorize-restore") ?? null;
        if (!phaseARecord || phaseARecord.authorizationId !== verifiedAuthorization.claims.phaseAAuthorizationId) {
          throw new Error("Phase B does not reference the committed Phase A authorization.");
        }
        if (verifiedAuthorization.claims.phaseAEnvelopeDigest !== phaseARecord.authorizationEnvelopeDigest
          || verifiedAuthorization.claims.phaseAJournalGeneration !== phaseARecord.generation
          || verifiedAuthorization.claims.phaseAJournalRecordDigest !== phaseARecord.recordDigest) {
          throw new Error("Phase B does not bind the exact committed Phase A envelope and journal record.");
        }
        validateArtifactBinding(verifiedAuthorization.claims, phaseARecord);
        const restoreInProgressRecord = allRecords.find((record) => record.transition === "begin-restore");
        if (!restoreInProgressRecord || verifiedAuthorization.claims.restoreInProgressJournalGeneration !== restoreInProgressRecord.generation
          || verifiedAuthorization.claims.restoreInProgressJournalRecordDigest !== restoreInProgressRecord.recordDigest) {
          throw new Error("Phase B does not bind the committed restore-in-progress journal record.");
        }
        if (verifiedAuthorization.claims.restoreVerifiedJournalGeneration !== tail.generation
          || verifiedAuthorization.claims.restoreVerifiedJournalRecordDigest !== tail.recordDigest) {
          throw new Error("Phase B does not bind the exact restore-verified journal record.");
        }
        if (verifiedAuthorization.claims.actualRestoredLogicalDbIdentityDigest !== tail.logicalProductionDbIdentityDigest
          || verifiedAuthorization.claims.expectedRestoredSchemaDigest !== verifiedAuthorization.claims.actualRestoredSchemaDigest
          || verifiedAuthorization.claims.expectedMigrationHistoryDigest !== verifiedAuthorization.claims.actualMigrationHistoryDigest) {
          throw new Error("Phase B restore identity, schema, or migration history is not exactly verified.");
        }
        if (Date.parse(verifiedAuthorization.claims.observedAt) > now()
          || now() - Date.parse(verifiedAuthorization.claims.observedAt) > 5 * 60 * 1000) {
          throw new Error("Phase B live database and writer observations are stale.");
        }
      }

      const operationType = RECOVERY_OPERATION_TYPES[transition] ?? null;
      const operationInputDigest = operationType ? canonicalDigest({
        schemaVersion: 1,
        recoveryCaseId: tail.recoveryCaseId,
        transition,
        operationType,
        sourceEvidenceDigest: canonicalDigest(evidence),
        immutableRollbackArtifact: tail.immutableRollbackArtifact,
        logicalProductionDbIdentityDigest: tail.logicalProductionDbIdentityDigest,
      }) : null;
      const operationIntent = operationType ? {
        schemaVersion: 1,
        operationType,
        operationInputDigest,
        operationId: canonicalDigest({ recoveryCaseId: tail.recoveryCaseId, generation: tail.generation + 1,
          transition, operationType, operationInputDigest }),
      } : null;
      const record = makeRecord({
        tail,
        nextState: definition.to,
        transition,
        phase: definition.phase ?? null,
        authorizationId,
        authorizationEnvelopeDigest: verifiedAuthorization?.envelopeDigest ?? null,
        policyAttestationDigest: verifiedAuthorization?.policyDigest ?? null,
        grant,
        nonceConsumption,
        evidence,
        operationIntent,
        operationEvidenceId: operationIntent ? (request.operationEvidenceId ?? null) : null,
        workflowProvenance,
        now: now(),
        signing,
      });
      await commitJournalRecord(journalDirectory, record, { ...storageOptions, publicKeys: journalPublicKeys });
      const marker = await writeMarkerProjection(markerPath, record, storageOptions);
      return { record, marker };
    }, lockOptions);
  }

  async function finalizeRecovery(request) {
    const record = await withExclusiveRecoveryLock(lockPath, async () => {
      const journal = await readValidatedJournal();
      const tail = journal.tail;
      if (!tail) throw new Error("Recovery journal is not initialized.");
      if (request.recoveryCaseId !== tail.recoveryCaseId) throw new Error("Recovery case selector does not match the authoritative journal case.");
      assertExpectedHead(request, tail);
      if (tail.operationIntent && !(await readOperationReceipt(tail))) {
        throw new Error("The prior committed host operation has no authenticated completion receipt; replay it before finalization.");
      }
      assertEvidenceType(request.evidence, "finalize-recovery");
      await validateEvidence("finalize-recovery", request.evidence, tail);
      if (tail.nextState === "traffic-open") {
        const records = await readAllRecords(journalDirectory, journalPublicKeys, requireRoot);
        const phaseARecord = records.find((entry) => entry.transition === "authorize-restore");
        const phaseBRecord = records.find((entry) => entry.transition === "authorize-recovery");
        const lineageDigest = canonicalDigest(records.map(({ generation, recordDigest }) => ({ generation, recordDigest })));
        if (!phaseARecord || !phaseBRecord
          || request.evidence.phaseAAuthorizationId !== phaseARecord.authorizationId
          || request.evidence.phaseBAuthorizationId !== phaseBRecord.authorizationId
          || request.evidence.fullRecoveryLineageDigest !== lineageDigest) {
          throw new Error("Completion evidence does not bind both phase authorizations and the complete journal lineage.");
        }
        const markerState = await readMarkerProjection(markerPath, tail, { requireRoot });
        if (markerState.absent) throw new Error("Active marker is missing before recovery finalization.");
        const nextRecord = makeRecord({
          tail,
          nextState: "recovery-finalized",
          transition: "finalize-recovery",
          phase: null,
          authorizationId: request.evidence.phaseBAuthorizationId,
          evidence: request.evidence,
          workflowProvenance: request.evidence.workflowProvenance ?? null,
          now: now(),
          signing,
        });
        await commitJournalRecord(journalDirectory, nextRecord, { ...storageOptions, publicKeys: journalPublicKeys });
        await writeMarkerProjection(markerPath, nextRecord, storageOptions);
        return nextRecord;
      }
      if (tail.nextState !== "recovery-finalized") throw new Error("Recovery cannot be finalized from the current state.");
      if (canonicalDigest(request.evidence) !== tail.sourceEvidenceDigest) {
        throw new Error("Finalization retry evidence differs from the committed recovery-finalized record.");
      }
      return tail;
    }, lockOptions);
    const receipt = {
      receiptSchemaVersion: 1,
      purpose: "bodycast-production-recovery-completion",
      journalGeneration: record.generation,
      journalRecordDigest: record.recordDigest,
      fullRecoveryLineageDigest: request.evidence.fullRecoveryLineageDigest,
      failedReleaseSha: record.failedReleaseSha,
      rollbackAppSha: record.rollbackAppSha,
      immutableRollbackArtifact: record.immutableRollbackArtifact,
      backupArtifactIdentity: request.evidence.backupArtifactIdentity,
      phaseAAuthorizationId: request.evidence.phaseAAuthorizationId,
      phaseBAuthorizationId: request.evidence.phaseBAuthorizationId,
      restoredLogicalProductionDbIdentityDigest: record.logicalProductionDbIdentityDigest,
      schemaHistoryVerificationDigest: request.evidence.schemaHistoryVerificationDigest,
      writerTopologyEvidenceDigest: request.evidence.writerTopologyEvidenceDigest,
      trafficTarget: request.evidence.trafficTarget,
      healthResult: request.evidence.healthResult,
      timestamp: record.timestamp,
      authorityVersion: signing.authorityVersion,
      authorityKeyId: signing.authorityKeyId,
      authorityInstanceId: signing.authorityInstanceId,
    };
    const receiptResult = await writeImmutableReceipt(
      receiptDirectory,
      "recovery-" + record.recoveryCaseId + ".json",
      receipt,
      { ...storageOptions, privateKey: signing.privateKey, publicKeys: journalPublicKeys },
    );
    verifyCompletionReceipt(receiptResult.receipt, journalPublicKeys, record);

    return withExclusiveRecoveryLock(lockPath, async () => {
      const journal = await readValidatedJournal();
      if (!journal.tail || journal.tail.generation !== record.generation || journal.tail.recordDigest !== record.recordDigest
        || journal.tail.nextState !== "recovery-finalized") {
        throw new Error("Finalization journal tail changed before marker removal.");
      }
      verifyCompletionReceipt(receiptResult.receipt, journalPublicKeys, journal.tail);
      let markerExists = true;
      try {
        await fs.lstat(markerPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        markerExists = false;
      }
      if (markerExists) {
        const markerState = await readMarkerProjection(markerPath, journal.tail, { requireRoot });
        if (markerState.absent) throw new Error("Marker disappeared during finalization.");
        // Retire the legacy marker first while V2 still blocks every current reader.
        // If its directory fsync fails, the durable V2 projection remains active.
        await removeExactLegacyMarker(legacyMarkerPath, journal.tail.legacyMarkerDigest, {
          schemaVersion: 1,
          manifestId: journal.tail.manifestId,
          releaseSha: journal.tail.failedReleaseSha,
          state: journal.tail.legacyMarkerState,
        }, storageOptions.syncDirectory ?? fsyncParent);
        await removeMarkerProjection(markerPath, markerState.marker, storageOptions);
      } else {
        await removeExactLegacyMarker(legacyMarkerPath, journal.tail.legacyMarkerDigest, {
          schemaVersion: 1,
          manifestId: journal.tail.manifestId,
          releaseSha: journal.tail.failedReleaseSha,
          state: journal.tail.legacyMarkerState,
        }, storageOptions.syncDirectory ?? fsyncParent);
      }
      return { record: journal.tail, receipt: receiptResult.receipt, markerRemoved: true };
    }, lockOptions);
  }

  async function readAuthoritativeState() {
    return withExclusiveRecoveryLock(lockPath, async () => {
      const journal = await readValidatedJournal();
      const projection = await readMarkerProjection(markerPath, journal.tail ?? null, { requireRoot });
      if (!journal.tail && !projection.absent) throw new Error("A V2 marker exists without an authoritative journal.");
      const finalized = journal.tail?.nextState === "recovery-finalized";
      let receiptVerified = false;
      if (finalized) {
        const receiptPath = path.join(receiptDirectory, "recovery-" + journal.tail.recoveryCaseId + ".json");
        try {
          const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
          verifyCompletionReceipt(receipt, journalPublicKeys, journal.tail);
          receiptVerified = true;
        } catch {
          receiptVerified = false;
        }
      }
      const legacyExists = await legacyMarkerExists(legacyMarkerPath);
      const legacyMarker = legacyExists ? (await readLegacyV1Marker(legacyMarkerPath)).marker : null;
      const blocking = journal.tail
        ? !(finalized && receiptVerified && projection.absent && !legacyExists)
        : legacyExists;
      const activeRecovery = Boolean(journal.tail)
        && !(finalized && receiptVerified && projection.absent);
      return {
        generation: journal.tail?.generation ?? 0,
        recordDigest: journal.tail?.recordDigest ?? JOURNAL_GENESIS_DIGEST,
        state: journal.tail?.nextState ?? null,
        recoveryCaseId: journal.tail?.recoveryCaseId ?? null,
        operationPending: journal.tail?.operationIntent ? !(await readOperationReceipt(journal.tail)) : false,
        pendingOperationId: journal.tail?.operationIntent?.operationId ?? null,
        projection,
        receiptVerified,
        legacyMarker,
        activeRecovery,
        blocking,
      };
    }, lockOptions);
  }

  async function rebuildMarkerProjection() {
    return withExclusiveRecoveryLock(lockPath, async () => {
      const journal = await readValidatedJournal();
      if (!journal.tail) throw new Error("Cannot rebuild marker without an authoritative journal tail.");
      if (journal.tail.nextState === "recovery-finalized") throw new Error("Finalized recovery marker must be removed only after receipt verification.");
      const marker = await writeMarkerProjection(markerPath, journal.tail, storageOptions);
      return { record: journal.tail, marker };
    }, lockOptions);
  }

  async function reconcileOnStartup() {
    return withExclusiveRecoveryLock(lockPath, async () => {
      const journal = await readValidatedJournal();
      if (!journal.tail) {
        const projection = await readMarkerProjection(markerPath, null, { requireRoot });
        if (!projection.absent) throw new Error("A V2 marker exists without an authoritative journal.");
        return { initialized: false, projection };
      }
      if (journal.tail.nextState === "recovery-finalized") {
        return { initialized: true, finalized: true, tail: journal.tail };
      }
      let projection = null;
      try {
        projection = await readMarkerProjection(markerPath, journal.tail, { requireRoot });
      } catch {
        projection = null;
      }
      if (!projection || projection.absent) {
        const marker = await writeMarkerProjection(markerPath, journal.tail, storageOptions);
        return { initialized: true, projection: { absent: false, blocking: true, marker, rebuilt: true } };
      }
      return { initialized: true, projection };
    }, lockOptions);
  }

  return Object.freeze({
    bootstrapFailedRelease,
    applyTransition,
    readPendingOperation,
    executePendingOperation,
    finalizeRecovery,
    readAuthoritativeState,
    rebuildMarkerProjection,
    reconcileOnStartup,
  });
}

async function readAllRecords(journalDirectory, publicKeys, requireRoot) {
  const journal = await readJournal(journalDirectory, { publicKeys, requireRoot });
  const records = [];
  for (let generation = 1; generation <= journal.records; generation += 1) {
    const name = "generation-" + String(generation).padStart(20, "0") + ".json";
    records.push(JSON.parse(await fs.readFile(path.join(journalDirectory, name), "utf8")));
  }
  return records;
}

export { TRANSITIONS, FAILED_NORMAL_STATES };
