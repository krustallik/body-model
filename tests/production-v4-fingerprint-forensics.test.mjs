import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  assertRestoredSourceMigrationState,
  compareForensicReports,
  consumeSnapshotOutput,
  safeCliErrorMessage,
} from "../scripts/production-v4-fingerprint-forensics.mjs";
import { V4_REPUBLICATION_MANIFEST } from "../scripts/production-migration-manifests.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const marker = (value) => Buffer.from(value).toString("base64url");
const activity = { otherClientBackends: 0, activeTransactions: 0, activeStatements: 0, preparedTransactions: 0 };
const fingerprintVersions = {
  signedBaseline: "bodycast-v4-replay-source-fingerprint-v2",
  rawParity: "bodycast-v4-replay-source-fingerprint-v3",
};
const derivedTables = new Set([
  "ExperimentalTransientExerciseWaterShadow", "PhysiologyV7Lifecycle", "UnifiedExperimentalPhysiologyStateV2", "UnifiedPublicationBlock",
]);

test("CLI surfaces only whitelisted sanitized PostgreSQL capture diagnostics", () => {
  assert.equal(
    safeCliErrorMessage(new Error("Read-only PostgreSQL forensic capture failed closed (parser=sequence-state-changed; client=sqlstate-22023; exit=1).")),
    "Read-only PostgreSQL forensic capture failed closed (parser=sequence-state-changed; client=sqlstate-22023; exit=1).",
  );
  assert.equal(
    safeCliErrorMessage(new Error("Read-only PostgreSQL forensic capture failed closed (parser=sequence-state-changed; client=secret-password; exit=1).")),
    "Production V4 fingerprint forensics failed closed.",
  );
  assert.equal(
    safeCliErrorMessage(new Error("DATABASE_URL=secret raw SQL and private row payload")),
    "Production V4 fingerprint forensics failed closed.",
  );
});

function snapshotLines({ migration = "base", lifecycle = '{"id":1}', workoutRows = ['{"id":1}', '{"id":2}'], legacySequenceValue = "5", sequenceValue = "5", sequenceIsCalled = "true" } = {}) {
  const tables = ["_prisma_migrations", "PhysiologyV7Lifecycle", "Workout"];
  const sequences = [{ name: "public.Workout_id_seq", ownerTable: "Workout", dataType: "bigint", startValue: "1", incrementBy: "1", minimumValue: "1", maximumValue: "9223372036854775807", cycle: false }];
  return [
    "BEGIN",
    `__BODYCAST_IDENTITY__=${JSON.stringify({ database: "bodycast_restore", role: "bodycast_restore", serverVersion: "17.11", serverAddress: "127.0.0.1", serverPort: 5432, clusterSystemIdentifier: "1", transactionReadOnly: "on" })}`,
    `__BODYCAST_TABLE_INVENTORY__=${JSON.stringify(tables)}`,
    `__BODYCAST_SEQUENCE_INVENTORY__=${JSON.stringify(sequences)}`,
    `__BODYCAST_MIGRATIONS__=${JSON.stringify([])}`,
    `__BODYCAST_ACTIVITY_BEFORE__=${JSON.stringify(activity)}`,
    "__BODYCAST_SEQUENCE_PHASE__before",
    `__BODYCAST_SEQUENCE_STATE__${marker("public.Workout_id_seq")}=${legacySequenceValue}:${sequenceValue}:${sequenceIsCalled}`,
    "__BODYCAST_SEQUENCE_PHASE_END__before",
    `__BODYCAST_TABLE_BEGIN__${marker("_prisma_migrations")}`,
    JSON.stringify({ migration_name: migration }),
    `__BODYCAST_TABLE_END__${marker("_prisma_migrations")}`,
    `__BODYCAST_TABLE_BEGIN__${marker("PhysiologyV7Lifecycle")}`,
    lifecycle,
    `__BODYCAST_TABLE_END__${marker("PhysiologyV7Lifecycle")}`,
    `__BODYCAST_TABLE_BEGIN__${marker("Workout")}`,
    ...workoutRows,
    `__BODYCAST_TABLE_END__${marker("Workout")}`,
    "__BODYCAST_SEQUENCE_PHASE__after",
    `__BODYCAST_SEQUENCE_STATE__${marker("public.Workout_id_seq")}=${legacySequenceValue}:${sequenceValue}:${sequenceIsCalled}`,
    "__BODYCAST_SEQUENCE_PHASE_END__after",
    `__BODYCAST_ACTIVITY_AFTER__=${JSON.stringify(activity)}`,
    "COMMIT",
  ];
}

