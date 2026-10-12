import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { activeProductionMutationRunInventory, buildCaptureHistoryEvidence } from "../scripts/github-no-app-preflight-evidence.mjs";

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
    expect(host).toContain('currentReceiptText: readFileSync(receiptPath, "utf8")');
    expect(host).not.toContain("BODYCAST_GITHUB_RESUME_RECEIPT_B64");
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

  it("keeps historical log parsing confined to the standard preflight resume gate", async () => {
    const resume = await readFile(new URL("../scripts/production-preflight-resume.mjs", import.meta.url), "utf8");
    expect(resume).toContain("parseActionLogRecords");
    expect(resume).toContain("assertSafeFailedPreMaintenanceDeploy");
    expect(resume).toContain("assertSafeCaptureBlockedPreflightRetry");
  });
});
