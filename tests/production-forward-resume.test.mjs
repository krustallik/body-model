import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalSha256 } from "../scripts/production-migration-authorization.mjs";
import { schemaInventoryDigest } from "../scripts/production-migration-preflight.mjs";
import {
  FORWARD_RESUME_FAILED_RUN_ID,
  FORWARD_RESUME_FAILED_SHA,
  FORWARD_RESUME_PURPOSE,
  FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_RUN_ID,
  FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_SHA,
  MIGRATION_FAILURE_JOB,
  MIGRATION_FAILURE_STEP,
  MIGRATION_GUARD_FAILURE,
  createForwardResumeContext,
  selectForwardResumeMigrationContextArtifact,
  verifyForwardResumeContext,
  verifyForwardResumeMarkerObservation,
  verifyForwardResumeNoSpawnEvidence,
  verifyNoLaterMutationRun,
} from "../scripts/production-forward-resume.mjs";

const digest = (text) => createHash("sha256").update(text).digest("hex");
const sourceBytes = Buffer.from(`
assertPrismaTargetMatchesSignedIdentity(finalGuard.receipt, actualIdentity, now());
if (writerDrain.activeClientBackends.length > 0) throw new Error("final Prisma writer-drain observation is missing, stale, or has active/unknown client backends.");
return spawn("npx", ["prisma", "migrate", "deploy"]);
`);
const steps = [
  ["Checkout exact authorized release SHA", "success"],
  ["Set up Node runtime", "success"],
  ["Recheck current canonical main before production SSH", "success"],
  ["Download only the signed context artifact", "success"],
  ["Validate protected production SSH and pin host key", "success"],
  ["Trust only the SSH key matching the pinned fingerprint", "success"],
  ["Stream signed evidence files to private remote temporary context", "success"],
  [MIGRATION_FAILURE_STEP, "failure"],
  ["Remove temporary runner credentials", "success"],
  ["Post Set up Node runtime", "skipped"],
  ["Post Checkout exact authorized release SHA", "success"],
].map(([name, conclusion]) => ({ name, conclusion }));

function sourceRun(overrides = {}) {
  return {
    id: Number(FORWARD_RESUME_FAILED_RUN_ID),
    workflow_id: 77,
    path: ".github/workflows/production-migrate.yml@refs/heads/main",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: FORWARD_RESUME_FAILED_SHA,
    run_attempt: 1,
    status: "completed",
    conclusion: "failure",
    repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
    actor: { id: 126446430 },
    triggering_actor: { id: 126446430 },
    ...overrides,
  };
}

function jobsPayload(overrides = {}) {
  return {
    total_count: 3,
    jobs: [
      { id: 1, name: "Select latest exact preflight evidence", conclusion: "success", head_sha: FORWARD_RESUME_FAILED_SHA, run_attempt: 1 },
      { id: 2, name: "Sign migration authorization envelope", conclusion: "success", head_sha: FORWARD_RESUME_FAILED_SHA, run_attempt: 1 },
      { id: 3, name: MIGRATION_FAILURE_JOB, conclusion: "failure", head_sha: FORWARD_RESUME_FAILED_SHA, run_attempt: 1, steps },
    ],
    ...overrides,
  };
}

function noSpawnProofInputs(overrides = {}) {
  const runtime = { name: "run-prisma-migrate-with-lock-timeout.mjs", bytes: sourceBytes.length, sha256: digest(sourceBytes) };
  const logText = [
    `${MIGRATION_FAILURE_JOB}\t${MIGRATION_FAILURE_STEP}\t2026-10-09T12:00:00Z\t${MIGRATION_GUARD_FAILURE}`,
    `${MIGRATION_FAILURE_JOB}\t${MIGRATION_FAILURE_STEP}\t2026-10-09T12:00:00Z\t${JSON.stringify({ authorizationRuntime: [runtime] })}`,
  ].join("\n");
  return {
    run: sourceRun(), jobsPayload: jobsPayload(), logText, sourceGuardBytes: sourceBytes,
    workflowId: "77", sourceIsAncestor: true, ...overrides,
  };
}

