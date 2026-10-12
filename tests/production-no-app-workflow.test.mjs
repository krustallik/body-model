import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { activeProductionMutationRunInventory, buildCaptureHistoryEvidence, extractGitHubResumeReceipt } from "../scripts/github-no-app-preflight-evidence.mjs";
import { createCaptureResumeReceipt } from "../scripts/production-capture-resume-receipt.mjs";

const RESUME_RUN = {
  id: "38211169161", head_sha: "3ede9e1644616e65edb3ac29a49df2f109786942", run_attempt: 1,
};
const RECEIPT_JOB = "Inspect, back up, restore, and rehearse on disposable PostgreSQL";
const RECEIPT_STEP = "Enter maintenance and drain the old app before backup";
const RECEIPT_MARKER = "BODYCAST_PRE_DDL_RESUME_RECEIPT=";

function resumeReceipt(overrides = {}) {
  const { captureRunId = RESUME_RUN.id, captureRunAttempt = RESUME_RUN.run_attempt, ...receiptOverrides } = overrides;
  return createCaptureResumeReceipt({
    schemaVersion: 1, sourceRunId: "38205023003", sourceRunAttempt: 1,
    sourceSha: "fe55468321b9ef8e9783aa3874e1b42c2736b514",
    targetSha: "3ede9e1644616e65edb3ac29a49df2f109786942",
    sourceRecordDigest: "a".repeat(64), currentRecordDigest: "b".repeat(64), compatibilityDigest: "c".repeat(64),
    ...receiptOverrides,
  }, { captureRunId, captureRunAttempt });
}

function outputLine(receipt) {
  return `${RECEIPT_JOB}\t${RECEIPT_STEP}\t2026-10-12T06:11:10.0581259Z ${RECEIPT_MARKER}${Buffer.from(JSON.stringify(receipt)).toString("base64")}`;
}

function legacyOutputLine(receipt) {
  return `${RECEIPT_JOB}\t${RECEIPT_STEP}\t2026-10-12T06:11:10.0581259Z > ${RECEIPT_MARKER}${Buffer.from(JSON.stringify(receipt)).toString("base64")}`;
}

function echoedShellSource() {
  return `${RECEIPT_JOB}\t${RECEIPT_STEP}\t2026-10-12T06:11:02.3105545Z ^[[36;1m  mapfile -t RECEIPT_LINES < <(sed -n 's/^${RECEIPT_MARKER}//p' "$REMOTE_OUTPUT_FILE")^[[0m`;
}

