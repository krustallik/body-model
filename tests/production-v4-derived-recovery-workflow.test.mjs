import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { recoveryTerminalMarkerBudgetTemplate, serializedRecoveryMarkerBytes } from "../scripts/production-v4-recovery-headroom.mjs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/production-v4-derived-recovery.yml", import.meta.url), "utf8");
const host = readFileSync(new URL("../scripts/production-v4-derived-recovery-host.sh", import.meta.url), "utf8");
const image = readFileSync(new URL("../Dockerfile.v4-derived-recovery", import.meta.url), "utf8");
const evidence = readFileSync(new URL("../scripts/production-v4-recovery-evidence.ts", import.meta.url), "utf8");
const repositoryRoot = new URL("..", import.meta.url).pathname;

describe("legacy derived V4 recovery release workflow", () => {
  it("runs the real host pretransfer, pre-load, and pre-execute gates before risky operations", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "bodycast-v4-host-headroom-"));
    const deployPath = join(tempRoot, "deploy");
    const dockerRoot = join(tempRoot, "docker");
    const pgdata = join(tempRoot, "pgdata");
    const artifactRoot = join(tempRoot, "artifacts");
    const recoveryStateRoot = join(tempRoot, "recovery-state");
    const runId = "70001";
    const recoverySha = "500e223072fb1bda4008131ea8ed3423b2dc2d77";
    const artifactDir = join(artifactRoot, recoverySha, runId);
    const archive = join(artifactDir, "image.tar");
    const hostScript = join(artifactDir, "host.sh");
    const helperScript = join(artifactDir, "headroom.mjs");
    const schemaDigestScript = join(artifactDir, "schema-digest.mjs");
    const binDir = join(tempRoot, "bin");
    const dockerLog = join(tempRoot, "docker.log");
    mkdirSync(deployPath, { recursive: true });
    mkdirSync(dockerRoot, { recursive: true });
    mkdirSync(join(pgdata, "pg_wal"), { recursive: true });
    mkdirSync(artifactDir, { recursive: true });
    mkdirSync(recoveryStateRoot, { recursive: true });
    mkdirSync(binDir);
    const gitInit = spawnSync("git", ["init", "--quiet", deployPath], { encoding: "utf8" });
    expect(gitInit.status, gitInit.stderr).toBe(0);

    const isolatedHost = host.replaceAll("/srv/bodycast", deployPath)
      .replaceAll("/var/lib/bodycast/recovery/artifacts", artifactRoot)
      .replaceAll("/var/lib/bodycast/recovery", recoveryStateRoot);
    writeFileSync(hostScript, isolatedHost, { mode: 0o700 });
    chmodSync(hostScript, 0o700);
    writeFileSync(helperScript, readFileSync(new URL("../scripts/production-v4-recovery-headroom.mjs", import.meta.url)), { mode: 0o600 });
    writeFileSync(schemaDigestScript, readFileSync(new URL("../scripts/production-v4-schema-digest.mjs", import.meta.url)), { mode: 0o600 });
    const dockerStub = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$BODYCAST_DOCKER_TEST_LOG"
case "$1:$2:$3" in
  inspect:--format:'{{.Id}}') [[ "$4" == bodycast-db-prod ]] && printf '%s\\n' '${"a".repeat(64)}' || printf '%s\\n' '${"b".repeat(64)}' ;;
  inspect:--format:'{{.Image}}') [[ "$4" == bodycast-db-prod ]] && printf 'sha256:%s\\n' '${"c".repeat(64)}' || printf 'sha256:%s\\n' '${"d".repeat(64)}' ;;
  inspect:--format:'{{.State.Status}}') printf 'running\\n' ;;
  inspect:--format:'{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}') printf 'healthy\\n' ;;
  inspect:--format:'{{index .Config.Labels "org.bodycast.release-sha"}}') printf '%s\\n' 'f910d2a45dfa676fada5fab42c9e8946c97872b1' ;;
  inspect:--format:'{{json .Mounts}}') printf '[{"Type":"bind","Source":"${pgdata}","Destination":"/var/lib/postgresql/data"}]\\n' ;;
  info:--format:'{{.DockerRootDir}}') printf '%s\\n' '${dockerRoot}' ;;
  exec:bodycast-db-prod:sh)
    [[ "$*" == *'readlink -f'* ]] && printf '/var/lib/postgresql/data/pg_wal\\n' || printf '/var/lib/postgresql/data\\n' ;;
  image:inspect:*) exit 1 ;;
  load:*) printf 'loaded isolated fixture\\n' ;;
  *) printf 'unexpected docker invocation: %s\\n' "$*" >&2; exit 94 ;;
