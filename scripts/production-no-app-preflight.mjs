import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSha256 } from "./production-migration-authorization.mjs";
import { V4_REPUBLICATION_MANIFEST } from "./production-migration-manifests.mjs";
import { parsePreviousAppProvenance, previousAppDatabaseCompatibilityDigests } from "./production-previous-app-provenance.mjs";
import { validateCaptureResumeReceipt } from "./production-capture-resume-receipt.mjs";
import { assertFreshWriterDrain } from "./production-writer-drain.mjs";
import { assertPostgresClientCompatibility } from "./postgres-client-versions.mjs";

export const NO_APP_PREFLIGHT_EVIDENCE_KIND = "database-only-no-app-v1";
export const NO_APP_CAPTURE_LINEAGE = Object.freeze({
  sourceRunId: "38205023003",
  sourceRunAttempt: 1,
  sourceSha: "fe55468321b9ef8e9783aa3874e1b42c2736b514",
  resumeRunId: "38211169161",
  resumeRunAttempt: 1,
  resumeSha: "3ede9e1644616e65edb3ac29a49df2f109786942",
  rollbackImagePin: "bodycast-app:rollback-preflight-38205023003-1",
});
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const RUN_ID = /^[1-9][0-9]*$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const EXPECTED_PENDING = Object.freeze(V4_REPUBLICATION_MANIFEST.migrations.map(({ name }) => name).sort());

function reject(message) { throw new Error(`No-app production preflight blocked: ${message}`); }

// These fields identify an observation, not the underlying production state. They
// must be fresh on every capture and are independently freshness-checked at the
// dump boundary. Keep every substantive writer/topology field in the comparison.
export function stableNoAppSnapshot(value) {
  const writerDrain = structuredClone(value.report.writerDrain);
  writerDrain.observerPid = null;
  writerDrain.observedAt = null;
  writerDrain.topology.observedAt = null;
  return {
    identity: value.report.identity, migrations: value.report.migrations, objects: value.report.objects,
    tables: value.report.tables, logicalDataFingerprint: value.report.logicalDataFingerprint,
    writerDrain,
    conflictingLocks: value.report.conflictingLocks,
    preparedTransactions: value.report.preparedTransactions,
    routeSha: value.preparationResult.maintenanceRouteDigest,
    routeMarkerDigest: value.preparationResult.maintenanceMarkerDigest,
    captureLineageDigest: value.preparationResult.captureLineageDigest,
    pendingSetDigest: value.preparationResult.pendingSetDigest,
    productionDatabaseContainerId: value.preparationResult.productionDatabaseContainerId,
    postgresClientVersions: value.postgresClientVersions,
  };
}

export function assertNoCompetingProductionRuns(runs, { currentRunId } = {}) {
  if (!Array.isArray(runs) || !RUN_ID.test(String(currentRunId ?? ""))) reject("complete production workflow inventory is missing.");
  const competing = runs.filter((run) => String(run?.id) !== String(currentRunId)
    && ["queued", "in_progress", "requested", "waiting", "pending"].includes(run?.status));
  if (competing.length) reject("another production workflow is active or queued.");
  return true;
}

