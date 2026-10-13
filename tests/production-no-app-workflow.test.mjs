import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { activeProductionMutationRunInventory, buildCaptureHistoryEvidence } from "../scripts/github-no-app-preflight-evidence.mjs";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stableNoAppSnapshot } from "../scripts/production-no-app-preflight.mjs";

const RESUME_RUN_ID = "38211169161";
const RESUME_SHA = "3ede9e1644616e65edb3ac29a49df2f109786942";
const SOURCE_SHA = "fe55468321b9ef8e9783aa3874e1b42c2736b514";
const MAIN_SHA = "39164557b50af6d304b4ab2764bdac1724d852c5";
const PREFLIGHT_PATH = ".github/workflows/production-migration-preflight.yml";

function resumeRun(overrides = {}) {
  return {
    id: RESUME_RUN_ID,
    workflow_id: "1234",
    path: `${PREFLIGHT_PATH}@refs/heads/main`,
    status: "completed",
    conclusion: "failure",
    run_attempt: 1,
    head_branch: "main",
    event: "workflow_dispatch",
    head_sha: RESUME_SHA,
    display_title: `Preflight ${RESUME_SHA} unified-v4-republication-v1`,
    actor: { id: "126446430" },
    triggering_actor: { id: "126446430" },
    repository: { full_name: "krustallik/body-model", owner: { id: "126446430", login: "krustallik" } },
    ...overrides,
  };
}

