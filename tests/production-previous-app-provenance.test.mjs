import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalSha256 } from "../scripts/production-migration-authorization.mjs";
import { createPreflightEvidence } from "../scripts/production-migration-evidence.mjs";
import { evaluateProductionWriterDrain, PRODUCTION_WRITER_TOPOLOGY_CONTRACT } from "../scripts/production-writer-drain.mjs";
import { verifyPreviousAppMigrationCompatibility, verifyRecreatedPreviousAppRuntime } from "../scripts/production-database-cutback.mjs";
import {
  LEGACY_PREVIOUS_APP_PROVENANCE,
  CUTBACK_LEGACY_PREVIOUS_APP_PROVENANCE,
  PREVIOUS_APP_COMPATIBILITY_SNAPSHOT_CONTRACT,
  SHA_PREVIOUS_APP_PROVENANCE,
  assertPreviousAppCompatibilitySnapshot,
  assertPreviousAppProvenanceBoundToPreflight,
  capturePreviousAppProvenance,
  createVerifiedCutbackReceipt,
  persistVerifiedCutbackReceipt,
  readVerifiedCutbackReceiptFromGitDir,
  parsePreviousAppProvenance,
  previousAppDatabaseCompatibilityDigests,
  previousAppProvenanceBinding,
  serializePreviousAppProvenance,
  verifyLegacyPreviousAppRestoredCompatibility,
  verifyPreviousAppCaptureMatchesPreflight,
  validateVerifiedCutbackReceipt,
} from "../scripts/production-previous-app-provenance.mjs";

const targetSha = "a".repeat(40);
const identity = Object.freeze({
  database: "bodycast", databaseOid: 16384, clusterSystemIdentifier: "7419276301947620311",
  role: "bodycast", serverVersion: "17.5", serverAddress: "172.20.0.2", serverPort: 5432,
});
const migrations = Object.freeze([{
  name: "20261001_baseline", checksum: "b".repeat(64), startedAt: "2026-10-01T00:00:00.000Z",
  finishedAt: "2026-10-01T00:01:00.000Z", rolledBackAt: null, logsFingerprint: "c".repeat(32),
}]);
const objects = Object.freeze([{ name: "DailyModelState", present: true, kind: "table", signature: "typed baseline schema" }]);
const databaseReport = Object.freeze({ identity, migrations, objects, logicalDataFingerprint: "9".repeat(64) });
const preflightResult = Object.freeze({
  readyForOwnerAuthorization: true, blockers: [], pendingExactlyExpected: true,
  identity, migrations, objects, logicalDataFingerprint: databaseReport.logicalDataFingerprint,
});
const rowCounts = Object.freeze(Object.fromEntries([
  "Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog",
].map((table) => [table, { rowCount: 4 }])));

function container(labels = {}) {
  return {
    Id: "d".repeat(64), Image: `sha256:${"e".repeat(64)}`,
    Config: {
      Labels: labels,
      Env: ["DATABASE_URL=postgresql://bodycast:secret@db/bodycast", "NODE_ENV=production"],
      Entrypoint: ["node"], Cmd: ["server.js"], User: "node", WorkingDir: "/app",
      Healthcheck: { Test: ["CMD", "wget", "http://127.0.0.1:3000/api/readiness"] }, ExposedPorts: { "3000/tcp": {} },
    },
    HostConfig: { Binds: [], Mounts: [], PortBindings: {}, RestartPolicy: { Name: "unless-stopped" } },
    Mounts: [], NetworkSettings: { Networks: { "bodycast-backend-prod": {} } }, State: { Health: { Status: "healthy" } },
  };
}

