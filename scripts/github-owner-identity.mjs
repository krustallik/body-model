/**
 * BodyCast's canonical GitHub owner identity. Numeric GitHub IDs are immutable;
 * login names are display metadata only and must never authorize a release.
 * The ID was verified against both /user and /repos/krustallik/body-model.
 */
export const BODYCAST_REPOSITORY = "krustallik/body-model";
export const BODYCAST_OWNER_LOGIN = "krustallik";
export const BODYCAST_OWNER_ID = "126446430";

export function assertPinnedOwnerId(value, label = "GitHub actor ID") {
  if (!/^[1-9][0-9]*$/.test(String(value ?? "")) || String(value) !== BODYCAST_OWNER_ID) {
    throw new Error(`${label} is not the pinned BodyCast owner identity.`);
  }
  return BODYCAST_OWNER_ID;
}

export function assertCanonicalRepositoryOwner(owner) {
  if (!owner || String(owner.id) !== BODYCAST_OWNER_ID || owner.login !== BODYCAST_OWNER_LOGIN) {
    throw new Error("Canonical GitHub repository owner identity does not match the pinned immutable owner ID.");
  }
  return BODYCAST_OWNER_ID;
}

export function assertTrustedOwnerWorkflowRun(run, {
  actorId,
  workflowPath,
  workflowRunId,
  workflowRunAttempt,
  ref = "refs/heads/main",
  sha,
  event = "workflow_dispatch",
  requireInProgress = false,
  jobs = [],
  activeJobName,
  authorizedJobName,
} = {}) {
  if (!run || run.repository?.full_name !== BODYCAST_REPOSITORY) {
    throw new Error("GitHub workflow run is not from the canonical BodyCast repository.");
  }
  assertCanonicalRepositoryOwner(run.repository.owner);
  const apiPath = typeof run.path === "string" ? run.path.split("@")[0] : "";
  if (apiPath !== workflowPath || String(run.id) !== String(workflowRunId)
    || Number(run.run_attempt) !== Number(workflowRunAttempt)
    || run.event !== event || run.head_branch !== ref.replace(/^refs\/heads\//, "")
    || run.head_sha !== sha || String(run.actor?.id) !== String(actorId)
    || String(run.triggering_actor?.id) !== String(actorId)) {
    throw new Error("GitHub workflow run or rerun does not match the pinned owner, workflow, exact SHA, ref, event, and attempt.");
  }
  assertPinnedOwnerId(run.actor?.id, "GitHub workflow actor ID");
  assertPinnedOwnerId(run.triggering_actor?.id, "GitHub workflow triggering actor ID");
  // The workflow-runs API can lag behind the jobs API between dependent jobs.
  // If its run-level status is no longer active, accept only the exact active
  // deploy job for this run/attempt/SHA plus its successful authorization job.
  if (requireInProgress && (!["queued", "in_progress"].includes(run.status) || run.conclusion !== null)) {
    const sameAttempt = (job) => job && String(job.run_id) === String(run.id)
      && Number(job.run_attempt) === Number(run.run_attempt)
      && job.head_sha === run.head_sha && job.head_branch === run.head_branch;
    const activeJob = jobs.find((job) => job.name === activeJobName && sameAttempt(job));
    const authorizedJob = jobs.find((job) => job.name === authorizedJobName && sameAttempt(job));
    const activeJobProvesAttempt = activeJob?.status === "in_progress" && activeJob.conclusion == null
      && authorizedJob?.status === "completed" && authorizedJob.conclusion === "success";
    if (!activeJobProvesAttempt) {
      throw new Error("GitHub workflow run is no longer the exact active authorization attempt.");
    }
  }
  return true;
}
