import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BODYCAST_REPOSITORY } from "./github-owner-identity.mjs";
import { canonicalSha256 } from "./production-migration-authorization.mjs";
import { DIAGNOSTIC_PATH, DIAGNOSTIC_FILES, FORWARD_RESUME_FAILED_RUN_ID, MIGRATION_FAILURE_JOB, verifyNoLaterMutationRun,
  verifyForwardResumeNoSpawnEvidence, selectForwardResumeMigrationContextArtifact } from "./production-forward-resume.mjs";

const PREFIX = `/repos/${BODYCAST_REPOSITORY}`;
const MAX_BYTES = 32 * 1024 * 1024;
function fail(message) { throw new Error(`GitHub evidence blocked: ${message}`); }
// No gh formatting, subprocess token arguments, or authenticated redirect following.
export function createGitHubEvidenceClient({ token, fetchImpl = fetch }) {
  if (typeof token !== "string" || !token.trim() || /[\r\n]/.test(token)) fail("missing API credential");
  async function request(url, authenticated) {
    let response;
    try {
      response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(30_000),
        headers: authenticated ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28" } : {} });
    } catch { fail("network request failed"); } // Never include a signed redirect URL or token in diagnostics.
    return response;
  }
  async function bytes(response) {
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_BYTES) fail("response too large");
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response.body ?? []) {
        size += chunk.length;
        if (size > MAX_BYTES) fail("response too large");
        chunks.push(chunk);
      }
    } catch { fail("response unreadable or too large"); }
    // Preserve BOM bytes for the evidence digest; normalization belongs only in the parser.
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)); }
    catch { fail("response is not UTF-8 text"); }
  }
  function apiUrl(endpoint) {
    if (!endpoint.startsWith(`${PREFIX}/actions/`) || /[\r\n#]/.test(endpoint)) fail("unexpected API endpoint");
    const url = new URL(endpoint, "https://api.github.com");
    if (url.origin !== "https://api.github.com" || !url.pathname.startsWith(`${PREFIX}/actions/`)) fail("unexpected API origin");
    return url.href;
  }
  async function json(endpoint) {
    const response = await request(apiUrl(endpoint), true);
    if (response.status !== 200) fail(`API response ${response.status}`);
    try { return JSON.parse(await bytes(response)); } catch { fail("invalid API JSON"); }
  }
  async function rawJobLog(jobId) {
    if (!/^[1-9][0-9]*$/.test(String(jobId))) fail("malformed job ID");
    const response = await request(apiUrl(`${PREFIX}/actions/jobs/${jobId}/logs`), true);
    if (response.status !== 302) fail("job log API did not return one download redirect");
    let target;
    try { target = new URL(response.headers.get("location")); } catch { fail("invalid log redirect"); }
    if (target.protocol !== "https:" || target.username || target.password || target.port || target.hash
      || !(target.hostname.endsWith(".blob.core.windows.net") || target.hostname.endsWith(".actions.githubusercontent.com"))) {
      fail("untrusted log download origin");
    }
    const download = await request(target.href, false);
    if (download.status !== 200 || !/^text\/plain(?:;|$)/i.test(download.headers.get("content-type") ?? "")) fail("log download failed or is not plain text");
    return bytes(download);
  }
  async function list(endpoint, field) {
    const items = [];
    const ids = new Set();
    let total;
    for (let page = 1; page <= 10; page++) {
      const payload = await json(`${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (!Number.isSafeInteger(payload.total_count) || payload.total_count < 0 || payload.total_count > 1000
        || (total !== undefined && total !== payload.total_count) || !Array.isArray(payload[field])) fail("incomplete or changing paginated inventory");
      total = payload.total_count;
      for (const item of payload[field]) {
        const id = String(item?.id ?? "");
        if (!/^[1-9][0-9]*$/.test(id) || ids.has(id)) fail("duplicate or invalid inventory ID");
        ids.add(id); items.push(item);
      }
      if (items.length > total || payload[field].length > 100) fail("inventory count mismatch");
      if (items.length === total) return { total_count: total, [field]: items };
      if (payload[field].length !== 100) fail("inventory page gap");
    }
    fail("inventory exceeds complete pagination limit");
  }
  return { json, list, rawJobLog };
}

const NON_PRODUCTION = new Set([".github/workflows/ci.yml", ".github/workflows/production-migration-safety-ci.yml"]);
export async function collectForwardResumeEvidence({ client, currentRunId, currentMainSha, isAncestor, gitBlob, gitFile }) {
  const sourceRun = await client.json(`${PREFIX}/actions/runs/${FORWARD_RESUME_FAILED_RUN_ID}`);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(sourceRun.created_at ?? "")) fail("source creation timestamp missing");
  // Repository-wide, not a handpicked set of workflow IDs: removed/renamed/unknown paths cannot disappear.
  const endpoint = `${PREFIX}/actions/runs?created=${encodeURIComponent(`>=${sourceRun.created_at}`)}`;
  const snapshot = await client.list(endpoint, "workflow_runs");
  const runs = snapshot.workflow_runs.filter((run) => !NON_PRODUCTION.has(String(run.path).split("@")[0]));
  const safeFailedPreflightRetries = [];
  const readOnlyDiagnostics = [];
  const preflightWorkflow = await client.json(`${PREFIX}/actions/workflows/production-migration-preflight.yml`);
  for (const historyRun of runs) {
    if (BigInt(historyRun.id) <= BigInt(FORWARD_RESUME_FAILED_RUN_ID) || String(historyRun.id) === String(currentRunId)) continue;
    const run = await client.json(`${PREFIX}/actions/runs/${historyRun.id}`);
    const jobsPayload = await client.list(`${PREFIX}/actions/runs/${historyRun.id}/attempts/1/jobs`, "jobs");
    if (String(historyRun.path).split("@")[0] === DIAGNOSTIC_PATH) {
      const workflow = await client.json(`${PREFIX}/actions/workflows/production-checkout-diagnostic.yml`);
      if (!gitFile || !/^[a-f0-9]{40}$/.test(run.head_sha ?? "")) fail("diagnostic source inspection unavailable");
      readOnlyDiagnostics.push({ run, jobsPayload, workflowId: workflow.id, currentMainSha,
        shaIsAncestorOfCurrentMain: isAncestor(run.head_sha, currentMainSha),
        sourceFiles: Object.fromEntries(DIAGNOSTIC_FILES.map((file) => [file, gitFile(run.head_sha, file)])),
        reviewedFiles: Object.fromEntries(DIAGNOSTIC_FILES.map((file) => [file, gitFile(currentMainSha, file)])) });
      continue;
    }
    safeFailedPreflightRetries.push({ run, jobsPayload, workflowId: preflightWorkflow.id, currentMainSha,
      shaIsAncestorOfCurrentMain: isAncestor(run.head_sha, currentMainSha) });
  }
  const sourceJobs = await client.list(`${PREFIX}/actions/runs/${sourceRun.id}/attempts/1/jobs`, "jobs");
  const execution = sourceJobs.jobs.filter((job) => job.name === MIGRATION_FAILURE_JOB);
  if (execution.length !== 1) fail("ambiguous source execution job");
  const logText = await client.rawJobLog(execution[0].id);
  const artifactPayload = await client.list(`${PREFIX}/actions/runs/${sourceRun.id}/artifacts`, "artifacts");
  selectForwardResumeMigrationContextArtifact(artifactPayload);
  const workflow = await client.json(`${PREFIX}/actions/workflows/production-migrate.yml`);
  const failureProof = verifyForwardResumeNoSpawnEvidence({ run: sourceRun, jobsPayload: sourceJobs, logText,
    sourceGuardBytes: gitBlob(sourceRun.head_sha), workflowId: workflow.id,
    sourceIsAncestor: isAncestor(sourceRun.head_sha, currentMainSha) });
  const again = await client.list(endpoint, "workflow_runs");
  if (canonicalSha256(snapshot) !== canonicalSha256(again)) fail("run inventory changed during verification");
  const sourceInHistory = runs.find((run) => String(run.id) === String(sourceRun.id));
  if (canonicalSha256(sourceInHistory) !== canonicalSha256(sourceRun)) fail("source run metadata changed");
  const mutationHistoryDigest = verifyNoLaterMutationRun({ runs, currentRunId, currentMainSha,
    inventory: { complete: true, scope: "repository-since-source", totalCount: snapshot.total_count,
      observedCount: snapshot.workflow_runs.length, sourceCreatedAt: sourceRun.created_at }, safeFailedPreflightRetries, readOnlyDiagnostics });
  return { failureProof, mutationHistoryDigest, artifactPayload };
}

async function main() {
  const [outputDir, currentRunId, currentMainSha] = process.argv.slice(2);
  if (!outputDir || !/^[1-9][0-9]*$/.test(currentRunId ?? "") || !/^[a-f0-9]{40}$/.test(currentMainSha ?? "")) fail("invalid collector arguments");
  const result = await collectForwardResumeEvidence({ client: createGitHubEvidenceClient({ token: process.env.GH_TOKEN }),
    currentRunId, currentMainSha,
    isAncestor: (sha, current) => {
      if (!/^[a-f0-9]{40}$/.test(sha ?? "")) return false;
      try { execFileSync("git", ["merge-base", "--is-ancestor", sha, current]); return true; } catch { return false; }
    },
    gitBlob: (sha) => execFileSync("git", ["show", `${sha}:scripts/run-prisma-migrate-with-lock-timeout.mjs`]),
    gitFile: (sha, file) => execFileSync("git", ["show", `${sha}:${file}`]),
  });
  await mkdir(outputDir, { mode: 0o700 });
  await writeFile(path.join(outputDir, "github-evidence.json"), `${JSON.stringify(result)}\n`, { flag: "wx", mode: 0o600 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
