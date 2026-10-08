import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIOUS_SHA, PREVIOUS_IMAGE_ID, bashAvailable, createFixture, runFixture, appState } from "./helpers/production-release-cutover-fixture";

describe("fail-closed deploy rollback checks", () => {
  it.skipIf(!bashAvailable)("keeps maintenance when a release marker appears during the failed deploy attempt", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CANDIDATE_UP: "1",
      ADD_MARKER_ON_CANDIDATE_FAILURE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(readFileSync(path.join(fixture.repo, ".git", "bodycast-production-schema-cutover"), "utf8"))
      .toContain("state=ddl-started");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("live-route-mutation:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps maintenance when the rollback V4 gate fails", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CANDIDATE_UP: "1",
      FAIL_ROLLBACK_V4: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("unified-v4-check");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("live-route-mutation:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("returns to maintenance if the restored previous app fails its routed health check", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CANDIDATE_UP: "1",
      FAIL_ROLLBACK_HEALTH: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("live-route-mutation:serving");
    expect(events).toContain("live-route-mutation:maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("does not recreate the prior app unless maintenance cutover succeeds", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CADDY_RELOAD: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).not.toContain("up -d --no-deps --force-recreate app");
  }, 30_000);


});
