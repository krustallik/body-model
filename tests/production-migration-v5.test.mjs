import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../scripts/production-migration-manifests.mjs";
import { EXPECTED_MIGRATION_OBJECTS, assertProductionDatabaseIdentityMatches, evaluateProductionPreflight, evaluateProductionPostflight, verifyRestoredBackup, schemaInventoryDigest } from "../scripts/production-migration-preflight.mjs";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST, STAGE_02_MANIFEST } from "../scripts/production-migration-manifests.mjs";
import { createAuthorizationEnvelope, verifyAuthorizationEnvelope, assertSignedAuthorizationRequired, canonicalSha256 } from "../scripts/production-migration-authorization.mjs";
import { selectLatestApplicablePreflight, verifyPreflightArtifactMetadata, isBackupFresh, withPrismaLockTimeout } from "../scripts/production-migration-release.mjs";
import { readCommittedGitBlob, sha256, verifyExecutionFileMatchesBlob, verifyManifestBlob } from "../scripts/production-migration-integrity.mjs";
import { renderProductionDbPreflightSql, getExpectedSchemaObjectNames } from "../scripts/production-db-preflight.mjs";
import { verifyBaseRestore, verifyDisposablePostflight } from "../scripts/production-migration-restore-check.mjs";
import { verifyPostflightMatchesRestore } from "../scripts/production-migration-preflight.mjs";
import { assertLiveDataMatchesBackupReadability, verifyFinalMigrationAuthorization, verifyFinalGuardReceipt } from "../scripts/production-migration-final-guard.mjs";
import { normalizeWorkflowRuns, selectAndVerifyArtifact } from "../scripts/production-migration-select-preflight.mjs";
import { assertBackupFreshAtDdlStart, assertPrismaMigrationAuthorized, assertPrismaTargetMatchesSignedIdentity, readLatestApplicablePreflightForDdl, startPrismaMigrationAtDdlBoundary } from "../scripts/run-prisma-migrate-with-lock-timeout.mjs";
import { normalizePostgresDatabaseIdentityRow } from "../scripts/postgres-database-identity.mjs";
import { psqlCompatibleDatabaseUrl } from "../scripts/production-db-target-url.mjs";
import { assertCurrentMigrationRunMatchesProof, executionProofAudience, readCurrentMigrationRunForDdl, requestGitHubOidcExecutionProof, verifyGitHubExecutionProof } from "../scripts/production-migration-execution-attestation.mjs";
import { PRODUCTION_WRITER_TOPOLOGY_CONTRACT } from "../scripts/production-writer-drain.mjs";

const now = Date.parse("2026-10-05T10:00:00.000Z");
const dirs = [
  "20260821000000_init",
  ...STAGE_02_MANIFEST.migrations.map((migration) => migration.name),
  ...ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations.map((migration) => migration.name),
];

function migrationRow(migration, checksum = migration.sha256) {
  return { name: migration.name, checksum, startedAt: "2026-10-01T00:00:00.000Z", finishedAt: "2026-10-01T00:00:01.000Z", rolledBackAt: null, hasLogs: false };
}

function schemaObjects(postflight = false) {
  return [...EXPECTED_MIGRATION_OBJECTS.map((name) => ({ name, present: true, kind: "constraint", signature: "reviewed-stage02-signature" })),
    ...ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredObjectsBefore.map((name) => ({
      name, present: !postflight, kind: "index",
      signature: postflight ? null : ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredObjectSignatureIncludes[name],
    })),
    ...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects.map((name) => ({
      name,
      present: postflight,
      kind: "table",
      signature: postflight ? ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightSignatureIncludes[name] ?? "reviewed-active-signature" : null,
    }))];
}

function readyWriterDrain(overrides = {}) {
  const observedAt = "2026-10-05T10:00:00.000Z";
  return {
    schemaVersion: 1,
    observerPid: 111,
    observerApplicationName: "bodycast-production-preflight",
    observedAt,
    identityPolicy: "no-other-client-backends",
    activeClientBackends: [],
    topology: {
      schemaVersion: 1,
      contract: PRODUCTION_WRITER_TOPOLOGY_CONTRACT,
      ready: true,
      blockers: [],
      observedAt,
      app: { name: "bodycast-app-prod", state: "absent", restartPolicy: null },
      database: { name: "bodycast-db-prod", state: "running", health: "healthy", publishedPostgresPort: false, networks: ["bodycast-backend-prod"] },
      backendNetwork: { name: "bodycast-backend-prod", containers: ["bodycast-db-prod"] },
      caddy: { name: "gymbeam-caddy", state: "running", configValidated: true },
      routeFile: { verified: true, maintenanceResponse: true, containsReverseProxy: false, sha256: "a".repeat(64) },
    },
    ...overrides,
  };
}

function validPrismaTargetState(identity, at = now, overrides = {}) {
  return {
    identity,
    writerDrain: {
      schemaVersion: 1,
      observerPid: 222,
      observerApplicationName: "bodycast-prisma-ddl-guard",
      identityPolicy: "no-other-client-backends",
      observedAt: new Date(at).toISOString(),
      activeClientBackends: [],
      ...overrides,
    },
  };
}

function validPreflightReport() {
  return {
    identity: { database: "bodycast", databaseOid: 16384, clusterSystemIdentifier: "7419276301947620311", role: "bodycast", serverVersion: "17.11", serverAddress: "172.20.0.2", serverPort: 5432 },
    logicalDataFingerprint: "d".repeat(64),
    readability: Object.fromEntries(["Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog"].map((name) => [name, { rowCount: 0 }])),
    migrations: [
      migrationRow({ name: dirs[0], sha256: "a".repeat(64) }),
      ...STAGE_02_MANIFEST.migrations.map((migration) => migrationRow(migration)),
    ],
    objects: schemaObjects(false),
    tables: Object.fromEntries(ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredTablesBefore.map((name) => [name, { exists: true, estimatedRows: 1, totalBytes: 128 }])),
    conflictingLocks: [],
    preparedTransactions: [],
    longTransactions: [],
    writerDrain: readyWriterDrain(),
  };
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const keyId = "fixture-key-2026";
const allowlist = { schemaVersion: 1, keys: [{ keyId, publicKeyPem, status: "active" }] };
const names = ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations.map(({ name }) => name).sort();
const { publicKey: oidcPublicKey, privateKey: oidcPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const oidcJwk = { ...oidcPublicKey.export({ format: "jwk" }), kid: "fixture-github-oidc-key", use: "sig", alg: "RS256" };

function claims(overrides = {}) {
  return {
    repository: "krustallik/body-model",
    workflowId: "production-migrate",
    workflowPath: ".github/workflows/production-migrate.yml",
    workflowRunId: "1501",
    workflowRunAttempt: 1,
    actorId: "126446430",
    releaseSha: "a".repeat(40),
    currentMainSha: "a".repeat(40),
    manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id,
    pendingMigrationNames: names,
    pendingSetDigest: canonicalSha256(names),
    preflightRunId: "1201",
    preflightRunAttempt: 2,
    preflightRunStartedAt: "2026-10-05T09:00:00.000Z",
    preflightResultDigest: "b".repeat(64),
    backupArtifactId: "121212",
    backupArtifactDigest: "c".repeat(64),
    backupSnapshotAt: "2026-10-05T09:30:00.000Z",
    restoreResultDigest: "d".repeat(64),
    productionIdentityDigest: "e".repeat(64),
    snapshotDataFingerprint: "d".repeat(64),
    writerDrainDigest: "1".repeat(64),
    writerTopologyDigest: "2".repeat(64),
    issuedAt: "2026-10-05T09:50:00.000Z",
    expiresAt: "2026-10-05T10:50:00.000Z",
    authorizationId: "authorization-identifier-12345",
    nonce: "f04f8d78-17c7-4c98-8fc1-b56d723e21aa",
    ...overrides,
  };
}

function liveContext(overrides = {}) {
  return {
    repository: "krustallik/body-model",
    workflowId: "production-migrate",
    workflowPath: ".github/workflows/production-migrate.yml",
    workflowRunId: "1501",
    workflowRunAttempt: 1,
    actorId: "126446430",
    releaseSha: "a".repeat(40),
    currentMainSha: "a".repeat(40),
    manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id,
    pendingMigrationNames: names,
    pendingSetDigest: canonicalSha256(names),
    preflightRunId: "1201",
    preflightRunAttempt: 2,
    preflightRunStartedAt: "2026-10-05T09:00:00.000Z",
    preflightResultDigest: "b".repeat(64),
    backupArtifactId: "121212",
    backupArtifactDigest: "c".repeat(64),
    backupSnapshotAt: "2026-10-05T09:30:00.000Z",
    restoreResultDigest: "d".repeat(64),
    productionIdentityDigest: "e".repeat(64),
    snapshotDataFingerprint: "d".repeat(64),
    writerDrainDigest: "1".repeat(64),
    writerTopologyDigest: "2".repeat(64),
    ...overrides,
  };
}

function signClaims(value, id = keyId, key = privateKey) {
  return canonicalJson({
    algorithm: "Ed25519",
    keyId: id,
    payload: value,
    signature: sign(null, Buffer.from(canonicalJson(value)), key).toString("base64url"),
  });
}

function createOidcProof(authorizationEnvelope, challenge, claimsOverride = {}, issuedAt = now) {
  const authorized = JSON.parse(authorizationEnvelope).payload;
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: oidcJwk.kid, typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://token.actions.githubusercontent.com",
    aud: executionProofAudience(authorizationEnvelope, challenge, allowlist, issuedAt),
    jti: randomUUID(),
    iat: Math.floor(issuedAt / 1000),
    nbf: Math.floor(issuedAt / 1000),
    exp: Math.floor((issuedAt + 4 * 60_000) / 1000),
    repository: "krustallik/body-model",
    repository_owner_id: "126446430",
    sub: "repo:krustallik/body-model:environment:production",
    environment: "production",
    workflow_ref: "krustallik/body-model/.github/workflows/production-migrate.yml@refs/heads/main",
    workflow_sha: authorized.releaseSha,
    ref: "refs/heads/main",
    sha: authorized.releaseSha,
    event_name: "workflow_dispatch",
    run_id: authorized.workflowRunId,
    run_attempt: authorized.workflowRunAttempt,
    actor_id: authorized.actorId,
    ...claimsOverride,
  })).toString("base64url");
  const input = header + "." + payload;
  return input + "." + sign("RSA-SHA256", Buffer.from(input), oidcPrivateKey).toString("base64url");
}

const verifyFixtureProof = (serialized, fixture, overrides = {}) => verifyGitHubExecutionProof(serialized, {
  authorizationEnvelope: fixture.authorizationEnvelope,
  allowlist,
  expectedChallenge: fixture.executionChallenge,
  now: fixture.checkedAt,
  jwks: [oidcJwk],
  ...overrides,
});

