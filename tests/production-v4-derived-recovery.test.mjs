import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LEGACY_V4_RECOVERY,
  assertApprovedRecoveryRuns,
  assertArtifactBinding,
  assertProductionIdentity,
  assertCompletedV4RecoveryForServe,
  assertRehearsedCoverageEvidence,
  assertRecoveryPostflight,
  assertOneShotRecoveryState,
  assertSchemaSignature,
  migrationLedgerDigest,
  productionPreflightMismatchCategories,
  modelDayKeysDigest,
  parseTrainingFenceIdentity,
  validatePublicationSourceEvidence,
  publicationBlockDigest,
  recoveryEvidenceBinding,
  sha256,
} from "../scripts/production-v4-derived-recovery.mjs";

const migrationRoot = new URL("../prisma/migrations/", import.meta.url);
const ledgerRows = readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  .map((entry) => entry.name).sort().slice(0, LEGACY_V4_RECOVERY.migrationCount).map((name) => ({
    name,
    checksum: createHash("sha256").update(readFileSync(join(fileURLToPath(migrationRoot), name, "migration.sql"))
      .toString("utf8").replaceAll("\r\n", "\n")).digest("hex"),
    finishedAt: "2026-01-01T00:00:00Z",
    rolledBackAt: null,
  }));
const currentMigrationRows = readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  .map((entry) => entry.name).sort().map((name) => ({
    name,
    checksum: createHash("sha256").update(readFileSync(join(fileURLToPath(migrationRoot), name, "migration.sql"))
      .toString("utf8").replaceAll("\r\n", "\n")).digest("hex"),
    finishedAt: "2026-01-01T00:00:00Z",
    rolledBackAt: null,
  }));
