import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const runnerPath = resolve(process.cwd(), "scripts/refactor/run-behavior-comparator.mjs");
const sourceManifestPath = resolve(process.cwd(), "tests/fixtures/refactor-comparator/invariants-v1.json");
const manifestRelativePath = "tests/fixtures/refactor-comparator/invariants-v1.json";
const taskTempRoot = resolve(tmpdir());

interface RunnerFixture {
  directory: string;
  root: string;
  baseSha: string;
}

let fixture: RunnerFixture;

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function invokeRunner(input: {
  cwd?: string;
  baseSha?: string;
  candidateSha?: string;
  manifest?: string;
  evidenceDir?: string;
} = {}) {
  const evidenceDir = input.evidenceDir ?? join(fixture.directory, "new-evidence");
  const result = spawnSync(process.execPath, [
    runnerPath,
    "--base-sha", input.baseSha ?? fixture.baseSha,
    "--candidate-sha", input.candidateSha ?? fixture.baseSha,
    "--manifest", input.manifest ?? manifestRelativePath,
    "--evidence-dir", evidenceDir,
  ], {
    cwd: input.cwd ?? fixture.root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  return { ...result, evidenceDir };
}

function expectFailClosed(
  result: ReturnType<typeof invokeRunner>,
  expectedError: string,
  evidenceShouldExist = false,
): void {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(output).toContain(expectedError);
  expect(output).not.toMatch(/"status"\s*:\s*"PASS"/);
  expect(existsSync(result.evidenceDir)).toBe(evidenceShouldExist);
}

describe("behavior comparator runner refusal paths", () => {
  beforeEach(() => {
    const directory = mkdtempSync(join(taskTempRoot, "bodycast-comparator-runner-"));
    const root = join(directory, "repository");
    mkdirSync(root, { recursive: true });
    runGit(root, ["init", "--quiet"]);
    runGit(root, ["config", "user.name", "BodyCast comparator fixture"]);
    runGit(root, ["config", "user.email", "bodycast-comparator-fixture@example.invalid"]);
    mkdirSync(join(root, "tests/fixtures/refactor-comparator"), { recursive: true });
    copyFileSync(sourceManifestPath, join(root, manifestRelativePath));
    writeFileSync(join(root, "README.md"), "Disposable comparator runner fixture.\n");
    runGit(root, ["add", "--all"]);
    runGit(root, ["commit", "--quiet", "-m", "fixture base"]);
    runGit(root, ["branch", "-m", "main"]);
    fixture = { directory, root, baseSha: runGit(root, ["rev-parse", "HEAD"]) };
  });

  afterEach(() => {
    const directory = resolve(fixture.directory);
    if (dirname(directory) !== taskTempRoot || !basename(directory).startsWith("bodycast-comparator-runner-")) {
      throw new Error("Refusing to remove a path outside this test's disposable temp directory.");
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects a candidate SHA that is not the current HEAD", () => {
    const result = invokeRunner({ candidateSha: "f".repeat(40) });
    expectFailClosed(result, "Candidate SHA must equal the exact current HEAD.");
  });

  it("rejects an untracked dirty candidate tree", () => {
    writeFileSync(join(fixture.root, "untracked-sentinel.txt"), "dirty\n");
    const result = invokeRunner();
    expectFailClosed(result, "Comparator candidate worktree must be completely clean before running.");
  });

  it("rejects a base SHA unavailable in the repository", () => {
    const missingBase = "f".repeat(40);
    expect(spawnSync("git", ["cat-file", "-e", `${missingBase}^{commit}`], {
      cwd: fixture.root, windowsHide: true,
    }).status).not.toBe(0);
    const result = invokeRunner({ baseSha: missingBase });
    expectFailClosed(result, "Comparator base SHA is unavailable locally.");
  });

  it("rejects a base commit that is not an ancestor of the candidate", () => {
    runGit(fixture.root, ["switch", "--quiet", "-c", "unrelated"]);
    writeFileSync(join(fixture.root, "unrelated.txt"), "unrelated\n");
    runGit(fixture.root, ["add", "--all"]);
    runGit(fixture.root, ["commit", "--quiet", "-m", "unrelated branch"]);
    const unrelatedSha = runGit(fixture.root, ["rev-parse", "HEAD"]);
    runGit(fixture.root, ["switch", "--quiet", "main"]);
    writeFileSync(join(fixture.root, "candidate.txt"), "candidate\n");
    runGit(fixture.root, ["add", "--all"]);
    runGit(fixture.root, ["commit", "--quiet", "-m", "candidate branch"]);
    const candidateSha = runGit(fixture.root, ["rev-parse", "HEAD"]);

    const result = invokeRunner({ baseSha: unrelatedSha, candidateSha });
    expectFailClosed(result, "Comparator base SHA must be an ancestor of candidate SHA.");
  });

  it("rejects a manifest path that escapes the repository", () => {
    const result = invokeRunner({ manifest: "../outside-manifest.json" });
    expectFailClosed(result, "Comparator manifest path escapes the repository root.");
  });

  it("rejects evidence paths inside the candidate repository", () => {
    const evidenceDir = join(fixture.root, "refactor-evidence");
    const result = invokeRunner({ evidenceDir });
    expectFailClosed(result, "Evidence directory must be absolute and outside the repository/worktree.");
  });

  it("refuses to overwrite an existing evidence directory", () => {
    const evidenceDir = join(fixture.directory, "existing-evidence");
    mkdirSync(evidenceDir);
    writeFileSync(join(evidenceDir, "marker.txt"), "preserve\n");
    const result = invokeRunner({ evidenceDir });
    expectFailClosed(result, "Comparator evidence directory must be new; refusing to overwrite prior evidence.", true);
    expect(readFileSync(join(evidenceDir, "marker.txt"), "utf8")).toBe("preserve\n");
  });

  it("rejects evidence directories overlapping another registered worktree", () => {
    const linkedWorktree = join(fixture.directory, "linked-worktree");
    runGit(fixture.root, ["worktree", "add", "--quiet", "--detach", linkedWorktree, fixture.baseSha]);
    const evidenceDir = join(linkedWorktree, "new-evidence");
    const result = invokeRunner({ evidenceDir });
    expectFailClosed(result, "Comparator evidence directory must not overlap any existing Git worktree.");
  });

  it("rejects evidence directories inside the shared Git metadata directory", () => {
    const linkedWorktree = join(fixture.directory, "linked-worktree");
    runGit(fixture.root, ["worktree", "add", "--quiet", "--detach", linkedWorktree, fixture.baseSha]);
    const commonDir = resolve(linkedWorktree, runGit(linkedWorktree, ["rev-parse", "--git-common-dir"]));
    const evidenceDir = join(commonDir, "refactor-evidence");
    const result = invokeRunner({ cwd: linkedWorktree, evidenceDir });
    expectFailClosed(result, "Comparator evidence directory must be outside the shared Git metadata directory.");
  });
});
