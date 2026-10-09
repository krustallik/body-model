import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CANDIDATE_IMAGE_ID, WRONG_IMAGE_ID, bashAvailable, createFixture, runFixture, appState } from "./helpers/production-release-cutover-fixture";

describe("maintenance-first candidate verification failures", () => {
  it.skipIf(!bashAvailable)("stops a candidate when the final read-only schema check fails", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_SECOND_SCHEMA_PREFLIGHT: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: CANDIDATE_IMAGE_ID, status: "exited", present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8").match(/schema-preflight-no-deps/g)).toHaveLength(2);
  }, 30_000);

  it.skipIf(!bashAvailable)("stops a candidate when Unified V4 currentness fails before route commit", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_FINAL_V4_CHECK: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: CANDIDATE_IMAGE_ID, status: "exited", present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8").match(/unified-v4-check/g)).toHaveLength(2);
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps an unexpected release marker and maintenance after candidate health but before serving", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      ADD_MARKER_AFTER_CANDIDATE_START: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: CANDIDATE_IMAGE_ID, status: "exited", present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(readFileSync(path.join(fixture.repo, ".git", "bodycast-production-schema-cutover"), "utf8"))
      .toContain("state=ddl-started");
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps an image-identity-mismatched candidate behind maintenance without stopping an unverified container", () => {
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
  }, 30_000);
});
