import { describe, expect, it } from "vitest";
import { canonicalSha256 } from "../scripts/production-migration-authorization.mjs";
import { V4_REPUBLICATION_MANIFEST } from "../scripts/production-migration-manifests.mjs";
import {
  NO_APP_PREFLIGHT_EVIDENCE_KIND,
  assertNoCompetingProductionRuns,
  createNoAppPreparationEvidence,
  createNoAppPreparationResult,
  reconcileNoAppCaptureLineage,
  stableNoAppSnapshot,
  verifyNoAppLiveState,
  verifyPublicMaintenanceProbe,
} from "../scripts/production-no-app-preflight.mjs";
import { createCaptureResumeReceipt } from "../scripts/production-capture-resume-receipt.mjs";
import { previousAppDatabaseCompatibilityDigests, serializePreviousAppProvenance } from "../scripts/production-previous-app-provenance.mjs";
import { createSignedAuthorization } from "../scripts/production-migration-sign.mjs";

const sha = "a".repeat(40);
const digest = "b".repeat(64);
const marker = "bd9975d38d1c-20261012T120000Z-99-123456";

function captureLineage() {
  return {
    schemaVersion: 1,
    evidenceBasis: "host-current-record-plus-resume-source-capture-and-owner-run-receipt",
    githubArtifactDigestAvailable: false,
    sourceRunId: "38205023003",
    sourceRunAttempt: 1,
    sourceSha: "fe55468321b9ef8e9783aa3874e1b42c2736b514",
    resumeRunId: "38211169161",
    resumeRunAttempt: 1,
    resumeSha: "3ede9e1644616e65edb3ac29a49df2f109786942",
    sourceRecordDigest: digest,
    currentRecordDigest: digest,
    resumeReceiptDigest: digest,
    historyProofDigest: digest,
    historyProvenance: {
      safePreflightRetryRunIds: ["38213907625", "38214147022"],
      captureGuardPreflightEffects: ["38213907625", "38214147022"].map((runId) => ({
        runId, sha, maintenanceRoutePublishedAndPublic503Confirmed: true,
        oldAppStopReached: false, productionDatabaseInspectionReached: false,
        pgDumpStarted: false, artifactsPublished: false,
      })),
      safePreMaintenanceDeployRunIds: ["38226427716"],
      historicalV2: { preflightRunId: "38068531599", backupArtifactDigest: `sha256:${"a".repeat(64)}` },
      captureRefresh: { runId: "38205023003", failureBoundary: "isolated-restore-before-artifact-upload" },
    },
    rollbackImagePin: "bodycast-app:rollback-preflight-38205023003-1",
    rollbackImageMatchesRecord: true,
    appRuntime: "unavailable",
    previousAppRecovery: "unverified",
    rollbackReadiness: "unverified",
  };
}

