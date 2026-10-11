import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_IMAGE_ID,
  bashAvailable,
  maintenanceRoute,
  createFixture,
  runFixtureAsync,
  appState,
} from "./helpers/production-release-cutover-fixture";

function prepareV4ActivationFixture(fixture: ReturnType<typeof createFixture>) {
  writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
  writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
  writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
  writeFileSync(path.join(fixture.root, "app-image-id"), `${CANDIDATE_IMAGE_ID}\n`);
  writeFileSync(path.join(fixture.root, "image-latest"), `${CANDIDATE_IMAGE_ID}\n`);
  writeFileSync(path.join(fixture.root, "app-status"), "healthy\n");
  const gitDir = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
  writeFileSync(path.join(gitDir, "bodycast-production-schema-cutover"),
    `schemaVersion=1\nmanifestId=active-energy-unified-v2\nreleaseSha=${fixture.candidateSha}\nstate=app-ready\n`);
}

describe("production V4 activation and cutover recovery", () => {
  it.skipIf(!bashAvailable)("holds one production lock through V3, V4 activation, postflight, and serving", async () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = await runFixtureAsync(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      APP_STARTING_HEALTH_SAMPLES: "2",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(path.join(fixture.root, "lock-count"), "utf8").trim()).toBe("1");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    const v3 = events.indexOf("unified-v3-postflight");
    const activation = events.indexOf("unified-v4-activation");
    const checks = events.map((event, index) => event === "unified-v4-check" ? index : -1).filter((index) => index >= 0);
    const firstStarting = events.indexOf("app-health-sample:starting");
    const healthy = events.indexOf("app-health-sample:healthy");
    const healthEndpoint = events.indexOf("candidate-health-endpoint");
    const serving = events.indexOf("live-route-mutation:serving");
    expect(v3).toBeGreaterThan(-1);
    expect(activation).toBeGreaterThan(v3);
    expect(checks.length).toBeGreaterThanOrEqual(2);
    expect(firstStarting).toBeGreaterThan(activation);
    expect(healthy).toBeGreaterThan(firstStarting);
    expect(healthEndpoint).toBeGreaterThan(healthy);
    expect(checks.at(-1)).toBeLessThan(serving);
    expect(healthEndpoint).toBeLessThan(checks.at(-1)!);
    expect(serving).toBeGreaterThan(activation);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("blocks V4 mutation when canonical main advances during final V3 postflight", async () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = await runFixtureAsync(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      ADVANCE_ON_FINAL_V3: "1",
    });

    expect(result.status).not.toBe(0);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("unified-v3-postflight");
    expect(events).toContain("v3-postflight:final");
    expect(events).toContain("main-advanced");
    const eventList = events.trim().split(/\r?\n/);
    const v3Postflight = eventList.indexOf("v3-postflight:final");
    const freshMainFetch = eventList.findIndex((event, index) => index > v3Postflight && event === "canonical-main-fetch");
    expect(freshMainFetch).toBeGreaterThan(v3Postflight);
    expect(events).not.toContain("unified-v4-activation");
    expect(events).not.toContain("live-route-mutation:serving");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("does no Docker or traffic mutation when the shared production lock is contended", async () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = await runFixtureAsync(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      LOCK_BUSY: "1",
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(path.join(fixture.root, "docker.log"))).toBe(false);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps maintenance and the migration marker after failed V4 activation", async () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = await runFixtureAsync(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      FAIL_V4_ACTIVATION: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    const gitDir = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
    expect(readFileSync(path.join(gitDir, "bodycast-production-schema-cutover"), "utf8")).toContain("state=app-ready");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("live-route-mutation:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("does not serve after V4 activation until the restarted exact-SHA app passes readiness", async () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = await runFixtureAsync(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      FAIL_CANDIDATE_LOCAL_HEALTH: "1",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("unified-v4-activation");
    expect(events).toContain("candidate-local-health-failed");
    expect(events.split("unified-v4-check")).toHaveLength(2);
    expect(events).not.toContain("live-route-mutation:serving");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(appState(fixture).sha).toBe(fixture.candidateSha);
    const gitDir = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
    expect(readFileSync(path.join(gitDir, "bodycast-production-schema-cutover"), "utf8")).toContain("state=app-ready");
  }, 30_000);

  it.skipIf(!bashAvailable)("preserves the V4 marker and maintenance when atomic serving-route replacement fails", async () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = await runFixtureAsync(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      FAIL_SERVING_ROUTE_PUBLISH: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(appState(fixture)).toMatchObject({ sha: fixture.candidateSha, status: "healthy", present: "true" });
    const gitDir = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
    expect(readFileSync(path.join(gitDir, "bodycast-production-schema-cutover"), "utf8")).toContain("state=v4-ready");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("serving-route-publish-failed");
  }, 30_000);
});