const boundaryOptions = (fixture) => ({
  executionProofVerifier: (serialized, options) => verifyGitHubExecutionProof(serialized, { ...options, jwks: [oidcJwk] }),
  currentMigrationRunProbe: async () => fixture.currentRun,
});

async function executionBoundaryFixture(identity = validPreflightReport().identity, checkedAt = now) {
  const backupSnapshotAt = new Date(checkedAt - 30 * 60_000).toISOString();
  const authorizationClaims = claims({
    workflowId: "150",
    productionIdentityDigest: canonicalSha256(identity),
    writerDrainDigest: "1".repeat(64),
    writerTopologyDigest: "2".repeat(64),
    backupSnapshotAt,
    issuedAt: new Date(checkedAt - 60_000).toISOString(),
    expiresAt: new Date(checkedAt + 50 * 60_000).toISOString(),
  });
  const authorizationEnvelope = createAuthorizationEnvelope(authorizationClaims, { keyId, privateKeyPem, allowlist });
  const latestPreflight = {
    repository: "krustallik/body-model",
    workflowPath: ".github/workflows/production-migration-preflight.yml",
    workflowId: "88",
    event: "workflow_dispatch",
    headBranch: "main",
    headSha: authorizationClaims.releaseSha,
    displayTitle: `Preflight ${authorizationClaims.releaseSha} ${authorizationClaims.manifestId}`,
    id: authorizationClaims.preflightRunId,
    runAttempt: authorizationClaims.preflightRunAttempt,
    createdAt: new Date(checkedAt - 5 * 60_000).toISOString(),
    runStartedAt: authorizationClaims.preflightRunStartedAt,
    status: "completed",
    conclusion: "success",
  };
  const executionChallenge = "ab".repeat(32);
  const executionProof = createOidcProof(authorizationEnvelope, executionChallenge, {}, checkedAt);
  const verifiedExecutionProof = await verifyGitHubExecutionProof(executionProof, {
    authorizationEnvelope, allowlist, expectedChallenge: executionChallenge, now: checkedAt, jwks: [oidcJwk],
  });
  const currentRun = {
    repository: { full_name: authorizationClaims.repository },
    path: authorizationClaims.workflowPath + "@refs/heads/main",
    workflow_id: Number(authorizationClaims.workflowId),
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: authorizationClaims.releaseSha,
    id: Number(authorizationClaims.workflowRunId),
    run_attempt: authorizationClaims.workflowRunAttempt,
    actor: { id: Number(authorizationClaims.actorId), login: "krustallik" },
    triggering_actor: { id: Number(authorizationClaims.actorId), login: "krustallik" },
    run_started_at: new Date(checkedAt - 10_000).toISOString(),
    status: "in_progress",
    conclusion: null,
  };
  return { authorizationClaims, authorizationEnvelope, latestPreflight, currentRun, executionProof, verifiedExecutionProof, executionChallenge, identity, checkedAt };
}

function authorizedBoundary(fixture, databaseUrl = "postgresql://bodycast:secret@db/bodycast", { backupSnapshotAt = new Date(fixture.checkedAt - 30 * 60_000).toISOString() } = {}) {
  const workflowId = "production-migrate";
  const workflowRunId = "1501";
  const workflowRunAttempt = 1;
  const signedClaims = claims({
    productionIdentityDigest: canonicalSha256(fixture.identity),
    backupSnapshotAt,
    issuedAt: new Date(fixture.checkedAt - 60_000).toISOString(),
    expiresAt: new Date(fixture.checkedAt + 50 * 60_000).toISOString(),
  });
  const envelope = signClaims(signedClaims);
  const finalObservedAt = new Date(fixture.checkedAt).toISOString();
  const receipt = {
    schemaVersion: 1,
    ready: true,
    authorizationId: signedClaims.authorizationId,
    manifestId: signedClaims.manifestId,
    releaseSha: signedClaims.releaseSha,
    currentMainSha: signedClaims.currentMainSha,
    workflowId: signedClaims.workflowId,
    workflowRunId: signedClaims.workflowRunId,
    workflowRunAttempt: signedClaims.workflowRunAttempt,
    actorId: signedClaims.actorId,
    pending: signedClaims.pendingMigrationNames,
    pendingSetDigest: signedClaims.pendingSetDigest,
    preflightRunId: signedClaims.preflightRunId,
    preflightRunAttempt: signedClaims.preflightRunAttempt,
    preflightResultDigest: signedClaims.preflightResultDigest,
    backupArtifactId: signedClaims.backupArtifactId,
    backupArtifactDigest: signedClaims.backupArtifactDigest,
    backupSnapshotAt: signedClaims.backupSnapshotAt,
    restoreResultDigest: signedClaims.restoreResultDigest,
    productionIdentityDigest: signedClaims.productionIdentityDigest,
    preflightWriterDrainDigest: signedClaims.writerDrainDigest,
    preflightWriterTopologyDigest: signedClaims.writerTopologyDigest,
    finalWriterDrainDigest: "1".repeat(64),
    finalWriterTopologyDigest: "2".repeat(64),
    finalWriterDrainObservedAt: finalObservedAt,
    finalTopologyObservedAt: finalObservedAt,
    postSchemaDigest: "9".repeat(64),
    snapshotDataFingerprint: signedClaims.snapshotDataFingerprint,
    verifiedAt: finalObservedAt,
  };
  return {
    databaseUrl,
    receipt,
    envelope,
    allowlist,
    currentWorkflowId: workflowId,
    currentWorkflowRunId: workflowRunId,
    currentWorkflowRunAttempt: workflowRunAttempt,
    currentMainSha: signedClaims.currentMainSha,
    releaseSha: signedClaims.releaseSha,
  };
}

