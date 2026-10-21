import { createHash } from "node:crypto";

export const LEGACY_V4_RECOVERY = Object.freeze({
  repository: "krustallik/body-model",
  pullRequest: 101,
  branch: "codex/v4-recovery-audit",
  baseSha: "f910d2a45dfa676fada5fab42c9e8946c97872b1",
  sourceSha: "35608243d5d11fd97e57b650b2cc8b2cd8f24744",
  productionAppSha: "f910d2a45dfa676fada5fab42c9e8946c97872b1",
  migrationCount: 65,
  migrationTree: "291b9c95924e196d66f9cdd555535b2e5a2b5990",
  ledgerDigest: "a4153cad028db966759935cb997b15ac3c6f1670dfc9ebd8a114f6b9520746a7",
  prismaSchemaBlob: "4fa84cb62262986d5f0c58d3c76db2ba52b5500e",
  ownerId: "126446430",
  confirmation: "RECOVER_UNIFIED_V4_FROM_PERSISTED_SOURCES_PROFILE_1_AT_35608243d5d11fd97e57b650b2cc8b2cd8f24744",
  command: Object.freeze([
    "node", "/app/dist/production-full-history-recalculate.mjs", "--derived-v4-recovery",
    "--owner-authorized", "--profile-id", "1",
  ]),
  evidenceBindingContract: "bodycast-v4-recovery-evidence-binding-v2",
});

const fail = (message) => { throw new Error(message); };
const isSha = (value) => /^[a-f0-9]{40}$/.test(String(value ?? ""));
const isDigest = (value) => /^[a-f0-9]{64}$/.test(String(value ?? ""));
const isCalendarDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const isTimestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const isValidTimeZone = (value) => {
  if (typeof value !== "string" || value.length === 0) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0)); return true; }
  catch { return false; }
};

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertRecoveryOciImageArchiveBinding({ index, manifestBytes, configBytes, expectedImageId }) {
  const manifestDigest = index?.manifests?.[0]?.digest;
  const manifestHex = /^sha256:([a-f0-9]{64})$/.exec(String(manifestDigest ?? ""))?.[1];
  if (index?.schemaVersion !== 2 || index.mediaType !== "application/vnd.oci.image.index.v1+json"
    || !Array.isArray(index.manifests) || index.manifests.length !== 1
    || index.manifests[0]?.mediaType !== "application/vnd.oci.image.manifest.v1+json"
    || !manifestHex || !Buffer.isBuffer(manifestBytes) || !Buffer.isBuffer(configBytes)
    || index.manifests[0]?.size !== manifestBytes.length
    || sha256(manifestBytes) !== manifestHex) {
    fail("The recovery archive OCI manifest is missing, ambiguous, or has a mismatched digest.");
  }
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); }
  catch { fail("The recovery archive OCI manifest is malformed."); }
  const configHex = /^sha256:([a-f0-9]{64})$/.exec(String(manifest?.config?.digest ?? ""))?.[1];
  if (!/^sha256:[a-f0-9]{64}$/.test(String(expectedImageId ?? ""))
    || manifest?.schemaVersion !== 2 || manifest?.mediaType !== "application/vnd.oci.image.manifest.v1+json"
    || manifest?.config?.mediaType !== "application/vnd.oci.image.config.v1+json"
    || manifest.config.digest !== expectedImageId || manifest.config.size !== configBytes.length
    || !configHex || sha256(configBytes) !== configHex
    || !Array.isArray(manifest.layers) || manifest.layers.length < 1
    || manifest.layers.some((layer) => !/^sha256:[a-f0-9]{64}$/.test(String(layer?.digest ?? ""))
      || typeof layer?.mediaType !== "string" || !layer.mediaType.startsWith("application/vnd.oci.image.layer.v1.")
      || !Number.isSafeInteger(layer?.size) || layer.size < 1)) {
    fail("The recovery archive OCI image config or layers do not match the marker-bound image ID.");
  }
  return Object.freeze({ imageId: expectedImageId, manifestDigest });
}

export function selectRecoveryOciImageReference({ expectedImageId, manifestDigest,
  configReferenceImageId, manifestReferenceImageId }) {
  if (!/^sha256:[a-f0-9]{64}$/.test(String(expectedImageId ?? ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(manifestDigest ?? ""))) {
    fail("The recovery image reference binding is malformed.");
  }
  const boundImageIdentities = new Set([expectedImageId, manifestDigest]);
  if (boundImageIdentities.has(configReferenceImageId)) return expectedImageId;
  if (boundImageIdentities.has(manifestReferenceImageId)) return manifestDigest;
  fail("Docker cannot resolve the marker-bound recovery image through its config or OCI manifest digest.");
}

function normalizedModelDayKeys(keys, label) {
  if (!Array.isArray(keys) || keys.length < 1 || keys.some((key) => !isModelDayKey(key))
    || new Set(keys).size !== keys.length) {
    fail(`${label} contains malformed or duplicate model-day identities.`);
  }
  return [...keys].sort();
}

export function modelDayKeysDigest(keys) {
  const normalized = normalizedModelDayKeys(keys, "Rehearsed V4 coverage");
  return sha256(`${normalized.join("\n")}\n`);
}

export function assertRehearsedCoverageEvidence({ sourceModelDayKeys, coveredModelDayKeys, coverageSha256 }) {
  const source = normalizedModelDayKeys(sourceModelDayKeys, "Persisted-source model-day coverage");
  const covered = normalizedModelDayKeys(coveredModelDayKeys, "Rehearsed V4 coverage");
  if (source.some((key) => !covered.includes(key)) || modelDayKeysDigest(covered) !== coverageSha256) {
    fail("Exact-image rehearsal coverage does not bind every persisted source model day.");
  }
  return true;
}

export function migrationLedgerDigest(rows, expectedCount = LEGACY_V4_RECOVERY.migrationCount) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || !Array.isArray(rows) || rows.length !== expectedCount) {
    fail(`Production or rehearsal migration ledger does not contain exactly ${expectedCount} migrations.`);
  }
  let previous = "";
  for (const row of rows) {
    if (typeof row.name !== "string" || row.name <= previous || !isDigest(row.checksum)
      || !row.finishedAt || row.rolledBackAt !== null) {
      fail("Migration ledger is incomplete, out of order, failed, rolled back, or has malformed checksums.");
    }
    previous = row.name;
  }
  return sha256(rows.map(({ name, checksum }) => `${name}\t${checksum}\n`).join(""));
}

export function migrationFilesDigest(files, expectedCount) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || !Array.isArray(files) || files.length !== expectedCount) {
    fail(`Migration file set does not contain exactly ${expectedCount} entries.`);
  }
  let previous = "";
  for (const file of files) {
    if (typeof file.name !== "string" || !/^[0-9]{14}_[a-z0-9_]+$/.test(file.name) || file.name <= previous
      || !isDigest(file.checksum)) {
      fail("Migration file set is malformed, duplicated, out of order, or has an invalid checksum.");
    }
    previous = file.name;
  }
  return sha256(files.map(({ name, checksum }) => `${name}\t${checksum}\n`).join(""));
}

