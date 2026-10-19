import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/production-v4-derived-recovery.yml", import.meta.url), "utf8");
const host = readFileSync(new URL("../scripts/production-v4-derived-recovery-host.sh", import.meta.url), "utf8");
const image = readFileSync(new URL("../Dockerfile.v4-derived-recovery", import.meta.url), "utf8");
const evidence = readFileSync(new URL("../scripts/production-v4-recovery-evidence.ts", import.meta.url), "utf8");
const repositoryRoot = new URL("..", import.meta.url).pathname;

describe("legacy derived V4 recovery release workflow", () => {
  it("executes the final rehearsal Node step and writes bound preflight evidence", async () => {
    const rehearsalStep = workflow.split("      - name: Restore backup and rehearse exact image against isolated 65-schema PostgreSQL\n")[1]
      ?.split("      - name: Upload encrypted backup and successful restore rehearsal evidence\n")[0];
    expect(rehearsalStep).toBeDefined();
    const commandStart = rehearsalStep.indexOf("node --input-type=module - <<'NODE'\n");
    expect(commandStart).toBeGreaterThanOrEqual(0);
    const sourceStart = commandStart + "node --input-type=module - <<'NODE'\n".length;
    const sourceEnd = rehearsalStep.indexOf("\n          NODE", sourceStart);
    expect(sourceEnd).toBeGreaterThan(sourceStart);
    const nodeSource = rehearsalStep.slice(sourceStart, sourceEnd).split("\n")
      .map((line) => line.replace(/^          /, "")).join("\n");
    const tempRoot = mkdtempSync(join(tmpdir(), "bodycast-v4-rehearsal-step-"));
    const artifactRoot = join(tempRoot, "bodycast-v4-artifact");
    mkdirSync(artifactRoot);
    const capturedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const fingerprint = "a".repeat(64);
    const migrationNames = (await readdir(new URL("../prisma/migrations", import.meta.url), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().slice(0, 65);
    const migrationRows = await Promise.all(migrationNames.map(async (name) => ({
      name,
      checksum: createHash("sha256").update(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url))).digest("hex"),
      finishedAt: "2025-01-01T00:00:00.000Z", rolledBackAt: null,
    })));
    const ledgerDigest = createHash("sha256").update(migrationRows.map((row) => `${row.name}\t${row.checksum}\n`).join("")).digest("hex");
    const blocks = Array.from({ length: 8 }, (_, index) => {
      const date = `2025-01-${String(index + 1).padStart(2, "0")}`;
      return { source: "health", sourceKey: date, fromDate: date, revision: index + 1,
        createdAt: "2025-01-03T00:00:00.000Z", updatedAt: "2025-01-03T00:00:00.000Z" };
    });
    blocks.push({ source: "training", sourceKey: "20", fromDate: "2025-01-01", revision: 9,
      createdAt: "2025-01-03T00:00:00.000Z", updatedAt: "2025-01-03T00:00:00.000Z" });
    const sourceEvidence = {
      health: blocks.filter((block) => block.source === "health").map((block) => ({
        sourceKey: block.sourceKey, fromDate: block.fromDate, fenceRevision: block.revision,
        dailyDataRows: 1, snapshotRows: 1, linkedSnapshotRows: 1, invalidSnapshotRows: 0,
        snapshotsWithReceivedAt: 1, snapshotsWithSyncedAt: 1, snapshotsWithNullSyncedAt: 0, invalidSnapshotTimes: 0,
        snapshotsWithValidTimeZone: 1, invalidSnapshotTimeZones: 0,
        dailyUpdatedAt: "2025-01-03T00:00:01.000Z",
        metricSampleRows: 1,
        linkedMetricSampleRows: 1, invalidMetricSampleRows: 0, unsupportedMetricSourceRows: 0, chronologyValid: true,
      })),
      training: { sourceKey: "20", fromDate: "2025-01-01", fenceRevision: 9, sessionRows: 1,
        sessionId: 20, profileId: 1, status: "COMPLETED", sourceRevision: 1, accountingInputRevision: 1,
        currentSnapshotRevision: 1, accountingSnapshotRows: 1, snapshotRevision: 1,
        snapshotAccountingInputRevision: 1, snapshotEffectiveLocalDate: "2025-01-01",
        effectiveAccountingAt: "2025-01-01T12:00:00.000Z", accountingEffectiveLocalDate: "2025-01-01",
        accountingTimeZone: "Europe/Bratislava", accountingTimeZoneProvenance: "legacy-default",
        snapshotTimeZone: "Europe/Bratislava", snapshotTimeZoneValid: true,
        snapshotTimeZoneProvenance: "legacy-default", matchedWorkoutId: 20, matchStatus: "MATCHED",
        snapshotContractValid: true, snapshotEvidenceSha256: "a".repeat(64),
        matchedWorkoutPresent: true, matchedWorkoutIdentityMatches: true,
        matchedWorkoutStartAt: "2025-01-01T12:00:00.000Z", trainingEventAt: "2025-01-01T12:00:00.000Z",
        modelDate: "2025-01-01", chronologyValid: true },
    };
    const lifecycle = {
      invalidationGeneration: 12, productionPublishedGeneration: 12, productionStaleFromDate: null,
      unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      unifiedRolloutEpoch: 1, unifiedPublishedGeneration: 12, unifiedPublishedRolloutEpoch: 1,
      unifiedPublicationBlockedFromDate: null,
    };
    const days = ["2025-01-01", "2025-01-02"];
    const before = { database: { database: "bodycast_restore" }, migrationRows, expectedLedgerDigest: ledgerDigest,
      blocks, sourceEvidence, sourceFingerprint: fingerprint,
      lifecycle: { ...lifecycle, productionStaleFromDate: "2025-01-01", unifiedPublishedGeneration: 11, unifiedPublicationBlockedFromDate: "2025-01-01" } };
    const after = { ...before, blocks: [], lifecycle, persistedDayDates: days, coveredDayDates: days,
      persistedDayCount: days.length, coveredDayCount: days.length };
    const report = { sourceSha: "3968154f965597843b6a2c429fff178c0f1ac54c", evidence: {
      database: { database: "bodycast" }, migrationRows, expectedMigrationRows: migrationRows,
      expectedLedgerDigest: before.expectedLedgerDigest, blocks: before.blocks, sourceFingerprint: fingerprint,
      sourceEvidence, lifecycle: before.lifecycle,
    } };
    writeFileSync(join(artifactRoot, "restored-before.json"), JSON.stringify(before));
    writeFileSync(join(artifactRoot, "restored-after.json"), JSON.stringify(after));
    writeFileSync(join(artifactRoot, "rehearsal-result.json"), JSON.stringify({ command: "unified-v4-derived-recovery", rolloutEpoch: 1, rawInputFingerprint: fingerprint }));
    writeFileSync(join(artifactRoot, "preflight.json"), JSON.stringify(report));
    try {
      const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
        cwd: repositoryRoot,
        env: { ...process.env, RUNNER_TEMP: tempRoot, GITHUB_RUN_ID: "123456", GITHUB_SHA: "c".repeat(40), BACKUP_STARTED_AT: capturedAt },
        input: nodeSource,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      const preflight = JSON.parse(readFileSync(join(artifactRoot, "preflight.json"), "utf8"));
      expect(preflight).toMatchObject({ preflightRunId: "123456", preflightSha: "c".repeat(40),
        capturedAt, restoredSourceFingerprint: fingerprint,
        sourceSha: "3968154f965597843b6a2c429fff178c0f1ac54c",
        evidence: { database: { database: "bodycast" }, sourceFingerprint: fingerprint,
          expectedLedgerDigest: ledgerDigest, migrationRows: expect.arrayContaining([expect.objectContaining({ name: migrationRows[0].name })]),
          blocks: expect.arrayContaining([expect.objectContaining({ source: "training", sourceKey: "20", fromDate: "2025-01-01", revision: 9 })]) } });

      const artifactManifest = {
        sourceSha: "3968154f965597843b6a2c429fff178c0f1ac54c", imageId: `sha256:${"d".repeat(64)}`,
        imageDigest: `sha256:${"d".repeat(64)}`, archiveSha256: "e".repeat(64),
        migrationTree: "291b9c95924e196d66f9cdd555535b2e5a2b5990", prismaSchemaBlob: "4fa84cb62262986d5f0c58d3c76db2ba52b5500e",
        effectiveCommand: ["node", "/app/dist/production-full-history-recalculate.mjs", "--derived-v4-recovery", "--owner-authorized", "--profile-id", "1"],
      };
      writeFileSync(join(artifactRoot, "artifact.json"), JSON.stringify({ ...artifactManifest,
        manifestSha256: createHash("sha256").update(JSON.stringify({ ...artifactManifest, ledgerDigest })).digest("hex") }));
      writeFileSync(join(artifactRoot, "preflight.json"), JSON.stringify(preflight));
      const executeStep = workflow.split("      - name: Require fresh first-attempt evidence and unchanged exact main/source CI\n")[1]
        ?.split("      - name: Recheck owner and production SSH controls\n")[0];
      const executeStart = executeStep.indexOf("node --input-type=module - ");
      const executeSourceStart = executeStep.indexOf("\n", executeStart) + 1;
      const executeSourceEnd = executeStep.indexOf("\n          NODE", executeSourceStart);
      expect(executeStart).toBeGreaterThanOrEqual(0);
      expect(executeSourceEnd).toBeGreaterThan(executeSourceStart);
      const executeSource = executeStep.slice(executeSourceStart, executeSourceEnd).split("\n")
        .map((line) => line.replace(/^          /, "")).join("\n");
      const executeGate = spawnSync(process.execPath, ["--input-type=module", "-", join(artifactRoot, "preflight.json")], {
        cwd: repositoryRoot,
        env: { ...process.env, RUNNER_TEMP: tempRoot, GITHUB_RUN_ID: "123456", GITHUB_SHA: "c".repeat(40),
          GITHUB_RUN_ATTEMPT: "1", PREFLIGHT_RUN_ID: "123456", PREFLIGHT_SHA: "c".repeat(40),
          EXPECTED_MAIN_SHA: "c".repeat(40), RECOVERY_SHA: artifactManifest.sourceSha,
          IMAGE_ID: artifactManifest.imageId, ARCHIVE_SHA: artifactManifest.archiveSha256 },
        input: executeSource,
        encoding: "utf8",
      });
      expect(executeGate.status, executeGate.stderr).toBe(0);
      expect(workflow.match(/name: legacy-v4-recovery-preflight-\$\{\{ github\.run_id \}\}/g)).toHaveLength(2);
      expect(workflow).toContain("${{ runner.temp }}/bodycast-v4-artifact/preflight.json");
      expect(workflow).toContain("BODYCAST_PREFLIGHT_JSON_FILE='$artifact_dir/execute-preflight.json'");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("is manual-only, pinned to the owner, current main, and protected production environment", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^  (push|pull_request|workflow_run|schedule):/m);
    expect(workflow.match(/environment: production/g)).toHaveLength(2);
    expect(workflow).toContain("github.actor_id == '126446430'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toMatch(/\[\[ "\$DISPATCH_SHA" == "\$GITHUB_SHA"/);
    expect(workflow).toContain("main-ci.ndjson");
    expect(workflow).toContain("Recheck exact owner approval, current main, and legacy CI immediately before execution");
    expect(workflow).toContain("RECOVER_UNIFIED_V4_FROM_PERSISTED_SOURCES_PROFILE_1_AT_3968154f965597843b6a2c429fff178c0f1ac54c");
    expect(workflow).toContain("needs.rehearse.result == 'success'");
  });

  it("requires the exact audited legacy SHA, 65-schema manifest, and derived-only entrypoint", () => {
    expect(workflow).toContain("3968154f965597843b6a2c429fff178c0f1ac54c");
    expect(workflow).toContain("291b9c95924e196d66f9cdd555535b2e5a2b5990");
    expect(workflow).toContain("4fa84cb62262986d5f0c58d3c76db2ba52b5500e");
    expect(workflow).toContain("a4153cad028db966759935cb997b15ac3c6f1670dfc9ebd8a114f6b9520746a7");
    expect(workflow).toContain("node /app/dist/production-v4-recovery-evidence.mjs");
    expect(workflow).not.toMatch(/docker run[^\n]*migrate deploy[^\n]*bodycast-db-prod/);
    expect(workflow).not.toContain("docker compose up");
    expect(workflow).not.toContain("production-traffic-cutover");
    expect(host).toContain("node /app/dist/production-v4-recovery-evidence.mjs");
    expect(host).toContain("validatePublicationSourceEvidence");
    expect(host).not.toContain("healthBlocks.length === 8");
    expect(image).toContain("/app/dist/production-full-history-recalculate.mjs");
    expect(image).toContain("production-v4-derived-recovery.mjs");
    expect(image).toContain("--derived-v4-recovery");
    expect(host).not.toContain("migrate deploy");
    expect(host).not.toContain("docker compose");
  });

  it("requires a restore rehearsal, serializes on the shared production lock, and makes attempts terminal", () => {
    expect(workflow).toContain("Restore backup and rehearse exact image against isolated 65-schema PostgreSQL");
    expect(workflow).toContain("PRODUCTION_BACKUP_ENCRYPTION_KEY");
    expect(workflow).toContain("BACKUP_FILE: ${{ runner.temp }}/bodycast-v4-artifact/production-backup.pgdump.enc");
    expect(workflow).toContain("migrationLedgerDigest(before.migrationRows) !== ledger");
    expect(host).toContain("bodycast-production-release.lock");
    expect(host).toContain("flock -n 9");
    expect(host).toContain('state: "started"');
    expect(host).toContain("terminal-failed");
    expect(host).toContain("recovery-failed-no-retry");
    expect(host).toContain("production-container-identity-changed-during-recovery");
    expect(host).toContain("schema-changed-during-recovery");
    expect(host).toContain('after.lifecycle?.unifiedTargetRevision !== "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once"');
    expect(host).toContain("after.lifecycle?.unifiedPublicationBlockedFromDate !== null");
    expect(evidence).toContain('isolationLevel: "RepeatableRead"');
  });

  it("never replaces the serving app and targets only the known production checkout", () => {
    expect(host).toContain('[[ "${BODYCAST_DEPLOY_PATH:-}" == "/srv/bodycast" ]]');
    expect(host).toContain("docker run --rm --network \"$network\"");
    expect(host).not.toContain("docker stop");
    expect(host).not.toContain("docker restart");
    expect(host).not.toContain("docker compose");
    expect(host).not.toContain("prisma migrate");
    expect(host).toContain("serverAddress");
    expect(host).toContain("serverPort !== 5432");
    expect(evidence).toContain("persistedDayDates");
    expect(evidence).toContain("coveredDayDates");
    expect(workflow).not.toMatch(/^\s+run:.*docker (compose )?(up|restart|stop)/m);
  });
});
