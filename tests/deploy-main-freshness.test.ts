import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function findBash(): string | null {
  const probe = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (!probe.error && probe.status === 0) return "bash";
  if (process.platform !== "win32") return null;

  const where = spawnSync("where.exe", ["git"], { encoding: "utf8" });
  const gitExe = where.stdout.split(/\r?\n/).find((entry) => entry.toLowerCase().endsWith("\\git.exe"));
  if (!gitExe) return null;
  const gitBash = path.resolve(path.dirname(gitExe), "..", "bin", "bash.exe");
  return existsSync(gitBash) ? gitBash : null;
}

function createRemoteFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "bodycast-main-freshness-"));
  temporaryRoots.push(root);
  const remote = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], { stdio: "ignore" });
  execFileSync("git", ["init", "--initial-branch=main", repo], { stdio: "ignore" });
  runGit(repo, "config", "user.name", "Freshness fixture");
  runGit(repo, "config", "user.email", "freshness@example.invalid");
  runGit(repo, "remote", "add", "origin", remote);
  writeFileSync(path.join(repo, "fixture.txt"), "candidate\n");
  runGit(repo, "add", "fixture.txt");
  runGit(repo, "commit", "-m", "initial main");
  runGit(repo, "push", "--set-upstream", "origin", "main");
  const candidate = runGit(repo, "rev-parse", "HEAD");
  runGit(repo, "fetch", "--no-tags", "origin", "refs/heads/main:refs/remotes/origin/main");
  copyFileSync(path.resolve("scripts/deploy-main-freshness.sh"), path.join(repo, "deploy-main-freshness.sh"));
  return { root, repo, candidate };
}

function runFreshnessFence(repo: string, candidate: string, effectName: string) {
  const bash = findBash();
  if (!bash) throw new Error("A Bash runtime is required for the deploy freshness fixture.");
  const result = spawnSync(bash, ["--noprofile", "--norc", "-euo", "pipefail", "-c",
    'source ./deploy-main-freshness.sh; bodycast_assert_current_main_sha "$CANDIDATE"; : > "$EFFECT_PATH"'], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, CANDIDATE: candidate, EFFECT_PATH: effectName },
  });
  return result;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("server-side current-main freshness fence", () => {
  const bashAvailable = findBash() !== null;

  it.skipIf(!bashAvailable)("allows the effect when candidate remains canonical main", () => {
    const fixture = createRemoteFixture();
    const effect = path.join(fixture.repo, "app-recreated");
    const result = runFreshnessFence(fixture.repo, fixture.candidate, "app-recreated");

    expect(result.status).toBe(0);
    expect(existsSync(effect)).toBe(true);
  });

  it.skipIf(!bashAvailable)("blocks a stale candidate without recording an app or traffic effect", () => {
    const fixture = createRemoteFixture();
    writeFileSync(path.join(fixture.repo, "fixture.txt"), "advanced main\n");
    runGit(fixture.repo, "add", "fixture.txt");
    runGit(fixture.repo, "commit", "-m", "advance main");
    runGit(fixture.repo, "push", "origin", "main");

    const appEffect = path.join(fixture.repo, "app-recreated");
    const trafficEffect = path.join(fixture.repo, "traffic-served");
    const result = runFreshnessFence(fixture.repo, fixture.candidate, "app-recreated");
    if (result.status === 0) writeFileSync(trafficEffect, "served\n");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing stale release SHA");
    expect(existsSync(appEffect)).toBe(false);
    expect(existsSync(trafficEffect)).toBe(false);
  });

  it.skipIf(!bashAvailable)("rechecks after SSH starts and blocks before app recreate when main advances", () => {
    const fixture = createRemoteFixture();
    const sshStarted = path.join(fixture.repo, "ssh-started");
    const initialFence = runFreshnessFence(fixture.repo, fixture.candidate, "ssh-started");
    expect(initialFence.status).toBe(0);
    expect(existsSync(sshStarted)).toBe(true);

    writeFileSync(path.join(fixture.repo, "fixture.txt"), "advanced during SSH\n");
    runGit(fixture.repo, "add", "fixture.txt");
    runGit(fixture.repo, "commit", "-m", "advance main during deploy");
    runGit(fixture.repo, "push", "origin", "main");

    const appEffect = path.join(fixture.repo, "app-recreated");
    const result = runFreshnessFence(fixture.repo, fixture.candidate, "app-recreated");
    expect(result.status).not.toBe(0);
    expect(existsSync(appEffect)).toBe(false);
  });
});
