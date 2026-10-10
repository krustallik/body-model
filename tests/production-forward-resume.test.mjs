import { describe, expect, it } from "vitest";
import { canonicalSha256 } from "../scripts/production-migration-authorization.mjs";
import { schemaInventoryDigest } from "../scripts/production-migration-preflight.mjs";
import {
  FORWARD_RESUME_FAILED_RUN_ID,
  FORWARD_RESUME_FAILED_SHA,
  FORWARD_RESUME_PURPOSE,
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

import { FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_RUN_ID, FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_SHA,
  sourceRun, noSpawnProofInputs,
  safeFailedPreflightRetryEvidence } from "./helpers/forward-resume-evidence-fixture.mjs";

function verifyHistory(options) {
  const currentMainSha = options.safeFailedPreflightRetries?.[0]?.currentMainSha ?? "a".repeat(40);
  const runs = options.runs.map((run) => String(run.id) === options.currentRunId ? sourceRun({ ...run,
    workflow_id: 372102614, head_sha: currentMainSha, status: "in_progress", conclusion: null }) : run);
  return verifyNoLaterMutationRun({ ...options, runs, currentMainSha,
    inventory: { complete: true, scope: "repository-since-source", totalCount: runs.length, observedCount: runs.length } });
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

  it("parses timestamped GitHub job logs, binds the exact failed-step window, and accepts only the pre-spawn writer-drain failure", () => {
    const proof = verifyForwardResumeNoSpawnEvidence(noSpawnProofInputs());
    expect(proof).toMatchObject({
      purpose: FORWARD_RESUME_PURPOSE,
      sourceRunId: FORWARD_RESUME_FAILED_RUN_ID,
      sourceSha: FORWARD_RESUME_FAILED_SHA,
      noPrismaSpawnVerified: true,
      failureCode: "final-prisma-writer-drain-rejected-before-spawn",
    });
  });

  it.each([["space", " "], ["tab", "\t"]])("preserves extra leading message %s after the timestamp separator", (_label, prefix) => {
    const evidence = noSpawnProofInputs();
    evidence.logText = evidence.logText.replace(MIGRATION_GUARD_FAILURE, `${prefix}${MIGRATION_GUARD_FAILURE}`);
    expect(() => verifyForwardResumeNoSpawnEvidence(evidence)).toThrow("failed-step logs do not contain one exact final writer-drain failure");
  });

  it("rejects the exact guard text when it appears outside the failed migration step", () => {
    const evidence = noSpawnProofInputs();
    evidence.logText = evidence.logText.replace(`${MIGRATION_GUARD_FAILURE}\n`, "")
      + `\n2026-10-09T12:00:01.2000000Z ${MIGRATION_GUARD_FAILURE}`;
    expect(() => verifyForwardResumeNoSpawnEvidence(evidence))
      .toThrow("failed-step logs do not contain one exact final writer-drain failure");
  });

  it("rejects missing or ambiguous raw-log step boundaries", () => {
    const missingStart = noSpawnProofInputs();
    missingStart.jobsPayload.jobs[2].steps[8].started_at = undefined;
    expect(() => verifyForwardResumeNoSpawnEvidence(missingStart))
      .toThrow("failed migration step lacks a valid ordered GitHub timestamp boundary");

    const ambiguous = noSpawnProofInputs();
    ambiguous.logText = ambiguous.logText.replace("2026-10-09T12:00:00.9000000Z", "2026-10-09T12:00:00.5000000Z ##[group]Run second command\n2026-10-09T12:00:00.9000000Z");
    expect(() => verifyForwardResumeNoSpawnEvidence(ambiguous))
      .toThrow("raw GitHub job logs do not identify one unambiguous failed-step boundary");
  });

  it("requires the observed GitHub job setup and completion steps in the exact source sequence", () => {
    const evidence = noSpawnProofInputs();
    evidence.jobsPayload.jobs[2].steps = evidence.jobsPayload.jobs[2].steps.slice(1, -1);
    expect(() => verifyForwardResumeNoSpawnEvidence(evidence))
      .toThrow("the exact migration job step sequence differs from the observed pre-spawn guard failure");
  });

  it("rejects a reordered source execution step even when every step is present", () => {
    const evidence = noSpawnProofInputs();
    const steps = [...evidence.jobsPayload.jobs[2].steps];
    evidence.jobsPayload.jobs[2].steps = steps;
    [steps[1], steps[2]] = [steps[2], steps[1]];
    expect(() => verifyForwardResumeNoSpawnEvidence(evidence))
      .toThrow("the exact migration job step sequence differs from the observed pre-spawn guard failure");
  });

  it("rejects a duplicate source execution step substituted for a missing step", () => {
    const evidence = noSpawnProofInputs();
    const steps = [...evidence.jobsPayload.jobs[2].steps];
    evidence.jobsPayload.jobs[2].steps = steps;
    steps[2] = { ...steps[1] };
    expect(() => verifyForwardResumeNoSpawnEvidence(evidence))
      .toThrow("the exact migration job step sequence differs from the observed pre-spawn guard failure");
  });

  it.each([
    ["wrong actor", { run: sourceRun({ actor: { id: 42 }, triggering_actor: { id: 42 } }) }],
    ["rerun", { run: sourceRun({ run_attempt: 2 }) }],
    ["wrong SHA", { run: sourceRun({ head_sha: "a".repeat(40) }) }],
    ["untrusted source ancestry", { sourceIsAncestor: false }],
    ["forged runtime bytes", { sourceGuardBytes: Buffer.from("different") }],
    ["missing Prisma guard jobs", { jobsPayload: { total_count: 2, jobs: [] } }],
    ["migration output after the guard failure", { logText: noSpawnProofInputs().logText + "\n2026-10-09T12:00:00.9800000Z Applying migration 20261002100000_active_energy_canonical_resolution" }],
    ["migration output after the failed step", { logText: noSpawnProofInputs().logText + "\n2026-10-09T12:00:01.2000000Z Applying migration 20261002100000_active_energy_canonical_resolution" }],
    ["legacy CLI-formatted logs without raw step boundaries", { logText: `${MIGRATION_FAILURE_JOB}\t${MIGRATION_FAILURE_STEP}\t2026-10-09T12:00:00.9000000Z ${MIGRATION_GUARD_FAILURE}` }],
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
    expect(verifyHistory({ runs: history, currentRunId: "39000000001" })).toMatch(/^[a-f0-9]{64}$/);
    expect(() => verifyHistory({ runs: [...history, {
      id: 38022978033, path: ".github/workflows/production-migrate.yml@refs/heads/main",
      head_sha: FORWARD_RESUME_FAILED_SHA, status: "in_progress", run_attempt: 1,
    }], currentRunId: "39000000001" })).toThrow("another production mutation/preflight run exists");
    expect(() => verifyHistory({ runs: [currentRun], currentRunId: "39000000001" }))
      .toThrow("history is incomplete");
  });

  it("permits only the verified failed authorization-only preflight retry in later workflow history", () => {
    const safeRetry = safeFailedPreflightRetryEvidence();
    const currentRun = { id: 39000000001, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main" };
    const digest = verifyHistory({
      runs: [sourceRun(), safeRetry.historyRun, currentRun],
      currentRunId: String(currentRun.id),
      safeFailedPreflightRetries: [safeRetry],
    });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts both exact observed authorization-only preflight failures and binds both proofs", () => {
    const firstRetry = safeFailedPreflightRetryEvidence({}, {
      runId: FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_RUN_ID,
      sha: FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_SHA,
      currentMainSha: "ab80cbe54ebf67509db6e00801d686e52da02249",
    });
    const secondRetry = safeFailedPreflightRetryEvidence({}, {
      runId: "38048789731",
      sha: "ab80cbe54ebf67509db6e00801d686e52da02249",
      currentMainSha: "ab80cbe54ebf67509db6e00801d686e52da02249",
    });
    const currentRun = { id: 39000000001, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main" };
    const digest = verifyHistory({
      runs: [sourceRun(), firstRetry.historyRun, secondRetry.historyRun, currentRun],
      currentRunId: String(currentRun.id),
      safeFailedPreflightRetries: [firstRetry, secondRetry],
    });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => verifyHistory({
      runs: [sourceRun(), firstRetry.historyRun, secondRetry.historyRun, currentRun],
      currentRunId: String(currentRun.id),
      safeFailedPreflightRetries: [firstRetry],
    })).toThrow("another production mutation/preflight run exists");
  });

  it("accepts the exact later authorization-only retry on 86cad77 and rejects an incomplete retry inventory", () => {
    const retries = [
      safeFailedPreflightRetryEvidence({}, {
        runId: FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_RUN_ID,
        sha: FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_SHA,
        currentMainSha: "b5391b78bf3621d49149e8fcb16d61e6a2eadfaf",
      }),
      safeFailedPreflightRetryEvidence({}, {
        runId: "38048789731",
        sha: "ab80cbe54ebf67509db6e00801d686e52da02249",
        currentMainSha: "b5391b78bf3621d49149e8fcb16d61e6a2eadfaf",
      }),
      safeFailedPreflightRetryEvidence({}, {
        runId: "38050603789",
        sha: "86cad77e612af4212c1083d310e054a8130b2e87",
        currentMainSha: "b5391b78bf3621d49149e8fcb16d61e6a2eadfaf",
      }),
    ];
    const currentRun = { id: 39000000001, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main" };
    const runs = [sourceRun(), ...retries.map((retry) => retry.historyRun), currentRun];
    expect(verifyHistory({
      runs, currentRunId: String(currentRun.id), safeFailedPreflightRetries: retries,
    })).toMatch(/^[a-f0-9]{64}$/);
    expect(() => verifyHistory({
      runs, currentRunId: String(currentRun.id), safeFailedPreflightRetries: retries.slice(0, 2),
    })).toThrow("another production mutation/preflight run exists");
  });

  it.each([
    ["wrong actor", { run: { actor: { id: 42 } } }],
    ["rerun attempt", { run: { run_attempt: 2 } }],
    ["wrong source SHA", { historyRun: { head_sha: "a".repeat(40) } }],
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
    expect(() => verifyHistory({
      runs: [sourceRun(), safeRetry.historyRun, currentRun], currentRunId: String(currentRun.id),
      safeFailedPreflightRetries: [safeRetry],
    })).toThrow("Forward-resume blocked");
  });

  it("still rejects any other later production workflow despite safe retry evidence", () => {
    const safeRetry = safeFailedPreflightRetryEvidence();
    const currentRun = { id: 39000000001, path: ".github/workflows/production-migration-preflight.yml@refs/heads/main" };
    expect(() => verifyHistory({
      runs: [sourceRun(), safeRetry.historyRun, {
        id: 38045689914, path: ".github/workflows/production-migrate.yml@refs/heads/main",
        head_sha: FORWARD_RESUME_FAILED_SHA, status: "completed", conclusion: "success", run_attempt: 1,
      }, currentRun],
      currentRunId: String(currentRun.id), safeFailedPreflightRetries: [safeRetry],
    })).toThrow("another production mutation/preflight run exists");
  });
});
