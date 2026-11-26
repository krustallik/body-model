import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createAuthorizationEnvelope, createClaimsFromPreflight, canonicalSha256 } from "../scripts/production-migration-authorization.mjs";
import {
  assertCutbackLiveDatabaseIdentity,
  assertCutbackRestoredDatabaseIdentity,
  parseCutbackEvidenceBundle,
  verifyPreDdlSourceAppRecovery,
  verifyCutbackEvidenceBundle,
  verifyCutbackRestoredState,
} from "../scripts/production-database-cutback.mjs";
import { capturePreviousAppProvenance, previousAppProvenanceBinding, serializePreviousAppProvenance } from "../scripts/production-previous-app-provenance.mjs";
import { AUTH_MULTIUSER_MANIFEST, TRAINING_SESSION_CONTEXT_MANIFEST } from "../scripts/production-migration-manifests.mjs";
import {
  AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA, evaluateSchemaDeployHandoff, readGitCompatibility,
  renderSchemaDeployTransition, validateAuthMarkerForTrainingMigrationHandoff,
} from "../scripts/production-schema-deploy-handoff.mjs";

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

function sourceAppRecoveryFixture() {
  const repositoryPath = process.cwd();
  const failedSha = "6b888a46613043be15da9d81a6ef0e3a7edf52ee";
  const previousSha = "28479c9dc928d3efb3b7339cb0aa535330313e2d";
  const names = execFileSync("git", ["ls-tree", "-d", "--name-only", `${previousSha}:prisma/migrations`], {
    cwd: repositoryPath, encoding: "utf8",
  }).trim().split(/\r?\n/).filter(Boolean).sort();
  const migrationSql = execFileSync("git", ["cat-file", "--batch"], {
    cwd: repositoryPath,
    input: `${names.map((name) => `${previousSha}:prisma/migrations/${name}/migration.sql`).join("\n")}\n`,
    maxBuffer: 64 * 1024 * 1024,
  });
  let migrationOffset = 0;
  const migrationRows = names.map((name) => {
    const headerEnd = migrationSql.indexOf(0x0a, migrationOffset);
    const match = /^[a-f0-9]{40,64} blob ([0-9]+)$/.exec(migrationSql.toString("ascii", migrationOffset, headerEnd));
    const size = Number(match?.[1]);
    const start = headerEnd + 1;
    const end = start + size;
    if (!Number.isSafeInteger(size) || size < 0 || migrationSql[end] !== 0x0a) throw new Error(`Invalid Git migration blob: ${name}`);
    const sql = migrationSql.subarray(start, end);
    migrationOffset = end + 1;
    return { name, checksum: createHash("sha256").update(sql).digest("hex"),
      startedAt: "2026-11-26T09:00:00.000Z", finishedAt: "2026-11-26T09:00:01.000Z", rolledBackAt: null };
  });
  const sourceMarkerBase = [
    "schemaVersion=2", `manifestId=${AUTH_MULTIUSER_MANIFEST.id}`, `releaseSha=${AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA}`,
    "state=app-ready", "workflowRunId=40123456791", "workflowRunAttempt=1", "authorizationId=auth-multiuser-migration-auth",
    `lineageDigest=${"c".repeat(64)}`, "spawnState=started", "",
  ].join("\n");
  const compatibility = readGitCompatibility(repositoryPath, previousSha, AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA, AUTH_MULTIUSER_MANIFEST.id);
  const handoff = evaluateSchemaDeployHandoff({ markerText: sourceMarkerBase, deploySha: previousSha, ...compatibility });
  const markerText = renderSchemaDeployTransition(handoff.bytes, "app-ready").toString("utf8");
  const sourceReleaseMarker = {
    ...validateAuthMarkerForTrainingMigrationHandoff(markerText, { liveAppSha: previousSha, repositoryPath }),
    liveAppSha: previousSha,
  };
  const report = {
    identity, migrations: migrationRows, objects: [{ name: "DailyModelState", present: true, kind: "table", signature: "id integer; state jsonb" }],
    tables: { DailyModelState: { exists: true, estimatedRows: 1, totalBytes: 64 } },
    readability: Object.fromEntries(["Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog"]
      .map((table) => [table, { rowCount: 1 }])),
    logicalDataFingerprint: dataFingerprint, programlessSessionCount: 0,
  };
  const previousContainer = {
    Id: "7".repeat(64), Image: `sha256:${"8".repeat(64)}`,
    Config: { Labels: { "org.bodycast.release-sha": previousSha },
      Env: ["DATABASE_URL=postgresql://bodycast:secret@bodycast-db-prod:5432/bodycast", "NODE_ENV=production"],
      Entrypoint: ["node"], Cmd: ["server.js"], User: "node", WorkingDir: "/app",
      Healthcheck: { Test: ["CMD", "wget", "http://127.0.0.1:3000/api/readiness"] }, ExposedPorts: { "3000/tcp": {} } },
    HostConfig: { Binds: [], Mounts: [], PortBindings: {}, RestartPolicy: { Name: "unless-stopped" } },
    Mounts: [], NetworkSettings: { Networks: { "bodycast-backend-prod": {} } }, State: { Status: "running", Health: { Status: "healthy" } },
  };
  const previousRecord = capturePreviousAppProvenance({ container: previousContainer, databaseReport: report,
    targetSha: failedSha, imagePin: "bodycast-app:rollback-preflight-4001-1" });
  const previousAppProvenance = previousAppProvenanceBinding(previousRecord);
  const pending = TRAINING_SESSION_CONTEXT_MANIFEST.migrations.map(({ name }) => name).sort();
  const preflightResult = {
    readyForOwnerAuthorization: true, blockers: [], pendingExactlyExpected: true, manifestId: TRAINING_SESSION_CONTEXT_MANIFEST.id,
    pending, identity, migrations: migrationRows, objects: report.objects, tables: report.tables, readability: report.readability,
    logicalDataFingerprint: dataFingerprint, programlessSessionCount: 0, previousAppProvenance, sourceReleaseMarker,
  };
  const restoreResult = { verified: true, postflightReady: true, postSchemaDigest: "d".repeat(64), logicalDataFingerprint: dataFingerprint };
  const preflightReport = { ...report };
  const encryptedBackup = Buffer.from("reviewed encrypted backup bytes");
  const artifactMetadata = { id: "6001", digest: `sha256:${"e".repeat(64)}`, workflowRunId: "4001", expired: false };
  const preflightEvidence = {
    verified: true, releaseSha: failedSha, manifestId: TRAINING_SESSION_CONTEXT_MANIFEST.id, workflowRunId: "4001", workflowRunAttempt: 1,
    preflightResultDigest: canonicalSha256(preflightResult), previousAppProvenance,
    restoreResultDigest: canonicalSha256(restoreResult), productionIdentityDigest: canonicalSha256(identity),
    backupSnapshotAt: "2026-11-26T09:30:00.000Z", backupFileDigest: createHash("sha256").update(encryptedBackup).digest("hex"),
    pendingMigrationNames: pending, pendingSetDigest: canonicalSha256(pending),
  };
  const pair = generateKeyPairSync("ed25519");
  const keyId = "source-app-recovery-unit";
  const allowlist = { schemaVersion: 1, keys: [{ keyId, status: "active",
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString() }] };
  const claims = createClaimsFromPreflight({
    repository: "krustallik/body-model", workflowId: "77", workflowPath: ".github/workflows/production-migrate.yml",
    workflowRunId: "5001", workflowRunAttempt: 1, actorId: "126446430", releaseSha: failedSha, currentMainSha: failedSha,
    manifestId: TRAINING_SESSION_CONTEXT_MANIFEST.id, pendingMigrationNames: pending, preflightRunId: "4001", preflightRunAttempt: 1,
    preflightRunStartedAt: "2026-11-26T09:20:00.000Z", preflightResultDigest: preflightEvidence.preflightResultDigest,
    backupArtifactId: "6001", backupArtifactDigest: "e".repeat(64), backupSnapshotAt: preflightEvidence.backupSnapshotAt,
    restoreResultDigest: preflightEvidence.restoreResultDigest, productionIdentityDigest: canonicalSha256(identity),
    writerDrainDigest: "f".repeat(64), writerTopologyDigest: "a".repeat(64),
    issuedAt: "2026-11-26T09:40:00.000Z", expiresAt: "2026-11-26T10:10:00.000Z", authorizationId: randomUUID(), nonce: randomUUID(),
  });
  const envelope = createAuthorizationEnvelope(claims, {
    keyId, privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), allowlist,
  });
  const liveReport = { ...report, writerDrain: { activeClientBackends: [], topology: { ready: true } }, conflictingLocks: [], preparedTransactions: [] };
  return {
    repositoryPath, failedSha, previousSha, encryptedBackup, artifactMetadata, preflightEvidence, preflightReport, preflightResult,
    restoreResult, allowlist, envelope, previousRecordText: serializePreviousAppProvenance(previousRecord), markerText, liveReport,
  };
}

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

  it("admits source-app recovery only on the exact signed Auth marker and unchanged Training database", () => {
    const fixture = sourceAppRecoveryFixture();
    const parsedBundle = parseCutbackEvidenceBundle([
      fixture.envelope,
      JSON.stringify(fixture.artifactMetadata),
      JSON.stringify(fixture.preflightEvidence),
      JSON.stringify(fixture.preflightReport),
      JSON.stringify(fixture.preflightResult),
      JSON.stringify(fixture.restoreResult),
    ]);
    expect(typeof parsedBundle.envelope).toBe("string");
    expect(verifyCutbackEvidenceBundle({
      ...parsedBundle, allowlist: fixture.allowlist, expectedFailedRunId: "5001", expectedFailedSha: fixture.failedSha,
      backupFileBytes: fixture.encryptedBackup,
    })).toMatchObject({ verified: true, claims: { workflowRunId: "5001", manifestId: "training-session-context-v1" } });

    const verify = (overrides = {}) => verifyPreDdlSourceAppRecovery({
      envelope: fixture.envelope, artifactMetadata: fixture.artifactMetadata,
      preflightEvidence: fixture.preflightEvidence, preflightReport: fixture.preflightReport,
      preflightResult: fixture.preflightResult, restoreResult: fixture.restoreResult, allowlist: fixture.allowlist,
      expectedFailedRunId: "5001", expectedFailedSha: fixture.failedSha, backupFileBytes: fixture.encryptedBackup,
      liveReport: fixture.liveReport, recordText: fixture.previousRecordText, markerText: fixture.markerText,
      repositoryPath: fixture.repositoryPath, ...overrides,
    });

    expect(verify()).toMatchObject({ verified: true, manifestId: "training-session-context-v1", previousAppSha: fixture.previousSha });
    expect(() => verify({ liveReport: { ...fixture.liveReport, logicalDataFingerprint: "d".repeat(64) } }))
      .toThrow(/identity, full data\/sequence fingerprint/);
    expect(() => verify({ liveReport: { ...fixture.liveReport, writerDrain: {
      activeClientBackends: [{ pid: 7 }], topology: { ready: true },
    } } })).toThrow(/database writer/);
    expect(() => verify({ markerText: fixture.markerText.replace("state=app-ready", "state=schema-applied") }))
      .toThrow(/durable Auth marker bytes differ/);
    expect(() => verify({ recordText: fixture.previousRecordText.replace(fixture.previousSha, "9".repeat(40)) }))
      .toThrow();
  }, 120_000);
});
