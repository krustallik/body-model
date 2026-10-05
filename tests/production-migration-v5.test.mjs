import { execFileSync } from "node:child_process";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
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
import { verifyFinalMigrationAuthorization, verifyFinalGuardReceipt } from "../scripts/production-migration-final-guard.mjs";
import { normalizeWorkflowRuns, selectAndVerifyArtifact } from "../scripts/production-migration-select-preflight.mjs";
import { assertBackupFreshAtDdlStart, assertPrismaMigrationAuthorized, assertPrismaTargetMatchesSignedIdentity, readLatestApplicablePreflightForDdl, startPrismaMigrationAtDdlBoundary } from "../scripts/run-prisma-migrate-with-lock-timeout.mjs";
import { psqlCompatibleDatabaseUrl } from "../scripts/production-db-target-url.mjs";
import { createExecutionAttestation, createExecutionAttestationDelegation, EXECUTION_ATTESTATION_MAX_AGE_MS } from "../scripts/production-migration-execution-attestation.mjs";

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
    ...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects.map((name) => ({ name, present: postflight, kind: "table", signature: postflight ? "reviewed-active-signature" : null }))];
}

function validPreflightReport() {
  return {
    identity: { database: "bodycast", databaseOid: 16384, role: "bodycast", serverVersion: "17.11", serverAddress: "172.20.0.2", serverPort: 5432 },
    migrations: [
      migrationRow({ name: dirs[0], sha256: "a".repeat(64) }),
      ...STAGE_02_MANIFEST.migrations.map((migration) => migrationRow(migration)),
    ],
    objects: schemaObjects(false),
    tables: Object.fromEntries(ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredTablesBefore.map((name) => [name, { exists: true, estimatedRows: 1, totalBytes: 128 }])),
    conflictingLocks: [],
    preparedTransactions: [],
    longTransactions: [],
  };
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const keyId = "fixture-key-2026";
const allowlist = { schemaVersion: 1, keys: [{ keyId, publicKeyPem, status: "active" }] };
const names = ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations.map(({ name }) => name).sort();

function claims(overrides = {}) {
  return {
    repository: "krustallik/body-model",
    workflowId: "production-migrate",
    workflowPath: ".github/workflows/production-migrate.yml",
    workflowRunId: "1501",
    workflowRunAttempt: 1,
    releaseSha: "a".repeat(40),
    currentMainSha: "a".repeat(40),
    manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id,
    pendingMigrationNames: names,
    pendingSetDigest: canonicalSha256(names),
    preflightRunId: "1201",
    preflightRunAttempt: 2,
    preflightResultDigest: "b".repeat(64),
    backupArtifactId: "121212",
    backupArtifactDigest: "c".repeat(64),
    backupSnapshotAt: "2026-10-05T09:30:00.000Z",
    restoreResultDigest: "d".repeat(64),
    productionIdentityDigest: "e".repeat(64),
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
    releaseSha: "a".repeat(40),
    currentMainSha: "a".repeat(40),
    manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id,
    pendingMigrationNames: names,
    pendingSetDigest: canonicalSha256(names),
    preflightRunId: "1201",
    preflightRunAttempt: 2,
    preflightResultDigest: "b".repeat(64),
    backupArtifactId: "121212",
    backupArtifactDigest: "c".repeat(64),
    backupSnapshotAt: "2026-10-05T09:30:00.000Z",
    restoreResultDigest: "d".repeat(64),
    productionIdentityDigest: "e".repeat(64),
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

function executionBoundaryFixture(identity = validPreflightReport().identity, checkedAt = now) {
  const backupSnapshotAt = new Date(checkedAt - 30 * 60_000).toISOString();
  const authorizationClaims = claims({
    productionIdentityDigest: canonicalSha256(identity),
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
    status: "completed",
    conclusion: "success",
  };
  const delegation = createExecutionAttestationDelegation({
    authorizationEnvelope,
    allowlist,
    keyId,
    privateKeyPem,
    now: checkedAt - 30_000,
  });
  const executionChallenge = "ab".repeat(32);
  const attestation = createExecutionAttestation({
    authorizationEnvelope,
    latestPreflight,
    allowlist,
    delegationCertificate: delegation.certificate,
    executionPrivateKeyPem: delegation.executionPrivateKeyPem,
    executionChallenge,
    now: checkedAt,
  });
  return { authorizationClaims, authorizationEnvelope, latestPreflight, delegation, attestation, executionChallenge, identity };
}

function authorizedBoundary(fixture, databaseUrl = "postgresql://bodycast:secret@db/bodycast") {
  return {
    databaseUrl,
    receipt: {
      productionIdentityDigest: canonicalSha256(fixture.identity),
      backupSnapshotAt: fixture.authorizationClaims.backupSnapshotAt,
    },
    envelope: fixture.authorizationEnvelope,
    delegationCertificate: fixture.delegation.certificate,
    executionAttestation: fixture.attestation.serialized,
    verifiedAttestation: fixture.attestation.payload,
    executionChallenge: fixture.executionChallenge,
    allowlist,
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

  it("matches all five reviewed manifest hashes to exact blobs at the release commit", async () => {
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
  });

  it("requires exact target checksums and schema-object signatures after disposable migration rehearsal", () => {
    const post = validPreflightReport();
    post.identity = { database: "bodycast_restore", databaseOid: 16385, role: "bodycast_restore", serverVersion: "17.11", serverAddress: "172.20.0.3", serverPort: 5432 };
    post.migrations.push(...ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations.map((migration) => migrationRow(migration)));
    post.objects = schemaObjects(true);
    const result = evaluateProductionPostflight(post, dirs, ACTIVE_ENERGY_UNIFIED_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" });
    expect(result.ready).toBe(true);
    post.migrations.find((row) => row.name === ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations[0].name).checksum = "0".repeat(64);
    expect(evaluateProductionPostflight(post, dirs, ACTIVE_ENERGY_UNIFIED_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" }).blockers.join(" ")).toContain("checksum differs");
  });

  it("keeps the complete object inventory synchronized with the SQL renderer", async () => {
    const template = await readFile(new URL("../scripts/production-db-preflight.sql", import.meta.url), "utf8");
    const sql = renderProductionDbPreflightSql(template);
    const expected = getExpectedSchemaObjectNames();
    expect(expected).toEqual([...new Set([...EXPECTED_MIGRATION_OBJECTS, ...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects])].sort());
    expect(sql).not.toContain("__EXPECTED_SCHEMA_OBJECTS_JSON__");
    expect(sql).toContain("BEGIN READ ONLY;");
    expect(await readFile(new URL("../scripts/run-prisma-migrate-with-lock-timeout.mjs", import.meta.url), "utf8")).toContain("withPrismaLockTimeout(databaseUrl, 5000)");
    expect(await readFile(new URL("../scripts/production-db-target.sh", import.meta.url), "utf8")).toContain("default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000");
    expect(sql).toContain("PhysiologyV7Lifecycle");
    expect(sql).toContain("DailyModelState");
    for (const relation of ["Workout", "Profile", "ModelEpisode"]) expect(sql).toContain(`('${relation}')`);
    expect(sql).toContain("inet_server_addr()::text");
    expect(sql).toContain("inet_server_port()");
    expect(sql).toContain("'databaseOid', (SELECT oid::bigint FROM pg_database WHERE datname = current_database())");
    expect(sql).toContain("ORDER BY dep.refobjid, dep.refobjsubid\n            LIMIT 1");
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
    const incomplete = validPreflightReport();
    delete incomplete.identity.serverAddress;
    expect(evaluateProductionPreflight(incomplete, dirs).blockers.join(" ")).toContain("endpoint identity is incomplete");
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
    const fixture = executionBoundaryFixture(identity, current);
    const authorized = authorizedBoundary(fixture);
    authorized.receipt.backupSnapshotAt = new Date(snapshot).toISOString();
    const spawn = vi.fn(() => ({ status: 0 }));
    const nonceDirectory = await mkdtemp(path.join(os.tmpdir(), "bodycast-v5-ddl-boundary-"));
    try {
      await expect(startPrismaMigrationAtDdlBoundary({
        authorized,
        now: () => current,
        spawn,
        nonceDirectory,
        latestPreflightProbe: async () => fixture.latestPreflight,
        identityProbe: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          current += 2;
          return identity;
        },
      })).rejects.toThrow("not fresh at DDL start");
      expect(spawn).not.toHaveBeenCalled();
      expect(() => assertBackupFreshAtDdlStart(authorized.receipt, snapshot + 60 * 60 * 1000)).not.toThrow();
    } finally {
      await rm(nonceDirectory, { recursive: true, force: true });
    }
  });

  it("blocks superseded direct DDL execution, binds the final Prisma target, and consumes execution attestations once", async () => {
    const identity = validPreflightReport().identity;
    const fixture = executionBoundaryFixture(identity);
    const nonceDirectory = await mkdtemp(path.join(os.tmpdir(), "bodycast-v5-ddl-attestation-"));
    const spawn = vi.fn(() => ({ status: 0 }));
    const identityProbe = vi.fn(async () => identity);
    expect(EXECUTION_ATTESTATION_MAX_AGE_MS).toBe(5 * 60 * 1000);
    try {
      const supersededPayload = { ...fixture.attestation.payload, preflightRunId: "1202", preflightRunAttempt: 1 };
      const supersededEnvelope = canonicalJson({
        algorithm: "Ed25519",
        keyId: fixture.delegation.payload.executionKeyId,
        payload: supersededPayload,
        signature: sign(null, Buffer.from(canonicalJson(supersededPayload)), createPrivateKey(fixture.delegation.executionPrivateKeyPem)).toString("base64url"),
      });
      const superseded = {
        ...authorizedBoundary(fixture),
        executionAttestation: supersededEnvelope,
        verifiedAttestation: supersededPayload,
      };
      expect(() => createExecutionAttestation({
        authorizationEnvelope: fixture.authorizationEnvelope,
        latestPreflight: { ...fixture.latestPreflight, id: "1202", status: "queued", conclusion: null },
        allowlist,
        delegationCertificate: fixture.delegation.certificate,
        executionPrivateKeyPem: fixture.delegation.executionPrivateKeyPem,
        executionChallenge: fixture.executionChallenge,
        now,
      })).toThrow("latest exact applicable preflight is not the signed successful attempt");
      await expect(startPrismaMigrationAtDdlBoundary({
        authorized: superseded,
        spawn,
        identityProbe,
        nonceDirectory,
        now: () => now,
      })).rejects.toThrow("not bound to the current authorization and exact successful preflight provenance");
      expect(spawn).not.toHaveBeenCalled();

      const wrongChallenge = { ...authorizedBoundary(fixture), executionChallenge: "cd".repeat(32) };
      await expect(startPrismaMigrationAtDdlBoundary({
        authorized: wrongChallenge,
        spawn,
        identityProbe,
        latestPreflightProbe: async () => fixture.latestPreflight,
        nonceDirectory,
        now: () => now,
      })).rejects.toThrow("not bound to its authorized delegated signing key");
      expect(spawn).not.toHaveBeenCalled();

      const supersededNonceDirectory = await mkdtemp(path.join(os.tmpdir(), "bodycast-v5-ddl-superseded-preflight-"));
      try {
        await expect(startPrismaMigrationAtDdlBoundary({
          authorized: authorizedBoundary(fixture),
          spawn,
          identityProbe,
          latestPreflightProbe: async () => ({ ...fixture.latestPreflight, id: "1202", status: "queued", conclusion: null }),
          nonceDirectory: supersededNonceDirectory,
          now: () => now,
        })).rejects.toThrow("newer or changed preflight attempt superseded");
        expect(spawn).not.toHaveBeenCalled();
      } finally {
        await rm(supersededNonceDirectory, { recursive: true, force: true });
      }

      const expectedUrl = withPrismaLockTimeout("postgresql://bodycast:secret@db/bodycast", 5000);
      const authorized = authorizedBoundary(fixture, expectedUrl);
      await startPrismaMigrationAtDdlBoundary({
        authorized,
        environment: { BODYCAST_DDL_ATTESTATION_NONCE_DIR: nonceDirectory },
        spawn,
        identityProbe,
        latestPreflightProbe: async () => fixture.latestPreflight,
        nonceDirectory,
        now: () => now,
      });
      expect(identityProbe).toHaveBeenLastCalledWith(expectedUrl);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn.mock.calls[0][2].env.DATABASE_URL).toBe(expectedUrl);

      await expect(startPrismaMigrationAtDdlBoundary({
        authorized,
        spawn,
        identityProbe,
        latestPreflightProbe: async () => fixture.latestPreflight,
        nonceDirectory,
        now: () => now,
      })).rejects.toThrow("nonce was already consumed");
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      await rm(nonceDirectory, { recursive: true, force: true });
    }
  });

  it("reselects live GitHub preflight state at the protected DDL boundary and blocks queued supersession", async () => {
    const fixture = executionBoundaryFixture(validPreflightReport().identity);
    const toApiRun = (run) => ({
      workflow_id: Number(run.workflowId), path: run.workflowPath, event: run.event,
      head_branch: run.headBranch, head_sha: run.headSha, display_title: run.displayTitle,
      id: Number(run.id), run_attempt: run.runAttempt, created_at: run.createdAt,
      status: run.status, conclusion: run.conclusion, html_url: "https://example.invalid/run",
    });
    const queued = { ...fixture.latestPreflight, id: "1202", createdAt: "2026-10-05T10:01:00.000Z", status: "queued", conclusion: null };
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ workflow_runs: [toApiRun(queued), toApiRun(fixture.latestPreflight)] }),
      requestedUrl: String(url),
    }));
    await expect(readLatestApplicablePreflightForDdl(fixture.attestation.payload, fetchImpl))
      .rejects.toThrow("Latest matching preflight attempt is queued");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/actions/workflows/88/runs");
  });

  it("blocks when the final Prisma URL resolves to an endpoint different from signed identity", async () => {
    const signedIdentity = validPreflightReport().identity;
    const fixture = executionBoundaryFixture(signedIdentity);
    const nonceDirectory = await mkdtemp(path.join(os.tmpdir(), "bodycast-v5-ddl-target-"));
    const spawn = vi.fn(() => ({ status: 0 }));
    try {
      await expect(startPrismaMigrationAtDdlBoundary({
        authorized: authorizedBoundary(fixture),
        spawn,
        nonceDirectory,
        identityProbe: async () => ({ ...signedIdentity, database: "bodycast_restore", databaseOid: 20001, role: "restore_user", serverPort: 5433 }),
        latestPreflightProbe: async () => fixture.latestPreflight,
        now: () => now,
      })).rejects.toThrow("final Prisma DATABASE_URL target differs from the signed production identity");
      expect(spawn).not.toHaveBeenCalled();
      expect(assertPrismaTargetMatchesSignedIdentity({ productionIdentityDigest: canonicalSha256(signedIdentity) }, signedIdentity)).toBe(true);
      expect(() => assertPrismaTargetMatchesSignedIdentity({ productionIdentityDigest: canonicalSha256(signedIdentity) }, { ...signedIdentity, serverAddress: "127.0.0.2" })).toThrow("differs from the signed production identity");
    } finally {
      await rm(nonceDirectory, { recursive: true, force: true });
    }
  });

  it("uses one non-cancelling GitHub concurrency group and performs a final latest-preflight selection", async () => {
    const preflight = await readFile(new URL("../.github/workflows/production-migration-preflight.yml", import.meta.url), "utf8");
    const migrate = await readFile(new URL("../.github/workflows/production-migrate.yml", import.meta.url), "utf8");
    const group = (workflow) => workflow.match(/^concurrency:\r?\n  group: ([^\r\n]+)\r?\n  cancel-in-progress: false/m)?.[1];
    expect(group(preflight)).toBe("bodycast-production-migration");
    expect(group(migrate)).toBe(group(preflight));
    const ddlStep = migrate.indexOf("Run canonical fetch, final signed readiness guard, Prisma migration, and postflight in one remote process");
    const attest = migrate.indexOf("--attest");
    expect(ddlStep).toBeGreaterThan(migrate.indexOf("Stream signed evidence files to private remote temporary context"));
    expect(attest).toBeGreaterThan(ddlStep);
    expect(migrate.slice(ddlStep)).toContain("coproc MIGRATION_REMOTE");
    expect(migrate.slice(ddlStep)).toContain("BODYCAST_DDL_CHALLENGE:");
    expect(migrate.slice(ddlStep).indexOf("BODYCAST_DDL_CHALLENGE:")).toBeLessThan(migrate.slice(ddlStep).indexOf("--select-run"));
    expect(migrate.slice(ddlStep).indexOf("--select-run")).toBeLessThan(migrate.slice(ddlStep).indexOf("--attest"));
    expect(migrate.slice(ddlStep)).toContain("cat \"$RUNNER_TEMP/execution-attestation.json\" >&\"$REMOTE_IN\"");
    expect(migrate).toContain("execution-key-certificate.json");
    expect(migrate).toContain("Upload short-lived delegated execution signer for this workflow run");
    expect(migrate).not.toMatch(/FILES=\([^\n]*execution-signer\.json/);
    expect(migrate).toContain("--delegate");
    expect(migrate.indexOf("--attest")).toBeGreaterThan(migrate.indexOf("SELECTED_ATTEMPT"));
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
    const restoreResult = { verified: true, postflightReady: true, postSchemaDigest: "9".repeat(64) };
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
      backupSnapshotAt: "2026-10-05T09:30:00.000Z",
    };
    const signedClaims = claims({
      workflowId: "800",
      preflightResultDigest: evidence.preflightResultDigest,
      restoreResultDigest: evidence.restoreResultDigest,
      productionIdentityDigest: evidence.productionIdentityDigest,
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
      expect(() => verifyFinalMigrationAuthorization({
        ...args,
        liveReport: { ...liveReport, identity: { ...liveReport.identity, serverAddress: "172.20.0.99" } },
      })).toThrow("differs from the signed preflight target");

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
    })).rejects.toThrow("signed final-guard, current-preflight execution evidence, and one-time challenge");
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
  const success = { ...base, id: 120, runAttempt: 1, createdAt: "2026-10-05T08:00:00Z", status: "completed", conclusion: "success" };
  const failedNew = { ...base, id: 121, runAttempt: 1, createdAt: "2026-10-05T09:00:00Z", status: "completed", conclusion: "failure" };

  it("accepts latest exact successful attempt and blocks older success superseded by newer failed, cancelled, pending, or in-progress attempt", () => {
    expect(selectLatestApplicablePreflight([success], { repository: base.repository, releaseSha: base.headSha, manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id })).toEqual(success);
    for (const newer of [
      failedNew,
      { ...failedNew, conclusion: "cancelled" },
      { ...failedNew, status: "queued", conclusion: null },
      { ...failedNew, status: "in_progress", conclusion: null },
      { ...failedNew, status: "waiting", conclusion: null },
      { ...failedNew, status: "requested", conclusion: null },
      { ...failedNew, status: "pending", conclusion: null },
    ]) {
      expect(() => selectLatestApplicablePreflight([success, newer], { repository: base.repository, releaseSha: base.headSha, manifestId: ACTIVE_ENERGY_UNIFIED_MANIFEST.id })).toThrow();
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
      id: 120, workflow_id: 99, path: base.workflowPath, event: base.event, head_branch: "main",
      head_sha: base.headSha, display_title: base.displayTitle, run_attempt: 1,
      created_at: "2026-10-05T08:00:00Z", status: "completed", conclusion: "success", html_url: "https://example.invalid/run/120",
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
    restored.objects[0].signature = "changed";
    expect(verifyRestoredBackup(source, restored).verified).toBe(false);

    const post = validPreflightReport();
    post.identity = { database: "bodycast_restore", databaseOid: 16385, role: "bodycast_restore", serverVersion: "17.11", serverAddress: "172.20.0.3", serverPort: 5432 };
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
