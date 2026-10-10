import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createGitHubEvidenceClient, collectForwardResumeEvidence } from "../scripts/github-forward-resume-evidence.mjs";
import { createCaptureResumeReceipt, validateCaptureResumeReceipt } from "../scripts/production-capture-resume-receipt.mjs";
import { canonicalSha256, createAuthorizationEnvelope } from "../scripts/production-migration-authorization.mjs";
import { DIAGNOSTIC_FILES, DIAGNOSTIC_PATH, createForwardResumeContext, verifyForwardResumeAuthorizationBundle, verifyForwardResumeContext,
  verifyForwardResumeNoSpawnEvidence, verifyNoLaterMutationRun, FORWARD_RESUME_FAILED_SHA } from "../scripts/production-forward-resume.mjs";
import { schemaInventoryDigest } from "../scripts/production-migration-preflight.mjs";
import { capturePreviousAppProvenance, previousAppProvenanceBinding,
  rebindPreviousAppProvenanceForPreflightResume } from "../scripts/production-previous-app-provenance.mjs";
import { sourceRun, noSpawnProofInputs, safeFailedPreflightRetryEvidence } from "./helpers/forward-resume-evidence-fixture.mjs";

const prefix = "/repos/krustallik/body-model/actions";
const mainSha = "e".repeat(40);
const currentId = "39000000001";
const owner = 126446430;
const jsonResponse = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
function apiFixture({ mutateRuns = (runs) => runs, mutateRetry = () => {}, mutateLog = (log) => log,
  includeDiagnostic = false, mutateDiagnostic = () => {}, mutateFile = (bytes) => bytes,
  ancestor = true, downloadStatus = 200, redirect = "https://fixture.blob.core.windows.net/log?private=opaque" } = {}) {
  const original = noSpawnProofInputs();
  const source = sourceRun({ created_at: "2026-10-09T12:00:00Z" });
  // A future auth-only failure is accepted without adding its ID or SHA to application code.
  const retry = safeFailedPreflightRetryEvidence({}, { runId: "38999999999", sha: "d".repeat(40), currentMainSha: mainSha });
  mutateRetry(retry);
  const current = sourceRun({ id: Number(currentId), workflow_id: retry.run.workflow_id,
    path: retry.run.path, head_sha: mainSha, status: "in_progress", conclusion: null });
  const diagnostic = { run: sourceRun({ id: 38800000000, path: DIAGNOSTIC_PATH, workflow_id: 88,
    head_sha: "c".repeat(40), conclusion: "success" }), jobs: { total_count: 2, jobs: [
      { id: 81, run_id: 38800000000, name: "Authorize owner-requested exact-main diagnostic", status: "completed", conclusion: "success", head_sha: "c".repeat(40), run_attempt: 1,
        steps: ["Set up job", "Checkout current main gate helpers", "Verify owner, exact current-main SHA, confirmation, and green CI",
          "Post Checkout current main gate helpers", "Complete job"].map((name) => ({ name, status: "completed", conclusion: "success" })) },
      { id: 82, run_id: 38800000000, name: "Inspect production checkout without mutation", status: "completed", conclusion: "success", head_sha: "c".repeat(40), run_attempt: 1,
        steps: ["Set up job", "Checkout exact current-main diagnostic script", "Recheck owner run identity and current main before production credentials",
          "Validate SSH inputs and pin the production host", "Inspect checkout metadata read-only", "Remove temporary SSH credentials",
          "Post Checkout exact current-main diagnostic script", "Complete job"].map((name) => ({ name, status: "completed", conclusion: "success" })) },
    ] } };
  mutateDiagnostic(diagnostic);
  const nonProduction = Array.from({ length: 101 }, (_, i) => ({ id: 38100000000 + i,
    path: ".github/workflows/ci.yml", status: "completed", conclusion: "success" }));
  const runs = mutateRuns([source, retry.historyRun, current, ...(includeDiagnostic ? [diagnostic.run] : []), ...nonProduction]);
  const artifactPayload = { total_count: 1, artifacts: [{ id: 123, name: `bodycast-migration-auth-${source.id}-1`,
    expired: false, size_in_bytes: 500, digest: `sha256:${"a".repeat(64)}`,
    workflow_run: { id: source.id, head_branch: "main", head_sha: source.head_sha } }] };
  const requests = [];
  const fetchImpl = async (text, options) => {
    const url = new URL(text);
    requests.push({ url, options });
    expect(options.redirect).toBe("manual");
    if (url.host !== "api.github.com") {
      expect(options.headers.Authorization).toBeUndefined();
      expect(options.headers.Cookie).toBeUndefined();
      return new Response(mutateLog(original.logText), { status: downloadStatus, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    expect(options.headers.Authorization).toBe("Bearer test-only-credential");
    const endpoint = url.pathname;
    if (endpoint === `${prefix}/runs` && url.searchParams.has("created")) {
      const page = Number(url.searchParams.get("page"));
      return jsonResponse({ total_count: runs.length, workflow_runs: runs.slice((page - 1) * 100, page * 100) });
    }
    if (endpoint === `${prefix}/runs/${source.id}`) return jsonResponse(source);
    if (endpoint === `${prefix}/runs/${retry.run.id}`) return jsonResponse(retry.run);
    if (endpoint === `${prefix}/runs/${diagnostic.run.id}`) return jsonResponse(diagnostic.run);
    if (endpoint === `${prefix}/runs/${diagnostic.run.id}/attempts/1/jobs`) return jsonResponse(diagnostic.jobs);
    if (endpoint === `${prefix}/runs/${source.id}/attempts/1/jobs`) return jsonResponse(original.jobsPayload);
    if (endpoint === `${prefix}/runs/${retry.run.id}/attempts/1/jobs`) return jsonResponse(retry.jobsPayload);
    if (endpoint === `${prefix}/runs/${source.id}/artifacts`) return jsonResponse(artifactPayload);
    if (endpoint === `${prefix}/workflows/production-migrate.yml`) return jsonResponse({ id: 77 });
    if (endpoint === `${prefix}/workflows/production-migration-preflight.yml`) return jsonResponse({ id: retry.run.workflow_id });
    if (endpoint === `${prefix}/workflows/production-checkout-diagnostic.yml`) return jsonResponse({ id: 88 });
    if (endpoint === `${prefix}/jobs/3/logs`) return new Response(null, { status: 302, headers: { location: redirect } });
    throw new Error("Unexpected fixture API endpoint");
  };
  return { client: createGitHubEvidenceClient({ token: "test-only-credential", fetchImpl }), requests, source, retry, current,
    collect: () => collectForwardResumeEvidence({ client: createGitHubEvidenceClient({ token: "test-only-credential", fetchImpl }),
      currentRunId: currentId, currentMainSha: mainSha, isAncestor: (sha) => ancestor && /^[a-f0-9]{40}$/.test(sha),
      gitFile: (sha, file) => mutateFile(Buffer.from(`reviewed fixed code: ${file}`), sha, file),
      gitBlob: () => original.sourceGuardBytes }) };
}

function signedBundle() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519"); // Ephemeral CI key only.
  const allowlist = { keys: [{ keyId: "fixture", status: "active", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) }] };
  const pending = ["a", "b", "c", "d", "e", "f"];
  const identity = { database: "bodycast_test", databaseOid: 16384, clusterSystemIdentifier: "7419276301947620311",
    role: "bodycast", serverVersion: "17.5", serverAddress: "127.0.0.1", serverPort: 5432 };
  const migrations = [{ name: "baseline", checksum: "a".repeat(64), startedAt: "2026-10-01T00:00:00Z", rolledBackAt: null, finishedAt: "2026-10-01T00:00:00Z" }];
  const objects = [{ name: "DailyModelState", present: true, kind: "table", signature: "baseline" }];
  const report = { identity, migrations, objects, logicalDataFingerprint: "9".repeat(64) };
  const record = capturePreviousAppProvenance({ targetSha: FORWARD_RESUME_FAILED_SHA, databaseReport: report,
    container: { Id: "d".repeat(64), Image: `sha256:${"e".repeat(64)}`, State: { Health: { Status: "healthy" } },
      Config: { Labels: null, Env: ["NODE_ENV=production"] }, HostConfig: { RestartPolicy: { Name: "unless-stopped" } } } });
  const preflightResult = { ...report, readyForOwnerAuthorization: true, manifestId: "active-energy-unified-v2",
    pending, pendingSetDigest: canonicalSha256(pending), previousAppProvenance: previousAppProvenanceBinding(record) };
  const restoreResult = { verified: true, postflightReady: true, logicalDataFingerprint: report.logicalDataFingerprint,
    postSchemaDigest: schemaInventoryDigest(objects) };
  const claims = { repository: "krustallik/body-model", workflowId: "77", workflowPath: ".github/workflows/production-migrate.yml",
    workflowRunId: "38022978032", workflowRunAttempt: 1, actorId: String(owner), releaseSha: FORWARD_RESUME_FAILED_SHA,
    currentMainSha: FORWARD_RESUME_FAILED_SHA, manifestId: "active-energy-unified-v2", pendingMigrationNames: pending,
    pendingSetDigest: canonicalSha256(pending), preflightRunId: "38022000000", preflightRunAttempt: 1,
    preflightRunStartedAt: "2026-10-09T10:00:00Z", preflightResultDigest: canonicalSha256(preflightResult),
    backupArtifactId: "1234", backupArtifactDigest: "a".repeat(64), backupSnapshotAt: "2026-10-09T10:10:00Z",
    restoreResultDigest: canonicalSha256(restoreResult), productionIdentityDigest: canonicalSha256(identity),
    writerDrainDigest: "c".repeat(64), writerTopologyDigest: "d".repeat(64),
    issuedAt: "2026-10-09T11:00:00Z", expiresAt: "2026-10-09T12:00:00Z",
    authorizationId: "fixture-owner-authorization", nonce: "12345678-1234-1234-1234-123456789abc" };
  const envelope = createAuthorizationEnvelope(claims, { keyId: "fixture", allowlist,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) });
  const preflightEvidence = { verified: true, repository: claims.repository,
    workflowPath: ".github/workflows/production-migration-preflight.yml", releaseSha: claims.releaseSha,
    manifestId: claims.manifestId, workflowRunId: claims.preflightRunId, workflowRunAttempt: 1,
    preflightResultDigest: claims.preflightResultDigest, restoreResultDigest: claims.restoreResultDigest,
    previousAppProvenance: preflightResult.previousAppProvenance };
  const artifactMetadata = { id: "1234", digest: `sha256:${claims.backupArtifactDigest}`, workflowRunId: claims.preflightRunId, workflowRunAttempt: 1 };
  return { envelope, preflightEvidence, preflightResult, restoreResult, artifactMetadata, allowlist, report, record };
}

