import { execFileSync, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../scripts/production-migration-manifests.mjs";
import { ALL_REVIEWED_OBJECTS, EXPECTED_MIGRATION_OBJECTS, assertProductionDatabaseIdentityMatches, evaluateProductionPreflight, evaluateProductionPostflight, evaluateProductionMigrationTree, normalizeObjectSignature, verifyRestoredBackup, schemaInventoryDigest, schemaInventoryDifferenceSummary } from "../scripts/production-migration-preflight.mjs";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST, AUTH_MULTIUSER_MANIFEST, DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST, STAGE_02_MANIFEST, TRAINING_MUTATION_LEDGER_MANIFEST, V4_REPUBLICATION_MANIFEST } from "../scripts/production-migration-manifests.mjs";
import { createAuthorizationEnvelope, verifyAuthorizationEnvelope, assertSignedAuthorizationRequired, canonicalSha256 } from "../scripts/production-migration-authorization.mjs";
import { selectLatestApplicablePreflight, verifyPreflightArtifactMetadata, isBackupFresh, withPrismaLockTimeout } from "../scripts/production-migration-release.mjs";
import { readCommittedGitBlob, sha256, verifyExecutionFileMatchesBlob, verifyManifestBlob } from "../scripts/production-migration-integrity.mjs";
import { renderProductionDbPreflightSql, getExpectedSchemaObjectNames } from "../scripts/production-db-preflight.mjs";
import { verifyBaseRestore, verifyDisposablePostflight, verifyDisposableRehearsalAdmission } from "../scripts/production-migration-restore-check.mjs";
import { verifyPostflightMatchesRestore } from "../scripts/production-migration-preflight.mjs";
import { assertLiveDataMatchesBackupReadability, verifyFinalMigrationAuthorization, verifyFinalGuardReceipt } from "../scripts/production-migration-final-guard.mjs";
import { normalizeWorkflowRuns, selectAndVerifyArtifact } from "../scripts/production-migration-select-preflight.mjs";
import { assertBackupFreshAtDdlStart, assertPrismaMigrationAuthorized, assertPrismaTargetMatchesSignedIdentity, readLatestApplicablePreflightForDdl, startPrismaMigrationAtDdlBoundary } from "../scripts/run-prisma-migrate-with-lock-timeout.mjs";
import { normalizePostgresDatabaseIdentityRow } from "../scripts/postgres-database-identity.mjs";
import { psqlCompatibleDatabaseUrl } from "../scripts/production-db-target-url.mjs";
import { assertCurrentMigrationRunMatchesProof, executionProofAudience, readCurrentMigrationRunForDdl, requestGitHubOidcExecutionProof, verifyGitHubExecutionProof } from "../scripts/production-migration-execution-attestation.mjs";
import { PRODUCTION_WRITER_TOPOLOGY_CONTRACT } from "../scripts/production-writer-drain.mjs";
import { assertPreDdlBackupArtifactMetadata, assertPreDdlRecoverySource, assertStableV4RecoverySnapshots, assertV4RecoverySnapshot, assertV4ReplayBoundary, assertV4ReplayRehearsal } from "../scripts/production-v4-recovery.mjs";

const now = Date.parse("2026-10-05T10:00:00.000Z");
const dirs = [
  "20260821000000_init",
  ...STAGE_02_MANIFEST.migrations.map((migration) => migration.name),
  ...ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations.map((migration) => migration.name),
];
const fullDirs = [...dirs, ...V4_REPUBLICATION_MANIFEST.migrations.map((migration) => migration.name)];

function migrationRow(migration, checksum = migration.sha256) {
  return { name: migration.name, checksum, startedAt: "2026-10-01T00:00:00.000Z", finishedAt: "2026-10-01T00:00:01.000Z", rolledBackAt: null, hasLogs: false, logsFingerprint: "d41d8cd98f00b204e9800998ecf8427e" };
}

function migrationFunctionBody(source, functionName) {
  return source.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${functionName}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$ LANGUAGE plpgsql;`))?.[1];
}

describe("production schema signature normalization", () => {
  it("normalizes SQL formatting without changing string-literal contents", () => {
    const formatted = "CREATE FUNCTION public.sample ( p integer , label text ) AS $function$ -- owner's comment\n BEGIN PERFORM 'a,  b'; END; $function$";
    const canonical = "CREATE FUNCTION public.sample(p integer,label text) AS $function$ BEGIN PERFORM 'a,  b'; END; $function$";
    const changedLiteral = "CREATE FUNCTION public.sample(p integer,label text) AS $function$ BEGIN PERFORM 'a, b'; END; $function$";

    expect(normalizeObjectSignature(formatted)).toBe(normalizeObjectSignature(canonical));
    expect(normalizeObjectSignature(formatted)).not.toBe(normalizeObjectSignature(changedLiteral));
  });

  it("accepts only PostgreSQL's exact pg_dump rewrite of the reviewed V3/V4 lifecycle CHECK", async () => {
    const migration = (await readFile(new URL("../prisma/migrations/20261006130000_unified_v4_glycogen_water_rollout/migration.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const v3 = "unified-experimental-physiology-state-v3-relative-muscle-daily-cumulative-diagnostics";
    const v4 = "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once";
    expect(migration).toContain(`CHECK (\"unifiedTargetRevision\" IN (\n      '${v3}',\n      '${v4}'\n    ))`);

    const sourceSignature = `c|validated=true|table=\"PhysiologyV7Lifecycle\"|definition=CHECK (\"unifiedTargetRevision\"::text = ANY (ARRAY['${v3}'::character varying, '${v4}'::character varying]::text[]))`;
    const restoredSignature = `c|validated=true|table=\"PhysiologyV7Lifecycle\"|definition=CHECK (\"unifiedTargetRevision\"::text = ANY (ARRAY['${v3}'::character varying::text, '${v4}'::character varying::text]))`;
    const originalSourceDigest = schemaInventoryDigest([{
      name: "PhysiologyV7Lifecycle_unifiedTargetRevision_supported", present: true, kind: "constraint", signature: sourceSignature,
    }]);
    const restoredConstraint = {
      name: "PhysiologyV7Lifecycle_unifiedTargetRevision_supported", present: true, kind: "constraint", signature: restoredSignature,
    };

    expect(schemaInventoryDigest([restoredConstraint])).toBe(originalSourceDigest);
    const exactRestoreDiagnostic = schemaInventoryDifferenceSummary([{
      name: restoredConstraint.name, present: true, kind: "constraint", signature: sourceSignature,
    }], [restoredConstraint]);
    expect(exactRestoreDiagnostic.changedObjects.find(({ name }) => name === restoredConstraint.name)).toMatchObject({
      name: restoredConstraint.name,
      changedFields: ["signature"],
      normalizedSignaturesEqual: true,
    });

    const changedPredicate = {
      ...restoredConstraint,
      signature: restoredSignature.replace(v4, "unreviewed-v4-revision"),
    };
    const changedPredicateDiagnostic = schemaInventoryDifferenceSummary([{
      name: restoredConstraint.name, present: true, kind: "constraint", signature: sourceSignature,
    }], [changedPredicate]);
    expect(changedPredicateDiagnostic.changedObjects.find(({ name }) => name === restoredConstraint.name).normalizedSignaturesEqual).toBe(false);

    for (const changed of [
      changedPredicate,
      { ...restoredConstraint, name: `${restoredConstraint.name}_renamed` },
      { ...restoredConstraint, kind: "index" },
      { ...restoredConstraint, present: false },
      { ...restoredConstraint, signature: `${restoredSignature} OR TRUE` },
    ]) {
      expect(schemaInventoryDigest([changed])).not.toBe(originalSourceDigest);
    }

    const unrelated = { name: "another-reviewed-constraint", present: true, kind: "constraint", signature: "CHECK (id > 0)" };
    expect(schemaInventoryDigest([restoredConstraint, unrelated])).not.toBe(schemaInventoryDigest([{
      name: restoredConstraint.name, present: true, kind: "constraint", signature: sourceSignature,
    }, { ...unrelated, signature: "CHECK (id >= 0)" }]));

    for (const kind of ["constraint", "function", "trigger"]) {
      const sourceObject = { name: `unrelated-${kind}`, present: true, kind, signature: `${kind}|reviewed-definition` };
      const changedObject = { ...sourceObject, signature: `${kind}|changed-definition` };
      expect(schemaInventoryDigest([sourceObject])).not.toBe(schemaInventoryDigest([changedObject]));
    }

    const missingConstraint = { ...restoredConstraint, present: false, kind: "missing", signature: null };
    expect(schemaInventoryDigest([missingConstraint])).not.toBe(originalSourceDigest);
  });

  it("accepts only PostgreSQL's exact pg_dump rewrite of the V4 publication-source CHECK", async () => {
    const migration = await readFile(new URL("../prisma/migrations/20261011120000_unified_publication_failure_fence/migration.sql", import.meta.url), "utf8");
    expect(migration).toContain('CONSTRAINT "UnifiedPublicationBlock_source_check" CHECK ("source" IN (\'health\', \'day\', \'training\', \'stepper\'))');

    const values = ["health", "day", "training", "stepper"];
    const prefix = 'c|validated=true|table="UnifiedPublicationBlock"|definition=CHECK (source::text = ANY (';
    const sourceSignature = `${prefix}ARRAY[${values.map((value) => `'${value}'::character varying`).join(", ")}]::text[]))`;
    const restoredSignature = `${prefix}ARRAY[${values.map((value) => `'${value}'::character varying::text`).join(", ")}]))`;
    const source = { name: "UnifiedPublicationBlock_source_check", present: true, kind: "constraint", signature: sourceSignature };
    const restored = { ...source, signature: restoredSignature };

    expect(V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[source.name]).toBe(sourceSignature);
    expect(schemaInventoryDigest([restored])).toBe(schemaInventoryDigest([source]));
    expect(schemaInventoryDifferenceSummary([source], [restored]).changedObjects.find(({ name }) => name === source.name)).toMatchObject({
      name: source.name,
      changedFields: ["signature"],
      normalizedSignaturesEqual: true,
    });

    for (const changed of [
      { ...restored, signature: restoredSignature.replace("'stepper'", "'unexpected'") },
      { ...restored, signature: restoredSignature.replace(", 'stepper'::character varying::text", "") },
      { ...restored, signature: `${restoredSignature} OR TRUE` },
      { ...restored, kind: "index" },
      { ...restored, present: false },
    ]) {
      expect(schemaInventoryDigest([changed])).not.toBe(schemaInventoryDigest([source]));
    }
  });

  it("canonicalizes only the four exact PostgreSQL 17.11 Training constraint renderings", async () => {
    const [convergenceMigration, stepperMigration] = await Promise.all([
      readFile(new URL("../prisma/migrations/20261017140000_active_energy_convergence_fence/migration.sql", import.meta.url), "utf8"),
      readFile(new URL("../prisma/migrations/20261017130000_stepper_operation_recovery/migration.sql", import.meta.url), "utf8"),
    ]);
    expect(convergenceMigration).toContain('CHECK ("source" IN (\'health\', \'day\', \'training\', \'stepper\', \'active_energy\'))');
    expect(stepperMigration).toContain('CHECK ("payloadVersion" = 1)');
    expect(stepperMigration).toContain('CHECK ("state" IN (\'PENDING\', \'COMMITTED\', \'TOMBSTONED\'))');
    expect(stepperMigration).toContain('("state" = \'PENDING\' AND "workoutId" IS NULL)');

    const actualPg17 = {
      UnifiedPublicationBlock_source_check: `c|validated=true|table="UnifiedPublicationBlock"|definition=CHECK (source::text = ANY (ARRAY['health'::character varying, 'day'::character varying, 'training'::character varying, 'stepper'::character varying, 'active_energy'::character varying]::text[]))`,
      StepperCreateOperation_payloadVersion_check: `c|validated=true|table="StepperCreateOperation"|definition=CHECK ("payloadVersion" = 1)`,
      StepperCreateOperation_state_check: `c|validated=true|table="StepperCreateOperation"|definition=CHECK (state::text = ANY (ARRAY['PENDING'::character varying, 'COMMITTED'::character varying, 'TOMBSTONED'::character varying]::text[]))`,
      StepperCreateOperation_result_check: `c|validated=true|table="StepperCreateOperation"|definition=CHECK (state::text = 'PENDING'::text AND "workoutId" IS NULL OR (state::text = ANY (ARRAY['COMMITTED'::character varying, 'TOMBSTONED'::character varying]::text[])) AND "workoutId" IS NOT NULL)`,
    };

    for (const [name, signature] of Object.entries(actualPg17)) {
      const expected = TRAINING_MUTATION_LEDGER_MANIFEST.postflightSignatureEquals[name];
      expect(expected).toBeTruthy();
      const expectedObject = { name, present: true, kind: "constraint", signature: expected };
      const pg17Object = { ...expectedObject, signature };
      expect(schemaInventoryDigest([pg17Object])).toBe(schemaInventoryDigest([expectedObject]));
      expect(schemaInventoryDifferenceSummary([expectedObject], [pg17Object]).changedObjects.find(({ name: changed }) => changed === name).normalizedSignaturesEqual).toBe(true);
      expect(schemaInventoryDigest([{ ...pg17Object, signature: `${signature} OR TRUE` }])).not.toBe(schemaInventoryDigest([expectedObject]));
    }

    for (const [name, mutate] of [
      ["UnifiedPublicationBlock_source_check", (signature) => signature.replace("'active_energy'", "'unknown'")],
      ["StepperCreateOperation_payloadVersion_check", (signature) => signature.replace("= 1", "= 2")],
      ["StepperCreateOperation_state_check", (signature) => signature.replace("'TOMBSTONED'", "'DELETED'")],
      ["StepperCreateOperation_result_check", (signature) => signature.replace("'COMMITTED'", "'PENDING'")],
    ]) {
      const expected = TRAINING_MUTATION_LEDGER_MANIFEST.postflightSignatureEquals[name];
      const sourceObject = { name, present: true, kind: "constraint", signature: expected };
      const altered = { ...sourceObject, signature: mutate(actualPg17[name]) };
      expect(schemaInventoryDigest([altered])).not.toBe(schemaInventoryDigest([sourceObject]));
      expect(schemaInventoryDifferenceSummary([sourceObject], [altered]).changedObjects.find(({ name: changed }) => changed === name).normalizedSignaturesEqual).toBe(false);
    }
  });

  it("binds V4 baseline function signatures to the reviewed prior migration bodies", async () => {
    const [persistenceMigration, staleSuffixMigration, v4Migration] = await Promise.all([
      readFile(new URL("../prisma/migrations/20260918120000_add_v7_physiology_persistence/migration.sql", import.meta.url), "utf8"),
      readFile(new URL("../prisma/migrations/20260921140000_fix_v7_stale_suffix_lifecycle/migration.sql", import.meta.url), "utf8"),
      readFile(new URL("../prisma/migrations/20261011130000_only_completed_training_invalidates_v7/migration.sql", import.meta.url), "utf8"),
    ]);
    const expectedBodies = new Map([
      ["function:physiology_v7_workout_source_trigger()", migrationFunctionBody(persistenceMigration, "physiology_v7_workout_source_trigger")],
      ["function:physiology_v7_session_source_trigger()", migrationFunctionBody(persistenceMigration, "physiology_v7_session_source_trigger")],
      ["function:physiology_v7_invalidate(integer, character varying)", migrationFunctionBody(staleSuffixMigration, "physiology_v7_invalidate")],
    ]);

    for (const [name, sourceBody] of expectedBodies) {
      const signature = V4_REPUBLICATION_MANIFEST.requiredObjectSignatureIncludes[name];
      const manifestBody = signature?.match(/AS \$function\$([\s\S]*?)\$function\$/)?.[1];
      expect(sourceBody, `${name} source migration function`).toBeTruthy();
      expect(manifestBody, `${name} manifest signature body`).toBeTruthy();
      expect(normalizeObjectSignature(manifestBody), `${name} source-bound manifest body`)
        .toBe(normalizeObjectSignature(sourceBody));
    }

    for (const functionName of ["physiology_v7_session_source_trigger", "physiology_v7_session_child_source_trigger"]) {
      const name = `function:${functionName}()`;
      const sourceBody = migrationFunctionBody(v4Migration, functionName);
      const signature = V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[name];
      const manifestBody = signature?.match(/AS \$function\$([\s\S]*?)\$function\$/)?.[1];
      expect(sourceBody, `${name} V4 migration function`).toBeTruthy();
      expect(manifestBody, `${name} postflight signature body`).toBeTruthy();
      expect(normalizeObjectSignature(manifestBody), `${name} source-bound postflight body`)
        .toBe(normalizeObjectSignature(sourceBody));
    }
  });
});