function captureReconciliationInputs(overrides = {}) {
  const databaseReport = {
    identity: { database: "bodycast", databaseOid: 16384, clusterSystemIdentifier: "7123", role: "bodycast",
      serverVersion: "17.11", serverAddress: "172.20.0.2", serverPort: 5432 },
    migrations: [{ name: "old_migration", checksum: "c".repeat(64), startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z", rolledBackAt: null }],
    objects: [{ name: "table:Profile", present: true, signature: "columns=id:integer" }],
  };
  const databaseDigests = previousAppDatabaseCompatibilityDigests(databaseReport);
  const sourceRecord = {
    schemaVersion: 3,
    targetSha: "fe55468321b9ef8e9783aa3874e1b42c2736b514",
    provenanceKind: "release-sha-v1",
    previousSha: "1".repeat(40),
    previousImageId: `sha256:${"2".repeat(64)}`,
    previousImagePin: "bodycast-app:rollback-preflight-38205023003-1",
    previousContainerId: "3".repeat(64),
    previousHealth: "healthy",
    previousRuntimeConfigDigest: "4".repeat(64),
    preDdlDatabaseIdentityDigest: databaseDigests.databaseIdentityDigest,
    preDdlMigrationHistoryDigest: databaseDigests.migrationHistoryDigest,
    preDdlSchemaInventoryDigest: databaseDigests.schemaDigest,
    preDdlDatabaseCompatibilityDigest: databaseDigests.compatibilityDigest,
  };
  const currentRecord = { ...sourceRecord, targetSha: "3ede9e1644616e65edb3ac29a49df2f109786942" };
  const sourceRecordText = serializePreviousAppProvenance(sourceRecord);
  const currentRecordText = serializePreviousAppProvenance(currentRecord);
  const receipt = createCaptureResumeReceipt({
    schemaVersion: 1,
    sourceRunId: "38205023003", sourceRunAttempt: 1,
    sourceSha: sourceRecord.targetSha, targetSha: currentRecord.targetSha,
    sourceRecordDigest: canonicalSha256(sourceRecord), currentRecordDigest: canonicalSha256(currentRecord),
    compatibilityDigest: databaseDigests.compatibilityDigest,
  }, { captureRunId: "38211169161", captureRunAttempt: 1 });
  const captureHistoryProof = {
    schemaVersion: 2,
    sourceRunId: "38211169161",
    safeCaptureGuardPreflightRunIds: ["38213907625", "38214147022"],
    captureGuardPreflightEffects: ["38213907625", "38214147022"].map((runId) => ({
      runId, sha, maintenanceRoutePublishedAndPublic503Confirmed: true,
      oldAppStopReached: false, productionDatabaseInspectionReached: false,
      pgDumpStarted: false, artifactsPublished: false,
    })),
    safePreMaintenanceDeployRunIds: ["38226427716"],
    pendingMigrationIds: V4_REPUBLICATION_MANIFEST.migrations.map(({ name }) => name).sort(),
    historicalV2: {
      preflightRunId: "38068531599", preflightSha: "62b6961dde7036100c8af7281e7bfab75bb662db",
      manifestId: "active-energy-unified-v2", migrationRunId: "38069108209",
      migrationSha: "62b6961dde7036100c8af7281e7bfab75bb662db", noV2ArtifactReuseForV4: true,
      backupArtifactDigest: `sha256:${"5".repeat(64)}`, evidenceArtifactDigest: `sha256:${"6".repeat(64)}`,
    },
    captureRefresh: {
      runId: "38205023003", releaseSha: "fe55468321b9ef8e9783aa3874e1b42c2736b514",
      failureBoundary: "isolated-restore-before-artifact-upload", artifactsPublished: false,
    },
  };
  return {
    currentRecordText, sourceRecordText, currentReceipt: receipt, githubReceipt: receipt,
    databaseReport, captureHistoryProof, pinnedImageId: sourceRecord.previousImageId,
    ...overrides,
  };
}

function report() {
  return {
    identity: { database: "bodycast", databaseOid: 16384, clusterSystemIdentifier: "7123", role: "bodycast",
      serverVersion: "17.11", serverAddress: "172.20.0.2", serverPort: 5432 },
    logicalDataFingerprint: digest,
    writerDrain: {
      schemaVersion: 1, observerPid: 44, observerApplicationName: "bodycast-production-preflight",
      observedAt: new Date().toISOString(), identityPolicy: "no-other-client-backends", activeClientBackends: [],
      topology: {
        schemaVersion: 1, contract: "bodycast-compose-internal-db-single-writer-v1", ready: true, blockers: [],
        observedAt: new Date().toISOString(),
        app: { name: "bodycast-app-prod", state: "absent", restartPolicy: null },
        database: { name: "bodycast-db-prod", state: "running", health: "healthy", publishedPostgresPort: false,
          networks: ["bodycast-backend-prod"] },
        backendNetwork: { name: "bodycast-backend-prod", containers: ["bodycast-db-prod"] },
        caddy: { name: "gymbeam-caddy", state: "running", configValidated: true },
        routeFile: { verified: true, maintenanceResponse: true, containsReverseProxy: false, sha256: digest },
      },
    },
  };
}

function preflightResult(raw = report()) {
  return {
    readyForOwnerAuthorization: true,
    blockers: [],
    manifestId: V4_REPUBLICATION_MANIFEST.id,
    pending: V4_REPUBLICATION_MANIFEST.migrations.map(({ name }) => name).sort(),
    pendingExactlyExpected: true,
    identity: raw.identity,
    logicalDataFingerprint: raw.logicalDataFingerprint,
    writerDrain: raw.writerDrain,
    writerDrainReady: true,
    blobIntegrity: V4_REPUBLICATION_MANIFEST.migrations.map(({ name, sha256 }) => ({
      name, expectedSha256: sha256, actualSha256: sha256, matches: true,
    })),
  };
}

function liveArgs(overrides = {}) {
  const raw = overrides.report ?? report();
  const routeSha = raw.writerDrain.topology.routeFile.sha256;
  const publicProbe = verifyPublicMaintenanceProbe({
    status: 503,
    body: "BodyCast is temporarily unavailable while the model is updated.\n",
    maintenanceMarker: marker,
    cacheControl: "no-store",
  });
  return {
    releaseSha: sha, canonicalMainSha: sha, manifestId: V4_REPUBLICATION_MANIFEST.id,
    preflightResult: preflightResult(raw), report: raw, appContainerIds: [], routeMarker: marker, routeSha,
    publicProbe, releaseMarkerState: "absent", captureLineage: captureLineage(), competingRunCount: 0,
    postgresClientVersions: { pgDump: "pg_dump (PostgreSQL) 17.11", pgRestore: "pg_restore (PostgreSQL) 17.11" },
    databaseContainerId: "b".repeat(64),
    ...overrides,
  };
}

describe("no-app database-only preflight contract", () => {
  it("compares substantive drain state while ignoring only fresh observer PID/timestamps", () => {
    const before = { report: report(), preparationResult: { maintenanceRouteDigest: digest,
      maintenanceMarkerDigest: digest, captureLineageDigest: digest, pendingSetDigest: digest,
      productionDatabaseContainerId: "b".repeat(64) }, postgresClientVersions: { pgDump: "17.11", pgRestore: "17.11" } };
    const after = structuredClone(before);
    after.report.writerDrain.observerPid += 1;
    after.report.writerDrain.observedAt = new Date(Date.now() + 1000).toISOString();
    after.report.writerDrain.topology.observedAt = new Date(Date.now() + 1000).toISOString();
    expect(canonicalSha256(stableNoAppSnapshot(before))).toBe(canonicalSha256(stableNoAppSnapshot(after)));
    after.report.writerDrain.topology.database.health = "unhealthy";
    expect(canonicalSha256(stableNoAppSnapshot(before))).not.toBe(canonicalSha256(stableNoAppSnapshot(after)));
  });

  it("reconciles the host current capture, exact resume source capture, GitHub receipt, and exact pinned image", () => {
    const lineage = reconcileNoAppCaptureLineage(captureReconciliationInputs());
    expect(lineage.githubArtifactDigestAvailable).toBe(false);
    expect(lineage.sourceRecordDigest).toBe(captureReconciliationInputs().currentReceipt.sourceRecordDigest);
    expect(lineage.currentRecordDigest).toBe(captureReconciliationInputs().currentReceipt.currentRecordDigest);
    expect(lineage.rollbackImageMatchesRecord).toBe(true);
    expect(lineage.appRuntime).toBe("unavailable");
    expect(lineage.previousAppRecovery).toBe("unverified");
    expect(lineage.rollbackReadiness).toBe("unverified");
  });

  it("records that capture-guard retries republished maintenance before app stop and DB inspection", () => {
    const proof = captureReconciliationInputs().captureHistoryProof;
    proof.captureGuardPreflightEffects[0].maintenanceRoutePublishedAndPublic503Confirmed = false;
    expect(() => reconcileNoAppCaptureLineage(captureReconciliationInputs({ captureHistoryProof: proof })))
      .toThrow("maintenance-route publication/capture-guard failure boundary");
  });

  it.each([
    ["a stale current receipt", { currentReceipt: null }],
    ["a missing resume source record", { sourceRecordText: null }],
    ["archive B from the V2 pre-refresh run used as source", { sourceRecordText: (() => captureReconciliationInputs().sourceRecordText
      .replace("schemaVersion=3", "schemaVersion=2")
      .replace("targetSha=fe55468321b9ef8e9783aa3874e1b42c2736b514", "targetSha=62b6961dde7036100c8af7281e7bfab75bb662db")
      .split(/\r?\n/).filter((line) => !line.startsWith("previousImagePin=")).join("\n"))() }],
    ["a modified resume source record", { sourceRecordText: captureReconciliationInputs().sourceRecordText.replace(
      /preDdlSchemaInventoryDigest=[a-f0-9]{64}/, `preDdlSchemaInventoryDigest=${"e".repeat(64)}`) }],
    ["a changed current record", { currentRecordText: captureReconciliationInputs().currentRecordText.replace(
      `previousSha=${"1".repeat(40)}`, `previousSha=${"9".repeat(40)}`) }],
    ["an unexpected saved image pin", { currentRecordText: captureReconciliationInputs().currentRecordText.replace(
      "bodycast-app:rollback-preflight-38205023003-1", "bodycast-app:rollback-preflight-38205023004-1") }],
    ["an image ID that differs from the saved pin", { pinnedImageId: `sha256:${"9".repeat(64)}` }],
    ["a mismatched GitHub receipt", { githubReceipt: { ...captureReconciliationInputs().currentReceipt, captureRunAttempt: 2 } }],
  ])("rejects capture lineage with %s", (_label, overrides) => {
    expect(() => reconcileNoAppCaptureLineage(captureReconciliationInputs(overrides)))
      .toThrow("No-app production preflight blocked");
  });

  it("allows only a fresh preparation result for an absent app behind verified maintenance", () => {
    const args = liveArgs();
    const liveState = verifyNoAppLiveState(args);
    const result = createNoAppPreparationResult({
      releaseSha: sha, manifestId: args.manifestId, databasePreflightResult: args.preflightResult,
      report: args.report, liveState, captureLineage: args.captureLineage,
    });

    expect(result.evidenceKind).toBe(NO_APP_PREFLIGHT_EVIDENCE_KIND);
    expect(result.preparationVerified).toBe(true);
    expect(result.readyForOwnerAuthorization).toBe(false);
    expect(result.ddlAuthorization).toBe(false);
    expect(result.appRuntime).toBe("unavailable");
    expect(result.previousAppProvenance).toBeNull();
    expect(result.rollbackReadiness).toBe("unverified");
  });

  it.each([
    ["healthy app inventory", { appContainerIds: ["container"] }],
    ["unknown app inventory", { appContainerIds: null }],
    ["wrong canonical SHA", { canonicalMainSha: "c".repeat(40) }],
    ["unknown release marker", { releaseMarkerState: "unknown" }],
    ["competing workflow", { competingRunCount: 1 }],
    ["stale capture lineage", { captureLineage: { ...captureLineage(), currentRecordDigest: "invalid" } }],
    ["unknown runtime", { captureLineage: { ...captureLineage(), appRuntime: "verified" } }],
    ["wrong route digest", { routeSha: "c".repeat(64) }],
    ["partial migration set", { preflightResult: { ...preflightResult(), pending: ["unknown"] } }],
    ["wrong DB identity", { preflightResult: { ...preflightResult(), identity: { database: "other" } } }],
    ["wrong migration bytes", { preflightResult: { ...preflightResult(), blobIntegrity: [{ name: "other", matches: true }] } }],
    ["unknown PostgreSQL client compatibility", { postgresClientVersions: null }],
    ["missing PostgreSQL container identity", { databaseContainerId: null }],
  ])("fails closed for %s", (_label, overrides) => {
    expect(() => verifyNoAppLiveState(liveArgs(overrides))).toThrow("No-app production preflight blocked");
  });

  it("blocks active writers or inconsistent maintenance evidence", () => {
    const activeWriter = report();
    activeWriter.writerDrain.activeClientBackends.push({ present: true });
    expect(() => verifyNoAppLiveState(liveArgs({ report: activeWriter }))).toThrow("No-app production preflight blocked");
    expect(() => verifyPublicMaintenanceProbe({
      status: 503, body: "other", maintenanceMarker: marker, cacheControl: "no-store",
    })).toThrow("No-app production preflight blocked");
  });

  it("requires writer and topology observations to be fresh at the dump boundary", () => {
    const staleReport = report();
    const staleAt = new Date(Date.now() - 31_000).toISOString();
    staleReport.writerDrain.observedAt = staleAt;
    staleReport.writerDrain.topology.observedAt = staleAt;
    expect(() => verifyNoAppLiveState(liveArgs({ report: staleReport })))
      .toThrow("writer, lock, database topology, or maintenance-route evidence is stale");
  });

  it("rejects any competing production workflow regardless of conclusion", () => {
    expect(assertNoCompetingProductionRuns([
      { id: "1", status: "completed" }, { id: "3", status: "in_progress" },
    ], { currentRunId: "3" })).toBe(true);
    expect(() => assertNoCompetingProductionRuns([
      { id: "3", status: "in_progress" }, { id: "2", status: "queued" },
    ], { currentRunId: "3" })).toThrow("another production workflow is active or queued");
  });

  it("emits restore evidence that the standard DDL signer cannot accept", async () => {
    const args = liveArgs();
    const liveState = verifyNoAppLiveState(args);
    const preparationResult = createNoAppPreparationResult({
      releaseSha: sha, manifestId: args.manifestId, databasePreflightResult: args.preflightResult,
      report: args.report, liveState, captureLineage: args.captureLineage,
    });
    const evidence = createNoAppPreparationEvidence({
      preparationResult,
      restoreResult: { verified: true, postflightReady: true, postSchemaDigest: digest },
      pgDumpInvocationAt: new Date().toISOString(), backupBytes: Buffer.alloc(64),
      context: { releaseSha: sha, manifestId: args.manifestId, repository: "krustallik/body-model",
        workflowPath: ".github/workflows/production-no-app-preflight.yml", event: "workflow_dispatch",
        headBranch: "main", headSha: sha, actorId: "126446430", workflowRunId: "9", workflowRunAttempt: 1 },
    });

    expect(evidence.evidenceKind).toBe(NO_APP_PREFLIGHT_EVIDENCE_KIND);
    expect(evidence.ddlAuthorization).toBe(false);
    expect(evidence.backupSnapshotTimeBasis).toBe("pg_dump-invocation-boundary");
    expect(evidence.productionDatabaseContainerId).toBe("b".repeat(64));
    expect(evidence.previousAppProvenance).toBeNull();
    await expect(createSignedAuthorization({ evidence })).rejects.toThrow("cannot authorize production DDL");
  });
});