describe("V5 closed migration manifest and full pending set", () => {
  it("renders the canonical preflight SQL template before the PostgreSQL backup/restore smoke executes it", async () => {
    const smoke = await readFile(new URL("../scripts/ci/production-safety-postgres-smoke.mjs", import.meta.url), "utf8");
    expect(smoke).toContain('import { renderProductionDbPreflightSql } from "../production-db-preflight.mjs";');
    expect(smoke).toContain('sql(db, renderProductionDbPreflightSql(requireSql("scripts/production-db-preflight.sql")))');
    expect(smoke).not.toContain('sql(db, requireSql("scripts/production-db-preflight.sql"))');
  });

  it("runs production preflight and postflight against the effective Compose Prisma DATABASE_URL", async () => {
    const deploy = await readFile(new URL("../scripts/deploy-migrate.sh", import.meta.url), "utf8");
    const target = await readFile(new URL("../scripts/production-db-target.sh", import.meta.url), "utf8");
    const preflight = await readFile(new URL("../.github/workflows/production-migration-preflight.yml", import.meta.url), "utf8");
    expect(deploy).toContain('production-db-target.sh" --preflight "$DB_CONTAINER"');
    expect(target).toContain("docker compose -f \"$COMPOSE_FILE\" --profile tools run --rm --no-deps");
    expect(target).toContain("production-db-target-url.mjs");
    expect(target).toContain('psql "$BODYCAST_PSQL_DATABASE_URL"');
    expect(preflight).toContain('production-db-target.sh\\" --preflight bodycast-db-prod');
    expect(preflight).not.toContain("psql --username=bodycast --dbname=bodycast");
    expect(deploy).not.toContain('psql --username=bodycast --dbname=bodycast');
  });

  it("uses the canonical preflight lock field and blocker wording in PostgreSQL smoke assertions", async () => {
    const smoke = await readFile(new URL("../scripts/ci/production-safety-postgres-smoke.mjs", import.meta.url), "utf8");
    const sql = await readFile(new URL("../scripts/production-db-preflight.sql", import.meta.url), "utf8");
    expect(smoke).toContain("report.conflictingLocks.push(");
    expect(smoke).toContain('"lock(s) conflict with the exact migration DDL operations"');
    expect(smoke).toContain('"HealthMetricSample", "StrengthDiarySession", "DailyModelState"');
    expect(smoke).toContain('const ddlLockCases = [');
    expect(smoke).toContain('{ tableName: "Workout", lockMode: "ROW EXCLUSIVE", pgMode: "RowExclusiveLock" }');
    expect(smoke).toContain('for (const tableName of ["Workout", "Profile", "ModelEpisode"])');
    expect(sql).toContain("ddl_targets(table_name, required_lock_mode)");
    expect(sql).toContain("('Workout', 'ShareRowExclusiveLock')");
    expect(sql).toContain("('PhysiologyV7Lifecycle', 'AccessExclusiveLock')");
    expect(smoke).toContain('withPreparedTransactionRelationLock(preparedDb, "DailyModelState"');
    expect(smoke).toContain('"HealthMetricSample", "StrengthDiarySession", "DailyModelState", "PhysiologyV7Lifecycle",');
    expect(smoke).toContain('"Workout", "Profile", "ModelEpisode", "BodycastUnrelatedLockProbe"');
    expect(smoke).toContain("withShortGrantedRelationLock(tableName, lockMode");
    expect(smoke).toContain('withShortGrantedRelationLock("BodycastUnrelatedLockProbe"');
    expect(smoke).not.toContain("relevantLocks");
    expect(smoke).not.toContain("relevant DDL-conflicting relation lock(s)");
  });

  it("matches every reviewed manifest hash to its exact blob at the release commit", async () => {
    const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
    for (const migration of [...STAGE_02_MANIFEST.migrations, ...ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations]) {
      const result = await verifyManifestBlob({ repositoryPath: process.cwd(), releaseSha, migration });
      expect(result.matchesManifest, migration.name).toBe(true);
    }
  });

  it("keeps the direct deployment shell hashes aligned with the closed manifest", async () => {
    const script = await readFile(new URL("../scripts/deploy-migrate.sh", import.meta.url), "utf8");
    for (const migration of ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations) {
      expect(script).toContain(`${migration.name}|${migration.sha256}`);
    }
  });

  it("accepts only the exact full pending set and reviewed Stage 02 history", () => {
    const result = evaluateProductionPreflight(validPreflightReport(), dirs);
    expect(result.readyForOwnerAuthorization).toBe(true);
    expect(result.pending).toEqual(names);
    expect(result.manifestId).toBe(ACTIVE_ENERGY_UNIFIED_MANIFEST.id);
  });

  it("blocks an extra release migration, unexpected database row, failed row, duplicate, rollback, checksum drift, or partial target schema", () => {
    const extraDirectory = evaluateProductionPreflight(validPreflightReport(), [...dirs, "20261004120000_unreviewed"]);
    expect(extraDirectory.blockers.join(" ")).toContain("Full release-tree pending set differs");

    const unexpected = validPreflightReport();
    unexpected.migrations.push(migrationRow({ name: "20260701000000_not-in-tree", sha256: "1".repeat(64) }));
    expect(evaluateProductionPreflight(unexpected, dirs).blockers.join(" ")).toContain("absent from this release tree");

    const failed = validPreflightReport();
    failed.migrations.push({ name: dirs[0], checksum: "a".repeat(64), startedAt: "2026-10-02T00:00:00Z", finishedAt: null, rolledBackAt: null });
    expect(evaluateProductionPreflight(failed, dirs).blockers.join(" ")).toContain("Duplicate migration history");

    const rollback = validPreflightReport();
    rollback.migrations[1].rolledBackAt = "2026-10-02T00:00:00Z";
    expect(evaluateProductionPreflight(rollback, dirs).blockers.join(" ")).toContain("Rolled-back");

    const checksum = validPreflightReport();
    checksum.migrations[1].checksum = "0".repeat(64);
    expect(evaluateProductionPreflight(checksum, dirs).blockers.join(" ")).toContain("checksum differs");

    const partial = validPreflightReport();
    partial.objects.find((object) => object.name === ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects[0]).present = true;
    expect(evaluateProductionPreflight(partial, dirs).blockers.join(" ")).toContain("already exist");

    const wrongLegacyIndex = validPreflightReport();
    wrongLegacyIndex.objects.find((object) => object.name === ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredObjectsBefore[0]).signature = "unique=false|valid=false";
    expect(evaluateProductionPreflight(wrongLegacyIndex, dirs).blockers.join(" ")).toContain("pre-migration schema signatures differ");
  });

  it("requires exact target checksums and schema-object signatures after disposable migration rehearsal", () => {
    const post = validPreflightReport();
    post.identity = { ...post.identity, database: "bodycast_restore", databaseOid: 16385, role: "bodycast_restore", serverAddress: "172.20.0.3" };
    post.migrations.push(...ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations.map((migration) => migrationRow(migration)));
    post.objects = schemaObjects(true);
    const result = evaluateProductionPostflight(post, dirs, ACTIVE_ENERGY_UNIFIED_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" });
    expect(result.ready).toBe(true);
    post.objects.find((object) => object.name === "RelMuscleDelta_episode_date_key").signature = "unique=false|wrong-columns";
    expect(evaluateProductionPostflight(post, dirs, ACTIVE_ENERGY_UNIFIED_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" }).blockers.join(" ")).toContain("Relative Muscle postflight schema signatures differ");
    post.objects = schemaObjects(true);
    post.migrations.find((row) => row.name === ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations[0].name).checksum = "0".repeat(64);
    expect(evaluateProductionPostflight(post, dirs, ACTIVE_ENERGY_UNIFIED_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" }).blockers.join(" ")).toContain("checksum differs");
  });

  it("keeps the complete object inventory synchronized with the SQL renderer", async () => {
    const template = await readFile(new URL("../scripts/production-db-preflight.sql", import.meta.url), "utf8");
    const sql = renderProductionDbPreflightSql(template);
    const normalizedSql = sql.replaceAll("\r\n", "\n");
    const expected = getExpectedSchemaObjectNames();
    expect(expected).toEqual([...new Set([
      ...EXPECTED_MIGRATION_OBJECTS,
      ...ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredObjectsBefore,
      ...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects,
    ])].sort());
    expect(sql).not.toContain("__EXPECTED_SCHEMA_OBJECTS_JSON__");
    expect(sql).toContain("BEGIN READ ONLY;");
    expect(await readFile(new URL("../scripts/run-prisma-migrate-with-lock-timeout.mjs", import.meta.url), "utf8")).toContain("withPrismaLockTimeout(authorized.databaseUrl, 5000)");
    expect(await readFile(new URL("../scripts/production-db-target.sh", import.meta.url), "utf8")).toContain("default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000");
    expect(sql).toContain("PhysiologyV7Lifecycle");
    expect(sql).toContain("DailyModelState");
    for (const relation of ["Workout", "Profile", "ModelEpisode"]) expect(sql).toContain(`('${relation}')`);
    expect(sql).toContain("inet_server_addr()::text");
    expect(sql).toContain("inet_server_port()");
    expect(sql).toContain("'databaseOid', (SELECT oid::bigint FROM pg_database WHERE datname = current_database())");
    expect(sql).toContain("'clusterSystemIdentifier', (SELECT system_identifier::text FROM pg_control_system())");
    const prismaIdentityProbe = await readFile(new URL("../scripts/run-prisma-migrate-with-lock-timeout.mjs", import.meta.url), "utf8");
    expect(prismaIdentityProbe).toContain('(SELECT system_identifier::text FROM pg_control_system()) AS "clusterSystemIdentifier"');
    expect(normalizedSql).toContain("ORDER BY dep.refobjid, dep.refobjsubid\n            LIMIT 1");
    expect(sql).not.toContain("LEFT JOIN pg_depend dep ON dep.classid = 'pg_class'::regclass AND dep.objid = cl.oid");
    expect(sql).not.toMatch(/^\s*(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
  });

  it("blocks DDL-conflicting relation locks and preserves unrelated diagnostics", () => {
    const report = validPreflightReport();
    report.conflictingLocks.push({ relation: "PhysiologyV7Lifecycle", mode: "RowExclusiveLock", granted: true });
    const result = evaluateProductionPreflight(report, dirs);
    expect(result.readyForOwnerAuthorization).toBe(false);
    expect(result.blockers.join(" ")).toContain("conflict with the exact migration DDL");
    report.conflictingLocks = [];
    report.longTransactions.push({ pid: 123, xactAgeSeconds: 900 });
    expect(evaluateProductionPreflight(report, dirs).readyForOwnerAuthorization).toBe(true);
  });

  it("binds signed target identity to the concrete PostgreSQL endpoint", () => {
    const expected = validPreflightReport().identity;
    expect(assertProductionDatabaseIdentityMatches(expected, { ...expected })).toBe(true);
    expect(() => assertProductionDatabaseIdentityMatches(expected, { ...expected, serverAddress: "172.20.0.99" })).toThrow("differs from the signed preflight target");
    expect(() => assertProductionDatabaseIdentityMatches(expected, { ...expected, database: "bodycast_restore" })).toThrow("differs from the signed preflight target");
    expect(() => assertProductionDatabaseIdentityMatches(expected, { ...expected, clusterSystemIdentifier: "7419276301947620312" })).toThrow("differs from the signed preflight target");
    const incomplete = validPreflightReport();
    delete incomplete.identity.serverAddress;
    expect(evaluateProductionPreflight(incomplete, dirs).blockers.join(" ")).toContain("endpoint identity is incomplete");
    for (const clusterSystemIdentifier of [undefined, "0", "18446744073709551616", 7419276301947620311]) {
      const invalidCluster = validPreflightReport();
      invalidCluster.identity.clusterSystemIdentifier = clusterSystemIdentifier;
      expect(evaluateProductionPreflight(invalidCluster, dirs).blockers.join(" ")).toContain("endpoint identity is incomplete");
    }
  });

  it("normalizes PostgreSQL OID and port types without losing the cluster system identifier precision", () => {
    const identity = normalizePostgresDatabaseIdentityRow({
      database: "bodycast",
      databaseOid: "16384",
      clusterSystemIdentifier: "9223372036854775807",
      role: "bodycast",
      serverVersion: "17.11",
      serverAddress: "172.20.0.2",
      serverPort: 5432,
      observerPid: 123,
    });
    expect(identity).toEqual({
      database: "bodycast",
      databaseOid: 16384,
      clusterSystemIdentifier: "9223372036854775807",
      role: "bodycast",
      serverVersion: "17.11",
      serverAddress: "172.20.0.2",
      serverPort: 5432,
    });
    expect(typeof identity.clusterSystemIdentifier).toBe("string");
    expect(normalizePostgresDatabaseIdentityRow({
      database: "bodycast", databaseOid: "16384", clusterSystemIdentifier: "-9223372036854775808",
      role: "bodycast", serverVersion: "17.11", serverAddress: "172.20.0.2", serverPort: 5432,
    }).clusterSystemIdentifier).toBe("-9223372036854775808");
    expect(() => normalizePostgresDatabaseIdentityRow({
      database: "bodycast", databaseOid: "16384", clusterSystemIdentifier: "9223372036854775808",
      role: "bodycast", serverVersion: "17.11", serverAddress: "172.20.0.2", serverPort: 5432,
    })).toThrow("clusterSystemIdentifier");
    expect(() => normalizePostgresDatabaseIdentityRow({
      database: "bodycast", databaseOid: "not-an-oid", clusterSystemIdentifier: "7419276301947620311",
      role: "bodycast", serverVersion: "17.11", serverAddress: "172.20.0.2", serverPort: 5432,
    })).toThrow("incomplete or invalid endpoint identity");
  });

  it("derives the psql target from Prisma DATABASE_URL while removing only Prisma-only parameters", () => {
    const result = new URL(psqlCompatibleDatabaseUrl("postgresql://bodycast:p%40ss@db-primary:5433/bodycast?schema=public&connection_limit=8&sslmode=require"));
    expect(result.hostname).toBe("db-primary");
    expect(result.port).toBe("5433");
    expect(result.pathname).toBe("/bodycast");
    expect(result.username).toBe("bodycast");
    expect(result.password).toBe("p%40ss");
    expect(result.searchParams.get("schema")).toBeNull();
    expect(result.searchParams.get("connection_limit")).toBeNull();
    expect(result.searchParams.get("sslmode")).toBe("require");
    expect(() => psqlCompatibleDatabaseUrl("postgresql://u:p@db/bodycast?sslidentity=client" )).toThrow("cannot faithfully preserve");
    expect(() => psqlCompatibleDatabaseUrl("postgresql://u:p@db/bodycast?schema=tenant" )).toThrow("public Prisma schema target");
    expect(() => psqlCompatibleDatabaseUrl("postgresql://u:p@db/bodycast?host=other-db" )).toThrow("target overrides");
  });

  it("uses the actual post-verification clock at the Prisma spawn boundary", async () => {
    const snapshot = Date.parse("2026-10-05T09:00:00.000Z");
    let current = snapshot + 60 * 60 * 1000 - 1;
    const identity = validPreflightReport().identity;
    const fixture = await executionBoundaryFixture(identity, current);
    const authorized = authorizedBoundary(fixture, undefined, { backupSnapshotAt: new Date(snapshot).toISOString() });
    const spawn = vi.fn(() => ({ status: 0 }));
    const nonceDirectory = await mkdtemp(path.join(os.tmpdir(), "bodycast-v5-ddl-boundary-"));
    try {
      await expect(startPrismaMigrationAtDdlBoundary({
        authorized,
        now: () => current,
        spawn,
        nonceDirectory,
        latestPreflightProbe: async () => fixture.latestPreflight,
        ...boundaryOptions(fixture),
        identityProbe: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          current += 2;
          return validPrismaTargetState(identity, current);
        },
      })).rejects.toThrow("not fresh at DDL start");
      expect(spawn).not.toHaveBeenCalled();
      expect(() => assertBackupFreshAtDdlStart(authorized.receipt, snapshot + 60 * 60 * 1000)).not.toThrow();
    } finally {
      await rm(nonceDirectory, { recursive: true, force: true });
    }
  });

  it("executes DDL only after a signed final guard, fresh backup, and matching live database identity", async () => {
    const identity = validPreflightReport().identity;
    const fixture = await executionBoundaryFixture(identity);
    const ioOrder = [];
    const spawn = vi.fn(() => {
      ioOrder.push("spawn");
      const child = new EventEmitter();
      child.kill = vi.fn();
      queueMicrotask(() => { child.emit("spawn"); setImmediate(() => child.emit("close", 0, null)); });
      return child;
    });
    const markerWriter = vi.fn(async () => { ioOrder.push("durable-marker"); return { markerPath: "/marker", digest: "a".repeat(64) }; });
    const spawnAcknowledger = vi.fn(async () => { ioOrder.push("spawn-ack"); });
    const identityProbe = vi.fn(async () => validPrismaTargetState(identity, now));
    const expectedUrl = withPrismaLockTimeout("postgresql://bodycast:secret@db/bodycast", 5000);
    const authorized = authorizedBoundary(fixture);
    await startPrismaMigrationAtDdlBoundary({
      authorized,
      spawn,
      identityProbe,
      markerWriter,
      spawnAcknowledger,
      environment: { ...process.env, BODYCAST_RELEASE_MARKER_DIRECTORY: "/run/bodycast-release-marker" },
      now: () => now,
    });
    expect(identityProbe).toHaveBeenLastCalledWith(expectedUrl);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0]).toBe("npx");
    expect(spawn.mock.calls[0][1]).toEqual(["prisma", "migrate", "deploy"]);
    expect(spawn.mock.calls[0][2].env.DATABASE_URL).toBe(expectedUrl);
    expect(ioOrder).toEqual(["durable-marker", "spawn", "spawn-ack"]);
    expect(markerWriter).toHaveBeenCalledBefore(spawn);
    expect(ioOrder.indexOf("spawn-ack")).toBeGreaterThan(ioOrder.indexOf("spawn"));
  });

  it("leaves a blocking pre-spawn marker and never invokes Prisma if durable marker publication fails", async () => {
    const identity = validPreflightReport().identity;
    const fixture = await executionBoundaryFixture(identity);
    const spawn = vi.fn();
    await expect(startPrismaMigrationAtDdlBoundary({
      authorized: authorizedBoundary(fixture),
      spawn,
      markerWriter: async () => { throw new Error("fsync failed"); },
      environment: { ...process.env, BODYCAST_RELEASE_MARKER_DIRECTORY: "/run/bodycast-release-marker" },
      identityProbe: async () => validPrismaTargetState(identity, now),
      now: () => now,
    })).rejects.toThrow("fsync failed");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not mislabel a process-creation failure as executed DDL", async () => {
    const identity = validPreflightReport().identity;
    const fixture = await executionBoundaryFixture(identity);
    let persistedMarker;
    const spawn = vi.fn(() => { throw new Error("ENOENT"); });
    await expect(startPrismaMigrationAtDdlBoundary({
      authorized: authorizedBoundary(fixture),
      environment: { ...process.env, BODYCAST_RELEASE_MARKER_DIRECTORY: "/run/bodycast-release-marker" },
      spawn,
      markerWriter: async () => {
        persistedMarker = { state: "ddl-starting", spawnState: "not-started" };
        return { markerPath: "/marker", digest: "a".repeat(64) };
      },
      identityProbe: async () => validPrismaTargetState(identity, now),
      now: () => now,
    })).rejects.toThrow("process creation failed before spawn");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(persistedMarker).toEqual({ state: "ddl-starting", spawnState: "not-started" });
  });

  it("kills Prisma and retains the blocking pre-spawn state when durable spawn acknowledgement fails", async () => {
    const identity = validPreflightReport().identity;
    const fixture = await executionBoundaryFixture(identity);
    const child = new EventEmitter();
    child.kill = vi.fn();
    const spawn = vi.fn(() => child);
    let persistedMarker;
    const task = startPrismaMigrationAtDdlBoundary({
      authorized: authorizedBoundary(fixture), spawn,
      environment: { ...process.env, BODYCAST_RELEASE_MARKER_DIRECTORY: "/run/bodycast-release-marker" },
      markerWriter: async () => {
        persistedMarker = { state: "ddl-starting", spawnState: "not-started" };
        return { markerPath: "/marker", digest: "a".repeat(64) };
      },
      spawnAcknowledger: async () => { throw new Error("marker acknowledgement failed"); },
      identityProbe: async () => validPrismaTargetState(identity, now),
      now: () => now,
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    child.emit("spawn");
    await new Promise((resolve) => setImmediate(resolve));
    child.emit("close", null, "SIGTERM");
    await expect(task).rejects.toThrow("durable spawn acknowledgement failed");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(persistedMarker).toEqual({ state: "ddl-starting", spawnState: "not-started" });
  });

  it("uses the actual Prisma process as the spawn boundary after durable marker publication", async () => {
    const source = await readFile(new URL("../scripts/run-prisma-migrate-with-lock-timeout.mjs", import.meta.url), "utf8");
    expect(source).toContain('child = spawn("npx", ["prisma", "migrate", "deploy"]');
    expect(source.indexOf("await markerWriter({")).toBeLessThan(source.indexOf('child = spawn("npx"'));
    expect(source).toContain('child.once("spawn", async () =>');
    expect(source).toContain("spawnAcknowledger({ markerPath: marker.markerPath, expectedDigest: marker.digest })");
    expect(source).not.toContain("prisma-migrate-ddl-gate.mjs");
  });

  it("rejects cancelled or non-current GitHub migration-run metadata", async () => {
    const fixture = await executionBoundaryFixture();
    const cases = [
      { ...fixture.currentRun, status: "completed", conclusion: "cancelled" },
      { ...fixture.currentRun, id: 999999 },
      { ...fixture.currentRun, run_attempt: fixture.currentRun.run_attempt + 1 },
      { ...fixture.currentRun, head_sha: "b".repeat(40) },
      { ...fixture.currentRun, path: ".github/workflows/other.yml@refs/heads/main" },
      { ...fixture.currentRun, repository: { full_name: "someone/else" } },
      { ...fixture.currentRun, event: "push" },
      { ...fixture.currentRun, head_branch: "feature/other" },
    ];
    for (const currentRun of cases) expect(() => assertCurrentMigrationRunMatchesProof(
      fixture.verifiedExecutionProof, currentRun, now,
    )).toThrow("no longer reports the exact OIDC-authenticated migration run as current and admitted");
  });

  it("rejects OIDC proofs with wrong run, attempt, SHA, workflow, challenge, or forged payload", async () => {
    const fixture = await executionBoundaryFixture();
    for (const override of [
      { repository: "someone/else" }, { ref: "refs/heads/feature/other" }, { event_name: "push" },
      { sub: "repo:krustallik/body-model:environment:staging" }, { environment: "staging" },
      { run_id: "1502" }, { run_attempt: 2 }, { sha: "b".repeat(40) },
      { workflow_sha: "b".repeat(40) },
      { workflow_ref: "krustallik/body-model/.github/workflows/other.yml@refs/heads/main" },
    ]) {
      const token = createOidcProof(fixture.authorizationEnvelope, fixture.executionChallenge, override, now);
      await expect(verifyFixtureProof(token, fixture)).rejects.toThrow("not from the exact authorized repository");
    }
    for (const override of [
      { iss: "https://example.invalid" },
      { aud: "bodycast-wrong-execution-audience" },
    ]) {
      const token = createOidcProof(fixture.authorizationEnvelope, fixture.executionChallenge, override, now);
      await expect(verifyFixtureProof(token, fixture)).rejects.toThrow("audience, issuer, replay id, or freshness");
    }
    await expect(verifyGitHubExecutionProof(fixture.executionProof, {
      authorizationEnvelope: fixture.authorizationEnvelope, allowlist,
      expectedChallenge: "cd".repeat(32), now, jwks: [oidcJwk],
    })).rejects.toThrow("audience, issuer, replay id, or freshness");
    const [header, payload, signature] = fixture.executionProof.split(".");
    const changedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), run_id: "forged" })).toString("base64url");
    await expect(verifyFixtureProof(header + "." + changedPayload + "." + signature, fixture)).rejects.toThrow("signature is invalid");
  });

  it("loads current migration status by the run ID in verified OIDC claims", async () => {
    const fixture = await executionBoundaryFixture();
    const fetchImpl = vi.fn(async (url) => ({ ok: true, json: async () => fixture.currentRun, requestedUrl: String(url) }));
    await expect(readCurrentMigrationRunForDdl(fixture.verifiedExecutionProof, fetchImpl)).resolves.toEqual(fixture.currentRun);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.github.com/repos/krustallik/body-model/actions/runs/1501");
  });

  it("requests a short-lived OIDC token for the exact authorization and one-time challenge audience", async () => {
    const fixture = await executionBoundaryFixture();
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-v5-oidc-request-"));
    const outputPath = path.join(directory, "proof.jwt");
    const expectedAudience = executionProofAudience(fixture.authorizationEnvelope, fixture.executionChallenge, allowlist, now);
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url.hostname).toBe("pipelines.actions.githubusercontent.com");
      expect(url.searchParams.get("audience")).toBe(expectedAudience);
      expect(options.headers.authorization).toBe("Bearer one-job-capability");
      return { ok: true, json: async () => ({ value: fixture.executionProof }) };
    });
    try {
      const token = await requestGitHubOidcExecutionProof({
        authorizationEnvelope: fixture.authorizationEnvelope,
        challenge: fixture.executionChallenge,
        allowlist,
        requestUrl: "https://pipelines.actions.githubusercontent.com/job-token?api-version=2.0",
        requestToken: "one-job-capability",
        outputPath,
        fetchImpl,
        now,
      });
      expect(token).toBe(fixture.executionProof);
      expect(await readFile(outputPath, "utf8")).toBe(token + "\n");
      await expect(verifyGitHubExecutionProof(token, {
        authorizationEnvelope: fixture.authorizationEnvelope,
        allowlist,
        expectedChallenge: fixture.executionChallenge,
        now,
        jwks: [oidcJwk],
      })).resolves.toMatchObject({ runId: "1501", runAttempt: 1 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("requires the real signed final-guard files rather than caller flags", async () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    const forgedLegacyMaterial = {
      receipt: { productionIdentityDigest: "e".repeat(64), backupSnapshotAt: new Date(now - 10_000).toISOString() },
      databaseUrl: "postgresql://bodycast:secret@db/bodycast",
      envelope: signClaims(claims()),
      allowlist,
      executionChallenge: "ab".repeat(32),
      migrationRun: { id: "1501", runAttempt: 1, status: "in_progress", headSha: "a".repeat(40) },
      migrationRunJson: "forged-migration-run.json",
      executionAttestation: "previously-signed-attestation",
      executionKeyCertificate: "previously-valid-certificate",
    };
    await expect(startPrismaMigrationAtDdlBoundary({
      authorized: forgedLegacyMaterial,
      spawn,
    })).rejects.toThrow("final guard receipt is missing, malformed, or has unsupported fields");
    expect(spawn).not.toHaveBeenCalled();

    const context = await mkdtemp(path.join(os.tmpdir(), "bodycast-v5-guard-context-"));
    const receiptPath = path.join(context, "receipt.json");
    const envelopePath = path.join(context, "authorization.json");
    const keysPath = path.join(context, "keys.json");
    await Promise.all([
      writeFile(receiptPath, JSON.stringify({ schemaVersion: 1 })),
      writeFile(envelopePath, "{}\n"),
      writeFile(keysPath, JSON.stringify(allowlist)),
    ]);
    const environment = {
      DATABASE_URL: "postgresql://bodycast:secret@db/bodycast",
      BODYCAST_DDL_EXECUTION_CHALLENGE: "ab".repeat(32),
      BODYCAST_FINAL_GUARD_RECEIPT: receiptPath,
      BODYCAST_AUTHORIZATION_ENVELOPE: envelopePath,
      BODYCAST_VERIFICATION_KEYS: keysPath,
      BODYCAST_MIGRATION_RUN_JSON: "forged-migration-run.json",
      BODYCAST_EXECUTION_ATTESTATION: "previously-valid-attestation.json",
      BODYCAST_RELEASE_SHA: "b".repeat(40),
      BODYCAST_CANONICAL_MAIN_SHA: "a".repeat(40),
    };
    try {
      await expect(assertPrismaMigrationAuthorized(environment)).rejects.toThrow("release SHA is not the freshly checked canonical main tip");
      expect(spawn).not.toHaveBeenCalled();
    } finally { await rm(context, { recursive: true, force: true }); }
  });

  it("blocks DDL when any key live table changed after the encrypted backup snapshot", () => {
    const counts = Object.fromEntries(["Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog"]
      .map((name) => [name, { rowCount: 3 }]));
    expect(assertLiveDataMatchesBackupReadability(counts, structuredClone(counts))).toBe(true);
    const postSnapshotMutation = structuredClone(counts);
    postSnapshotMutation.Workout.rowCount += 1;
    expect(() => assertLiveDataMatchesBackupReadability(counts, postSnapshotMutation)).toThrow("snapshot-row-count:Workout");
    expect(() => assertLiveDataMatchesBackupReadability(counts, { ...counts, DailyModelState: null })).toThrow("snapshot-row-count:DailyModelState");
  });

  it("ignores unadmitted queued runs and supersedes only after trusted admission", async () => {
    const fixture = await executionBoundaryFixture(validPreflightReport().identity);
    const toApiRun = (run) => ({
      workflow_id: Number(run.workflowId), path: run.workflowPath + "@refs/heads/main", event: run.event,
      actor: { id: Number(run.actorId) },
      triggering_actor: { id: Number(run.actorId) },
      head_branch: run.headBranch, head_sha: run.headSha, display_title: run.displayTitle,
      id: Number(run.id), run_attempt: run.runAttempt, created_at: run.createdAt,
      run_started_at: run.runStartedAt,
      status: run.status, conclusion: run.conclusion, html_url: "https://example.invalid/run",
    });
    const queued = { ...fixture.latestPreflight, id: "1202", createdAt: "2026-10-05T10:01:00.000Z", runStartedAt: null, status: "queued", conclusion: null };
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ workflow_runs: [toApiRun(queued), toApiRun(fixture.latestPreflight)] }),
      requestedUrl: String(url),
    }));
    await expect(readLatestApplicablePreflightForDdl(fixture.verifiedExecutionProof, fetchImpl))
      .resolves.toMatchObject(fixture.latestPreflight);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/actions/workflows/production-migration-preflight.yml/runs");

    const admitted = { ...queued, runStartedAt: "2026-10-05T10:02:00.000Z", status: "in_progress" };
    const admittedFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ workflow_runs: [toApiRun(admitted), toApiRun(fixture.latestPreflight)] }),
    }));
    await expect(readLatestApplicablePreflightForDdl(fixture.verifiedExecutionProof, admittedFetch))
      .rejects.toThrow("Latest matching preflight attempt is in_progress");
  });

  it("blocks when the final Prisma URL resolves to an endpoint different from signed identity", async () => {
    const signedIdentity = validPreflightReport().identity;
    const fixture = await executionBoundaryFixture(signedIdentity);
    const spawn = vi.fn(() => ({ status: 0 }));
    const ioOrder = [];
    await expect(startPrismaMigrationAtDdlBoundary({
      authorized: authorizedBoundary(fixture),
      spawn,
      identityProbe: async (url) => {
        ioOrder.push(["final-identity", url]);
        return validPrismaTargetState({ ...signedIdentity, database: "bodycast_restore", databaseOid: 20001, role: "restore_user", serverPort: 5433 }, now);
      },
      now: () => now,
    })).rejects.toThrow("final Prisma DATABASE_URL target differs from the verified production identity");
    expect(spawn).not.toHaveBeenCalled();
    expect(ioOrder.map(([name]) => name)).toEqual(["final-identity"]);
    expect(ioOrder[0][1]).toBe(withPrismaLockTimeout(authorizedBoundary(fixture).databaseUrl, 5000));
    const targetState = validPrismaTargetState(signedIdentity, now);
    expect(assertPrismaTargetMatchesSignedIdentity({ productionIdentityDigest: canonicalSha256(signedIdentity) }, targetState, now)).toBe(true);
    expect(() => assertPrismaTargetMatchesSignedIdentity({ productionIdentityDigest: canonicalSha256(signedIdentity) }, {
      ...targetState, identity: { ...signedIdentity, serverAddress: "127.0.0.2" },
    }, now)).toThrow("differs from the verified production identity");
    expect(() => assertPrismaTargetMatchesSignedIdentity({ productionIdentityDigest: canonicalSha256(signedIdentity) }, {
      ...targetState, identity: { ...signedIdentity, clusterSystemIdentifier: "7419276301947620312" },
    }, now)).toThrow("differs from the verified production identity");
    expect(() => assertPrismaTargetMatchesSignedIdentity({ productionIdentityDigest: canonicalSha256(signedIdentity) }, {
      ...targetState, identity: { ...signedIdentity, clusterSystemIdentifier: undefined },
    }, now)).toThrow("differs from the verified production identity");
    expect(() => assertPrismaTargetMatchesSignedIdentity({ productionIdentityDigest: canonicalSha256(signedIdentity) }, {
      ...targetState, identity: { ...signedIdentity, clusterSystemIdentifier: "0" },
    }, now)).toThrow("differs from the verified production identity");
    try {
      assertPrismaTargetMatchesSignedIdentity({ productionIdentityDigest: canonicalSha256(signedIdentity) }, validPrismaTargetState(signedIdentity, now, {
        activeClientBackends: [{ pid: 501, applicationName: "bodycast-reconnected-writer", clientAddress: null }],
      }), now);
      throw new Error("a non-empty writer inventory unexpectedly passed the final guard");
    } catch (error) {
      expect(JSON.parse(error.message.split("checks=")[1])).toContainEqual({ id: "zero-other-client-backends", passed: false });
      expect(error.message).not.toContain("bodycast-reconnected-writer");
    }
  });

  it("blocks Prisma spawn for missing or unreadable cluster identity", async () => {
    const signedIdentity = validPreflightReport().identity;
    const fixture = await executionBoundaryFixture(signedIdentity);
    const spawn = vi.fn(() => ({ status: 0 }));
    for (const clusterSystemIdentifier of [undefined, "invalid", "0", "7419276301947620312"]) {
      await expect(startPrismaMigrationAtDdlBoundary({
        authorized: authorizedBoundary(fixture),
        spawn,
        identityProbe: async () => validPrismaTargetState({ ...signedIdentity, clusterSystemIdentifier }, now),
        now: () => now,
      })).rejects.toThrow("final Prisma DATABASE_URL target differs from the verified production identity");
    }
    await expect(startPrismaMigrationAtDdlBoundary({
      authorized: authorizedBoundary(fixture),
      spawn,
      identityProbe: async () => { throw new Error("permission denied for function pg_control_system"); },
      now: () => now,
    })).rejects.toThrow("permission denied for function pg_control_system");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("serializes deploy, migration, and traffic mutations with one host lock", async () => {
    const [lock, deploy, migrate, traffic] = await Promise.all([
      readFile(new URL("../scripts/production-release-lock.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/deploy.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/deploy-migrate.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/production-traffic-cutover.sh", import.meta.url), "utf8"),
    ]);
    for (const script of [deploy, migrate, traffic]) expect(script).toContain("production-release-lock.sh");
    expect(lock).toContain('exec 9>"$git_dir/bodycast-production-release.lock"');
    expect(lock).toContain("flock -n 9");
  });

  it("uses owner-only manual workflows and durably marks the final-check-to-Prisma handoff", async () => {
    const preflight = await readFile(new URL("../.github/workflows/production-migration-preflight.yml", import.meta.url), "utf8");
    const migrate = await readFile(new URL("../.github/workflows/production-migrate.yml", import.meta.url), "utf8");
    const deployWorkflow = await readFile(new URL("../.github/workflows/deploy-production.yml", import.meta.url), "utf8");
    const activationWorkflow = await readFile(new URL("../.github/workflows/activate-unified-v4-production.yml", import.meta.url), "utf8");
    const ciWorkflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const group = (workflow) => workflow.match(/^concurrency:\r?\n  group: ([^\r\n]+)\r?\n  cancel-in-progress: false/m)?.[1];
    expect(group(preflight)).toBe("bodycast-production-release");
    expect(group(migrate)).toBe(group(preflight));
    expect(group(deployWorkflow)).toBe(group(preflight));
    expect(group(activationWorkflow)).toBe(group(preflight));
    expect(preflight).not.toContain("cancel-in-progress: true");
    expect(migrate).not.toContain("cancel-in-progress: true");
    expect(preflight).toContain('CONFIRMATION: ${{ inputs.confirm_production_preflight }}');
    expect(preflight).toContain('[[ "$DISPATCH_ACTOR_ID" == "126446430" ]]');
    const preflightSecretsJob = preflight.slice(preflight.indexOf("  inspect_backup_restore:"));
    const rerunOwnerGate = preflightSecretsJob.indexOf("Recheck owner identity for this job attempt before production secrets");
    const firstSecretStep = preflightSecretsJob.indexOf("Validate production-only SSH and backup secrets");
    expect(rerunOwnerGate).toBeGreaterThan(-1);
    expect(rerunOwnerGate).toBeLessThan(firstSecretStep);
    expect(preflightSecretsJob.slice(rerunOwnerGate, firstSecretStep)).toContain("assertTrustedOwnerWorkflowRun");
    expect(migrate).toContain("github.actor_id == '126446430'");
    expect(migrate).toContain("assertTrustedOwnerWorkflowRun");
    const ownerIdentity = await readFile(new URL("../scripts/github-owner-identity.mjs", import.meta.url), "utf8");
    expect(ownerIdentity).toContain("run.triggering_actor?.id");
    expect(deployWorkflow).toContain("workflow_dispatch:");
    expect(deployWorkflow).not.toContain("workflow_run:");
    expect(deployWorkflow).toContain('[[ "$DISPATCH_ACTOR_ID" == "126446430" ]]');
    expect(deployWorkflow).toContain('[[ "$TIP" == "$DEPLOY_SHA" ]]');
    expect(ciWorkflow).not.toContain("deploy-production.yml");
    expect(migrate).not.toContain("actions/cache");
    expect(migrate).not.toMatch(/path:\s*\$\{\{ runner\.temp \}\}\/signed-migration-context\/\*/);
    expect(migrate).toContain("expected-sign-bundle-files.txt");
    expect(migrate).toContain('EXECUTION_MODE="${10}"');
    expect(migrate).toContain('FORWARD_RESUME_FAILED_RUN_ID="${11}"');
    expect(migrate).toContain('export BODYCAST_MIGRATION_EXECUTION_MODE="$EXECUTION_MODE"');
    expect(migrate).toContain("'$BODYCAST_MIGRATION_EXECUTION_MODE' '$BODYCAST_FORWARD_RESUME_FAILED_RUN_ID'");
    expect(migrate).toContain("signed-migration-context/authorization-envelope.json");
    for (const forbidden of ["execution-signer", "execution-key-certificate", "executionPrivateKeyPem", "--delegate", "--attest", "migration-run.json", "current-migration-run.json"]) {
      expect(migrate).not.toContain(forbidden);
    }
    const deployScript = await readFile(new URL("../scripts/deploy-migrate.sh", import.meta.url), "utf8");
    expect(deployScript).not.toContain("bodycast-production-operation");
    expect(deployScript).not.toContain("docker compose -f docker-compose.prod.yml up -d db");
    expect(deployScript).toContain('bodycast_prepare_release_marker_directory');
    expect(deployScript).toContain('--volume "$BODYCAST_RELEASE_MARKER_DIRECTORY:/run/bodycast-release-marker:rw"');
    expect(deployScript).toContain('"$BODYCAST_MARKER_STATE" == "ddl-started"');
    expect(deployScript).toContain("--before-ddl");
    expect(deployScript).toContain("--after-ddl");
    const guard = await readFile(new URL("../scripts/run-prisma-migrate-with-lock-timeout.mjs", import.meta.url), "utf8");
    expect(guard).toContain("verifyFinalGuardReceipt");
    expect(guard).toContain("assertPrismaTargetMatchesSignedIdentity");
    expect(guard).toContain("assertBackupFreshAtDdlStart");
    expect(guard.indexOf("assertPrismaTargetMatchesSignedIdentity(finalGuard.receipt")).toBeLessThan(guard.indexOf("await markerWriter({"));
    expect(guard.indexOf("await markerWriter({")).toBeLessThan(guard.indexOf('child = spawn("npx"'));
    expect(guard).not.toContain("fetch(");
    expect(guard).toContain('child.once("spawn", async () =>');
    expect(guard).toContain("durable spawn acknowledgement failed");
    expect(guard).not.toContain("prisma-migrate-ddl-gate.mjs");
  });

  it("binds trusted current migration API metadata to the cryptographic OIDC run claims", async () => {
    const fixture = await executionBoundaryFixture(validPreflightReport().identity);
    expect(assertCurrentMigrationRunMatchesProof(fixture.verifiedExecutionProof, fixture.currentRun, now)).toBe(true);
    expect(() => assertCurrentMigrationRunMatchesProof(fixture.verifiedExecutionProof, {
      ...fixture.currentRun, triggering_actor: { id: 24680, login: "collaborator" },
    }, now)).toThrow("no longer reports the exact OIDC-authenticated migration run as current and admitted");
    expect(() => assertCurrentMigrationRunMatchesProof(fixture.verifiedExecutionProof, {
      ...fixture.currentRun, status: "completed", conclusion: "cancelled",
    }, now)).toThrow("no longer reports the exact OIDC-authenticated migration run as current and admitted");
  });
});

