import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CANDIDATE_IMAGE_ID, appState, bashAvailable, createFixture, runFixture } from "./helpers/production-release-cutover-fixture";

describe("terminal release publication and fail-closed route boundary", () => {
  it.skipIf(!bashAvailable)("commits a verified serving cutover despite a later nonfatal cleanup failure", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_IMAGE_RM: "1",
    });

    expect(result.status).toBe(0);
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: CANDIDATE_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain(`caddy-serving-sha:${fixture.candidateSha}`);
    expect(events).toContain("image-rm-failed");
    const servingAt = events.indexOf(`caddy-serving-sha:${fixture.candidateSha}`);
    expect(events.slice(servingAt)).not.toContain("caddy-active-config:maintenance");
    expect(result.stderr).toContain("POST-COMMIT CLEANUP WARNING");
    expect(appState(fixture)).toMatchObject({ status: "healthy", present: "true" });
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps a failed public candidate probe observational after commit", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CANDIDATE_PUBLIC_PROBE: "1",
    });

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("reverse_proxy bodycast-app-prod:3000");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(appState(fixture)).toMatchObject({ sha: fixture.candidateSha, status: "healthy", present: "true" });
    expect(result.stderr).toContain("public APP_HOST health probe did not confirm HTTP 200");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    const afterCommit = events.slice(events.lastIndexOf("atomic-live-route-replacement:bodycast.caddy"));
    expect(afterCommit).not.toContain("compose-stop-app");
    expect(afterCommit).not.toContain("compose-remove-app");
  }, 30_000);

});
