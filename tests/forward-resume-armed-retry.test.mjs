import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARMED_RETRY_FAILED_RUN_ID, ARMED_RETRY_FAILED_SHA, ARMED_RETRY_PURPOSE,
  createForwardResumeContext, verifyForwardResumeContext,
  verifyForwardResumeNoSpawnEvidence, verifyForwardResumeMarkerObservation,
} from "../scripts/production-forward-resume.mjs";
import { canonicalSha256 } from "../scripts/production-migration-authorization.mjs";
import { schemaInventoryDigest } from "../scripts/production-migration-preflight.mjs";
import { jobsPayload, sourceRun } from "./helpers/forward-resume-evidence-fixture.mjs";

const ATTESTED_GUARD_SHA256 = "05fc17dbf15a4e6a741e99c31bfd368e769a3828a2e09d878e04ddeebca528f0";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixtureGuardBytes = readFileSync(new URL("./fixtures/run-prisma-migrate-with-lock-timeout-b0a31fb.mjs", import.meta.url));
function historicalGuardBytes() {
  try {
    return execFileSync("git", ["show", `${ARMED_RETRY_FAILED_SHA}:scripts/run-prisma-migrate-with-lock-timeout.mjs`]);
  } catch (error) {
    if (error?.status !== 128) throw error;
    return null;
  }
}
const committedGuardBytes = historicalGuardBytes();
if (committedGuardBytes && !committedGuardBytes.equals(fixtureGuardBytes)) {
  throw new Error("The armed-retry guard fixture does not match the failed-run Git blob.");
}
const sourceGuardBytes = committedGuardBytes ?? fixtureGuardBytes;
if (sha256(sourceGuardBytes) !== ATTESTED_GUARD_SHA256 || sourceGuardBytes.length !== 16172) {
  throw new Error("The armed-retry guard bytes do not match the failed-run image attestation.");
}
const checkNames = ["signed-database-identity-digest", "canonical-postgres-identity", "exact-database-identity-match",
  "writer-drain-schema", "writer-drain-observer-pid", "fixed-observer-application", "zero-other-client-policy",
  "complete-backend-inventory", "zero-other-client-backends", "fresh-writer-drain-observation"];

function evidence(overrides = {}) {
  const run = sourceRun({ id: Number(ARMED_RETRY_FAILED_RUN_ID), head_sha: ARMED_RETRY_FAILED_SHA });
  const jobs = jobsPayload().jobs.map((job) => ({ ...job, run_id: Number(ARMED_RETRY_FAILED_RUN_ID),
    head_sha: ARMED_RETRY_FAILED_SHA,
    ...(job.name === "Final live guard and authorized migration" ? { steps: job.steps.map((step) => ({
      ...step,
      ...(step.name === "Run the fixed guarded migration script over SSH"
        ? { started_at: "2026-10-10T15:13:01Z", completed_at: "2026-10-10T15:13:42Z" } : {}),
      ...(step.name === "Remove temporary runner credentials"
        ? { started_at: "2026-10-10T15:13:42Z", completed_at: "2026-10-10T15:13:43Z" } : {}),
    })) } : {}),
  }));
  const runtime = { name: "run-prisma-migrate-with-lock-timeout.mjs", bytes: sourceGuardBytes.length,
    sha256: sha256(sourceGuardBytes) };
  const checks = checkNames.map((id) => ({ id, passed: id !== "zero-other-client-backends" }));
  const error = "Refusing Prisma DDL: final Prisma DATABASE_URL target differs from the verified production identity or writer-drain predicates failed; checks=";
  const logText = [
    "2026-10-10T15:13:01.1000000Z ##[group]Run set -Eeuo pipefail",
    `2026-10-10T15:13:08.9210000Z ${JSON.stringify({ authorizationRuntime: [runtime] })}`,
    `2026-10-10T15:13:41.4590000Z ${error}${JSON.stringify(checks)}`,
    "2026-10-10T15:13:41.6530000Z ##[error]Process completed with exit code 1.",
    "2026-10-10T15:13:42.1000000Z ##[group]Run rm -f runner-credentials",
  ].join("\n");
  return { run, jobsPayload: { total_count: 3, jobs }, logText, sourceGuardBytes,
    workflowId: "77", sourceIsAncestor: true, sourceRunId: ARMED_RETRY_FAILED_RUN_ID, ...overrides };
}