function safeFailedPreflightRetryEvidence(overrides = {}) {
  const run = {
    id: Number(FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_RUN_ID),
    workflow_id: 372102614,
    path: ".github/workflows/production-migration-preflight.yml@refs/heads/main",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_SHA,
    run_attempt: 1,
    status: "completed",
    conclusion: "failure",
    repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
    actor: { id: 126446430 },
    triggering_actor: { id: 126446430 },
    ...overrides.run,
  };
  const jobsPayload = {
    total_count: 2,
    jobs: [
      { id: 114194642210, name: "Authorize read-only preflight", status: "completed", conclusion: "failure",
        head_sha: FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_SHA, run_attempt: 1,
        steps: [
          { name: "Set up job", conclusion: "success" },
          { name: "Checkout current main tooling", conclusion: "success" },
          { name: "Validate canonical repository, exact main, and successful CI", conclusion: "failure" },
          { name: "Post Checkout current main tooling", conclusion: "success" },
          { name: "Complete job", conclusion: "success" },
        ] },
      { id: 114194697634, name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL",
        status: "completed", conclusion: "skipped", head_sha: FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_SHA,
        run_attempt: 1, steps: [] },
    ],
    ...overrides.jobsPayload,
  };
  const historyRun = {
    id: run.id, workflow_id: run.workflow_id, path: run.path, event: run.event, head_branch: run.head_branch,
    head_sha: run.head_sha, run_attempt: run.run_attempt, status: run.status, conclusion: run.conclusion,
    ...overrides.historyRun,
  };
  return {
    run, jobsPayload, historyRun, workflowId: String(run.workflow_id),
    currentMainSha: "a5578255f72d8d724d5c20be0a7ac278912a70e7",
    shaIsAncestorOfCurrentMain: true,
    ...overrides.evidence,
  };
}