describe("Ed25519 authorization envelope and provenance matrix", () => {
  it("accepts a valid canonical signed envelope only when every live claim matches", () => {
    const serialized = createAuthorizationEnvelope(claims(), { keyId, privateKeyPem, allowlist });
    expect(verifyAuthorizationEnvelope(serialized, { allowlist, live: liveContext(), now }).verified).toBe(true);
  });

  const mismatches = [
    ["wrong repository", { repository: "someone/body-model" }, { repository: "krustallik/body-model" }],
    ["wrong workflow id", { workflowId: "other-workflow" }, { workflowId: "production-migrate" }],
    ["wrong workflow path", { workflowPath: ".github/workflows/other.yml" }, { workflowPath: ".github/workflows/production-migrate.yml" }],
    ["wrong run id", { workflowRunId: "1502" }, { workflowRunId: "1501" }],
    ["wrong run attempt", { workflowRunAttempt: 2 }, { workflowRunAttempt: 1 }],
    ["wrong release SHA", { releaseSha: "b".repeat(40), currentMainSha: "b".repeat(40) }, { releaseSha: "a".repeat(40) }],
    ["wrong current main SHA", { currentMainSha: "b".repeat(40) }, { currentMainSha: "a".repeat(40) }],
    ["wrong manifest", { manifestId: "stage-02-strength-accounting-v1" }, { manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id }],
    ["modified full pending names", { pendingMigrationNames: [names[0], names[1]] , pendingSetDigest: canonicalSha256([names[0], names[1]]) }, { pendingMigrationNames: names }],
    ["wrong pending-set digest", { pendingSetDigest: "0".repeat(64) }, { pendingSetDigest: canonicalSha256(names) }],
    ["wrong preflight run id", { preflightRunId: "1202" }, { preflightRunId: "1201" }],
    ["wrong preflight attempt", { preflightRunAttempt: 3 }, { preflightRunAttempt: 2 }],
    ["wrong preflight admission time", { preflightRunStartedAt: "2026-10-05T09:01:00.000Z" }, { preflightRunStartedAt: "2026-10-05T09:00:00.000Z" }],
    ["wrong preflight digest", { preflightResultDigest: "0".repeat(64) }, { preflightResultDigest: "b".repeat(64) }],
    ["wrong backup artifact id", { backupArtifactId: "131313" }, { backupArtifactId: "121212" }],
    ["wrong backup digest", { backupArtifactDigest: "0".repeat(64) }, { backupArtifactDigest: "c".repeat(64) }],
    ["wrong snapshot timestamp", { backupSnapshotAt: "2026-10-05T09:29:00.000Z" }, { backupSnapshotAt: "2026-10-05T09:30:00.000Z" }],
    ["wrong restore digest", { restoreResultDigest: "0".repeat(64) }, { restoreResultDigest: "d".repeat(64) }],
    ["wrong production identity", { productionIdentityDigest: "0".repeat(64) }, { productionIdentityDigest: "e".repeat(64) }],
  ];
  it.each(mismatches)("blocks %s", (_name, payloadChange, liveChange) => {
    const serialized = signClaims(claims(payloadChange));
    expect(() => verifyAuthorizationEnvelope(serialized, { allowlist, live: liveContext(liveChange), now })).toThrow();
  });

  it("blocks corrupted signatures and payload bytes changed after signing", () => {
    const valid = JSON.parse(signClaims(claims()));
    const badSignature = { ...valid, signature: (valid.signature[0] === "A" ? "B" : "A") + valid.signature.slice(1) };
    expect(() => verifyAuthorizationEnvelope(canonicalJson(badSignature), { allowlist, live: liveContext(), now })).toThrow("signature is invalid");
    const badPayload = { ...valid, payload: { ...valid.payload, manifestId: "tampered" } };
    expect(() => verifyAuthorizationEnvelope(canonicalJson(badPayload), { allowlist, live: liveContext(), now })).toThrow("signature is invalid");
  });

  it("blocks malformed or missing signatures, unknown/revoked/mismatched keys, and retired-key use after revocation", () => {
    const signed = JSON.parse(signClaims(claims()));
    expect(() => verifyAuthorizationEnvelope(canonicalJson({ ...signed, signature: "??" }), { allowlist, live: liveContext(), now })).toThrow();
    const missing = { ...signed };
    delete missing.signature;
    expect(() => verifyAuthorizationEnvelope(canonicalJson(missing), { allowlist, live: liveContext(), now })).toThrow();
    expect(() => verifyAuthorizationEnvelope(canonicalJson({ ...signed, keyId: "unknown-key" }), { allowlist, live: liveContext(), now })).toThrow("unknown");
    const revoked = { schemaVersion: 1, keys: [{ ...allowlist.keys[0], status: "revoked" }] };
    expect(() => verifyAuthorizationEnvelope(canonicalJson(signed), { allowlist: revoked, live: liveContext(), now })).toThrow("not active");
    const { publicKey: otherPublic, privateKey: otherPrivate } = generateKeyPairSync("ed25519");
    const mismatchAllowlist = { schemaVersion: 1, keys: [{ keyId, publicKeyPem: otherPublic.export({ type: "spki", format: "pem" }), status: "active" }] };
    expect(() => verifyAuthorizationEnvelope(canonicalJson(signed), { allowlist: mismatchAllowlist, live: liveContext(), now })).toThrow("signature is invalid");
    const retiredAllowlist = { schemaVersion: 1, keys: [] };
    expect(() => verifyAuthorizationEnvelope(canonicalJson(signed), { allowlist: retiredAllowlist, live: liveContext(), now })).toThrow("unknown");
    const rotationKeyId = "fixture-key-rotation";
    const rotatedAllowlist = { schemaVersion: 1, keys: [{ keyId: rotationKeyId, publicKeyPem: otherPublic.export({ type: "spki", format: "pem" }), status: "active" }] };
    const rotatedEnvelope = createAuthorizationEnvelope(claims(), { keyId: rotationKeyId, privateKeyPem: otherPrivate.export({ type: "pkcs8", format: "pem" }), allowlist: rotatedAllowlist });
    expect(verifyAuthorizationEnvelope(rotatedEnvelope, { allowlist: rotatedAllowlist, live: liveContext(), now }).verified).toBe(true);
    expect(() => verifyAuthorizationEnvelope(rotatedEnvelope, { allowlist: { schemaVersion: 1, keys: [] }, live: liveContext(), now })).toThrow("unknown");
  });

  it("blocks missing/duplicate claims, duplicate-key and noncanonical JSON encodings", () => {
    const valid = JSON.parse(signClaims(claims()));
    const missingPayload = { ...valid.payload };
    delete missingPayload.repository;
    const missingSignature = sign(null, Buffer.from(canonicalJson(missingPayload)), privateKey).toString("base64url");
    expect(() => verifyAuthorizationEnvelope(canonicalJson({ ...valid, payload: missingPayload, signature: missingSignature }), { allowlist, live: liveContext(), now })).toThrow("incomplete");
    const extra = { ...valid.payload, validated: true };
    const extraSignature = sign(null, Buffer.from(canonicalJson(extra)), privateKey).toString("base64url");
    expect(() => verifyAuthorizationEnvelope(canonicalJson({ ...valid, payload: extra, signature: extraSignature }), { allowlist, live: liveContext(), now })).toThrow("unsupported");
    const duplicateRaw = canonicalJson(valid).replace('"algorithm":"Ed25519"', '"algorithm":"Ed25519","algorithm":"Ed25519"');
    expect(() => verifyAuthorizationEnvelope(duplicateRaw, { allowlist, live: liveContext(), now })).toThrow("not canonical");
    const duplicateRequiredClaim = canonicalJson(valid).replace('"repository":"krustallik/body-model"', '"repository":"krustallik/body-model","repository":"krustallik/body-model"');
    expect(() => verifyAuthorizationEnvelope(duplicateRequiredClaim, { allowlist, live: liveContext(), now })).toThrow("not canonical");
    expect(() => verifyAuthorizationEnvelope(JSON.stringify(valid, null, 2), { allowlist, live: liveContext(), now })).toThrow("not canonical");
  });

  it("blocks expired, invalid/future issuedAt, stale pending/main state, unsigned JSON, and confirmation-only bypass", () => {
    expect(() => verifyAuthorizationEnvelope(signClaims(claims({ expiresAt: "2026-10-05T09:59:59.000Z" })), { allowlist, live: liveContext(), now })).toThrow("expired");
    expect(() => verifyAuthorizationEnvelope(signClaims(claims({ issuedAt: "2026-10-05T10:02:00.000Z" })), { allowlist, live: liveContext(), now })).toThrow("future");
    expect(() => verifyAuthorizationEnvelope(signClaims(claims({ issuedAt: "not-a-date" })), { allowlist, live: liveContext(), now })).toThrow("ISO timestamp");
    expect(() => verifyAuthorizationEnvelope(signClaims(claims({ backupSnapshotAt: "2026-10-05T09:00:00.000Z" })), { allowlist, live: liveContext(), now: now + 1 })).toThrow("older than 60 minutes");
    expect(() => verifyAuthorizationEnvelope(signClaims(claims()), { allowlist, live: liveContext({ pendingMigrationNames: [names[0]] }), now })).toThrow("pending");
    expect(() => verifyAuthorizationEnvelope(signClaims(claims()), { allowlist, live: liveContext({ releaseSha: "a".repeat(40), currentMainSha: "b".repeat(40) }), now })).toThrow();
    expect(() => verifyAuthorizationEnvelope(JSON.stringify(claims()), { allowlist, live: liveContext(), now })).toThrow();
    expect(() => assertSignedAuthorizationRequired({ envelope: "", confirmation: "migrate" })).toThrow("not a signed authorization");
  });

  it("blocks authorization id and nonce tampering after signing", () => {
    const valid = JSON.parse(signClaims(claims()));
    for (const field of ["authorizationId", "nonce"]) {
      const changed = { ...valid, payload: { ...valid.payload, [field]: field === "nonce" ? "0".repeat(36) : "altered-authorization-id-123" } };
      expect(() => verifyAuthorizationEnvelope(canonicalJson(changed), { allowlist, live: liveContext(), now })).toThrow("signature is invalid");
    }
  });

  it("binds the signed workflow run to the executing run and blocks replay after live migration state changes", () => {
    const liveReport = validPreflightReport();
    const preflightResult = evaluateProductionPreflight(liveReport, dirs);
    const restoreResult = { verified: true, postflightReady: true, postSchemaDigest: "9".repeat(64),
      logicalDataFingerprint: liveReport.logicalDataFingerprint, readability: liveReport.readability };
    const evidence = {
      verified: true,
      repository: "krustallik/body-model",
      releaseSha: "a".repeat(40),
      manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id,
      workflowRunId: "1201",
      workflowRunAttempt: 2,
      preflightResultDigest: canonicalSha256(preflightResult),
      restoreResultDigest: canonicalSha256(restoreResult),
      productionIdentityDigest: canonicalSha256(liveReport.identity),
      writerDrainDigest: canonicalSha256(liveReport.writerDrain),
      writerTopologyDigest: canonicalSha256(liveReport.writerDrain.topology),
      logicalDataFingerprint: liveReport.logicalDataFingerprint,
      backupFileDigest: "c".repeat(64),
      backupSnapshotAt: "2026-10-05T09:30:00.000Z",
    };
    const signedClaims = claims({
      workflowId: "800",
      preflightResultDigest: evidence.preflightResultDigest,
      restoreResultDigest: evidence.restoreResultDigest,
      productionIdentityDigest: evidence.productionIdentityDigest,
      writerDrainDigest: evidence.writerDrainDigest,
      writerTopologyDigest: evidence.writerTopologyDigest,
    });
    const artifactMetadata = {
      id: "121212",
      digest: "sha256:" + "c".repeat(64),
      workflowRunId: "1201",
      workflowRunAttempt: 2,
      authorizationWorkflowId: "800",
      authorizationRunId: "1501",
      authorizationRunAttempt: 1,
    };
    const args = {
      envelope: signClaims(signedClaims), preflightResult, evidence, restoreResult, artifactMetadata,
      liveReport, liveMainSha: "a".repeat(40), releaseSha: "a".repeat(40),
      manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id, allowlist,
      currentWorkflowId: "800", currentWorkflowRunId: "1501", currentWorkflowRunAttempt: 1, now,
    };
    const previousDirectories = process.env.BODYCAST_MIGRATION_DIRECTORIES;
    process.env.BODYCAST_MIGRATION_DIRECTORIES = JSON.stringify(dirs);
    try {
      const receipt = verifyFinalMigrationAuthorization(args);
      expect(receipt.ready).toBe(true);
      expect(verifyFinalGuardReceipt({
        receipt,
        envelope: args.envelope,
        allowlist,
        currentWorkflowId: "800",
        currentWorkflowRunId: "1501",
        currentWorkflowRunAttempt: 1,
        currentMainSha: "a".repeat(40),
        releaseSha: "a".repeat(40),
        now,
      }).verified).toBe(true);
      expect(() => verifyFinalGuardReceipt({
        receipt,
        envelope: args.envelope,
        allowlist,
        currentWorkflowId: "800",
        currentWorkflowRunId: "1502",
        currentWorkflowRunAttempt: 1,
        currentMainSha: "a".repeat(40),
        releaseSha: "a".repeat(40),
        now,
      })).toThrow("workflowRunId");
      expect(() => verifyFinalMigrationAuthorization({ ...args, currentWorkflowRunId: "1502" })).toThrow("workflowRunId");
      expect(verifyFinalMigrationAuthorization({ ...args, currentWorkflowActorId: "2468" }).actorId).toBe("126446430");
      expect(() => verifyFinalMigrationAuthorization({
        ...args,
        liveReport: { ...liveReport, identity: { ...liveReport.identity, serverAddress: "172.20.0.99" } },
      })).toThrow("differs from the signed preflight target");
      expect(() => verifyFinalMigrationAuthorization({
        ...args,
        liveReport: { ...liveReport, writerDrain: {
          ...liveReport.writerDrain,
          observedAt: new Date(now).toISOString(),
          activeClientBackends: [{ pid: 504, applicationName: "bodycast-reconnected-writer", clientAddress: null }],
        } },
      })).toThrow("final live readiness");

      const applied = {
        ...liveReport,
        migrations: [...liveReport.migrations, ...ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations.map((migration) => migrationRow(migration))],
        objects: schemaObjects(true),
      };
      expect(() => verifyFinalMigrationAuthorization({ ...args, liveReport: applied })).toThrow("final live readiness");
    } finally {
      if (previousDirectories === undefined) delete process.env.BODYCAST_MIGRATION_DIRECTORIES;
      else process.env.BODYCAST_MIGRATION_DIRECTORIES = previousDirectories;
    }
  });

  it("does not treat a generic guard-ready environment flag as migration authorization", async () => {
    await expect(assertPrismaMigrationAuthorized({
      DATABASE_URL: "postgresql://bodycast:placeholder@127.0.0.1:5432/bodycast",
      BODYCAST_FINAL_GUARD_READY: "true",
    })).rejects.toThrow("signed final-guard receipt, owner authorization, and verifier keys are required");
  });
});