esac
`;
    const dockerPath = join(binDir, "docker");
    writeFileSync(dockerPath, dockerStub, { mode: 0o700 });
    chmodSync(dockerPath, 0o700);
    writeFileSync(archive, "isolated image archive fixture");
    const archiveSha = createHash("sha256").update(readFileSync(archive)).digest("hex");
    const metrics = JSON.stringify({ archiveBytes: 1, imageBytes: 1, dataPeakGrowthBytes: Number.MAX_SAFE_INTEGER,
      walPeakGrowthBytes: 1, temporaryPeakBytes: 1, recoveryStartMarkerBytes: 100_000, recoveryTerminalMarkerBytes: 100_000 });
    const lowMetrics = JSON.stringify({ archiveBytes: 1, imageBytes: 1, dataPeakGrowthBytes: 0,
      walPeakGrowthBytes: 0, temporaryPeakBytes: 0, recoveryStartMarkerBytes: 1, recoveryTerminalMarkerBytes: 1 });
    const scriptSha = createHash("sha256").update(readFileSync(hostScript)).digest("hex");
    const helperSha = createHash("sha256").update(readFileSync(helperScript)).digest("hex");
    const schemaDigestHelperSha = createHash("sha256").update(readFileSync(schemaDigestScript)).digest("hex");
    const commonEnv = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      BODYCAST_DOCKER_TEST_LOG: dockerLog,
      BODYCAST_DEPLOY_PATH: deployPath,
      BODYCAST_RECOVERY_SHA: recoverySha,
      BODYCAST_EXPECTED_APP_SHA: "f910d2a45dfa676fada5fab42c9e8946c97872b1",
      BODYCAST_OWNER_RUN_ID: runId,
      BODYCAST_WORKFLOW_SHA: "c".repeat(40),
      BODYCAST_WORKFLOW_ATTEMPT: "1",
      BODYCAST_IMAGE_ID: `sha256:${"e".repeat(64)}`,
      BODYCAST_IMAGE_ARCHIVE_SHA256: archiveSha,
      BODYCAST_HOST_SCRIPT_SHA256: scriptSha,
      BODYCAST_HEADROOM_SCRIPT: helperScript,
      BODYCAST_HEADROOM_SCRIPT_SHA256: helperSha,
      BODYCAST_SCHEMA_DIGEST_SCRIPT: schemaDigestScript,
      BODYCAST_SCHEMA_DIGEST_HELPER_SHA256: schemaDigestHelperSha,
      BODYCAST_RECOVERY_HEADROOM_METRICS_JSON: metrics,
      BODYCAST_IMAGE_ARCHIVE: archive,
    };
    try {
      const expectedFor = (phase, metricsJson) => spawnSync(process.execPath, [helperScript, "--check", phase,
        metricsJson, artifactDir, dockerRoot, pgdata, join(pgdata, "pg_wal"), "/var/tmp", recoveryStateRoot, "false"],
      { encoding: "utf8" });

      // Exercise the real host entrypoint with measurements that fit the
      // current filesystem. CI runners with sufficient reserve must pass;
      // constrained hosts must stop at the matching gate before risky work.
      const beforeTransferExpected = expectedFor("before-transfer", lowMetrics);
      const beforeTransfer = spawnSync("bash", [hostScript, "pretransfer"], {
        env: { ...commonEnv, BODYCAST_RECOVERY_HEADROOM_METRICS_JSON: lowMetrics }, encoding: "utf8",
      });
      expect(beforeTransfer.status).toBe(beforeTransferExpected.status);
      if (beforeTransferExpected.status === 0) expect(beforeTransfer.stdout).toContain("phase=before-transfer");
      else expect(beforeTransfer.stderr).toContain("disk-headroom-before-transfer");
      expect(readFileSync(dockerLog, "utf8")).not.toMatch(/(^|\\n)load /);

      // Re-read disk headroom before image loading. An unrepresentable
      // aggregate requirement must fail closed on any filesystem capacity.
      for (const [mode, expectedGate] of [["pretransfer", "before-transfer"], ["preflight", "before-load"], ["preexecute", "before-execute"]]) {
        writeFileSync(dockerLog, "");
        const result = spawnSync("bash", [hostScript, mode], { env: commonEnv, encoding: "utf8" });
        expect(result.status, `${mode}: ${result.stderr}`).toBe(1);
        expect(result.stderr).toContain(`disk-headroom-${expectedGate}`);
        const calls = readFileSync(dockerLog, "utf8");
        expect(calls).not.toMatch(/(^|\\n)load /);
        expect(calls).not.toContain("run ");
        if (mode === "pretransfer") expect(calls).not.toContain("image.tar");
      }

      const beforeLoadExpected = expectedFor("before-load", lowMetrics);
      writeFileSync(dockerLog, "");
      const beforeLoad = spawnSync("bash", [hostScript, "preflight"], {
        env: { ...commonEnv, BODYCAST_RECOVERY_HEADROOM_METRICS_JSON: lowMetrics }, encoding: "utf8",
      });
      expect(beforeLoad.status).toBe(1);
      if (beforeLoadExpected.status !== 0) {
        expect(beforeLoad.stderr).toContain("disk-headroom-before-load");
        expect(readFileSync(dockerLog, "utf8")).not.toContain("load --input");
      } else {
        expect(beforeLoad.stderr).toContain("loaded-image-id");
        expect(readFileSync(dockerLog, "utf8")).toContain("load --input");
      }

      const beforeExecuteExpected = expectedFor("before-execute", lowMetrics);
      writeFileSync(dockerLog, "");
      const beforeExecute = spawnSync("bash", [hostScript, "preexecute"], {
        env: { ...commonEnv, BODYCAST_RECOVERY_HEADROOM_METRICS_JSON: lowMetrics }, encoding: "utf8",
      });
      expect(beforeExecute.status).toBe(beforeExecuteExpected.status);
      if (beforeExecuteExpected.status === 0) expect(beforeExecute.stdout).toContain("phase=before-execute");
      else expect(beforeExecute.stderr).toContain("disk-headroom-before-execute");

      // Exercise successful host orchestration deterministically. The actual
      // helper's arithmetic and statfs integration are covered above; this
      // fixture supplies a successful helper response so the host must proceed
      // through the transfer and load gates before the Docker identity stub
      // deliberately stops it.
      const successfulHeadroomFixture = `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ phase: process.argv[3], filesystems: [] }) + "\\n");\n`;
      writeFileSync(helperScript, successfulHeadroomFixture, { mode: 0o600 });
      const successfulHelperSha = createHash("sha256").update(readFileSync(helperScript)).digest("hex");
      const successEnv = { ...commonEnv,
        BODYCAST_HEADROOM_SCRIPT_SHA256: successfulHelperSha, BODYCAST_RECOVERY_HEADROOM_METRICS_JSON: lowMetrics };

      writeFileSync(dockerLog, "");
      const successfulPretransfer = spawnSync("bash", [hostScript, "pretransfer"], { env: successEnv, encoding: "utf8" });
      expect(successfulPretransfer.status, successfulPretransfer.stderr).toBe(0);
      expect(successfulPretransfer.stdout).toContain("phase=before-transfer");

      writeFileSync(dockerLog, "");
      const successfulPreflight = spawnSync("bash", [hostScript, "preflight"], { env: successEnv, encoding: "utf8" });
      expect(successfulPreflight.status).toBe(1);
      expect(successfulPreflight.stderr).toContain("loaded-image-id");
      expect(readFileSync(dockerLog, "utf8")).toContain("load --input");

      writeFileSync(dockerLog, "");
      const successfulPreexecute = spawnSync("bash", [hostScript, "preexecute"], { env: successEnv, encoding: "utf8" });
      expect(successfulPreexecute.status, successfulPreexecute.stderr).toBe(0);
      expect(successfulPreexecute.stdout).toContain("phase=before-execute");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("checks the measured one-shot marker size before writing it", async () => {
    const markerCommand = 'node --input-type=module - "$marker" "$BODYCAST_RECOVERY_SHA" "$BODYCAST_OWNER_RUN_ID"';
    const commandStart = host.indexOf(markerCommand);
    expect(commandStart).toBeGreaterThanOrEqual(0);
    const sourceStart = host.indexOf("\n", commandStart) + 1;
    const sourceEnd = host.indexOf("\nNODE", sourceStart);
    expect(sourceEnd).toBeGreaterThan(sourceStart);
    const nodeSource = host.slice(sourceStart, sourceEnd);
    const tempRoot = mkdtempSync(join(tmpdir(), "bodycast-v4-marker-budget-"));
    const sourceSha = "500e223072fb1bda4008131ea8ed3423b2dc2d77";
    const workflowSha = "c".repeat(40);
    const imageId = `sha256:${"d".repeat(64)}`;
    const archiveSha = "e".repeat(64);
    const databaseId = "a".repeat(64);
    const databaseImageId = `sha256:${"b".repeat(64)}`;
    const appId = "f".repeat(64);
    const appImageId = `sha256:${"0".repeat(64)}`;
    const preflightPath = join(tempRoot, "preflight.json");
    const coveredModelDayKeys = ["1|2026-01-01", "2|2026-01-02"];
    const coverageSha = createHash("sha256").update(`${coveredModelDayKeys.join("\n")}\n`).digest("hex");
    writeFileSync(preflightPath, JSON.stringify({ evidence: {
      blocks: [{ source: "health", sourceKey: "2026-01-01", fromDate: "2026-01-01", revision: 1 }],
      sourceModelDayKeys: [coveredModelDayKeys[0]], expectedLedgerDigest: "9".repeat(64), sourceFingerprint: "8".repeat(64),
    }, rehearsalCoverage: { coveredModelDayKeys, sha256: coverageSha } }));
    const args = ["--input-type=module", "-", join(tempRoot, "started.json"), sourceSha, "1234567890", imageId,
      archiveSha, workflowSha, "1", preflightPath, "7".repeat(64), databaseId, databaseImageId, appId, appImageId];
    const headroomScript = new URL("../scripts/production-v4-recovery-headroom.mjs", import.meta.url).pathname;
    const metrics = { recoveryStartMarkerBytes: 100_000, recoveryTerminalMarkerBytes: 100_000 };
    try {
      const allowed = spawnSync(process.execPath, args, { input: nodeSource, encoding: "utf8",
        env: { ...process.env, BODYCAST_HEADROOM_SCRIPT: headroomScript,
          BODYCAST_RECOVERY_HEADROOM_METRICS_JSON: JSON.stringify(metrics) } });
      expect(allowed.status, allowed.stderr).toBe(0);
      const markerContents = readFileSync(join(tempRoot, "started.json"), "utf8");
      const marker = JSON.parse(markerContents);
      expect(Buffer.byteLength(markerContents)).toBeLessThanOrEqual(metrics.recoveryStartMarkerBytes);
      expect(marker).toMatchObject({ sourceSha, ownerRunId: "1234567890", imageId,
        rehearsalCoveredModelDayKeys: coveredModelDayKeys });
      const terminalTemplate = recoveryTerminalMarkerBudgetTemplate(marker, {
        sourceModelDayKeys: [coveredModelDayKeys[0]], coveredModelDayKeys,
        sourceFingerprint: "8".repeat(64), schemaSha256: "7".repeat(64), rehearsalCoverageSha256: coverageSha,
        unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      });
      metrics.recoveryStartMarkerBytes = Buffer.byteLength(markerContents);
      metrics.recoveryTerminalMarkerBytes = serializedRecoveryMarkerBytes(terminalTemplate);

      const rejectedArgs = [...args];
      rejectedArgs[2] = join(tempRoot, "rejected.json");
      const rejected = spawnSync(process.execPath, rejectedArgs, { input: nodeSource, encoding: "utf8",
        env: { ...process.env, BODYCAST_HEADROOM_SCRIPT: headroomScript,
          BODYCAST_RECOVERY_HEADROOM_METRICS_JSON: JSON.stringify({ ...metrics, recoveryStartMarkerBytes: 1 }) } });
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("start marker exceeds the measured disk headroom allowance");
      expect(() => readFileSync(join(tempRoot, "rejected.json"))).toThrow();
      expect((await readdir(tempRoot)).some((name) => name.startsWith("rejected.json.tmp-"))).toBe(false);

      const terminalRejectedArgs = [...args];
      terminalRejectedArgs[2] = join(tempRoot, "terminal-rejected.json");
      const terminalRejected = spawnSync(process.execPath, terminalRejectedArgs, { input: nodeSource, encoding: "utf8",
        env: { ...process.env, BODYCAST_HEADROOM_SCRIPT: headroomScript,
          BODYCAST_RECOVERY_HEADROOM_METRICS_JSON: JSON.stringify({ ...metrics,
            recoveryTerminalMarkerBytes: metrics.recoveryTerminalMarkerBytes - 1 }) } });
      expect(terminalRejected.status).not.toBe(0);
      expect(terminalRejected.stderr).toContain("terminal marker peak exceeds the measured disk headroom allowance");
      expect(() => readFileSync(join(tempRoot, "terminal-rejected.json"))).toThrow();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("executes the final rehearsal Node step and writes bound preflight evidence", async () => {
    const rehearsalStep = workflow.split("      - name: Restore backup and rehearse exact image against isolated 65-schema PostgreSQL\n")[1]
      ?.split("      - name: Upload encrypted backup and successful restore rehearsal evidence\n")[0];
    expect(rehearsalStep).toBeDefined();
    expect(rehearsalStep.match(/docker run --rm --network host --env "DATABASE_URL=\$DATABASE_URL" --env "BODYCAST_V4_EXPECTED_EVIDENCE_BINDING=\$entry_binding" "\$IMAGE_ID"/g))
      .toHaveLength(1);
    const commandStart = rehearsalStep.lastIndexOf("node --input-type=module - <<'NODE'\n");
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
    const schemaDigestContract = "bodycast-pg-dump-schema-v1";
    const schemaDigestHelperSha256 = createHash("sha256").update(readFileSync(new URL("../scripts/production-v4-schema-digest.mjs", import.meta.url))).digest("hex");
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
      training: [{ sourceKey: "20", fromDate: "2025-01-01", fenceRevision: 9, identity: "session", sessionRows: 1,
        childDeletionAccountingInputRevision: null,
        sessionId: 20, profileId: 1, parentSessionRows: 1, parentSessionId: 20, parentProfileId: 1,
        parentStatus: "COMPLETED", status: "COMPLETED", entryMode: "RETROSPECTIVE", sourceRevision: 1, accountingInputRevision: 1,
        currentSnapshotRevision: 1, accountingSnapshotRows: 1, snapshotRevision: 1,
        snapshotAccountingInputRevision: 1, snapshotEffectiveLocalDate: "2025-01-01",
        persistedEffectiveAccountingAt: "2025-01-01T12:00:00.000Z",
        effectiveAccountingAt: "2025-01-01T12:00:00.000Z", trainingEventAt: "2025-01-01T12:00:00.000Z",
        webStartedAt: null, matchedWorkoutStartAt: "2025-01-01T12:00:00.000Z", accountingEffectiveLocalDate: "2025-01-01",
        accountingTimeZone: "Europe/Bratislava", accountingTimeZoneProvenance: "legacy-default",
        snapshotTimeZone: "Europe/Bratislava", snapshotTimeZoneValid: true,
        snapshotTimeZoneProvenance: "legacy-default", matchedWorkoutId: 20, matchStatus: "MATCHED",
        snapshotContractValid: true, snapshotEvidenceSha256: "a".repeat(64),
        matchedWorkoutPresent: true, matchedWorkoutIdentityMatches: true,
        matchedWorkoutTypeSupported: true, matchedWorkoutSourceIdentitySha256: "b".repeat(64),
        matchedWorkoutSourceHealthDate: "2025-01-01",
        createdAt: "2025-01-01T10:00:00.000Z", modelDate: "2025-01-01",
        latestSnapshotRows: 1, latestSnapshotRevision: 1, latestSnapshotAccountingInputRevision: 1,
        latestSnapshotEffectiveLocalDate: "2025-01-01", latestSnapshotTimeZone: "Europe/Bratislava",
        latestSnapshotTimeZoneValid: true, latestSnapshotTimeZoneProvenance: "legacy-default",
        latestSnapshotContractValid: true, latestSnapshotEvidenceSha256: "a".repeat(64),
        historicalSnapshotChronologyValid: true, pendingAccountingOperationRows: 0, accountingRevisionGap: 0,
        sourceFenceChronologyValid: true, sessionUpdateFenceChronologyValid: true, chronologyValid: true }],
    };
    const lifecycle = {
      profileId: 1,
      invalidationGeneration: 12, productionPublishedGeneration: 12, productionStaleFromDate: null,
      unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      unifiedRolloutEpoch: 1, unifiedPublishedGeneration: 12, unifiedPublishedRolloutEpoch: 1,
      unifiedPublicationBlockedFromDate: null, unifiedPublicationBlockedSource: null,
    };
    const modelDayKeys = ["1|2025-01-01", "2|2025-01-02"];
    const before = { database: { database: "bodycast_restore" }, migrationRows, expectedLedgerDigest: ledgerDigest,
      blocks, sourceEvidence, sourceFingerprint: fingerprint,
      sourceModelDayKeys: modelDayKeys,
      lifecycle: { ...lifecycle, productionStaleFromDate: "2025-01-01", unifiedPublishedGeneration: 11,
        unifiedPublicationBlockedFromDate: "2025-01-01", unifiedPublicationBlockedSource: "health" } };
    const replayCoverageKeys = [...modelDayKeys, "2|2025-01-03"];
    const after = { ...before, blocks: [], lifecycle, coveredModelDayKeys: replayCoverageKeys,
      sourceModelDayCount: modelDayKeys.length, coveredDayCount: replayCoverageKeys.length };
    const report = { sourceSha: "500e223072fb1bda4008131ea8ed3423b2dc2d77", evidence: {
      database: { database: "bodycast" }, migrationRows, expectedMigrationRows: migrationRows,
      expectedLedgerDigest: before.expectedLedgerDigest, blocks: before.blocks, sourceFingerprint: fingerprint,
      sourceEvidence, lifecycle: before.lifecycle, sourceModelDayKeys: modelDayKeys,
    } };
    writeFileSync(join(artifactRoot, "restored-before.json"), JSON.stringify(before));
    writeFileSync(join(artifactRoot, "restored-after.json"), JSON.stringify(after));
    writeFileSync(join(artifactRoot, "rehearsal-result.json"), JSON.stringify({ command: "unified-v4-derived-recovery", rolloutEpoch: 1, rawInputFingerprint: fingerprint }));
    const { recoveryEvidenceBinding } = await import("../scripts/production-v4-derived-recovery.mjs");
    const binding = recoveryEvidenceBinding({ sourceFingerprint: fingerprint, blocks, lifecycle: before.lifecycle });
    writeFileSync(join(artifactRoot, "expected-entry-binding.json"), JSON.stringify(binding));
    writeFileSync(join(artifactRoot, "postgres-storage-peak.json"), JSON.stringify({
      containerId: "1".repeat(64), samples: 6, baselineDataBytes: 10_000, peakDataBytes: 10_100,
      dataPeakGrowthBytes: 100, baselineWalBytes: 20, peakWalBytes: 220, walPeakGrowthBytes: 200,
    }));
    try {
      const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
        cwd: repositoryRoot,
        env: { ...process.env, RUNNER_TEMP: tempRoot, GITHUB_RUN_ID: "123456", GITHUB_SHA: "c".repeat(40),
          BACKUP_STARTED_AT: capturedAt, ARCHIVE_BYTES: "5000", IMAGE_BYTES: "9000", RECOVERY_SHA: "500e223072fb1bda4008131ea8ed3423b2dc2d77",
          SCHEMA_DIGEST_CONTRACT: schemaDigestContract, SCHEMA_DIGEST_HELPER_SHA256: schemaDigestHelperSha256,
          IMAGE_ID: `sha256:${"d".repeat(64)}`, ARCHIVE_SHA: "e".repeat(64), RESTORED_SCHEMA_SHA256: "f".repeat(64) },
        input: nodeSource,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      const measurements = JSON.parse(readFileSync(join(artifactRoot, "rehearsal-measurements.json"), "utf8"));
      const markerTemplate = { state: "started", sourceSha: "500e223072fb1bda4008131ea8ed3423b2dc2d77",
        ownerRunId: "9".repeat(20), workflowSha: "0".repeat(40), attempt: "1",
        imageId: `sha256:${"d".repeat(64)}`, archiveSha: "0".repeat(64), preflightDigest: "0".repeat(64),
        schemaSha: "f".repeat(64), schemaDigestContract, schemaDigestHelperSha256,
        ledgerDigest, fenceDigest: "0".repeat(64), sourceFingerprint: fingerprint,
        databaseContainerId: "0".repeat(64), rehearsalCoverageSha256: measurements.rehearsalCoverage.sha256,
        rehearsalCoveredModelDayKeys: [...replayCoverageKeys].sort(), databaseImageId: `sha256:${"0".repeat(64)}`,
        appContainerId: "0".repeat(64), appImageId: `sha256:${"0".repeat(64)}`, startedAt: "2000-01-01T00:00:00.000Z" };
      const terminalMarkerTemplate = recoveryTerminalMarkerBudgetTemplate(markerTemplate, {
        sourceModelDayKeys: after.sourceModelDayKeys, coveredModelDayKeys: after.coveredModelDayKeys,
        sourceFingerprint: fingerprint, schemaSha256: "f".repeat(64),
        rehearsalCoverageSha256: measurements.rehearsalCoverage.sha256,
        unifiedTargetRevision: lifecycle.unifiedTargetRevision,
      });
      expect(measurements.headroomMeasurements.recoveryStartMarkerBytes)
        .toBe(serializedRecoveryMarkerBytes(markerTemplate));
      expect(measurements.headroomMeasurements.recoveryTerminalMarkerBytes)
        .toBe(serializedRecoveryMarkerBytes(terminalMarkerTemplate));
      expect(measurements).toMatchObject({ schemaSha256: "f".repeat(64), restoredSourceFingerprint: fingerprint,
        expectedEntryBinding: binding,
        rehearsalCoverage: { coveredModelDayKeys: replayCoverageKeys,
          sha256: createHash("sha256").update(`${[...replayCoverageKeys].sort().join("\n")}\n`).digest("hex") },
        headroomMeasurements: { archiveBytes: 5000, imageBytes: 9000,
          dataPeakGrowthBytes: 100, walPeakGrowthBytes: 200 } });

      const preflight = { ...report, preflightRunId: "123456", preflightSha: "c".repeat(40), capturedAt,
        schemaDigestContract, schemaDigestHelperSha256,
        restoredSourceFingerprint: fingerprint, expectedEntryBinding: binding,
        rehearsalCoverage: measurements.rehearsalCoverage, headroomMeasurements: measurements.headroomMeasurements };

      writeFileSync(join(artifactRoot, "preflight.json"), JSON.stringify(preflight));
      const artifactManifest = {
        sourceSha: "500e223072fb1bda4008131ea8ed3423b2dc2d77", imageId: `sha256:${"d".repeat(64)}`,
        imageDigest: `sha256:${"d".repeat(64)}`, archiveSha256: "e".repeat(64),
        archiveBytes: 5000, imageBytes: 9000, evidenceBindingContract: "bodycast-v4-recovery-evidence-binding-v1",
        schemaDigestContract, schemaDigestHelperSha256,
        migrationTree: "291b9c95924e196d66f9cdd555535b2e5a2b5990", prismaSchemaBlob: "4fa84cb62262986d5f0c58d3c76db2ba52b5500e",
        effectiveCommand: ["node", "/app/dist/production-full-history-recalculate.mjs", "--derived-v4-recovery", "--owner-authorized", "--profile-id", "1"],
      };
      const artifactCore = { ...artifactManifest, ledgerDigest };
      const legacyArtifactCore = { ...artifactCore };
      delete legacyArtifactCore.schemaDigestContract;
      delete legacyArtifactCore.schemaDigestHelperSha256;
      writeFileSync(join(artifactRoot, "artifact.json"), JSON.stringify({ ...artifactCore,
        manifestSha256: createHash("sha256").update(JSON.stringify(legacyArtifactCore)).digest("hex") }));
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
          SCHEMA_DIGEST_CONTRACT: schemaDigestContract, SCHEMA_DIGEST_HELPER_SHA256: schemaDigestHelperSha256,
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
    expect(workflow).toContain("RECOVER_UNIFIED_V4_FROM_PERSISTED_SOURCES_PROFILE_1_AT_500e223072fb1bda4008131ea8ed3423b2dc2d77");
    expect(workflow).toContain("needs.rehearse.result == 'success'");
  });

  it("requires the exact audited legacy SHA, 65-schema manifest, and derived-only entrypoint", () => {
    expect(workflow).toContain("500e223072fb1bda4008131ea8ed3423b2dc2d77");
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
    expect(evidence).toContain("sourceModelDayKeys");
    expect(evidence).toContain("coveredDayDates");
    expect(workflow).not.toMatch(/^\s+run:.*docker (compose )?(up|restart|stop)/m);
  });

  it("executes the host postflight gate and rejects coverage that differs from exact-image rehearsal", () => {
    const marker = 'node --input-type=module - "$marker" "$evidence_file" "$after_file" "$result_file" "$schema_digest" <<\'NODE\'\n';
    const commandStart = host.indexOf(marker);
    expect(commandStart).toBeGreaterThanOrEqual(0);
    const sourceStart = commandStart + marker.length;
    const sourceEnd = host.indexOf("\nNODE", sourceStart);
    expect(sourceEnd).toBeGreaterThan(sourceStart);
    const nodeSource = host.slice(sourceStart, sourceEnd);
    const tempRoot = mkdtempSync(join(tmpdir(), "bodycast-v4-host-postflight-"));
    const paths = {
      marker: join(tempRoot, "marker.json"), before: join(tempRoot, "before.json"),
      after: join(tempRoot, "after.json"), result: join(tempRoot, "result.json"),
      preflight: join(tempRoot, "execute-preflight.json"),
    };
    const sourceKeys = ["1|2025-01-01", "1|2025-01-02"];
    const rehearsalKeys = [...sourceKeys, "2|2025-01-03"];
    const fingerprint = "a".repeat(64);
    const lifecycle = { unifiedRolloutEpoch: 1, unifiedPublishedRolloutEpoch: 1,
      unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
      unifiedPublicationBlockedFromDate: null, unifiedPublishedGeneration: 8,
      invalidationGeneration: 8, productionPublishedGeneration: 8, productionStaleFromDate: null };
    const before = { sourceFingerprint: fingerprint, expectedLedgerDigest: "b".repeat(64), migrationRows: [],
      database: { database: "bodycast", version: "17.11" }, sourceModelDayKeys: sourceKeys };
    const after = { ...before, blocks: [], lifecycle, sourceModelDayKeys: sourceKeys,
      coveredModelDayKeys: rehearsalKeys, sourceModelDayCount: sourceKeys.length, coveredDayCount: rehearsalKeys.length };
    const report = { rehearsalCoverage: { coveredModelDayKeys: rehearsalKeys,
      sha256: createHash("sha256").update(`${[...rehearsalKeys].sort().join("\n")}\n`).digest("hex") } };
    const run = (coverageKeys) => {
      writeFileSync(paths.marker, JSON.stringify({ state: "started" }));
      writeFileSync(paths.before, JSON.stringify(before));
      writeFileSync(paths.after, JSON.stringify({ ...after, coveredModelDayKeys: coverageKeys,
        coveredDayCount: coverageKeys.length }));
      writeFileSync(paths.result, JSON.stringify({ command: "unified-v4-derived-recovery", rolloutEpoch: 1,
        rawInputFingerprint: fingerprint }));
      writeFileSync(paths.preflight, JSON.stringify(report));
      return spawnSync(process.execPath, ["--input-type=module", "-", paths.marker, paths.before, paths.after,
        paths.result, "c".repeat(64)], { env: { ...process.env, BODYCAST_PREFLIGHT_JSON_FILE: paths.preflight,
          BODYCAST_RECOVERY_HEADROOM_METRICS_JSON: JSON.stringify({ recoveryTerminalMarkerBytes: 100_000 }) },
        input: nodeSource, encoding: "utf8" });
    };
    try {
      const valid = run(rehearsalKeys);
      expect(valid.status, valid.stderr).toBe(0);
      expect(JSON.parse(readFileSync(paths.marker, "utf8"))).toMatchObject({ state: "completed", result: "current",
        rehearsalCoverageSha256: report.rehearsalCoverage.sha256 });
      const extraUnboundTail = run([...rehearsalKeys, "2|2025-01-04"]);
      expect(extraUnboundTail.status).not.toBe(0);
      expect(extraUnboundTail.stderr).toContain("Read-only postflight did not prove strict raw parity");
      const missingSourceDay = run(["1|2025-01-02", "2|2025-01-03"]);
      expect(missingSourceDay.status).not.toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
