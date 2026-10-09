import { describe, expect, it } from "vitest";
import {
  assertCanonicalRepositoryOwner,
  assertPinnedOwnerId,
  assertTrustedOwnerWorkflowRun,
  BODYCAST_OWNER_ID,
} from "../scripts/github-owner-identity.mjs";

const sha = "a".repeat(40);
const run = (overrides = {}) => ({
  repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
  path: ".github/workflows/production-migrate.yml@refs/heads/main",
  id: 1234,
  run_attempt: 2,
  event: "workflow_dispatch",
  head_branch: "main",
  head_sha: sha,
  actor: { id: 126446430, login: "krustallik" },
  triggering_actor: { id: 126446430, login: "krustallik" },
  status: "in_progress",
  conclusion: null,
  ...overrides,
});

const expected = {
  actorId: BODYCAST_OWNER_ID,
  workflowPath: ".github/workflows/production-migrate.yml",
  workflowRunId: "1234",
  workflowRunAttempt: 2,
  ref: "refs/heads/main",
  sha,
  requireInProgress: true,
};

describe("pinned single-owner GitHub identity", () => {
  it("accepts only the canonical owner identity from GitHub API metadata", () => {
    expect(assertCanonicalRepositoryOwner({ id: 126446430, login: "krustallik" })).toBe(BODYCAST_OWNER_ID);
    expect(assertTrustedOwnerWorkflowRun(run(), expected)).toBe(true);
  });

  it.each([
    ["another actor", run({ actor: { id: 24680, login: "other" } })],
    ["non-owner rerun", run({ triggering_actor: { id: 24680, login: "other" } })],
    ["missing actor", run({ actor: null })],
    ["missing triggering actor", run({ triggering_actor: null })],
    ["wrong SHA", run({ head_sha: "b".repeat(40) })],
    ["wrong repository owner", run({ repository: { full_name: "krustallik/body-model", owner: { id: 24680, login: "krustallik" } } })],
    ["wrong branch", run({ head_branch: "feature/test" })],
    ["wrong event", run({ event: "pull_request" })],
    ["wrong attempt", run({ run_attempt: 1 })],
    ["completed rerun", run({ status: "completed", conclusion: "success" })],
  ])("rejects %s", (_label, candidate) => {
    expect(() => assertTrustedOwnerWorkflowRun(candidate, expected)).toThrow();
  });

  it("rejects caller-supplied identities that are not the immutable owner ID", () => {
    expect(() => assertPinnedOwnerId("krustallik")).toThrow(/pinned/);
    expect(() => assertPinnedOwnerId("24680")).toThrow(/pinned/);
    expect(() => assertCanonicalRepositoryOwner({ id: 24680, login: "krustallik" })).toThrow(/immutable/);
  });
});