// Return only stable category names so failed production preflights can be
// diagnosed without logging source payloads or fingerprints.
export function productionPreflightMismatchCategories({ report, measurements, before, rehearsal,
  expectedSchemaHelperSha256, schemaDigestContract, schemaDigestHelperSha256, targetSchema }) {
  const mismatches = [];
  const evidence = report?.evidence;
  const lifecycle = evidence?.lifecycle;
  const migrationRows = (rows) => Array.isArray(rows)
    ? rows.map((row) => ({ name: row?.name, checksum: row?.checksum,
      finishedAt: row?.finishedAt, rolledBackAt: row?.rolledBackAt }))
    : null;
  const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  const targetMigrationCount = targetSchema?.migrationCount ?? LEGACY_V4_RECOVERY.migrationCount;
  const targetLedgerDigest = targetSchema?.ledgerDigest ?? LEGACY_V4_RECOVERY.ledgerDigest;
  const targetAppMode = targetSchema?.appMode
    ?? (targetSchema?.mode === "maintenance-no-app-74" ? "maintenance-no-app" : "serving");
  if (targetSchema && (report?.targetSchema?.mode !== targetSchema.mode
    || report?.targetSchema?.migrationCount !== targetMigrationCount
    || report?.targetSchema?.ledgerDigest !== targetLedgerDigest
    || report?.targetSchema?.migrationTree !== targetSchema.migrationTree
    || report?.targetSchema?.prismaSchemaBlob !== targetSchema.prismaSchemaBlob)) {
    mismatches.push("target-schema-binding");
  }
  if (targetAppMode === "maintenance-no-app") {
    if (report?.appMode !== "maintenance-no-app" || report?.appSha !== null
      || report?.appContainerId !== null || report?.appImageId !== null) mismatches.push("application-state");
  } else if (report?.appSha !== LEGACY_V4_RECOVERY.productionAppSha) mismatches.push("application-sha");
  if (report?.headroomBeforeLoad?.phase !== "before-load") mismatches.push("headroom-before-load");
  if (report?.schemaDigestContract !== measurements?.schemaDigestContract
    || report?.schemaDigestContract !== schemaDigestContract) mismatches.push("schema-digest-contract");
  if (report?.schemaDigestHelperSha256 !== measurements?.schemaDigestHelperSha256
    || report?.schemaDigestHelperSha256 !== expectedSchemaHelperSha256
    || report?.schemaDigestHelperSha256 !== schemaDigestHelperSha256) mismatches.push("schema-digest-helper");
  if (evidence?.database?.database !== "bodycast") mismatches.push("database-identity");
  if (!Array.isArray(evidence?.migrationRows) || evidence.migrationRows.length !== targetMigrationCount) {
    mismatches.push("migration-row-count");
  } else {
    try {
      if (migrationLedgerDigest(evidence.migrationRows, targetMigrationCount) !== targetLedgerDigest) {
        mismatches.push("migration-ledger");
      }
    } catch {
      mismatches.push("migration-ledger");
    }
  }
  if (lifecycle?.unifiedRolloutEpoch !== 1) mismatches.push("unified-rollout-epoch");
  if (report?.schemaSha256 !== measurements?.schemaSha256) mismatches.push("schema-fingerprint");
  if (evidence?.sourceFingerprint !== measurements?.restoredSourceFingerprint) mismatches.push("raw-source-fingerprint");
  if (!isDigest(evidence?.healthSyncAuditFingerprint)
    || evidence.healthSyncAuditFingerprint !== measurements?.restoredHealthSyncAuditFingerprint) {
    mismatches.push("health-sync-audit-preservation-fingerprint");
  }
  if (evidence?.healthSyncAuditFingerprint !== before?.healthSyncAuditFingerprint) {
    mismatches.push("restored-audit-preservation");
  }
  if (!sameJson(migrationRows(evidence?.migrationRows), migrationRows(before?.migrationRows))) {
    mismatches.push("migration-ledger");
  }
  try {
    if (publicationBlockDigest(evidence?.blocks) !== publicationBlockDigest(before?.blocks)) {
      mismatches.push("publication-fences");
    }
  } catch {
    mismatches.push("publication-fences");
  }
  if (!sameJson(evidence?.sourceEvidence, before?.sourceEvidence)) mismatches.push("source-provenance");
  if (!sameJson(lifecycle, before?.lifecycle)) mismatches.push("lifecycle");
  if (!sameJson(evidence?.sourceModelDayKeys, before?.sourceModelDayKeys)) mismatches.push("source-model-day-keys");
  if (evidence?.expectedLedgerDigest !== before?.expectedLedgerDigest) mismatches.push("expected-ledger-digest");
  if (evidence?.sourceFingerprint !== rehearsal?.sourceFingerprint) mismatches.push("rehearsal-source-fingerprint");
  if (evidence?.healthSyncAuditFingerprint !== rehearsal?.healthSyncAuditFingerprint) {
    mismatches.push("rehearsal-audit-preservation-fingerprint");
  }
  return mismatches;
}

export function assertApprovedRecoveryRuns({
  actorId, confirmation, targetMode, runAttempt, repository, workflowRef, workflowPath,
  workflowSha, currentMainSha, sourceSha, sourcePr, ciRuns, safetyRuns,
  mainCiRuns,
}) {
  const approved = LEGACY_V4_RECOVERY;
  const expectedConfirmation = targetMode === "maintenance-no-app-74"
    ? `RECOVER_UNIFIED_V4_PROFILE_1_MAIN_${workflowSha}_RECOVERY_${approved.sourceSha}_MAINTENANCE_NO_APP_74`
    : approved.confirmation;
  if (String(actorId) !== approved.ownerId || confirmation !== expectedConfirmation || runAttempt !== "1"
    || repository !== approved.repository || workflowRef !== "refs/heads/main"
    || workflowPath !== ".github/workflows/production-v4-derived-recovery.yml"
    || !isSha(workflowSha) || workflowSha !== currentMainSha
    || sourceSha !== approved.sourceSha) fail("Owner, one-shot attempt, workflow, or approved legacy source binding failed.");
  if (sourcePr?.number !== approved.pullRequest || sourcePr?.state !== "open"
    || sourcePr?.head?.ref !== approved.branch || sourcePr?.head?.sha !== approved.sourceSha
    || sourcePr?.base?.ref !== "codex/v4-health-publication-validation"
    || sourcePr?.base?.sha !== approved.baseSha) fail("The approved legacy recovery PR identity or 65-migration base changed.");
  const greenRun = (runs, workflowPathExpected) => {
    if (!Array.isArray(runs)) return false;
    const matching = runs.filter((run) => run.head_sha === approved.sourceSha
      && run.head_branch === approved.branch && run.event === "pull_request"
      && run.path?.split("@")[0] === workflowPathExpected)
      .sort((a, b) => Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0)
        || Number(b.run_attempt ?? 0) - Number(a.run_attempt ?? 0));
    const latest = matching[0];
    return Boolean(latest && latest.status === "completed" && latest.conclusion === "success"
      && Number.isSafeInteger(Number(latest.run_attempt)) && Number(latest.run_attempt) >= 1);
  };
  if (!greenRun(ciRuns, ".github/workflows/ci.yml")
    || !greenRun(safetyRuns, ".github/workflows/production-migration-safety-ci.yml")) {
    fail("Both exact legacy recovery CI workflows must be green before execution.");
  }
  const greenMainRun = (runs, workflowPathExpected) => {
    if (!Array.isArray(runs)) return false;
    const matching = runs.filter((run) => run.head_sha === currentMainSha
      && run.head_branch === "main" && run.event === "push"
      && run.path?.split("@")[0] === workflowPathExpected)
      .sort((a, b) => Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0)
        || Number(b.run_attempt ?? 0) - Number(a.run_attempt ?? 0));
    const latest = matching[0];
    return Boolean(latest && latest.status === "completed" && latest.conclusion === "success"
      && Number.isSafeInteger(Number(latest.run_attempt)) && Number(latest.run_attempt) >= 1);
  };
  if (!greenMainRun(mainCiRuns, ".github/workflows/ci.yml")) {
    fail("Exact current-main CI must be green before recovery.");
  }
  return true;
}

