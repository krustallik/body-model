import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAuthorizationEnvelope, createClaimsFromPreflight, canonicalSha256 } from "../scripts/production-migration-authorization.mjs";
import {
  assertCutbackLiveDatabaseIdentity,
  assertCutbackRestoredDatabaseIdentity,
  verifyCutbackEvidenceBundle,
  verifyCutbackRestoredState,
} from "../scripts/production-database-cutback.mjs";

const identity = Object.freeze({
  database: "bodycast", databaseOid: 16384, clusterSystemIdentifier: "7419276301947620311",
  role: "bodycast", serverVersion: "17.5", serverAddress: "172.20.0.2", serverPort: 5432,
});
const dataFingerprint = "c".repeat(64);
const claims = Object.freeze({ productionIdentityDigest: canonicalSha256(identity), manifestId: "active-energy-unified-v2" });
const preflightReport = Object.freeze({ logicalDataFingerprint: dataFingerprint, programlessSessionCount: 0 });
const rowCounts = Object.freeze(Object.fromEntries([
  "Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog",
].map((name) => [name, { rowCount: 1 }])));
const migrations = Object.freeze([{ name: "20261001_baseline", checksum: "a".repeat(64), startedAt: "2026-10-01T00:00:00.000Z", finishedAt: "2026-10-01T00:01:00.000Z" }]);

