import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEGACY_V4_RECOVERY,
  assertApprovedRecoveryRuns,
  assertArtifactBinding,
  assertProductionIdentity,
  assertRecoveryPostflight,
  assertOneShotRecoveryState,
  assertSchemaSignature,
  migrationLedgerDigest,
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
    fromDate: `2026-10-${String(i + 1).padStart(2, "0")}`, revision: 1 })),
  { source: "training", sourceKey: "20", fromDate: "2026-10-16", revision: 2 },
];
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
    expect(assertProductionIdentity({
      database: { name: "bodycast", version: "17.11", ...expected.database },
      app: { name: "bodycast-app-prod", health: "healthy", releaseSha: LEGACY_V4_RECOVERY.productionAppSha, ...expected.app },
      migrationRows: ledgerRows, schemaSha256: expected.schemaSha256, sourceFingerprint: expected.sourceFingerprint,
      lifecycle: { profileId: 1, unifiedRolloutEpoch: 1, invalidationGeneration: 10, productionPublishedGeneration: 9 },
      blocks, sourceRowsValid: true, expected,
    })).toBe(true);
    expect(() => assertProductionIdentity({
      database: { name: "bodycast", version: "17.11", ...expected.database },
      app: { name: "bodycast-app-prod", health: "healthy", releaseSha: LEGACY_V4_RECOVERY.productionAppSha, ...expected.app },
      migrationRows: ledgerRows, schemaSha256: expected.schemaSha256, sourceFingerprint: expected.sourceFingerprint,
      lifecycle: { profileId: 1, unifiedRolloutEpoch: 1, invalidationGeneration: 10, productionPublishedGeneration: 9 },
      blocks: blocks.slice(1), sourceRowsValid: true, expected,
    })).toThrow();
  });

  it("rejects duplicate or changed persisted fence identities", () => {
    expect(() => publicationBlockDigest([...blocks, blocks[0]])).toThrow(/duplicate/);
    expect(() => publicationBlockDigest(blocks.filter((block) => block.sourceKey !== "20"))).toThrow(/Training/);
    expect(() => publicationBlockDigest(blocks.filter((block) => block.source === "training"))).toThrow(/exactly 8 Health dates/);
    expect(() => publicationBlockDigest(blocks.filter((block) => block.sourceKey !== "2026-10-08"))).toThrow(/exactly 8 Health dates/);
    expect(() => publicationBlockDigest([...blocks, { source: "health", sourceKey: "2026-10-09",
      fromDate: "2026-10-09", revision: 1 }])).toThrow(/exactly 8 Health dates/);
  });

  it("rejects changed raw rows, reset epoch, stale generations, leftover blocks and incomplete coverage", () => {
    const dates = ["2026-10-01", "2026-10-02", "2026-10-03"];
    const result = { beforeFingerprint: "a".repeat(64), afterFingerprint: "a".repeat(64), existingEpoch: 1,
      lifecycle: { unifiedRolloutEpoch: 1, unifiedPublishedRolloutEpoch: 1,
        unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
        unifiedPublishedGeneration: 8, unifiedPublicationBlockedFromDate: null,
        productionStaleFromDate: null, invalidationGeneration: 8, productionPublishedGeneration: 8 },
      blocks: 0, coveredDayCount: 3, persistedDayCount: 3, coveredDates: dates, persistedDates: dates };
    expect(assertRecoveryPostflight(result)).toBe(true);
    for (const changed of [
      { afterFingerprint: "b".repeat(64) }, { existingEpoch: 2 },
      { lifecycle: { ...result.lifecycle, unifiedRolloutEpoch: 2 } },
      { lifecycle: { ...result.lifecycle, productionStaleFromDate: "2026-10-18" } },
      { blocks: 1 }, { coveredDayCount: 364 },
      { coveredDates: ["2026-10-01", "2026-10-02", "2026-10-04"] },
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
});
