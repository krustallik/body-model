import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { capturePreviousAppProvenance, rebindPreviousAppProvenanceForPreflightResume } from "../scripts/production-previous-app-provenance.mjs";
import { failedHistoricalNoAppAfterRehearsal, historicalAuthorizationRetries,
  successfulHistoricalNoAppPreparation } from "./fixtures/historical-preflight-runs.mjs";
import { serializePreflightRetryRunIds, verifyPreDdlMigrationFailureResume,
  verifyResumablePreflightAttempt } from "../scripts/production-preflight-resume.mjs";

function findBash() {
  const probe = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (!probe.error && probe.status === 0) return "bash";
  if (process.platform !== "win32") return null;
  const where = spawnSync("where.exe", ["git"], { encoding: "utf8" });
  const gitExe = where.stdout?.split(/\r?\n/).find((entry) => entry.toLowerCase().endsWith("\\git.exe"));
  if (!gitExe) return null;
  const gitBash = path.resolve(path.dirname(gitExe), "..", "bin", "bash.exe");
  return spawnSync(gitBash, ["--version"], { encoding: "utf8" }).status === 0 ? gitBash : null;
}

const bash = findBash();

const sourceSha = "a".repeat(40);
const targetSha = "b".repeat(40);
const blockedCaptureSha = "c".repeat(40);
const deployWorkflowId = "789";
const safeSchemaBlockedDeployRunId = "38000669127";

describe("historical release recovery metadata", () => {
  it("keeps source verification upstream of production access and does not fetch historical logs", async () => {
    const workflow = await readFile(".github/workflows/production-migration-preflight.yml", "utf8");
    const authorizeJob = workflow.indexOf("  authorize:");
    const inspectJob = workflow.indexOf("  inspect_backup_restore:");
    const verifyEvidence = workflow.indexOf("node scripts/production-preflight-resume.mjs --verify-source");
    const validateSsh = workflow.indexOf("      - name: Validate production-only SSH and backup secrets", inspectJob);
    const pinSsh = workflow.indexOf("      - name: Pin production SSH host key", validateSsh);
    const remoteCommand = workflow.indexOf("REMOTE_COMMAND=", pinSsh);
    const standardResume = workflow.slice(workflow.lastIndexOf('elif [[ -n "$RESUME_SOURCE_RUN_ID" ]]; then'));
    expect(authorizeJob).toBeGreaterThanOrEqual(0);
    expect(inspectJob).toBeGreaterThan(authorizeJob);
    expect(verifyEvidence).toBeGreaterThan(authorizeJob);
    expect(verifyEvidence).toBeLessThan(inspectJob);
    expect(validateSsh).toBeGreaterThan(inspectJob);
    expect(pinSsh).toBeGreaterThan(validateSsh);
    expect(remoteCommand).toBeGreaterThan(pinSsh);
    expect(standardResume).not.toContain("--log-failed");
    expect(standardResume).not.toContain("/actions/jobs/$inspect_job_id/logs");
    expect(standardResume).not.toContain("actions/runs/$prep_run_id/artifacts");
    expect(standardResume).toContain("actions/runs/$deploy_run_id/jobs");
    expect(standardResume).toContain("actions/runs/$retry_run_id/artifacts");
  });

  it("accepts historical authorization-only retries from complete GitHub metadata", () => {
    expect(historicalAuthorizationRetries.map(({ run }) => String(run.id))).toEqual([
      "38379375890", "38379548326", "38384779107", "38396593728", "38399644888",
      "38403898937", "38410773609", "38413249982", "38415354392", "38417627284",
    ]);
    const sourceSha = "3ede9e1644616e65edb3ac29a49df2f109786942";
    const currentMainSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    for (const { run, jobs, artifacts } of historicalAuthorizationRetries) {
      expect(() => execFileSync("git", ["merge-base", "--is-ancestor", sourceSha, run.head_sha])).not.toThrow();
      expect(() => execFileSync("git", ["merge-base", "--is-ancestor", run.head_sha, currentMainSha])).not.toThrow();
      expect(jobs.total_count).toBe(2);
      expect(jobs.jobs.map(({ name }) => name).sort()).toEqual([
        "Authorize read-only preflight",
        "Inspect, back up, restore, and rehearse on disposable PostgreSQL",
      ]);
      expect(jobs.jobs.every((job) => job.status === "completed" && job.head_sha === run.head_sha
        && job.run_attempt === run.run_attempt && Array.isArray(job.steps))).toBe(true);
      expect(jobs.jobs.find(({ name }) => name === "Authorize read-only preflight").conclusion).toBe("failure");
      expect(jobs.jobs.find(({ name }) => name === "Inspect, back up, restore, and rehearse on disposable PostgreSQL"))
        .toMatchObject({ conclusion: "skipped", steps: [] });
      expect(artifacts).toEqual({ total_count: 0, artifacts: [] });
    }
  });

  it("carries unverified historical recovery as non-DDL evidence", async () => {
    const workflow = await readFile(".github/workflows/production-migration-preflight.yml", "utf8");
    const evidenceScript = await readFile("scripts/production-migration-evidence.mjs", "utf8");
    expect(workflow).toContain("unverified_historical_runs: ${{ steps.gate.outputs.unverified_historical_runs }}");
    expect(workflow).toContain("UNVERIFIED_HISTORICAL_RUNS: ${{ needs.authorize.outputs.unverified_historical_runs }}");
    expect(workflow).toContain("unverified_historical_runs=$UNVERIFIED_HISTORICAL_RUNS");
    expect(evidenceScript).toContain("historicalRecovery:");
    expect(evidenceScript).toContain("ddlAuthorizationGranted: false");
  });
});
function sourceRun(overrides = {}) {
  return {
    id: 38000669126,
    workflow_id: 123,
    display_title: `Preflight ${sourceSha} active-energy-unified-v2`,
    path: ".github/workflows/production-migration-preflight.yml@refs/heads/main",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: sourceSha,
    status: "completed",
    conclusion: "failure",
    run_attempt: 1,
    actor: { id: 126446430 },
    triggering_actor: { id: 126446430 },
    repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
    ...overrides,
  };
}