describe("forward-resume evidence for the single verified pre-spawn failure", () => {
  it("accepts the exact source artifact when GitHub omits workflow_run.run_attempt", () => {
    const artifact = {
      id: 11658904368,
      name: `bodycast-migration-auth-${FORWARD_RESUME_FAILED_RUN_ID}-1`,
      size_in_bytes: 12261,
      expired: false,
      digest: `sha256:${"a".repeat(64)}`,
      workflow_run: { id: Number(FORWARD_RESUME_FAILED_RUN_ID), head_branch: "main", head_sha: FORWARD_RESUME_FAILED_SHA },
    };
    expect(selectForwardResumeMigrationContextArtifact({ artifacts: [artifact] })).toEqual({
      id: "11658904368",
      name: `bodycast-migration-auth-${FORWARD_RESUME_FAILED_RUN_ID}-1`,
      digest: `sha256:${"a".repeat(64)}`,
      workflowRunId: FORWARD_RESUME_FAILED_RUN_ID,
      workflowRunAttempt: 1,
      headSha: FORWARD_RESUME_FAILED_SHA,
    });
  });

  it.each([
    ["wrong source run", { workflow_run: { id: 38022978033 } }],
    ["wrong source SHA", { workflow_run: { head_sha: "a".repeat(40) } }],
    ["wrong branch", { workflow_run: { head_branch: "feature/untrusted" } }],
    ["wrong reported attempt", { workflow_run: { run_attempt: 2 } }],
    ["malformed boolean reported attempt", { workflow_run: { run_attempt: true } }],
    ["expired artifact", { expired: true }],
    ["missing digest", { digest: undefined }],
    ["empty artifact", { size_in_bytes: 0 }],
  ])("rejects source artifact metadata with %s", (_label, override) => {
    const artifact = {
      id: 11658904368,
      name: `bodycast-migration-auth-${FORWARD_RESUME_FAILED_RUN_ID}-1`,
      size_in_bytes: 12261,
      expired: false,
      digest: `sha256:${"a".repeat(64)}`,
      workflow_run: { id: Number(FORWARD_RESUME_FAILED_RUN_ID), head_branch: "main", head_sha: FORWARD_RESUME_FAILED_SHA },
      ...override,
      ...(override.workflow_run ? { workflow_run: {
        id: Number(FORWARD_RESUME_FAILED_RUN_ID), head_branch: "main", head_sha: FORWARD_RESUME_FAILED_SHA, ...override.workflow_run,
      } } : {}),
    };
    expect(() => selectForwardResumeMigrationContextArtifact({ artifacts: [artifact] })).toThrow("Forward-resume blocked");
  });

  it("rejects duplicate exact-name artifacts instead of choosing one", () => {
    const artifact = {
      id: 11658904368,
      name: `bodycast-migration-auth-${FORWARD_RESUME_FAILED_RUN_ID}-1`,
      size_in_bytes: 12261,
      expired: false,
      digest: `sha256:${"a".repeat(64)}`,
      workflow_run: { id: Number(FORWARD_RESUME_FAILED_RUN_ID), head_branch: "main", head_sha: FORWARD_RESUME_FAILED_SHA },
    };
    expect(() => selectForwardResumeMigrationContextArtifact({ artifacts: [artifact, { ...artifact, id: 11658904369 }] }))
      .toThrow("Forward-resume blocked");
  });

  it("accepts only the exact owner migration run with the failed final writer-drain guard before Prisma spawn", () => {
    const proof = verifyForwardResumeNoSpawnEvidence(noSpawnProofInputs());
    expect(proof).toMatchObject({
      purpose: FORWARD_RESUME_PURPOSE,
      sourceRunId: FORWARD_RESUME_FAILED_RUN_ID,
      sourceSha: FORWARD_RESUME_FAILED_SHA,
      noPrismaSpawnVerified: true,
      failureCode: "final-prisma-writer-drain-rejected-before-spawn",
    });
  });

  it.each([
    ["wrong actor", { run: sourceRun({ actor: { id: 42 }, triggering_actor: { id: 42 } }) }],
    ["rerun", { run: sourceRun({ run_attempt: 2 }) }],
    ["wrong SHA", { run: sourceRun({ head_sha: "a".repeat(40) }) }],
    ["untrusted source ancestry", { sourceIsAncestor: false }],
    ["forged runtime bytes", { sourceGuardBytes: Buffer.from("different") }],
    ["missing Prisma guard jobs", { jobsPayload: { total_count: 2, jobs: [] } }],
    ["migration output after the guard failure", { logText: noSpawnProofInputs().logText + `\n${MIGRATION_FAILURE_JOB}\t${MIGRATION_FAILURE_STEP}\t2026-10-09T12:00:01Z\tApplying migration 20261002100000_active_energy_canonical_resolution` }],
  ])("fails closed for %s", (_label, overrides) => {
    expect(() => verifyForwardResumeNoSpawnEvidence(noSpawnProofInputs(overrides))).toThrow("Forward-resume blocked");
  });

  it("rejects marker absence, a changed SHA, partial-DDL/V2 state, and marker digest substitution", () => {
    const validProof = { sourceSha: FORWARD_RESUME_FAILED_SHA };
    const valid = { schemaVersion: 1, markerSchemaVersion: 1, releaseSha: FORWARD_RESUME_FAILED_SHA,
      state: "ddl-started", markerDigest: "a".repeat(64) };
    expect(verifyForwardResumeMarkerObservation(valid, validProof)).toEqual(valid);
    for (const invalid of [
      null,
      { ...valid, releaseSha: "b".repeat(40) },
      { ...valid, markerSchemaVersion: 2 },
      { ...valid, state: "ddl-starting" },
      { ...valid, markerDigest: "forged" },
      { ...valid, extra: "partial-ddl" },
    ]) expect(() => verifyForwardResumeMarkerObservation(invalid, validProof)).toThrow("Forward-resume blocked");
  });

  it("binds the new preflight to the source auth, no-spawn proof, exact marker lineage, and fresh target SHA", () => {
    const failureProof = verifyForwardResumeNoSpawnEvidence(noSpawnProofInputs());
    const markerObservation = { schemaVersion: 1, markerSchemaVersion: 1, releaseSha: FORWARD_RESUME_FAILED_SHA,
      state: "ddl-started", markerDigest: "a".repeat(64) };
    const bundle = {
      sourceRunId: FORWARD_RESUME_FAILED_RUN_ID, sourceSha: FORWARD_RESUME_FAILED_SHA,
      preflightRunId: "38022000000", preflightRunAttempt: 1,
      previousAppProvenance: { schemaVersion: 2, recordDigest: "b".repeat(64) },
      preflightResultDigest: "c".repeat(64), originalAuthorizationId: "original-authorization-identifier",
      originalBackupArtifactId: "38022000001", originalBackupArtifactDigest: "d".repeat(64),
    };
    const identity = { database: "bodycast", databaseOid: 16384, clusterSystemIdentifier: "7419276301947620311",
      role: "bodycast", serverVersion: "17.5", serverAddress: "172.20.0.2", serverPort: 5432 };
    const migrations = [{ name: "20261001_baseline", checksum: "b".repeat(64), finishedAt: "2026-10-01T00:00:00.000Z" }];
    const objects = [{ name: "DailyModelState", present: true, kind: "table", signature: "baseline" }];
    const fingerprint = "9".repeat(64);
    const pending = ["migration-a", "migration-b", "migration-c", "migration-d", "migration-e", "migration-f"];
    const preflightResult = { readyForOwnerAuthorization: true, manifestId: "active-energy-unified-v2", pending,
      pendingSetDigest: canonicalSha256(pending), identity, migrations, objects, logicalDataFingerprint: fingerprint };
    const report = { identity, migrations, objects, logicalDataFingerprint: fingerprint };
    const restoreResult = { verified: true, postflightReady: true, logicalDataFingerprint: fingerprint,
      postSchemaDigest: schemaInventoryDigest(objects) };
    const context = createForwardResumeContext({ failureProof, markerObservation, authorizationBundleProof: bundle,
      preflightRunId: "39000000001", preflightRunAttempt: 1, targetSha: "e".repeat(40), mutationHistoryDigest: "f".repeat(64),
      preflightResult, report, restoreResult, backupBytes: Buffer.from("new encrypted backup bytes") });
    expect(context).toMatchObject({ mode: "forward-resume", targetSha: "e".repeat(40), markerDigest: "a".repeat(64), noPrismaSpawnVerified: true });
    expect(verifyForwardResumeContext(context, { targetSha: "e".repeat(40), preflightRunId: "39000000001", preflightRunAttempt: 1 })).toEqual(context);
    expect(() => verifyForwardResumeContext({ ...context, markerDigest: "0".repeat(64) }, {
      targetSha: "e".repeat(40), preflightRunId: "39000000001", preflightRunAttempt: 1,
    })).toThrow("Forward-resume blocked");
    expect(() => verifyForwardResumeContext(context, { targetSha: "1".repeat(40), preflightRunId: "39000000001", preflightRunAttempt: 1 }))
      .toThrow("Forward-resume blocked");
    expect(() => createForwardResumeContext({ failureProof, markerObservation, authorizationBundleProof: bundle,
      preflightRunId: "39000000001", preflightRunAttempt: 1, targetSha: "e".repeat(40), mutationHistoryDigest: "f".repeat(64),
      preflightResult, report, restoreResult: { ...restoreResult, logicalDataFingerprint: "8".repeat(64) },
      backupBytes: Buffer.from("new encrypted backup bytes") })).toThrow("Forward-resume blocked");
  });

  it("requires complete mutation history and rejects concurrent or intervening production work", () => {
    const baseRun = sourceRun();
    const currentRun = { id: 39000000001, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main" };
    const history = [baseRun, currentRun];
    expect(verifyNoLaterMutationRun({ runs: history, currentRunId: "39000000001" })).toMatch(/^[a-f0-9]{64}$/);
    expect(() => verifyNoLaterMutationRun({ runs: [...history, {
      id: 38022978033, path: ".github/workflows/production-migrate.yml@refs/heads/main",
      head_sha: FORWARD_RESUME_FAILED_SHA, status: "in_progress", run_attempt: 1,
    }], currentRunId: "39000000001" })).toThrow("another production mutation/preflight run exists");
    expect(() => verifyNoLaterMutationRun({ runs: [currentRun], currentRunId: "39000000001" }))
      .toThrow("history is incomplete");
  });

  it("permits only the verified failed authorization-only preflight retry in later workflow history", () => {
    const safeRetry = safeFailedPreflightRetryEvidence();
    const currentRun = { id: 39000000001, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main" };
    const digest = verifyNoLaterMutationRun({
      runs: [sourceRun(), safeRetry.historyRun, currentRun],
      currentRunId: String(currentRun.id),
      safeFailedPreflightRetries: [safeRetry],
    });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["wrong actor", { run: { actor: { id: 42 } } }],
    ["rerun attempt", { run: { run_attempt: 2 } }],
    ["wrong source SHA", { run: { head_sha: "a".repeat(40) } }],
    ["not on current main ancestry", { evidence: { shaIsAncestorOfCurrentMain: false } }],
    ["started production job", { jobsPayload: { jobs: [
      { id: 114194642210, name: "Authorize read-only preflight", status: "completed", conclusion: "failure",
        head_sha: FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_SHA, run_attempt: 1,
        steps: [
          { name: "Set up job", conclusion: "success" },
          { name: "Checkout current main tooling", conclusion: "success" },
          { name: "Validate canonical repository, exact main, and successful CI", conclusion: "failure" },
          { name: "Post Checkout current main tooling", conclusion: "success" },
          { name: "Complete job", conclusion: "success" },
        ] },
      { id: 114194697634, name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL",
        status: "completed", conclusion: "failure", head_sha: FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_SHA,
        run_attempt: 1, steps: [{ name: "SSH", conclusion: "success" }] },
    ] } }],
  ])("rejects unsafe or malformed authorization-only retry evidence: %s", (_label, overrides) => {
    const safeRetry = safeFailedPreflightRetryEvidence(overrides);
    const currentRun = { id: 39000000001, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main" };
    expect(() => verifyNoLaterMutationRun({
      runs: [sourceRun(), safeRetry.historyRun, currentRun], currentRunId: String(currentRun.id),
      safeFailedPreflightRetries: [safeRetry],
    })).toThrow("Forward-resume blocked");
  });

  it("still rejects any other later production workflow despite safe retry evidence", () => {
    const safeRetry = safeFailedPreflightRetryEvidence();
    const currentRun = { id: 39000000001, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main" };
    expect(() => verifyNoLaterMutationRun({
      runs: [sourceRun(), safeRetry.historyRun, {
        id: 38045689914, path: ".github/workflows/production-migrate.yml@refs/heads/main",
        head_sha: FORWARD_RESUME_FAILED_SHA, status: "completed", conclusion: "success", run_attempt: 1,
      }, currentRun],
      currentRunId: String(currentRun.id), safeFailedPreflightRetries: [safeRetry],
    })).toThrow("another production mutation/preflight run exists");
  });
});