describe("exact armed forward-resume pre-spawn proof", () => {
  it("accepts the owner run only when the exact sole failed predicate precedes marker and Prisma spawn", () => {
    const proof = verifyForwardResumeNoSpawnEvidence(evidence());
    expect(proof).toMatchObject({ purpose: ARMED_RETRY_PURPOSE,
      sourceRunId: ARMED_RETRY_FAILED_RUN_ID, sourceSha: ARMED_RETRY_FAILED_SHA,
      noPrismaSpawnVerified: true, guardRuntimeSha256: sha256(sourceGuardBytes) });
  });

  it("rejects another actor, a second failed predicate, or Prisma execution output", () => {
    const valid = evidence();
    expect(() => verifyForwardResumeNoSpawnEvidence(evidence({ run: { ...valid.run,
      triggering_actor: { id: 1 } } }))).toThrow();
    const extraFailure = valid.logText.replace('"id":"exact-database-identity-match","passed":true',
      '"id":"exact-database-identity-match","passed":false');
    expect(() => verifyForwardResumeNoSpawnEvidence(evidence({ logText: extraFailure }))).toThrow();
    expect(() => verifyForwardResumeNoSpawnEvidence(evidence({ logText: valid.logText.replace(
      "2026-10-10T15:13:41.6530000Z", "2026-10-10T15:13:41.6000000Z Applying migration\n2026-10-10T15:13:41.6530000Z",
    ) }))).toThrow();
  });

  it("rejects source-byte substitution and missing in-image attestation", () => {
    const valid = evidence();
    expect(() => verifyForwardResumeNoSpawnEvidence(evidence({ sourceGuardBytes: Buffer.from("markerWriter(); spawn();") }))).toThrow();
    expect(() => verifyForwardResumeNoSpawnEvidence(evidence({ logText: valid.logText.replace(
      '"authorizationRuntime":', '"untrustedRuntime":',
    ) }))).toThrow();
  });

  it("binds the armed marker to the failed run, authorization, lineage and not-started state", () => {
    const proof = verifyForwardResumeNoSpawnEvidence(evidence());
    const bundle = { originalAuthorizationId: "0e616010-fb95-4832-9dd5-df4c386fa003",
      sourceMarkerLineageDigest: "9".repeat(64) };
    const marker = { schemaVersion: 1, markerSchemaVersion: 2, releaseSha: ARMED_RETRY_FAILED_SHA,
      state: "forward-resume-armed", markerDigest: "f".repeat(64), workflowRunId: ARMED_RETRY_FAILED_RUN_ID,
      workflowRunAttempt: 1, authorizationId: bundle.originalAuthorizationId,
      lineageDigest: bundle.sourceMarkerLineageDigest, spawnState: "not-started" };
    expect(verifyForwardResumeMarkerObservation(marker, proof, bundle)).toEqual(marker);
    for (const invalid of [
      { ...marker, authorizationId: "other-authorization-id" },
      { ...marker, lineageDigest: "0".repeat(64) },
      { ...marker, spawnState: "started" },
      { ...marker, workflowRunId: "38062632285" },
    ]) expect(() => verifyForwardResumeMarkerObservation(invalid, proof, bundle)).toThrow();
  });

  it("binds a new current-live backup and rehearsal to the exact armed marker and preflight attempt", () => {
    const failureProof = verifyForwardResumeNoSpawnEvidence(evidence());
    const authorizationBundleProof = {
      sourceRunId: ARMED_RETRY_FAILED_RUN_ID, sourceSha: ARMED_RETRY_FAILED_SHA,
      preflightRunId: "38062326943", preflightRunAttempt: 1,
      previousAppProvenance: { schemaVersion: 2, recordDigest: "a".repeat(64) },
      preflightResultDigest: "b".repeat(64), originalAuthorizationId: "0e616010-fb95-4832-9dd5-df4c386fa003",
      originalBackupArtifactId: "11673248428", originalBackupArtifactDigest: "c".repeat(64),
      sourceMarkerLineageDigest: "d".repeat(64),
    };
    const markerObservation = { schemaVersion: 1, markerSchemaVersion: 2, releaseSha: ARMED_RETRY_FAILED_SHA,
      state: "forward-resume-armed", markerDigest: "e".repeat(64), workflowRunId: ARMED_RETRY_FAILED_RUN_ID,
      workflowRunAttempt: 1, authorizationId: authorizationBundleProof.originalAuthorizationId,
      lineageDigest: authorizationBundleProof.sourceMarkerLineageDigest, spawnState: "not-started" };
    const identity = { database: "bodycast", databaseOid: 16384, clusterSystemIdentifier: "7676573064192299040",
      role: "bodycast", serverVersion: "17.11", serverAddress: "172.20.0.2", serverPort: 5432 };
    const migrations = [{ name: "20261001_baseline", checksum: "f".repeat(64), finishedAt: "2026-10-01T00:00:00.000Z" }];
    const objects = [{ name: "DailyModelState", present: true, kind: "table", signature: "baseline" }];
    const pending = ["migration-a", "migration-b", "migration-c", "migration-d", "migration-e", "migration-f"];
    const logicalDataFingerprint = "1".repeat(64);
    const preflightResult = { readyForOwnerAuthorization: true, manifestId: "active-energy-unified-v2", pending,
      pendingSetDigest: canonicalSha256(pending), identity, migrations, objects, logicalDataFingerprint };
    const report = { identity, migrations, objects, logicalDataFingerprint };
    const restoreResult = { verified: true, postflightReady: true, logicalDataFingerprint,
      postSchemaDigest: schemaInventoryDigest(objects) };
    const input = { failureProof, markerObservation, authorizationBundleProof,
      preflightRunId: "38070000000", preflightRunAttempt: 1, targetSha: ARMED_RETRY_FAILED_SHA,
      mutationHistoryDigest: "2".repeat(64), preflightResult, report, restoreResult,
      backupBytes: Buffer.from("fresh encrypted current-live backup") };
    const context = createForwardResumeContext(input);
    expect(context).toMatchObject({ purpose: ARMED_RETRY_PURPOSE, sourceRunId: ARMED_RETRY_FAILED_RUN_ID,
      markerSchemaVersion: 2, markerState: "forward-resume-armed",
      sourceMarkerLineageDigest: authorizationBundleProof.sourceMarkerLineageDigest,
      encryptedBackupDigest: sha256(input.backupBytes) });
    expect(verifyForwardResumeContext(context, { targetSha: ARMED_RETRY_FAILED_SHA,
      preflightRunId: input.preflightRunId, preflightRunAttempt: 1 })).toEqual(context);
    expect(() => verifyForwardResumeContext({ ...context, markerDigest: "0".repeat(64) }, {
      targetSha: ARMED_RETRY_FAILED_SHA, preflightRunId: input.preflightRunId, preflightRunAttempt: 1,
    })).toThrow();
    expect(() => createForwardResumeContext({ ...input, restoreResult: {
      ...restoreResult, logicalDataFingerprint: "3".repeat(64),
    } })).toThrow();
  });
});