describe("preflight supersession and artifact provenance", () => {
  const base = {
    repository: "krustallik/body-model",
    workflowPath: ".github/workflows/production-migration-preflight.yml",
    workflowId: "production-migration-preflight",
    event: "workflow_dispatch",
    headBranch: "main",
    headSha: "a".repeat(40),
    displayTitle: "Preflight " + "a".repeat(40) + " " + ACTIVE_ENERGY_UNIFIED_MANIFEST.id,
  };
  const success = { ...base, id: 120, runAttempt: 1, createdAt: "2026-10-05T08:00:00Z", runStartedAt: "2026-10-05T08:01:00Z", status: "completed", conclusion: "success" };
  const failedNew = { ...base, id: 121, runAttempt: 1, createdAt: "2026-10-05T09:00:00Z", runStartedAt: "2026-10-05T09:01:00Z", status: "completed", conclusion: "failure" };

  it("blocks supersession only after trusted preflight admission", () => {
    expect(selectLatestApplicablePreflight([success], { repository: base.repository, releaseSha: base.headSha, manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id })).toEqual(success);
    for (const newer of [
      failedNew,
      { ...failedNew, conclusion: "cancelled" },
      { ...failedNew, status: "in_progress", conclusion: null },
    ]) {
      expect(() => selectLatestApplicablePreflight([success, newer], { repository: base.repository, releaseSha: base.headSha, manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id })).toThrow();
    }
    for (const unadmitted of ["queued", "pending", "waiting", "requested"]) {
      expect(selectLatestApplicablePreflight([success, { ...failedNew, runStartedAt: null, status: unadmitted, conclusion: null }], {
        repository: base.repository, releaseSha: base.headSha, manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id,
      })).toEqual(success);
    }
  });

  it("treats an admitted failed or cancelled run as superseding even when no successful artifact exists", () => {
    for (const conclusion of ["failure", "cancelled"]) {
      expect(() => selectLatestApplicablePreflight([success, { ...failedNew, conclusion }], {
        repository: base.repository, releaseSha: base.headSha, manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id,
      })).toThrow("older success is superseded");
    }
  });

  it("does not supersede another manifest or release SHA, and refuses operator-selected older runs", () => {
    const differentManifest = { ...failedNew, displayTitle: "Preflight " + base.headSha + " other-manifest", status: "in_progress", conclusion: null };
    const differentSha = { ...failedNew, headSha: "b".repeat(40), displayTitle: "Preflight " + "b".repeat(40) + " " + ACTIVE_ENERGY_UNIFIED_MANIFEST.id, status: "in_progress", conclusion: null };
    expect(selectLatestApplicablePreflight([success, differentManifest, differentSha], { repository: base.repository, releaseSha: base.headSha, manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id })).toEqual(success);
    expect(() => selectLatestApplicablePreflight([success], { repository: base.repository, releaseSha: base.headSha, manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id, selectedRunId: 120 })).toThrow("operator-selected");
  });

  it("rejects artifacts from superseded runs or mismatched run attempts", () => {
    const artifact = { id: 150, digest: "sha256:" + "a".repeat(64), workflowRunId: "120", workflowRunAttempt: 1, headSha: base.headSha, expired: false };
    expect(verifyPreflightArtifactMetadata(artifact, success)).toBe(true);
    expect(() => verifyPreflightArtifactMetadata({ ...artifact, workflowRunId: "119" }, success)).toThrow();
    expect(() => verifyPreflightArtifactMetadata({ ...artifact, workflowRunAttempt: 2 }, success)).toThrow();
    const newerSuccess = { ...success, id: 121, createdAt: "2026-10-05T09:00:00Z" };
    expect(() => verifyPreflightArtifactMetadata(artifact, newerSuccess)).toThrow("different workflow run");
    expect(() => selectLatestApplicablePreflight([{ ...success, createdAt: "invalid-date" }], {
      repository: base.repository, releaseSha: base.headSha, manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id,
    })).toThrow("invalid trusted ordering metadata");
  });

  it("uses the workflow ID returned by trusted GitHub metadata instead of substituting the requested ID", () => {
    const run = {
      id: 120, workflow_id: 99, path: base.workflowPath + "@refs/heads/main", event: base.event, head_branch: "main",
      head_sha: base.headSha, display_title: base.displayTitle, run_attempt: 1,
      created_at: "2026-10-05T08:00:00Z", run_started_at: "2026-10-05T08:01:00Z", status: "completed", conclusion: "success", html_url: "https://example.invalid/run/120",
    };
    expect(normalizeWorkflowRuns([run])[0].workflowId).toBe("99");
    expect(() => selectAndVerifyArtifact({
      runs: [run], artifacts: [], workflowId: "100", releaseSha: base.headSha,
      manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id,
    })).toThrow("No matching production preflight run");
  });
});