function sourceJobs() {
  const steps = [
    ["Enter maintenance and drain the old app before backup", "success"],
    ["Verify production container and PostgreSQL client versions", "success"],
    ["Read-only production identity, full migration set, schema signatures, and locks", "success"],
    ["Capture pg_dump start on production host and create encrypted backup", "success"],
    ["Restore snapshot, compare source state, and rehearse exact migrations", "failure"],
    ["Bind forward-resume authorization to the fresh live snapshot and rehearsal", "skipped"],
    ["Create preflight evidence bundle", "skipped"],
    ["Upload encrypted production backup artifact", "skipped"],
    ["Upload immutable preflight and restore evidence artifact", "skipped"],
    ["Report read-only completion", "skipped"],
  ].map(([name, conclusion]) => ({ name, conclusion }));
  return {
    total_count: 2,
    jobs: [
      { name: "Authorize read-only preflight", conclusion: "success", head_sha: sourceSha, run_attempt: 1 },
      { name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL", conclusion: "failure", head_sha: sourceSha, run_attempt: 1, steps },
    ],
  };
}

function verify(overrides = {}) {
  return verifyResumablePreflightAttempt({
    sourceRun: sourceRun(),
    sourceJobs: sourceJobs(),
    sourceArtifacts: { total_count: 0, artifacts: [] },
    laterRuns: [{
      id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
    }],
    sourceRunId: "38000669126",
    currentRunId: "99999999999",
    currentMainSha: targetSha,
    workflowId: "123",
    noAppWorkflowId: "456",
    manifestId: "active-energy-unified-v2",
    deployWorkflowId,
    sourceIsAncestor: true,
    ...overrides,
  });
}

function deployRun(overrides = {}) {
  return {
    id: Number(safeSchemaBlockedDeployRunId),
    workflow_id: Number(deployWorkflowId),
    path: ".github/workflows/deploy-production.yml@refs/heads/main",
    event: "workflow_run",
    head_branch: "main",
    head_sha: targetSha,
    status: "completed",
    conclusion: "failure",
    run_attempt: 1,
    actor: { id: 126446430 },
    triggering_actor: { id: 126446430 },
    repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
    ...overrides,
  };
}

function completedNoAppRun(overrides = {}) {
  return {
    id: 38000669129,
    workflow_id: 456,
    path: ".github/workflows/production-no-app-preflight.yml@refs/heads/main",
    display_title: `No-app prep ${targetSha} unified-v4-republication-v1`,
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: targetSha,
    status: "completed",
    conclusion: "failure",
    run_attempt: 1,
    actor: { id: 126446430 },
    triggering_actor: { id: 126446430 },
    repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
    ...overrides,
  };
}

function deployJobs(overrides = {}) {
  const authorizeSteps = [
    ["Set up job", "success"],
    ["Checkout main gate helpers", "success"],
    ["Verify triggering CI or owner dispatch and current main", "success"],
    ["Post Checkout main gate helpers", "success"],
    ["Complete job", "success"],
  ].map(([name, conclusion], index) => ({ name, conclusion, status: "completed", number: index + 1 }));
  const deploySteps = [
    ["Set up job", "success"],
    ["Checkout exact current main tooling", "success"],
    ["Recheck run identity and main tip before production credentials", "success"],
    ["Validate SSH inputs and pin the production host", "success"],
    ["Deploy exact SHA through the fixed production script", "failure"],
    ["Remove temporary SSH credentials", "success"],
    ["Post Checkout exact current main tooling", "success"],
    ["Complete job", "success"],
  ].map(([name, conclusion], index) => ({ name, conclusion, status: "completed", number: index + 1 }));
  return {
    total_count: 2,
    jobs: [
      { name: "Authorize exact current-main app deploy", status: "completed", conclusion: "success", head_sha: targetSha, run_attempt: 1, steps: authorizeSteps },
      { name: "Deploy exact current-main SHA", status: "completed", conclusion: "failure", head_sha: targetSha, run_attempt: 1, steps: deploySteps },
    ],
    ...overrides,
  };
}

function deployCiRun(overrides = {}) {
  return {
    id: 765,
    workflow_id: 321,
    path: ".github/workflows/ci.yml@refs/heads/main",
    event: "push",
    head_branch: "main",
    head_sha: targetSha,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    ...overrides,
  };
}

function safeSchemaBlockedDeployEvidence(overrides = {}) {
  return {
    run: deployRun(),
    jobs: deployJobs(),
    ciRuns: [deployCiRun()],
    shaIsAncestorOfCurrentMain: true,
    ...overrides,
  };
}

function databaseReport() {
  return {
    identity: {
      database: "bodycast", databaseOid: 16384, clusterSystemIdentifier: "7419276301947620311",
      role: "bodycast", serverVersion: "17.11", serverAddress: "172.20.0.2", serverPort: 5432,
    },
    migrations: [{ name: "20260929170000_training_load_accounting_v1", checksum: "a".repeat(64), startedAt: "2026-10-01T00:00:00Z", finishedAt: "2026-10-01T00:00:01Z", rolledBackAt: null }],
    objects: [{ name: "Profile", present: true, signature: "reviewed-schema-signature" }],
  };
}

const preflightWorkflowId = "123";
const migrationWorkflowId = "456";
const successfulSourceRunId = "38000669120";
const preDdlMigrationRunId = "38000669121";
const blockedCaptureRunId = "38000669122";
const safePreflightRetryRunId = "38000669123";
const currentResumeRunId = "38000669124";
const successfulPreflightSteps = [
  "Enter maintenance and drain the old app before backup",
  "Verify production container and PostgreSQL client versions",
  "Read-only production identity, full migration set, schema signatures, and locks",
  "Capture pg_dump start on production host and create encrypted backup",
  "Restore snapshot, compare source state, and rehearse exact migrations",
  "Create preflight evidence bundle",
  "Upload encrypted production backup artifact",
  "Upload immutable preflight and restore evidence artifact",
  "Report read-only completion",
];
const migrationFailure = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/scripts/github-owner-identity.mjs' imported from /app/scripts/production-migration-authorization.mjs";
const migrationLog = [
  `Final live guard and authorized migration\tRun the fixed guarded migration script over SSH\t2026-10-10T00:08:25.9244355Z ${migrationFailure}`,
  `Final live guard and authorized migration\tRun the fixed guarded migration script over SSH\t2026-10-10T00:08:27.8263452Z ${migrationFailure}`,
  'Final live guard and authorized migration\tRun the fixed guarded migration script over SSH\t2026-10-10T00:08:28.8286882Z {"schemaVersion":1,"contract":"bodycast-compose-internal-db-single-writer-v1","ready":true}',
  `Final live guard and authorized migration\tRun the fixed guarded migration script over SSH\t2026-10-10T00:08:29.3550399Z ${migrationFailure}`,
].join("\n");
const captureFailure = "An earlier pre-DDL release capture exists; operator review is required before another migration attempt.";
const migrationExecutionSteps = [
  ["Checkout exact authorized release SHA", "success"],
  ["Set up Node runtime", "success"],
  ["Recheck current canonical main before production SSH", "success"],
  ["Download only the signed context artifact", "success"],
  ["Validate protected production SSH and pin host key", "success"],
  ["Trust only the SSH key matching the pinned fingerprint", "success"],
  ["Stream signed evidence files to private remote temporary context", "success"],
  ["Run the fixed guarded migration script over SSH", "failure"],
  ["Remove temporary runner credentials", "success"],
  ["Post Set up Node runtime", "skipped"],
  ["Post Checkout exact authorized release SHA", "success"],
].map(([name, conclusion]) => ({
  name,
  conclusion,
  ...(name === "Run the fixed guarded migration script over SSH"
    ? { started_at: "2026-10-10T00:06:21Z", completed_at: "2026-10-10T00:08:29Z" }
    : {}),
  ...(name === "Remove temporary runner credentials"
    ? { started_at: "2026-10-10T00:08:29Z", completed_at: "2026-10-10T00:08:29Z" }
    : {}),
}));

function ownerRun({ id, workflowId, path, sha, conclusion }) {
  return {
    id: Number(id), workflow_id: Number(workflowId),
    path: `${path}@refs/heads/main`, event: "workflow_dispatch", head_branch: "main", head_sha: sha,
    status: "completed", conclusion, run_attempt: 1,
    actor: { id: 126446430 }, triggering_actor: { id: 126446430 },
    repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
  };
}

function successfulSourceRun() {
  return ownerRun({ id: successfulSourceRunId, workflowId: preflightWorkflowId,
    path: ".github/workflows/production-migration-preflight.yml", sha: sourceSha, conclusion: "success" });
}

function successfulSourceJobs() {
  return {
    total_count: 2,
    jobs: [
      { name: "Authorize read-only preflight", conclusion: "success", head_sha: sourceSha, run_attempt: 1 },
      { name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL", conclusion: "success",
        head_sha: sourceSha, run_attempt: 1, steps: successfulPreflightSteps.map((name) => ({ name, conclusion: "success" })) },
    ],
  };
}

function successfulSourceArtifacts() {
  return {
    total_count: 2,
    artifacts: [
      { name: `bodycast-backup-${sourceSha}-active-energy-unified-v2-${successfulSourceRunId}-1`, expired: false,
        size_in_bytes: 58_687_970, digest: `sha256:${"c".repeat(64)}` },
      { name: `bodycast-preflight-evidence-${sourceSha}-active-energy-unified-v2-${successfulSourceRunId}-1`, expired: false,
        size_in_bytes: 18_965, digest: `sha256:${"d".repeat(64)}` },
    ],
  };
}

function preDdlMigrationRun() {
  return ownerRun({ id: preDdlMigrationRunId, workflowId: migrationWorkflowId,
    path: ".github/workflows/production-migrate.yml", sha: sourceSha, conclusion: "failure" });
}

function preDdlMigrationJobs() {
  return {
    total_count: 3,
    jobs: [
      { name: "Select latest exact preflight evidence", conclusion: "success", head_sha: sourceSha, run_attempt: 1 },
      { name: "Sign migration authorization envelope", conclusion: "success", head_sha: sourceSha, run_attempt: 1 },
      { name: "Final live guard and authorized migration", conclusion: "failure", head_sha: sourceSha, run_attempt: 1,
        steps: migrationExecutionSteps },
    ],
  };
}

function blockedCapturePreflightRun() {
  return ownerRun({ id: blockedCaptureRunId, workflowId: preflightWorkflowId,
    path: ".github/workflows/production-migration-preflight.yml", sha: blockedCaptureSha, conclusion: "failure" });
}

function blockedCapturePreflightJobs() {
  const conclusions = [
    ["Enter maintenance and drain the old app before backup", "failure"],
    ["Verify production container and PostgreSQL client versions", "skipped"],
    ["Read-only production identity, full migration set, schema signatures, and locks", "skipped"],
    ["Capture pg_dump start on production host and create encrypted backup", "skipped"],
    ["Restore snapshot, compare source state, and rehearse exact migrations", "skipped"],
    ["Create preflight evidence bundle", "skipped"],
    ["Upload encrypted production backup artifact", "skipped"],
    ["Upload immutable preflight and restore evidence artifact", "skipped"],
    ["Report read-only completion", "skipped"],
  ];
  return {
    total_count: 2,
    jobs: [
      { name: "Authorize read-only preflight", conclusion: "success", head_sha: blockedCaptureSha, run_attempt: 1 },
      { name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL", conclusion: "failure",
        head_sha: blockedCaptureSha, run_attempt: 1, steps: conclusions.map(([name, conclusion]) => ({ name, conclusion })) },
    ],
  };
}

function safePreflightRetryRun(overrides = {}) {
  return {
    ...ownerRun({ id: safePreflightRetryRunId, workflowId: preflightWorkflowId,
      path: ".github/workflows/production-migration-preflight.yml", sha: targetSha, conclusion: "failure" }),
    display_title: "Preflight " + targetSha + " unified-v4-republication-v1",
    ...overrides,
  };
}

function safePreflightRetryJobs(overrides = {}) {
  return {
    total_count: 2,
    jobs: [
      { name: "Authorize read-only preflight", status: "completed", conclusion: "failure", head_sha: targetSha, run_attempt: 1,
        steps: [
          { name: "Set up job", conclusion: "success" },
          { name: "Checkout current main tooling", conclusion: "success" },
          { name: "Validate canonical repository, exact main, and successful CI", conclusion: "failure" },
          { name: "Post Checkout current main tooling", conclusion: "success" },
          { name: "Complete job", conclusion: "success" },
        ].map((step) => ({ ...step, status: "completed" })) },
      { name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL", status: "completed", conclusion: "skipped",
        head_sha: targetSha, run_attempt: 1, steps: [] },
    ],
    ...overrides,
  };
}

function withCompletedStepStatuses(jobs) {
  return {
    ...jobs,
    jobs: jobs.jobs.map((job) => ({
      ...job,
      status: "completed",
      steps: (job.steps ?? []).map((step, index) => ({ ...step, number: index + 1, status: "completed" })),
    })),
  };
}

function safePreflightRetryEvidence(overrides = {}) {
  return {
    run: safePreflightRetryRun(),
    jobs: withCompletedStepStatuses(safePreflightRetryJobs()),
    artifacts: { total_count: 0, artifacts: [] },
    shaIsAncestorOfCurrentMain: true,
    sourceShaIsAncestor: true,
    ...overrides,
  };
}

function authorizationOnlyPreflightRetryEvidence(overrides = {}) {
  return {
    run: safePreflightRetryRun({ id: 38000669128 }),
    jobs: withCompletedStepStatuses(safePreflightRetryJobs()),
    artifacts: { total_count: 0, artifacts: [] },
    shaIsAncestorOfCurrentMain: true,
    sourceShaIsAncestor: true,
    ...overrides,
  };
}

const v4ManifestId = "unified-v4-republication-v1";
const captureBlockedJobSteps = [
  ["Set up job", "success"],
  ["Initialize containers", "success"],
  ["Checkout exact release SHA", "success"],
  ["Set up pinned Node runtime", "success"],
  ["Install locked Prisma and project tooling", "success"],
  ["Recheck owner identity for this job attempt before production secrets", "success"],
  ["Recheck canonical main before production access", "success"],
  ["Validate production-only SSH and backup secrets", "success"],
  ["Pin production SSH host key", "success"],
  ["Enter maintenance and drain the old app before backup", "failure"],
  ["Verify production container and PostgreSQL client versions", "skipped"],
  ["Read-only production identity, full migration set, schema signatures, and locks", "skipped"],
  ["Capture pg_dump start on production host and create encrypted backup", "skipped"],
  ["Restore snapshot, compare source state, and rehearse exact migrations", "skipped"],
  ["Bind forward-resume authorization to the fresh live snapshot and rehearsal", "skipped"],
  ["Create preflight evidence bundle", "skipped"],
  ["Upload encrypted production backup artifact", "skipped"],
  ["Upload immutable preflight and restore evidence artifact", "skipped"],
  ["Report read-only completion", "skipped"],
  ["Remove temporary SSH credentials", "success"],
  ["Post Set up pinned Node runtime", "skipped"],
  ["Post Checkout exact release SHA", "success"],
  ["Stop containers", "success"],
  ["Complete job", "success"],
];

function captureBlockedRetryRun({ id = 38000669127, sha = targetSha, manifestId = v4ManifestId, ...overrides } = {}) {
  return {
    ...ownerRun({ id, workflowId: preflightWorkflowId, path: ".github/workflows/production-migration-preflight.yml",
      sha, conclusion: "failure" }),
    name: `Preflight ${sha} ${manifestId}`,
    ...overrides,
  };
}

function captureBlockedRetryJobs({ extraInspectStep, ...overrides } = {}) {
  const inspectSteps = captureBlockedJobSteps.map(([name, conclusion], index) => ({
    name, conclusion,
    number: index + 1,
    status: "completed",
    ...(name === "Enter maintenance and drain the old app before backup"
      ? { started_at: "2026-10-11T11:59:59Z", completed_at: "2026-10-11T12:00:01Z" }
      : {}),
  }));
  if (extraInspectStep) inspectSteps.push(extraInspectStep);
  return {
    total_count: 2,
    jobs: [
      { name: "Authorize read-only preflight", status: "completed", conclusion: "success", head_sha: targetSha, run_attempt: 1,
        steps: ["Set up job", "Checkout exact release SHA", "Recheck owner and exact main", "Complete job"].map((name, index) => ({
          name, conclusion: "success", number: index + 1, status: "completed",
        })) },
      { name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL", status: "completed", conclusion: "failure",
        head_sha: targetSha, run_attempt: 1, steps: inspectSteps },
    ],
    ...overrides,
  };
}

function captureBlockedRetryEvidence({
  run = captureBlockedRetryRun(), jobs = captureBlockedRetryJobs(), artifacts = { total_count: 0, artifacts: [] },
  ...overrides
} = {}) {
  return {
    run, jobs, artifacts,
    shaIsAncestorOfCurrentMain: true,
    sourceShaIsAncestor: true,
    ...overrides,
  };
}

function verifyWithCaptureBlockedRetries(retryEvidenceList, overrides = {}) {
  const history = retryEvidenceList.map((evidence) => evidence.run);
  return verify({
    manifestId: v4ManifestId,
    sourceRun: sourceRun({ display_title: `Preflight ${sourceSha} ${v4ManifestId}` }),
    laterRuns: [...history, {
      id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main",
      status: "in_progress", workflow_id: Number(preflightWorkflowId),
    }],
    safeFailedPreflightRetries: retryEvidenceList,
    ...overrides,
  });
}

function verifyPreDdlResume(overrides = {}) {
  return verifyPreDdlMigrationFailureResume({
    sourceRun: successfulSourceRun(), sourceJobs: successfulSourceJobs(), sourceArtifacts: successfulSourceArtifacts(),
    migrationRun: preDdlMigrationRun(), migrationJobs: preDdlMigrationJobs(),
    migrationLogText: migrationLog,
    blockedCaptureRun: blockedCapturePreflightRun(), blockedCaptureJobs: blockedCapturePreflightJobs(),
    blockedCaptureArtifacts: { total_count: 0, artifacts: [] }, blockedCaptureLogText: captureFailure,
    laterRuns: [
      { id: Number(preDdlMigrationRunId), path: ".github/workflows/production-migrate.yml@refs/heads/main", status: "completed", conclusion: "failure" },
      { id: Number(blockedCaptureRunId), path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "completed", conclusion: "failure" },
      safePreflightRetryRun(),
      { id: Number(currentResumeRunId), path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress" },
    ],
    safeFailedPreflightRetries: [safePreflightRetryEvidence()],
    sourceRunId: successfulSourceRunId, migrationRunId: preDdlMigrationRunId, blockedCaptureRunId,
    currentRunId: currentResumeRunId, currentMainSha: targetSha,
    preflightWorkflowId, migrationWorkflowId, sourceIsAncestor: true,
    sourceIsAncestorOfBlockedCapture: true, blockedCaptureIsAncestorOfCurrentMain: true,
    ...overrides,
  });
}

describe("verified resume of a failed production preflight", () => {
  it("passes UNVERIFIED history metadata into the fresh preflight evidence bundle", async () => {
    const workflow = await readFile(".github/workflows/production-migration-preflight.yml", "utf8");
    const evidenceScript = await readFile("scripts/production-migration-evidence.mjs", "utf8");
    expect(workflow).toContain("unverified_historical_runs: ${{ steps.gate.outputs.unverified_historical_runs }}");
    expect(workflow).toContain("UNVERIFIED_HISTORICAL_RUNS: ${{ needs.authorize.outputs.unverified_historical_runs }}");
    expect(workflow).toContain("unverified_historical_runs=$UNVERIFIED_HISTORICAL_RUNS");
    expect(evidenceScript).toContain("historicalRecovery:");
    expect(evidenceScript).toContain("ddlAuthorizationGranted: false");
  });

  it("runs source verification without historical deploy log text", async () => {
    const currentMainSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const currentRunId = "1002";
    const sourceRunId = "1000";
    const deployId = "1001";
    const actualSourceRun = sourceRun({ id: Number(sourceRunId), head_sha: currentMainSha,
      display_title: `Preflight ${currentMainSha} active-energy-unified-v2` });
    const actualSourceJobs = {
      ...sourceJobs(),
      jobs: sourceJobs().jobs.map((job) => ({ ...job, head_sha: currentMainSha })),
    };
    const actualDeployRun = deployRun({ id: Number(deployId), head_sha: currentMainSha });
    const actualDeployJobs = {
      ...deployJobs(),
      jobs: deployJobs().jobs.map((job) => ({ ...job, head_sha: currentMainSha })),
    };
    const actualCiRun = deployCiRun({ head_sha: currentMainSha });
    const safeDeployEvidence = {
      run: actualDeployRun,
      jobs: actualDeployJobs,
      ciRuns: [actualCiRun],
    };
    const laterRuns = [actualDeployRun, {
      id: Number(currentRunId),
      workflow_id: Number(preflightWorkflowId),
      path: ".github/workflows/production-migration-preflight.yml@refs/heads/main",
      event: "workflow_dispatch",
      head_branch: "main",
      head_sha: currentMainSha,
      status: "in_progress",
      conclusion: null,
      run_attempt: 1,
    }];
    const tempDir = await mkdtemp(path.join(tmpdir(), "bodycast-preflight-cli-"));
    try {
      const files = {
        run: path.join(tempDir, "source-run.json"),
        jobs: path.join(tempDir, "source-jobs.json"),
        artifacts: path.join(tempDir, "source-artifacts.json"),
        later: path.join(tempDir, "later-runs.ndjson"),
        deploy: path.join(tempDir, "safe-deploy-runs.ndjson"),
        preflightRetries: path.join(tempDir, "safe-failed-preflights.ndjson"),
        noAppRuns: path.join(tempDir, "safe-historical-no-app-runs.ndjson"),
      };
      await Promise.all([
        writeFile(files.run, JSON.stringify(actualSourceRun)),
        writeFile(files.jobs, JSON.stringify(actualSourceJobs)),
        writeFile(files.artifacts, JSON.stringify({ total_count: 0, artifacts: [] })),
        writeFile(files.later, laterRuns.map((run) => JSON.stringify(run)).join("\n") + "\n"),
        writeFile(files.deploy, `${JSON.stringify(safeDeployEvidence)}\n`),
        writeFile(files.preflightRetries, ""),
        writeFile(files.noAppRuns, ""),
      ]);
      const scriptPath = path.resolve("scripts/production-preflight-resume.mjs");
      const result = spawnSync(process.execPath, [scriptPath, "--verify-source", files.run, files.jobs, files.artifacts,
        files.later, files.deploy, files.preflightRetries, files.noAppRuns, sourceRunId, currentRunId, currentMainSha,
        "active-energy-unified-v2", preflightWorkflowId, deployWorkflowId, "456"], {
        cwd: process.cwd(), encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        schemaVersion: 2,
        sourceRunId,
        targetSha: currentMainSha,
        unverifiedHistoricalDeployRunIds: [deployId],
        unverifiedHistoricalPreflightRunIds: [],
        unverifiedHistoricalRunIds: [],
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("admits only the original owner run that stopped after a successful backup and failed isolated restore", () => {
    expect(verify()).toEqual({ schemaVersion: 2, sourceRunId: "38000669126", sourceRunAttempt: 1, sourceSha, targetSha,
      unverifiedHistoricalDeployRunIds: [], unverifiedHistoricalPreflightRunIds: [], unverifiedHistoricalAuthorizationOnlyPreflightRunIds: [], historicalPreflightEffects: [],
      unverifiedHistoricalRunIds: [] });
  });

  it("admits only unverified owner V4 capture retry history and ignores prior textual logs", () => {
    const priorCaptureGuard = captureBlockedRetryEvidence({
      run: captureBlockedRetryRun({ id: 38000669127 }),
    });
    const noAppRefreshGuard = captureBlockedRetryEvidence({
      run: captureBlockedRetryRun({ id: 38000669128 }),
      failure: "Capture refresh requires exactly one existing BodyCast app container.",
    });
    const result = verifyWithCaptureBlockedRetries([priorCaptureGuard, noAppRefreshGuard]);
    expect(result.unverifiedHistoricalPreflightRunIds).toEqual(["38000669127", "38000669128"]);
    expect(result.historicalPreflightEffects).toEqual(["38000669127", "38000669128"].map((runId) => ({
      runId, sha: targetSha, historicalEffects: "UNVERIFIED",
    })));
    expect(result.unverifiedHistoricalDeployRunIds).toEqual([]);
  });

  it("admits a failed historical inspection with incomplete logs as UNVERIFIED metadata", () => {
    const evidence = captureBlockedRetryEvidence();
    const result = verifyWithCaptureBlockedRetries([evidence]);
    expect(result.unverifiedHistoricalPreflightRunIds).toEqual(["38000669127"]);
    expect(result.historicalPreflightEffects).toEqual([{
      runId: "38000669127", sha: targetSha, historicalEffects: "UNVERIFIED",
    }]);
    expect(result.unverifiedHistoricalAuthorizationOnlyPreflightRunIds).toEqual([]);
  });
  it("admits owner authorization-only failures separately from capture-blocked retries", () => {
    const historicalWorkflowId = historicalAuthorizationRetries[0].run.workflow_id;
    const captureRetry = captureBlockedRetryEvidence({
      run: captureBlockedRetryRun({ id: 38000669127, workflow_id: historicalWorkflowId }),
    });
    const authorizationOnlyRetries = historicalAuthorizationRetries.map(({ run, jobs, artifacts }, index) => ({
      run, jobs, artifacts,
      shaIsAncestorOfCurrentMain: true,
      sourceShaIsAncestor: true,
      ...(index === 0 ? { jobs: { ...jobs, jobs: [...jobs.jobs].reverse() } } : {}),
    }));
    const result = verifyWithCaptureBlockedRetries([captureRetry, ...authorizationOnlyRetries], {
      sourceRun: sourceRun({ workflow_id: historicalWorkflowId,
        display_title: `Preflight ${sourceSha} ${v4ManifestId}` }),
      workflowId: String(historicalWorkflowId),
    });

    expect(result.unverifiedHistoricalAuthorizationOnlyPreflightRunIds).toEqual(historicalAuthorizationRetries
      .map(({ run }) => String(run.id)).sort());
    expect(result.unverifiedHistoricalPreflightRunIds).toEqual(["38000669127"]);
    expect(result.historicalPreflightEffects).toEqual([{ runId: "38000669127", sha: targetSha, historicalEffects: "UNVERIFIED" }]);
    expect(result.historicalPreflightEffects.some(({ runId }) => historicalAuthorizationRetries.some(({ run }) => String(run.id) === runId))).toBe(false);
    expect(result.unverifiedHistoricalRunIds).toEqual([]);
  });

  it("carries pre-DDL auth-only retries forward as UNVERIFIED metadata only", () => {
    const retries = historicalAuthorizationRetries.map(({ run, jobs, artifacts }) => {
      const boundRun = { ...run, workflow_id: Number(preflightWorkflowId) };
      return { run: boundRun, jobs, artifacts, shaIsAncestorOfCurrentMain: true, sourceShaIsAncestor: true };
    });
    const proof = verifyPreDdlResume({
      laterRuns: [
        { id: Number(preDdlMigrationRunId), path: ".github/workflows/production-migrate.yml@refs/heads/main", status: "completed", conclusion: "failure" },
        { id: Number(blockedCaptureRunId), path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "completed", conclusion: "failure" },
        ...retries.map(({ run }) => run),
        { id: 50000000000, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress" },
      ],
      safeFailedPreflightRetries: retries,
      currentRunId: "50000000000",
    });
    expect(proof.unverifiedHistoricalAuthorizationOnlyPreflightRunIds)
      .toEqual(historicalAuthorizationRetries.map(({ run }) => String(run.id)).sort());
    expect(proof).not.toHaveProperty("historicalPreflightEffects");
  });

  it.each([
    ["another owner", { run: safePreflightRetryRun({ id: 38000669128, triggering_actor: { id: 7 } }) }],
    ["stale SHA", { shaIsAncestorOfCurrentMain: false }],
    ["not descended from source", { sourceShaIsAncestor: false }],
    ["incomplete jobs inventory", { jobs: safePreflightRetryJobs({ total_count: 1 }) }],
    ["unexpected job", { jobs: safePreflightRetryJobs({ jobs: [...safePreflightRetryJobs().jobs,
      { name: "Unexpected production job", status: "completed", conclusion: "skipped", head_sha: targetSha, run_attempt: 1, steps: [] }] }) }],
    ["published artifact after authorization-only failure", { artifacts: { total_count: 1, artifacts: [{ id: 8 }] } }],
    ["incomplete artifact inventory", { artifacts: { total_count: 0 } }],
    ["inspection unexpectedly ran", { jobs: safePreflightRetryJobs({ jobs: safePreflightRetryJobs().jobs.map((job) =>
      job.name.startsWith("Inspect,") ? { ...job, conclusion: "failure" } : job) }) }],
    ["inspection has steps despite being skipped", { jobs: safePreflightRetryJobs({ jobs: safePreflightRetryJobs().jobs.map((job) =>
      job.name.startsWith("Inspect,") ? { ...job, steps: [{ name: "unexpected", conclusion: "skipped", status: "completed", number: 1 }] } : job) }) }],
    ["job SHA mismatch", { jobs: safePreflightRetryJobs({ jobs: safePreflightRetryJobs().jobs.map((job) =>
      job.name.startsWith("Authorize") ? { ...job, head_sha: sourceSha } : job) }) }],
    ["duplicated step number", { jobs: { total_count: 2, jobs: withCompletedStepStatuses(safePreflightRetryJobs()).jobs.map((job) =>
      job.name.startsWith("Authorize") ? { ...job, steps: job.steps.map((step, index) => index === 1 ? { ...step, number: 1 } : step) } : job) } }],
  ])("rejects an authorization-only retry when %s", (_label, evidenceOverrides) => {
    expect(() => verifyWithCaptureBlockedRetries([authorizationOnlyPreflightRetryEvidence(evidenceOverrides)]))
      .toThrow("cannot be safely resumed");
  });

  it("marks authorization-only retries UNVERIFIED when GitHub omits conditional step numbers", () => {
    const jobs = withCompletedStepStatuses(safePreflightRetryJobs());
    jobs.jobs[0].steps = jobs.jobs[0].steps.map((step, index) => ({
      ...step,
      number: [1, 2, 3, 6, 7][index],
    }));
    const evidence = authorizationOnlyPreflightRetryEvidence({ jobs });
    const result = verifyWithCaptureBlockedRetries([evidence]);
    expect(result.unverifiedHistoricalAuthorizationOnlyPreflightRunIds).toEqual([String(evidence.run.id)]);
    expect(result.historicalPreflightEffects).toEqual([]);
  });

  it("does not block an auth-only retry when the failed step is absent from GitHub's step list", () => {
    const jobs = withCompletedStepStatuses(safePreflightRetryJobs());
    jobs.jobs[0].steps = jobs.jobs[0].steps.map((step) => ({ ...step, conclusion: "success" }));
    const evidence = authorizationOnlyPreflightRetryEvidence({ jobs });
    const result = verifyWithCaptureBlockedRetries([evidence]);
    expect(result.unverifiedHistoricalAuthorizationOnlyPreflightRunIds).toEqual([String(evidence.run.id)]);
  });

  it.each([
    ["other owner", { run: captureBlockedRetryRun({ triggering_actor: { id: 7 } }) }],
    ["rerun", { run: captureBlockedRetryRun({ run_attempt: 2 }) }],
    ["stale retry SHA", { shaIsAncestorOfCurrentMain: false }],
    ["retry not descended from source", { sourceShaIsAncestor: false }],
    ["incomplete artifact inventory", { artifacts: { total_count: 0 } }],
    ["incomplete job inventory", { jobs: captureBlockedRetryJobs({ total_count: 1 }) }],
    ["step inventory has a gap", { jobs: captureBlockedRetryJobs({ jobs: captureBlockedRetryJobs().jobs.map((job) =>
      job.name.startsWith("Inspect,") ? { ...job, steps: job.steps.map((step, index) => index === 1 ? { ...step, number: 9 } : step) } : job) }) }],
  ])("blocks a failed historical inspection when %s", (_label, evidenceOverrides) => {
    const evidence = captureBlockedRetryEvidence(evidenceOverrides);
    expect(() => verifyWithCaptureBlockedRetries([evidence])).toThrow("cannot be safely resumed");
  });

  it("accepts old artifacts from a failed inspection only as unverified metadata", () => {
    const evidence = captureBlockedRetryEvidence({
      run: captureBlockedRetryRun({ name: "Historical preflight title changed" }),
      artifacts: { total_count: 1, artifacts: [{ id: 8, name: "historical-backup" }] },
    });
    const result = verifyWithCaptureBlockedRetries([evidence]);
    expect(result.unverifiedHistoricalPreflightRunIds).toEqual([String(evidence.run.id)]);
  });
  it("rejects unrelated later production mutations even with safe capture retry evidence", () => {
    const evidence = captureBlockedRetryEvidence();
    expect(() => verifyWithCaptureBlockedRetries([evidence], {
      laterRuns: [evidence.run, {
        id: 38000669128, path: ".github/workflows/production-migrate.yml@refs/heads/main",
        status: "completed", conclusion: "failure",
      }, {
        id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
      }],
    })).toThrow("cannot be safely resumed");
  });

  it("admits a later exact-SHA automatic deploy as explicitly unverified history", () => {
    const run = deployRun();
    const result = verify({ laterRuns: [run, {
      id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
    }], safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence()],
    });
    expect(result.unverifiedHistoricalDeployRunIds).toEqual([safeSchemaBlockedDeployRunId]);
  });

  it("admits completed no-app preparation only as unverified history and never reuses its artifacts", () => {
    const evidence = structuredClone(successfulHistoricalNoAppPreparation);
    evidence.run.display_title = "Historical preparation label changed";
    const run = evidence.run;
    const result = verify({
      laterRuns: [run, {
        id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
      }],
      safeHistoricalNoAppRuns: [evidence],
      noAppWorkflowId: run.workflow_id,
      isAncestorOfCurrentMain: () => true,
    });
    expect(result.unverifiedHistoricalRunIds).toEqual([String(run.id)]);
  });

  it("accepts the actual evidence-step failure after successful isolated rehearsal as unverified history", () => {
    const evidence = structuredClone(failedHistoricalNoAppAfterRehearsal);
    const run = evidence.run;
    const result = verify({
      laterRuns: [run, {
        id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
      }],
      safeHistoricalNoAppRuns: [evidence],
      noAppWorkflowId: run.workflow_id,
      isAncestorOfCurrentMain: () => true,
    });
    expect(result.unverifiedHistoricalRunIds).toEqual([String(run.id)]);
  });

  it("keeps a failed no-app run with uncertain cleanup explicitly unverified", () => {
    const evidence = structuredClone(failedHistoricalNoAppAfterRehearsal);
    evidence.jobs.jobs[1].steps.find((step) => step.name === "Remove temporary SSH credentials").conclusion = "cancelled";
    const run = evidence.run;
    const result = verify({
      laterRuns: [run, {
        id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
      }],
      safeHistoricalNoAppRuns: [evidence],
      noAppWorkflowId: run.workflow_id,
      isAncestorOfCurrentMain: () => true,
    });
    expect(result.unverifiedHistoricalRunIds).toEqual([String(run.id)]);
  });

  it("rejects historical no-app metadata that omits a required gate even when the inventory is long", () => {
    const evidence = structuredClone(successfulHistoricalNoAppPreparation);
    evidence.jobs.jobs[1].steps.splice(6, 1);
    expect(evidence.jobs.jobs[1].steps.length).toBeGreaterThanOrEqual(18);
    const run = evidence.run;
    expect(() => verify({
      laterRuns: [run, {
        id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
      }],
      safeHistoricalNoAppRuns: [evidence],
      noAppWorkflowId: run.workflow_id,
      isAncestorOfCurrentMain: () => true,
    })).toThrow("cannot be safely resumed");
  });

  it.each([
    ["owner mismatch", { actor: { id: 7 }, triggering_actor: { id: 7 } }],
    ["workflow ID mismatch", { workflow_id: 457 }],
    ["malformed SHA", { head_sha: "not-a-sha" }],
    ["unknown conclusion", { conclusion: "skipped" }],
  ])("blocks no-app history with %s", (_label, overrides) => {
    const evidence = structuredClone(successfulHistoricalNoAppPreparation);
    evidence.run = { ...evidence.run, ...overrides };
    const run = evidence.run;
    expect(() => verify({
      laterRuns: [run, {
        id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
      }],
      safeHistoricalNoAppRuns: [evidence],
      noAppWorkflowId: successfulHistoricalNoAppPreparation.run.workflow_id,
      isAncestorOfCurrentMain: () => true,
    })).toThrow("cannot be safely resumed");
  });

  it("blocks an active no-app preparation run", () => {
    expect(() => verify({ laterRuns: [completedNoAppRun({ status: "in_progress", conclusion: null }), {
      id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
    }] })).toThrow("cannot be safely resumed");
  });

  it("rejects a later production full-history recalculation run", () => {
    expect(() => verify({ laterRuns: [
      { id: 38000669128, path: ".github/workflows/production-full-history-recalculate.yml@refs/heads/main",
        status: "completed", conclusion: "success" },
      { id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress" },
    ] })).toThrow("another release or preflight workflow exists after source run 38000669126");
  });

  it.each([
    ["missing deploy metadata", { safeFailedDeployRuns: [] }],
    ["deploy actor is not the pinned owner", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ actor: { id: 7 }, triggering_actor: { id: 7 } }) })] }],
    ["deploy rerun", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ run_attempt: 2 }) })] }],
    ["manual deploy", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ event: "workflow_dispatch" }) })] }],
    ["wrong branch", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ head_branch: "feature/x" }) })] }],
    ["different deploy SHA", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ head_sha: sourceSha }) })] }],
    ["wrong workflow identity", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ workflow_id: 999 }) })] }],
    ["missing exact-SHA main CI", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ ciRuns: [] })] }],
    ["failed main CI", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ ciRuns: [deployCiRun({ conclusion: "failure" })] })] }],
    ["wrong CI event", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ ciRuns: [deployCiRun({ event: "pull_request" })] })] }],
    ["incomplete job inventory", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ jobs: {
      total_count: 1, jobs: deployJobs().jobs.slice(0, 1),
    } })] }],
    ["unexpected job", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ jobs: deployJobs({ jobs: [
      ...deployJobs().jobs,
      { name: "Unexpected job", status: "completed", conclusion: "failure", head_sha: targetSha, run_attempt: 1, steps: [] },
    ], total_count: 3 }) })] }],
    ["incomplete step inventory", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ jobs: deployJobs({ jobs:
      deployJobs().jobs.map((job) => job.name.startsWith("Deploy exact")
        ? { ...job, steps: job.steps.slice(0, -1) } : job) }) })] }],
    ["step sequence has a gap", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ jobs: deployJobs({ jobs:
      deployJobs().jobs.map((job) => job.name.startsWith("Deploy exact")
        ? { ...job, steps: job.steps.map((step, index) => index === 1 ? { ...step, number: 9 } : step) } : job) }) })] }],
    ["run not in current main ancestry", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ shaIsAncestorOfCurrentMain: false })] }],
    ["deploy is concurrent with current preflight", { laterRuns: [deployRun({ id: 100000000000 }), {
      id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
    }], safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ id: 100000000000 }) })] }],
  ])("rejects a later deploy when %s", (_label, overrides) => {
    expect(() => verify({
      laterRuns: [deployRun(), {
        id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
      }],
      safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence()],
      ...overrides,
    })).toThrow("cannot be safely resumed");
  });
  it.each([
    ["other actor", { sourceRun: sourceRun({ triggering_actor: { id: 19 } }) }],
    ["rerun source", { sourceRun: sourceRun({ run_attempt: 2 }) }],
    ["different source SHA", { sourceJobs: { ...sourceJobs(), jobs: sourceJobs().jobs.map((job) => ({ ...job, head_sha: "c".repeat(40) })) } }],
    ["published artifact", { sourceArtifacts: { total_count: 1, artifacts: [{ id: 1 }] } }],
    ["different failed step", { sourceJobs: { ...sourceJobs(), jobs: sourceJobs().jobs.map((job) => job.name.startsWith("Inspect,")
      ? { ...job, steps: job.steps.map((step) => step.name.startsWith("Restore snapshot") ? { ...step, conclusion: "success" } : step) } : job) } }],
    ["later production mutation", { laterRuns: [{ id: 38000669127, path: ".github/workflows/production-migrate.yml@refs/heads/main", status: "completed", conclusion: "failure" }] }],
    ["non-ancestor source SHA", { sourceIsAncestor: false }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => verify(overrides)).toThrow("cannot be safely resumed");
  });

  it("rebinds only the release SHA while preserving the immutable prior app and exact DB compatibility", () => {
    const report = databaseReport();
    const record = capturePreviousAppProvenance({
      targetSha: sourceSha,
      databaseReport: report,
      container: {
        Id: "d".repeat(64),
        Image: `sha256:${"e".repeat(64)}`,
        State: { Health: { Status: "healthy" } },
        Config: { Labels: null, Env: ["NODE_ENV=production"] },
        HostConfig: { RestartPolicy: { Name: "unless-stopped" } },
      },
    });
    const result = rebindPreviousAppProvenanceForPreflightResume({
      record, sourceSha, targetSha, sourceRunId: "38000669126", sourceRunAttempt: 1, databaseReport: report,
    });
    expect(result.record.targetSha).toBe(targetSha);
    expect(result.record.previousImageId).toBe(record.previousImageId);
    expect(result.record.previousContainerId).toBe(record.previousContainerId);
    expect(result.record.preDdlDatabaseCompatibilityDigest).toBe(record.preDdlDatabaseCompatibilityDigest);
    expect(result.receipt).toMatchObject({ sourceRunId: "38000669126", sourceRunAttempt: 1, sourceSha, targetSha });
    expect(result.receipt.sourceRecordDigest).not.toBe(result.receipt.currentRecordDigest);
  });

  it("blocks a resume if live DB identity/history/schema differs from the saved capture", () => {
    const report = databaseReport();
    const record = capturePreviousAppProvenance({
      targetSha: sourceSha,
      databaseReport: report,
      container: {
        Id: "d".repeat(64),
        Image: `sha256:${"e".repeat(64)}`,
        State: { Health: { Status: "healthy" } },
        Config: { Labels: null, Env: ["NODE_ENV=production"] },
      },
    });
    expect(() => rebindPreviousAppProvenanceForPreflightResume({
      record, sourceSha, targetSha, sourceRunId: "38000669126", sourceRunAttempt: 1,
      databaseReport: { ...report, identity: { ...report.identity, clusterSystemIdentifier: "7419276301947620312" } },
    })).toThrow("current production DB identity, migration history, or schema differs");
  });
});