export function assertArtifactBinding({ sourceSha, imageId, imageDigest, archiveSha256, archiveBytes, imageBytes,
  evidenceBindingContract, manifestSha256, migrationTree, prismaSchemaBlob, effectiveCommand, ledgerRows,
  targetSchema, canonicalFixBlob }) {
  const approved = LEGACY_V4_RECOVERY;
  if (sourceSha !== approved.sourceSha || !/^sha256:[a-f0-9]{64}$/.test(String(imageId))
    || !/^sha256:[a-f0-9]{64}$/.test(String(imageDigest))
    || !isDigest(archiveSha256) || !Number.isSafeInteger(archiveBytes) || archiveBytes < 1
    || !Number.isSafeInteger(imageBytes) || imageBytes < 1
    || evidenceBindingContract !== approved.evidenceBindingContract || migrationTree !== approved.migrationTree
    || prismaSchemaBlob !== approved.prismaSchemaBlob
    || JSON.stringify(effectiveCommand) !== JSON.stringify(approved.command)) {
    fail("Recovery artifact SHA, immutable image/archive identity, schema, or entrypoint is not approved.");
  }
  const ledgerDigest = migrationLedgerDigest(ledgerRows);
  if (ledgerDigest !== approved.ledgerDigest) fail("Recovery artifact migration rows do not match the exact audited 65-migration ledger.");
  const manifest = { sourceSha, imageId, imageDigest, archiveSha256, archiveBytes, imageBytes,
    evidenceBindingContract, migrationTree, prismaSchemaBlob, effectiveCommand, ledgerDigest };
  if (targetSchema !== undefined || canonicalFixBlob !== undefined) {
    const expectedMode = targetSchema?.mode;
    const expectedCount = expectedMode === "maintenance-no-app-74" ? 74 : expectedMode === "legacy-serving-65" ? 65 : null;
    if (!targetSchema || !isSha(targetSchema.releaseSha) || !isSha(targetSchema.migrationTree)
      || !isSha(targetSchema.prismaSchemaBlob) || !isDigest(targetSchema.ledgerDigest)
      || targetSchema.migrationCount !== expectedCount || !isSha(canonicalFixBlob)
      || !/^\d+\.\d+\.\d+$/.test(String(targetSchema.prismaVersion ?? ""))
      || (expectedMode === "maintenance-no-app-74"
        ? targetSchema.manifestId !== "training-mutation-ledger-refresh-queue-v1"
        : targetSchema.manifestId !== null)) {
      fail("Recovery artifact target schema or canonical fix binding is malformed.");
    }
    manifest.targetSchema = targetSchema;
    manifest.canonicalFixBlob = canonicalFixBlob;
  }
  if (manifestSha256 !== sha256(JSON.stringify(manifest))) fail("Recovery artifact provenance manifest digest does not match its contents.");
  return ledgerDigest;
}

export function parseTrainingFenceIdentity(sourceKey) {
  if (typeof sourceKey !== "string") return null;
  const numericSession = /^([1-9][0-9]*)$/.exec(sourceKey);
  if (numericSession) {
    const sessionId = Number(numericSession[1]);
    return Number.isSafeInteger(sessionId) ? { sessionId, identity: "session", childId: null } : null;
  }
  const deletedSession = /^training-delete-session:([1-9][0-9]*)$/.exec(sourceKey);
  if (deletedSession) {
    const sessionId = Number(deletedSession[1]);
    return Number.isSafeInteger(sessionId) ? { sessionId, identity: "deleted-session", childId: null } : null;
  }
  const deletedChild = /^training-delete-(set|exercise):([1-9][0-9]*):([1-9][0-9]*)$/.exec(sourceKey);
  if (!deletedChild) return null;
  const sessionId = Number(deletedChild[2]);
  const childId = Number(deletedChild[3]);
  if (!Number.isSafeInteger(sessionId) || !Number.isSafeInteger(childId)) return null;
  return { sessionId, identity: deletedChild[1] === "set" ? "deleted-set" : "deleted-exercise", childId };
}

export function publicationBlockDigest(blocks) {
  if (!Array.isArray(blocks)) fail("Persisted publication fences are missing.");
  if (blocks.length === 0) return sha256("");
  const sorted = [...blocks].sort((a, b) => `${a.source}\0${a.sourceKey}`.localeCompare(`${b.source}\0${b.sourceKey}`));
  const identities = new Set();
  for (const block of sorted) {
    const identity = `${block.source}\0${block.sourceKey}`;
    if (identities.has(identity)) fail("Publication fence set contains duplicate source identities.");
    identities.add(identity);
    const validDate = isCalendarDate(block.fromDate);
    const health = block.source === "health" && block.sourceKey === block.fromDate && validDate;
    const training = block.source === "training" && parseTrainingFenceIdentity(block.sourceKey) !== null && validDate;
    if ((!health && !training) || !Number.isSafeInteger(block.revision) || block.revision < 1) {
      fail("Publication fence set contains an unsupported or malformed source.");
    }
    if (block.createdAt !== undefined || block.updatedAt !== undefined) {
      if (!isTimestamp(block.createdAt) || !isTimestamp(block.updatedAt)
        || Date.parse(block.createdAt) > Date.parse(block.updatedAt)) {
        fail("Publication fence timestamps are absent, malformed, or out of order.");
      }
    }
  }
  return sha256(sorted.map((block) => [block.source, block.sourceKey, block.fromDate, block.revision].join("\t") + "\n").join(""));
}

function recoveryLifecycleBindingValues(lifecycle) {
  if (!lifecycle || lifecycle.profileId !== 1
      || !Number.isSafeInteger(lifecycle.invalidationGeneration)
      || !Number.isSafeInteger(lifecycle.productionPublishedGeneration)
      || typeof lifecycle.productionStaleFromDate !== "string" && lifecycle.productionStaleFromDate !== null
      || typeof lifecycle.unifiedTargetRevision !== "string"
      || !Number.isSafeInteger(lifecycle.unifiedRolloutEpoch)
      || lifecycle.unifiedPublishedGeneration !== null && !Number.isSafeInteger(lifecycle.unifiedPublishedGeneration)
      || lifecycle.unifiedPublishedRolloutEpoch !== null && !Number.isSafeInteger(lifecycle.unifiedPublishedRolloutEpoch)
      || typeof lifecycle.unifiedPublicationBlockedFromDate !== "string" && lifecycle.unifiedPublicationBlockedFromDate !== null
      || typeof lifecycle.unifiedPublicationBlockedSource !== "string" && lifecycle.unifiedPublicationBlockedSource !== null) {
    fail("V4 recovery lifecycle binding is incomplete or malformed.");
  }
  return [lifecycle.profileId, lifecycle.invalidationGeneration, lifecycle.productionPublishedGeneration,
    lifecycle.productionStaleFromDate, lifecycle.unifiedTargetRevision, lifecycle.unifiedRolloutEpoch,
    lifecycle.unifiedPublishedGeneration, lifecycle.unifiedPublishedRolloutEpoch,
    lifecycle.unifiedPublicationBlockedFromDate, lifecycle.unifiedPublicationBlockedSource];
}