describe("versioned previous-app provenance", () => {
  it("accepts only an explicit read-only compatibility snapshot that cannot satisfy writer drain", () => {
    const snapshot = {
      ...databaseReport,
      writerDrain: {
        schemaVersion: 1,
        observerPid: 1,
        observerApplicationName: "bodycast-production-preflight",
        identityPolicy: "no-other-client-backends",
        observedAt: "2026-10-09T20:00:00.000Z",
        activeClientBackends: [],
        topology: {
          schemaVersion: 1,
          contract: PREVIOUS_APP_COMPATIBILITY_SNAPSHOT_CONTRACT,
          ready: false,
          blockers: ["writer drain is not asserted by a previous-app compatibility snapshot"],
        },
      },
    };
    expect(assertPreviousAppCompatibilitySnapshot(snapshot)).toBe(true);
    expect(evaluateProductionWriterDrain(snapshot).ready).toBe(false);
    expect(() => assertPreviousAppCompatibilitySnapshot({
      ...snapshot,
      writerDrain: { ...snapshot.writerDrain, topology: { ...snapshot.writerDrain.topology, ready: true } },
    })).toThrow(/explicit non-admission compatibility snapshot contract/);
    expect(() => assertPreviousAppCompatibilitySnapshot({
      ...snapshot,
      writerDrain: { ...snapshot.writerDrain, topology: { ...snapshot.writerDrain.topology, blockers: [] } },
    })).toThrow(/explicit non-admission compatibility snapshot contract/);
    expect(() => assertPreviousAppCompatibilitySnapshot({ ...databaseReport })).toThrow(/explicit non-admission compatibility snapshot contract/);
  });

  it("preserves strict exact-SHA provenance for labeled releases", () => {
    const record = capturePreviousAppProvenance({
      container: container({ "org.bodycast.release-sha": "1".repeat(40) }), databaseReport, targetSha,
    });
    expect(record.provenanceKind).toBe(SHA_PREVIOUS_APP_PROVENANCE);
    expect(record.previousSha).toBe("1".repeat(40));
    expect(record.previousImageId).toBe(container().Image);
    expect(record.previousRuntimeConfigDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => capturePreviousAppProvenance({
      container: container({ "org.bodycast.release-sha": "unknown" }), databaseReport, targetSha,
    })).toThrow(/unknown previous-app release label requires a verified durable cutback receipt/);
  });

  it("admits an explicit unknown release label only from a versioned receipt matching the exact live app and DB", () => {
    const legacyContainer = container({ "org.bodycast.release-sha": "unknown" });
    expect(() => capturePreviousAppProvenance({ container: legacyContainer, databaseReport, targetSha }))
      .toThrow(/verified durable cutback receipt/);
    const receipt = createVerifiedCutbackReceipt({
      container: legacyContainer, databaseReport, cutbackRunId: "38023000000", cutbackRunAttempt: 1,
      releaseSha: targetSha, sourceMarkerDigest: "f".repeat(64), completedAt: "2026-10-09T20:00:00.000Z",
    });
    expect(receipt.schemaVersion).toBe(1);
    expect(validateVerifiedCutbackReceipt(receipt, { container: legacyContainer, databaseReport })).toBe(true);
    const record = capturePreviousAppProvenance({ container: legacyContainer, databaseReport, targetSha, cutbackReceipt: receipt });
    expect(record).toMatchObject({ provenanceKind: CUTBACK_LEGACY_PREVIOUS_APP_PROVENANCE, previousSha: "unavailable",
      previousImageId: legacyContainer.Image, previousContainerId: legacyContainer.Id });
    expect(() => validateVerifiedCutbackReceipt({ ...receipt, previousImageId: `sha256:${"1".repeat(64)}` },
      { container: legacyContainer, databaseReport })).toThrow(/receipt digest is invalid/);
    expect(() => capturePreviousAppProvenance({ container: { ...legacyContainer, Image: `sha256:${"1".repeat(64)}` },
      databaseReport, targetSha, cutbackReceipt: receipt })).toThrow(/image, container, runtime configuration, or health differs/);
    expect(() => capturePreviousAppProvenance({ container: legacyContainer, databaseReport: { ...databaseReport,
      migrations: [{ ...migrations[0], checksum: "9".repeat(64) }] }, targetSha, cutbackReceipt: receipt }))
      .toThrow(/identity, schema, or migration history differs/);
  });

  it.skipIf(process.platform === "win32")("durably stores versioned no-overwrite cutback receipts and selects only the exact live app/database binding", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bodycast-cutback-receipt-"));
    const gitDir = path.join(tempRoot, ".git");
    await mkdir(gitDir);
    try {
      const legacyContainer = container({ "org.bodycast.release-sha": "unknown" });
      const first = createVerifiedCutbackReceipt({ container: legacyContainer, databaseReport, cutbackRunId: "38023000000",
        cutbackRunAttempt: 1, releaseSha: targetSha, sourceMarkerDigest: "f".repeat(64), completedAt: "2026-10-09T20:00:00.000Z" });
      const firstPath = await persistVerifiedCutbackReceipt(gitDir, first);
      expect(firstPath).toContain("bodycast-production-cutback-receipts");
      expect(await readVerifiedCutbackReceiptFromGitDir(gitDir, { container: legacyContainer, databaseReport })).toEqual(first);
      await expect(persistVerifiedCutbackReceipt(gitDir, first)).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readVerifiedCutbackReceiptFromGitDir(gitDir, {
        container: legacyContainer,
        databaseReport: { ...databaseReport, migrations: [{ ...migrations[0], checksum: "8".repeat(64) }] },
      })).toBeNull();

      const second = createVerifiedCutbackReceipt({ container: legacyContainer, databaseReport, cutbackRunId: "38023000001",
        cutbackRunAttempt: 1, releaseSha: targetSha, sourceMarkerDigest: "e".repeat(64), completedAt: "2026-10-09T20:01:00.000Z" });
      await persistVerifiedCutbackReceipt(gitDir, second);
      await expect(readVerifiedCutbackReceiptFromGitDir(gitDir, { container: legacyContainer, databaseReport }))
        .rejects.toThrow(/Multiple durable cutback receipts match/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("captures a genuinely unlabeled legacy image without inventing a source SHA", () => {
    const record = capturePreviousAppProvenance({ container: container(), databaseReport, targetSha });
    expect(record.provenanceKind).toBe(LEGACY_PREVIOUS_APP_PROVENANCE);
    expect(record.previousSha).toBe("unavailable");
    expect(record.previousImageId).toBe(`sha256:${"e".repeat(64)}`);
    expect(record.previousContainerId).toBe("d".repeat(64));
    expect(record.previousHealth).toBe("healthy");
    const parsed = parsePreviousAppProvenance(serializePreviousAppProvenance(record));
    expect(serializePreviousAppProvenance(record)).not.toContain("secret");
    expect(parsed).toEqual(record);
    expect(verifyPreviousAppCaptureMatchesPreflight(parsed, preflightResult, targetSha).verified).toBe(true);
    const signedResult = { ...preflightResult, previousAppProvenance: previousAppProvenanceBinding(parsed) };
    expect(assertPreviousAppProvenanceBoundToPreflight(parsed, signedResult).verified).toBe(true);
    expect(() => assertPreviousAppProvenanceBoundToPreflight(parsed, {
      ...signedResult, previousAppProvenance: { ...signedResult.previousAppProvenance, previousImageId: `sha256:${"1".repeat(64)}` },
    })).toThrow(/owner-signed preflight binding/);
    expect(() => verifyPreviousAppCaptureMatchesPreflight(parsed,
      { ...preflightResult, migrations: [{ ...migrations[0], checksum: "f".repeat(64) }] }, targetSha))
      .toThrow(/changed before the signed preflight/);
  });

  it("requires exact restored schema, Prisma history, data readability, and signed preflight binding for legacy compatibility", () => {
    const record = capturePreviousAppProvenance({ container: container(), databaseReport, targetSha });
    const restoredReport = { identity: { ...identity, database: "bodycast_cutback_stage", databaseOid: 20480 }, migrations, objects,
      logicalDataFingerprint: databaseReport.logicalDataFingerprint };
    const restoreResult = { verified: true, postflightReady: true, readability: rowCounts,
      logicalDataFingerprint: databaseReport.logicalDataFingerprint, postSchemaDigest: "8".repeat(64) };
    const readabilityReport = { migrationHistory: migrations, readability: rowCounts,
      logicalDataFingerprint: databaseReport.logicalDataFingerprint };
    const result = verifyLegacyPreviousAppRestoredCompatibility({
      record, targetSha, preflightResult, preflightResultDigest: canonicalSha256(preflightResult), contextVerified: true,
      restoredReport, restoreResult, readabilityReport,
    });
    expect(result).toMatchObject({ verified: true, provenanceKind: LEGACY_PREVIOUS_APP_PROVENANCE, restoredMigrationCount: 1 });
    const signedResult = { ...preflightResult, previousAppProvenance: previousAppProvenanceBinding(record) };
    const cutbackArguments = {
      recordText: serializePreviousAppProvenance(record), targetSha, contextVerified: true,
      preflightResultDigest: canonicalSha256(signedResult), preflightResult: signedResult,
      restoredReport, restoreResult, readabilityReport,
    };
    expect(verifyPreviousAppMigrationCompatibility(cutbackArguments))
      .toMatchObject({ verified: true, provenanceKind: LEGACY_PREVIOUS_APP_PROVENANCE });
    const substitutedSignedResult = { ...signedResult,
      previousAppProvenance: { ...signedResult.previousAppProvenance, recordDigest: "9".repeat(64) } };
    expect(() => verifyPreviousAppMigrationCompatibility({ ...cutbackArguments,
      preflightResultDigest: canonicalSha256(substitutedSignedResult), preflightResult: substitutedSignedResult,
    })).toThrow(/owner-signed preflight binding/);
    expect(() => verifyLegacyPreviousAppRestoredCompatibility({
      record, targetSha, preflightResult, preflightResultDigest: canonicalSha256(preflightResult), contextVerified: false,
      restoredReport, restoreResult, readabilityReport,
    })).toThrow(/owner-signed preflight result/);
    expect(() => verifyLegacyPreviousAppRestoredCompatibility({
      record, targetSha, preflightResult, preflightResultDigest: canonicalSha256(preflightResult), contextVerified: true,
      restoredReport: { ...restoredReport, migrations: [] }, restoreResult, readabilityReport,
    })).toThrow(/incompatible/);
    expect(() => verifyLegacyPreviousAppRestoredCompatibility({
      record, targetSha, preflightResult, preflightResultDigest: canonicalSha256(preflightResult), contextVerified: true,
      restoredReport, restoreResult, readabilityReport: { ...readabilityReport, readability: { ...rowCounts, Workout: { rowCount: 5 } } },
    })).toThrow(/data differs/);
  });

  it("carries the immutable previous-image identity into the signed preflight evidence", () => {
    const record = capturePreviousAppProvenance({ container: container(), databaseReport, targetSha });
    const binding = previousAppProvenanceBinding(record);
    const topology = {
      schemaVersion: 1, contract: PRODUCTION_WRITER_TOPOLOGY_CONTRACT, ready: true, blockers: [], observedAt: "2026-10-09T20:00:00.000Z",
      app: { name: "bodycast-app-prod", state: "absent", restartPolicy: null },
      database: { name: "bodycast-db-prod", state: "running", health: "healthy", publishedPostgresPort: false, networks: ["bodycast-backend-prod"] },
      backendNetwork: { name: "bodycast-backend-prod", containers: ["bodycast-db-prod"] },
      caddy: { name: "gymbeam-caddy", state: "running", configValidated: true },
      routeFile: { verified: true, maintenanceResponse: true, containsReverseProxy: false, sha256: "d".repeat(64) },
    };
    const rawReport = { identity, logicalDataFingerprint: databaseReport.logicalDataFingerprint, writerDrain: {
      schemaVersion: 1, observerPid: 1, observerApplicationName: "bodycast-production-preflight",
      identityPolicy: "no-other-client-backends", activeClientBackends: [], observedAt: "2026-10-09T20:00:00.000Z", topology,
    } };
    const result = {
      ...preflightResult, manifestId: "active-energy-unified-v2", pending: ["20261002_pending"], writerDrainReady: true,
      writerDrainDigest: canonicalSha256(rawReport.writerDrain), previousAppProvenance: binding,
    };
    const evidence = createPreflightEvidence({ rawReport, preflightResult: result,
      restoreResult: { verified: true, postflightReady: true, postSchemaDigest: "e".repeat(64),
        logicalDataFingerprint: databaseReport.logicalDataFingerprint },
      snapshotStartedAt: "2026-10-09T20:00:00.000Z", backupBytes: Buffer.from("encrypted backup"),
      context: { workflowRunId: "1001", workflowRunAttempt: 1, releaseSha: targetSha, manifestId: "active-energy-unified-v2" },
    });
    expect(evidence.previousAppProvenance).toEqual(binding);
    expect(evidence.preflightResultDigest).toBe(canonicalSha256(result));
    expect(() => createPreflightEvidence({ rawReport, preflightResult: { ...result, previousAppProvenance: undefined },
      restoreResult: { verified: true, postflightReady: true, postSchemaDigest: "e".repeat(64),
        logicalDataFingerprint: databaseReport.logicalDataFingerprint },
      snapshotStartedAt: "2026-10-09T20:00:00.000Z", backupBytes: Buffer.from("encrypted backup"),
      context: { workflowRunId: "1001", workflowRunAttempt: 1, releaseSha: targetSha, manifestId: "active-energy-unified-v2" },
    })).toThrow(/Versioned previous-app identity/);
  });

  it("fails closed when image/container identity, health, or migration/schema evidence is missing", () => {
    expect(() => capturePreviousAppProvenance({ container: { ...container(), Image: "bodycast-app:latest" }, databaseReport, targetSha })).toThrow(/immutable container or image/);
    expect(() => capturePreviousAppProvenance({ container: { ...container(), State: { Health: { Status: "unhealthy" } } }, databaseReport, targetSha })).toThrow(/not positively health-checked/);
    expect(() => capturePreviousAppProvenance({ container: container(), databaseReport: { ...databaseReport, migrations: [] }, targetSha })).toThrow(/database compatibility evidence/);
    expect(() => previousAppDatabaseCompatibilityDigests({ ...databaseReport, objects: [] })).toThrow(/schema inventory/);
    expect(() => previousAppDatabaseCompatibilityDigests({ ...databaseReport, migrations: [{ ...migrations[0], finishedAt: null }] })).toThrow(/migration history/);
  });

  it("recreates only the captured image/runtime with a new healthy container for both legacy and labeled provenance", () => {
    for (const [labels, expectedLabel, kind] of [
      [{}, "unknown", LEGACY_PREVIOUS_APP_PROVENANCE],
      [{ "org.bodycast.release-sha": "1".repeat(40) }, "1".repeat(40), SHA_PREVIOUS_APP_PROVENANCE],
    ]) {
      const capturedContainer = container(labels);
      const record = capturePreviousAppProvenance({ container: capturedContainer, databaseReport, targetSha });
      expect(record.provenanceKind).toBe(kind);
      const recreated = structuredClone(capturedContainer);
      recreated.Id = "f".repeat(64);
      recreated.Config.Labels = { "org.bodycast.release-sha": expectedLabel };
      expect(verifyRecreatedPreviousAppRuntime({ recordText: serializePreviousAppProvenance(record), container: recreated }))
        .toMatchObject({ verified: true, provenanceKind: kind, imageId: capturedContainer.Image, containerId: recreated.Id, health: "healthy" });
      for (const invalid of [
        { ...recreated, Id: capturedContainer.Id },
        { ...recreated, Image: `sha256:${"9".repeat(64)}` },
        { ...recreated, State: { Health: { Status: "starting" } } },
        { ...recreated, Config: { ...recreated.Config, Labels: { "org.bodycast.release-sha": "f".repeat(40) } } },
        { ...recreated, Config: { ...recreated.Config, Env: [...recreated.Config.Env, "NEW_RUNTIME_VALUE=changed"] } },
      ]) expect(() => verifyRecreatedPreviousAppRuntime({ recordText: serializePreviousAppProvenance(record), container: invalid })).toThrow();
    }
  });
});
