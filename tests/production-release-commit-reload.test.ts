import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appState, bashAvailable, createFixture, runFixture } from "./helpers/production-release-cutover-fixture";

describe("post-commit serving reload behavior", () => {
  it.skipIf(!bashAvailable)("treats live-route replacement as committed when explicit Caddy reload fails", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_SERVING_RELOAD: "1",
    });

    expect(result.status).toBe(0);
    expect(appState(fixture)).toMatchObject({ sha: fixture.candidateSha, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("reverse_proxy bodycast-app-prod:3000");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("caddy-reload-failed:serving");
    expect(events).not.toContain(`caddy-serving-sha:${fixture.candidateSha}`);
    expect(events).toContain("atomic-live-route-replacement:bodycast.caddy");
    expect(result.stderr).toContain("committed route was not rolled back");
    const afterCommit = events.slice(events.lastIndexOf("atomic-live-route-replacement:bodycast.caddy"));
    expect(afterCommit).not.toContain("compose-stop-app");
    expect(afterCommit).not.toContain("compose-remove-app");
  }, 30_000);

  it.skipIf(!bashAvailable)("allows auto-watch to serve at the route commit and treats later reload failure as nonfatal", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      CADDY_AUTO_WATCH: "1",
      FAIL_SERVING_RELOAD: "1",
    });

    expect(result.status).toBe(0);
    expect(appState(fixture)).toMatchObject({ sha: fixture.candidateSha, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("auto-watch-serving-effect");
    expect(events).toContain("caddy-reload-failed:serving");
    expect(result.stderr).toContain("committed route was not rolled back");
  }, 30_000);
});