describe("Git blob checksum authority and execution integrity", () => {
  it("uses committed Git blob bytes despite autocrlf checkout conversion and rejects working-tree mismatch", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-v5-blob-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: directory });
      execFileSync("git", ["config", "user.name", "V5 Test"], { cwd: directory });
      execFileSync("git", ["config", "user.email", "v5@example.invalid"], { cwd: directory });
      execFileSync("git", ["config", "core.autocrlf", "true"], { cwd: directory });
      const migrationPath = "prisma/migrations/20261002100000_active_energy_canonical_resolution/migration.sql";
      await mkdir(path.dirname(path.join(directory, migrationPath)), { recursive: true });
      const lf = Buffer.from("CREATE TABLE fixture (id integer);\n");
      await writeFile(path.join(directory, migrationPath), lf);
      execFileSync("git", ["add", migrationPath], { cwd: directory });
      execFileSync("git", ["commit", "-qm", "fixture"], { cwd: directory });
      const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
      const blob = readCommittedGitBlob({ repositoryPath: directory, releaseSha, relativePath: migrationPath });
      expect(blob).toEqual(lf);
      const expectedSha = sha256(blob);
      expect((await verifyManifestBlob({ repositoryPath: directory, releaseSha, migration: { name: "20261002100000_active_energy_canonical_resolution", sha256: expectedSha } })).matchesManifest).toBe(true);

      await rm(path.join(directory, migrationPath));
      execFileSync("git", ["checkout", "HEAD", "--", migrationPath], { cwd: directory });
      const working = await readFile(path.join(directory, migrationPath));
      if (!working.equals(blob)) {
        const mismatch = await verifyExecutionFileMatchesBlob({ repositoryPath: directory, releaseSha, migration: { name: "20261002100000_active_energy_canonical_resolution", sha256: expectedSha } });
        expect(mismatch.exactMatch).toBe(false);
      }
      const crlf = Buffer.from(blob.toString("utf8").replace(/\n/g, "\r\n"));
      await writeFile(path.join(directory, migrationPath), crlf);
      const mismatch = await verifyExecutionFileMatchesBlob({ repositoryPath: directory, releaseSha, migration: { name: "20261002100000_active_energy_canonical_resolution", sha256: expectedSha } });
      expect(mismatch.exactMatch).toBe(false);
      expect((await verifyManifestBlob({ repositoryPath: directory, releaseSha, migration: { name: "20261002100000_active_energy_canonical_resolution", sha256: expectedSha } })).actualSha256).toBe(expectedSha);
      await writeFile(path.join(directory, migrationPath), blob);
      expect((await verifyExecutionFileMatchesBlob({ repositoryPath: directory, releaseSha, migration: { name: "20261002100000_active_energy_canonical_resolution", sha256: expectedSha } })).exactMatch).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("detects a one-byte committed blob change and blocks a manifest hash mismatch", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-v5-one-byte-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: directory });
      execFileSync("git", ["config", "user.name", "V5 Test"], { cwd: directory });
      execFileSync("git", ["config", "user.email", "v5@example.invalid"], { cwd: directory });
      const rel = "prisma/migrations/x/migration.sql";
      await mkdir(path.dirname(path.join(directory, rel)), { recursive: true });
      await writeFile(path.join(directory, rel), Buffer.from("SELECT 1;\n"));
      execFileSync("git", ["add", rel], { cwd: directory });
      execFileSync("git", ["commit", "-qm", "first"], { cwd: directory });
      const first = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
      const firstHash = sha256(readCommittedGitBlob({ repositoryPath: directory, releaseSha: first, relativePath: rel }));
      await writeFile(path.join(directory, rel), Buffer.from("SELECT 2;\n"));
      execFileSync("git", ["add", rel], { cwd: directory });
      execFileSync("git", ["commit", "-qm", "second"], { cwd: directory });
      const second = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
      const secondHash = sha256(readCommittedGitBlob({ repositoryPath: directory, releaseSha: second, relativePath: rel }));
      expect(secondHash).not.toBe(firstHash);
      const migration = { name: "x", sha256: firstHash };
      expect((await verifyManifestBlob({ repositoryPath: directory, releaseSha: second, migration })).matchesManifest).toBe(false);
      const exactWorkingButWrongManifest = await verifyExecutionFileMatchesBlob({ repositoryPath: directory, releaseSha: second, migration });
      expect(exactWorkingButWrongManifest.byteMatch).toBe(true);
      expect(exactWorkingButWrongManifest.matchesManifest).toBe(false);
      expect(exactWorkingButWrongManifest.exactMatch).toBe(false);
      expect(exactWorkingButWrongManifest.blocker).toContain("reviewed manifest checksum");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("freshness boundaries, restore identity, and Prisma lock timeout", () => {
  it("allows 59:59 and 60:00 freshness and blocks any duration beyond one hour", () => {
    const start = "2026-10-05T09:00:00.000Z";
    expect(isBackupFresh(start, "2026-10-05T09:59:59.000Z")).toBe(true);
    expect(isBackupFresh(start, "2026-10-05T10:00:00.000Z")).toBe(true);
    expect(isBackupFresh(start, "2026-10-05T10:00:00.001Z")).toBe(false);
    expect(isBackupFresh("not-a-date", "2026-10-05T10:00:00Z")).toBe(false);
  });

  it("injects PostgreSQL lock_timeout into Prisma's actual connection URL and caps it at five seconds", () => {
    const result = withPrismaLockTimeout("postgresql://user:password@localhost:5432/bodycast?schema=public", 5000);
    const url = new URL(result);
    expect(url.searchParams.get("options")).toBe("-c lock_timeout=5000");
    expect(url.searchParams.get("schema")).toBe("public");
    expect(() => withPrismaLockTimeout("postgresql://localhost/db", 6000)).toThrow("no greater than 5000ms");
  });

  it("compares restored migration rows and exact schema signatures, then validates the disposable postflight", () => {
    const source = validPreflightReport();
    const restored = { ...source, migrations: source.migrations.map((row) => ({ ...row })), objects: source.objects.map((row) => ({ ...row })) };
    const readability = { readability: Object.fromEntries(["Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog"].map((name) => [name, { rowCount: 0 }])) };
    expect(verifyBaseRestore(source, restored, readability).verified).toBe(true);
    expect(verifyRestoredBackup(source, { ...restored, logicalDataFingerprint: "0".repeat(64) }).blockers)
      .toContain("Restored public-table rows or sequence state differ from the source snapshot.");
    restored.objects[0].signature = "changed";
    expect(verifyRestoredBackup(source, restored).verified).toBe(false);

    const post = validPreflightReport();
    post.identity = { database: "bodycast_restore", databaseOid: 16385, clusterSystemIdentifier: source.identity.clusterSystemIdentifier, role: "bodycast_restore", serverVersion: "17.11", serverAddress: "172.20.0.3", serverPort: 5432 };
    post.migrations.push(...ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations.map((migration) => migrationRow(migration)));
    post.objects = schemaObjects(true);
    const verified = verifyDisposablePostflight(post, dirs);
    expect(verified.verified).toBe(true);
    expect(verified.postSchemaDigest).toMatch(/^[a-f0-9]{64}$/);
    post.objects[0].signature = "different";
    expect(verifyDisposablePostflight(post, dirs).verified).toBe(true);
    expect(verifyPostflightMatchesRestore(post, verified, dirs).ready).toBe(false);
    expect(schemaInventoryDigest(post.objects)).not.toBe(verified.postSchemaDigest);
  });
});