function schemaObjects(state = "old-before") {
  const oldMigrationsApplied = ["old-after", "v4-before", "v4-after"].includes(state);
  const newMigrationsApplied = state === "v4-after";
  const objects = new Map(getExpectedSchemaObjectNames().map((name) => [name, { name, present: false, kind: "missing", signature: null }]));
  const set = (name, present, kind, signature) => objects.set(name, { name, present, kind, signature: present ? signature ?? "reviewed-signature" : null });
  for (const name of EXPECTED_MIGRATION_OBJECTS) set(name, true, "constraint", "reviewed-stage02-signature");
  for (const name of ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredObjectsBefore) {
    set(name, !oldMigrationsApplied, "index", ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredObjectSignatureIncludes[name]);
  }
  for (const name of ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects) {
    set(name, oldMigrationsApplied, "reviewed", ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightSignatureIncludes[name]);
  }
  for (const name of V4_REPUBLICATION_MANIFEST.requiredObjectsBefore) {
    set(name, oldMigrationsApplied, name.startsWith("function:") ? "function" : name.startsWith("trigger:") ? "trigger" : "reviewed",
      V4_REPUBLICATION_MANIFEST.requiredObjectSignatureIncludes[name] ?? ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightSignatureIncludes[name]);
  }
  for (const name of V4_REPUBLICATION_MANIFEST.partialObjects) {
    set(name, newMigrationsApplied, "reviewed", V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[name]);
  }
  for (const name of V4_REPUBLICATION_MANIFEST.postflightObjects) {
    if (name.startsWith("function:") || name.startsWith("trigger:")) {
      const addedDuringV4Migration = [
        "function:physiology_v7_model_date(integer, timestamp with time zone)",
        "function:physiology_v7_training_model_date(integer, integer, timestamp with time zone, timestamp with time zone, timestamp with time zone)",
        "function:physiology_v7_matched_workout_source_trigger()",
        "function:physiology_v7_matched_workout_delete_trigger()",
        "trigger:Workout.Workout_v7_invalidate",
        "trigger:Workout.Workout_v7_invalidate_matched_delete",
      ].includes(name);
      set(name, newMigrationsApplied || (oldMigrationsApplied && !addedDuringV4Migration), name.startsWith("function:") ? "function" : "trigger",
        newMigrationsApplied
          ? V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[name]
          : V4_REPUBLICATION_MANIFEST.requiredObjectSignatureIncludes[name]);
    }
  }
  return [...objects.values()];
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
    objects: schemaObjects("old-before"),
    tables: Object.fromEntries(ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredTablesBefore.map((name) => [name, { exists: true, estimatedRows: 1, totalBytes: 128 }])),
    conflictingLocks: [],
    preparedTransactions: [],
    longTransactions: [],
    writerDrain: readyWriterDrain(),
  };
}

function validV4RepublicationPreflightReport() {
  const report = validPreflightReport();
  report.migrations.push(...ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations.map((migration) => migrationRow(migration)));
  report.objects = schemaObjects("v4-before");
  return report;
}

const dynamicWorkoutDirs = [
  ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredAppliedMigrations,
  ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.migrations,
].map(({ name }) => name).sort();
const trainingMutationLedgerDirs = [
  ...TRAINING_MUTATION_LEDGER_MANIFEST.requiredAppliedMigrations,
  ...TRAINING_MUTATION_LEDGER_MANIFEST.migrations,
].map(({ name }) => name).sort();

function validDynamicWorkoutPreflightReport({ applied = false } = {}) {
  const report = validPreflightReport();
  report.migrations = [
    ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredAppliedMigrations.map((migration) => migrationRow(migration)),
    ...(applied ? DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.migrations.map((migration) => migrationRow(migration)) : []),
  ];
  report.objects = schemaObjects("v4-after");
  const dynamicNames = DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.postflightObjects.filter((name) =>
    name.startsWith("HealthSyncRefreshJob") || name.startsWith("StrengthDiarySession.program")
    || name.startsWith("StrengthDiarySession_program") && name.endsWith("_fkey")
    || name === "StrengthDiarySession_program_pair_check");
  for (const name of dynamicNames) {
    const present = name.startsWith("StrengthDiarySession_program") && name.endsWith("_fkey")
      || name === "StrengthDiarySession.programId" || name === "StrengthDiarySession.programVersionId" || applied;
    const signature = present
      ? applied ? DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.postflightSignatureIncludes[name]
        : DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredObjectSignatureEquals[name]
          ?? DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredObjectSignatureIncludes[name]
      : null;
    const kind = !present ? "missing"
      : name.includes(".") ? "column"
        : name === "HealthSyncRefreshJob" ? "table"
          : name.endsWith("_idx") ? "index" : "constraint";
    const index = report.objects.findIndex((object) => object.name === name);
    report.objects[index] = { name, present, kind, signature };
  }
  report.tables = { ...report.tables, StrengthDiarySession: { exists: true, estimatedRows: 1, totalBytes: 128 } };
  report.programlessSessionCount = 0;
  return report;
}