describe("verified resume after a migration failed before the DDL marker", () => {
  it.skipIf(!bash).each([
    [["38000669123"]],
    [["38000669123", "38000669124"]],
  ])("serializes retry IDs so Bash reads every line (%j)", (ids) => {
    const serialized = serializePreflightRetryRunIds(ids);
    const output = execFileSync(bash, ["-c", "while IFS= read -r retry_run_id; do printf '%s\\n' \"$retry_run_id\"; done"], {
      encoding: "utf8",
      input: serialized,
    });
    expect(serialized.endsWith("\n")).toBe(true);
    expect(output).toBe(`${ids.join("\n")}\n`);
  });

  it("rejects malformed or duplicate retry run IDs before shell serialization", () => {
    expect(() => serializePreflightRetryRunIds(["123", "123"])).toThrow("unique positive integers");
    expect(() => serializePreflightRetryRunIds(["123\n456"])).toThrow("unique positive integers");
    expect(serializePreflightRetryRunIds([])).toBe("");
  });

  it("admits only the exact owner preflight → final-guard import failure → capture-blocked retry sequence", () => {
    expect(verifyPreDdlResume()).toEqual({
      schemaVersion: 2,
      resumeKind: "verified-pre-ddl-migration-failure",
      sourceRunId: successfulSourceRunId,
      sourceRunAttempt: 1,
      sourceSha,
      targetSha,
      migrationFailureRunId: preDdlMigrationRunId,
      blockedCaptureRunId,
      unverifiedHistoricalAuthorizationOnlyPreflightRunIds: [safePreflightRetryRunId],
    });
  });

  it.each([
    ["owner identity mismatch", safePreflightRetryEvidence({ run: safePreflightRetryRun({ triggering_actor: { id: 7 } }) })],
    ["authorization rerun", safePreflightRetryEvidence({ run: safePreflightRetryRun({ run_attempt: 2 }) })],
    ["non-ancestor retry SHA", safePreflightRetryEvidence({ shaIsAncestorOfCurrentMain: false })],
    ["missing artifact inventory", safePreflightRetryEvidence({ artifacts: undefined })],
    ["unexpected authorization step", safePreflightRetryEvidence({ jobs: safePreflightRetryJobs({ jobs: safePreflightRetryJobs().jobs.map((job) =>
      job.name.startsWith("Authorize") ? { ...job, steps: [...job.steps, { name: "Unexpected side effect", conclusion: "success" }] } : job) }) })],
    ["inspection job failure", safePreflightRetryEvidence({ jobs: safePreflightRetryJobs({ jobs: safePreflightRetryJobs().jobs.map((job) =>
      job.name.startsWith("Inspect,") ? { ...job, conclusion: "failure" } : job) }) })],
    ["authorization failed outside the exact read-only gate", safePreflightRetryEvidence({ jobs: safePreflightRetryJobs({ jobs: safePreflightRetryJobs().jobs.map((job) =>
      job.name.startsWith("Authorize") ? { ...job, steps: job.steps.map((step) => step.name.startsWith("Validate canonical")
        ? { ...step, conclusion: "success" } : step) } : job) }) })],
    ["retry evidence absent", undefined],
  ])("rejects a later preflight retry when %s", (_label, retryEvidence) => {
    const safeFailedPreflightRetries = retryEvidence ? [retryEvidence] : [];
    expect(() => verifyPreDdlResume({ safeFailedPreflightRetries })).toThrow("cannot be safely resumed");
  });

  it("requires the import failure in both live probes and the final guard", () => {
    expect(() => verifyPreDdlResume({ migrationLogText: migrationFailure })).toThrow("exactly three known import failures");
    expect(() => verifyPreDdlResume({ migrationLogText: "unrecognized migration log" }))
      .toThrow(/sanitized evidence counts: \{"parsedLogRecords":1,"fixedMigrationStepRecords":0,"knownImportFailuresInFixedStep":0/);
    const reorderedLines = migrationLog.split("\n");
    [reorderedLines[1], reorderedLines[2]] = [reorderedLines[2], reorderedLines[1]];
    const reorderedLog = reorderedLines.join("\n");
    expect(() => verifyPreDdlResume({ migrationLogText: reorderedLog })).toThrow("not in the reviewed order");
    expect(verifyPreDdlResume({ migrationLogText: migrationLog }).resumeKind).toBe("verified-pre-ddl-migration-failure");
  });

  it("parses wrapped runner logs while binding failures to the sole failed fixed migration step", () => {
    const runnerLog = migrationLog.replaceAll(" imported from ", "\n imported from ");
    expect(verifyPreDdlResume({ migrationLogText: runnerLog }).resumeKind).toBe("verified-pre-ddl-migration-failure");

    const unknownStepLog = migrationLog.replaceAll(
      "\tRun the fixed guarded migration script over SSH\t",
      "\tUNKNOWN STEP\t",
    );
    expect(verifyPreDdlResume({ migrationLogText: unknownStepLog }).resumeKind)
      .toBe("verified-pre-ddl-migration-failure");

    const lateUnknownStepLog = unknownStepLog.replace("2026-10-10T00:08:29.3550399Z", "2026-10-10T00:08:30.3550399Z");
    expect(() => verifyPreDdlResume({ migrationLogText: lateUnknownStepLog }))
      .toThrow("exactly three known import failures");

    const migrationJobsWithoutStepTimes = preDdlMigrationJobs();
    for (const step of migrationJobsWithoutStepTimes.jobs[2].steps) {
      delete step.started_at;
      delete step.completed_at;
    }
    expect(() => verifyPreDdlResume({ migrationLogText: unknownStepLog, migrationJobs: migrationJobsWithoutStepTimes }))
      .toThrow("exactly three known import failures");

    const crossStepErrors = migrationLog.split("\n");
    crossStepErrors[0] = crossStepErrors[0].replace(`\t${"Run the fixed guarded migration script over SSH"}\t`, "\tValidate protected production SSH\t");
    crossStepErrors[1] = crossStepErrors[1].replace(`\t${"Run the fixed guarded migration script over SSH"}\t`, "\tValidate protected production SSH\t");
    let crossStepErrorMessage = "";
    try {
      verifyPreDdlResume({ migrationLogText: crossStepErrors.join("\n") });
    } catch (error) {
      crossStepErrorMessage = error.message;
    }
    expect(crossStepErrorMessage).toContain("exactly three known import failures");
    expect(crossStepErrorMessage).toContain('"step":"Validate protected production SSH"');
    expect(crossStepErrorMessage).not.toContain(migrationFailure);

    const unsafeStepLabel = crossStepErrors.join("\n").replace("Validate protected production SSH", "Unexpected\u0007step");
    let unsafeLabelErrorMessage = "";
    try {
      verifyPreDdlResume({ migrationLogText: unsafeStepLabel });
    } catch (error) {
      unsafeLabelErrorMessage = error.message;
    }
    expect(unsafeLabelErrorMessage).toContain('"step":"Unexpected?step"');
    expect(unsafeLabelErrorMessage).not.toContain("\u0007");
    expect(unsafeLabelErrorMessage).not.toContain(migrationFailure);

    const crossStepWriterDrain = migrationLog.split("\n");
    crossStepWriterDrain[2] = crossStepWriterDrain[2].replace(`\t${"Run the fixed guarded migration script over SSH"}\t`, "\tRead-only production identity check\t");
    expect(() => verifyPreDdlResume({ migrationLogText: crossStepWriterDrain.join("\n") }))
      .toThrow("exactly three known import failures");

    const migrationJobs = preDdlMigrationJobs();
    migrationJobs.jobs[2].steps.push({ name: "Unexpected failed step", conclusion: "failure" });
    expect(() => verifyPreDdlResume({ migrationJobs })).toThrow("exactly three known import failures");
  });

  it.each([
    ["wrong migration owner", { migrationRun: { ...preDdlMigrationRun(), triggering_actor: { id: 42 } } }],
    ["migration rerun", { migrationRun: { ...preDdlMigrationRun(), run_attempt: 2 } }],
    ["different migration failure", { migrationLogText: "Error: connection lost during migration" }],
    ["failure outside final guard", { migrationJobs: { ...preDdlMigrationJobs(), jobs: preDdlMigrationJobs().jobs.map((job) =>
      job.name.startsWith("Final live guard") ? { ...job, steps: job.steps.map((step) => step.name.startsWith("Run the fixed")
        ? { ...step, conclusion: "success" } : step) } : job) } }],
    ["missing or expired source backup", { sourceArtifacts: { ...successfulSourceArtifacts(), artifacts: successfulSourceArtifacts().artifacts.map((artifact) =>
      artifact.name.startsWith("bodycast-backup") ? { ...artifact, expired: true } : artifact) } }],
    ["blocked retry has another failure", { blockedCaptureLogText: "ssh host unreachable" }],
    ["blocked capture stop marker is duplicated", { blockedCaptureLogText: `${captureFailure}\n${captureFailure}` }],
    ["blocked retry published an artifact", { blockedCaptureArtifacts: { total_count: 1, artifacts: [{ id: 9 }] } }],
    ["source SHA not in current main", { sourceIsAncestor: false }],
    ["source SHA not ancestor of blocked capture", { sourceIsAncestorOfBlockedCapture: false }],
    ["blocked capture SHA not ancestor of current main", { blockedCaptureIsAncestorOfCurrentMain: false }],
    ["unexpected later production mutation", { laterRuns: [
      { id: Number(preDdlMigrationRunId), path: ".github/workflows/production-migrate.yml@refs/heads/main" },
      { id: Number(blockedCaptureRunId), path: ".github/workflows/production-migration-preflight.yml@refs/heads/main" },
      { id: Number(currentResumeRunId) - 1, path: ".github/workflows/deploy-production.yml@refs/heads/main" },
      { id: Number(currentResumeRunId), path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress" },
    ] }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => verifyPreDdlResume(overrides)).toThrow("cannot be safely resumed");
  });
});
