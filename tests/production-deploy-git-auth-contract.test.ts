import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(".github/workflows/deploy-production.yml"), "utf8").replace(/\r\n/g, "\n");

describe("production checkout GitHub authentication contract", () => {
  it("uses the root-only read-only deploy key only for canonical SSH origin before fetching", () => {
    const originCheck = workflow.indexOf('ORIGIN_URL="$(git remote get-url origin)"');
    const keyPath = workflow.indexOf('GITHUB_DEPLOY_KEY="/root/.ssh/bodycast_github_deploy"');
    const identity = workflow.indexOf("export GIT_SSH_COMMAND=");
    const readProbe = workflow.indexOf("git ls-remote origin refs/heads/main >/dev/null");
    const candidateFetch = workflow.indexOf('git fetch --no-tags origin "$DEPLOY_SHA"');

    expect(originCheck).toBeGreaterThan(-1);
    expect(keyPath).toBeGreaterThan(originCheck);
    expect(identity).toBeGreaterThan(keyPath);
    expect(readProbe).toBeGreaterThan(identity);
    expect(candidateFetch).toBeGreaterThan(readProbe);
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).toContain('"$(stat -c \'%u\' "$GITHUB_DEPLOY_KEY")" == "0"');
    expect(workflow).toContain('git@github.com:krustallik/body-model.git|https://github.com/krustallik/body-model.git');
  });
});
