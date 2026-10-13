import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIOUS_SHA, PREVIOUS_IMAGE_ID, CANDIDATE_IMAGE_ID, WRONG_IMAGE_ID, bashAvailable, createFixture, runFixture, advanceMain, appState } from "./helpers/production-release-cutover-fixture";

describe("fallback maintenance-first production deploy", () => {
  it.skipIf(!bashAvailable)("leaves the previous app and live route untouched when the candidate is stale before maintenance", () => {
    const fixture = createFixture();
    advanceMain(fixture);
    const before = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(before);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("live-route-mutation:maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("does not auto-restore an unprovable prior runtime after candidate startup fails", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CANDIDATE_UP: "1",
      BODYCAST_ROLLBACK_SHA: "9".repeat(40),
      BODYCAST_ROLLBACK_IMAGE_ID: WRONG_IMAGE_ID,
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "exited", present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(readFileSync(path.join(fixture.root, "image-deploy-rollback"), "utf8").trim()).toBe(PREVIOUS_IMAGE_ID);
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog.split(/\r?\n/).filter((line) => line.includes("up -d --no-deps --force-recreate app"))).toHaveLength(1);
    expect(result.stderr).toContain("Automatic prior-app restoration is disabled");
    expect(result.stderr).toContain("operator recovery");
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps maintenance and stops the exact candidate if main advances before the serving commit", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      ADVANCE_ONCE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: CANDIDATE_IMAGE_ID, status: "exited", present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("main-advanced");
    expect(events).not.toContain("live-route-mutation:serving");
    expect(events).not.toContain("caddy-serving-sha:" + fixture.candidateSha);
  }, 30_000);

  it.skipIf(!bashAvailable)("leaves an identity-mismatched candidate behind maintenance for operator intervention", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      CANDIDATE_CONTAINER_IMAGE_MISMATCH: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: WRONG_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(result.stderr).toContain("Candidate cleanup blocked: the present app is not the exact candidate");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("live-route-mutation:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("preserves explicit non-serving deployment without reopening traffic", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.repo, ".git", "bodycast-production-schema-cutover"), [
      "schemaVersion=1",
      "manifestId=active-energy-unified-v2",
      `releaseSha=${fixture.candidateSha}`,
      "state=schema-applied",
      "",
    ].join("\n"), { mode: 0o600 });
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "1",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}\n${readFileSync(path.join(fixture.root, "docker.log"), "utf8")}`).toBe(0);
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: CANDIDATE_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(result.stdout).toContain("Exact SHA is deployed in confirmed maintenance");
  }, 30_000);
});