/** Canonical versioned binding shared with the 65-schema recovery entrypoint. */
export function recoveryEvidenceBinding({ sourceFingerprint, healthSyncAuditFingerprint, blocks, lifecycle }) {
  if (!isDigest(sourceFingerprint)) fail("V4 recovery source fingerprint is malformed.");
  if (!isDigest(healthSyncAuditFingerprint)) fail("V4 recovery audit preservation fingerprint is malformed.");
  const fenceDigest = publicationBlockDigest(blocks);
  const lifecycleDigest = sha256(JSON.stringify(recoveryLifecycleBindingValues(lifecycle)));
  return {
    contract: "bodycast-v4-recovery-evidence-binding-v2",
    rawFingerprint: sourceFingerprint,
    healthSyncAuditFingerprint,
    fenceDigest,
    lifecycleDigest,
    bindingDigest: sha256(`bodycast-v4-recovery-evidence-binding-v2\n${sourceFingerprint}\n${healthSyncAuditFingerprint}\n${fenceDigest}\n${lifecycleDigest}\n`),
  };
}

export function validatePublicationSourceEvidence({ blocks, sourceEvidence }) {
  publicationBlockDigest(blocks);
  const healthBlocks = blocks.filter((block) => block.source === "health");
  const healthEvidence = sourceEvidence?.health;
  if (!Array.isArray(healthEvidence) || healthEvidence.length !== healthBlocks.length) {
    fail("Every persisted Health fence must have matching source provenance evidence.");
  }
  const byHealthIdentity = new Map();
  for (const row of healthEvidence) {
    if (!row || typeof row.sourceKey !== "string" || byHealthIdentity.has(row.sourceKey)) {
      fail("Health source evidence contains a duplicate or malformed identity.");
    }
    byHealthIdentity.set(row.sourceKey, row);
  }
  for (const block of healthBlocks) {
    const row = byHealthIdentity.get(block.sourceKey);
    const counts = [row?.dailyDataRows, row?.snapshotRows, row?.linkedSnapshotRows,
      row?.invalidSnapshotRows, row?.snapshotsWithReceivedAt, row?.snapshotsWithSyncedAt,
      row?.snapshotsWithNullSyncedAt, row?.snapshotsWithValidTimeZone, row?.invalidSnapshotTimes,
      row?.invalidSnapshotTimeZones, row?.metricSampleRows,
      row?.linkedMetricSampleRows, row?.invalidMetricSampleRows, row?.unsupportedMetricSourceRows];
    if (!row || row.fromDate !== block.fromDate || row.fenceRevision !== block.revision
      || !isCalendarDate(row.fromDate) || counts.some((value) => !Number.isSafeInteger(value) || value < 0)
      || !isTimestamp(block.createdAt) || !isTimestamp(block.updatedAt)
      || Date.parse(block.createdAt) > Date.parse(block.updatedAt)
      || row.dailyDataRows !== 1 || row.snapshotRows < 1 || row.linkedSnapshotRows !== row.snapshotRows
      || row.invalidSnapshotRows !== 0 || row.snapshotsWithReceivedAt !== row.snapshotRows
      || row.snapshotsWithSyncedAt + row.snapshotsWithNullSyncedAt !== row.snapshotRows
      || row.snapshotsWithValidTimeZone !== row.snapshotRows || row.invalidSnapshotTimes !== 0
      || row.invalidSnapshotTimeZones !== 0
      || row.linkedMetricSampleRows !== row.metricSampleRows || row.invalidMetricSampleRows !== 0
      || row.unsupportedMetricSourceRows !== 0 || row.chronologyValid !== true
      || !isTimestamp(row.dailyUpdatedAt)) {
      fail("A Health fence is unsupported, orphaned, missing persisted snapshot provenance, or out of revision chronology.");
    }
  }

  const trainingBlocks = blocks.filter((block) => block.source === "training").sort((left, right) => {
    const leftIdentity = parseTrainingFenceIdentity(left.sourceKey);
    const rightIdentity = parseTrainingFenceIdentity(right.sourceKey);
    return (leftIdentity?.sessionId ?? 0) - (rightIdentity?.sessionId ?? 0)
      || left.sourceKey.localeCompare(right.sourceKey);
  });
  const trainingEvidence = sourceEvidence?.training;
  if (!Array.isArray(trainingEvidence) || trainingEvidence.length !== trainingBlocks.length) {
    fail("Every Training publication fence must have exactly one matching persisted source or deletion evidence row.");
  }
  if (trainingEvidence.some((row, index) => row?.sourceKey !== trainingBlocks[index]?.sourceKey)) {
    fail("Training fence evidence is not in canonical session/source-key order.");
  }
  const evidenceBySourceKey = new Map();
  for (const row of trainingEvidence) {
    if (!row || typeof row.sourceKey !== "string" || evidenceBySourceKey.has(row.sourceKey)) {
      fail("Training source evidence contains a duplicate or malformed fence identity.");
    }
    evidenceBySourceKey.set(row.sourceKey, row);
  }
  const groups = new Map();
  const sharedFields = ["sessionRows", "sessionId", "profileId", "status", "entryMode", "sourceRevision",
    "accountingInputRevision", "currentSnapshotRevision", "createdAt", "persistedEffectiveAccountingAt",
    "webStartedAt", "trainingEventAt", "matchedWorkoutStartAt", "effectiveAccountingAt", "accountingTimeZone",
    "accountingTimeZoneProvenance", "matchedWorkoutId", "matchStatus", "matchedWorkoutPresent",
    "matchedWorkoutIdentityMatches", "matchedWorkoutTypeSupported", "matchedWorkoutSourceIdentitySha256",
    "matchedWorkoutSourceHealthDate", "modelDate", "accountingEffectiveLocalDate", "accountingSnapshotRows",
    "snapshotRevision", "snapshotAccountingInputRevision", "snapshotEffectiveLocalDate", "snapshotTimeZone",
    "snapshotTimeZoneValid", "snapshotTimeZoneProvenance", "snapshotContractValid", "snapshotEvidenceSha256",
    "latestSnapshotRows", "latestSnapshotRevision", "latestSnapshotAccountingInputRevision",
    "latestSnapshotEffectiveLocalDate", "latestSnapshotTimeZone", "latestSnapshotTimeZoneValid",
    "latestSnapshotTimeZoneProvenance", "latestSnapshotContractValid", "latestSnapshotEvidenceSha256",
    "historicalSnapshotChronologyValid", "pendingAccountingOperationRows", "accountingRevisionGap",
    "parentSessionRows", "parentSessionId", "parentProfileId", "parentStatus",
    "trainingEventAt"];
  for (const block of trainingBlocks) {
    const identity = parseTrainingFenceIdentity(block.sourceKey);
    const row = evidenceBySourceKey.get(block.sourceKey);
    if (!identity || !row || row.sourceKey !== block.sourceKey || row.fromDate !== block.fromDate
        || row.fenceRevision !== block.revision || row.identity !== identity.identity
        || row.sessionId !== identity.sessionId
        || !isTimestamp(block.createdAt) || !isTimestamp(block.updatedAt)
        || Date.parse(block.createdAt) > Date.parse(block.updatedAt)
        || ((identity.identity === "deleted-set" || identity.identity === "deleted-exercise")
          && (!Number.isSafeInteger(row.childDeletionAccountingInputRevision)
            || row.childDeletionAccountingInputRevision < 1
            || row.childDeletionAccountingInputRevision !== block.revision))
        || ((identity.identity === "session" || identity.identity === "deleted-session")
          && row.childDeletionAccountingInputRevision !== null)) {
      fail("Training fence evidence does not preserve the exact canonical source identity, date, and revision.");
    }
    const group = groups.get(identity.sessionId) ?? [];
    group.push({ block, identity, row });
    groups.set(identity.sessionId, group);
  }
  for (const [sessionId, entries] of groups) {
    const shared = JSON.stringify(sharedFields.map((field) => entries[0].row[field]));
    if (entries.some(({ row }) => JSON.stringify(sharedFields.map((field) => row[field])) !== shared)) {
      fail(`Training session ${sessionId} has inconsistent source or snapshot evidence across its fences.`);
    }
    const row = entries[0].row;
    const identities = entries.map(({ identity }) => identity.identity).sort();
    if (entries.some(({ row: fenceEvidence }) => fenceEvidence.sourceFenceChronologyValid !== true)) {
      fail(`Training session ${sessionId} has a malformed publication-fence timestamp range.`);
    }
    if (row.sessionRows === 0) {
      const numericFence = entries.find(({ identity }) => identity.identity === "session");
      const deletionFence = entries.find(({ identity }) => identity.identity === "deleted-session");
      const childFences = entries.filter(({ identity }) => identity.identity === "deleted-set"
        || identity.identity === "deleted-exercise");
      if (!numericFence || !deletionFence
          || numericFence.block.fromDate !== deletionFence.block.fromDate
          || entries.some(({ identity }) => !["session", "deleted-session", "deleted-set", "deleted-exercise"].includes(identity.identity))
          || row.sessionId !== sessionId || row.profileId !== null || row.status !== null || row.entryMode !== null
          || row.sourceRevision !== null || row.accountingInputRevision !== null || row.currentSnapshotRevision !== null
          || row.createdAt !== null || row.persistedEffectiveAccountingAt !== null || row.webStartedAt !== null
          || row.trainingEventAt !== null || row.matchedWorkoutStartAt !== null || row.effectiveAccountingAt !== null
          || row.matchedWorkoutId !== null || row.matchStatus !== null || row.matchedWorkoutPresent !== false
          || row.matchedWorkoutIdentityMatches !== false || row.matchedWorkoutTypeSupported !== false
          || row.matchedWorkoutSourceIdentitySha256 !== null || row.matchedWorkoutSourceHealthDate !== null
          || row.modelDate !== null || row.accountingEffectiveLocalDate !== null
          || row.accountingSnapshotRows !== 0 || row.latestSnapshotRows !== 0
          || row.snapshotRevision !== null || row.snapshotAccountingInputRevision !== null
          || row.snapshotEffectiveLocalDate !== null || row.snapshotTimeZone !== null
          || row.snapshotTimeZoneValid !== false || row.snapshotTimeZoneProvenance !== null
          || row.snapshotContractValid !== false || row.snapshotEvidenceSha256 !== null
          || row.latestSnapshotRevision !== null || row.latestSnapshotAccountingInputRevision !== null
          || row.latestSnapshotEffectiveLocalDate !== null || row.latestSnapshotTimeZone !== null
          || row.latestSnapshotTimeZoneValid !== false || row.latestSnapshotTimeZoneProvenance !== null
          || row.latestSnapshotContractValid !== false || row.latestSnapshotEvidenceSha256 !== null
          || row.historicalSnapshotChronologyValid !== false || row.accountingRevisionGap !== null
          || row.chronologyValid !== false || row.sessionUpdateFenceChronologyValid !== false
          || row.pendingAccountingOperationRows !== 0 || row.parentSessionRows !== 0
          || row.parentSessionId !== null || row.parentProfileId !== null || row.parentStatus !== null
          || childFences.some(({ row: childEvidence }) => childEvidence.childRows !== 0
            || childEvidence.childOwnerSessionId !== null)) {
        fail(`Missing Training session ${sessionId} lacks the exact committed numeric-fence and deletion-tombstone pair.`);
      }
      continue;
    }
    const numericFenceEntry = entries.find(({ identity }) => identity.identity === "session");
    if (row.sessionRows !== 1 || row.sessionId !== sessionId || row.profileId !== 1
        || row.parentSessionRows !== 1 || row.parentSessionId !== sessionId
        || row.parentProfileId !== 1 || row.parentStatus !== "COMPLETED"
        || !numericFenceEntry || numericFenceEntry.row.sessionUpdateFenceChronologyValid !== true
        || row.status !== "COMPLETED" || !["LIVE", "RETROSPECTIVE"].includes(row.entryMode)
        || !Number.isSafeInteger(row.sourceRevision) || row.sourceRevision < 1
        || !Number.isSafeInteger(row.accountingInputRevision) || row.accountingInputRevision < 1
        || !isTimestamp(row.createdAt)
        || (row.persistedEffectiveAccountingAt !== null && !isTimestamp(row.persistedEffectiveAccountingAt))
        || !isTimestamp(row.effectiveAccountingAt) || !isTimestamp(row.trainingEventAt)
        || !isCalendarDate(row.accountingEffectiveLocalDate) || !isValidTimeZone(row.accountingTimeZone)
        || !["client-session", "legacy-default"].includes(row.accountingTimeZoneProvenance)
        || !isCalendarDate(row.modelDate) || entries.some(({ block }) => block.fromDate > row.modelDate)) {
      fail(`Training session ${sessionId} has a malformed persisted parent, event date, or episode-local fence boundary.`);
    }
    const matched = row.matchStatus === "MATCHED";
    const noMatch = ["PENDING", "UNMATCHED", "AMBIGUOUS"].includes(row.matchStatus);
    const expectedEventAt = row.matchedWorkoutStartAt ?? row.persistedEffectiveAccountingAt ?? row.webStartedAt ?? row.createdAt;
    const expectedAccountingAt = row.persistedEffectiveAccountingAt ?? row.matchedWorkoutStartAt ?? row.webStartedAt ?? row.createdAt;
    const matchEvidenceValid = matched
      ? Number.isSafeInteger(row.matchedWorkoutId) && row.matchedWorkoutId > 0
        && row.matchedWorkoutPresent === true && row.matchedWorkoutIdentityMatches === true
        && isTimestamp(row.matchedWorkoutStartAt) && row.matchedWorkoutTypeSupported === true
        && isDigest(row.matchedWorkoutSourceIdentitySha256) && isCalendarDate(row.matchedWorkoutSourceHealthDate)
      : noMatch && row.matchedWorkoutId === null && row.matchedWorkoutPresent === false
        && row.matchedWorkoutIdentityMatches === true && row.matchedWorkoutStartAt === null
        && row.matchedWorkoutTypeSupported === false && row.matchedWorkoutSourceIdentitySha256 === null
        && row.matchedWorkoutSourceHealthDate === null
        && (row.entryMode === "LIVE" || (row.entryMode === "RETROSPECTIVE" && row.matchStatus === "UNMATCHED"));
    if (!matchEvidenceValid || row.trainingEventAt !== expectedEventAt || row.effectiveAccountingAt !== expectedAccountingAt) {
      fail(`Training session ${sessionId} has unsupported workout attribution or event-clock provenance.`);
    }
    const deletedChildren = entries.filter(({ identity }) => identity.identity === "deleted-set"
      || identity.identity === "deleted-exercise");
    if (entries.some(({ identity }) => identity.identity === "deleted-session")) {
      fail(`Training session ${sessionId} has a deletion tombstone while its parent still exists.`);
    }
    if (deletedChildren.length > 0) {
      const childCount = deletedChildren.length;
      const numericFence = entries.find(({ identity }) => identity.identity === "session");
      const numericFenceRow = numericFence?.row;
      const latestSnapshotValid = !Number.isSafeInteger(row.latestSnapshotRows) || row.latestSnapshotRows !== 1
        || !Number.isSafeInteger(row.latestSnapshotRevision) || row.latestSnapshotRevision < 1
        || !Number.isSafeInteger(row.latestSnapshotAccountingInputRevision) || row.latestSnapshotAccountingInputRevision < 1
        || row.latestSnapshotEffectiveLocalDate !== row.accountingEffectiveLocalDate
        || row.latestSnapshotTimeZone !== row.accountingTimeZone
        || row.latestSnapshotTimeZoneProvenance !== row.accountingTimeZoneProvenance
        || row.latestSnapshotTimeZoneValid !== true || row.latestSnapshotContractValid !== true
        || !isDigest(row.latestSnapshotEvidenceSha256) || row.historicalSnapshotChronologyValid !== true
        || !Number.isSafeInteger(row.accountingRevisionGap)
        || row.accountingRevisionGap !== row.accountingInputRevision - row.latestSnapshotAccountingInputRevision;
      if (!numericFence || entries.filter(({ identity }) => identity.identity === "session").length !== 1
          || entries.length !== childCount + 1
          || row.pendingAccountingOperationRows !== 0
          || !Number.isSafeInteger(row.accountingInputRevision) || row.accountingInputRevision < 1
          || latestSnapshotValid
          || !isCalendarDate(row.modelDate)) {
        fail(`Training session ${sessionId} has no exact persisted child-delete proof for its current or missing snapshot.`);
      }
      const missingCurrentSnapshot = row.currentSnapshotRevision === null;
      if (missingCurrentSnapshot && (row.accountingSnapshotRows !== 0
          || row.snapshotRevision !== null || row.snapshotAccountingInputRevision !== null
          || row.snapshotEffectiveLocalDate !== null || row.snapshotTimeZone !== null
          || row.snapshotTimeZoneProvenance !== null || row.snapshotContractValid !== false
          || row.snapshotEvidenceSha256 !== null
          || !Number.isSafeInteger(row.latestSnapshotAccountingInputRevision)
          || row.latestSnapshotAccountingInputRevision < 1
          || row.latestSnapshotAccountingInputRevision >= row.accountingInputRevision
          || deletedChildren.some(({ row: childEvidence }) => (
            childEvidence.childDeletionAccountingInputRevision > row.accountingInputRevision
          ))
          || (() => {
            const postSnapshotDeletionRevisions = deletedChildren
              .map(({ row: childEvidence }) => childEvidence.childDeletionAccountingInputRevision)
              .filter((revision) => revision > row.latestSnapshotAccountingInputRevision)
              .sort((left, right) => left - right);
            return row.accountingRevisionGap !== postSnapshotDeletionRevisions.length
              || postSnapshotDeletionRevisions.some((revision, index) => (
                revision !== row.latestSnapshotAccountingInputRevision + index + 1
              ));
          })()
          || !Number.isSafeInteger(row.latestSnapshotRevision) || row.latestSnapshotRevision < 1
          || row.latestSnapshotAccountingInputRevision >= row.accountingInputRevision
        )) {
        fail(`Training session ${sessionId} has no exact persisted child-delete proof for its missing current snapshot.`);
      }
      if (!missingCurrentSnapshot && (row.currentSnapshotRevision !== row.latestSnapshotRevision
          || row.accountingSnapshotRows !== 1 || row.snapshotRevision !== row.currentSnapshotRevision
          || row.snapshotAccountingInputRevision !== row.accountingInputRevision
          || row.snapshotEffectiveLocalDate !== row.accountingEffectiveLocalDate
          || row.snapshotTimeZone !== row.accountingTimeZone || row.snapshotTimeZoneValid !== true
          || row.snapshotTimeZoneProvenance !== row.accountingTimeZoneProvenance
          || row.snapshotContractValid !== true || !isDigest(row.snapshotEvidenceSha256)
          || row.latestSnapshotAccountingInputRevision !== row.accountingInputRevision
          || row.accountingRevisionGap !== 0 || numericFenceRow.chronologyValid !== true)) {
        fail(`Training session ${sessionId} has child-delete fences with an invalid current accounting snapshot.`);
      }
      for (const { block, identity, row: childEvidence } of deletedChildren) {
        if (!Number.isSafeInteger(identity.childId) || identity.childId < 1
            || childEvidence.childRows !== 0 || childEvidence.childOwnerSessionId !== null
            || childEvidence.parentSessionRows !== 1 || childEvidence.parentSessionId !== sessionId
            || childEvidence.parentProfileId !== 1 || childEvidence.parentStatus !== "COMPLETED"
            || !isCalendarDate(block.fromDate)) {
          fail(`Training child-delete fence ${block.sourceKey} has a live, orphaned, or mismatched child/parent identity.`);
        }
      }
      continue;
    }
    if (entries.length !== 1 || identities[0] !== "session" || row.pendingAccountingOperationRows !== 0
        || !Number.isSafeInteger(row.currentSnapshotRevision) || row.currentSnapshotRevision < 1
        || row.accountingSnapshotRows !== 1 || row.snapshotRevision !== row.currentSnapshotRevision
        || row.snapshotAccountingInputRevision !== row.accountingInputRevision
        || !isCalendarDate(row.snapshotEffectiveLocalDate)
        || row.snapshotEffectiveLocalDate !== row.accountingEffectiveLocalDate
        || row.snapshotTimeZone !== row.accountingTimeZone || !row.snapshotTimeZoneValid
        || row.snapshotTimeZoneProvenance !== row.accountingTimeZoneProvenance
        || row.snapshotContractValid !== true || !isDigest(row.snapshotEvidenceSha256)
        || row.latestSnapshotRevision !== row.currentSnapshotRevision
        || row.latestSnapshotAccountingInputRevision !== row.accountingInputRevision
        || row.latestSnapshotContractValid !== true || !isDigest(row.latestSnapshotEvidenceSha256)
        || row.chronologyValid !== true) {
      fail(`Training session ${sessionId} is missing its current persisted accounting snapshot or revision chronology.`);
    }
  }
  return true;
}