describe("credential-free end-to-end forward-resume evidence replay", () => {
  it("replays paginated API → raw ANSI log → source guard → signed bundle → forward receipt → fresh context", async () => {
    const fixture = apiFixture({ mutateLog: (log) => log.replace("##[group]", "\u001b[32m##[group]\u001b[0m") });
    const result = await fixture.collect();
    expect(result.failureProof.noPrismaSpawnVerified).toBe(true);
    expect(fixture.requests.filter(({ url }) => url.pathname === `${prefix}/runs`)).toHaveLength(4);
    const bundle = signedBundle();
    const verified = verifyForwardResumeAuthorizationBundle(bundle);
    const { receipt: base } = rebindPreviousAppProvenanceForPreflightResume({ record: bundle.record,
      sourceSha: verified.sourceSha, targetSha: mainSha, sourceRunId: verified.preflightRunId,
      sourceRunAttempt: 1, databaseReport: bundle.report });
    expect(base.sourceRecordDigest).toBe(verified.previousAppProvenance.recordDigest);
    const marker = { schemaVersion: 1, markerSchemaVersion: 1, releaseSha: verified.sourceSha,
      state: "ddl-started", markerDigest: "a".repeat(64) };
    const expected = { ...base, mode: "forward", captureRunId: currentId, captureRunAttempt: 1,
      forwardResume: { sourceFailedRunId: result.failureProof.sourceRunId, sourceFailedRunAttempt: 1,
        sourceFailedSha: verified.sourceSha, failureProofDigest: canonicalSha256(result.failureProof), sourceMarkerDigest: marker.markerDigest } };
    const receipt = createCaptureResumeReceipt(base, expected);
    const hostReceipt = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/production-capture-resume-receipt.mjs", import.meta.url)),
      "--produce", base.sourceRunId, "1", base.sourceSha, base.targetSha, currentId, "1",
      expected.forwardResume.sourceFailedRunId, expected.forwardResume.sourceFailedSha,
      expected.forwardResume.failureProofDigest, expected.forwardResume.sourceMarkerDigest], { input: JSON.stringify(base), encoding: "utf8" }));
    expect(validateCaptureResumeReceipt(hostReceipt, expected)).toEqual(receipt);
    expect(validateCaptureResumeReceipt(JSON.parse(JSON.stringify(receipt)), expected)).toEqual(receipt);
    const ordinary = createCaptureResumeReceipt(base, { captureRunId: currentId, captureRunAttempt: 1 });
    expect(validateCaptureResumeReceipt(ordinary, { ...expected, mode: "ordinary" }).mode).toBe("ordinary");
    const context = createForwardResumeContext({ failureProof: result.failureProof, markerObservation: marker,
      authorizationBundleProof: verified, preflightRunId: currentId, preflightRunAttempt: 1, targetSha: mainSha,
      mutationHistoryDigest: result.mutationHistoryDigest, preflightResult: bundle.preflightResult,
      report: bundle.report, restoreResult: bundle.restoreResult, backupBytes: Buffer.from("fresh ciphertext fixture") });
    expect(verifyForwardResumeContext(context, { targetSha: mainSha, preflightRunId: currentId, preflightRunAttempt: 1 }).noPrismaSpawnVerified).toBe(true);
    expect(() => verifyForwardResumeContext({ ...context, currentDataFingerprint: "0".repeat(64) }, {
      targetSha: mainSha, preflightRunId: currentId, preflightRunAttempt: 1 })).toThrow();
    for (const key of Object.keys(receipt)) {
      const tampered = structuredClone(receipt);
      tampered[key] = key === "forwardResume" ? { ...tampered[key], failureProofDigest: "0".repeat(64) } : null;
      expect(() => validateCaptureResumeReceipt(tampered, expected)).toThrow("closed-schema");
    }
    for (const key of Object.keys(receipt.forwardResume)) {
      const tampered = structuredClone(receipt);
      tampered.forwardResume[key] = key.endsWith("Attempt") ? 2 : "0".repeat(64);
      expect(() => validateCaptureResumeReceipt(tampered, expected)).toThrow("closed-schema");
    }
    expect(() => validateCaptureResumeReceipt({ ...receipt, extra: true }, expected)).toThrow();
    expect(() => validateCaptureResumeReceipt({ ...receipt, forwardResume: { ...receipt.forwardResume, extra: true } }, expected)).toThrow();
    expect(() => validateCaptureResumeReceipt(receipt, { ...expected, mode: "ordinary" })).toThrow();
    const tamperedBundle = { ...bundle, preflightResult: { ...bundle.preflightResult, previousAppProvenance: { recordDigest: "0".repeat(64) } } };
    expect(() => verifyForwardResumeAuthorizationBundle(tamperedBundle)).toThrow();
    const alteredEnvelope = JSON.parse(bundle.envelope);
    alteredEnvelope.payload.actorId = "42";
    expect(() => verifyForwardResumeAuthorizationBundle({ ...bundle, envelope: JSON.stringify(alteredEnvelope) })).toThrow();
  });

  it.each([
    ["wrong actor", (retry) => { retry.run.actor.id = 42; }],
    ["wrong triggering actor", (retry) => { retry.run.triggering_actor.id = 42; }],
    ["rerun", (retry) => { retry.run.run_attempt = 2; }],
    ["changed run SHA", (retry) => { retry.run.head_sha = "f".repeat(40); }],
    ["duplicate jobs", (retry) => { retry.jobsPayload.jobs[1].id = retry.jobsPayload.jobs[0].id; }],
    ["production step ran", (retry) => { retry.jobsPayload.jobs[1].steps.push({ name: "SSH", conclusion: "success" }); }],
    ["incomplete jobs", (retry) => { retry.jobsPayload.jobs.pop(); }],
  ])("rejects %s before accepting an intervening retry", async (_name, mutateRetry) => {
    await expect(apiFixture({ mutateRetry }).collect()).rejects.toThrow();
  });

  it.each([
    ["unknown workflow", (runs) => { runs[1].path = ".github/workflows/production-recovery-phase-a.yml"; return runs; }],
    ["production execution", (runs) => { runs[1].path = ".github/workflows/deploy-production.yml"; return runs; }],
    ["duplicate run", (runs) => [...runs, runs[1]]],
    ["source omission", (runs) => runs.slice(1)],
    ["current omission", (runs) => runs.filter((run) => String(run.id) !== currentId)],
  ])("rejects %s in repository-wide inventory", async (_name, mutateRuns) => {
    await expect(apiFixture({ mutateRuns }).collect()).rejects.toThrow();
  });

  it.each(["http://fixture.blob.core.windows.net/log", "https://attacker.example/log", "https://user@fixture.blob.core.windows.net/log"])("rejects unsafe redirect %s", async (redirect) => {
    await expect(apiFixture({ redirect }).collect()).rejects.toThrow("untrusted log download origin");
  });
  it("rejects another redirect or expired download without exposing URL or credential", async () => {
    for (const downloadStatus of [302, 403]) await expect(apiFixture({ downloadStatus }).collect()).rejects.toThrow("log download failed");
  });
  it.each([
    ["invalid date", (log) => log.replaceAll("2026-10-09", "2026-02-30")],
    ["out of order", (log) => log.split("\n").reverse().join("\n")],
    ["unframed evidence", (log) => `${log}\nunframed evidence`],
    ["DDL output", (log) => `${log}\n2026-10-09T12:00:02Z Applying migration unexpected`],
  ])("rejects %s raw log evidence", async (_name, mutateLog) => {
    await expect(apiFixture({ mutateLog }).collect()).rejects.toThrow();
  });
  it("rejects pagination gaps, count changes, overflow and non-UTF8/non-text bodies", async () => {
    for (const payload of [{ total_count: 2, workflow_runs: [{ id: 1 }] }, { total_count: 1001, workflow_runs: [] }]) {
      const client = createGitHubEvidenceClient({ token: "fixture", fetchImpl: async () => jsonResponse(payload) });
      await expect(client.list(`${prefix}/runs`, "workflow_runs")).rejects.toThrow();
    }
    let page = 0;
    const changingClient = createGitHubEvidenceClient({ token: "fixture", fetchImpl: async () => jsonResponse(++page === 1
      ? { total_count: 101, workflow_runs: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) }
      : { total_count: 102, workflow_runs: [{ id: 101 }, { id: 102 }] }) });
    await expect(changingClient.list(`${prefix}/runs`, "workflow_runs")).rejects.toThrow("changing paginated inventory");
    const client = createGitHubEvidenceClient({ token: "fixture", fetchImpl: async () => new Response(null, {
      status: 302, headers: { location: "https://fixture.blob.core.windows.net/log" } }) });
    await expect(client.rawJobLog("3")).rejects.toThrow();
    for (const response of [new Response(Uint8Array.of(0xff), { headers: { "content-type": "text/plain" } }),
      new Response("{}", { headers: { "content-type": "application/json" } }),
      new Response("", { headers: { "content-type": "text/plain", "content-length": "999999999" } })]) {
      let count = 0;
      const bodyClient = createGitHubEvidenceClient({ token: "fixture", fetchImpl: async () => ++count === 1
        ? new Response(null, { status: 302, headers: { location: "https://fixture.blob.core.windows.net/log" } }) : response });
      await expect(bodyClient.rawJobLog("3")).rejects.toThrow();
    }
  });
  it("blocks a changed snapshot after details/log verification and never prints signed URLs", async () => {
    const fixture = apiFixture();
    const originalList = fixture.client.list;
    let repositoryReads = 0;
    fixture.client.list = async (endpoint, field) => {
      const payload = await originalList(endpoint, field);
      if (field === "workflow_runs" && ++repositoryReads === 2) payload.workflow_runs[1].head_sha = "f".repeat(40);
      return payload;
    };
    await expect(collectForwardResumeEvidence({ client: fixture.client, currentRunId: currentId,
      currentMainSha: mainSha, isAncestor: () => true, gitBlob: () => noSpawnProofInputs().sourceGuardBytes }))
      .rejects.toThrow("inventory changed during verification");
    const badClient = createGitHubEvidenceClient({ token: "secret-fixture", fetchImpl: async () => {
      throw new Error("https://private.example/?signed=secret-fixture");
    } });
    await expect(badClient.rawJobLog("3")).rejects.toThrow("network request failed");
  });
  it("requires completeness and actual ancestry, rejects missing proof and source code substitution", () => {
    expect(() => verifyNoLaterMutationRun({ runs: [], currentRunId: currentId })).toThrow("incomplete");
    const fixture = noSpawnProofInputs();
    expect(() => verifyForwardResumeNoSpawnEvidence({ ...fixture, sourceIsAncestor: false })).toThrow();
    expect(() => verifyForwardResumeNoSpawnEvidence({ ...fixture, sourceGuardBytes: Buffer.from("substituted") })).toThrow();
  });
  it("accepts an independently classified unchanged read-only diagnostic, binds all source files", async () => {
    const evidence = await apiFixture({ includeDiagnostic: true }).collect();
    expect(evidence.failureProof.noPrismaSpawnVerified).toBe(true);
    expect(evidence.mutationHistoryDigest).not.toBe((await apiFixture().collect()).mutationHistoryDigest);
  });
  it.each([
    ["actor", (d) => { d.run.actor.id = 42; }],
    ["rerun", (d) => { d.run.run_attempt = 2; }],
    ["SHA", (d) => { d.run.head_sha = "f".repeat(40); }],
    ["incomplete jobs", (d) => { d.jobs.jobs.pop(); }],
    ["extra step", (d) => { d.jobs.jobs[1].steps.push({ name: "mutate", conclusion: "success", status: "completed" }); }],
    ["failed step", (d) => { d.jobs.jobs[1].steps[4].conclusion = "failure"; }],
  ])("blocks diagnostic with changed %s", async (_label, mutateDiagnostic) => {
    await expect(apiFixture({ includeDiagnostic: true, mutateDiagnostic }).collect()).rejects.toThrow();
  });
  it.each(DIAGNOSTIC_FILES)("blocks changed diagnostic dependency %s", async (changedFile) => {
    await expect(apiFixture({ includeDiagnostic: true, mutateFile: (bytes, sha, file) =>
      sha !== mainSha && file === changedFile ? Buffer.from("different code") : bytes }).collect()).rejects.toThrow("diagnostic code differs");
  });
  it("blocks non-ancestor SHA", async () => {
    await expect(apiFixture({ ancestor: false }).collect()).rejects.toThrow();
  });
});