describe("no-app preparation workflow boundaries", () => {
  it("extracts one emitted timestamp-space receipt and ignores the echoed shell command", () => {
    const receipt = resumeReceipt();
    expect(extractGitHubResumeReceipt(`${echoedShellSource()}\n${outputLine(receipt)}`, RESUME_RUN)).toEqual(receipt);
  });

  it("continues to accept the previously supported timestamp-command-output format", () => {
    const receipt = resumeReceipt();
    expect(extractGitHubResumeReceipt(legacyOutputLine(receipt), RESUME_RUN)).toEqual(receipt);
  });

  it.each([
    ["missing output", ""],
    ["echoed shell source only", echoedShellSource()],
    ["duplicate output", `${outputLine(resumeReceipt())}\n${outputLine(resumeReceipt())}`],
    ["arbitrary ANSI diagnostic marker beside valid receipt", `${RECEIPT_JOB}\t${RECEIPT_STEP}\t2026-10-12T06:11:02.3105545Z ^[[36;1m unrelated diagnostic output ${RECEIPT_MARKER}${Buffer.from(JSON.stringify(resumeReceipt())).toString("base64")}\n${outputLine(resumeReceipt())}`],
    ["unknown emitted delimiter", `${RECEIPT_JOB}\t${RECEIPT_STEP}\t2026-10-12T06:11:10.0581259Z output: ${RECEIPT_MARKER}${Buffer.from(JSON.stringify(resumeReceipt())).toString("base64")}`],
    ["spoofed job prefix", `Unrelated job\t${RECEIPT_STEP}\t2026-10-12T06:11:10.0581259Z ${RECEIPT_MARKER}${Buffer.from(JSON.stringify(resumeReceipt())).toString("base64")}`],
    ["malformed base64", `${RECEIPT_JOB}\t${RECEIPT_STEP}\t2026-10-12T06:11:10.0581259Z > ${RECEIPT_MARKER}not-base64!`],
    ["malformed JSON", `${RECEIPT_JOB}\t${RECEIPT_STEP}\t2026-10-12T06:11:10.0581259Z > ${RECEIPT_MARKER}${Buffer.from("{").toString("base64")}`],
    ["wrong source SHA", outputLine(resumeReceipt({ sourceSha: "d".repeat(40) }))],
    ["wrong source run", outputLine(resumeReceipt({ sourceRunId: "38205023004" }))],
    ["wrong target SHA", outputLine(resumeReceipt({ targetSha: "e".repeat(40) }))],
    ["wrong capture run", outputLine(resumeReceipt({ captureRunId: "38211169160" }))],
    ["wrong capture attempt", outputLine(resumeReceipt({ captureRunAttempt: 2 }))],
  ])("rejects %s", (_label, logText) => {
    expect(() => extractGitHubResumeReceipt(logText, RESUME_RUN)).toThrow();
  });

  it("rejects a receipt attributed to a different GitHub run SHA or attempt", () => {
    expect(() => extractGitHubResumeReceipt(outputLine(resumeReceipt()), { ...RESUME_RUN, head_sha: "f".repeat(40) })).toThrow();
    expect(() => extractGitHubResumeReceipt(outputLine(resumeReceipt()), { ...RESUME_RUN, run_attempt: 2 })).toThrow();
  });

  it("binds its capture-history collector to the exact known owner-run lineage", () => {
    expect(() => buildCaptureHistoryEvidence({
      currentRunId: "900", currentMainSha: "a".repeat(40),
      sourceRun: { id: "38211169160", head_sha: "3ede9e1644616e65edb3ac29a49df2f109786942", run_attempt: 1 },
    })).toThrow("Capture source is not the exact owner-run V4 resume attempt");
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
    expect(workflow).not.toContain("production-traffic-cutover.sh");
    expect(workflow).not.toContain("production-migration-sign.mjs");
    expect(workflow).not.toContain("production-migrate.yml");
    expect(workflow).toContain("--rehearsal-preflight");
    expect(workflow).not.toContain("production-migration-preflight.mjs --preflight");
    expect(workflow).toContain("BODYCAST_PGDUMP_INVOCATION_AT");
    expect(workflow).toContain("pg_restore docker.io/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 --version");
    expect(normalWorkflow).toContain("Enter maintenance and drain the old app before backup");
    expect(normalWorkflow).toContain("Capture pg_dump start on production host and create encrypted backup");
    expect(normalWorkflow).toContain("production-previous-app-provenance.mjs --verify-preflight");
    expect(safetyWorkflow).toContain('".github/workflows/production-no-app-preflight.yml"');
    expect(safetyWorkflow).toContain('"scripts/production-no-app-preflight-host.sh"');
    expect(safetyWorkflow).toContain("tests/production-no-app-preflight.test.mjs");
    expect(safetyWorkflow).toContain("tests/production-no-app-workflow.test.mjs");
  });

  it("keeps the production host portion read-only and reserves migration rehearsal for localhost", async () => {
    const host = await readFile(new URL("../scripts/production-no-app-preflight-host.sh", import.meta.url), "utf8");
    const noAppVerifier = await readFile(new URL("../scripts/production-no-app-preflight.mjs", import.meta.url), "utf8");
    const workflow = await readFile(new URL("../.github/workflows/production-no-app-preflight.yml", import.meta.url), "utf8");
    expect(host).toContain('source_capture_path="$git_dir/bodycast-production-pre-ddl-release-before-${EXPECTED_RESUME_SHA}"');
    expect(host).toContain('readonly EXPECTED_RESUME_SHA="3ede9e1644616e65edb3ac29a49df2f109786942"');
    expect(host).toContain('sourceRecordText: readFileSync(sourcePath, "utf8")');
    expect(host).not.toContain("bodycast-production-pre-ddl-release-archive-");
    expect(host).toContain("bodycast_acquire_production_release_lock");
    expect(host.indexOf('source <(git cat-file blob "$lock_helper_blob")')).toBeLessThan(host.indexOf("bodycast_acquire_production_release_lock"));
    expect(host.indexOf("bodycast_acquire_production_release_lock")).toBeLessThan(host.indexOf('docker ps --all'));
    expect(host).toContain('git hash-object --stdin < <(git cat-file blob "$lock_helper_blob")');
    expect(host).toContain("assertPostgresClientCompatibility(process.argv[2], process.argv[3])");
    expect(host).toContain("assertFreshWriterDrain(after.report, { now: Date.now(), maxAgeMs: 30_000 })");
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
});