const blocks = [
  ...Array.from({ length: 8 }, (_, i) => ({ source: "health", sourceKey: `2026-10-${String(i + 1).padStart(2, "0")}`,
    fromDate: `2026-10-${String(i + 1).padStart(2, "0")}`, revision: 1,
    createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" })),
  { source: "training", sourceKey: "20", fromDate: "2026-10-09", revision: 2,
    createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" },
];
const makeHealthSource = (block, overrides = {}) => ({
  sourceKey: block.sourceKey, fromDate: block.fromDate, fenceRevision: block.revision,
  dailyDataRows: 1, snapshotRows: 2, linkedSnapshotRows: 2, invalidSnapshotRows: 0,
  snapshotsWithReceivedAt: 2, snapshotsWithSyncedAt: 1, snapshotsWithNullSyncedAt: 1, invalidSnapshotTimes: 0,
  snapshotsWithValidTimeZone: 2, invalidSnapshotTimeZones: 0,
  dailyUpdatedAt: "2026-10-20T00:00:01.000Z",
  metricSampleRows: 3,
  linkedMetricSampleRows: 3, invalidMetricSampleRows: 0, unsupportedMetricSourceRows: 0,
  chronologyValid: true, ...overrides,
});
const makeTrainingSource = (block, overrides = {}) => ({
  ...(() => {
    const identity = parseTrainingFenceIdentity(block.sourceKey);
    const sessionId = identity.sessionId;
    const matched = sessionId === 20;
    const eventAt = matched ? "2026-10-09T12:00:00.000Z" : "2026-10-10T22:30:00.000Z";
    const accountingAt = matched ? "2026-10-09T12:00:00.000Z" : "2026-10-10T22:30:00.000Z";
    const status = matched ? "MATCHED" : "PENDING";
    return {
      identity: identity.identity, sessionId, entryMode: matched ? "RETROSPECTIVE" : "LIVE", matchStatus: status,
      matchedWorkoutId: matched ? 79 : null,
      matchedWorkoutPresent: matched, matchedWorkoutIdentityMatches: true,
      matchedWorkoutTypeSupported: matched,
      matchedWorkoutSourceIdentitySha256: matched ? "b".repeat(64) : null,
      matchedWorkoutSourceHealthDate: matched ? "2026-10-09" : null,
      matchedWorkoutStartAt: matched ? eventAt : null,
      trainingEventAt: matched ? eventAt : accountingAt,
      effectiveAccountingAt: accountingAt,
      persistedEffectiveAccountingAt: accountingAt,
      webStartedAt: matched ? null : "2026-10-10T22:00:00.000Z",
    };
  })(),
  sourceKey: block.sourceKey, fromDate: block.fromDate, fenceRevision: block.revision,
  childDeletionAccountingInputRevision: parseTrainingFenceIdentity(block.sourceKey).childId === null ? null : block.revision,
  sessionRows: 1, profileId: 1, status: "COMPLETED", parentSessionRows: 1, parentSessionId: parseTrainingFenceIdentity(block.sourceKey).sessionId,
  parentProfileId: 1, parentStatus: "COMPLETED", childRows: parseTrainingFenceIdentity(block.sourceKey).childId === null ? null : 0,
  childOwnerSessionId: null, sourceRevision: 24,
  accountingInputRevision: 22, currentSnapshotRevision: 79, accountingSnapshotRows: 1,
  snapshotRevision: 79, snapshotAccountingInputRevision: 22, snapshotEffectiveLocalDate: parseTrainingFenceIdentity(block.sourceKey).sessionId === 20 ? "2026-10-09" : "2026-10-11",
  accountingEffectiveLocalDate: parseTrainingFenceIdentity(block.sourceKey).sessionId === 20 ? "2026-10-09" : "2026-10-11",
  createdAt: "2026-10-08T00:00:00.000Z",
  accountingTimeZone: "Europe/Bratislava", accountingTimeZoneProvenance: "legacy-default",
  snapshotTimeZone: "Europe/Bratislava", snapshotTimeZoneValid: true,
  snapshotTimeZoneProvenance: "legacy-default", snapshotContractValid: true, snapshotEvidenceSha256: "a".repeat(64),
  latestSnapshotRows: 1, latestSnapshotRevision: 79, latestSnapshotAccountingInputRevision: 22,
  latestSnapshotEffectiveLocalDate: parseTrainingFenceIdentity(block.sourceKey).sessionId === 20 ? "2026-10-09" : "2026-10-11",
  latestSnapshotTimeZone: "Europe/Bratislava", latestSnapshotTimeZoneValid: true,
  latestSnapshotTimeZoneProvenance: "legacy-default", latestSnapshotContractValid: true,
  latestSnapshotEvidenceSha256: "a".repeat(64), historicalSnapshotChronologyValid: true,
  pendingAccountingOperationRows: 0, accountingRevisionGap: 0, sourceFenceChronologyValid: true,
  sessionUpdateFenceChronologyValid: true,
  modelDate: block.fromDate,
  chronologyValid: true, ...overrides,
});
const makeSourceEvidence = (value = blocks) => ({
  health: value.filter((block) => block.source === "health").map((block) => makeHealthSource(block)),
  training: value.filter((block) => block.source === "training")
    .sort((left, right) => parseTrainingFenceIdentity(left.sourceKey).sessionId - parseTrainingFenceIdentity(right.sourceKey).sessionId
      || left.sourceKey.localeCompare(right.sourceKey)).map((block) => makeTrainingSource(block)),
});
const recoveryRun = (path) => [{ head_sha: LEGACY_V4_RECOVERY.sourceSha, head_branch: LEGACY_V4_RECOVERY.branch,
  event: "pull_request", path, status: "completed", conclusion: "success", run_attempt: 1 }];
const mainRun = (path) => [{ head_sha: "3".repeat(40), head_branch: "main", event: "push",
  path, status: "completed", conclusion: "success", run_attempt: 1 }];
const auth = (overrides = {}) => ({
  actorId: LEGACY_V4_RECOVERY.ownerId,
  confirmation: LEGACY_V4_RECOVERY.confirmation,
  runAttempt: "1",
  repository: LEGACY_V4_RECOVERY.repository,
  workflowRef: "refs/heads/main",
  workflowPath: ".github/workflows/production-v4-derived-recovery.yml",
  workflowSha: "3".repeat(40),
  currentMainSha: "3".repeat(40),
  sourceSha: LEGACY_V4_RECOVERY.sourceSha,
  sourcePr: { number: 101, state: "open", head: { ref: LEGACY_V4_RECOVERY.branch, sha: LEGACY_V4_RECOVERY.sourceSha },
    base: { ref: "codex/v4-health-publication-validation", sha: LEGACY_V4_RECOVERY.baseSha } },
  ciRuns: recoveryRun(".github/workflows/ci.yml"),
  safetyRuns: recoveryRun(".github/workflows/production-migration-safety-ci.yml"),
  mainCiRuns: mainRun(".github/workflows/ci.yml"),
  ...overrides,
});

describe("owner-gated legacy V4 recovery runner contracts", () => {
  it("accepts the exact owner, confirmation, legacy SHA, PR base, one-shot attempt, and green CI", () => {
    expect(assertApprovedRecoveryRuns(auth())).toBe(true);
  });

  it.each([
    ["owner", { actorId: "1" }], ["confirmation", { confirmation: "RECOVER" }],
    ["rerun", { runAttempt: "2" }], ["main ref", { workflowRef: "refs/heads/codex/topic" }],
    ["SHA", { sourceSha: "1".repeat(40) }], ["CI SHA", { ciRuns: recoveryRun(".github/workflows/ci.yml").map((x) => ({ ...x, head_sha: "1".repeat(40) })) }],
    ["safety workflow", { safetyRuns: recoveryRun(".github/workflows/ci.yml") }],
    ["current main CI", { mainCiRuns: [] }],
    ["legacy PR base", { sourcePr: { number: 101, state: "open", head: { ref: LEGACY_V4_RECOVERY.branch, sha: LEGACY_V4_RECOVERY.sourceSha }, base: { sha: "1".repeat(40) } } }],
    ["workflow SHA", { currentMainSha: "4".repeat(40) }],
  ])("rejects %s mismatch", (_name, values) => expect(() => assertApprovedRecoveryRuns(auth(values))).toThrow());

  it("requires exactly the approved 65 successful, ordered migration rows", () => {
    expect(ledgerRows).toHaveLength(65);
    expect(migrationLedgerDigest(ledgerRows)).toBe(LEGACY_V4_RECOVERY.ledgerDigest);
    expect(() => migrationLedgerDigest(ledgerRows.slice(1))).toThrow();
    expect(() => migrationLedgerDigest(ledgerRows.map((row, i) => i === 4 ? { ...row, rolledBackAt: "now" } : row))).toThrow();
    expect(() => migrationLedgerDigest([...ledgerRows].reverse())).toThrow();
  });

  it("reports only safe categories for exact production preflight evidence mismatches", () => {
    const lifecycle = { profileId: 1, unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      unifiedRolloutEpoch: 1, invalidationGeneration: 10, productionPublishedGeneration: 9,
      unifiedPublishedGeneration: null, unifiedPublishedRolloutEpoch: null,
      unifiedPublicationBlockedFromDate: "2026-10-01", unifiedPublicationBlockedSource: "health" };
    const sourceFingerprint = "d".repeat(64);
    const schemaSha256 = "c".repeat(64);
    const schemaDigestHelperSha256 = "e".repeat(64);
    const schemaDigestContract = "bodycast-v4-schema-digest-v1";
    const before = { migrationRows: ledgerRows, blocks, sourceEvidence: makeSourceEvidence(), lifecycle,
      sourceModelDayKeys: ["2026-10-01", "2026-10-02"], expectedLedgerDigest: migrationLedgerDigest(ledgerRows) };
    const rehearsal = { sourceFingerprint };
    const measurements = { schemaDigestContract, schemaDigestHelperSha256, schemaSha256,
      restoredSourceFingerprint: sourceFingerprint };
    const report = { appSha: LEGACY_V4_RECOVERY.productionAppSha, headroomBeforeLoad: { phase: "before-load" },
      schemaDigestContract, schemaDigestHelperSha256, schemaSha256,
      evidence: { database: { database: "bodycast" }, migrationRows: ledgerRows, lifecycle,
        sourceFingerprint, blocks, sourceEvidence: makeSourceEvidence(), sourceModelDayKeys: before.sourceModelDayKeys,
        expectedLedgerDigest: before.expectedLedgerDigest } };
    const input = { report, measurements, before, rehearsal, expectedSchemaHelperSha256: schemaDigestHelperSha256,
      schemaDigestContract, schemaDigestHelperSha256 };
    expect(productionPreflightMismatchCategories(input)).toEqual([]);

    const changed = productionPreflightMismatchCategories({ ...input,
      report: { ...report, evidence: { ...report.evidence, sourceFingerprint: "f".repeat(64) } } });
    expect(changed).toEqual(["raw-source-fingerprint", "rehearsal-source-fingerprint"]);
    expect(JSON.stringify(changed)).not.toMatch(/[a-f0-9]{64}/);
  });

  it("accepts only the exact 74-migration target while the app is absent behind verified maintenance", () => {
    const lifecycle = { profileId: 1, unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      unifiedRolloutEpoch: 1, invalidationGeneration: 10, productionPublishedGeneration: 9,
      unifiedPublishedGeneration: null, unifiedPublishedRolloutEpoch: null,
      unifiedPublicationBlockedFromDate: "2026-10-01", unifiedPublicationBlockedSource: "health" };
    const sourceFingerprint = "d".repeat(64);
    const targetSchema = { mode: "maintenance-no-app-74", migrationCount: 74,
      ledgerDigest: migrationLedgerDigest(currentMigrationRows, 74), migrationTree: "a".repeat(40),
      prismaSchemaBlob: "b".repeat(40) };
    const before = { migrationRows: currentMigrationRows, blocks, sourceEvidence: makeSourceEvidence(), lifecycle,
      sourceModelDayKeys: ["2026-10-01", "2026-10-02"], expectedLedgerDigest: migrationLedgerDigest(ledgerRows) };
    const report = { appMode: "maintenance-no-app", appSha: null, appContainerId: null, appImageId: null,
      targetSchema, headroomBeforeLoad: { phase: "before-load" }, schemaDigestContract: "bodycast-v4-schema-digest-v1",
      schemaDigestHelperSha256: "e".repeat(64), schemaSha256: "c".repeat(64),
      evidence: { database: { database: "bodycast" }, migrationRows: currentMigrationRows, lifecycle,
        sourceFingerprint, blocks, sourceEvidence: makeSourceEvidence(), sourceModelDayKeys: before.sourceModelDayKeys,
        expectedLedgerDigest: before.expectedLedgerDigest } };
    const input = { report, measurements: { schemaDigestContract: report.schemaDigestContract,
      schemaDigestHelperSha256: report.schemaDigestHelperSha256, schemaSha256: report.schemaSha256,
      restoredSourceFingerprint: sourceFingerprint }, before, rehearsal: { sourceFingerprint },
      expectedSchemaHelperSha256: report.schemaDigestHelperSha256, schemaDigestContract: report.schemaDigestContract,
      schemaDigestHelperSha256: report.schemaDigestHelperSha256, targetSchema };
    expect(productionPreflightMismatchCategories(input)).toEqual([]);
    expect(productionPreflightMismatchCategories({ ...input,
      report: { ...report, targetSchema: { ...targetSchema, ledgerDigest: "f".repeat(64) } } }))
      .toContain("target-schema-binding");
    expect(productionPreflightMismatchCategories({ ...input,
      report: { ...report, appMode: "serving", appContainerId: "1".repeat(64) } }))
      .toContain("application-state");

    const expected = { migrationCount: 74, ledgerDigest: targetSchema.ledgerDigest,
      appMode: "maintenance-no-app", schemaSha256: report.schemaSha256, sourceFingerprint,
      blockDigest: publicationBlockDigest(blocks),
      database: { containerId: "e".repeat(64), imageId: "sha256:" + "f".repeat(64) },
      app: { state: "absent" } };
    const identity = { database: { name: "bodycast", version: "17.11", ...expected.database },
      app: { name: "bodycast-app-prod", state: "absent", health: "absent", releaseSha: null, containerId: null, imageId: null },
      migrationRows: currentMigrationRows, schemaSha256: expected.schemaSha256, sourceFingerprint,
      lifecycle, blocks, sourceEvidence: makeSourceEvidence(), expected };
    expect(assertProductionIdentity(identity)).toBe(true);
    expect(() => assertProductionIdentity({ ...identity,
      app: { ...identity.app, state: "running" } })).toThrow();
  });

  it.each([
    ["application SHA", "application-sha", (input) => ({ ...input, report: { ...input.report, appSha: "1".repeat(40) } })],
    ["headroom phase", "headroom-before-load", (input) => ({ ...input, report: { ...input.report, headroomBeforeLoad: { phase: "after-load" } } })],
    ["schema contract", "schema-digest-contract", (input) => ({ ...input, report: { ...input.report, schemaDigestContract: "other" } })],
    ["schema helper", "schema-digest-helper", (input) => ({ ...input, report: { ...input.report, schemaDigestHelperSha256: "1".repeat(64) } })],
    ["database identity", "database-identity", (input) => ({ ...input, report: { ...input.report, evidence: { ...input.report.evidence, database: { database: "other" } } } })],
    ["migration count", "migration-row-count", (input) => ({ ...input, report: { ...input.report, evidence: { ...input.report.evidence, migrationRows: [] } } })],
    ["rollout epoch", "unified-rollout-epoch", (input) => ({ ...input, report: { ...input.report, evidence: { ...input.report.evidence, lifecycle: { ...input.report.evidence.lifecycle, unifiedRolloutEpoch: 2 } } } })],
    ["schema fingerprint", "schema-fingerprint", (input) => ({ ...input, report: { ...input.report, schemaSha256: "1".repeat(64) } })],
    ["migration ledger", "migration-ledger", (input) => ({ ...input, report: { ...input.report, evidence: { ...input.report.evidence, migrationRows: input.report.evidence.migrationRows.map((row, index) => index ? row : { ...row, finishedAt: "2026-02-01T00:00:00Z" }) } } })],
    ["publication fences", "publication-fences", (input) => ({ ...input, report: { ...input.report, evidence: { ...input.report.evidence, blocks: [] } } })],
    ["source provenance", "source-provenance", (input) => ({ ...input, report: { ...input.report, evidence: { ...input.report.evidence, sourceEvidence: {} } } })],
    ["lifecycle", "lifecycle", (input) => ({ ...input, before: { ...input.before, lifecycle: { ...input.before.lifecycle, invalidationGeneration: 11 } } })],
    ["source model day keys", "source-model-day-keys", (input) => ({ ...input, report: { ...input.report, evidence: { ...input.report.evidence, sourceModelDayKeys: ["2026-10-03"] } } })],
    ["expected ledger digest", "expected-ledger-digest", (input) => ({ ...input, report: { ...input.report, evidence: { ...input.report.evidence, expectedLedgerDigest: "1".repeat(64) } } })],
    ["restored source fingerprint", "raw-source-fingerprint", (input) => ({ ...input, measurements: { ...input.measurements, restoredSourceFingerprint: "1".repeat(64) } })],
    ["rehearsal source fingerprint", "rehearsal-source-fingerprint", (input) => ({ ...input, rehearsal: { sourceFingerprint: "1".repeat(64) } })],
  ])("identifies %s without returning evidence values", (_label, category, mutate) => {
    const lifecycle = { profileId: 1, unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      unifiedRolloutEpoch: 1, invalidationGeneration: 10, productionPublishedGeneration: 9,
      unifiedPublishedGeneration: null, unifiedPublishedRolloutEpoch: null,
      unifiedPublicationBlockedFromDate: "2026-10-01", unifiedPublicationBlockedSource: "health" };
    const sourceFingerprint = "d".repeat(64);
    const schemaSha256 = "c".repeat(64);
    const schemaDigestHelperSha256 = "e".repeat(64);
    const schemaDigestContract = "bodycast-v4-schema-digest-v1";
    const before = { migrationRows: ledgerRows, blocks, sourceEvidence: makeSourceEvidence(), lifecycle,
      sourceModelDayKeys: ["2026-10-01", "2026-10-02"], expectedLedgerDigest: migrationLedgerDigest(ledgerRows) };
    const report = { appSha: LEGACY_V4_RECOVERY.productionAppSha, headroomBeforeLoad: { phase: "before-load" },
      schemaDigestContract, schemaDigestHelperSha256, schemaSha256,
      evidence: { database: { database: "bodycast" }, migrationRows: ledgerRows, lifecycle,
        sourceFingerprint, blocks, sourceEvidence: makeSourceEvidence(), sourceModelDayKeys: before.sourceModelDayKeys,
        expectedLedgerDigest: before.expectedLedgerDigest } };
    const input = { report, before, rehearsal: { sourceFingerprint },
      measurements: { schemaDigestContract, schemaDigestHelperSha256, schemaSha256, restoredSourceFingerprint: sourceFingerprint },
      expectedSchemaHelperSha256: schemaDigestHelperSha256, schemaDigestContract, schemaDigestHelperSha256 };
    const mismatches = productionPreflightMismatchCategories(mutate(input));
    expect(mismatches).toContain(category);
    expect(JSON.stringify(mismatches)).not.toMatch(/[a-f0-9]{64}/);
  });

  it("binds the immutable image, archive, exact schema and executable command to its manifest", () => {
    const artifact = {
      sourceSha: LEGACY_V4_RECOVERY.sourceSha,
      imageId: `sha256:${"a".repeat(64)}`,
      imageDigest: `sha256:${"9".repeat(64)}`,
      archiveSha256: "b".repeat(64),
      archiveBytes: 1024,
      imageBytes: 2048,
      evidenceBindingContract: LEGACY_V4_RECOVERY.evidenceBindingContract,
      migrationTree: LEGACY_V4_RECOVERY.migrationTree,
      prismaSchemaBlob: LEGACY_V4_RECOVERY.prismaSchemaBlob,
      effectiveCommand: [...LEGACY_V4_RECOVERY.command],
      ledgerRows,
    };
    const manifest = {
      sourceSha: artifact.sourceSha,
      imageId: artifact.imageId,
      imageDigest: artifact.imageDigest,
      archiveSha256: artifact.archiveSha256,
      archiveBytes: artifact.archiveBytes,
      imageBytes: artifact.imageBytes,
      evidenceBindingContract: artifact.evidenceBindingContract,
      migrationTree: artifact.migrationTree,
      prismaSchemaBlob: artifact.prismaSchemaBlob,
      effectiveCommand: artifact.effectiveCommand,
      ledgerDigest: migrationLedgerDigest(ledgerRows),
    };
    artifact.manifestSha256 = sha256(JSON.stringify(manifest));
    expect(assertArtifactBinding(artifact)).toBe(manifest.ledgerDigest);
    expect(() => assertArtifactBinding({ ...artifact, imageId: "bodycast:latest" })).toThrow();
    expect(() => assertArtifactBinding({ ...artifact, imageDigest: "bodycast:recovery" })).toThrow();
    expect(() => assertArtifactBinding({ ...artifact, effectiveCommand: ["npx", "prisma", "migrate", "deploy"] })).toThrow();
    expect(() => assertArtifactBinding({ ...artifact, migrationTree: "1".repeat(40) })).toThrow();
  });

  it("binds live production DB/app IDs, schema, history, raw source and dynamic persisted fences", () => {
    const expected = {
      ledgerDigest: migrationLedgerDigest(ledgerRows), schemaSha256: "c".repeat(64), sourceFingerprint: "d".repeat(64),
      blockDigest: publicationBlockDigest(blocks),
      database: { containerId: "e".repeat(64), imageId: `sha256:${"f".repeat(64)}` },
      app: { containerId: "1".repeat(64), imageId: `sha256:${"2".repeat(64)}` },
    };
    const lifecycle = { profileId: 1, unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      unifiedRolloutEpoch: 1, invalidationGeneration: 10, productionPublishedGeneration: 9,
      unifiedPublishedGeneration: null, unifiedPublishedRolloutEpoch: null,
      unifiedPublicationBlockedFromDate: "2026-10-01", unifiedPublicationBlockedSource: "health" };
    expect(assertProductionIdentity({
      database: { name: "bodycast", version: "17.11", ...expected.database },
      app: { name: "bodycast-app-prod", health: "healthy", releaseSha: LEGACY_V4_RECOVERY.productionAppSha, ...expected.app },
      migrationRows: ledgerRows, schemaSha256: expected.schemaSha256, sourceFingerprint: expected.sourceFingerprint,
      lifecycle, blocks, sourceEvidence: makeSourceEvidence(), expected,
    })).toBe(true);
    expect(() => assertProductionIdentity({
      database: { name: "bodycast", version: "17.11", ...expected.database },
      app: { name: "bodycast-app-prod", health: "healthy", releaseSha: LEGACY_V4_RECOVERY.productionAppSha, ...expected.app },
      migrationRows: ledgerRows, schemaSha256: expected.schemaSha256, sourceFingerprint: expected.sourceFingerprint,
      lifecycle, blocks: blocks.slice(1), sourceEvidence: makeSourceEvidence(blocks.slice(1)), expected,
    })).toThrow();
  });

  it("accepts eight, nine, and more valid Health dates with a dynamic Training fence set", () => {
    const additionalDate = { source: "health", sourceKey: "2026-10-10", fromDate: "2026-10-10", revision: 3,
      createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" };
    expect(publicationBlockDigest(blocks)).toMatch(/^[a-f0-9]{64}$/);
    expect(publicationBlockDigest([...blocks.filter((block) => block.source === "health"),
      { ...additionalDate, fromDate: "2026-10-10", sourceKey: "2026-10-10" }, blocks.at(-1)])).toMatch(/^[a-f0-9]{64}$/);
    const tenHealthBlocks = [...blocks.filter((block) => block.source === "health"),
      ...["2026-10-09", "2026-10-10"].map((date) => ({ source: "health", sourceKey: date, fromDate: date, revision: 3,
        createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" })),
      blocks.at(-1)];
    expect(validatePublicationSourceEvidence({ blocks: tenHealthBlocks, sourceEvidence: makeSourceEvidence(tenHealthBlocks) })).toBe(true);
  });

  it("accepts a valid Training-only fence set when no Health source is blocked", () => {
    const trainingOnly = blocks.filter((block) => block.source === "training");
    expect(validatePublicationSourceEvidence({ blocks: trainingOnly, sourceEvidence: makeSourceEvidence(trainingOnly) })).toBe(true);
  });

  it("accepts both Health sync write orders while requiring valid persisted chronology", () => {
    const sourceBeforeFence = makeSourceEvidence();
    sourceBeforeFence.health[0].dailyUpdatedAt = "2026-10-19T23:59:59.000Z";
    expect(validatePublicationSourceEvidence({ blocks, sourceEvidence: sourceBeforeFence })).toBe(true);
    const invalidFenceTime = blocks.map((block, index) => index === 0
      ? { ...block, createdAt: "2026-10-21T00:00:00.000Z" } : block);
    expect(() => validatePublicationSourceEvidence({ blocks: invalidFenceTime,
      sourceEvidence: makeSourceEvidence(invalidFenceTime) })).toThrow(/timestamps/);
  });

  it("rejects missing, malformed, duplicate, unsupported, or provenance-free source fences", () => {
    expect(() => publicationBlockDigest([...blocks, blocks[0]])).toThrow(/duplicate/);
    const noTraining = blocks.filter((block) => block.source !== "training");
    expect(publicationBlockDigest(noTraining)).toMatch(/^[a-f0-9]{64}$/);
    const additionalTraining = [
      ...blocks,
      { source: "training", sourceKey: "24", fromDate: "2026-10-10", revision: 3,
        createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" },
    ];
    expect(validatePublicationSourceEvidence({ blocks: additionalTraining,
      sourceEvidence: makeSourceEvidence(additionalTraining) })).toBe(true);
    expect(() => publicationBlockDigest([...blocks, { source: "training", sourceKey: "0", fromDate: "2026-10-09", revision: 1 }])).toThrow(/unsupported or malformed/);
    expect(() => publicationBlockDigest([...blocks, { source: "health", sourceKey: "2026-02-30", fromDate: "2026-02-30", revision: 1 }])).toThrow(/unsupported or malformed/);
    expect(() => publicationBlockDigest([...blocks, { source: "day", sourceKey: "2026-10-10", fromDate: "2026-10-10", revision: 1 }])).toThrow(/unsupported or malformed/);
    expect(() => validatePublicationSourceEvidence({ blocks, sourceEvidence: { ...makeSourceEvidence(), health: makeSourceEvidence().health.slice(1) } })).toThrow(/matching source provenance/);
    expect(() => validatePublicationSourceEvidence({ blocks, sourceEvidence: makeSourceEvidence(blocks).health
      ? { ...makeSourceEvidence(), health: makeSourceEvidence().health.map((row, index) => index === 0 ? { ...row, dailyDataRows: 0 } : row) }
      : null })).toThrow(/orphaned/);
  });

  it("binds fence revisions and dates to the preflight source evidence", () => {
    const expectedDigest = publicationBlockDigest(blocks);
    const changedRevision = blocks.map((block, index) => index === 0 ? { ...block, revision: block.revision + 1 } : block);
    const changedDate = blocks.map((block, index) => index === 0 ? { ...block, sourceKey: "2026-10-11", fromDate: "2026-10-11" } : block);
    expect(publicationBlockDigest(changedRevision)).not.toBe(expectedDigest);
    expect(publicationBlockDigest(changedDate)).not.toBe(expectedDigest);
    expect(() => validatePublicationSourceEvidence({ blocks: changedRevision, sourceEvidence: makeSourceEvidence() })).toThrow(/persisted snapshot provenance/);
    expect(() => validatePublicationSourceEvidence({ blocks: changedDate, sourceEvidence: makeSourceEvidence() })).toThrow(/persisted snapshot provenance/);
    const invalidTimeZone = makeSourceEvidence();
    invalidTimeZone.health[0].snapshotsWithValidTimeZone = 1;
    invalidTimeZone.health[0].invalidSnapshotTimeZones = 1;
    expect(() => validatePublicationSourceEvidence({ blocks, sourceEvidence: invalidTimeZone })).toThrow(/persisted snapshot provenance/);
  });

  it("uses the shared canonical raw/fence/lifecycle binding contract", () => {
    const lifecycle = { profileId: 1, invalidationGeneration: 10, productionPublishedGeneration: 9,
      productionStaleFromDate: null, unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      unifiedRolloutEpoch: 1, unifiedPublishedGeneration: null, unifiedPublishedRolloutEpoch: null,
      unifiedPublicationBlockedFromDate: "2026-10-01", unifiedPublicationBlockedSource: "health" };
    const binding = recoveryEvidenceBinding({ sourceFingerprint: "d".repeat(64), blocks, lifecycle });
    expect(binding).toMatchObject({ contract: "bodycast-v4-recovery-evidence-binding-v1",
      rawFingerprint: "d".repeat(64), fenceDigest: publicationBlockDigest(blocks) });
    expect(binding.lifecycleDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(binding.bindingDigest).toBe(sha256(`bodycast-v4-recovery-evidence-binding-v1\n${binding.rawFingerprint}\n${binding.fenceDigest}\n${binding.lifecycleDigest}\n`));
    expect(recoveryEvidenceBinding({ sourceFingerprint: "d".repeat(64), blocks: blocks.map((block, index) => index === 0
      ? { ...block, revision: block.revision + 1 } : block), lifecycle }).bindingDigest).not.toBe(binding.bindingDigest);
    expect(recoveryEvidenceBinding({ sourceFingerprint: "d".repeat(64), blocks,
      lifecycle: { ...lifecycle, invalidationGeneration: 11 } }).bindingDigest).not.toBe(binding.bindingDigest);
  });

  it("requires Training accounting snapshot timezone and provenance to match session fallback inputs", () => {
    const sourceEvidence = makeSourceEvidence();
    expect(validatePublicationSourceEvidence({ blocks, sourceEvidence })).toBe(true);
    const changedSnapshot = { ...sourceEvidence, training: sourceEvidence.training.map((row, index) => index === 0
      ? { ...row, snapshotTimeZone: "America/New_York", snapshotEvidenceSha256: "b".repeat(64) } : row) };
    expect(changedSnapshot.training[0].snapshotEvidenceSha256).not.toBe(sourceEvidence.training[0].snapshotEvidenceSha256);
    expect(() => validatePublicationSourceEvidence({ blocks, sourceEvidence: changedSnapshot })).toThrow(/Training session 20/);
    const changedProvenance = { ...sourceEvidence, training: sourceEvidence.training.map((row, index) => index === 0
      ? { ...row, snapshotTimeZoneProvenance: "user-selected" } : row) };
    expect(() => validatePublicationSourceEvidence({ blocks, sourceEvidence: changedProvenance })).toThrow(/Training session 20/);
    const unsupportedProvenance = { ...sourceEvidence, training: sourceEvidence.training.map((row, index) => index === 0
      ? { ...row, accountingTimeZoneProvenance: "user-selected", snapshotTimeZoneProvenance: "user-selected" } : row) };
    expect(() => validatePublicationSourceEvidence({ blocks, sourceEvidence: unsupportedProvenance })).toThrow(/Training session 20/);
  });

  it("accepts a completed LIVE PENDING session without a Workout and rejects contradictory match evidence", () => {
    const pendingBlock = { source: "training", sourceKey: "24", fromDate: "2026-10-10", revision: 4,
      createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" };
    const pendingBlocks = [...blocks.filter((block) => block.source === "health"), pendingBlock];
    const sourceEvidence = makeSourceEvidence(pendingBlocks);
    expect(sourceEvidence.training[0]).toMatchObject({
      sessionId: 24, status: "COMPLETED", entryMode: "LIVE", matchStatus: "PENDING",
      matchedWorkoutId: null, matchedWorkoutPresent: false, matchedWorkoutIdentityMatches: true,
      effectiveAccountingAt: "2026-10-10T22:30:00.000Z", modelDate: "2026-10-10",
      accountingEffectiveLocalDate: "2026-10-11", snapshotEffectiveLocalDate: "2026-10-11",
    });
    expect(validatePublicationSourceEvidence({ blocks: pendingBlocks, sourceEvidence })).toBe(true);

    const retrospectiveUnmatched = { ...sourceEvidence, training: sourceEvidence.training.map((row) => ({
      ...row, entryMode: "RETROSPECTIVE", matchStatus: "UNMATCHED",
    })) };
    expect(validatePublicationSourceEvidence({ blocks: pendingBlocks, sourceEvidence: retrospectiveUnmatched })).toBe(true);
    const retrospectivePending = { ...sourceEvidence, training: sourceEvidence.training.map((row) => ({
      ...row, entryMode: "RETROSPECTIVE",
    })) };
    expect(() => validatePublicationSourceEvidence({ blocks: pendingBlocks, sourceEvidence: retrospectivePending }))
      .toThrow(/Training session 24/);

    const withInventedWorkout = { ...sourceEvidence, training: sourceEvidence.training.map((row) => ({
      ...row, matchedWorkoutId: 99, matchedWorkoutPresent: true, matchedWorkoutIdentityMatches: true,
      matchedWorkoutStartAt: "2026-10-10T22:30:00.000Z",
    })) };
    expect(() => validatePublicationSourceEvidence({ blocks: pendingBlocks, sourceEvidence: withInventedWorkout })).toThrow(/Training session 24/);
    const missingMatchedWorkout = { ...sourceEvidence, training: sourceEvidence.training.map((row) => ({
      ...row, matchStatus: "MATCHED", matchedWorkoutId: 79, matchedWorkoutPresent: false,
      matchedWorkoutIdentityMatches: false,
    })) };
    expect(() => validatePublicationSourceEvidence({ blocks: pendingBlocks, sourceEvidence: missingMatchedWorkout })).toThrow(/Training session 24/);
    const staleAccounting = { ...sourceEvidence, training: sourceEvidence.training.map((row) => ({
      ...row, snapshotContractValid: false, snapshotAccountingInputRevision: row.accountingInputRevision - 1,
    })) };
    expect(() => validatePublicationSourceEvidence({ blocks: pendingBlocks, sourceEvidence: staleAccounting })).toThrow(/Training session 24/);
  });

  it("requires an existing supported strength Workout with persisted source provenance for MATCHED sessions", () => {
    const matchedEvidence = makeSourceEvidence();
    expect(validatePublicationSourceEvidence({ blocks, sourceEvidence: matchedEvidence })).toBe(true);
    for (const invalid of [
      { matchedWorkoutTypeSupported: false },
      { matchedWorkoutSourceIdentitySha256: null },
      { matchedWorkoutSourceHealthDate: null },
    ]) {
      const sourceEvidence = { ...matchedEvidence, training: matchedEvidence.training.map((row, index) => index === 0
        ? { ...row, ...invalid } : row) };
      expect(() => validatePublicationSourceEvidence({ blocks, sourceEvidence })).toThrow(/Training session 20/);
    }
  });

  it("accepts legacy NULL session accounting timestamps only when the persisted snapshot follows fallback clocks", () => {
    const pendingBlock = { source: "training", sourceKey: "24", fromDate: "2026-10-10", revision: 4,
      createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" };
    const pendingBlocks = [...blocks.filter((block) => block.source === "health"), pendingBlock];
    const sourceEvidence = makeSourceEvidence(pendingBlocks);
    sourceEvidence.training[0] = {
      ...sourceEvidence.training[0],
      persistedEffectiveAccountingAt: null,
      matchedWorkoutStartAt: null,
      webStartedAt: "2026-10-10T22:30:00.000Z",
      effectiveAccountingAt: "2026-10-10T22:30:00.000Z",
      trainingEventAt: "2026-10-10T22:30:00.000Z",
      modelDate: "2026-10-10",
      accountingEffectiveLocalDate: "2026-10-11",
      snapshotEffectiveLocalDate: "2026-10-11",
    };
    expect(validatePublicationSourceEvidence({ blocks: pendingBlocks, sourceEvidence })).toBe(true);
    const driftedSnapshot = { ...sourceEvidence, training: sourceEvidence.training.map((row) => ({
      ...row, effectiveAccountingAt: "2026-10-11T22:30:00.000Z",
    })) };
    expect(() => validatePublicationSourceEvidence({ blocks: pendingBlocks, sourceEvidence: driftedSnapshot }))
      .toThrow(/Training session 24/);
    const malformedPersistedTimestamp = { ...sourceEvidence, training: sourceEvidence.training.map((row) => ({
      ...row, persistedEffectiveAccountingAt: "not-a-timestamp",
    })) };
    expect(() => validatePublicationSourceEvidence({ blocks: pendingBlocks, sourceEvidence: malformedPersistedTimestamp }))
      .toThrow(/Training session 24/);
  });

  it("requires a deterministic one-to-one mapping between Training fences and persisted sessions", () => {
    const training24 = { source: "training", sourceKey: "24", fromDate: "2026-10-10", revision: 2,
      createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" };
    const training25 = { ...training24, sourceKey: "25", revision: 3, fromDate: "2026-10-11" };
    const dynamicBlocks = [...blocks, training24, training25];
    const sourceEvidence = makeSourceEvidence(dynamicBlocks);
    expect(sourceEvidence.training.map((row) => row.sessionId)).toEqual([20, 24, 25]);
    expect(validatePublicationSourceEvidence({ blocks: dynamicBlocks, sourceEvidence })).toBe(true);
    expect(() => validatePublicationSourceEvidence({ blocks: dynamicBlocks,
      sourceEvidence: { ...sourceEvidence, training: [...sourceEvidence.training].reverse() } })).toThrow(/canonical session\/source-key order/);
    expect(() => validatePublicationSourceEvidence({ blocks: dynamicBlocks,
      sourceEvidence: { ...sourceEvidence, training: sourceEvidence.training.slice(0, 2) } })).toThrow(/exactly one/);
    expect(() => validatePublicationSourceEvidence({ blocks: dynamicBlocks,
      sourceEvidence: { ...sourceEvidence, training: [...sourceEvidence.training, sourceEvidence.training[0]] } })).toThrow(/exactly one/);
  });

  it("parses only canonical persisted Training session and deletion identities", () => {
    expect(parseTrainingFenceIdentity("20")).toEqual({ sessionId: 20, identity: "session", childId: null });
    expect(parseTrainingFenceIdentity("training-delete-session:20")).toEqual({ sessionId: 20, identity: "deleted-session", childId: null });
    expect(parseTrainingFenceIdentity("training-delete-set:20:45")).toEqual({ sessionId: 20, identity: "deleted-set", childId: 45 });
    expect(parseTrainingFenceIdentity("training-delete-exercise:20:46")).toEqual({ sessionId: 20, identity: "deleted-exercise", childId: 46 });
    for (const malformed of ["0", "020", "training-delete-session:0", "training-delete-set:020:45",
      "training-delete-exercise:20:0", "training-delete-set:9007199254740992:1", "training-delete-unknown:20:1"]) {
      expect(parseTrainingFenceIdentity(malformed)).toBeNull();
    }
  });

  it.each([
    ["one set deletion", ["training-delete-set:20:45"], 1],
    ["one exercise deletion", ["training-delete-exercise:20:46"], 1],
    ["multiple set and exercise deletions", ["training-delete-set:20:45", "training-delete-exercise:20:46"], 2],
  ])("accepts %s only when every deletion explains the exact accounting revision gap", (_label, childKeys, gap) => {
    const fromDate = "2026-10-09";
    const trainingBlocks = [
      { ...blocks.at(-1), sourceKey: "20", fromDate, revision: 4 },
      ...childKeys.map((sourceKey, index) => ({ ...blocks.at(-1), sourceKey, fromDate, revision: 23 + index })),
    ].sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
    const base = makeTrainingSource(trainingBlocks[0]);
    const historical = {
      ...base, currentSnapshotRevision: null, accountingInputRevision: base.latestSnapshotAccountingInputRevision + gap,
      accountingSnapshotRows: 0, snapshotRevision: null, snapshotAccountingInputRevision: null,
      snapshotEffectiveLocalDate: null, snapshotTimeZone: null, snapshotTimeZoneValid: false,
      snapshotTimeZoneProvenance: null, snapshotContractValid: false, snapshotEvidenceSha256: null,
      accountingRevisionGap: gap, chronologyValid: false,
    };
    const sourceEvidence = {
      health: [],
      training: trainingBlocks.map((block) => ({
        ...historical,
        sourceKey: block.sourceKey, fromDate: block.fromDate, fenceRevision: block.revision,
        identity: parseTrainingFenceIdentity(block.sourceKey).identity,
        childDeletionAccountingInputRevision: parseTrainingFenceIdentity(block.sourceKey).childId === null
          ? null : block.revision,
        childRows: parseTrainingFenceIdentity(block.sourceKey).childId === null ? null : 0,
        childOwnerSessionId: null,
      })),
    };
    expect(validatePublicationSourceEvidence({ blocks: trainingBlocks, sourceEvidence })).toBe(true);
    expect(() => validatePublicationSourceEvidence({ blocks: trainingBlocks, sourceEvidence: {
      ...sourceEvidence, training: sourceEvidence.training.map((row) => row.identity === "deleted-set"
        || row.identity === "deleted-exercise" ? { ...row, childRows: 1 } : row),
    } })).toThrow(/live, orphaned, or mismatched child/);
  });

  it("rejects unexplained accounting revisions, stale history, pending work, and mismatched child owners", () => {
    const trainingBlocks = [
      { ...blocks.at(-1), sourceKey: "20", fromDate: "2026-10-09", revision: 4 },
      { ...blocks.at(-1), sourceKey: "training-delete-set:20:45", fromDate: "2026-10-09", revision: 23 },
    ];
    const base = makeTrainingSource(trainingBlocks[0]);
    const stale = { ...base, currentSnapshotRevision: null, accountingInputRevision: 23,
      accountingSnapshotRows: 0, snapshotRevision: null, snapshotAccountingInputRevision: null,
      snapshotEffectiveLocalDate: null, snapshotTimeZone: null, snapshotTimeZoneValid: false,
      snapshotTimeZoneProvenance: null, snapshotContractValid: false, snapshotEvidenceSha256: null,
      accountingRevisionGap: 1, chronologyValid: false };
    const evidence = {
      health: [], training: trainingBlocks.map((block) => ({ ...stale, sourceKey: block.sourceKey,
        fromDate: block.fromDate, fenceRevision: block.revision,
        identity: parseTrainingFenceIdentity(block.sourceKey).identity,
        childDeletionAccountingInputRevision: parseTrainingFenceIdentity(block.sourceKey).childId === null
          ? null : block.revision,
        childRows: block.sourceKey === "20" ? null : 0, childOwnerSessionId: null })),
    };
    expect(validatePublicationSourceEvidence({ blocks: trainingBlocks, sourceEvidence: evidence })).toBe(true);
    for (const invalid of [
      { accountingRevisionGap: 2 },
      { accountingInputRevision: 24 },
      { pendingAccountingOperationRows: 1 },
      { latestSnapshotContractValid: false },
      { historicalSnapshotChronologyValid: false },
    ]) {
      const candidate = { ...evidence, training: evidence.training.map((row) => ({ ...row, ...invalid })) };
      expect(() => validatePublicationSourceEvidence({ blocks: trainingBlocks, sourceEvidence: candidate }))
        .toThrow(/exact persisted child-delete proof/);
    }
    const invalidFenceChronology = { ...evidence, training: evidence.training.map((row) => ({
      ...row, sourceFenceChronologyValid: false,
    })) };
    expect(() => validatePublicationSourceEvidence({ blocks: trainingBlocks, sourceEvidence: invalidFenceChronology }))
      .toThrow(/malformed publication-fence timestamp range/);
    const wrongOwner = { ...evidence, training: evidence.training.map((row) => row.childRows === 0
      ? { ...row, childOwnerSessionId: 999 } : row) };
    expect(() => validatePublicationSourceEvidence({ blocks: trainingBlocks, sourceEvidence: wrongOwner }))
      .toThrow(/live, orphaned, or mismatched child/);
    expect(() => validatePublicationSourceEvidence({ blocks: trainingBlocks.slice(1),
      sourceEvidence: { health: [], training: [evidence.training[1]] } })).toThrow(/malformed persisted parent/);
  });

  it("accepts a verified current accounting snapshot while exact deleted-child fences remain", () => {
    const trainingBlocks = [
      { ...blocks.at(-1), sourceKey: "20", fromDate: "2026-10-09", revision: 5 },
      { ...blocks.at(-1), sourceKey: "training-delete-set:20:45", fromDate: "2026-10-08", revision: 1 },
    ];
    const sourceEvidence = makeSourceEvidence(trainingBlocks);
    sourceEvidence.training[1] = {
      ...sourceEvidence.training[1],
      childRows: 0,
      childOwnerSessionId: null,
    };
    // The child fence is historical: the parent and numeric fence can be
    // updated afterward while its own timestamp range remains valid.
    sourceEvidence.training[1] = {
      ...sourceEvidence.training[1], sourceFenceChronologyValid: true,
      modelDate: sourceEvidence.training[0].modelDate,
      sessionUpdateFenceChronologyValid: false, chronologyValid: false,
    };
    // A child deletion may preserve an earlier event boundary while a later
    // parent/session invalidation writes the numeric retry fence. The complete
    // group must retain both dates so replay starts at the minimum boundary.
    expect(validatePublicationSourceEvidence({ blocks: trainingBlocks, sourceEvidence })).toBe(true);
    expect(() => validatePublicationSourceEvidence({ blocks: trainingBlocks, sourceEvidence: {
      ...sourceEvidence,
      training: sourceEvidence.training.map((row) => row.sourceKey === "20"
        ? { ...row, accountingRevisionGap: 1 } : row),
    } })).toThrow(/inconsistent source or snapshot evidence/);
  });

  it("counts only child deletions newer than the latest snapshot and rejects a compensated unexplained mutation", () => {
    const fromDate = "2026-10-09";
    const trainingBlocks = [
      { ...blocks.at(-1), sourceKey: "20", fromDate, revision: 6 },
      { ...blocks.at(-1), sourceKey: "training-delete-set:20:45", fromDate, revision: 23 },
      { ...blocks.at(-1), sourceKey: "training-delete-set:20:46", fromDate, revision: 24 },
    ];
    const base = makeTrainingSource(trainingBlocks[0]);
    const latestSnapshotAccountingInputRevision = base.latestSnapshotAccountingInputRevision;
    const missing = {
      ...base, currentSnapshotRevision: null, accountingInputRevision: latestSnapshotAccountingInputRevision + 2,
      accountingSnapshotRows: 0, snapshotRevision: null, snapshotAccountingInputRevision: null,
      snapshotEffectiveLocalDate: null, snapshotTimeZone: null, snapshotTimeZoneValid: false,
      snapshotTimeZoneProvenance: null, snapshotContractValid: false, snapshotEvidenceSha256: null,
      accountingRevisionGap: 2, chronologyValid: false,
    };
    const evidenceFor = (testBlocks, revisionForFirstFence) => ({ health: [], training: testBlocks.map((block) => {
      const identity = parseTrainingFenceIdentity(block.sourceKey);
      return {
        ...missing,
        sourceKey: block.sourceKey, fromDate: block.fromDate, fenceRevision: block.revision,
        identity: identity.identity, childDeletionAccountingInputRevision: identity.childId === null
          ? null : block.sourceKey.endsWith(":45") ? revisionForFirstFence : block.revision,
        childRows: identity.childId === null ? null : 0, childOwnerSessionId: null,
      };
    }) });
    const accepted = evidenceFor(trainingBlocks, latestSnapshotAccountingInputRevision + 1);
    expect(validatePublicationSourceEvidence({ blocks: trainingBlocks, sourceEvidence: accepted })).toBe(true);

    // The first fence is from a delete included by a later valid snapshot;
    // the second is after it. An unrelated accounting mutation consumes the
    // second gap slot without a corresponding deletion revision.
    const compensatedBlocks = trainingBlocks.map((block) => block.sourceKey.endsWith(":45")
      ? { ...block, revision: latestSnapshotAccountingInputRevision - 1 } : block);
    const compensated = evidenceFor(compensatedBlocks, latestSnapshotAccountingInputRevision - 1);
    expect(() => validatePublicationSourceEvidence({ blocks: compensatedBlocks, sourceEvidence: compensated }))
      .toThrow(/exact persisted child-delete proof/);

    const duplicateRevisionBlocks = trainingBlocks.map((block) => block.sourceKey.endsWith(":46")
      ? { ...block, revision: latestSnapshotAccountingInputRevision + 1 } : block);
    const duplicateRevision = evidenceFor(duplicateRevisionBlocks, latestSnapshotAccountingInputRevision + 1);
    expect(() => validatePublicationSourceEvidence({ blocks: duplicateRevisionBlocks, sourceEvidence: duplicateRevision }))
      .toThrow(/exact persisted child-delete proof/);
  });

  it("accepts a hard-deleted completed session only with numeric fence and durable tombstone", () => {
    const fromDate = "2026-10-09";
    const trainingBlocks = [
      { ...blocks.at(-1), sourceKey: "20", fromDate, revision: 5 },
      { ...blocks.at(-1), sourceKey: "training-delete-session:20", fromDate, revision: 1 },
      { ...blocks.at(-1), sourceKey: "training-delete-set:20:45", fromDate: "2026-10-10", revision: 2 },
    ];
    const emptyParent = (block) => ({
      ...makeTrainingSource(block),
      sessionRows: 0, profileId: null, status: null, entryMode: null, sourceRevision: null,
      accountingInputRevision: null, currentSnapshotRevision: null, createdAt: null,
      persistedEffectiveAccountingAt: null, webStartedAt: null, trainingEventAt: null,
      matchedWorkoutStartAt: null, effectiveAccountingAt: null, matchedWorkoutId: null,
      matchStatus: null, matchedWorkoutPresent: false, matchedWorkoutIdentityMatches: false,
      matchedWorkoutTypeSupported: false, matchedWorkoutSourceIdentitySha256: null,
      matchedWorkoutSourceHealthDate: null, modelDate: null, accountingEffectiveLocalDate: null,
      accountingSnapshotRows: 0, snapshotRevision: null, snapshotAccountingInputRevision: null,
      snapshotEffectiveLocalDate: null, snapshotTimeZone: null, snapshotTimeZoneValid: false,
      snapshotTimeZoneProvenance: null, snapshotContractValid: false, snapshotEvidenceSha256: null,
      latestSnapshotRows: 0, latestSnapshotRevision: null, latestSnapshotAccountingInputRevision: null,
      latestSnapshotEffectiveLocalDate: null, latestSnapshotTimeZone: null, latestSnapshotTimeZoneValid: false,
      latestSnapshotTimeZoneProvenance: null, latestSnapshotContractValid: false,
      latestSnapshotEvidenceSha256: null, historicalSnapshotChronologyValid: false,
      pendingAccountingOperationRows: 0, accountingRevisionGap: null, chronologyValid: false,
      childDeletionAccountingInputRevision: parseTrainingFenceIdentity(block.sourceKey).childId === null ? null : block.revision,
      sessionUpdateFenceChronologyValid: false,
      parentSessionRows: 0, parentSessionId: null, parentProfileId: null, parentStatus: null,
      childRows: parseTrainingFenceIdentity(block.sourceKey).childId === null ? null : 0,
      childOwnerSessionId: null,
    });
    const sourceEvidence = { health: [], training: trainingBlocks.map(emptyParent) };
    expect(validatePublicationSourceEvidence({ blocks: trainingBlocks, sourceEvidence })).toBe(true);
    expect(() => validatePublicationSourceEvidence({ blocks: [trainingBlocks[0]],
      sourceEvidence: { health: [], training: [emptyParent(trainingBlocks[0])] } }))
      .toThrow(/numeric-fence and deletion-tombstone pair/);
    expect(() => validatePublicationSourceEvidence({ blocks: trainingBlocks,
      sourceEvidence: { ...sourceEvidence, training: sourceEvidence.training.map((row) => row.sourceKey === "training-delete-set:20:45"
        ? { ...row, childRows: 1 } : row) } })).toThrow(/numeric-fence and deletion-tombstone pair/);
    expect(() => validatePublicationSourceEvidence({ blocks: trainingBlocks,
      sourceEvidence: { ...sourceEvidence, training: sourceEvidence.training.map((row) => row.sourceKey === "training-delete-set:20:45"
        ? { ...row, parentSessionRows: 1, parentSessionId: 20, parentProfileId: 1, parentStatus: "COMPLETED" } : row) } }))
      .toThrow(/inconsistent source or snapshot evidence/);
    const earlierChildBoundary = trainingBlocks.map((block) => block.sourceKey === "training-delete-set:20:45"
      ? { ...block, fromDate: "2026-10-08" } : block);
    expect(validatePublicationSourceEvidence({ blocks: earlierChildBoundary, sourceEvidence: {
      health: [], training: earlierChildBoundary.map((block) => emptyParent(block)),
    } })).toBe(true);
    const mismatchedDeletionBoundary = earlierChildBoundary.map((block) => block.sourceKey === "training-delete-session:20"
      ? { ...block, fromDate: "2026-10-10" } : block);
    expect(() => validatePublicationSourceEvidence({ blocks: mismatchedDeletionBoundary, sourceEvidence: {
      health: [], training: mismatchedDeletionBoundary.map((block) => emptyParent(block)),
    } })).toThrow(/numeric-fence and deletion-tombstone pair/);
  });

  it("uses the matched workout event date for its fence while validating accounting by its own timestamp", () => {
    const eventModelDate = "2026-10-10";
    const accountingDate = "2026-10-09";
    const trainingEventAt = "2026-10-10T00:30:00.000Z";
    const effectiveAccountingAt = "2026-10-09T20:30:00.000Z";
    const withFenceDate = (fromDate) => {
      const datedBlocks = blocks.map((block) => block.source === "training" ? { ...block, fromDate } : block);
      const sourceEvidence = makeSourceEvidence(datedBlocks);
      sourceEvidence.training[0] = {
        ...sourceEvidence.training[0],
        fromDate,
        matchedWorkoutStartAt: trainingEventAt,
        trainingEventAt,
        persistedEffectiveAccountingAt: effectiveAccountingAt,
        modelDate: eventModelDate,
        effectiveAccountingAt,
        accountingEffectiveLocalDate: accountingDate,
        snapshotEffectiveLocalDate: accountingDate,
      };
      return { blocks: datedBlocks, sourceEvidence };
    };

    // The fence date follows the legacy writer's matchedWorkout.startAt date;
    // its accounting snapshot remains bound to effectiveAccountingAt.
    const exactEventDate = withFenceDate(eventModelDate);
    expect(exactEventDate.sourceEvidence.training[0].snapshotEffectiveLocalDate)
      .not.toBe(exactEventDate.sourceEvidence.training[0].modelDate);
    expect(validatePublicationSourceEvidence(exactEventDate)).toBe(true);

    // Repeated invalidation preserves an earlier persisted fromDate via min().
    expect(validatePublicationSourceEvidence(withFenceDate(accountingDate))).toBe(true);

    // A fence after the event date cannot be produced by the legacy writer.
    expect(() => validatePublicationSourceEvidence(withFenceDate("2026-10-11")))
      .toThrow(/Training session 20/);
    const wrongEventTimestamp = exactEventDate.sourceEvidence;
    wrongEventTimestamp.training[0].trainingEventAt = effectiveAccountingAt;
    expect(() => validatePublicationSourceEvidence(exactEventDate)).toThrow(/Training session 20/);
  });

  it("binds final V4 coverage exactly to the successful rehearsal output", () => {
    const modelDayKeys = ["1|2026-10-01", "2|2026-10-01", "2|2026-10-02"];
    const result = { beforeFingerprint: "a".repeat(64), afterFingerprint: "a".repeat(64), existingEpoch: 1,
      lifecycle: { unifiedRolloutEpoch: 1, unifiedPublishedRolloutEpoch: 1,
        unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
        unifiedPublishedGeneration: 8, unifiedPublicationBlockedFromDate: null,
        productionStaleFromDate: null, invalidationGeneration: 8, productionPublishedGeneration: 8 },
      blocks: 0, coveredModelDayCount: 3, expectedModelDayCount: 3,
      coveredModelDayKeys: modelDayKeys, expectedModelDayKeys: modelDayKeys,
      rehearsalCoveredModelDayKeys: modelDayKeys, rehearsalCoverageSha256: modelDayKeysDigest(modelDayKeys) };
    expect(assertRecoveryPostflight(result)).toBe(true);
    const replayTail = [...modelDayKeys, "2|2026-10-03", "2|2026-10-04"];
    expect(assertRecoveryPostflight({ ...result, coveredModelDayCount: replayTail.length,
      coveredModelDayKeys: replayTail, rehearsalCoveredModelDayKeys: replayTail,
      rehearsalCoverageSha256: modelDayKeysDigest(replayTail) })).toBe(true);
    expect(assertRehearsedCoverageEvidence({ sourceModelDayKeys: modelDayKeys,
      coveredModelDayKeys: replayTail, coverageSha256: modelDayKeysDigest(replayTail) })).toBe(true);
    expect(() => assertRecoveryPostflight({ ...result, coveredModelDayCount: replayTail.length,
      coveredModelDayKeys: replayTail })).toThrow(/rehearsed coverage/);
    expect(() => assertRehearsedCoverageEvidence({ sourceModelDayKeys: modelDayKeys,
      coveredModelDayKeys: [...replayTail, "2|2026-10-05"], coverageSha256: modelDayKeysDigest(replayTail) })).toThrow();
    for (const changed of [
      { afterFingerprint: "b".repeat(64) }, { existingEpoch: 2 },
      { lifecycle: { ...result.lifecycle, unifiedRolloutEpoch: 2 } },
      { lifecycle: { ...result.lifecycle, productionStaleFromDate: "2026-10-18" } },
      { blocks: 1 }, { coveredModelDayCount: 364 },
      { coveredModelDayKeys: ["1|2026-10-01", "2|2026-10-02", "2|2026-10-03"] },
      { coveredModelDayKeys: [...modelDayKeys, "2|2026-02-30"] },
      { coveredModelDayKeys: [...modelDayKeys, modelDayKeys[0]] },
      { expectedModelDayKeys: ["1|2026-10-01", "2|2026-10-01", "2|2026-10-01"] },
    ]) expect(() => assertRecoveryPostflight({ ...result, ...changed })).toThrow();
  });

  it("requires a fresh successful preflight and a never-started one-shot marker under the release lock", () => {
    const state = { marker: { state: "ready", sourceSha: LEGACY_V4_RECOVERY.sourceSha, preflightRunId: "7001",
      workflowSha: "a".repeat(40), terminal: false }, lockHeld: true, preflightRunId: "7001",
      preflightSha: "a".repeat(40), preflightConclusion: "success", preflightAgeSeconds: 45, currentRunAttempt: "1" };
    expect(assertOneShotRecoveryState(state)).toBe(true);
    for (const changed of [
      { lockHeld: false }, { currentRunAttempt: "2" }, { preflightConclusion: "failure" },
      { preflightAgeSeconds: 3601 }, { marker: { ...state.marker, startedAt: "2026-10-19T00:00:00Z" } },
      { marker: { ...state.marker, terminal: true } }, { preflightRunId: "7002" },
    ]) expect(() => assertOneShotRecoveryState({ ...state, ...changed })).toThrow();
  });

  it("rejects an unverified or drifted live schema signature", () => {
    expect(assertSchemaSignature({ observed: "a".repeat(64), expected: "a".repeat(64), objectCount: 150 })).toBe(true);
    expect(() => assertSchemaSignature({ observed: "a".repeat(64), expected: "b".repeat(64), objectCount: 150 })).toThrow();
    expect(() => assertSchemaSignature({ observed: "a".repeat(64), expected: "a".repeat(64), objectCount: 0 })).toThrow();
  });

  it("rejects impossible Health fence dates instead of accepting malformed block identities", () => {
    expect(() => publicationBlockDigest([{ source: "health", sourceKey: "2026-02-30", fromDate: "2026-02-30", revision: 1 },
      { source: "training", sourceKey: "20", fromDate: "2026-02-01", revision: 1 }])).toThrow();
  });

  it("accepts actual NULL V4 publication generation but rejects a missing lifecycle field", () => {
    const expected = {
      ledgerDigest: migrationLedgerDigest(ledgerRows), schemaSha256: "c".repeat(64), sourceFingerprint: "d".repeat(64),
      blockDigest: publicationBlockDigest(blocks),
      database: { containerId: "e".repeat(64), imageId: `sha256:${"f".repeat(64)}` },
      app: { containerId: "1".repeat(64), imageId: `sha256:${"2".repeat(64)}` },
    };
    const args = { database: { name: "bodycast", version: "17.11", ...expected.database },
      app: { name: "bodycast-app-prod", health: "healthy", releaseSha: LEGACY_V4_RECOVERY.productionAppSha, ...expected.app },
      migrationRows: ledgerRows, schemaSha256: expected.schemaSha256, sourceFingerprint: expected.sourceFingerprint,
      blocks, sourceEvidence: makeSourceEvidence(), expected };
    const lifecycle = { profileId: 1, unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      unifiedRolloutEpoch: 1, invalidationGeneration: 10, productionPublishedGeneration: 9,
      unifiedPublishedGeneration: null, unifiedPublishedRolloutEpoch: null,
      unifiedPublicationBlockedFromDate: "2026-10-01", unifiedPublicationBlockedSource: "health" };
    expect(assertProductionIdentity({ ...args, lifecycle })).toBe(true);
    const missingGeneration = { ...lifecycle };
    delete missingGeneration.unifiedPublishedGeneration;
    expect(() => assertProductionIdentity({ ...args, lifecycle: missingGeneration })).toThrow(/stale/);
  });

  it("admits only a completed no-app 74-schema recovery with current database, raw and coverage evidence for serving", () => {
    const releaseSha = "a".repeat(40);
    const migrationTree = "b".repeat(40);
    const prismaSchemaBlob = "c".repeat(40);
    const ledgerDigest = "d".repeat(64);
    const schemaSha256 = "e".repeat(64);
    const databaseContainerId = "f".repeat(64);
    const databaseImageId = `sha256:${"1".repeat(64)}`;
    const modelDayKeys = ["1|2026-10-01", "1|2026-10-02"];
    const marker = {
      state: "completed", result: "current", sourceSha: LEGACY_V4_RECOVERY.sourceSha,
      workflowSha: releaseSha, attempt: "1", ownerRunId: "12345", appMode: "maintenance-no-app",
      rolloutEpoch: 1, unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      unifiedPublicationBlockedFromDate: null, blocksRemaining: 0, unifiedPublishedGeneration: 12,
      productionPublishedGeneration: 12, sourceFingerprint: "2".repeat(64),
      rehearsalCoverageSha256: modelDayKeysDigest(modelDayKeys), schemaSha256, postflightSchemaSha256: schemaSha256,
      schemaDigestContract: "bodycast-v4-schema-digest-v1", schemaDigestHelperSha256: "3".repeat(64),
      databaseContainerId, databaseImageId, sourceModelDayCount: modelDayKeys.length,
      coveredDayCount: modelDayKeys.length, sourceModelDayKeys: modelDayKeys, coveredModelDayKeys: modelDayKeys,
      targetSchema: { mode: "maintenance-no-app-74", migrationCount: 74, ledgerDigest, migrationTree, prismaSchemaBlob },
    };
    const expected = { marker, releaseSha, migrationTree, prismaSchemaBlob, ledgerDigest, schemaSha256,
      sourceFingerprint: marker.sourceFingerprint, databaseContainerId, databaseImageId,
      schemaDigestContract: marker.schemaDigestContract, schemaDigestHelperSha256: marker.schemaDigestHelperSha256 };
    expect(assertCompletedV4RecoveryForServe(expected)).toBe(true);
    for (const changed of [
      { marker: { ...marker, state: "terminal-failed" } },
      { marker: { ...marker, workflowSha: "9".repeat(40) } },
      { releaseSha: "9".repeat(40) },
      { marker: { ...marker, appMode: "serving" } },
      { marker: { ...marker, result: "failed" } },
      { sourceFingerprint: "9".repeat(64) },
      { marker: { ...marker, unifiedPublishedGeneration: 11 } },
      { marker: { ...marker, blocksRemaining: 1 } },
      { migrationTree: "9".repeat(40) },
      { prismaSchemaBlob: "9".repeat(40) },
      { ledgerDigest: "9".repeat(64) },
      { schemaSha256: "9".repeat(64) },
      { schemaDigestHelperSha256: "9".repeat(64) },
      { databaseContainerId: "9".repeat(64) },
      { marker: { ...marker, coveredModelDayKeys: [modelDayKeys[0]], coveredDayCount: 1 } },
    ]) expect(() => assertCompletedV4RecoveryForServe({ ...expected, ...changed })).toThrow(/completed.*V4 recovery/i);
  });

});