export function assertProductionIdentity({ database, app, migrationRows, schemaSha256, sourceFingerprint, healthSyncAuditFingerprint,
  lifecycle, blocks, sourceEvidence, expected }) {
  const approved = LEGACY_V4_RECOVERY;
  const expectedMigrationCount = expected?.migrationCount ?? approved.migrationCount;
  const ledgerDigest = migrationLedgerDigest(migrationRows, expectedMigrationCount);
  if (ledgerDigest !== (expected?.ledgerDigest ?? approved.ledgerDigest)) {
    fail("Live database migration ledger differs from the exact approved release ledger.");
  }
  if (!database || database.name !== "bodycast" || !String(database.version).startsWith("17.")
    || !/^[a-f0-9]{64}$/.test(String(database.containerId))
    || !/^sha256:[a-f0-9]{64}$/.test(String(database.imageId))) fail("Production database identity is unknown or changed.");
  if (expected?.appMode === "maintenance-no-app") {
    if (!app || app.name !== "bodycast-app-prod" || app.state !== "absent"
      || app.health !== "absent" || app.releaseSha !== null || app.containerId !== null || app.imageId !== null) {
      fail("Cold-start recovery requires the exact maintenance/no-app production state.");
    }
  } else if (!app || app.name !== "bodycast-app-prod" || app.health !== "healthy"
    || app.releaseSha !== LEGACY_V4_RECOVERY.productionAppSha
    || !/^[a-f0-9]{64}$/.test(String(app.containerId))
    || !/^sha256:[a-f0-9]{64}$/.test(String(app.imageId))) fail("Serving BodyCast app identity is unknown, unhealthy, or changed.");
  const publishedGenerationValid = lifecycle?.unifiedPublishedGeneration === null
    || (Number.isSafeInteger(lifecycle?.unifiedPublishedGeneration) && lifecycle.unifiedPublishedGeneration >= 0);
  const publishedEpochValid = lifecycle?.unifiedPublishedRolloutEpoch === null
    || (Number.isSafeInteger(lifecycle?.unifiedPublishedRolloutEpoch) && lifecycle.unifiedPublishedRolloutEpoch >= 0);
  const earliestBlock = Array.isArray(blocks) ? [...blocks].sort((a, b) =>
    `${a.fromDate}\0${a.source}`.localeCompare(`${b.fromDate}\0${b.source}`))[0] : null;
  const allowAlreadyCurrentV4 = expected?.allowAlreadyCurrentV4 === true;
  const alreadyCurrentV4 = lifecycle?.productionStaleFromDate === null
    && lifecycle?.productionPublishedGeneration === lifecycle?.invalidationGeneration
    && lifecycle?.unifiedPublishedGeneration === lifecycle?.invalidationGeneration
    && lifecycle?.unifiedPublishedRolloutEpoch === lifecycle?.unifiedRolloutEpoch
    && lifecycle?.unifiedPublicationBlockedFromDate === null
    && lifecycle?.unifiedPublicationBlockedSource === null
    && Array.isArray(blocks) && blocks.length === 0;
  const staleWithPublicationFences = lifecycle?.productionPublishedGeneration !== lifecycle?.invalidationGeneration
    && isCalendarDate(lifecycle?.productionStaleFromDate)
    && Boolean(earliestBlock)
    && !(lifecycle?.unifiedPublishedGeneration === lifecycle?.invalidationGeneration
      && lifecycle?.unifiedPublishedRolloutEpoch === lifecycle?.unifiedRolloutEpoch)
    && lifecycle?.unifiedPublicationBlockedFromDate === earliestBlock?.fromDate
    && lifecycle?.unifiedPublicationBlockedSource === earliestBlock?.source;
  const publicationStateValid = allowAlreadyCurrentV4
    ? expected?.appMode === "maintenance-no-app" && expected?.migrationCount === 74
      && (alreadyCurrentV4 || staleWithPublicationFences)
    : staleWithPublicationFences;
  if (!isDigest(schemaSha256) || !isDigest(sourceFingerprint) || !isDigest(healthSyncAuditFingerprint) || !lifecycle
    || lifecycle.profileId !== 1 || lifecycle.unifiedRolloutEpoch !== 1
    || !Number.isSafeInteger(lifecycle.invalidationGeneration)
    || !Number.isSafeInteger(lifecycle.productionPublishedGeneration)
    || lifecycle.unifiedTargetRevision !== "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once"
    || !publishedGenerationValid || lifecycle.unifiedPublishedGeneration === undefined
    || !publishedEpochValid || lifecycle.unifiedPublishedRolloutEpoch === undefined
    || !publicationStateValid) {
    fail("Production V4 must be an exact current no-op or a fenced stale state with valid read-only source/schema evidence.");
  }
  validatePublicationSourceEvidence({ blocks, sourceEvidence });
  if (!expected || ledgerDigest !== expected.ledgerDigest
    || schemaSha256 !== expected.schemaSha256 || sourceFingerprint !== expected.sourceFingerprint
    || healthSyncAuditFingerprint !== expected.healthSyncAuditFingerprint
    || publicationBlockDigest(blocks) !== expected.blockDigest
    || database.containerId !== expected.database.containerId || database.imageId !== expected.database.imageId
    || (expected.appMode === "maintenance-no-app"
      ? expected.app?.state !== "absent"
      : app.containerId !== expected.app.containerId || app.imageId !== expected.app.imageId)) {
    fail("Production identity, applied history, schema, raw inputs, or source fences changed after backup rehearsal.");
  }
  return true;
}