describe("production database cutback gates", () => {
  it("verifies the owner-signed historical context and normalizes GitHub artifact SHA-256 metadata", () => {
    const pair = generateKeyPairSync("ed25519");
    const keyId = "cutback-unit";
    const allowlist = { schemaVersion: 1, keys: [{ keyId, status: "active", publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString() }] };
    const backup = Buffer.from("encrypted pre-ddl backup bytes");
    const backupFileDigest = createHash("sha256").update(backup).digest("hex");
    const productionIdentityDigest = canonicalSha256(identity);
    const pendingMigrationNames = ["20261001_baseline"];
    const restoreResult = { verified: true, postflightReady: true, postSchemaDigest: "b".repeat(64) };
    const previousAppProvenance = {
      schemaVersion: 2, provenanceKind: "legacy-unlabeled-v1", recordDigest: "9".repeat(64), previousSha: "unavailable",
      previousImageId: `sha256:${"8".repeat(64)}`, previousContainerId: "7".repeat(64), previousHealth: "healthy",
      previousRuntimeConfigDigest: "6".repeat(64),
    };
    const sourceObjects = [{ name: "DailyModelState", present: true, kind: "table", signature: "columns-v1" }];
    const sourceTables = { DailyModelState: { exists: true, estimatedRows: 10, totalBytes: 2048 } };
    const preflightResult = { readyForOwnerAuthorization: true, blockers: [], pendingExactlyExpected: true,
      manifestId: "active-energy-unified-v2", pending: pendingMigrationNames, identity, migrations, objects: sourceObjects, tables: sourceTables,
      programlessSessionCount: 0, previousAppProvenance };
    const report = { identity, pending: pendingMigrationNames, migrations, objects: sourceObjects, tables: sourceTables,
      programlessSessionCount: 0 };
    const evidence = {
      verified: true, releaseSha: "a".repeat(40), manifestId: "active-energy-unified-v2", workflowRunId: "4001", workflowRunAttempt: 1,
      preflightResultDigest: canonicalSha256(preflightResult), restoreResultDigest: canonicalSha256(restoreResult),
      previousAppProvenance,
      productionIdentityDigest, backupSnapshotAt: "2026-10-01T00:00:00.000Z", backupFileDigest,
      pendingMigrationNames, pendingSetDigest: canonicalSha256(pendingMigrationNames),
    };
    const claims = createClaimsFromPreflight({
      repository: "krustallik/body-model", workflowId: "77", workflowPath: ".github/workflows/production-migrate.yml",
      workflowRunId: "5001", workflowRunAttempt: 1, actorId: "126446430", releaseSha: evidence.releaseSha, currentMainSha: evidence.releaseSha,
      manifestId: evidence.manifestId, pendingMigrationNames, preflightRunId: "4001", preflightRunAttempt: 1,
      preflightRunStartedAt: "2026-10-01T00:00:00.000Z", preflightResultDigest: evidence.preflightResultDigest,
      backupArtifactId: "6001", backupArtifactDigest: "c".repeat(64), backupSnapshotAt: evidence.backupSnapshotAt,
      restoreResultDigest: evidence.restoreResultDigest, productionIdentityDigest, writerDrainDigest: "d".repeat(64),
      writerTopologyDigest: "e".repeat(64), issuedAt: "2026-10-01T00:01:00.000Z", expiresAt: "2026-10-01T00:30:00.000Z",
      authorizationId: randomUUID(), nonce: randomUUID(),
    });
    const envelope = createAuthorizationEnvelope(claims, { keyId, privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), allowlist });
    const artifactMetadata = { id: "6001", digest: `sha256:${"c".repeat(64)}`, workflowRunId: "4001", expired: false };
    expect(verifyCutbackEvidenceBundle({ envelope, artifactMetadata, preflightEvidence: evidence, preflightReport: report,
      preflightResult, restoreResult, allowlist, expectedFailedRunId: "5001", expectedFailedSha: evidence.releaseSha, backupFileBytes: backup }).verified).toBe(true);
    expect(() => verifyCutbackEvidenceBundle({ envelope, artifactMetadata: { ...artifactMetadata, digest: `sha256:${"f".repeat(64)}` },
      preflightEvidence: evidence, preflightReport: report, preflightResult, restoreResult, allowlist,
      expectedFailedRunId: "5001", expectedFailedSha: evidence.releaseSha, backupFileBytes: backup })).toThrow();
    expect(() => verifyCutbackEvidenceBundle({ envelope, artifactMetadata, preflightEvidence: evidence, preflightReport: report,
      preflightResult, restoreResult, allowlist, expectedFailedRunId: "5002", expectedFailedSha: evidence.releaseSha, backupFileBytes: backup })).toThrow();
    expect(() => verifyCutbackEvidenceBundle({ envelope, artifactMetadata,
      preflightEvidence: { ...evidence, previousAppProvenance: { ...previousAppProvenance, recordDigest: "5".repeat(64) } },
      preflightReport: report, preflightResult, restoreResult, allowlist,
      expectedFailedRunId: "5001", expectedFailedSha: evidence.releaseSha, backupFileBytes: backup })).toThrow(/preflight evidence is unsigned/);
  });

  it("requires the exact signed database identity and an empty writer drain", () => {
    expect(assertCutbackLiveDatabaseIdentity({
      claims, preflightReport, liveReport: { identity, logicalDataFingerprint: dataFingerprint, programlessSessionCount: 0,
        writerDrain: { activeClientBackends: [], topology: { ready: true } } },
    }).verified).toBe(true);
    for (const live of [
      { identity: { ...identity, database: "other" }, writerDrain: { activeClientBackends: [], topology: { ready: true } } },
      { identity: { ...identity, clusterSystemIdentifier: "different" }, writerDrain: { activeClientBackends: [], topology: { ready: true } } },
      { identity, writerDrain: { activeClientBackends: [{ pid: 7 }], topology: { ready: true } } },
      { identity, writerDrain: { activeClientBackends: [], topology: { ready: false } } },
    ]) expect(() => assertCutbackLiveDatabaseIdentity({ claims, preflightReport, liveReport: {
      ...live, logicalDataFingerprint: dataFingerprint, programlessSessionCount: 0,
    } })).toThrow();
    expect(() => assertCutbackLiveDatabaseIdentity({ claims, preflightReport, liveReport: {
      identity, logicalDataFingerprint: "d".repeat(64), programlessSessionCount: 0,
      writerDrain: { activeClientBackends: [], topology: { ready: true } },
    } })).toThrow(/would discard committed data/);
    expect(() => assertCutbackLiveDatabaseIdentity({ claims, preflightReport, liveReport: {
      identity, logicalDataFingerprint: dataFingerprint, programlessSessionCount: 1,
      writerDrain: { activeClientBackends: [], topology: { ready: true } },
    } })).toThrow(/programless-session state is missing or changed/);
  });

  it("accepts a historical /32 signed identity only for the same current bare endpoint", () => {
    const historicalIdentity = { ...identity, serverAddress: "172.20.0.2/32" };
    const historicalClaims = { productionIdentityDigest: canonicalSha256(historicalIdentity), manifestId: "active-energy-unified-v2" };
    expect(assertCutbackLiveDatabaseIdentity({ claims: historicalClaims,
      preflightReport, liveReport: { identity, logicalDataFingerprint: dataFingerprint, programlessSessionCount: 0,
        writerDrain: { activeClientBackends: [], topology: { ready: true } } } }).verified).toBe(true);
    expect(() => assertCutbackLiveDatabaseIdentity({ claims: historicalClaims,
      preflightReport, liveReport: { identity: { ...identity, serverAddress: "172.20.0.99" }, logicalDataFingerprint: dataFingerprint,
        programlessSessionCount: 0, writerDrain: { activeClientBackends: [], topology: { ready: true } } } })).toThrow();
  });

  it("accepts only a restored database on the exact source cluster and role", () => {
    const restored = { ...identity, database: "bodycast_cutback_123", databaseOid: 20480 };
    expect(assertCutbackRestoredDatabaseIdentity({ sourceIdentity: identity, restoredReport: { identity: restored }, expectedDatabase: restored.database }).verified).toBe(true);
    for (const changed of [
      { ...restored, clusterSystemIdentifier: "other" },
      { ...restored, serverAddress: "172.20.0.99" },
      { ...restored, role: "postgres" },
      { ...restored, database: "bodycast" },
    ]) expect(() => assertCutbackRestoredDatabaseIdentity({ sourceIdentity: identity, restoredReport: { identity: changed }, expectedDatabase: restored.database })).toThrow();
    const historicalSource = { ...identity, serverAddress: "172.20.0.2/32" };
    expect(assertCutbackRestoredDatabaseIdentity({ sourceIdentity: historicalSource,
      restoredReport: { identity: restored }, expectedDatabase: restored.database }).verified).toBe(true);
  });

  it("blocks cutback when migration history, schema or any required data row count differs", () => {
    const logicalDataFingerprint = "c".repeat(64);
    const sourceReport = { identity, migrations, objects: [], logicalDataFingerprint, programlessSessionCount: 0 };
    const restoreResult = { readability: rowCounts, logicalDataFingerprint };
    const restoredReport = { identity: { ...identity, database: "staging", databaseOid: 20480 }, migrationHistory: migrations,
      objects: [], readability: rowCounts, logicalDataFingerprint, programlessSessionCount: 0 };
    const readabilityReport = { readability: rowCounts, logicalDataFingerprint };
    expect(verifyCutbackRestoredState({ sourceReport, restoreResult, restoredReport, readabilityReport }).verified).toBe(true);
    const badRows = { ...rowCounts, Workout: { rowCount: 2 } };
    expect(verifyCutbackRestoredState({ sourceReport, restoreResult, restoredReport, readabilityReport: { readability: badRows, logicalDataFingerprint } }).verified).toBe(false);
    expect(verifyCutbackRestoredState({ sourceReport, restoreResult, restoredReport: { ...restoredReport, migrationHistory: [] }, readabilityReport }).verified).toBe(false);
    expect(verifyCutbackRestoredState({ sourceReport, restoreResult,
      restoredReport: { ...restoredReport, logicalDataFingerprint: "d".repeat(64) }, readabilityReport }).verified).toBe(false);
    expect(verifyCutbackRestoredState({ sourceReport, restoreResult,
      restoredReport: { ...restoredReport, programlessSessionCount: 1 }, readabilityReport }).verified).toBe(false);
  });
});