describe("no-app preparation workflow boundaries", () => {
  it("uses structured owner/run identity and marks historical log evidence UNVERIFIED", () => {
    const result = buildCaptureHistoryEvidence({
      currentRunId: "900", currentMainSha: MAIN_SHA, sourceRun: resumeRun(), preflightWorkflowId: "1234", allProductionRuns: [],
    });
    expect(result.proof).toMatchObject({
      schemaVersion: 3, sourceRunId: "38205023003", sourceRunAttempt: 1, sourceSha: SOURCE_SHA,
      resumeRunId: RESUME_RUN_ID, resumeRunAttempt: 1, resumeSha: RESUME_SHA, targetSha: MAIN_SHA,
      historyProvenance: {
        receiptJobLog: "UNVERIFIED", priorV2ArtifactLineage: "UNVERIFIED", interveningWorkflowEffects: "UNVERIFIED",
      },
    });
    expect(result).not.toHaveProperty("githubReceipt");
  });

  it.each([
    ["wrong run ID", { id: "38211169160" }],
    ["wrong SHA", { head_sha: "f".repeat(40) }],
    ["wrong run attempt", { run_attempt: 2 }],
    ["wrong owner", { actor: { id: "5" }, triggering_actor: { id: "5" } }],
    ["wrong workflow path", { path: ".github/workflows/production-migrate.yml@refs/heads/main" }],
    ["unexpected conclusion", { conclusion: "success" }],
  ])("rejects source run with %s", (_label, overrides) => {
    expect(() => buildCaptureHistoryEvidence({
      currentRunId: "900", currentMainSha: MAIN_SHA, sourceRun: resumeRun(overrides),
      preflightWorkflowId: "1234", allProductionRuns: [],
    })).toThrow();
  });

  it("binds its capture-history collector to the exact known owner-run lineage", () => {
    expect(() => buildCaptureHistoryEvidence({
      currentRunId: "900", currentMainSha: MAIN_SHA,
      sourceRun: resumeRun({ id: "38211169160" }), preflightWorkflowId: "1234", allProductionRuns: [],
    })).toThrow("Capture source is not the exact original V4 resume run");
  });

  it("includes older queued production mutations in the competing-run inventory", () => {
    const inventory = activeProductionMutationRunInventory([
      { id: "10", status: "queued", path: ".github/workflows/production-migrate.yml@refs/heads/main" },
      { id: "11", status: "in_progress", path: ".github/workflows/deploy-production.yml@refs/heads/main" },
      { id: "12", status: "in_progress", path: ".github/workflows/production-no-app-preflight.yml@refs/heads/main" },
      { id: "9", status: "completed", path: ".github/workflows/production-migrate.yml@refs/heads/main" },
    ], "12");
    expect(inventory.map(({ id }) => id)).toEqual(["10", "11"]);
  });

  it("uses a separate manual workflow and artifact namespace", async () => {
    const workflow = await readFile(new URL("../.github/workflows/production-no-app-preflight.yml", import.meta.url), "utf8");
    const normalWorkflow = await readFile(new URL("../.github/workflows/production-migration-preflight.yml", import.meta.url), "utf8");
    const safetyWorkflow = await readFile(new URL("../.github/workflows/production-migration-safety-ci.yml", import.meta.url), "utf8");
    expect(workflow).toContain("run-name: No-app prep");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("group: bodycast-production-release");
    expect(workflow).toContain("bodycast-no-app-backup-");
    expect(workflow).toContain("bodycast-no-app-preparation-");
    expect(workflow).toContain("historical receipt logs");
    expect(workflow).toContain("UNVERIFIED");
    expect(workflow).not.toContain("BODYCAST_GITHUB_RESUME_RECEIPT_B64");
    expect(workflow).not.toContain(".githubReceipt");
    expect(workflow).not.toContain("production-traffic-cutover.sh");
    expect(workflow).not.toContain("production-migration-sign.mjs");
    expect(workflow).not.toContain("production-migrate.yml");
    expect(workflow).toContain("--rehearsal-preflight");
    expect(workflow).not.toContain("production-migration-preflight.mjs --preflight");
    expect(workflow).toContain("BODYCAST_PGDUMP_INVOCATION_AT");
    expect(workflow).toContain('PIPELINE_STATUS=("${PIPESTATUS[@]}")');
    expect(workflow).toContain("production-no-app-host-failure-summary.mjs");
    expect(workflow).toContain("pg_restore docker.io/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 --version");
    expect(normalWorkflow).toContain("Enter maintenance and drain the old app before backup");
    expect(normalWorkflow).toContain("Capture pg_dump start on production host and create encrypted backup");
    expect(normalWorkflow).toContain("production-previous-app-provenance.mjs --verify-preflight");
    expect(safetyWorkflow).toContain('".github/workflows/production-no-app-preflight.yml"');
    expect(safetyWorkflow).toContain('"scripts/production-no-app-preflight-host.sh"');
    expect(safetyWorkflow).toContain("tests/production-no-app-preflight.test.mjs");
    expect(safetyWorkflow).toContain("tests/production-no-app-workflow.test.mjs");
  });

  it("checks final capture source and resume run IDs against their distinct proof fields", async () => {
    const workflow = await readFile(new URL("../.github/workflows/production-no-app-preflight.yml", import.meta.url), "utf8");
    expect(workflow).toContain('capture.proof.sourceRunId !== "38205023003"');
    expect(workflow).toContain('capture.proof.resumeRunId !== "38211169161"');
    expect(workflow).not.toContain('capture.proof.sourceRunId !== "38211169161"');
  });

  it("keeps the production host portion read-only and reserves migration rehearsal for localhost", async () => {
    const host = (await readFile(new URL("../scripts/production-no-app-preflight-host.sh", import.meta.url), "utf8"))
      .replaceAll("\r\n", "\n");
    const noAppVerifier = await readFile(new URL("../scripts/production-no-app-preflight.mjs", import.meta.url), "utf8");
    const workflow = await readFile(new URL("../.github/workflows/production-no-app-preflight.yml", import.meta.url), "utf8");
    expect(host).toContain('source_capture_path="$git_dir/bodycast-production-pre-ddl-release-before-${EXPECTED_RESUME_SHA}"');
    expect(host).toContain('local payload_file="$tmp/host-snapshot-${suffix}.json"');
    expect(host).toContain('verified_file="$tmp/verified-${suffix}.json"');
    expect(host).toContain('< "$payload_file" > "$verified_file"');
    expect(host).not.toContain('cp -- "$verified_file" "$tmp/verified-${suffix}.json"');
    expect(host).toContain('"$tmp/verified-before.json"');
    expect(host).toContain('"$tmp/verified-immediately-before-dump.json"');
    expect(host).toContain('readonly EXPECTED_RESUME_SHA="3ede9e1644616e65edb3ac29a49df2f109786942"');
    expect(host).toContain('sourceRecordText: readFileSync(sourcePath, "utf8")');
    expect(host).toContain('currentReceiptText: readFileSync(receiptPath, "utf8")');
    expect(host).not.toContain("BODYCAST_GITHUB_RESUME_RECEIPT_B64");
    expect(host).not.toContain("bodycast-production-pre-ddl-release-archive-");
    expect(host).toContain("bodycast_acquire_production_release_lock");
    expect(host.indexOf('source <(git cat-file blob "$lock_helper_blob")')).toBeLessThan(host.indexOf("bodycast_acquire_production_release_lock"));
    expect(host.indexOf("bodycast_acquire_production_release_lock")).toBeLessThan(host.indexOf('docker ps --all'));
    expect(host).toContain('git hash-object --stdin < <(git cat-file blob "$lock_helper_blob")');
    expect(host).toContain("assertPostgresClientCompatibility(process.argv[2], process.argv[3])");
    expect(noAppVerifier).toContain("evaluateProductionWriterDrain(report)");
    expect(host).not.toContain("assertFreshWriterDrain(after.report");
    expect(host).toContain("assertFreshWriterDrain(snapshot.report, { now: Date.now(), maxAgeMs: 30_000 })");
    expect(host).toContain("process.stdout.write(`${JSON.stringify(after)}\\n`)");
    expect(host).toContain('target_url="$(bash "$deploy_path/scripts/production-db-target.sh" --psql-url)"');
    expect(host).toContain('readonly DB_NETWORK="bodycast-backend-prod"');
    expect(host).toContain(".NetworkSettings.Networks");
    expect(host).toContain("$DB_NETWORK");
    expect(host).toContain(".IPAddress");
    expect(host).toContain("assertProductionDatabaseEndpointBinding");
    expect(host).toContain("--env BODYCAST_PSQL_DATABASE_URL");
    expect(host).not.toContain('--env "BODYCAST_PSQL_DATABASE_URL=$target_url"');
    expect(host).toContain("unset BODYCAST_PSQL_DATABASE_URL");
    expect(host).toContain('psql "$BODYCAST_PSQL_DATABASE_URL"');
    expect(host).not.toContain('psql --username="$POSTGRES_USER" --dbname=bodycast');
    expect(host.indexOf('fingerprint="$(bash "$deploy_path/scripts/production-db-data-fingerprint.sh"')).toBeLessThan(host.indexOf("assertProductionDatabaseEndpointBinding"));
    expect(host.indexOf("assertProductionDatabaseEndpointBinding")).toBeLessThan(host.indexOf("pg_dump --format=custom"));
    expect(host).toContain('docker exec "$dump_container_id"');
    expect(host).toContain("stableNoAppSnapshot(before)");
    expect(noAppVerifier).toContain("writerDrain.observerPid = null");
    expect(noAppVerifier).toContain("writerDrain.topology.observedAt = null");
    expect(noAppVerifier).toContain("conflictingLocks: value.report.conflictingLocks");
    expect(noAppVerifier).toContain("preparedTransactions: value.report.preparedTransactions");
    expect(host).toContain("pg_dump --format=custom --no-owner --no-privileges");
    expect(host).toContain("default_transaction_read_only=on");
    expect(host).not.toMatch(/docker compose/);
    expect(host).not.toMatch(/docker image tag|docker (?:rm|stop|start|restart|run)\b/);
    expect(host).not.toMatch(/prisma migrate|migrate deploy|caddy reload/);
    expect(workflow).toContain("DATABASE_URL: postgresql://bodycast_restore:isolated_restore_test_password@127.0.0.1:5432/bodycast_restore");
    expect(workflow).toContain("npx prisma migrate deploy --schema prisma/schema.prisma");
    expect(workflow).toContain("--set=BODYCAST_WRITER_TOPOLOGY_JSON=null");
    expect(workflow).toContain("--execution-integrity --manifest");
    expect(workflow).toContain("production DDL: NOT EXECUTED");
  });

  it("keeps historical log handling in the standard preflight resume gate", async () => {
    const resume = await readFile(new URL("../scripts/production-preflight-resume.mjs", import.meta.url), "utf8");
    expect(resume).toContain("parseActionLogRecords");
    expect(resume).not.toContain("assertSafeFailedPreMaintenanceDeploy");
    expect(resume).toContain("assertHistoricalDeployRun");
    expect(resume).toContain('historicalEffects: "UNVERIFIED"');
  });

  it("executes the real collect_snapshot flow twice before pg_dump", async () => {
    const host = (await readFile(new URL("../scripts/production-no-app-preflight-host.sh", import.meta.url), "utf8"))
      .replaceAll("\r\n", "\n");
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "bodycast-no-app-host-flow-"));
    try {
      const functionStart = host.indexOf("collect_snapshot() {");
      const functionEnd = host.indexOf("\n}\n\ncollect_snapshot before", functionStart) + 2;
      const readPrivateStart = host.indexOf("read_private_file() {");
      const readPrivateEnd = host.indexOf("\n\ncapture_path=", readPrivateStart);
      const tailStart = host.indexOf("\ncollect_snapshot before\n", functionEnd);
      expect(functionStart).toBeGreaterThanOrEqual(0);
      expect(functionEnd).toBeGreaterThan(functionStart);
      expect(readPrivateStart).toBeGreaterThanOrEqual(0);
      expect(readPrivateEnd).toBeGreaterThan(readPrivateStart);
      expect(tailStart).toBeGreaterThan(functionEnd);

      const hostGitDirectory = path.join(temporaryDirectory, "host-git");
      const tempDirectory = path.join(temporaryDirectory, "host-tmp");
      const observedDirectory = path.join(temporaryDirectory, "observed");
      const routesDirectory = path.join(temporaryDirectory, "routes");
      await Promise.all([hostGitDirectory, tempDirectory, observedDirectory, routesDirectory]
        .map((directory) => mkdir(directory)));
      for (const name of [
        "bodycast-production-pre-ddl-release",
        "bodycast-production-pre-ddl-release-before-3ede9e1644616e65edb3ac29a49df2f109786942",
        "bodycast-production-pre-ddl-release-resume-38211169161-1",
      ]) {
        const contents = name === "bodycast-production-pre-ddl-release"
          ? "previousImagePin=bodycast-app:rollback-preflight-38205023003-1\n"
          : `synthetic ${name}\n`;
        const file = path.join(hostGitDirectory, name);
        await writeFile(file, contents, { mode: 0o600 });
        await chmod(file, 0o600);
      }

      const observedAt = new Date().toISOString();
      const digest = "b".repeat(64);
      const databaseContainerId = "a".repeat(64);
      const writerTopology = {
        schemaVersion: 1, contract: "bodycast-compose-internal-db-single-writer-v1", ready: true, blockers: [],
        observedAt,
        app: { name: "bodycast-app-prod", state: "absent", restartPolicy: null },
        database: { name: "bodycast-db-prod", state: "running", health: "healthy", publishedPostgresPort: false,
          networks: ["bodycast-backend-prod"] },
        backendNetwork: { name: "bodycast-backend-prod", containers: ["bodycast-db-prod"] },
        caddy: { name: "gymbeam-caddy", state: "running", configValidated: true },
        routeFile: { verified: true, maintenanceResponse: true, containsReverseProxy: false, sha256: digest },
      };
      const report = {
        identity: { database: "bodycast", databaseOid: 16384, clusterSystemIdentifier: "7123", role: "bodycast",
          serverVersion: "17.11", serverAddress: "172.20.0.2", serverPort: 5432 },
        migrations: [], objects: [], tables: [], logicalDataFingerprint: digest,
        writerDrain: { schemaVersion: 1, observerPid: 44, observerApplicationName: "bodycast-production-preflight",
          observedAt, identityPolicy: "no-other-client-backends", activeClientBackends: [], topology: writerTopology },
        conflictingLocks: [], preparedTransactions: [],
      };
      const reportPath = path.join(temporaryDirectory, "report.json");
      await writeFile(reportPath, JSON.stringify(report));
      const writerTopologyPath = path.join(temporaryDirectory, "writer-topology.json");
      await writeFile(writerTopologyPath, JSON.stringify(writerTopology));
      const preflightPath = path.join(temporaryDirectory, "preflight.json");
      await writeFile(preflightPath, JSON.stringify({ readyForOwnerAuthorization: true, blockers: [], pending: [],
        pendingExactlyExpected: true, blobIntegrity: [] }));

      const makeSnapshot = (observerPid, timestamp, schemaVersion = 1) => ({
        schemaVersion,
        preparationResult: {
          ddlAuthorization: false, readyForOwnerAuthorization: false, appRuntime: "unavailable", rollbackReadiness: "unverified",
          maintenanceRouteDigest: digest, maintenanceMarkerDigest: digest, captureLineageDigest: digest,
          pendingSetDigest: digest, productionDatabaseContainerId: databaseContainerId,
        },
        report: { ...report, writerDrain: { ...report.writerDrain, observerPid, observedAt: timestamp,
          topology: { ...writerTopology, observedAt: timestamp } } },
        postgresClientVersions: { pgDump: "pg_dump (PostgreSQL) 17.11", pgRestore: "pg_restore (PostgreSQL) 17.11" },
      });
      const firstSnapshotPath = path.join(temporaryDirectory, "snapshot-before.json");
      const secondSnapshotPath = path.join(temporaryDirectory, "snapshot-immediately-before-dump.json");
      const staleBeforeObservedAt = new Date(Date.now() - 31_000).toISOString();
      const secondObservedAt = new Date().toISOString();
      await writeFile(firstSnapshotPath, JSON.stringify(makeSnapshot(44, staleBeforeObservedAt)));
      await writeFile(secondSnapshotPath, JSON.stringify(makeSnapshot(45, secondObservedAt)));

      const bashExecutable = process.platform === "win32" && existsSync("C:/Program Files/Git/bin/bash.exe")
        ? "C:/Program Files/Git/bin/bash.exe" : "bash";
      const bashPath = (value) => process.platform === "win32"
        ? spawnSync(bashExecutable, ["-c", "cygpath -u \"$1\"", "--", value], { encoding: "utf8" }).stdout.trim()
        : value;
      const readPrivateFunction = process.platform === "win32"
        ? 'read_private_file() { [[ -f "$1" && ! -L "$1" ]]; }'
        : host.slice(readPrivateStart, readPrivateEnd);
      const shellRunner = String.raw`set -Eeuo pipefail
deploy_path="$REPO_ROOT"
release_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
app_host="fixture.invalid"
routes_path="$ROUTES_PATH"
git_dir="$HOST_GIT_DIRECTORY"
tmp="$HOST_TEMP_DIRECTORY"
mkdir -p "$tmp"
readonly EXPECTED_SOURCE_RUN_ID="38211169161"
readonly EXPECTED_SOURCE_ATTEMPT="1"
readonly EXPECTED_RESUME_SHA="3ede9e1644616e65edb3ac29a49df2f109786942"
readonly DB_CONTAINER="bodycast-db-prod"
readonly DB_NETWORK="bodycast-backend-prod"
readonly APP_CONTAINER="bodycast-app-prod"
readonly DB_IMAGE="postgres:17-alpine"
readonly FIXED_CONTAINER_ID="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
capture_path="$git_dir/bodycast-production-pre-ddl-release"
source_capture_path="$git_dir/bodycast-production-pre-ddl-release-before-$EXPECTED_RESUME_SHA"
receipt_path="$git_dir/bodycast-production-pre-ddl-release-resume-$EXPECTED_SOURCE_RUN_ID-$EXPECTED_SOURCE_ATTEMPT"
VERIFY_CALLS=0
read_private_file() {
  local file="$1" bytes mode owner
  [[ -f "$file" && ! -L "$file" ]] || { echo "capture file unavailable" >&2; return 1; }
  bytes="$(stat -c '%s' -- "$file")"
  mode="$(stat -c '%a' -- "$file")"
  owner="$(stat -c '%u' -- "$file")"
  [[ "$bytes" =~ ^[0-9]+$ && "$bytes" -gt 0 && "$bytes" -le 8192 && $((8#$mode & 077)) -eq 0 && "$owner" == "$(id -u)" ]]
}
docker() {
  case "$*" in
    *"--format {{.Id}}|{{.Name}}|{{.Config.Image}}"*) printf '%s\n' "$FIXED_CONTAINER_ID|/bodycast-db-prod|postgres:17-alpine|running|healthy|172.20.0.2" ;;
    *"image inspect"*) printf 'sha256:%s\n' "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" ;;
    *"pg_dump --version"*) printf 'pg_dump (PostgreSQL) 17.11\n' ;;
    *" psql "*) cat "$FIXTURE_REPORT" ;;
    *"{{.Id}}"*) printf '%s\n' "$FIXED_CONTAINER_ID" ;;
    *"pg_dump --format=custom"*) printf 'called\n' >> "$PG_DUMP_LOG"; printf 'BODYCAST_PGDUMP_INVOCATION_AT=2026-10-13T00:00:00Z\n' >&2; printf 'synthetic-pgdump-bytes' ;;
    ps\ --all*) : ;;
    *) echo "unexpected synthetic docker operation" >&2; return 99 ;;
  esac
}
bash() {
  case "$1" in
    *production-writer-drain.sh) cat "$WRITER_TOPOLOGY" ;;
    *production-db-target.sh) printf 'postgresql://fixture:fixture@bodycast-db-prod/bodycast\n' ;;
    *production-db-data-fingerprint.sh) printf '%s\n' "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" ;;
    *) command bash "$@" ;;
  esac
}
node() {
  if [[ "$1" == "$deploy_path/scripts/production-migration-preflight.mjs" ]]; then
    local report_path=""
    while (($#)); do [[ "$1" == "--report" ]] && { shift; report_path="$1"; }; shift || true; done
    [[ -n "$report_path" ]] || { echo "migration report path missing" >&2; return 1; }
    cp -- "$FIXTURE_REPORT" "$report_path"
    cat "$FIXTURE_PREFLIGHT"
    return 0
  fi
  if [[ "$1" == "$deploy_path/scripts/production-no-app-preflight.mjs" && "$2" == "--verify-host-snapshot" ]]; then
    cat >/dev/null
    VERIFY_CALLS=$((VERIFY_CALLS + 1))
    local fixture
    if ((VERIFY_CALLS == 1)); then fixture="$SNAPSHOT_BEFORE"; else fixture="$SNAPSHOT_IMMEDIATELY_BEFORE_DUMP"; fi
    command node --input-type=module - "$fixture" <<'NODE'
import { readFileSync } from "node:fs";
import { evaluateProductionWriterDrain } from "./scripts/production-writer-drain.mjs";
const snapshot = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!evaluateProductionWriterDrain(snapshot.report).ready) throw new Error("Writer-drain predicates are not ready.");
NODE
    cp -- "$fixture" "$OBSERVED_DIRECTORY/verified-$VERIFY_CALLS.json"
    cat "$fixture"
    return 0
  fi
  command node "$@"
}
curl() {
  local headers="" body=""
  while (($#)); do
    case "$1" in
      --dump-header) shift; headers="$1" ;;
      --output) shift; body="$1" ;;
    esac
    shift || true
  done
  printf 'HTTP/1.1 503 Service Unavailable\r\nX-BodyCast-Deploy-Maintenance: fixture-maintenance\r\nCache-Control: no-store\r\n\r\n' > "$headers"
  printf 'BodyCast is temporarily unavailable while the model is updated.\n' > "$body"
  printf '503'
}
bodycast_maintenance_marker_from_route() { printf 'fixture-maintenance\n'; }
bodycast_verify_exact_maintenance_route() { return 0; }
bodycast_probe_public_maintenance() { return 0; }
${readPrivateFunction}
${host.slice(functionStart, functionEnd)}
${host.slice(tailStart + 1)}`;
      const shellRunnerPath = path.join(temporaryDirectory, "runner.sh");
      await writeFile(shellRunnerPath, shellRunner);
      const dumpLogPath = path.join(temporaryDirectory, "pg-dump.log");
      const runFlow = (hostTemp) => spawnSync(bashExecutable, [bashPath(shellRunnerPath)], {
        cwd: process.cwd(), encoding: "utf8", timeout: 60_000,
        env: {
          ...process.env,
          REPO_ROOT: process.cwd(),
          HOST_GIT_DIRECTORY: bashPath(hostGitDirectory),
          HOST_TEMP_DIRECTORY: bashPath(hostTemp),
          ROUTES_PATH: bashPath(routesDirectory),
          OBSERVED_DIRECTORY: bashPath(observedDirectory),
          FIXTURE_REPORT: bashPath(reportPath),
          FIXTURE_PREFLIGHT: bashPath(preflightPath),
          WRITER_TOPOLOGY: bashPath(writerTopologyPath),
          SNAPSHOT_BEFORE: bashPath(firstSnapshotPath),
          SNAPSHOT_IMMEDIATELY_BEFORE_DUMP: bashPath(secondSnapshotPath),
          PG_DUMP_LOG: bashPath(dumpLogPath),
          BODYCAST_PG_RESTORE_VERSION: "pg_restore (PostgreSQL) 17.11",
          BODYCAST_CAPTURE_HISTORY_PROOF_B64: Buffer.from('{"schemaVersion":3}').toString("base64"),
          BODYCAST_PRODUCTION_RUNS_B64: Buffer.from("[]").toString("base64"),
          BODYCAST_CURRENT_RUN_ID: "900",
          BODYCAST_PG_RESTORE_PASSWORD: "synthetic-only",
        },
      });
      const result = runFlow(tempDirectory);
      const dumpLog = await readFile(dumpLogPath, "utf8").catch(() => "");
      expect(result.status, result.stderr).toBe(0);
      expect(dumpLog.trim().split(/\r?\n/)).toEqual(["called"]);
      expect(result.stderr).toContain("BODYCAST_NO_APP_PREPARATION_B64=");
      expect(result.stderr).toContain("BODYCAST_PGDUMP_INVOCATION_AT=");

      const [before, after] = await Promise.all([1, 2].map(async (index) => JSON.parse(
        await readFile(path.join(observedDirectory, `verified-${index}.json`), "utf8"))));
      expect(JSON.stringify(before)).not.toBe(JSON.stringify(after));
      expect(stableNoAppSnapshot(before)).toEqual(stableNoAppSnapshot(after));
      const snapshotLine = result.stderr.split(/\r?\n/).find((line) => line.startsWith("BODYCAST_NO_APP_PREPARATION_B64="));
      expect(snapshotLine).toBeDefined();
      const handedOffSnapshot = JSON.parse(Buffer.from(snapshotLine.slice("BODYCAST_NO_APP_PREPARATION_B64=".length), "base64").toString("utf8"));
      expect(handedOffSnapshot).toEqual(after);
      expect(handedOffSnapshot.report.writerDrain.observerPid).toBe(45);
      expect(Date.now() - Date.parse(handedOffSnapshot.report.writerDrain.observedAt)).toBeLessThan(30_000);

      await rm(dumpLogPath, { force: true });
      await writeFile(secondSnapshotPath, JSON.stringify(makeSnapshot(45, staleBeforeObservedAt)));
      const staleAfterResult = runFlow(path.join(temporaryDirectory, "host-tmp-stale-after"));
      expect(staleAfterResult.status).not.toBe(0);
      expect(staleAfterResult.stderr).toContain("stale or from the future");
      await expect(readFile(dumpLogPath, "utf8")).rejects.toThrow();

      await rm(dumpLogPath, { force: true });
      await writeFile(secondSnapshotPath, JSON.stringify(makeSnapshot(45, new Date().toISOString(), 2)));
      const invalidHostTempDirectory = path.join(temporaryDirectory, "host-tmp-invalid-snapshot");
      const invalidSnapshotResult = runFlow(invalidHostTempDirectory);
      expect(invalidSnapshotResult.status).not.toBe(0);
      expect(invalidSnapshotResult.stderr).toContain("No-app snapshot did not remain preparation-only.");
      await expect(readFile(dumpLogPath, "utf8")).rejects.toThrow();

      const changedSnapshot = makeSnapshot(46, new Date().toISOString());
      changedSnapshot.report.logicalDataFingerprint = "e".repeat(64);
      await writeFile(secondSnapshotPath, JSON.stringify(changedSnapshot));
      const changedHostTempDirectory = path.join(temporaryDirectory, "host-tmp-changed-snapshot");
      const changedSnapshotResult = runFlow(changedHostTempDirectory);
      expect(changedSnapshotResult.status).not.toBe(0);
      expect(changedSnapshotResult.stderr).toContain("Production DB, route, capture, or Docker identity changed");
      await expect(readFile(dumpLogPath, "utf8")).rejects.toThrow();

      for (const [name, mutate] of [
        ["database", (snapshot) => { snapshot.preparationResult.productionDatabaseContainerId = "f".repeat(64); }],
        ["route", (snapshot) => { snapshot.preparationResult.maintenanceRouteDigest = "e".repeat(64); }],
      ]) {
        await rm(dumpLogPath, { force: true });
        const mismatchedSnapshot = makeSnapshot(47, new Date().toISOString());
        mutate(mismatchedSnapshot);
        await writeFile(secondSnapshotPath, JSON.stringify(mismatchedSnapshot));
        const mismatchResult = runFlow(path.join(temporaryDirectory, `host-tmp-${name}-mismatch`));
        expect(mismatchResult.status).not.toBe(0);
        expect(mismatchResult.stderr).toContain("Production DB, route, capture, or Docker identity changed");
        await expect(readFile(dumpLogPath, "utf8")).rejects.toThrow();
      }
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 30_000);
});
