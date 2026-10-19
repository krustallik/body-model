import { createHash } from "node:crypto";

export const LEGACY_V4_RECOVERY = Object.freeze({
  repository: "krustallik/body-model",
  pullRequest: 101,
  branch: "codex/v4-recovery-audit",
  baseSha: "f910d2a45dfa676fada5fab42c9e8946c97872b1",
  sourceSha: "3968154f965597843b6a2c429fff178c0f1ac54c",
  productionAppSha: "f910d2a45dfa676fada5fab42c9e8946c97872b1",
  migrationCount: 65,
  migrationTree: "291b9c95924e196d66f9cdd555535b2e5a2b5990",
  ledgerDigest: "a4153cad028db966759935cb997b15ac3c6f1670dfc9ebd8a114f6b9520746a7",
  prismaSchemaBlob: "4fa84cb62262986d5f0c58d3c76db2ba52b5500e",
  ownerId: "126446430",
  confirmation: "RECOVER_UNIFIED_V4_FROM_PERSISTED_SOURCES_PROFILE_1_AT_3968154f965597843b6a2c429fff178c0f1ac54c",
  command: Object.freeze([
    "node", "/app/dist/production-full-history-recalculate.mjs", "--derived-v4-recovery",
    "--owner-authorized", "--profile-id", "1",
  ]),
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

export function migrationLedgerDigest(rows) {
  if (!Array.isArray(rows) || rows.length !== LEGACY_V4_RECOVERY.migrationCount) {
    fail("Production or rehearsal migration ledger does not contain exactly 65 migrations.");
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

export function assertApprovedRecoveryRuns({
  actorId, confirmation, runAttempt, repository, workflowRef, workflowPath,
  workflowSha, currentMainSha, sourceSha, sourcePr, ciRuns, safetyRuns,
  mainCiRuns,
}) {
  const approved = LEGACY_V4_RECOVERY;
  if (String(actorId) !== approved.ownerId || confirmation !== approved.confirmation || runAttempt !== "1"
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

export function assertArtifactBinding({ sourceSha, imageId, imageDigest, archiveSha256, manifestSha256,
  migrationTree, prismaSchemaBlob, effectiveCommand, ledgerRows }) {
  const approved = LEGACY_V4_RECOVERY;
  if (sourceSha !== approved.sourceSha || !/^sha256:[a-f0-9]{64}$/.test(String(imageId))
    || !/^sha256:[a-f0-9]{64}$/.test(String(imageDigest))
    || !isDigest(archiveSha256) || migrationTree !== approved.migrationTree
    || prismaSchemaBlob !== approved.prismaSchemaBlob
    || JSON.stringify(effectiveCommand) !== JSON.stringify(approved.command)) {
    fail("Recovery artifact SHA, immutable image/archive identity, schema, or entrypoint is not approved.");
  }
  const ledgerDigest = migrationLedgerDigest(ledgerRows);
  if (ledgerDigest !== approved.ledgerDigest) fail("Recovery artifact migration rows do not match the exact audited 65-migration ledger.");
  const manifest = { sourceSha, imageId, imageDigest, archiveSha256, migrationTree, prismaSchemaBlob, effectiveCommand, ledgerDigest };
  if (manifestSha256 !== sha256(JSON.stringify(manifest))) fail("Recovery artifact provenance manifest digest does not match its contents.");
  return ledgerDigest;
}

export function publicationBlockDigest(blocks) {
  if (!Array.isArray(blocks) || blocks.length < 1) fail("No persisted publication fences were captured.");
  const sorted = [...blocks].sort((a, b) => `${a.source}\0${a.sourceKey}`.localeCompare(`${b.source}\0${b.sourceKey}`));
  const identities = new Set();
  for (const block of sorted) {
    const identity = `${block.source}\0${block.sourceKey}`;
    if (identities.has(identity)) fail("Publication fence set contains duplicate source identities.");
    identities.add(identity);
    const validDate = isCalendarDate(block.fromDate);
    const health = block.source === "health" && block.sourceKey === block.fromDate && validDate;
    const training = block.source === "training" && /^[1-9][0-9]*$/.test(String(block.sourceKey)) && validDate;
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
  const training = sorted.filter((block) => block.source === "training");
  const health = sorted.filter((block) => block.source === "health");
  if (health.length < 1 || training.length !== 1 || training[0].sourceKey !== "20") {
    fail("Current persisted fence set must contain one or more Health dates and only Training session 20.");
  }
  return sha256(sorted.map((block) => [block.source, block.sourceKey, block.fromDate, block.revision].join("\t") + "\n").join(""));
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

  const trainingBlocks = blocks.filter((block) => block.source === "training");
  const training = sourceEvidence?.training;
  const trainingBlock = trainingBlocks[0];
  if (!training || trainingBlocks.length !== 1 || training.sourceKey !== trainingBlock.sourceKey
    || training.fromDate !== trainingBlock.fromDate || training.fenceRevision !== trainingBlock.revision
    || training.sessionRows !== 1 || training.sessionId !== 20 || training.profileId !== 1
    || training.status !== "COMPLETED" || !Number.isSafeInteger(training.sourceRevision) || training.sourceRevision < 1
    || !Number.isSafeInteger(training.accountingInputRevision) || training.accountingInputRevision < 1
    || !Number.isSafeInteger(training.currentSnapshotRevision) || training.currentSnapshotRevision < 1
    || training.accountingSnapshotRows !== 1 || training.snapshotRevision !== training.currentSnapshotRevision
    || training.snapshotAccountingInputRevision !== training.accountingInputRevision
    || !isCalendarDate(training.accountingEffectiveLocalDate)
    || !isTimestamp(training.effectiveAccountingAt) || !isValidTimeZone(training.accountingTimeZone)
    || !["client-session", "legacy-default"].includes(training.accountingTimeZoneProvenance)
    || !isCalendarDate(training.snapshotEffectiveLocalDate)
    || training.snapshotEffectiveLocalDate !== training.accountingEffectiveLocalDate
    || training.snapshotTimeZone !== training.accountingTimeZone || !training.snapshotTimeZoneValid
    || training.snapshotTimeZoneProvenance !== training.accountingTimeZoneProvenance
    || training.snapshotContractValid !== true || !isDigest(training.snapshotEvidenceSha256)
    || training.matchStatus !== "MATCHED" || !Number.isSafeInteger(training.matchedWorkoutId) || training.matchedWorkoutId < 1
    || training.matchedWorkoutPresent !== true || training.matchedWorkoutIdentityMatches !== true
    || training.modelDate !== trainingBlock.fromDate
    || !isCalendarDate(training.modelDate) || training.chronologyValid !== true) {
    fail("Training session 20 is missing its current persisted source, accounting snapshot, model date, or revision chronology.");
  }
  return true;
}

export function assertProductionIdentity({ database, app, migrationRows, schemaSha256, sourceFingerprint,
  lifecycle, blocks, sourceEvidence, expected }) {
  const approved = LEGACY_V4_RECOVERY;
  const ledgerDigest = migrationLedgerDigest(migrationRows);
  if (ledgerDigest !== approved.ledgerDigest) fail("Live database migration ledger differs from the exact approved legacy ledger.");
  if (!database || database.name !== "bodycast" || !String(database.version).startsWith("17.")
    || !/^[a-f0-9]{64}$/.test(String(database.containerId))
    || !/^sha256:[a-f0-9]{64}$/.test(String(database.imageId))) fail("Production database identity is unknown or changed.");
  if (!app || app.name !== "bodycast-app-prod" || app.health !== "healthy"
    || app.releaseSha !== LEGACY_V4_RECOVERY.productionAppSha
    || !/^[a-f0-9]{64}$/.test(String(app.containerId))
    || !/^sha256:[a-f0-9]{64}$/.test(String(app.imageId))) fail("Serving BodyCast app identity is unknown, unhealthy, or changed.");
  const publishedGenerationValid = lifecycle?.unifiedPublishedGeneration === null
    || (Number.isSafeInteger(lifecycle?.unifiedPublishedGeneration) && lifecycle.unifiedPublishedGeneration >= 0);
  const publishedEpochValid = lifecycle?.unifiedPublishedRolloutEpoch === null
    || (Number.isSafeInteger(lifecycle?.unifiedPublishedRolloutEpoch) && lifecycle.unifiedPublishedRolloutEpoch >= 0);
  const earliestBlock = Array.isArray(blocks) ? [...blocks].sort((a, b) =>
    `${a.fromDate}\0${a.source}`.localeCompare(`${b.fromDate}\0${b.source}`))[0] : null;
  if (!isDigest(schemaSha256) || !isDigest(sourceFingerprint) || !lifecycle
    || lifecycle.profileId !== 1 || lifecycle.unifiedRolloutEpoch !== 1
    || !Number.isSafeInteger(lifecycle.invalidationGeneration)
    || !Number.isSafeInteger(lifecycle.productionPublishedGeneration)
    || lifecycle.productionPublishedGeneration === lifecycle.invalidationGeneration
    || lifecycle.unifiedTargetRevision !== "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once"
    || !publishedGenerationValid || lifecycle.unifiedPublishedGeneration === undefined
    || !publishedEpochValid || lifecycle.unifiedPublishedRolloutEpoch === undefined
    || (lifecycle.unifiedPublishedGeneration === lifecycle.invalidationGeneration
      && lifecycle.unifiedPublishedRolloutEpoch === lifecycle.unifiedRolloutEpoch)
    || !earliestBlock || lifecycle.unifiedPublicationBlockedFromDate !== earliestBlock.fromDate
    || lifecycle.unifiedPublicationBlockedSource !== earliestBlock.source) {
    fail("Production V4 must be epoch 1 and stale with valid read-only source/schema evidence.");
  }
  validatePublicationSourceEvidence({ blocks, sourceEvidence });
  if (!expected || ledgerDigest !== expected.ledgerDigest
    || schemaSha256 !== expected.schemaSha256 || sourceFingerprint !== expected.sourceFingerprint
    || publicationBlockDigest(blocks) !== expected.blockDigest
    || database.containerId !== expected.database.containerId || database.imageId !== expected.database.imageId
    || app.containerId !== expected.app.containerId || app.imageId !== expected.app.imageId) {
    fail("Production identity, applied history, schema, raw inputs, or source fences changed after backup rehearsal.");
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

export function assertRecoveryPostflight({ beforeFingerprint, afterFingerprint, lifecycle, blocks,
  coveredDayCount, persistedDayCount, coveredDates, persistedDates, existingEpoch }) {
  if (!isDigest(beforeFingerprint) || beforeFingerprint !== afterFingerprint) fail("Strict persisted raw-source fingerprint changed during recovery.");
  if (existingEpoch !== 1 || lifecycle?.unifiedRolloutEpoch !== 1
    || lifecycle.productionStaleFromDate !== null
    || lifecycle.invalidationGeneration !== lifecycle.productionPublishedGeneration
    || lifecycle.unifiedTargetRevision !== "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once"
    || lifecycle.unifiedPublishedGeneration !== lifecycle.invalidationGeneration
    || lifecycle.unifiedPublishedRolloutEpoch !== 1
    || lifecycle.unifiedPublicationBlockedFromDate !== null
    || blocks !== 0 || !Number.isSafeInteger(persistedDayCount) || persistedDayCount < 1
    || coveredDayCount !== persistedDayCount || !Array.isArray(persistedDates) || !Array.isArray(coveredDates)
    || persistedDates.length !== persistedDayCount || coveredDates.length !== coveredDayCount
    || new Set(persistedDates).size !== persistedDates.length || new Set(coveredDates).size !== coveredDates.length
    || JSON.stringify([...persistedDates].sort()) !== JSON.stringify([...coveredDates].sort())) {
    fail("V7/V4 postflight is not CURRENT with exact persisted-date coverage and zero blocks.");
  }
  return true;
}