function validTrainingMutationLedgerPreflightReport({ applied = false } = {}) {
  const report = validDynamicWorkoutPreflightReport({ applied });
  report.migrations = [
    ...TRAINING_MUTATION_LEDGER_MANIFEST.requiredAppliedMigrations.map((migration) => migrationRow(migration)),
    ...(applied ? TRAINING_MUTATION_LEDGER_MANIFEST.migrations.map((migration) => migrationRow(migration)) : []),
  ];
  const trainingOutputObjects = TRAINING_MUTATION_LEDGER_MANIFEST.postflightObjects.filter((candidate) =>
    !DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.postflightObjects.includes(candidate)
      && Object.hasOwn(TRAINING_MUTATION_LEDGER_MANIFEST.postflightSignatureEquals, candidate));
  for (const name of [...trainingOutputObjects, "UnifiedPublicationBlock_source_check"]) {
    const object = report.objects.find((candidate) => candidate.name === name);
    if (!object) throw new Error(`Missing reviewed schema object fixture: ${name}`);
    const signature = TRAINING_MUTATION_LEDGER_MANIFEST.postflightSignatureEquals[name];
    object.present = applied || !TRAINING_MUTATION_LEDGER_MANIFEST.partialObjects.includes(name);
    object.kind = !object.present ? "missing"
      : name.includes(".") ? "column"
      : name === "TrainingRefreshJob" || name === "TrainingSourceChange" || name === "TrainingSetCreateOperation" || name === "StepperCreateOperation" ? "table"
          : name.endsWith("_idx") ? "index" : "constraint";
    object.signature = object.present
      ? name === "UnifiedPublicationBlock_source_check" && !applied
        ? TRAINING_MUTATION_LEDGER_MANIFEST.requiredObjectSignatureEquals[name]
        : signature
      : null;
  }
  if (applied) report.tables = {
    ...report.tables,
    HealthSyncRefreshJob: { exists: true, estimatedRows: 1, totalBytes: 128 },
  };
  return report;
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
  it("keeps the V4 runbook migration hashes bound to the release manifest", async () => {
    const runbook = await readFile(new URL("../docs/development/production-migration-v5-runbook.md", import.meta.url), "utf8");
    for (const migration of V4_REPUBLICATION_MANIFEST.migrations) {
      expect(runbook).toContain(`| \`${migration.name}\` | \`${migration.sha256}\` |`);
    }
  });

  it("keeps all nine Training release migration hashes bound to the runbook", async () => {
    const runbook = await readFile(new URL("../docs/development/production-migration-v5-runbook.md", import.meta.url), "utf8");
    expect(TRAINING_MUTATION_LEDGER_MANIFEST.migrations).toHaveLength(9);
    expect(TRAINING_MUTATION_LEDGER_MANIFEST.cutbackSupported).toBe(false);
    for (const migration of TRAINING_MUTATION_LEDGER_MANIFEST.migrations) {
      expect(runbook).toContain(`| \`${migration.name}\` | \`${migration.sha256}\` |`);
    }
    expect(runbook).toContain("there is no automatic forward-resume or rollback");
    expect(runbook).toContain("Do not retry `migrate deploy`, run `prisma migrate resolve`");
    expect(runbook).toContain("The Training manifest has `cutbackSupported: false`");
  });

  it("keeps the Training manifest intact and rehearses the complete Auth release from its pinned 74-migration baseline", async () => {
    const [migrationWorkflow, preflightWorkflow, safetyWorkflow] = await Promise.all([
      readFile(new URL("../.github/workflows/production-migrate.yml", import.meta.url), "utf8"),
      readFile(new URL("../.github/workflows/production-migration-preflight.yml", import.meta.url), "utf8"),
      readFile(new URL("../.github/workflows/production-migration-safety-ci.yml", import.meta.url), "utf8"),
    ]);
    expect(TRAINING_MUTATION_LEDGER_MANIFEST.requiredAppliedMigrations).toHaveLength(65);
    expect(TRAINING_MUTATION_LEDGER_MANIFEST.migrations).toHaveLength(9);
    expect(AUTH_MULTIUSER_MANIFEST.migrationOriginSha).toBe("0f93f37dd6a4208cfc74331a0fb4c063c542c6bd");
    expect(AUTH_MULTIUSER_MANIFEST.requiredAppliedMigrations).toHaveLength(74);
    expect(AUTH_MULTIUSER_MANIFEST.migrations).toHaveLength(3);
    expect(AUTH_MULTIUSER_MANIFEST.requireCompleteReleaseTree).toBe(true);
    expect(AUTH_MULTIUSER_MANIFEST.cutbackSupported).toBe(false);

    const migrationDirectories = await readdir(new URL("../prisma/migrations/", import.meta.url), { withFileTypes: true });
    const releaseTree = evaluateProductionMigrationTree(
      migrationDirectories.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
      AUTH_MULTIUSER_MANIFEST.id,
    );
    expect(releaseTree.ready).toBe(true);
    expect(releaseTree.actualDirectories).toHaveLength(77);

    for (const migration of AUTH_MULTIUSER_MANIFEST.migrations) {
      const sql = await readFile(new URL(`../prisma/migrations/${migration.name}/migration.sql`, import.meta.url), "utf8");
      const cleanBlobBytes = Buffer.from(sql.replaceAll("\r\n", "\n"));
      expect(createHash("sha256").update(cleanBlobBytes).digest("hex")).toBe(migration.sha256);
    }

    expect(migrationWorkflow).toContain("training-mutation-ledger-refresh-queue-v1");
    expect(migrationWorkflow).not.toContain("programless-workouts-health-sync-v1");
    expect(migrationWorkflow).toContain("auth-multiuser-v1");
    expect(migrationWorkflow).toContain("The Auth migration manifest accepts standard exact-SHA execution only.");
    expect(preflightWorkflow).toContain("training-mutation-ledger-refresh-queue-v1");
    expect(preflightWorkflow).not.toContain("programless-workouts-health-sync-v1");
    expect(preflightWorkflow).toContain("auth-multiuser-v1");
    expect(preflightWorkflow).toContain("The Auth migration manifest does not accept historical resume evidence.");
    expect(safetyWorkflow).toContain("Rehearse the exact Auth manifest from the pinned 74-migration baseline");
    expect(safetyWorkflow).toContain("BASELINE_SHA: 0f93f37dd6a4208cfc74331a0fb4c063c542c6bd");
    expect(safetyWorkflow).toContain("test \"$baseline_count\" = 74");
    expect(safetyWorkflow).toContain("--manifest auth-multiuser-v1");
    const rehearsalStart = safetyWorkflow.indexOf("Rehearse the exact Auth manifest from the pinned 74-migration baseline");
    const exactTreeCheck = safetyWorkflow.indexOf("--verify-release-tree", rehearsalStart);
    const baselineMigration = safetyWorkflow.indexOf('npx prisma migrate deploy --schema "$baseline_root/prisma/schema.prisma"', rehearsalStart);
    const currentMigration = safetyWorkflow.indexOf('npx prisma migrate deploy --schema prisma/schema.prisma', rehearsalStart);
    expect(rehearsalStart).toBeGreaterThan(0);
    expect(exactTreeCheck).toBeGreaterThan(0);
    expect(baselineMigration).toBeGreaterThan(rehearsalStart);
    expect(exactTreeCheck).toBeGreaterThan(baselineMigration);
    expect(exactTreeCheck).toBeLessThan(currentMigration);
    expect(safetyWorkflow).toContain("npx prisma migrate deploy --schema prisma/schema.prisma");
    expect(safetyWorkflow).toMatch(/\|\s*PGAPPNAME=bodycast-production-preflight\s+psql\s+"\$DATABASE_URL"/);
    expect(safetyWorkflow).not.toMatch(/PGAPPNAME=bodycast-production-preflight\s+\\\s*\n\s*node scripts\/production-db-preflight\.mjs/);
    expect(safetyWorkflow).toContain("--manifest auth-multiuser-v1 --release-sha \"$GITHUB_SHA\"");
    expect(safetyWorkflow).toContain('--release-sha "$GITHUB_SHA"');
  });

  it("renders Auth baseline tables and DDL locks from its reviewed manifest", async () => {
    const template = await readFile(new URL("../scripts/production-db-preflight.sql", import.meta.url), "utf8");
    const authSql = renderProductionDbPreflightSql(template, getExpectedSchemaObjectNames(), AUTH_MULTIUSER_MANIFEST.id);
    const trainingSql = renderProductionDbPreflightSql(template);

    expect(authSql).not.toContain("__EXPECTED_SCHEMA_OBJECTS_JSON__");
    expect(authSql).not.toContain("__BASELINE_TABLES_JSON__");
    expect(authSql).not.toContain("__DDL_LOCK_TARGETS_JSON__");
    expect(authSql).toContain(JSON.stringify(AUTH_MULTIUSER_MANIFEST.requiredTablesBefore));
    expect(authSql).toContain(JSON.stringify(AUTH_MULTIUSER_MANIFEST.ddlLockTargets));
    expect(AUTH_MULTIUSER_MANIFEST.ddlLockTargets).toHaveLength(50);
    expect(authSql).toContain("AccessExclusiveLock");
    expect(authSql).toContain("AuthRateLimitBucket");
    expect(trainingSql).toContain('{"tableName":"Workout","requiredLockMode":"ShareRowExclusiveLock"}');
    expect(trainingSql).toContain('{"tableName":"DailyModelState","requiredLockMode":"AccessExclusiveLock"}');
    expect(trainingSql).toContain(JSON.stringify(ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredTablesBefore));
  });

  it("renders the canonical preflight SQL template before the PostgreSQL backup/restore smoke executes it", async () => {
    const smoke = await readFile(new URL("../scripts/ci/production-safety-postgres-smoke.mjs", import.meta.url), "utf8");
    expect(smoke).toContain('import { renderProductionDbPreflightSql } from "../production-db-preflight.mjs";');
    expect(smoke).toContain('sql(db, renderProductionDbPreflightSql(requireSql("scripts/production-db-preflight.sql")))');
    expect(smoke).not.toContain('sql(db, requireSql("scripts/production-db-preflight.sql"))');
  });

  it("keeps the V4-created publication fence outside raw-source identity while retaining stable-state coverage", async () => {
    const fingerprint = await readFile(new URL("../scripts/production-db-data-fingerprint.sh", import.meta.url), "utf8");
    const smoke = await readFile(new URL("../scripts/ci/production-safety-postgres-smoke.mjs", import.meta.url), "utf8");
    expect(fingerprint).toContain("bodycast-v4-replay-source-fingerprint-v3");
    expect(fingerprint).toContain("excluded-derived-tables:ExperimentalTransientExerciseWaterShadow,PhysiologyV7Lifecycle,UnifiedExperimentalPhysiologyStateV2,UnifiedPublicationBlock,_prisma_migrations");
    expect(fingerprint).toContain('|| "$table" == "UnifiedPublicationBlock" || "$table" == "_prisma_migrations" )');
    expect(smoke).toContain("const v4ReplayInputsBeforeMigrations = getV4ReplayInputFingerprint();");
    expect(smoke).toContain("v4ReplayInputsBefore !== v4ReplayInputsBeforeMigrations");
    expect(smoke).toContain("publicationBlockStableStateAfter === publicationBlockStableStateBefore");
  });

  it("runs production preflight and postflight against the effective Compose Prisma DATABASE_URL", async () => {
    const deploy = await readFile(new URL("../scripts/deploy-migrate.sh", import.meta.url), "utf8");
    const target = await readFile(new URL("../scripts/production-db-target.sh", import.meta.url), "utf8");
    const preflight = await readFile(new URL("../.github/workflows/production-migration-preflight.yml", import.meta.url), "utf8");
    expect(deploy).toContain('production-db-target.sh" --preflight "$DB_CONTAINER"');
    expect(target).toContain("docker compose -f \"$COMPOSE_FILE\" --profile tools run --rm --no-deps");
    expect(target).toContain("production-db-target-url.mjs");
    expect(target).toContain('psql "$BODYCAST_PSQL_DATABASE_URL"');
    expect(target).toContain('readonly DB_NETWORK="bodycast-backend-prod"');
    expect(target).toContain('node "$ROOT_DIR/scripts/production-db-endpoint-binding.mjs" --verify-stdin "$FIXED_DB_ADDRESS"');
    const preflightTargetStart = target.indexOf("  --preflight)");
    const compatibilityTargetStart = target.indexOf("  --previous-app-compatibility-snapshot)");
    const reportBinding = 'verify_report_endpoint "$RAW_REPORT"';
    expect(target.indexOf(reportBinding, preflightTargetStart)).toBeLessThan(target.indexOf('DATA_FINGERPRINT="'));
    expect(target.indexOf(reportBinding, compatibilityTargetStart)).toBeLessThan(target.indexOf('printf \'%s\\n\' "$RAW_REPORT"', compatibilityTargetStart));
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
    expect(sql).toContain("__DDL_LOCK_TARGETS_JSON__");
    const renderedSql = renderProductionDbPreflightSql(sql);
    expect(renderedSql).toContain('{"tableName":"Workout","requiredLockMode":"ShareRowExclusiveLock"}');
    expect(renderedSql).toContain('{"tableName":"PhysiologyV7Lifecycle","requiredLockMode":"AccessExclusiveLock"}');
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
    for (const migration of [...STAGE_02_MANIFEST.migrations, ...ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations,
      ...V4_REPUBLICATION_MANIFEST.migrations, ...V4_REPUBLICATION_MANIFEST.requiredAppliedMigrations,
      ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.migrations, ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredAppliedMigrations]) {
      const result = await verifyManifestBlob({ repositoryPath: process.cwd(), releaseSha, migration });
      expect(result.matchesManifest, migration.name).toBe(true);
    }
  }, 30_000);

  it("loads the closed migration manifest for direct shell byte checks", async () => {
    const script = await readFile(new URL("../scripts/deploy-migrate.sh", import.meta.url), "utf8");
    expect(script).toContain('getProductionMigrationManifest(process.argv[2])');
    expect(script).toContain("...manifest.migrations");
    expect(script).toContain("...(manifest.requiredAppliedMigrations ?? [])");
    expect(script).toContain('git cat-file blob "$RELEASE_SHA:$relative"');
    expect(script).toContain('[[ "$actual_hash" == "$expected_hash" ]]');
  });

  it("accepts only the exact full pending set and reviewed Stage 02 history", () => {
    const result = evaluateProductionPreflight(validPreflightReport(), dirs);
    expect(result.readyForOwnerAuthorization, result.blockers.join(" | ")).toBe(true);
    expect(result.pending).toEqual(names);
    expect(result.manifestId).toBe(ACTIVE_ENERGY_UNIFIED_MANIFEST.id);
    const currentRelease = evaluateProductionPreflight(validPreflightReport(), fullDirs);
    expect(currentRelease.readyForOwnerAuthorization).toBe(false);
    expect(currentRelease.pending).toEqual([...names, ...V4_REPUBLICATION_MANIFEST.migrations.map(({ name }) => name)].sort());
  });

  it("accepts only the exact PostgreSQL 17 restored Training checks in the Auth baseline", () => {
    const report = validTrainingMutationLedgerPreflightReport({ applied: true });
    const authDirs = [...trainingMutationLedgerDirs, ...AUTH_MULTIUSER_MANIFEST.migrations.map(({ name }) => name)];
    report.objects = schemaObjects("v4-after");
    for (const name of AUTH_MULTIUSER_MANIFEST.requiredObjectsBefore) {
      const object = report.objects.find((candidate) => candidate.name === name);
      object.present = true;
      object.kind = name.startsWith("function:") ? "function"
        : name.startsWith("trigger:") ? "trigger"
          : name.includes(".") ? "column" : "constraint";
      object.signature = AUTH_MULTIUSER_MANIFEST.requiredObjectSignatureEquals[name]
        ?? AUTH_MULTIUSER_MANIFEST.requiredObjectSignatureIncludes[name]
        ?? "reviewed-signature";
    }
    report.tables = Object.fromEntries(AUTH_MULTIUSER_MANIFEST.requiredTablesBefore.map((name) => [name, { exists: true, estimatedRows: 1, totalBytes: 128 }]));
    const restoredSignatures = {
      UnifiedPublicationBlock_source_check: `c|validated=true|table="UnifiedPublicationBlock"|definition=CHECK (source::text = ANY (ARRAY['health'::character varying, 'day'::character varying, 'training'::character varying, 'stepper'::character varying, 'active_energy'::character varying]::text[]))`,
      StepperCreateOperation_payloadVersion_check: `c|validated=true|table="StepperCreateOperation"|definition=CHECK ("payloadVersion" = 1)`,
      StepperCreateOperation_state_check: `c|validated=true|table="StepperCreateOperation"|definition=CHECK (state::text = ANY (ARRAY['PENDING'::character varying, 'COMMITTED'::character varying, 'TOMBSTONED'::character varying]::text[]))`,
      StepperCreateOperation_result_check: `c|validated=true|table="StepperCreateOperation"|definition=CHECK (state::text = 'PENDING'::text AND "workoutId" IS NULL OR (state::text = ANY (ARRAY['COMMITTED'::character varying, 'TOMBSTONED'::character varying]::text[])) AND "workoutId" IS NOT NULL)`,
    };
    for (const [name, signature] of Object.entries(restoredSignatures)) {
      report.objects.find((object) => object.name === name).signature = signature;
    }

    const accepted = evaluateProductionPreflight(report, authDirs, AUTH_MULTIUSER_MANIFEST.id);
    expect(accepted.readyForOwnerAuthorization, accepted.blockers.join(" | ")).toBe(true);

    const altered = { ...report, objects: report.objects.map((object) => ({ ...object })) };
    altered.objects.find((object) => object.name === "StepperCreateOperation_state_check").signature =
      restoredSignatures.StepperCreateOperation_state_check.replace("'TOMBSTONED'", "'UNREVIEWED'");
    const rejected = evaluateProductionPreflight(altered, authDirs, AUTH_MULTIUSER_MANIFEST.id);
    expect(rejected.blockers.join(" ")).toContain("pre-migration schema signatures differ");
  });

  it("blocks an extra release migration, unexpected database row, failed row, duplicate, rollback, checksum drift, or partial target schema", () => {
    const extraDirectory = evaluateProductionPreflight(validPreflightReport(), [...dirs, "20261004120000_unreviewed"]);
    expect(extraDirectory.blockers.join(" ")).toContain("Full release-tree pending set differs");

    const unexpected = validPreflightReport();
    unexpected.migrations.push(migrationRow({ name: "20260701000000_not-in-tree", sha256: "1".repeat(64) }));
    expect(evaluateProductionPreflight(unexpected, dirs).blockers.join(" ")).toContain("absent from this release tree");

    const failed = validPreflightReport();
    failed.migrations.push({ name: dirs[0], checksum: "a".repeat(64), startedAt: "2026-10-02T00:00:00Z", finishedAt: null, rolledBackAt: null, hasLogs: false, logsFingerprint: "d41d8cd98f00b204e9800998ecf8427e" });
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
    post.objects = schemaObjects("old-after");
    const result = evaluateProductionPostflight(post, dirs, ACTIVE_ENERGY_UNIFIED_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" });
    expect(result.ready).toBe(true);
    post.objects.find((object) => object.name === "RelMuscleDelta_episode_date_key").signature = "unique=false|wrong-columns";
    expect(evaluateProductionPostflight(post, dirs, ACTIVE_ENERGY_UNIFIED_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" }).blockers.join(" ")).toContain("Relative Muscle postflight schema signatures differ");
    post.objects = schemaObjects("old-after");
    post.migrations.find((row) => row.name === ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations[0].name).checksum = "0".repeat(64);
    expect(evaluateProductionPostflight(post, dirs, ACTIVE_ENERGY_UNIFIED_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" }).blockers.join(" ")).toContain("checksum differs");
  });

  it("authorizes the new two-migration manifest only after all six prior migrations and exact baseline signatures", async () => {
    const report = validV4RepublicationPreflightReport();
    const result = evaluateProductionPreflight(report, fullDirs, V4_REPUBLICATION_MANIFEST.id);
    expect(result.readyForOwnerAuthorization).toBe(true);
    expect(result.pending).toEqual(V4_REPUBLICATION_MANIFEST.migrations.map(({ name }) => name).sort());
    expect(result.manifestId).toBe(V4_REPUBLICATION_MANIFEST.id);

    const missingPriorMigration = structuredClone(report);
    missingPriorMigration.migrations = missingPriorMigration.migrations.filter((row) => row.name !== ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations[0].name);
    expect(evaluateProductionPreflight(missingPriorMigration, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("Required prior migration");

    const wrongPriorChecksum = structuredClone(report);
    wrongPriorChecksum.migrations.find((row) => row.name === ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations[0].name).checksum = "0".repeat(64);
    expect(evaluateProductionPreflight(wrongPriorChecksum, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("Required prior migration");

    const partialSchema = structuredClone(report);
    partialSchema.objects.find((object) => object.name === V4_REPUBLICATION_MANIFEST.partialObjects[0]).present = true;
    expect(evaluateProductionPreflight(partialSchema, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("already exist while the exact migration set is pending");

    const partiallyReplacedFunction = structuredClone(report);
    const parentFunction = partiallyReplacedFunction.objects.find((object) => object.name === "function:physiology_v7_session_source_trigger()");
    parentFunction.signature = parentFunction.signature.replace(
      "DECLARE old_date VARCHAR(10);",
      "DECLARE old_date VARCHAR(10); old_completed BOOLEAN := false;",
    );
    expect(evaluateProductionPreflight(partiallyReplacedFunction, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("pre-migration schema signatures differ");

    const partiallyAppliedChildTrigger = structuredClone(report);
    const childTrigger = partiallyAppliedChildTrigger.objects.find((object) => object.name === "function:physiology_v7_session_child_source_trigger()");
    const childTriggerTargetSignature = V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes["function:physiology_v7_session_child_source_trigger()"];
    const childTriggerMigration = await readFile(new URL("../prisma/migrations/20261011130000_only_completed_training_invalidates_v7/migration.sql", import.meta.url), "utf8");
    const sourceTargets = [
      ["physiology_v7_model_date", V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[
        "function:physiology_v7_model_date(integer, timestamp with time zone)"
      ]],
      ["physiology_v7_training_model_date", V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[
        "function:physiology_v7_training_model_date(integer, integer, timestamp with time zone, timestamp with time zone, timestamp with time zone)"
      ]],
      ["physiology_v7_matched_workout_source_trigger", V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[
        "function:physiology_v7_matched_workout_source_trigger()"
      ]],
      ["physiology_v7_matched_workout_delete_trigger", V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[
        "function:physiology_v7_matched_workout_delete_trigger()"
      ]],
      ["physiology_v7_training_date", V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes["function:physiology_v7_training_date(integer)"]],
      ["physiology_v7_session_source_trigger", V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes["function:physiology_v7_session_source_trigger()"]],
      ["physiology_v7_session_child_source_trigger", childTriggerTargetSignature],
    ];
    for (const [functionName, targetSignature] of sourceTargets) {
      const source = childTriggerMigration.match(new RegExp(`CREATE OR REPLACE FUNCTION ${functionName}\\([\\s\\S]*?\\$\\$ LANGUAGE plpgsql(?: STABLE)?;`))?.[0];
      const sourceBody = source?.match(/AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql(?: STABLE)?;/)?.[1];
      const postflightBody = targetSignature.match(/AS \$function\$([\s\S]*?)\$function\$/)?.[1];
      expect(sourceBody, `${functionName} migration body`).toBeTruthy();
      expect(normalizeObjectSignature(postflightBody), `${functionName} manifest body`)
        .toBe(normalizeObjectSignature(sourceBody));
    }
    expect(V4_REPUBLICATION_MANIFEST.requiredObjectSignatureExcludes["function:physiology_v7_session_child_source_trigger()"])
      .toBe(childTriggerTargetSignature);
    childTrigger.signature = childTriggerTargetSignature;
    expect(evaluateProductionPreflight(partiallyAppliedChildTrigger, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("already contain target migration changes");

    const wrongBaselineTriggerEvent = structuredClone(report);
    const baselineSessionTrigger = wrongBaselineTriggerEvent.objects.find((object) => object.name === "trigger:StrengthDiarySession.StrengthDiarySession_v7_invalidate");
    baselineSessionTrigger.signature = baselineSessionTrigger.signature.replace("AFTER INSERT OR DELETE OR UPDATE", "AFTER INSERT OR UPDATE");
    expect(evaluateProductionPreflight(wrongBaselineTriggerEvent, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("pre-migration schema signatures differ");

    const legacyWorkoutSource = await readFile(new URL("../prisma/migrations/20260918120000_add_v7_physiology_persistence/migration.sql", import.meta.url), "utf8");
    const legacyWorkoutFunction = legacyWorkoutSource.match(/CREATE FUNCTION physiology_v7_workout_source_trigger\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/)?.[0];
    const legacyWorkoutBody = legacyWorkoutFunction?.match(/AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/)?.[1].replace(/\s+/g, " ").trim();
    const reviewedWorkoutSignature = V4_REPUBLICATION_MANIFEST.requiredObjectSignatureIncludes["function:physiology_v7_workout_source_trigger()"];
    const reviewedWorkoutBody = reviewedWorkoutSignature.match(/AS \$function\$([\s\S]*?)\$function\$/)?.[1].replace(/\s+/g, " ").trim();
    expect(legacyWorkoutBody, "legacy Workout invalidation function body").toBeTruthy();
    expect(reviewedWorkoutBody).toBe(legacyWorkoutBody);

    const legacyWorkoutObjects = [
      "function:physiology_v7_workout_source_trigger()",
      "trigger:Workout.Workout_v7_invalidate_insert_delete",
      "trigger:Workout.Workout_v7_invalidate_update",
    ];
    for (const name of legacyWorkoutObjects) {
      expect(V4_REPUBLICATION_MANIFEST.requiredObjectsBefore).toContain(name);
      expect(V4_REPUBLICATION_MANIFEST.postflightObjects).toContain(name);

      const missingBaselineObject = structuredClone(report);
      const missingObject = missingBaselineObject.objects.find((object) => object.name === name);
      missingObject.present = false;
      missingObject.signature = null;
      expect(evaluateProductionPreflight(missingBaselineObject, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
        .toContain(name);

      const driftedBaselineObject = structuredClone(report);
      const driftedObject = driftedBaselineObject.objects.find((object) => object.name === name);
      driftedObject.signature = name.startsWith("trigger:")
        ? driftedObject.signature.replace("enabled=O", "enabled=D")
        : driftedObject.signature.replace("physiology_v7_invalidate(1, affected)", "physiology_v7_invalidate(2, affected)");
      expect(evaluateProductionPreflight(driftedBaselineObject, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
        .toContain("pre-migration schema signatures differ");
    }

    const missingTrainingDateHelper = structuredClone(report);
    const trainingDateHelper = missingTrainingDateHelper.objects.find((object) => object.name === "function:physiology_v7_training_date(integer)");
    trainingDateHelper.present = false;
    trainingDateHelper.signature = null;
    expect(evaluateProductionPreflight(missingTrainingDateHelper, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("pre-migration schema signatures differ");

    const partiallyAppliedTrainingModelDate = structuredClone(report);
    const trainingModelDate = partiallyAppliedTrainingModelDate.objects.find((object) => object.name === "function:physiology_v7_training_model_date(integer, integer, timestamp with time zone, timestamp with time zone, timestamp with time zone)");
    trainingModelDate.present = true;
    trainingModelDate.signature = V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[trainingModelDate.name];
    expect(evaluateProductionPreflight(partiallyAppliedTrainingModelDate, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("Prior migration output objects should be absent");

    const partiallyAppliedModelDate = structuredClone(report);
    const modelDate = partiallyAppliedModelDate.objects.find((object) => object.name === "function:physiology_v7_model_date(integer, timestamp with time zone)");
    modelDate.present = true;
    modelDate.signature = V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[modelDate.name];
    expect(evaluateProductionPreflight(partiallyAppliedModelDate, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("Prior migration output objects should be absent");

    const partiallyAppliedWorkoutTrigger = structuredClone(report);
    const workoutTrigger = partiallyAppliedWorkoutTrigger.objects.find((object) => object.name === "trigger:Workout.Workout_v7_invalidate");
    workoutTrigger.present = true;
    workoutTrigger.signature = V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[workoutTrigger.name];
    expect(evaluateProductionPreflight(partiallyAppliedWorkoutTrigger, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("Prior migration output objects should be absent");

    const partiallyAppliedWorkoutDeleteTrigger = structuredClone(report);
    const workoutDeleteTrigger = partiallyAppliedWorkoutDeleteTrigger.objects.find((object) => object.name === "trigger:Workout.Workout_v7_invalidate_matched_delete");
    workoutDeleteTrigger.present = true;
    workoutDeleteTrigger.signature = V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[workoutDeleteTrigger.name];
    expect(evaluateProductionPreflight(partiallyAppliedWorkoutDeleteTrigger, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("Prior migration output objects should be absent");

    const driftedInvalidateHelper = structuredClone(report);
    const invalidateHelper = driftedInvalidateHelper.objects.find((object) => object.name === "function:physiology_v7_invalidate(integer, character varying)");
    invalidateHelper.signature = invalidateHelper.signature.replace("invalidationGeneration\" = \"PhysiologyV7Lifecycle\".\"invalidationGeneration\" + 1", "invalidationGeneration\" = 0");
    expect(evaluateProductionPreflight(driftedInvalidateHelper, fullDirs, V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("pre-migration schema signatures differ");

    expect(evaluateProductionPreflight(report, [...fullDirs, "20261012120000_unreviewed"], V4_REPUBLICATION_MANIFEST.id).blockers.join(" "))
      .toContain("Full release-tree pending set differs");
  });

  it("admits only the exact programless-workout and separately reviewed Health queue release set", async () => {
    const report = validDynamicWorkoutPreflightReport();
    const result = evaluateProductionPreflight(report, dynamicWorkoutDirs, DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id);
    expect(result.readyForOwnerAuthorization, result.blockers.join(" | ")).toBe(true);
    expect(result.pending).toEqual(DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.migrations.map(({ name }) => name).sort());
    expect(DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredAppliedMigrations).toHaveLength(dynamicWorkoutDirs.length - 2);
    expect(DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requireCompleteReleaseTree).toBe(true);
    expect(DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.cutbackSupported).toBe(true);
    expect(DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.migrations.map(({ sha256 }) => sha256)).toEqual([
      "4e63b16fbb2950666489c591cc6586ba9a35a0c0a1ed595a51309c37786f9b49",
      "6e07af8484ee10cda3cea5f06db19ec1286cb41ff40da8c05166c3cf7d90c991",
    ]);

    const extraPending = evaluateProductionPreflight(report, [...dynamicWorkoutDirs, "20261015110000_unreviewed"],
      DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id);
    expect(extraPending.blockers.join(" ")).toContain("Full release-tree pending set differs");
    const missingMigration = evaluateProductionPreflight(report,
      dynamicWorkoutDirs.filter((name) => name !== DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.migrations[1].name),
      DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id);
    expect(missingMigration.blockers.join(" ")).toContain("Full release-tree pending set differs");
    expect(missingMigration.blockers.join(" ")).toContain("Reviewed manifest migrations are missing");

    const omittedPredecessorDirectory = dynamicWorkoutDirs.filter((name) =>
      name !== DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredAppliedMigrations[0].name);
    expect(evaluateProductionPreflight(report, omittedPredecessorDirectory,
      DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id).blockers.join(" "))
      .toContain("do not cover the complete release migration tree exactly");

    const missingPredecessor = structuredClone(report);
    missingPredecessor.migrations = missingPredecessor.migrations.filter((row) =>
      row.name !== DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredAppliedMigrations[0].name);
    expect(evaluateProductionPreflight(missingPredecessor, dynamicWorkoutDirs,
      DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id).blockers.join(" ")).toContain("Required prior migration");
    const changedPredecessor = structuredClone(report);
    changedPredecessor.migrations[0].checksum = "0".repeat(64);
    expect(evaluateProductionPreflight(changedPredecessor, dynamicWorkoutDirs,
      DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id).blockers.join(" ")).toContain("checksum differs");

    const partialQueue = structuredClone(report);
    partialQueue.objects.find((object) => object.name === "HealthSyncRefreshJob").present = true;
    expect(evaluateProductionPreflight(partialQueue, dynamicWorkoutDirs,
      DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id).blockers.join(" ")).toContain("already exist while the exact migration set is pending");
    const changedOldSchema = structuredClone(report);
    changedOldSchema.objects.find((object) => object.name === "StrengthDiarySession.programId").signature = "integer|nullable=true|default=";
    expect(evaluateProductionPreflight(changedOldSchema, dynamicWorkoutDirs,
      DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id).blockers.join(" ")).toContain("pre-migration schema signatures differ");
    const missingProgramForeignKey = structuredClone(report);
    missingProgramForeignKey.objects.find((object) => object.name === "StrengthDiarySession_programId_fkey").present = false;
    expect(evaluateProductionPreflight(missingProgramForeignKey, dynamicWorkoutDirs,
      DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id).blockers.join(" ")).toContain("pre-migration schema objects are missing");
    const changedProgramVersionForeignKey = structuredClone(report);
    changedProgramVersionForeignKey.objects.find((object) => object.name === "StrengthDiarySession_programVersionId_fkey").signature += " NOT VALID";
    expect(evaluateProductionPreflight(changedProgramVersionForeignKey, dynamicWorkoutDirs,
      DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id).blockers.join(" ")).toContain("exact pre-migration schema signatures differ");

    const post = validDynamicWorkoutPreflightReport({ applied: true });
    post.identity = { ...post.identity, database: "bodycast_restore", databaseOid: 16385, role: "bodycast_restore", serverAddress: "172.20.0.3" };
    const postflight = evaluateProductionPostflight(post, dynamicWorkoutDirs, DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id,
      { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" });
    expect(postflight.ready).toBe(true);
    const changedProgramForeignKey = structuredClone(post);
    changedProgramForeignKey.objects.find((object) => object.name === "StrengthDiarySession_programId_fkey").signature += " OR TRUE";
    expect(evaluateProductionPostflight(changedProgramForeignKey, dynamicWorkoutDirs, DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id,
      { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" }).blockers.join(" "))
      .toContain("exact reviewed contract");
    const wrongQueueSignature = structuredClone(post);
    wrongQueueSignature.objects.find((object) => object.name === "HealthSyncRefreshJob_profileId_fkey").signature += " OR TRUE";
    expect(evaluateProductionPostflight(wrongQueueSignature, dynamicWorkoutDirs, DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id,
      { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" }).blockers.join(" "))
      .toContain("Postflight schema signatures differ");
    const changedTargetChecksum = structuredClone(post);
    changedTargetChecksum.migrations.find((row) => row.name === DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.migrations[0].name).checksum = "0".repeat(64);
    expect(evaluateProductionPostflight(changedTargetChecksum, dynamicWorkoutDirs, DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id,
      { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" }).blockers.join(" ")).toContain("checksum differs");

    expect(evaluateProductionPreflight(validPreflightReport(), dirs).readyForOwnerAuthorization).toBe(true);
    expect(evaluateProductionPreflight(validV4RepublicationPreflightReport(), fullDirs, V4_REPUBLICATION_MANIFEST.id)
      .readyForOwnerAuthorization).toBe(true);
    for (const migration of DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.migrations) {
      expect((await verifyManifestBlob({ repositoryPath: process.cwd(), releaseSha: execFileSync("git", ["rev-parse", "HEAD"],
        { cwd: process.cwd(), encoding: "utf8" }).trim(), migration })).matchesManifest).toBe(true);
    }
  });

  it("admits only the complete Training ledger/queue migration set and exact postflight schema", async () => {
    expect(TRAINING_MUTATION_LEDGER_MANIFEST.requireCompleteReleaseTree).toBe(true);
    expect(TRAINING_MUTATION_LEDGER_MANIFEST.cutbackSupported).toBe(false);
    expect(TRAINING_MUTATION_LEDGER_MANIFEST.requiredAppliedMigrations.map(({ name }) => name)).toEqual(
      DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredAppliedMigrations.map(({ name }) => name),
    );
    expect(TRAINING_MUTATION_LEDGER_MANIFEST.migrations.map(({ name }) => name)).toEqual([
      "20261015090000_programless_dynamic_sessions",
      "20261015100000_health_sync_durable_refresh_queue",
      "20261016120000_training_mutation_ledger_queue",
      "20261016130000_training_rejected_set_create_operations",
      "20261016140000_training_refresh_publication_block_keys",
      "20261017120000_add_five_training_exercises",
      "20261017130000_stepper_operation_recovery",
      "20261017140000_active_energy_convergence_fence",
      "20261017150000_active_energy_convergence_owner_lease",
    ]);
    expect(TRAINING_MUTATION_LEDGER_MANIFEST.requiredAppliedMigrations).toHaveLength(65);
    expect(evaluateProductionMigrationTree(trainingMutationLedgerDirs, TRAINING_MUTATION_LEDGER_MANIFEST.id).ready).toBe(true);
    const treeWithUnreviewedMigration = evaluateProductionMigrationTree(
      [...trainingMutationLedgerDirs, "20261018120000_unreviewed_migration"],
      TRAINING_MUTATION_LEDGER_MANIFEST.id,
    );
    expect(treeWithUnreviewedMigration.ready).toBe(false);
    expect(treeWithUnreviewedMigration.blockers.join(" ")).toContain("complete release migration tree exactly");
    const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
    for (const migration of TRAINING_MUTATION_LEDGER_MANIFEST.migrations) {
      const blob = await verifyManifestBlob({ repositoryPath: process.cwd(), releaseSha, migration });
      expect(blob.matchesManifest, migration.name).toBe(true);
    }

    const report = validTrainingMutationLedgerPreflightReport();
    for (const name of [
      "UnifiedPublicationBlock.ownerToken",
      "UnifiedPublicationBlock.ownerLeaseUntil",
      "UnifiedPublicationBlock_ownerLeaseUntil_idx",
    ]) {
      expect(report.objects.find((object) => object.name === name)).toMatchObject({ present: false, signature: null });
    }
    expect(report.objects.find((object) => object.name === "UnifiedPublicationBlock_source_check")?.signature)
      .toBe(TRAINING_MUTATION_LEDGER_MANIFEST.requiredObjectSignatureEquals.UnifiedPublicationBlock_source_check);
    const preflight = evaluateProductionPreflight(report, trainingMutationLedgerDirs, TRAINING_MUTATION_LEDGER_MANIFEST.id);
    expect(preflight.readyForOwnerAuthorization, preflight.blockers.join(" | ")).toBe(true);
    expect(preflight.pending).toEqual(TRAINING_MUTATION_LEDGER_MANIFEST.migrations.map(({ name }) => name).sort());

    const programlessAlreadyApplied = validDynamicWorkoutPreflightReport({ applied: true });
    const splitRelease = evaluateProductionPreflight(programlessAlreadyApplied, trainingMutationLedgerDirs,
      TRAINING_MUTATION_LEDGER_MANIFEST.id);
    expect(splitRelease.readyForOwnerAuthorization).toBe(false);
    expect(splitRelease.blockers.join(" ")).toContain("Full release-tree pending set differs");
    expect(splitRelease.blockers.join(" ")).toContain("Migration output objects already exist");

    const missingDirectory = evaluateProductionPreflight(report,
      trainingMutationLedgerDirs.filter((name) => name !== TRAINING_MUTATION_LEDGER_MANIFEST.migrations[2].name),
      TRAINING_MUTATION_LEDGER_MANIFEST.id);
    expect(missingDirectory.blockers.join(" ")).toContain("Reviewed manifest migrations are missing");
    const partialLedger = structuredClone(report);
    partialLedger.objects.find((object) => object.name === "TrainingSetCreateOperation").present = true;
    expect(evaluateProductionPreflight(partialLedger, trainingMutationLedgerDirs,
      TRAINING_MUTATION_LEDGER_MANIFEST.id).blockers.join(" "))
      .toContain("already exist while the exact migration set is pending");

    const post = validTrainingMutationLedgerPreflightReport({ applied: true });
    post.identity = { ...post.identity, database: "bodycast_restore", databaseOid: 16385, role: "bodycast_restore", serverAddress: "172.20.0.3" };
    const postflight = evaluateProductionPostflight(post, trainingMutationLedgerDirs,
      TRAINING_MUTATION_LEDGER_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" });
    expect(postflight.ready, postflight.blockers.join(" | ")).toBe(true);
    expect(post.objects.find((object) => object.name === "UnifiedPublicationBlock_source_check")?.signature)
      .toBe(TRAINING_MUTATION_LEDGER_MANIFEST.postflightSignatureEquals.UnifiedPublicationBlock_source_check);

    const changedRejectedCheck = structuredClone(post);
    changedRejectedCheck.objects.find((object) => object.name === "TrainingSetCreateOperation_result_check").signature += " OR TRUE";
    expect(evaluateProductionPostflight(changedRejectedCheck, trainingMutationLedgerDirs,
      TRAINING_MUTATION_LEDGER_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" }).blockers.join(" "))
      .toContain("exact reviewed contract");
    const changedStepperIndex = structuredClone(post);
    changedStepperIndex.objects.find((object) => object.name === "StepperCreateOperation_profileId_workoutId_idx").signature += " WHERE TRUE";
    expect(evaluateProductionPostflight(changedStepperIndex, trainingMutationLedgerDirs,
      TRAINING_MUTATION_LEDGER_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" }).blockers.join(" "))
      .toContain("exact reviewed contract");
    const changedMigrationChecksum = structuredClone(post);
    changedMigrationChecksum.migrations.find((row) => row.name === TRAINING_MUTATION_LEDGER_MANIFEST.migrations[1].name).checksum = "0".repeat(64);
    expect(evaluateProductionPostflight(changedMigrationChecksum, trainingMutationLedgerDirs,
      TRAINING_MUTATION_LEDGER_MANIFEST.id, { expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore" }).blockers.join(" "))
      .toContain("checksum differs");
  });

  it.each([
    ["an unstarted history row", { startedAt: null, finishedAt: null, rolledBackAt: null }],
    ["a malformed history row", { startedAt: "not-a-timestamp", finishedAt: null, rolledBackAt: null }],
  ])("fails closed when a pending V4 migration has %s", (_label, timestamps) => {
    const report = validV4RepublicationPreflightReport();
    report.migrations.push({
      ...migrationRow(V4_REPUBLICATION_MANIFEST.migrations[0]),
      ...timestamps,
    });
    const result = evaluateProductionPreflight(report, fullDirs, V4_REPUBLICATION_MANIFEST.id);
    expect(result.pending).toEqual(V4_REPUBLICATION_MANIFEST.migrations.map(({ name }) => name).sort());
    expect(result.readyForOwnerAuthorization).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/pending manifest migration.*history rows|unknown or malformed execution state/i);
  });

  it("requires the new postflight schema/functions and exact checksums after the two migrations", () => {
    const post = validV4RepublicationPreflightReport();
    post.identity = { ...post.identity, database: "bodycast_restore", databaseOid: 16385, role: "bodycast_restore", serverAddress: "172.20.0.3" };
    post.migrations.push(...V4_REPUBLICATION_MANIFEST.migrations.map((migration) => migrationRow(migration)));
    post.objects = schemaObjects("v4-after");
    const result = evaluateProductionPostflight(post, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
      expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
    });
    expect(result.ready).toBe(true);

    const publicationSource = post.objects.find((object) => object.name === "UnifiedPublicationBlock_source_check");
    const sourceSignature = V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes[publicationSource.name];
    publicationSource.kind = "constraint";
    publicationSource.signature = sourceSignature.replaceAll("'::character varying", "'::character varying::text").replace("]::text[]))", "]))");
    expect(evaluateProductionPostflight(post, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
      expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
    })).toMatchObject({ ready: true, blockers: [] });

    const changedPublicationSource = structuredClone(post);
    const changedConstraint = changedPublicationSource.objects.find((object) => object.name === "UnifiedPublicationBlock_source_check");
    changedConstraint.signature = changedConstraint.signature.replace("'stepper'", "'unexpected'");
    expect(evaluateProductionPostflight(changedPublicationSource, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
      expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
    }).blockers.join(" ")).toContain("schema signatures differ");

    const disabledTrigger = structuredClone(post);
    disabledTrigger.objects.find((object) => object.name === "trigger:StrengthSet.StrengthSet_v7_invalidate").signature = "enabled=D|function=physiology_v7_session_child_source_trigger";
    expect(evaluateProductionPostflight(disabledTrigger, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
      expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
    }).blockers.join(" ")).toContain("schema signatures differ");

    const changedTriggerEvent = structuredClone(post);
    const completedSessionTrigger = changedTriggerEvent.objects.find((object) => object.name === "trigger:StrengthDiarySession.StrengthDiarySession_v7_invalidate");
    completedSessionTrigger.signature = completedSessionTrigger.signature.replace("AFTER INSERT OR DELETE OR UPDATE", "AFTER INSERT OR UPDATE");
    expect(evaluateProductionPostflight(changedTriggerEvent, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
      expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
    }).blockers.join(" ")).toContain("schema signatures differ");

    const changedFunctionControlFlow = structuredClone(post);
    const sessionFunction = changedFunctionControlFlow.objects.find((object) => object.name === "function:physiology_v7_session_source_trigger()");
    sessionFunction.signature = sessionFunction.signature.replace(
      "IF NOT old_completed AND NOT new_completed THEN RETURN COALESCE(NEW, OLD); END IF;",
      "IF false THEN RETURN COALESCE(NEW, OLD); END IF;",
    );
    expect(evaluateProductionPostflight(changedFunctionControlFlow, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
      expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
    }).blockers.join(" ")).toContain("schema signatures differ");

    const missingModelDateHelper = structuredClone(post);
    const modelDateHelper = missingModelDateHelper.objects.find((object) => object.name === "function:physiology_v7_model_date(integer, timestamp with time zone)");
    modelDateHelper.present = false;
    modelDateHelper.signature = null;
    expect(evaluateProductionPostflight(missingModelDateHelper, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
      expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
    }).blockers.join(" ")).toContain("schema objects are missing");

    const driftedTrainingDate = structuredClone(post);
    const trainingDate = driftedTrainingDate.objects.find((object) => object.name === "function:physiology_v7_training_date(integer)");
    trainingDate.signature = trainingDate.signature.replace("physiology_v7_training_model_date", "physiology_v7_model_date");
    expect(evaluateProductionPostflight(driftedTrainingDate, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
      expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
    }).blockers.join(" ")).toContain("schema signatures differ");

    const missingWorkoutTrigger = structuredClone(post);
    const workoutTrigger = missingWorkoutTrigger.objects.find((object) => object.name === "trigger:Workout.Workout_v7_invalidate");
    workoutTrigger.present = false;
    workoutTrigger.signature = null;
    expect(evaluateProductionPostflight(missingWorkoutTrigger, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
      expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
    }).blockers.join(" ")).toContain("schema objects are missing");

    const missingWorkoutDeleteTrigger = structuredClone(post);
    const workoutDeleteTrigger = missingWorkoutDeleteTrigger.objects.find((object) => object.name === "trigger:Workout.Workout_v7_invalidate_matched_delete");
    workoutDeleteTrigger.present = false;
    workoutDeleteTrigger.signature = null;
    expect(evaluateProductionPostflight(missingWorkoutDeleteTrigger, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
      expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
    }).blockers.join(" ")).toContain("schema objects are missing");

    for (const name of [
      "function:physiology_v7_workout_source_trigger()",
      "trigger:Workout.Workout_v7_invalidate_insert_delete",
      "trigger:Workout.Workout_v7_invalidate_update",
    ]) {
      const missingLegacyObject = structuredClone(post);
      const missingObject = missingLegacyObject.objects.find((object) => object.name === name);
      missingObject.present = false;
      missingObject.signature = null;
      expect(evaluateProductionPostflight(missingLegacyObject, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
        expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
      }).blockers.join(" ")).toContain(name);

      const driftedLegacyObject = structuredClone(post);
      const driftedObject = driftedLegacyObject.objects.find((object) => object.name === name);
      driftedObject.signature = name.startsWith("trigger:")
        ? driftedObject.signature.replace("enabled=O", "enabled=D")
        : driftedObject.signature.replace("physiology_v7_invalidate(1, affected)", "physiology_v7_invalidate(2, affected)");
      expect(evaluateProductionPostflight(driftedLegacyObject, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
        expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
      }).blockers.join(" ")).toContain("schema signatures differ");
    }

    const wrongMigrationChecksum = structuredClone(post);
    wrongMigrationChecksum.migrations.find((row) => row.name === V4_REPUBLICATION_MANIFEST.migrations[0].name).checksum = "f".repeat(64);
    expect(evaluateProductionPostflight(wrongMigrationChecksum, fullDirs, V4_REPUBLICATION_MANIFEST.id, {
      expectedDatabase: "bodycast_restore", expectedRole: "bodycast_restore",
    }).blockers.join(" ")).toContain("checksum differs");
  });

  it("keeps the complete object inventory synchronized with the SQL renderer", async () => {
    const template = await readFile(new URL("../scripts/production-db-preflight.sql", import.meta.url), "utf8");
    const sql = renderProductionDbPreflightSql(template);
    const normalizedSql = sql.replaceAll("\r\n", "\n");
    const expected = getExpectedSchemaObjectNames();
    expect(expected).toEqual([...ALL_REVIEWED_OBJECTS].sort());
    expect(sql).not.toContain("__EXPECTED_SCHEMA_OBJECTS_JSON__");
    expect(sql).toContain("BEGIN READ ONLY;");
    expect(await readFile(new URL("../scripts/run-prisma-migrate-with-lock-timeout.mjs", import.meta.url), "utf8")).toContain("withPrismaLockTimeout(authorized.databaseUrl, 5000)");
    expect(await readFile(new URL("../scripts/production-db-target.sh", import.meta.url), "utf8")).toContain("default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000");
    expect(sql).toContain("PhysiologyV7Lifecycle");
    expect(sql).toContain("DailyModelState");
    expect(sql).toContain(JSON.stringify(ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredTablesBefore));
    expect(sql).toContain("host(inet_server_addr())");
    expect(sql).toContain("inet_server_port()");
    expect(sql).toContain("pg_get_functiondef(p.oid)");
    expect(sql).toContain("pg_get_triggerdef(t.oid, true)");
    expect(normalizedSql).toContain("p.oid = to_regprocedure(format('public.%s', substr(e.name, 10)))");
    expect(normalizedSql).not.toContain("p.proname = substr(e.name, 10)");
    expect(normalizedSql).not.toContain("p.pronargs = 0");
    expect(sql).toContain("t.tgenabled::text");
    expect(sql).toContain("function:");
    expect(sql).toContain("trigger:");
    expect(sql).toContain("'databaseOid', (SELECT oid::bigint FROM pg_database WHERE datname = current_database())");
    expect(sql).toContain("'clusterSystemIdentifier', (SELECT system_identifier::text FROM pg_control_system())");
    const prismaIdentityProbe = await readFile(new URL("../scripts/run-prisma-migrate-with-lock-timeout.mjs", import.meta.url), "utf8");
    expect(prismaIdentityProbe).toContain('(SELECT system_identifier::text FROM pg_control_system()) AS "clusterSystemIdentifier"');
    expect(prismaIdentityProbe).toContain('host(inet_server_addr()) AS "serverAddress"');
    expect(prismaIdentityProbe).not.toContain('inet_server_addr()::text AS "serverAddress"');
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
    report.preparedTransactions = [{ gid: "unrelated-prepared-xact", transaction: "2401", preparedAt: "2026-10-05T10:00:00Z", database: "bodycast" }];
    expect(evaluateProductionPreflight(report, dirs).readyForOwnerAuthorization).toBe(true);
    report.conflictingLocks = [{ pid: null, blockerType: "prepared-transaction", relation: "DailyModelState",
      mode: "RowExclusiveLock", granted: true, requiredLockMode: "AccessExclusiveLock" }];
    expect(evaluateProductionPreflight(report, dirs).blockers.join(" ")).toContain("conflict with the exact migration DDL");
    report.conflictingLocks = null;
    expect(evaluateProductionPreflight(report, dirs).blockers.join(" ")).toContain("lock inventory is unknown or malformed");
    report.conflictingLocks = [];
    report.preparedTransactions = [{ gid: "incomplete-prepared-xact", transaction: "2402", preparedAt: "invalid", database: "bodycast" }];
    expect(evaluateProductionPreflight(report, dirs).blockers.join(" ")).toContain("Prepared transaction state is unknown");
    report.preparedTransactions = null;
    expect(evaluateProductionPreflight(report, dirs).blockers.join(" ")).toContain("Prepared transaction state is unknown");
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
    const ciWorkflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const group = (workflow) => workflow.match(/^concurrency:\r?\n  group: ([^\r\n]+)\r?\n  cancel-in-progress: false/m)?.[1];
    expect(group(preflight)).toBe("bodycast-production-release");
    expect(group(migrate)).toBe(group(preflight));
    expect(group(deployWorkflow)).toBe(group(preflight));
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
    expect(deployWorkflow).not.toMatch(/^  workflow_run:\s*$/m);
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
    preflightResult.identity = {
      ...preflightResult.identity,
      serverAddress: `${liveReport.identity.serverAddress}/32`,
    };
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
      productionIdentityDigest: canonicalSha256(preflightResult.identity),
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
        objects: schemaObjects("old-after"),
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
    post.objects = schemaObjects("old-after");
    const verified = verifyDisposablePostflight(post, dirs);
    expect(verified.verified).toBe(true);
    expect(verified.postSchemaDigest).toMatch(/^[a-f0-9]{64}$/);
    post.objects[0].signature = "different";
    expect(verifyDisposablePostflight(post, dirs).verified).toBe(true);
    expect(verifyPostflightMatchesRestore(post, verified, dirs).ready).toBe(false);
    expect(schemaInventoryDigest(post.objects)).not.toBe(verified.postSchemaDigest);
  });

  it.skipIf(process.platform === "win32")("admits only an exact V4 base restore for isolated rehearsal, without production writer topology", async () => {
    const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
    const source = validV4RepublicationPreflightReport();
    const preflight = evaluateProductionPreflight(source, fullDirs, V4_REPUBLICATION_MANIFEST.id);
    preflight.blobIntegrity = [...STAGE_02_MANIFEST.migrations, ...ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations,
      ...V4_REPUBLICATION_MANIFEST.migrations].map(({ name, sha256 }) => ({
      name, expectedSha256: sha256, actualSha256: sha256, matches: true,
    }));
    const pending = V4_REPUBLICATION_MANIFEST.migrations.map(({ name }) => name).sort();
    const snapshot = {
      schemaVersion: 1, releaseSha, canonicalMainSha: releaseSha, manifestId: V4_REPUBLICATION_MANIFEST.id,
      report: source, preflightResult: preflight,
      preparationResult: {
        evidenceKind: "database-only-no-app-v1", preparationVerified: true, releaseSha,
        manifestId: V4_REPUBLICATION_MANIFEST.id, readyForOwnerAuthorization: false,
        ddlAuthorization: false, appRuntime: "unavailable", previousAppProvenance: null,
        rollbackReadiness: "unverified", pendingMigrationNames: pending,
        productionDatabaseContainerId: "b".repeat(64),
        pendingSetDigest: canonicalSha256(pending),
        databasePreflightResultDigest: canonicalSha256(preflight),
        productionIdentityDigest: canonicalSha256(source.identity),
        logicalDataFingerprint: source.logicalDataFingerprint,
      },
    };
    const restored = {
      ...source,
      identity: { ...source.identity, database: "bodycast_restore", databaseOid: 16385,
        role: "bodycast_restore", serverAddress: "172.20.0.3" },
      migrations: source.migrations.map((row) => ({ ...row })),
      objects: source.objects.map((row) => ({ ...row })),
      conflictingLocks: [], preparedTransactions: [],
    };
    const readability = { readability: Object.fromEntries(["Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle",
      "DailyModelState", "StrengthDiarySession", "ExerciseCatalog"].map((name) => [name, { rowCount: 0 }])) };
    const result = await verifyDisposableRehearsalAdmission({
      snapshot, restoredReport: restored, readabilityReport: readability,
      migrationDirectories: fullDirs, repositoryPath: process.cwd(), releaseSha,
      manifestId: V4_REPUBLICATION_MANIFEST.id,
    });
    expect(result, JSON.stringify(result.blockers)).toMatchObject({
      verified: true, verifiedForIsolatedRehearsal: true, readyForIsolatedRehearsal: true,
      ddlAuthorization: false, pending,
    });
    expect(result).not.toHaveProperty("readyForOwnerAuthorization");
    expect(result.executionIntegrity).toHaveLength(V4_REPUBLICATION_MANIFEST.migrations.length);
    expect(result.executionIntegrity.every((entry) => entry.exactMatch)).toBe(true);

    const invalidPreflight = {
      ...preflight,
      blobIntegrity: preflight.blobIntegrity.map((entry) => entry.name === pending[0]
        ? { ...entry, actualSha256: "0".repeat(64), matches: false }
        : entry),
    };
    const invalidSnapshot = {
      ...snapshot,
      preflightResult: invalidPreflight,
      preparationResult: { ...snapshot.preparationResult, databasePreflightResultDigest: canonicalSha256(invalidPreflight) },
    };
    const invalidBlobEvidence = await verifyDisposableRehearsalAdmission({
      snapshot: invalidSnapshot, restoredReport: restored, readabilityReport: readability,
      migrationDirectories: fullDirs, repositoryPath: process.cwd(), releaseSha,
      manifestId: V4_REPUBLICATION_MANIFEST.id,
    });
    expect(invalidBlobEvidence.verifiedForIsolatedRehearsal).toBe(false);
    expect(invalidBlobEvidence.blockers).toContain("Production snapshot does not prove the exact clean V4 pending set and source preflight state.");

    const unsafeRestore = { ...restored, conflictingLocks: [{ relation: "PhysiologyV7Lifecycle" }] };
    await expect(verifyDisposableRehearsalAdmission({
      snapshot, restoredReport: unsafeRestore, readabilityReport: readability,
      migrationDirectories: fullDirs, repositoryPath: process.cwd(), releaseSha,
      manifestId: V4_REPUBLICATION_MANIFEST.id,
    })).resolves.toMatchObject({ verified: false, readyForIsolatedRehearsal: false, ddlAuthorization: false });

    for (const preparedTransactions of [undefined, [{ gid: "unknown", blocksMigration: false }]]) {
      const unsafePreparedRestore = { ...restored, preparedTransactions };
      await expect(verifyDisposableRehearsalAdmission({
        snapshot, restoredReport: unsafePreparedRestore, readabilityReport: readability,
        migrationDirectories: fullDirs, repositoryPath: process.cwd(), releaseSha,
        manifestId: V4_REPUBLICATION_MANIFEST.id,
      })).resolves.toMatchObject({ verified: false, readyForIsolatedRehearsal: false, ddlAuthorization: false });
    }
  });

  it("reports sanitized per-object schema differences without exposing signature contents", () => {
    const source = validPreflightReport();
    const restored = { ...source, objects: source.objects.map((row) => ({ ...row })) };
    const target = source.objects.find((row) => row.present && typeof row.signature === "string");
    const targetIndex = source.objects.indexOf(target);
    const rawSignature = "CREATE FUNCTION private_bodycast_signature() RETURNS text AS $$sensitive-definition$$ LANGUAGE sql";
    restored.objects[targetIndex].signature = rawSignature;

    const diagnostic = schemaInventoryDifferenceSummary(source.objects, restored.objects, {
      sourceServerVersion: source.identity.serverVersion,
      restoredServerVersion: "17.12",
    });
    expect(diagnostic).toMatchObject({
      schemaVersion: 1,
      sourceServerVersion: "17.11",
      restoredServerVersion: "17.12",
      changedObjectCount: 1,
      changedObjects: [{ name: target.name, changedFields: ["signature"], normalizedSignaturesEqual: false }],
    });
    expect(diagnostic.changedObjects[0].sourceSignatureSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(diagnostic.changedObjects[0].restoredSignatureSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(diagnostic)).not.toContain(rawSignature);

    const unexpectedName = "unreviewed_private_table_name";
    const unknownObjectDiagnostic = schemaInventoryDifferenceSummary(
      [...source.objects, { name: unexpectedName, present: false, kind: "missing", signature: null }],
      source.objects,
    );
    expect(JSON.stringify(unknownObjectDiagnostic)).not.toContain(unexpectedName);
    expect(unknownObjectDiagnostic.sourceObjectCount).toBe(source.objects.length + 1);

    restored.objects[targetIndex].signature = `${target.signature.replaceAll(" ", "  ")} /* formatting-only */`;
    const formattingDiagnostic = schemaInventoryDifferenceSummary(source.objects, restored.objects);
    expect(formattingDiagnostic.changedObjects[0].normalizedSignaturesEqual).toBe(true);
  });

  it("reports only safe restore blockers to stderr when the workflow redirects its detailed result", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-restore-diagnostic-"));
    const source = validPreflightReport();
    const privateSignature = "CREATE FUNCTION private_restore_probe() RETURNS text AS $$synthetic-private-body$$ LANGUAGE sql";
    const target = source.objects.find((row) => row.present && typeof row.signature === "string");
    const targetIndex = source.objects.indexOf(target);
    const restored = {
      ...source,
      logicalDataFingerprint: "e".repeat(64),
      objects: source.objects.map((row, index) => ({ ...row, ...(index === targetIndex ? { signature: privateSignature } : {}) })),
    };
    const readability = { readability: Object.fromEntries(["Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog"].map((name) => [name, { rowCount: 0 }])) };
    const sourcePath = path.join(directory, "source.json");
    const restoredPath = path.join(directory, "restored.json");
    const readabilityPath = path.join(directory, "readability.json");
    try {
      await Promise.all([
        writeFile(sourcePath, JSON.stringify(source)),
        writeFile(restoredPath, JSON.stringify(restored)),
        writeFile(readabilityPath, JSON.stringify(readability)),
      ]);
      const run = spawnSync(process.execPath, [
        path.resolve("scripts/production-migration-restore-check.mjs"), "--base",
        "--source", sourcePath, "--restored", restoredPath, "--readability", readabilityPath,
      ], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });

      expect(run.error).toBeUndefined();
      expect(run.status).toBe(1);
      expect(JSON.parse(run.stdout).verified).toBe(false);
      expect(run.stderr).toContain("categories=data-fingerprint,schema-inventory");
      expect(run.stderr).toContain("Sanitized schema inventory differences:");
      expect(run.stderr).toContain(target.name);
      expect(run.stderr).not.toContain("Restored public-table rows");
      expect(run.stderr).not.toContain("e".repeat(64));
      expect(run.stderr).not.toContain(privateSignature);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports sanitized preflight blockers to stderr when the workflow redirects its result", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bodycast-preflight-diagnostic-"));
    const report = validV4RepublicationPreflightReport();
    report.identity.database = "unexpected-database";
    const injectedMigrationName = "unexpected\n::add-mask::database-controlled-value";
    report.migrations.push(migrationRow({ name: injectedMigrationName, sha256: "f".repeat(64) }));
    const reportPath = path.join(directory, "preflight.json");
    try {
      await writeFile(reportPath, JSON.stringify(report));
      const run = spawnSync(process.execPath, [
        path.resolve("scripts/production-migration-preflight.mjs"), "--preflight",
        "--manifest", V4_REPUBLICATION_MANIFEST.id,
        "--release-sha", "fe55468321b9ef8e9783aa3874e1b42c2736b514",
        "--repository", process.cwd(), "--report", reportPath,
      ], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });

      expect(run.error).toBeUndefined();
      expect(run.status).toBe(1);
      expect(JSON.parse(run.stdout).readyForOwnerAuthorization).toBe(false);
      expect(run.stderr).toContain("blocker-count=");
      expect(run.stderr).toContain("categories=database-identity,database-locks,migration-history");
      expect(run.stderr).not.toContain("Connected database/role identity");
      expect(run.stderr).not.toContain(injectedMigrationName);
      expect(run.stderr).not.toContain("::add-mask::");
      expect(run.stderr).not.toContain("d".repeat(64));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("binds the post-DDL raw source to the signed pre-DDL backup and owner DDL authorization", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const keyId = "synthetic-v4-ddl-source-key";
    const allowlist = { schemaVersion: 1, keys: [{ keyId, status: "active", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) }] };
    const preflightRunId = "38446768622";
    const logicalFingerprint = "a".repeat(64);
    const pending = V4_REPUBLICATION_MANIFEST.migrations.map(({ name }) => name).sort();
    const preflightResult = {
      readyForOwnerAuthorization: true, manifestId: V4_REPUBLICATION_MANIFEST.id,
      pending, logicalDataFingerprint: logicalFingerprint,
    };
    const restoreResult = { verified: true, logicalDataFingerprint: logicalFingerprint };
    const claims = {
      repository: "krustallik/body-model", workflowId: "456", workflowPath: ".github/workflows/production-migrate.yml",
      workflowRunId: "38447647403", workflowRunAttempt: 1, actorId: "126446430",
      releaseSha: "8b4a195e8afb67c0a913d0175a030e01cc665732", currentMainSha: "8b4a195e8afb67c0a913d0175a030e01cc665732",
      manifestId: V4_REPUBLICATION_MANIFEST.id, pendingMigrationNames: pending, pendingSetDigest: canonicalSha256(pending),
      preflightRunId, preflightRunAttempt: 1, preflightRunStartedAt: "2026-10-13T17:00:00.000Z",
      preflightResultDigest: canonicalSha256(preflightResult), backupArtifactId: "500",
      backupArtifactDigest: "b".repeat(64), backupSnapshotAt: "2026-10-13T17:05:00.000Z",
      restoreResultDigest: canonicalSha256(restoreResult), productionIdentityDigest: "c".repeat(64),
      writerDrainDigest: "d".repeat(64), writerTopologyDigest: "e".repeat(64),
      issuedAt: "2026-10-13T17:10:00.000Z", expiresAt: "2026-10-13T18:10:00.000Z",
      authorizationId: "synthetic-v4-authorization-2026", nonce: randomUUID(), snapshotDataFingerprint: logicalFingerprint,
    };
    const authorizationEnvelope = createAuthorizationEnvelope(claims, {
      keyId, privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }), allowlist,
    });
    const preflightEvidence = {
      verified: true, repository: "krustallik/body-model", workflowPath: ".github/workflows/production-migration-preflight.yml",
      workflowRunId: preflightRunId, workflowRunAttempt: 1, releaseSha: claims.releaseSha,
      manifestId: claims.manifestId, preflightResultDigest: claims.preflightResultDigest,
      restoreResultDigest: claims.restoreResultDigest, logicalDataFingerprint: logicalFingerprint,
    };
    const backupArtifactMetadata = {
      id: "500", digest: `sha256:${claims.backupArtifactDigest}`, expired: false,
      name: `bodycast-backup-${claims.releaseSha}-${claims.manifestId}-${preflightRunId}-1`,
      workflowRunId: preflightRunId, workflowRunAttempt: 1, headSha: claims.releaseSha,
      authorizationRunId: claims.workflowRunId, authorizationRunAttempt: 1, authorizationWorkflowId: claims.workflowId,
    };
    const migrationRun = {
      id: claims.workflowRunId, runAttempt: "1", actorId: claims.actorId,
      workflowId: claims.workflowId, workflowPath: claims.workflowPath, headSha: claims.releaseSha,
      conclusion: "success", event: "workflow_dispatch",
    };
    const binding = assertPreDdlRecoverySource({
      authorizationEnvelope, preflightEvidence, preflightResult, restoreResult, backupArtifactMetadata,
      migrationRun, allowlist,
    });
    expect(binding).toMatchObject({ verified: true, ddlAuthorization: false, backupArtifactId: "500", preDdlLogicalDataFingerprint: logicalFingerprint });

    const preflightRun = {
      id: preflightRunId, run_attempt: 1, workflow_id: "789",
      path: ".github/workflows/production-migration-preflight.yml@refs/heads/main",
      event: "workflow_dispatch", head_branch: "main", head_sha: claims.releaseSha,
      status: "completed", conclusion: "success", actor: { id: 126446430 },
      repository: { id: 1342150263, full_name: "krustallik/body-model" },
    };
    const apiArtifact = {
      id: 500, name: backupArtifactMetadata.name, digest: backupArtifactMetadata.digest, expired: false,
      workflow_run: { id: Number(preflightRunId), head_branch: "main", head_sha: claims.releaseSha, repository_id: 1342150263 },
    };
    expect(assertPreDdlBackupArtifactMetadata(binding, apiArtifact, preflightRun)).toBe(true);
    expect(() => assertPreDdlRecoverySource({
      authorizationEnvelope, preflightEvidence, preflightResult: { ...preflightResult, logicalDataFingerprint: "f".repeat(64) },
      restoreResult, backupArtifactMetadata, migrationRun, allowlist,
    })).toThrow(/pre-DDL snapshot fingerprint/);
    expect(() => assertPreDdlRecoverySource({
      authorizationEnvelope, preflightEvidence, preflightResult, restoreResult,
      backupArtifactMetadata: { ...backupArtifactMetadata, digest: `sha256:${"f".repeat(64)}` }, migrationRun, allowlist,
    })).toThrow(/artifact identity or digest/);
    expect(() => assertPreDdlBackupArtifactMetadata(binding, { ...apiArtifact, expired: true }, preflightRun))
      .toThrow(/missing, expired, or substituted/);
    expect(() => assertPreDdlBackupArtifactMetadata(binding, apiArtifact, { ...preflightRun, actor: { id: 1 } }))
      .toThrow(/owner-authorized preflight/);
  });

  it("binds post-DDL V4 backup, restore, and epoch-1 rehearsal without granting DDL authorization", () => {
    const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const migrationOriginSha = "8b4a195e8afb67c0a913d0175a030e01cc665732";
    const report = validV4RepublicationPreflightReport();
    report.migrations.push(...V4_REPUBLICATION_MANIFEST.migrations.map((migration) => migrationRow(migration)));
    report.objects = schemaObjects("v4-after");
    report.logicalDataFingerprint = "a".repeat(64);
    report.v4ReplayStableStateFingerprint = "a".repeat(64);
    const observedAt = new Date().toISOString();
    report.writerDrain = readyWriterDrain();
    report.writerDrain.observedAt = observedAt;
    report.writerDrain.topology.observedAt = observedAt;
    report.conflictingLocks = [];
    report.preparedTransactions = [];
    report.longTransactions = [];
    const migrationRun = {
      id: "38447647403", runAttempt: "1", headSha: migrationOriginSha,
      workflowPath: ".github/workflows/production-migrate.yml", actorId: "126446430",
      conclusion: "success", event: "workflow_dispatch",
    };
    const lifecycleInspection = JSON.stringify({
      command: "unified-v4-activate-replay", profileId: 1, state: "v4-replayable",
    });
    const normalizedLifecycle = spawnSync(process.execPath, [
      path.resolve("scripts/production-v4-recovery.mjs"), "--normalize-lifecycle-inspection",
    ], { input: lifecycleInspection, encoding: "utf8" });
    expect(normalizedLifecycle.status).toBe(0);
    const snapshot = {
      schemaVersion: 1, manifestId: V4_REPUBLICATION_MANIFEST.id, releaseSha,
      canonicalMainSha: releaseSha, databaseContainerId: "1".repeat(64),
      databaseImageId: "2".repeat(64), appImageId: "3".repeat(64),
      markerDigest: "4".repeat(64), routeDigest: "5".repeat(64),
      v4ReplayInputFingerprint: "6".repeat(64), preDdlReplayInputFingerprint: "6".repeat(64), pgDumpVersion: "pg_dump (PostgreSQL) 17.11",
      v4ReplayStableStateFingerprint: "a".repeat(64),
      pgRestoreVersion: "pg_restore (PostgreSQL) 17.11", lifecycleState: normalizedLifecycle.stdout.trim(),
      migrationDirectories: fullDirs, report,
      marker: {
        schemaVersion: 3, manifestId: V4_REPUBLICATION_MANIFEST.id, migrationOriginSha,
        deploySha: releaseSha, state: "app-ready", workflowRunId: migrationRun.id,
        workflowRunAttempt: migrationRun.runAttempt, authorizationId: "authorization-fixture-v4-2026",
        lineageDigest: "7".repeat(64), sourceMarkerDigest: "8".repeat(64), compatibilityDigest: "9".repeat(64),
      },
      v4Lifecycle: {
        profileId: 1,
        invalidationGeneration: 16039,
        productionPublishedGeneration: 16039,
        productionStaleFromDate: null,
        unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
        unifiedRolloutEpoch: 1,
        unifiedPublishedRolloutEpoch: null,
        unifiedPublishedGeneration: null,
        unifiedPublicationBlockedFromDate: null,
      },
    };

    const validated = assertV4RecoverySnapshot(snapshot, { releaseSha, migrationRun, now: Date.now() });
    expect(validated).toMatchObject({ verified: true, ddlAuthorization: false, migrationRunId: "38447647403" });
    expect(validated.recoveryBinding).toMatchObject({ verified: true, ddlAuthorization: false, lifecycleState: "v4-replayable" });
    expect(assertV4ReplayBoundary(validated.recoveryBinding, validated.recoveryBinding, { phase: "before-replay" })).toBe(true);
    for (const invalidInspection of [
      JSON.stringify({ command: "wrong-command", profileId: 1, state: "v4-replayable" }),
      JSON.stringify({ command: "unified-v4-activate-replay", profileId: 2, state: "v4-replayable" }),
      JSON.stringify({ command: "unified-v4-activate-replay", profileId: 1, state: "v3-ready" }),
      JSON.stringify({ command: "unified-v4-activate-replay", profileId: 1, state: "v4-replayable", unexpected: true }),
      "not-json",
    ]) {
      const invalidResult = spawnSync(process.execPath, [
        path.resolve("scripts/production-v4-recovery.mjs"), "--normalize-lifecycle-inspection",
      ], { input: invalidInspection, encoding: "utf8" });
      expect(invalidResult.status).toBe(1);
      expect(invalidResult.stderr.trim()).toBe("BODYCAST_V4_SNAPSHOT_CHECK_FAILURE checks=lifecycle-command");
    }
    const mismatchedLifecycleSnapshot = structuredClone(snapshot);
    mismatchedLifecycleSnapshot.lifecycleState = "v4-current";
    expect(() => assertV4RecoverySnapshot(mismatchedLifecycleSnapshot, { releaseSha, migrationRun, now: Date.now() }))
      .toThrow(/V4 lifecycle command result differs/);
    expect(() => assertV4RecoverySnapshot(snapshot, {
      releaseSha, migrationRun: { ...migrationRun, id: "38447647404" }, now: Date.now(),
    })).toThrow(/does not bind to the successful pinned-owner V4 DDL run/);

    const replayedSnapshot = structuredClone(snapshot);
    replayedSnapshot.report.logicalDataFingerprint = "b".repeat(64);
    replayedSnapshot.v4ReplayStableStateFingerprint = "e".repeat(64);
    replayedSnapshot.lifecycleState = "v4-current";
    replayedSnapshot.v4Lifecycle.unifiedPublishedRolloutEpoch = 1;
    replayedSnapshot.v4Lifecycle.unifiedPublishedGeneration = replayedSnapshot.v4Lifecycle.invalidationGeneration;
    const replayedValidation = assertV4RecoverySnapshot(replayedSnapshot, { releaseSha, migrationRun, now: Date.now() });
    expect(() => assertV4ReplayBoundary(validated.recoveryBinding, replayedValidation.recoveryBinding, {
      phase: "before-replay",
    })).toThrow(/pre-replay production state/);
    expect(assertV4ReplayBoundary(validated.recoveryBinding, replayedValidation.recoveryBinding, {
      phase: "after-replay", expectedReplayStableStateFingerprint: "e".repeat(64),
      expectedReplayLifecycleDigest: replayedValidation.recoveryBinding.lifecycleDigest,
    })).toBe(true);
    expect(() => assertV4ReplayBoundary(validated.recoveryBinding, replayedValidation.recoveryBinding, {
      phase: "after-replay", expectedReplayStableStateFingerprint: "f".repeat(64),
    })).toThrow(/isolated V4 rehearsal result/);
    expect(() => assertV4ReplayBoundary(validated.recoveryBinding, replayedValidation.recoveryBinding, {
      phase: "after-replay", expectedReplayStableStateFingerprint: "e".repeat(64),
      expectedReplayLifecycleDigest: "f".repeat(64),
    })).toThrow(/isolated V4 rehearsal result/);
    expect(() => assertV4ReplayBoundary(replayedValidation.recoveryBinding, {
      ...replayedValidation.recoveryBinding,
      logicalDataFingerprint: "f".repeat(64),
    }, {
      phase: "after-replay", expectedReplayStableStateFingerprint: "e".repeat(64),
      expectedReplayLifecycleDigest: replayedValidation.recoveryBinding.lifecycleDigest,
    })).toThrow(/full logical-data fingerprint/);
    expect(() => assertV4ReplayBoundary({ ...validated.recoveryBinding, ddlAuthorization: true },
      replayedValidation.recoveryBinding, {
        phase: "after-replay", expectedReplayStableStateFingerprint: "e".repeat(64),
        expectedReplayLifecycleDigest: replayedValidation.recoveryBinding.lifecycleDigest,
      }))
      .toThrow(/incomplete, malformed, or has unknown fields/);

    const changedRouteSnapshot = structuredClone(snapshot);
    changedRouteSnapshot.routeDigest = "f".repeat(64);
    const changedRouteValidation = assertV4RecoverySnapshot(changedRouteSnapshot, { releaseSha, migrationRun, now: Date.now() });
    expect(() => assertV4ReplayBoundary(validated.recoveryBinding, changedRouteValidation.recoveryBinding, {
      phase: "before-replay",
    })).toThrow(/backup identity, schema, history, route, or raw-data binding/);

    for (const mutate of [
      (value) => { value.report.identity.database = "other"; },
      (value) => { value.report.conflictingLocks = null; },
      (value) => { value.report.preparedTransactions.push({ gid: "unexpected" }); },
      (value) => { value.marker.migrationOriginSha = "f".repeat(40); },
      (value) => { value.preDdlReplayInputFingerprint = "f".repeat(64); },
      (value) => { value.v4Lifecycle.unifiedRolloutEpoch = 0; },
      (value) => { value.v4ReplayStableStateFingerprint = "malformed"; },
    ]) {
      const changed = structuredClone(snapshot);
      mutate(changed);
      expect(() => assertV4RecoverySnapshot(changed, { releaseSha, migrationRun, now: Date.now() })).toThrow();
    }

    const after = structuredClone(snapshot);
    expect(assertStableV4RecoverySnapshots(snapshot, after)).toBe(true);
    after.report.logicalDataFingerprint = "f".repeat(64);
    expect(() => assertStableV4RecoverySnapshots(snapshot, after)).toThrow(/changed across the backup boundary/);

    const restoreResult = { verified: true, migrationCount: report.migrations.length };
    const postflightResult = { postflightReady: true, blockers: [], postSchemaDigest: schemaInventoryDigest(report.objects) };
    const rehearsal = {
      sourceSnapshot: snapshot,
      restoreResult,
      postflightResult,
      restoreReport: report,
      sourceRawFingerprint: snapshot.v4ReplayInputFingerprint,
      restoredRawFingerprintBefore: snapshot.v4ReplayInputFingerprint,
      restoredRawFingerprintAfter: snapshot.v4ReplayInputFingerprint,
      restoredRawFingerprintAfterRetry: snapshot.v4ReplayInputFingerprint,
      fullFingerprintBefore: report.logicalDataFingerprint,
      fullFingerprintAfter: "b".repeat(64),
      fullFingerprintAfterRetry: "c".repeat(64),
      replayStableStateFingerprintBefore: "a".repeat(64),
      replayStableStateFingerprintAfter: "e".repeat(64),
      replayStableStateFingerprintAfterRetry: "e".repeat(64),
      firstReplay: { rolloutEpoch: 1, dayCount: 365 },
      retryReplay: { rolloutEpoch: 1, dayCount: 365 },
      lifecycleAfter: {
        ...snapshot.v4Lifecycle,
        unifiedPublishedRolloutEpoch: 1,
        unifiedPublishedGeneration: 16039,
      },
    };
    expect(assertV4ReplayRehearsal(rehearsal)).toMatchObject({ verified: true, ddlAuthorization: false, replayEpoch: 1, idempotentRetry: true, replayStableStateFingerprintAfter: "e".repeat(64) });
    expect(() => assertV4ReplayRehearsal({
      ...rehearsal,
      sourceSnapshot: { ...snapshot, preDdlReplayInputFingerprint: "f".repeat(64) },
    })).toThrow(/signed pre-DDL backup baseline/);
    expect(() => assertV4ReplayRehearsal({ ...rehearsal, sourceRawFingerprint: "f".repeat(64) })).toThrow(/Raw replay-source fingerprint/);
    expect(() => assertV4ReplayRehearsal({ ...rehearsal, fullFingerprintBefore: "f".repeat(64) })).toThrow(/baseline fingerprint/);
    expect(() => assertV4ReplayRehearsal({ ...rehearsal, replayStableStateFingerprintAfterRetry: "f".repeat(64) })).toThrow(/stable-state fingerprint/);
    expect(() => assertV4ReplayRehearsal({ ...rehearsal, retryReplay: { rolloutEpoch: 1, dayCount: 364 } })).toThrow(/idempotent retry/);

    const currentBaseline = {
      ...rehearsal,
      sourceSnapshot: { ...snapshot, lifecycleState: "v4-current" },
      fullFingerprintAfter: rehearsal.fullFingerprintBefore,
      fullFingerprintAfterRetry: rehearsal.fullFingerprintBefore,
      replayStableStateFingerprintAfter: rehearsal.replayStableStateFingerprintBefore,
      replayStableStateFingerprintAfterRetry: rehearsal.replayStableStateFingerprintBefore,
    };
    expect(assertV4ReplayRehearsal(currentBaseline)).toMatchObject({ verified: true, ddlAuthorization: false, replayEpoch: 1, idempotentRetry: true });
    expect(() => assertV4ReplayRehearsal({
      ...currentBaseline,
      replayStableStateFingerprintAfter: "f".repeat(64),
    })).toThrow(/stable-state fingerprint/);
    expect(() => assertV4ReplayRehearsal({
      ...currentBaseline,
      fullFingerprintAfter: "not-a-digest",
    })).toThrow(/full data fingerprints/);
  });
});
