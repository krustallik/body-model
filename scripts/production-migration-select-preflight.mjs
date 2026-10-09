import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { selectLatestApplicablePreflight, verifyPreflightArtifactMetadata } from "./production-migration-release.mjs";

function parseNdjson(text) { return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }

export function normalizeWorkflowRuns(records) {
  return records.map((run) => ({
    repository: "krustallik/body-model",
    // The REST API includes the workflow ref after `@`; the release selector
    // compares the repository-relative workflow file path.
    workflowPath: typeof run.path === "string" ? run.path.split("@")[0] : run.path,
    workflowId: String(run.workflow_id),
    event: run.event,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    displayTitle: run.display_title,
    id: String(run.id),
    runAttempt: Number(run.run_attempt),
    createdAt: run.created_at,
    runStartedAt: run.run_started_at,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
  }));
}

export function selectAndVerifyArtifact({ runs, artifacts, workflowId, releaseSha, manifestId }) {
  const normalized = normalizeWorkflowRuns(runs);
  const selected = selectLatestApplicablePreflight(normalized, {
    repository: "krustallik/body-model",
    releaseSha,
    manifestId,
    workflowId: String(workflowId),
  });
  const suffix = releaseSha + "-" + manifestId + "-" + selected.id + "-" + selected.runAttempt;
  const evidenceName = "bodycast-preflight-evidence-" + suffix;
  const backupName = "bodycast-backup-" + suffix;
  function resolve(name) {
    const matches = artifacts.filter((artifact) => artifact.name === name && artifact.expired !== true);
    if (matches.length !== 1) throw new Error("Latest successful preflight lacks exactly one unexpired immutable artifact: " + name);
    const item = matches[0];
    const normalized = {
      id: String(item.id), digest: item.digest, expired: item.expired,
      headSha: item.workflow_run?.head_sha, workflowRunId: String(item.workflow_run?.id),
      workflowRunAttempt: selected.runAttempt, name: item.name,
    };
    verifyPreflightArtifactMetadata(normalized, selected);
    return normalized;
  }
  return { run: selected, evidenceArtifact: resolve(evidenceName), backupArtifact: resolve(backupName), artifactName: evidenceName, backupArtifactName: backupName };
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--select-run" && args.length === 4) {
    const [runsFile, workflowId, releaseSha, manifestId] = args;
    const runs = normalizeWorkflowRuns(parseNdjson(await readFile(runsFile, "utf8")));
    const selected = selectLatestApplicablePreflight(runs, { repository: "krustallik/body-model", workflowId: String(workflowId), releaseSha, manifestId });
    process.stdout.write(JSON.stringify(selected, null, 2) + "\n");
    return;
  }
  if (mode !== "--select" || args.length !== 5) {
    throw new Error("Usage: production-migration-select-run <runs.ndjson> <workflow-id> <release-sha> <manifest-id> | --select <runs.ndjson> <artifacts.ndjson> <workflow-id> <release-sha> <manifest-id>");
  }
  const [runsFile, artifactsFile, workflowId, releaseSha, manifestId] = args;
  const [runText, artifactText] = await Promise.all([
    readFile(runsFile, "utf8"), readFile(path.resolve(artifactsFile), "utf8"),
  ]);
  let artifactData;
  try { artifactData = JSON.parse(artifactText); }
  catch { artifactData = { artifacts: parseNdjson(artifactText) }; }
  const runs = parseNdjson(runText);
  const result = selectAndVerifyArtifact({ runs, artifacts: artifactData.artifacts ?? [], workflowId, releaseSha, manifestId });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