test("V3 excludes only approved derived rows and the migration ledger from raw parity", async () => {
  const inventory = {
    tables: ["_prisma_migrations", "PhysiologyV7Lifecycle", "Workout"].map((tablename) => ({ tablename })),
    sequences: [{ name: "public.Workout_id_seq", ownerTable: "Workout", dataType: "bigint", startValue: "1", incrementBy: "1", minimumValue: "1", maximumValue: "9223372036854775807", cycle: false }],
  };
  const capture = (options) => consumeSnapshotOutput(Readable.from(`${snapshotLines(options).join("\n")}\n`), inventory);
  const baseline = await capture({ migration: "base" });
  const ledgerChanged = await capture({ migration: "base plus V4" });
  const derivedChanged = await capture({ lifecycle: '{"id":2}' });
  const rawChanged = await capture({ migration: "base", workoutRows: ['{"id":1}', '{"id":3}'] });
  const sequenceStateChanged = await capture({ sequenceIsCalled: "false" });

  assert.equal(baseline.v4ReplayInputFingerprintV3, ledgerChanged.v4ReplayInputFingerprintV3);
  assert.notEqual(baseline.v4ReplayInputFingerprintV2, ledgerChanged.v4ReplayInputFingerprintV2);
  assert.equal(baseline.v4ReplayInputFingerprintV3, derivedChanged.v4ReplayInputFingerprintV3);
  assert.notEqual(baseline.v4ReplayInputFingerprintV3, rawChanged.v4ReplayInputFingerprintV3);
  assert.equal(baseline.v4ReplayInputFingerprintV2, sequenceStateChanged.v4ReplayInputFingerprintV2);
  assert.notEqual(baseline.v4ReplayInputFingerprintV3, sequenceStateChanged.v4ReplayInputFingerprintV3);
  assert.deepEqual(baseline.replayInputFingerprintVersions, fingerprintVersions);
  assert.equal(JSON.stringify(baseline).includes('{"id":1}'), false);
});

test("reproduces the signed legacy sequence projection when pg_sequences.last_value is null", async () => {
  const inventory = {
    tables: ["_prisma_migrations", "PhysiologyV7Lifecycle", "Workout"].map((tablename) => ({ tablename })),
    sequences: [{ name: "public.Workout_id_seq", ownerTable: "Workout", dataType: "bigint", startValue: "1", incrementBy: "1", minimumValue: "1", maximumValue: "9223372036854775807", cycle: false }],
  };
  const report = await consumeSnapshotOutput(Readable.from(`${snapshotLines({ legacySequenceValue: "null", sequenceValue: "1", sequenceIsCalled: "false" }).join("\n")}\n`), inventory);
  const expectedV2 = createHash("sha256")
    .update("bodycast-v4-replay-source-fingerprint-v2\n")
    .update("excluded-derived-tables:ExperimentalTransientExerciseWaterShadow,PhysiologyV7Lifecycle,UnifiedExperimentalPhysiologyStateV2,UnifiedPublicationBlock\n")
    .update('table:_prisma_migrations\n{"migration_name":"base"}\n\n')
    .update('table:Workout\n{"id":1}\n{"id":2}\n\n')
    .update("sequence-state\npublic.Workout_id_seq:null\n")
    .digest("hex");
  assert.equal(report.v4ReplayInputFingerprintV2, expectedV2);
  assert.equal(report.sequences[0].legacyDigest, sha("public.Workout_id_seq:null"));
  assert.equal(report.sequences[0].digest, sha("public.Workout_id_seq:null:1:false"));
});

