import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIOUS_SHA, PREVIOUS_IMAGE_ID, bashAvailable, createFixture, runFixture, appState } from "./helpers/production-release-cutover-fixture";

describe("maintenance confirmation gate", () => {
  for (const probeFailure of [
    { FAIL_MAINTENANCE_PROBE: "1" },
    { CURL_REDIRECT: "1" },
    { CURL_WRONG_MARKER: "1" },
    { CURL_NO_STORE_MISSING: "1" },
  ]) {
    const probeCase = Object.keys(probeFailure)[0];
    it.skipIf(!bashAvailable)("does not stop the old app when maintenance probe fails: " + probeCase, () => {
      const fixture = createFixture();
      const result = runFixture(fixture, "bash scripts/deploy.sh", {
        DEPLOY_SHA: fixture.candidateSha,
        BODYCAST_NON_SERVING_DEPLOY: "0",
        ...probeFailure,
      });

      expect(result.status).not.toBe(0);
      expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
      expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
      expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
      const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
      expect(dockerLog).not.toContain("stop --time 0 bodycast-app-prod");
      expect(dockerLog).not.toContain("up -d --no-deps --force-recreate app");
    }, 30_000);
  }
});
