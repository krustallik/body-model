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
    const date = typeof block.fromDate === "string" ? new Date(`${block.fromDate}T00:00:00.000Z`) : null;
    const health = block.source === "health" && block.sourceKey === block.fromDate
      && /^\d{4}-\d{2}-\d{2}$/.test(String(block.fromDate))
      && date !== null && Number.isFinite(date.getTime())
      && date.toISOString().slice(0, 10) === block.fromDate;
    const training = block.source === "training" && /^[1-9][0-9]*$/.test(String(block.sourceKey));
    if ((!health && !training) || !Number.isSafeInteger(block.revision) || block.revision < 1) {
      fail("Publication fence set contains an unsupported or malformed source.");
    }
  }
  const training = sorted.filter((block) => block.source === "training");
  const health = sorted.filter((block) => block.source === "health");
  if (health.length !== 8 || training.length !== 1 || training[0].sourceKey !== "20") {
    fail("Current persisted fence set must contain exactly 8 Health dates and Training session 20.");
  }
  return sha256(sorted.map((block) => [block.source, block.sourceKey, block.fromDate, block.revision].join("\t") + "\n").join(""));
}

export function assertProductionIdentity({ database, app, migrationRows, schemaSha256, sourceFingerprint,
  lifecycle, blocks, sourceRowsValid, expected }) {
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
  if (!isDigest(schemaSha256) || !isDigest(sourceFingerprint) || !lifecycle
    || lifecycle.profileId !== 1 || lifecycle.unifiedRolloutEpoch !== 1
    || !Number.isSafeInteger(lifecycle.invalidationGeneration)
    || lifecycle.productionPublishedGeneration === lifecycle.invalidationGeneration) {
    fail("Production V4 must be epoch 1 and stale with valid read-only source/schema evidence.");
  }
  if (!sourceRowsValid || !expected || ledgerDigest !== expected.ledgerDigest
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
