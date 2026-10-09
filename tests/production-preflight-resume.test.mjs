import { describe, expect, it } from "vitest";
import { capturePreviousAppProvenance, rebindPreviousAppProvenanceForPreflightResume } from "../scripts/production-previous-app-provenance.mjs";
import { verifyResumablePreflightAttempt } from "../scripts/production-preflight-resume.mjs";

const sourceSha = "a".repeat(40);
const targetSha = "b".repeat(40);

function sourceRun(overrides = {}) {
  return {
    id: 38000669126,
    workflow_id: 123,
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
    sourceIsAncestor: true,
    ...overrides,
  });
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

describe("verified resume of a failed production preflight", () => {
  it("admits only the original owner run that stopped after a successful backup and failed isolated restore", () => {
    expect(verify()).toEqual({ schemaVersion: 1, sourceRunId: "38000669126", sourceRunAttempt: 1, sourceSha, targetSha });
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