function forensicReport(side) {
  const isSource = side === "source";
  const rawNames = ["DailyHealthData", "Workout"];
  const derivedNames = ["ExperimentalTransientExerciseWaterShadow", "PhysiologyV7Lifecycle", "UnifiedExperimentalPhysiologyStateV2"];
  const tableNames = [...rawNames, ...derivedNames, "_prisma_migrations", ...(isSource ? [] : ["UnifiedPublicationBlock"])].sort();
  const v4Migrations = V4_REPUBLICATION_MANIFEST.migrations.map(({ name, sha256: checksum }) => ({
    name, checksum, startedAt: "2026-10-13T18:00:00.000Z", finishedAt: "2026-10-13T18:00:01.000Z", rolledBackAt: null, logsFingerprint: sha(name),
  }));
  const migrations = [
    { name: "prior", checksum: "prior-checksum", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z", rolledBackAt: null, logsFingerprint: "prior-logs" },
    ...(isSource ? [] : v4Migrations),
  ];
  const tables = tableNames.map((name) => ({
    name,
    rowCount: name === "_prisma_migrations" ? (isSource ? 1 : 3) : 0,
    digest: sha(name === "_prisma_migrations" ? (isSource ? "pre-v4-ledger" : "post-v4-ledger") : derivedTables.has(name) ? `${side}-${name}` : name),
  }));
  const sequenceInventory = [
    { name: "public.DailyHealthData_id_seq", ownerTable: "DailyHealthData", dataType: "bigint", startValue: "1", incrementBy: "1", minimumValue: "1", maximumValue: "9223372036854775807", cycle: false },
    { name: "public.PhysiologyV7Lifecycle_id_seq", ownerTable: "PhysiologyV7Lifecycle", dataType: "bigint", startValue: "1", incrementBy: "1", minimumValue: "1", maximumValue: "9223372036854775807", cycle: false },
  ];
  const identity = {
    database: isSource ? "bodycast_restore" : "bodycast",
    role: isSource ? "bodycast_restore" : "bodycast",
    serverVersion: "17.11",
    serverAddress: isSource ? "127.0.0.1" : "172.20.0.2",
    serverPort: 5432,
    clusterSystemIdentifier: isSource ? "2" : "7676573064192299040",
    transactionReadOnly: "on",
  };
  return {
    schemaVersion: 1,
    captureMethod: "repeatable-read-read-only-row-json-v1",
    identity,
    expectedServerAddress: isSource ? undefined : "172.20.0.2",
    databaseContainerId: isSource ? undefined : "a".repeat(64),
    activity: { before: { ...activity }, after: { ...activity } },
    tableInventory: tableNames,
    tables,
    sequenceInventory,
    sequences: sequenceInventory.map((sequence) => ({
      name: sequence.name, ownerTable: sequence.ownerTable,
      digest: sha("public.DailyHealthData_id_seq:10:true"),
      legacyDigest: sha("public.DailyHealthData_id_seq:10"),
    })),
    migrations,
    logicalDataFingerprint: isSource ? "a".repeat(64) : "b".repeat(64),
    v4ReplayInputFingerprintV2: isSource ? "c".repeat(64) : "d".repeat(64),
    v4ReplayInputFingerprintV3: "e".repeat(64),
    replayInputFingerprintVersions: fingerprintVersions,
  };
}

function validComparisonInputs() {
  const source = forensicReport("source");
  const current = forensicReport("current");
  return {
    source,
    current,
    options: {
      signedSourceBinding: { ddlAuthorization: false, preDdlLogicalDataFingerprint: "a".repeat(64), preDdlReplayInputFingerprint: "c".repeat(64) },
      sourcePreflight: { identity: { ...source.identity }, migrations: source.migrations },
      currentPreflight: {
        identity: { ...current.identity },
        conflictingLocks: [], preparedTransactions: [], diagnostics: { longTransactions: [] }, writerDrain: { activeClientBackends: [] },
      },
      currentPostflight: { ready: true, pending: [] },
      currentReleaseSha: "d".repeat(40), workflowRunId: "123", workflowRunAttempt: "1",
    },
  };
}

test("classifies V2-only ledger mismatch when V3 raw tables and sequences match", () => {
  const input = validComparisonInputs();
  const result = compareForensicReports(input.source, input.current, input.options);
  assert.equal(result.verified, true);
  assert.equal(result.classification, "BOOKKEEPING_ONLY");
  assert.equal(result.ddlAuthorization, false);
  assert.equal(result.sourceRunHistory, "UNVERIFIED");
  assert.notEqual(result.sourceReplayInputFingerprintV2, result.currentReplayInputFingerprintV2);
  assert.equal(result.sourceReplayInputFingerprintV3, result.currentReplayInputFingerprintV3);
  assert.deepEqual(result.rawTableComparisons.map(({ name, matches }) => ({ name, matches })), [
    { name: "DailyHealthData", matches: true }, { name: "Workout", matches: true },
  ]);
  assert.equal(result.rawSequenceComparisons[0].matches, true);
  assert.notEqual(result.sourceMigrationLedgerDigest, result.currentMigrationLedgerDigest);
});

test("restored source requires the exact clean pre-V4 migration state without live topology", () => {
  const migrationDirectories = ["base", "20261011120000_unified_publication_failure_fence", "20261011130000_only_completed_training_invalidates_v7"];
  const source = {
    identity: { database: "bodycast_restore", role: "bodycast_restore", serverVersion: "17.11" },
    migrations: [{ name: "base", checksum: "a".repeat(64), startedAt: "2026-10-13T18:00:00.000Z", finishedAt: "2026-10-13T18:00:01.000Z", rolledBackAt: null, hasLogs: true, logsFingerprint: "b".repeat(32) }],
  };
  const expectedPending = migrationDirectories.slice(1);
  assert.deepEqual(assertRestoredSourceMigrationState(source, migrationDirectories, expectedPending), expectedPending);

  const failedV4 = structuredClone(source);
  failedV4.migrations.push({ name: expectedPending[0], checksum: "c".repeat(64), startedAt: "2026-10-13T18:00:00.000Z", finishedAt: null, rolledBackAt: null, hasLogs: false, logsFingerprint: "d".repeat(32) });
  assert.throws(() => assertRestoredSourceMigrationState(failedV4, migrationDirectories, expectedPending));

  const duplicate = structuredClone(source);
  duplicate.migrations.push(structuredClone(duplicate.migrations[0]));
  assert.throws(() => assertRestoredSourceMigrationState(duplicate, migrationDirectories, expectedPending));

  const unexpectedHistory = structuredClone(source);
  unexpectedHistory.migrations[0].name = "unknown-migration";
  assert.throws(() => assertRestoredSourceMigrationState(unexpectedHistory, migrationDirectories, expectedPending));

  assert.throws(() => assertRestoredSourceMigrationState({ ...source, identity: { ...source.identity, database: "bodycast" } }, migrationDirectories, expectedPending));
});

test("blocks and localizes a raw table mismatch", () => {
  const input = validComparisonInputs();
  input.current.tables.find((item) => item.name === "Workout").digest = "f".repeat(64);
  input.current.v4ReplayInputFingerprintV3 = "f".repeat(64);
  const result = compareForensicReports(input.source, input.current, input.options);
  assert.equal(result.verified, false);
  assert.deepEqual(result.rawTableComparisons.find(({ name }) => name === "Workout"), {
    name: "Workout", sourceDigest: sha("Workout"), currentDigest: "f".repeat(64),
    sourceRowCount: 0, currentRowCount: 0, matches: false,
  });
  assert.match(result.blockers.join(" "), /Raw table digest differs: Workout/);
});

test("blocks and localizes sequence state or definition drift", () => {
  const stateInput = validComparisonInputs();
  stateInput.current.sequences[0].digest = "f".repeat(64);
  stateInput.current.v4ReplayInputFingerprintV3 = "f".repeat(64);
  const stateResult = compareForensicReports(stateInput.source, stateInput.current, stateInput.options);
  assert.equal(stateResult.rawSequenceComparisons[0].matches, false);
  assert.match(stateResult.blockers.join(" "), /Raw sequence state or definition differs: public\.DailyHealthData_id_seq/);

  const definitionInput = validComparisonInputs();
  definitionInput.current.sequenceInventory[0].incrementBy = "2";
  const definitionResult = compareForensicReports(definitionInput.source, definitionInput.current, definitionInput.options);
  assert.equal(definitionResult.rawSequenceComparisons[0].matches, false);
  assert.match(definitionResult.blockers.join(" "), /Raw sequence definitions differ/);
});

test("blocks missing writer drain, active DB work, locks, or prepared transactions", () => {
  const input = validComparisonInputs();
  input.current.activity.after.activeTransactions = 1;
  input.options.currentPreflight.writerDrain.activeClientBackends.push({ pid: 42 });
  input.options.currentPreflight.conflictingLocks.push({ relation: "Workout" });
  input.options.currentPreflight.preparedTransactions.push({ gid: "prepared" });
  const result = compareForensicReports(input.source, input.current, input.options);
  assert.match(result.blockers.join(" "), /active transaction/);
  assert.match(result.blockers.join(" "), /writer drain found other client backends/);
  assert.match(result.blockers.join(" "), /locks, prepared transactions, or long transactions are not clear/);
});

test("blocks wrong signed binding, DB identity, migration checksum, or failed schema postflight", () => {
  const input = validComparisonInputs();
  input.options.signedSourceBinding.preDdlLogicalDataFingerprint = "f".repeat(64);
  input.current.identity.serverAddress = "172.20.0.9";
  input.current.migrations.find((row) => row.name === V4_REPUBLICATION_MANIFEST.migrations[0].name).checksum = "f".repeat(64);
  input.options.currentPostflight.ready = false;
  const result = compareForensicReports(input.source, input.current, input.options);
  assert.equal(result.verified, false);
  assert.match(result.blockers.join(" "), /signed pre-DDL binding/);
  assert.match(result.blockers.join(" "), /pinned cluster endpoint/);
  assert.match(result.blockers.join(" "), /exactly the two reviewed successful V4 migrations/);
  assert.match(result.blockers.join(" "), /postflight is not ready/);
});

test("blocks mixed projection versions, incomplete inventory, and nonempty pending postflight", () => {
  const versionInput = validComparisonInputs();
  versionInput.current.replayInputFingerprintVersions.rawParity = "unversioned";
  assert.match(compareForensicReports(versionInput.source, versionInput.current, versionInput.options).blockers.join(" "), /fingerprint report is incomplete/);

  const inventoryInput = validComparisonInputs();
  inventoryInput.current.sequenceInventory = null;
  assert.match(compareForensicReports(inventoryInput.source, inventoryInput.current, inventoryInput.options).blockers.join(" "), /fingerprint report is incomplete/);

  const pendingInput = validComparisonInputs();
  pendingInput.options.currentPostflight.pending = ["unexpected_migration"];
  assert.match(compareForensicReports(pendingInput.source, pendingInput.current, pendingInput.options).blockers.join(" "), /postflight is not ready/);
});

test("read-only forensics workflow retains authorization and excludes activation mutations", () => {
  const workflow = readFileSync(resolve(".github/workflows/activate-unified-v4-production.yml"), "utf8").replace(/\r\n/g, "\n");
  assert.match(workflow, /mode:\n\s+description: Select read-only fingerprint forensics/);
  assert.match(workflow, /FORENSICS_CONFIRMATION: \$\{\{ inputs\.confirm_read_only_forensics \}\}/);
  assert.match(workflow, /READ_ONLY_V4_FINGERPRINT_FORENSICS/);
  assert.match(workflow, /Compare signed pre-DDL source with a read-only production snapshot\n\s+if: inputs\.mode == 'forensics'/);
  for (const status of ["queued", "in_progress", "requested", "waiting", "pending"]) {
    assert.match(workflow, new RegExp(`production-runs-${status}\\.ndjson`), `missing ${status} run inventory`);
  }
  const sourceForensics = workflow.slice(workflow.indexOf('if [[ "$EXECUTION_MODE" == "forensics" ]]; then'), workflow.indexOf("\n          else", workflow.indexOf('if [[ "$EXECUTION_MODE" == "forensics" ]]; then')));
  assert.doesNotMatch(sourceForensics, /prisma:migrate:deploy|source-post-v4/);
  assert.doesNotMatch(sourceForensics, /evaluateProductionPreflight/);
  assert.match(sourceForensics, /assertRestoredSourceMigrationState/);
  assert.match(workflow, /evaluateProductionPostflight/);
  for (const name of [
    "Create encrypted post-DDL backup and bind fresh production snapshot",
    "Restore backup and rehearse V4 epoch 1 on isolated PostgreSQL",
    "Upload encrypted post-DDL production backup",
    "Upload immutable post-DDL V4 recovery evidence",
    "Verify V3, activate and replay V4, then serve exact SHA under one host lock",
    "Verify public HTTPS pages and health API after serving",
  ]) {
    const start = workflow.indexOf(`- name: ${name}`);
    assert.notEqual(start, -1, `missing workflow step: ${name}`);
    const next = workflow.indexOf("\n      - name:", start + 1);
    const step = workflow.slice(start, next < 0 ? undefined : next);
    assert.match(step, /if: inputs\.mode == 'activate'/, `${name} is not activation-only`);
  }
});
