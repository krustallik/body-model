import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { capturePreviousAppProvenance, rebindPreviousAppProvenanceForPreflightResume } from "../scripts/production-previous-app-provenance.mjs";
import { DEPLOY_CONTROL_FILES, PREFLIGHT_CAPTURE_RESUME_CONTROL_FILES, deployControlFilesMatch, preflightCaptureResumeControlsMatch,
  serializePreflightRetryRunIds, verifyPreDdlMigrationFailureResume, verifyResumablePreflightAttempt } from "../scripts/production-preflight-resume.mjs";

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

describe("production deploy evidence source binding", () => {
  it("rejects changed migrator build or Prisma inputs between the failed deploy and current main", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "bodycast-deploy-controls-"));
    const changedInputs = ["Dockerfile", ".dockerignore", "package.json", "package-lock.json", "prisma/schema.prisma",
      "prisma/migrations/20261011120000_unified_publication_failure_fence/migration.sql"];
    try {
      expect(DEPLOY_CONTROL_FILES).toEqual(expect.arrayContaining(["Dockerfile", ".dockerignore", "package.json",
        "package-lock.json", "prisma"]));
      execFileSync("git", ["-c", "init.defaultBranch=main", "init", tempDir], { stdio: "ignore" });
      execFileSync("git", ["-C", tempDir, "config", "user.name", "BodyCast Test"], { stdio: "ignore" });
      execFileSync("git", ["-C", tempDir, "config", "user.email", "bodycast-test@example.invalid"], { stdio: "ignore" });
      for (const input of changedInputs) {
        const absolutePath = path.join(tempDir, input);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, "reviewed base input\n");
      }
      execFileSync("git", ["-C", tempDir, "add", "--all"], { stdio: "ignore" });
      execFileSync("git", ["-C", tempDir, "commit", "-m", "base"], { stdio: "ignore" });
      const baseSha = execFileSync("git", ["-C", tempDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

      for (const input of changedInputs) {
        await writeFile(path.join(tempDir, input), "changed input\n");
      }
      execFileSync("git", ["-C", tempDir, "add", "--all"], { stdio: "ignore" });
      execFileSync("git", ["-C", tempDir, "commit", "-m", "change migrator inputs"], { stdio: "ignore" });
      const changedSha = execFileSync("git", ["-C", tempDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      expect(deployControlFilesMatch(baseSha, changedSha, tempDir)).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts only unchanged preflight production steps and capture controls", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "bodycast-preflight-capture-controls-"));
    const workflowPath = ".github/workflows/production-migration-preflight.yml";
    const workflow = (authorizeBody, inspectBody) => [
      "name: preflight",
      "jobs:",
      "  authorize:",
      `    ${authorizeBody}`,
      "  inspect_backup_restore:",
      `    ${inspectBody}`,
      "  unrelated:",
      "    steps: []",
      "",
    ].join("\n");
    try {
      execFileSync("git", ["-c", "init.defaultBranch=main", "init", tempDir], { stdio: "ignore" });
      execFileSync("git", ["-C", tempDir, "config", "user.name", "BodyCast Test"], { stdio: "ignore" });
      execFileSync("git", ["-C", tempDir, "config", "user.email", "bodycast-test@example.invalid"], { stdio: "ignore" });
      for (const input of PREFLIGHT_CAPTURE_RESUME_CONTROL_FILES) {
        const absolutePath = path.join(tempDir, input);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, "reviewed capture control\n");
      }
      const workflowFile = path.join(tempDir, workflowPath);
      await mkdir(path.dirname(workflowFile), { recursive: true });
      await writeFile(workflowFile, workflow("inputs: safe", "steps: unchanged"));
      execFileSync("git", ["-C", tempDir, "add", "--all"], { stdio: "ignore" });
      execFileSync("git", ["-C", tempDir, "commit", "-m", "capture control base"], { stdio: "ignore" });
      const baseSha = execFileSync("git", ["-C", tempDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

      await writeFile(workflowFile, workflow("inputs: evidence collection changed", "steps: unchanged"));
      execFileSync("git", ["-C", tempDir, "add", "--all"], { stdio: "ignore" });
      execFileSync("git", ["-C", tempDir, "commit", "-m", "change authorization collection only"], { stdio: "ignore" });
      const authorizeSha = execFileSync("git", ["-C", tempDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      expect(preflightCaptureResumeControlsMatch(baseSha, authorizeSha, tempDir)).toBe(true);

      await writeFile(workflowFile, workflow("inputs: evidence collection changed", "steps: dangerous mutation added"));
      execFileSync("git", ["-C", tempDir, "add", "--all"], { stdio: "ignore" });
      execFileSync("git", ["-C", tempDir, "commit", "-m", "change production inspection job"], { stdio: "ignore" });
      const inspectChangedSha = execFileSync("git", ["-C", tempDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      expect(preflightCaptureResumeControlsMatch(authorizeSha, inspectChangedSha, tempDir)).toBe(false);

      await writeFile(path.join(tempDir, PREFLIGHT_CAPTURE_RESUME_CONTROL_FILES[0]), "changed compose topology\n");
      execFileSync("git", ["-C", tempDir, "add", "--all"], { stdio: "ignore" });
      execFileSync("git", ["-C", tempDir, "commit", "-m", "change production capture control"], { stdio: "ignore" });
      const captureChangedSha = execFileSync("git", ["-C", tempDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      expect(preflightCaptureResumeControlsMatch(inspectChangedSha, captureChangedSha, tempDir)).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function sourceRun(overrides = {}) {
  return {
    id: 38000669126,
    workflow_id: 123,
    name: `Preflight ${sourceSha} active-energy-unified-v2`,
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
    manifestId: "active-energy-unified-v2",
    deployWorkflowId,
    sourceIsAncestor: true,
    controlFilesMatch: () => true,
    ...overrides,
  });
}

const pendingMigrationIds = [
  "20261011120000_unified_publication_failure_fence",
  "20261011130000_only_completed_training_invalidates_v7",
];
const schemaBlockedDeployLog = [
  "The following migration(s) have not yet been applied:",
  ...pendingMigrationIds,
  "BLOCKED: production schema is not compatible with this application revision.",
  "Ordinary automatic deployment does not run prisma migrate deploy.",
  "Pending migration identifiers appear in the status output above.",
  "Authorize a separate production migration procedure before releasing this commit.",
  "Deploy failed before maintenance was confirmed; the previous app was not stopped or replaced.",
].join("\n");

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
  ].map(([name, conclusion]) => ({ name, conclusion }));
  const deploySteps = [
    ["Set up job", "success"],
    ["Checkout exact current main tooling", "success"],
    ["Recheck run identity and main tip before production credentials", "success"],
    ["Validate SSH inputs and pin the production host", "success"],
    ["Deploy exact SHA through the fixed production script", "failure"],
    ["Remove temporary SSH credentials", "success"],
    ["Post Checkout exact current main tooling", "success"],
    ["Complete job", "success"],
  ].map(([name, conclusion]) => ({ name, conclusion }));
  return {
    total_count: 2,
    jobs: [
      { name: "Authorize exact current-main app deploy", conclusion: "success", head_sha: targetSha, run_attempt: 1, steps: authorizeSteps },
      { name: "Deploy exact current-main SHA", conclusion: "failure", head_sha: targetSha, run_attempt: 1, steps: deploySteps },
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
    deployLogText: schemaBlockedDeployLog,
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
    ...overrides,
  };
}

function safePreflightRetryJobs(overrides = {}) {
  return {
    total_count: 2,
    jobs: [
      { name: "Authorize read-only preflight", conclusion: "failure", head_sha: targetSha, run_attempt: 1,
        steps: [
          { name: "Set up job", conclusion: "success" },
          { name: "Checkout current main tooling", conclusion: "success" },
          { name: "Validate canonical repository, exact main, and successful CI", conclusion: "failure" },
          { name: "Post Checkout current main tooling", conclusion: "success" },
          { name: "Complete job", conclusion: "success" },
        ] },
      { name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL", conclusion: "skipped",
        head_sha: targetSha, run_attempt: 1, steps: [] },
    ],
    ...overrides,
  };
}

function safePreflightRetryEvidence(overrides = {}) {
  return {
    run: safePreflightRetryRun(),
    jobs: safePreflightRetryJobs(),
    shaIsAncestorOfCurrentMain: true,
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
  const inspectSteps = captureBlockedJobSteps.map(([name, conclusion]) => ({ name, conclusion }));
  if (extraInspectStep) inspectSteps.push(extraInspectStep);
  return {
    total_count: 2,
    jobs: [
      { name: "Authorize read-only preflight", conclusion: "success", head_sha: targetSha, run_attempt: 1, steps: [] },
      { name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL", conclusion: "failure",
        head_sha: targetSha, run_attempt: 1, steps: inspectSteps },
    ],
    ...overrides,
  };
}

function captureBlockedRetryEvidence({
  refreshCapture = "0", failure = "An earlier pre-DDL release capture exists; operator review is required before another migration attempt.",
  run = captureBlockedRetryRun(), jobs = captureBlockedRetryJobs(), artifacts = { total_count: 0, artifacts: [] },
  ...overrides
} = {}) {
  return {
    run, jobs, artifacts,
    failureLogText: `REFRESH_CAPTURE: ${refreshCapture}\n${failure}\n`,
    shaIsAncestorOfCurrentMain: true,
    sourceShaIsAncestor: true,
    captureControlsMatch: true,
    ...overrides,
  };
}

function verifyWithCaptureBlockedRetries(retryEvidenceList, overrides = {}) {
  const history = retryEvidenceList.map((evidence) => evidence.run);
  return verify({
    manifestId: v4ManifestId,
    sourceRun: sourceRun({ name: `Preflight ${sourceSha} ${v4ManifestId}` }),
    laterRuns: [...history, {
      id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main",
      status: "in_progress", workflow_id: Number(preflightWorkflowId),
    }],
    safeFailedPreflightRetries: retryEvidenceList,
    preflightCaptureControlsMatch: () => true,
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
  it("runs the source-verification CLI with a verified schema-blocked deploy", async () => {
    const currentMainSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const currentRunId = "1002";
    const sourceRunId = "1000";
    const deployId = "1001";
    const actualSourceRun = sourceRun({ id: Number(sourceRunId), head_sha: currentMainSha,
      name: `Preflight ${currentMainSha} active-energy-unified-v2` });
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
      deployLogText: schemaBlockedDeployLog,
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
      };
      await Promise.all([
        writeFile(files.run, JSON.stringify(actualSourceRun)),
        writeFile(files.jobs, JSON.stringify(actualSourceJobs)),
        writeFile(files.artifacts, JSON.stringify({ total_count: 0, artifacts: [] })),
        writeFile(files.later, laterRuns.map((run) => JSON.stringify(run)).join("\n") + "\n"),
        writeFile(files.deploy, `${JSON.stringify(safeDeployEvidence)}\n`),
        writeFile(files.preflightRetries, ""),
      ]);
      const scriptPath = path.resolve("scripts/production-preflight-resume.mjs");
      const result = spawnSync(process.execPath, [scriptPath, "--verify-source", files.run, files.jobs, files.artifacts,
        files.later, files.deploy, files.preflightRetries, sourceRunId, currentRunId, currentMainSha,
        "active-energy-unified-v2", preflightWorkflowId, deployWorkflowId], {
        cwd: process.cwd(), encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        schemaVersion: 2,
        sourceRunId,
        targetSha: currentMainSha,
        safePreMaintenanceDeployRunIds: [deployId],
        safeCaptureGuardPreflightRunIds: [],
        pendingMigrationIds,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("admits only the original owner run that stopped after a successful backup and failed isolated restore", () => {
    expect(verify()).toEqual({ schemaVersion: 2, sourceRunId: "38000669126", sourceRunAttempt: 1, sourceSha, targetSha,
      safePreMaintenanceDeployRunIds: [], safeCaptureGuardPreflightRunIds: [], captureGuardPreflightEffects: [], pendingMigrationIds: [] });
  });

  it("records that owner V4 capture retries republished maintenance before DB inspection was skipped", () => {
    const priorCaptureGuard = captureBlockedRetryEvidence({
      run: captureBlockedRetryRun({ id: 38000669127 }),
    });
    const noAppRefreshGuard = captureBlockedRetryEvidence({
      run: captureBlockedRetryRun({ id: 38000669128 }),
      refreshCapture: "1",
      failure: "Capture refresh requires exactly one existing BodyCast app container.",
    });
    const result = verifyWithCaptureBlockedRetries([priorCaptureGuard, noAppRefreshGuard]);
    expect(result.safeCaptureGuardPreflightRunIds).toEqual(["38000669127", "38000669128"]);
    expect(result.captureGuardPreflightEffects).toEqual(["38000669127", "38000669128"].map((runId) => ({
      runId, sha: targetSha, failure: expect.any(String),
      maintenanceRoutePublishedAndPublic503Confirmed: true,
      oldAppStopReached: false, productionDatabaseInspectionReached: false,
      pgDumpStarted: false, artifactsPublished: false,
    })));
    expect(result.safePreMaintenanceDeployRunIds).toEqual([]);
    expect(result.pendingMigrationIds).toEqual([]);
  });

  it.each([
    ["other owner", { run: captureBlockedRetryRun({ triggering_actor: { id: 7 } }) }],
    ["rerun", { run: captureBlockedRetryRun({ run_attempt: 2 }) }],
    ["wrong manifest", { run: captureBlockedRetryRun({ name: `Preflight ${targetSha} active-energy-unified-v2` }) }],
    ["unknown capture error", { failure: "Production host connection failed." }],
    ["wrong refresh mode", { refreshCapture: "1" }],
    ["published artifact", { artifacts: { total_count: 1, artifacts: [{ id: 8 }] } }],
    ["stale retry SHA", { shaIsAncestorOfCurrentMain: false }],
    ["retry not descended from source", { sourceShaIsAncestor: false }],
    ["capture controls changed", { captureControlsMatch: false }],
    ["oversized log", { failureLogText: "x".repeat(1_000_001) }],
    ["extra step or changed DB boundary", { jobs: captureBlockedRetryJobs({ jobs: [
      ...captureBlockedRetryJobs().jobs.slice(0, 1),
      { ...captureBlockedRetryJobs().jobs[1], steps: captureBlockedRetryJobs().jobs[1].steps.map((step, index) =>
        index === 11 ? { ...step, conclusion: "success" } : step) },
    ] }) }],
  ])("rejects a later V4 capture retry with %s", (_label, evidenceOverrides) => {
    const evidence = captureBlockedRetryEvidence(evidenceOverrides);
    expect(() => verifyWithCaptureBlockedRetries([evidence])).toThrow("cannot be safely resumed");
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

  it("admits a later exact-SHA automatic deploy only when logs prove the schema block preceded maintenance", () => {
    const run = deployRun();
    const result = verify({ laterRuns: [run, {
      id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress",
    }], safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence()],
    });
    expect(result.safePreMaintenanceDeployRunIds).toEqual([safeSchemaBlockedDeployRunId]);
    expect(result.pendingMigrationIds).toEqual(pendingMigrationIds);
  });

  it("rejects a later production full-history recalculation run", () => {
    expect(() => verify({ laterRuns: [
      { id: 38000669128, path: ".github/workflows/production-full-history-recalculate.yml@refs/heads/main",
        status: "completed", conclusion: "success" },
      { id: 99999999999, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main", status: "in_progress" },
    ] })).toThrow("another release or preflight workflow exists after source run 38000669126");
  });

  it.each([
    ["missing deploy evidence", { safeFailedDeployRuns: [] }],
    ["deploy rerun", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ run_attempt: 2 }) })] }],
    ["manual deploy", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ event: "workflow_dispatch" }) })] }],
    ["wrong branch", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ head_branch: "feature/x" }) })] }],
    ["different deploy SHA", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ head_sha: sourceSha }) })] }],
    ["wrong workflow identity", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ run: deployRun({ workflow_id: 999 }) })] }],
    ["missing exact-SHA main CI", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ ciRuns: [] })] }],
    ["failed main CI", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ ciRuns: [deployCiRun({ conclusion: "failure" })] })] }],
    ["wrong CI event", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ ciRuns: [deployCiRun({ event: "pull_request" })] })] }],
    ["extra failed step", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ jobs: deployJobs({ jobs: [
      ...deployJobs().jobs,
      { name: "Unexpected job", conclusion: "failure", head_sha: targetSha, run_attempt: 1, steps: [] },
    ], total_count: 3 }) })] }],
    ["missing failure boundary log", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ deployLogText: schemaBlockedDeployLog.replace("before maintenance was confirmed", "after maintenance") })] }],
    ["pending migration IDs missing", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ deployLogText: schemaBlockedDeployLog.replace(pendingMigrationIds.join("\n"), "") })] }],
    ["contradictory schema log", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence({ deployLogText: `${schemaBlockedDeployLog}\nDatabase schema is up to date` })] }],
    ["deploy controls changed after failure", { safeFailedDeployRuns: [safeSchemaBlockedDeployEvidence()], controlFilesMatch: () => false }],
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
    });
  });

  it.each([
    ["owner identity mismatch", safePreflightRetryEvidence({ run: safePreflightRetryRun({ triggering_actor: { id: 7 } }) })],
    ["authorization rerun", safePreflightRetryEvidence({ run: safePreflightRetryRun({ run_attempt: 2 }) })],
    ["non-ancestor retry SHA", safePreflightRetryEvidence({ shaIsAncestorOfCurrentMain: false })],
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
