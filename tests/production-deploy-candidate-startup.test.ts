import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIOUS_SHA, PREVIOUS_IMAGE_ID, CANDIDATE_IMAGE_ID, bashAvailable, createFixture, runFixture, appState } from "./helpers/production-release-cutover-fixture";

describe("maintenance-first candidate startup and identity failures", () => {
  it.skipIf(!bashAvailable)("keeps the prior release stopped and maintenance active when candidate startup fails after a release marker appears", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CANDIDATE_UP: "1",
      ADD_MARKER_ON_CANDIDATE_FAILURE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "exited", present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(readFileSync(path.join(fixture.repo, ".git", "bodycast-production-schema-cutover"), "utf8"))
      .toContain("state=ddl-started");
    expect(readFileSync(path.join(fixture.root, "image-rollback"), "utf8").trim()).toBe(PREVIOUS_IMAGE_ID);
    expect(result.stderr).toContain("operator recovery");
  }, 30_000);

  it.skipIf(!bashAvailable)("stops a candidate that fails its local health check without opening traffic", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CANDIDATE_LOCAL_HEALTH: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: CANDIDATE_IMAGE_ID, status: "exited", present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("live-route-mutation:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("leaves an exact-SHA-mismatched running container behind maintenance for operator intervention", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      CANDIDATE_CONTAINER_SHA_MISMATCH: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: CANDIDATE_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(result.stderr).toContain("Candidate cleanup blocked: the present app is not the exact candidate");
  }, 30_000);
});
