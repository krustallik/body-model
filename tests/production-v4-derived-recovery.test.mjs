import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEGACY_V4_RECOVERY,
  assertApprovedRecoveryRuns,
  assertArtifactBinding,
  assertProductionIdentity,
  assertRehearsedCoverageEvidence,
  assertRecoveryPostflight,
  assertOneShotRecoveryState,
  assertSchemaSignature,
  migrationLedgerDigest,
  modelDayKeysDigest,
  validatePublicationSourceEvidence,
  publicationBlockDigest,
  sha256,
} from "../scripts/production-v4-derived-recovery.mjs";

const migrationRoot = new URL("../prisma/migrations/", import.meta.url);
const ledgerRows = readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  .map((entry) => entry.name).sort().slice(0, LEGACY_V4_RECOVERY.migrationCount).map((name) => ({
    name,
    checksum: createHash("sha256").update(readFileSync(join(migrationRoot.pathname, name, "migration.sql"))).digest("hex"),
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
    const sessionId = Number(block.sourceKey);
    const matched = sessionId === 20;
    const eventAt = matched ? "2026-10-09T12:00:00.000Z" : "2026-10-10T22:30:00.000Z";
    const accountingAt = matched ? "2026-10-09T12:00:00.000Z" : "2026-10-10T22:30:00.000Z";
    const status = matched ? "MATCHED" : "PENDING";
    return {
      sessionId, entryMode: matched ? "RETROSPECTIVE" : "LIVE", matchStatus: status,
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
  sessionRows: 1, profileId: 1, status: "COMPLETED", sourceRevision: 24,
  accountingInputRevision: 22, currentSnapshotRevision: 79, accountingSnapshotRows: 1,
  snapshotRevision: 79, snapshotAccountingInputRevision: 22, snapshotEffectiveLocalDate: Number(block.sourceKey) === 20 ? "2026-10-09" : "2026-10-11",
  accountingEffectiveLocalDate: Number(block.sourceKey) === 20 ? "2026-10-09" : "2026-10-11",
  createdAt: "2026-10-08T00:00:00.000Z",
  accountingTimeZone: "Europe/Bratislava", accountingTimeZoneProvenance: "legacy-default",
  snapshotTimeZone: "Europe/Bratislava", snapshotTimeZoneValid: true,
  snapshotTimeZoneProvenance: "legacy-default", snapshotContractValid: true, snapshotEvidenceSha256: "a".repeat(64),
  modelDate: block.fromDate,
  chronologyValid: true, ...overrides,
});
const makeSourceEvidence = (value = blocks) => ({
  health: value.filter((block) => block.source === "health").map((block) => makeHealthSource(block)),
  training: value.filter((block) => block.source === "training")
    .sort((left, right) => Number(left.sourceKey) - Number(right.sourceKey)).map((block) => makeTrainingSource(block)),
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

  it("binds the immutable image, archive, exact schema and executable command to its manifest", () => {
    const artifact = {
      sourceSha: LEGACY_V4_RECOVERY.sourceSha,
      imageId: `sha256:${"a".repeat(64)}`,
      imageDigest: `sha256:${"9".repeat(64)}`,
      archiveSha256: "b".repeat(64),
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
      sourceEvidence: { ...sourceEvidence, training: [...sourceEvidence.training].reverse() } })).toThrow(/Training session/);
    expect(() => validatePublicationSourceEvidence({ blocks: dynamicBlocks,
      sourceEvidence: { ...sourceEvidence, training: sourceEvidence.training.slice(0, 2) } })).toThrow(/exactly one/);
    expect(() => validatePublicationSourceEvidence({ blocks: dynamicBlocks,
      sourceEvidence: { ...sourceEvidence, training: [...sourceEvidence.training, sourceEvidence.training[0]] } })).toThrow(/exactly one/);
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
});