export function reconcileNoAppCaptureLineage({
  currentRecordText, archivedRecordText, currentReceipt, githubReceipt, databaseReport, captureHistoryProof,
  pinnedImageId,
} = {}) {
  if (!captureHistoryProof || captureHistoryProof.schemaVersion !== 2
    || String(captureHistoryProof.sourceRunId) !== NO_APP_CAPTURE_LINEAGE.resumeRunId
    || !Array.isArray(captureHistoryProof.safeCaptureGuardPreflightRunIds)
    || !["38213907625", "38214147022"].every((id) => captureHistoryProof.safeCaptureGuardPreflightRunIds.includes(id))
    || !Array.isArray(captureHistoryProof.captureGuardPreflightEffects)
    || !["38213907625", "38214147022"].every((id) => {
      const matches = captureHistoryProof.captureGuardPreflightEffects.filter((effect) => effect?.runId === id);
      return matches.length === 1 && /^([a-f0-9]{40})$/.test(String(matches[0].sha ?? ""))
        && matches[0].maintenanceRoutePublishedAndPublic503Confirmed === true
        && matches[0].oldAppStopReached === false
        && matches[0].productionDatabaseInspectionReached === false
        && matches[0].pgDumpStarted === false && matches[0].artifactsPublished === false;
    })
    || captureHistoryProof.captureGuardPreflightEffects.length !== 2
    || !Array.isArray(captureHistoryProof.safePreMaintenanceDeployRunIds)
    || !captureHistoryProof.safePreMaintenanceDeployRunIds.includes("38226427716")
    || JSON.stringify([...(captureHistoryProof.pendingMigrationIds ?? [])].sort()) !== JSON.stringify(EXPECTED_PENDING)
    || captureHistoryProof.historicalV2?.preflightRunId !== "38068531599"
    || captureHistoryProof.historicalV2?.preflightSha !== "62b6961dde7036100c8af7281e7bfab75bb662db"
    || captureHistoryProof.historicalV2?.manifestId !== "active-energy-unified-v2"
    || captureHistoryProof.historicalV2?.migrationRunId !== "38069108209"
    || captureHistoryProof.historicalV2?.migrationSha !== "62b6961dde7036100c8af7281e7bfab75bb662db"
    || captureHistoryProof.historicalV2?.noV2ArtifactReuseForV4 !== true
    || !/^sha256:[a-f0-9]{64}$/.test(String(captureHistoryProof.historicalV2?.backupArtifactDigest ?? ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(captureHistoryProof.historicalV2?.evidenceArtifactDigest ?? ""))
    || captureHistoryProof.captureRefresh?.runId !== NO_APP_CAPTURE_LINEAGE.sourceRunId
    || captureHistoryProof.captureRefresh?.releaseSha !== NO_APP_CAPTURE_LINEAGE.sourceSha
    || captureHistoryProof.captureRefresh?.failureBoundary !== "isolated-restore-before-artifact-upload"
    || captureHistoryProof.captureRefresh?.artifactsPublished !== false) {
    reject("exact owner-run history does not prove the V4 lineage and the later maintenance-route publication/capture-guard failure boundary.");
  }
  if (typeof currentRecordText !== "string" || typeof archivedRecordText !== "string"
    || typeof githubReceipt !== "object" || typeof currentReceipt !== "object") {
    reject("current capture, preserved archive, or independently collected resume receipt is missing.");
  }

  let sourceRecord; let currentRecord;
  try {
    sourceRecord = parsePreviousAppProvenance(archivedRecordText);
    currentRecord = parsePreviousAppProvenance(currentRecordText);
  } catch {
    reject("capture record or preserved source archive is malformed.");
  }
  if (sourceRecord.targetSha !== NO_APP_CAPTURE_LINEAGE.sourceSha
    || currentRecord.targetSha !== NO_APP_CAPTURE_LINEAGE.resumeSha
    || sourceRecord.schemaVersion !== 3 || currentRecord.schemaVersion !== 3
    || sourceRecord.previousImagePin !== NO_APP_CAPTURE_LINEAGE.rollbackImagePin
    || currentRecord.previousImagePin !== NO_APP_CAPTURE_LINEAGE.rollbackImagePin) {
    reject("capture record does not match the exact V4 refresh and resume runs.");
  }
  const sourceIdentity = { ...sourceRecord };
  const currentIdentity = { ...currentRecord };
  delete sourceIdentity.targetSha;
  delete currentIdentity.targetSha;
  if (canonicalSha256(sourceIdentity) !== canonicalSha256(currentIdentity)) {
    reject("current record differs from the preserved source capture beyond its exact target-SHA rebind.");
  }

  let receipt;
  try {
    receipt = validateCaptureResumeReceipt(currentReceipt, {
      mode: "ordinary",
      sourceRunId: NO_APP_CAPTURE_LINEAGE.sourceRunId,
      sourceRunAttempt: NO_APP_CAPTURE_LINEAGE.sourceRunAttempt,
      sourceSha: NO_APP_CAPTURE_LINEAGE.sourceSha,
      targetSha: NO_APP_CAPTURE_LINEAGE.resumeSha,
      captureRunId: NO_APP_CAPTURE_LINEAGE.resumeRunId,
      captureRunAttempt: NO_APP_CAPTURE_LINEAGE.resumeRunAttempt,
      sourceRecordDigest: canonicalSha256(sourceRecord),
      currentRecordDigest: canonicalSha256(currentRecord),
      compatibilityDigest: previousAppDatabaseCompatibilityDigests(databaseReport).compatibilityDigest,
    });
    validateCaptureResumeReceipt(githubReceipt, receipt);
  } catch {
    reject("host and GitHub resume receipts do not bind the exact current and archived capture records.");
  }

  if (!DIGEST.test(String(receipt.compatibilityDigest ?? ""))
    || currentRecord.preDdlDatabaseCompatibilityDigest !== receipt.compatibilityDigest
    || !IMAGE_ID.test(String(currentRecord.previousImageId ?? ""))
    || pinnedImageId !== currentRecord.previousImageId) {
    reject("current DB compatibility or attempt-bound image-pin identity differs from the host capture record.");
  }
  return Object.freeze({
    schemaVersion: 1,
    evidenceBasis: "host-current-record-plus-preserved-archive-and-owner-run-receipt",
    githubArtifactDigestAvailable: false,
    sourceRunId: NO_APP_CAPTURE_LINEAGE.sourceRunId,
    sourceRunAttempt: NO_APP_CAPTURE_LINEAGE.sourceRunAttempt,
    sourceSha: NO_APP_CAPTURE_LINEAGE.sourceSha,
    resumeRunId: NO_APP_CAPTURE_LINEAGE.resumeRunId,
    resumeRunAttempt: NO_APP_CAPTURE_LINEAGE.resumeRunAttempt,
    resumeSha: NO_APP_CAPTURE_LINEAGE.resumeSha,
    sourceRecordDigest: canonicalSha256(sourceRecord),
    currentRecordDigest: canonicalSha256(currentRecord),
    resumeReceiptDigest: canonicalSha256(receipt),
    historyProofDigest: canonicalSha256(captureHistoryProof),
    historyProvenance: Object.freeze({
      safePreflightRetryRunIds: [...captureHistoryProof.safeCaptureGuardPreflightRunIds].sort(),
      captureGuardPreflightEffects: captureHistoryProof.captureGuardPreflightEffects,
      safePreMaintenanceDeployRunIds: [...captureHistoryProof.safePreMaintenanceDeployRunIds].sort(),
      historicalV2: captureHistoryProof.historicalV2,
      captureRefresh: captureHistoryProof.captureRefresh,
    }),
    rollbackImagePin: NO_APP_CAPTURE_LINEAGE.rollbackImagePin,
    rollbackImageMatchesRecord: true,
    appRuntime: "unavailable",
    previousAppRecovery: "unverified",
    rollbackReadiness: "unverified",
  });
}

export function verifyPublicMaintenanceProbe({ status, body, maintenanceMarker, cacheControl } = {}) {
  if (status !== 503 || !["BodyCast is temporarily unavailable while the model is updated.",
    "BodyCast is temporarily unavailable while the model is updated.\n"].includes(body)
    || typeof maintenanceMarker !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(maintenanceMarker)
    || typeof cacheControl !== "string" || cacheControl.toLowerCase() !== "no-store") {
    reject("public endpoint is not the exact uncached maintenance response.");
  }
  return Object.freeze({ status: 503, maintenanceMarker, cacheControl: "no-store", verified: true });
}

export function verifyNoAppLiveState({
  releaseSha, canonicalMainSha, manifestId, preflightResult, report, appContainerIds, routeMarker, routeSha,
  publicProbe, releaseMarkerState, captureLineage, competingRunCount, postgresClientVersions,
  databaseContainerId, now = Date.now(),
} = {}) {
  if (!SHA.test(String(releaseSha ?? "")) || releaseSha !== canonicalMainSha) reject("release SHA is not exact canonical main.");
  if (manifestId !== V4_REPUBLICATION_MANIFEST.id) reject("no-app preparation is limited to the closed V4 republication manifest.");
  if (preflightResult?.manifestId !== manifestId || preflightResult?.readyForOwnerAuthorization !== true
    || preflightResult?.pendingExactlyExpected !== true
    || JSON.stringify(preflightResult?.pending) !== JSON.stringify(EXPECTED_PENDING)
    || preflightResult?.blockers?.length !== 0
    || !Array.isArray(preflightResult?.blobIntegrity)
    || preflightResult.blobIntegrity.some((entry) => entry?.matches !== true)
    || V4_REPUBLICATION_MANIFEST.migrations.some((migration) => {
      const matches = preflightResult.blobIntegrity.filter((entry) => entry?.name === migration.name);
      return matches.length !== 1 || matches[0].expectedSha256 !== migration.sha256
        || matches[0].actualSha256 !== migration.sha256;
    })
    || canonicalSha256(preflightResult.identity) !== canonicalSha256(report?.identity)
    || preflightResult.logicalDataFingerprint !== report?.logicalDataFingerprint
    || canonicalSha256(preflightResult.writerDrain) !== canonicalSha256(report?.writerDrain)
    || preflightResult.writerDrainReady !== true) {
    reject("read-only database, schema, migration, writer, lock, or exact-pending-set checks are not ready.");
  }
  if (!report || !Array.isArray(appContainerIds) || appContainerIds.length !== 0) reject("an app container exists or app inventory is unknown.");
  if (!/^[a-f0-9]{64}$/.test(String(databaseContainerId ?? ""))) reject("production PostgreSQL container identity is missing or malformed.");
  let clientVersionCompatibility;
  try {
    clientVersionCompatibility = assertPostgresClientCompatibility(postgresClientVersions?.pgDump, postgresClientVersions?.pgRestore);
  } catch {
    reject("production pg_dump is not compatible with the pinned pg_restore client.");
  }
  let writerDrain;
  try {
    writerDrain = assertFreshWriterDrain(report, { now, maxAgeMs: 30_000 });
  } catch {
    reject("writer, lock, database topology, or maintenance-route evidence is stale or not ready.");
  }
  if (releaseMarkerState !== "absent") reject("a release/recovery marker exists or its state is unknown.");
  if (!DIGEST.test(String(routeSha ?? "")) || routeSha !== report?.writerDrain?.topology?.routeFile?.sha256
    || routeMarker !== publicProbe?.maintenanceMarker
    || publicProbe?.verified !== true || publicProbe?.status !== 503 || publicProbe?.cacheControl !== "no-store") {
    reject("existing maintenance route and public 503 evidence are inconsistent.");
  }
  if (!captureLineage || captureLineage.schemaVersion !== 1
    || captureLineage.evidenceBasis !== "host-current-record-plus-preserved-archive-and-owner-run-receipt"
    || captureLineage.githubArtifactDigestAvailable !== false
    || captureLineage.sourceRunId !== NO_APP_CAPTURE_LINEAGE.sourceRunId
    || captureLineage.sourceRunAttempt !== NO_APP_CAPTURE_LINEAGE.sourceRunAttempt
    || captureLineage.sourceSha !== NO_APP_CAPTURE_LINEAGE.sourceSha
    || captureLineage.resumeRunId !== NO_APP_CAPTURE_LINEAGE.resumeRunId
    || captureLineage.resumeRunAttempt !== NO_APP_CAPTURE_LINEAGE.resumeRunAttempt
    || captureLineage.resumeSha !== NO_APP_CAPTURE_LINEAGE.resumeSha
    || !DIGEST.test(String(captureLineage.sourceRecordDigest ?? ""))
    || !DIGEST.test(String(captureLineage.currentRecordDigest ?? ""))
    || !DIGEST.test(String(captureLineage.resumeReceiptDigest ?? ""))
    || !DIGEST.test(String(captureLineage.historyProofDigest ?? ""))
    || !captureLineage.historyProvenance?.historicalV2
    || !captureLineage.historyProvenance?.captureRefresh
    || captureLineage.rollbackImagePin !== NO_APP_CAPTURE_LINEAGE.rollbackImagePin
    || captureLineage.rollbackImageMatchesRecord !== true
    || captureLineage.rollbackReadiness !== "unverified" || captureLineage.previousAppRecovery !== "unverified"
    || captureLineage.appRuntime !== "unavailable" || captureLineage.rollbackImageMatchesRecord !== true) {
    reject("capture lineage is stale, unknown, or does not match its image pin.");
  }
  if (!Number.isSafeInteger(competingRunCount) || competingRunCount !== 0) reject("another production workflow is active or queued.");
  return Object.freeze({ writerDrain, preparationAllowed: true, databaseContainerId, routeSha, publicProbe,
    postgresClientVersions: Object.freeze({ ...postgresClientVersions, ...clientVersionCompatibility }) });
}

export function createNoAppPreparationResult({ releaseSha, manifestId, databasePreflightResult, report,
  liveState, captureLineage } = {}) {
  if (!liveState?.preparationAllowed || databasePreflightResult?.readyForOwnerAuthorization !== true
    || manifestId !== V4_REPUBLICATION_MANIFEST.id || !SHA.test(String(releaseSha ?? ""))
    || !report?.identity || !DIGEST.test(String(databasePreflightResult.logicalDataFingerprint ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(liveState.databaseContainerId ?? ""))
    || captureLineage?.schemaVersion !== 1
    || !DIGEST.test(String(captureLineage?.currentRecordDigest ?? ""))
    || !DIGEST.test(String(captureLineage?.resumeReceiptDigest ?? ""))
    || captureLineage?.appRuntime !== "unavailable"
    || captureLineage?.previousAppRecovery !== "unverified"
    || captureLineage?.rollbackReadiness !== "unverified") {
    reject("no-app preparation gates have not all passed.");
  }
  const pending = [...databasePreflightResult.pending].sort();
  return Object.freeze({
    schemaVersion: 1,
    evidenceKind: NO_APP_PREFLIGHT_EVIDENCE_KIND,
    preparationVerified: true,
    releaseSha,
    manifestId,
    pendingMigrationNames: pending,
    pendingSetDigest: canonicalSha256(pending),
    databasePreflightResultDigest: canonicalSha256(databasePreflightResult),
    productionIdentityDigest: canonicalSha256(report.identity),
    productionDatabaseContainerId: liveState.databaseContainerId,
    logicalDataFingerprint: databasePreflightResult.logicalDataFingerprint,
    writerDrainDigest: canonicalSha256(report.writerDrain),
    writerTopologyDigest: canonicalSha256(report.writerDrain.topology),
    maintenanceRouteDigest: liveState.routeSha,
    maintenanceMarkerDigest: canonicalSha256(liveState.publicProbe.maintenanceMarker),
    captureLineageDigest: canonicalSha256(captureLineage),
    captureHistoryProofDigest: captureLineage.historyProofDigest,
    captureHistoryProvenance: captureLineage.historyProvenance,
    postgresClientVersions: liveState.postgresClientVersions,
    appRuntime: "unavailable",
    previousAppProvenance: null,
    previousAppRecovery: "unverified",
    rollbackReadiness: "unverified",
    readyForOwnerAuthorization: false,
    ddlAuthorization: false,
    blockers: [],
  });
}

export function createNoAppPreparationEvidence({ preparationResult, restoreResult, pgDumpInvocationAt, backupBytes, context } = {}) {
  if (preparationResult?.evidenceKind !== NO_APP_PREFLIGHT_EVIDENCE_KIND
    || preparationResult.preparationVerified !== true || preparationResult.readyForOwnerAuthorization !== false
    || preparationResult.ddlAuthorization !== false || preparationResult.previousAppProvenance !== null
    || preparationResult.rollbackReadiness !== "unverified"
    || !/^[a-f0-9]{64}$/.test(String(preparationResult.productionDatabaseContainerId ?? ""))
    || restoreResult?.verified !== true || restoreResult?.postflightReady !== true
    || context?.releaseSha !== preparationResult.releaseSha || context?.manifestId !== preparationResult.manifestId
    || context?.repository !== "krustallik/body-model"
    || context?.workflowPath !== ".github/workflows/production-no-app-preflight.yml"
    || context?.event !== "workflow_dispatch" || context?.headBranch !== "main"
    || context?.headSha !== preparationResult.releaseSha || String(context?.actorId) !== "126446430"
    || !RUN_ID.test(String(context?.workflowRunId ?? "")) || !Number.isSafeInteger(context?.workflowRunAttempt)
    || context.workflowRunAttempt < 1 || !Buffer.isBuffer(backupBytes) || backupBytes.length <= 36) {
    reject("preparation-only restore evidence is incomplete or contains a DDL-ready claim.");
  }
  const snapshot = Date.parse(pgDumpInvocationAt);
  if (!Number.isFinite(snapshot) || snapshot > Date.now() + 60_000) reject("pg_dump invocation-boundary time is invalid.");
  const backupDigest = createHash("sha256").update(backupBytes).digest("hex");
  return Object.freeze({
    schemaVersion: 1,
    evidenceKind: NO_APP_PREFLIGHT_EVIDENCE_KIND,
    preparationVerified: true,
    repository: "krustallik/body-model",
    workflowPath: ".github/workflows/production-no-app-preflight.yml",
    workflowRunId: String(context.workflowRunId),
    workflowRunAttempt: context.workflowRunAttempt,
    workflowActorId: String(context.actorId),
    releaseSha: preparationResult.releaseSha,
    manifestId: preparationResult.manifestId,
    pendingMigrationNames: preparationResult.pendingMigrationNames,
    pendingSetDigest: preparationResult.pendingSetDigest,
    preparationResultDigest: canonicalSha256(preparationResult),
    backupFileDigest: backupDigest,
    backupSnapshotAt: new Date(snapshot).toISOString(),
    backupSnapshotTimeBasis: "pg_dump-invocation-boundary",
    productionIdentityDigest: preparationResult.productionIdentityDigest,
    productionDatabaseContainerId: preparationResult.productionDatabaseContainerId,
    logicalDataFingerprint: preparationResult.logicalDataFingerprint,
    writerDrainDigest: preparationResult.writerDrainDigest,
    writerTopologyDigest: preparationResult.writerTopologyDigest,
    maintenanceRouteDigest: preparationResult.maintenanceRouteDigest,
    maintenanceMarkerDigest: preparationResult.maintenanceMarkerDigest,
    captureLineageDigest: preparationResult.captureLineageDigest,
    captureHistoryProofDigest: preparationResult.captureHistoryProofDigest,
    captureHistoryProvenance: preparationResult.captureHistoryProvenance,
    postgresClientVersions: preparationResult.postgresClientVersions,
    restoreResultDigest: canonicalSha256(restoreResult),
    postSchemaDigest: restoreResult.postSchemaDigest,
    appRuntime: "unavailable",
    previousAppProvenance: null,
    previousAppRecovery: "unverified",
    rollbackReadiness: "unverified",
    ddlAuthorization: false,
    createdAt: new Date().toISOString(),
  });
}

async function readBoundedStdin(maxBytes = 256 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > maxBytes) reject("host snapshot evidence exceeds its size bound.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const [mode] = process.argv.slice(2);
  if (mode !== "--verify-host-snapshot") {
    reject("use --verify-host-snapshot only from the exact-SHA no-app workflow.");
  }
  const input = JSON.parse(await readBoundedStdin());
  assertNoCompetingProductionRuns(input.productionRuns, { currentRunId: input.currentRunId });
  const captureLineage = reconcileNoAppCaptureLineage(input);
  const publicProbe = verifyPublicMaintenanceProbe(input.publicProbe);
  const liveState = verifyNoAppLiveState({ ...input, publicProbe, captureLineage, competingRunCount: 0 });
  const preparationResult = createNoAppPreparationResult({
    releaseSha: input.releaseSha,
    manifestId: input.manifestId,
    databasePreflightResult: input.preflightResult,
    report: input.report,
    liveState,
    captureLineage,
  });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    releaseSha: input.releaseSha,
    canonicalMainSha: input.canonicalMainSha,
    manifestId: input.manifestId,
    report: input.report,
    preflightResult: input.preflightResult,
    captureLineage,
    preparationResult,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