const RECOVERED_V4_SERVE_TOOLING_PATHS = new Set([
  ".github/workflows/deploy-production.yml",
  "scripts/github-owner-identity.mjs",
  "scripts/production-v4-derived-recovery.mjs",
  "scripts/production-v4-recovered-release.sh",
  "tests/github-owner-identity.test.mjs",
  "tests/production-v4-derived-recovery.test.mjs",
  "tests/production-recovered-v4-serving-contract.test.ts",
]);

const RECOVERED_V4_SERVE_MAX_TOOLING_COMMITS = 5;

export function assertRecoveredV4ToolingOnlyDescendant({ recoveryWorkflowSha, releaseSha,
  lineageVerified, commitDistance, changedPaths }) {
  if (!isSha(recoveryWorkflowSha) || !isSha(releaseSha) || lineageVerified !== true
    || !Number.isSafeInteger(commitDistance) || commitDistance < 1 || commitDistance > RECOVERED_V4_SERVE_MAX_TOOLING_COMMITS
    || !Array.isArray(changedPaths) || changedPaths.some((file) => typeof file !== "string"
      || !RECOVERED_V4_SERVE_TOOLING_PATHS.has(file))
    || new Set(changedPaths).size !== changedPaths.length) {
    fail(`A later serving SHA is compatible with recovery only within ${RECOVERED_V4_SERVE_MAX_TOOLING_COMMITS} explicitly allowlisted tooling-only commits after the recovery SHA.`);
  }
  return true;
}

export function assertCompletedV4RecoveryForServe({ marker, releaseSha, migrationTree, prismaSchemaBlob,
  ledgerDigest, schemaSha256, sourceFingerprint, databaseContainerId, databaseImageId,
  schemaDigestContract, schemaDigestHelperSha256, runtimeCompatibilityProof }) {
  const target = marker?.targetSchema;
  const markerSchemaSha256 = marker?.schemaSha256 ?? marker?.schemaSha;
  const markerSchemaShaConsistent = marker?.schemaSha256 === undefined || marker?.schemaSha === undefined
    || marker.schemaSha256 === marker.schemaSha;
  const sourceModelDayKeys = marker?.sourceModelDayKeys;
  const coveredModelDayKeys = marker?.coveredModelDayKeys;
  const recoveryReleaseShaCompatible = marker?.workflowSha === releaseSha || (() => {
    try {
      assertRecoveredV4ToolingOnlyDescendant({
        recoveryWorkflowSha: marker?.workflowSha,
        releaseSha,
        lineageVerified: runtimeCompatibilityProof?.lineageVerified,
        commitDistance: runtimeCompatibilityProof?.commitDistance,
        changedPaths: runtimeCompatibilityProof?.changedPaths,
      });
      return runtimeCompatibilityProof.recoveryWorkflowSha === marker.workflowSha
        && runtimeCompatibilityProof.releaseSha === releaseSha;
    } catch {
      return false;
    }
  })();
  if (!marker || marker.state !== "completed" || marker.result !== "current"
    || marker.sourceSha !== LEGACY_V4_RECOVERY.sourceSha || !recoveryReleaseShaCompatible
    || !isSha(releaseSha) || marker.attempt !== "1" || !/^[1-9][0-9]*$/.test(String(marker.ownerRunId ?? ""))
    || marker.appMode !== "maintenance-no-app" || marker.rolloutEpoch !== 1
    || marker.unifiedTargetRevision !== "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once"
    || marker.unifiedPublicationBlockedFromDate !== null || marker.blocksRemaining !== 0
    || !Number.isSafeInteger(marker.unifiedPublishedGeneration)
    || marker.unifiedPublishedGeneration !== marker.productionPublishedGeneration
    || !isDigest(marker.sourceFingerprint) || marker.sourceFingerprint !== sourceFingerprint
    || !isDigest(marker.healthSyncAuditFingerprint)
    || !isDigest(marker.rehearsalCoverageSha256)
    || !isDigest(markerSchemaSha256) || !markerSchemaShaConsistent
    || marker.postflightSchemaSha256 !== markerSchemaSha256
    || marker.postflightSchemaSha256 !== schemaSha256
    || marker.schemaDigestContract !== schemaDigestContract
    || marker.schemaDigestHelperSha256 !== schemaDigestHelperSha256
    || marker.databaseContainerId !== databaseContainerId || marker.databaseImageId !== databaseImageId
    || !/^[a-f0-9]{64}$/.test(String(databaseContainerId ?? ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(databaseImageId ?? ""))
    || target?.mode !== "maintenance-no-app-74" || target?.migrationCount !== 74
    || target?.migrationTree !== migrationTree || target?.prismaSchemaBlob !== prismaSchemaBlob
    || target?.ledgerDigest !== ledgerDigest
    || !Array.isArray(sourceModelDayKeys) || sourceModelDayKeys.length < 1
    || !Array.isArray(coveredModelDayKeys)
    || marker.sourceModelDayCount !== sourceModelDayKeys.length
    || marker.coveredDayCount !== coveredModelDayKeys.length
    || sourceModelDayKeys.some((key) => typeof key !== "string" || !coveredModelDayKeys.includes(key))) {
    fail("Serving requires a completed, exact-SHA 74-migration V4 recovery with current raw/schema evidence.");
  }
  const sourceKeys = normalizedModelDayKeys(sourceModelDayKeys, "Completed recovery source coverage");
  const coveredKeys = normalizedModelDayKeys(coveredModelDayKeys, "Completed recovery publication coverage");
  if (sourceKeys.some((key) => !coveredKeys.includes(key))
    || modelDayKeysDigest(coveredKeys) !== marker.rehearsalCoverageSha256) {
    fail("Serving recovery marker does not bind complete rehearsal and publication coverage.");
  }
  return true;
}

export function assertOneShotRecoveryState({ marker, lockHeld, preflightRunId, preflightSha,
  preflightConclusion, preflightAgeSeconds, currentRunAttempt }) {
  if (currentRunAttempt !== "1" || lockHeld !== true) {
    fail("Recovery must be the first workflow attempt and hold the exclusive production release lock.");
  }
  if (!marker || marker.state !== "ready" || marker.sourceSha !== LEGACY_V4_RECOVERY.sourceSha
    || marker.preflightRunId !== preflightRunId || marker.workflowSha !== preflightSha
    || marker.terminal === true || marker.startedAt) {
    fail("Recovery marker is absent, mismatched, already started, or terminal; automatic retry is forbidden.");
  }
  if (!/^[1-9][0-9]*$/.test(String(preflightRunId)) || preflightConclusion !== "success"
    || !Number.isSafeInteger(preflightAgeSeconds) || preflightAgeSeconds < 0 || preflightAgeSeconds > 3600) {
    fail("A successful preflight rehearsal less than one hour old is required.");
  }
  return true;
}

export function assertSchemaSignature({ observed, expected, objectCount }) {
  if (!isDigest(observed) || !isDigest(expected) || observed !== expected
    || !Number.isSafeInteger(objectCount) || objectCount < 1) {
    fail("Live PostgreSQL schema signature differs from the rehearsed exact 65-migration schema.");
  }
  return true;
}

export function assertRecoveryPostflight({ beforeFingerprint, afterFingerprint, beforeHealthSyncAuditFingerprint,
  afterHealthSyncAuditFingerprint, lifecycle, blocks,
  coveredModelDayCount, expectedModelDayCount, coveredModelDayKeys, expectedModelDayKeys,
  rehearsalCoveredModelDayKeys, rehearsalCoverageSha256, existingEpoch }) {
  assertRehearsedCoverageEvidence({ sourceModelDayKeys: expectedModelDayKeys,
    coveredModelDayKeys: rehearsalCoveredModelDayKeys, coverageSha256: rehearsalCoverageSha256 });
  const normalizedActualCoverage = normalizedModelDayKeys(coveredModelDayKeys, "Published V4 coverage");
  const normalizedRehearsalCoverage = normalizedModelDayKeys(rehearsalCoveredModelDayKeys, "Rehearsed V4 coverage");
  if (!isDigest(beforeFingerprint) || beforeFingerprint !== afterFingerprint) fail("Strict persisted raw-source fingerprint changed during recovery.");
  if (!isDigest(beforeHealthSyncAuditFingerprint) || beforeHealthSyncAuditFingerprint !== afterHealthSyncAuditFingerprint) {
    fail("HealthSyncAudit payload preservation fingerprint changed during recovery.");
  }
  if (existingEpoch !== 1 || lifecycle?.unifiedRolloutEpoch !== 1
    || lifecycle.productionStaleFromDate !== null
    || lifecycle.invalidationGeneration !== lifecycle.productionPublishedGeneration
    || lifecycle.unifiedTargetRevision !== "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once"
    || lifecycle.unifiedPublishedGeneration !== lifecycle.invalidationGeneration
    || lifecycle.unifiedPublishedRolloutEpoch !== 1
    || lifecycle.unifiedPublicationBlockedFromDate !== null
    || blocks !== 0 || !Number.isSafeInteger(expectedModelDayCount) || expectedModelDayCount < 1
    || !Number.isSafeInteger(coveredModelDayCount) || coveredModelDayCount < expectedModelDayCount
    || !Array.isArray(expectedModelDayKeys) || !Array.isArray(coveredModelDayKeys)
    || expectedModelDayKeys.length !== expectedModelDayCount || coveredModelDayKeys.length !== coveredModelDayCount
    || expectedModelDayKeys.some((key) => !isModelDayKey(key)) || coveredModelDayKeys.some((key) => !isModelDayKey(key))
    || new Set(expectedModelDayKeys).size !== expectedModelDayKeys.length
    || new Set(coveredModelDayKeys).size !== coveredModelDayKeys.length
    || expectedModelDayKeys.some((key) => !coveredModelDayKeys.includes(key))
    || JSON.stringify(normalizedActualCoverage) !== JSON.stringify(normalizedRehearsalCoverage)) {
    fail("V7/V4 postflight is not CURRENT with exact rehearsed coverage and zero blocks.");
  }
  return true;
}

function isModelDayKey(value) {
  if (typeof value !== "string") return false;
  const separator = value.indexOf("|");
  if (separator < 1 || !/^[1-9][0-9]*$/.test(value.slice(0, separator))) return false;
  const date = value.slice(separator + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
