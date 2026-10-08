import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIOUS_SHA, PREVIOUS_IMAGE_ID, LATEST_IMAGE_ID, CANDIDATE_IMAGE_ID, WRONG_IMAGE_ID, bashAvailable, createFixture, runFixture, advanceMain, appState } from "./helpers/production-release-cutover-fixture";

describe("fallback production deploy rollback", () => {
  it.skipIf(!bashAvailable)("leaves the previous app and live route unchanged when the candidate is stale before maintenance", () => {
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
  }, 30_000);

  it.skipIf(!bashAvailable)("restores only the immutable release captured by this deploy attempt despite forged rollback env", () => {
    const fixture = createFixture();
    expect(readFileSync(path.join(fixture.root, "app-image-id"), "utf8").trim()).toBe(PREVIOUS_IMAGE_ID);
    expect(readFileSync(path.join(fixture.root, "image-latest"), "utf8").trim()).toBe(LATEST_IMAGE_ID);
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CANDIDATE_UP: "1",
      BODYCAST_ROLLBACK_SHA: "9".repeat(40),
      BODYCAST_ROLLBACK_IMAGE_ID: WRONG_IMAGE_ID,
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim(), `${result.stdout}\n${result.stderr}\n${readFileSync(path.join(fixture.root, "docker.log"), "utf8")}`).toBe("serving");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("reverse_proxy bodycast-app-prod:3000");
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).toContain(`image tag ${PREVIOUS_IMAGE_ID} bodycast-app:rollback`);
    expect(dockerLog).not.toContain("image tag bodycast-app:latest bodycast-app:rollback");
    expect(readFileSync(path.join(fixture.root, "image-latest"), "utf8").trim()).toBe(PREVIOUS_IMAGE_ID);
  }, 30_000);

  it.skipIf(!bashAvailable)("restores the exact previous release despite candidate becoming stale after replacement", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      ADVANCE_ONCE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim(), `${result.stdout}\n${result.stderr}\n${readFileSync(path.join(fixture.root, "docker.log"), "utf8")}`).toBe("serving");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("reverse_proxy bodycast-app-prod:3000");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("main-advanced");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    expect(events.lastIndexOf("unified-v4-check")).toBeLessThan(events.lastIndexOf("staged-route-validated"));
    expect(events.lastIndexOf("staged-route-validated")).toBeLessThan(events.lastIndexOf("live-route-mutation:serving"));
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps maintenance when rollback SHA matches but recreated image ID is wrong", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_CANDIDATE_UP: "1",
      ROLLBACK_CONTAINER_IMAGE_MISMATCH: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: WRONG_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("image tag bodycast-app:latest bodycast-app:rollback");
  }, 30_000);

  it.skipIf(!bashAvailable)("preserves explicit non-serving deployment semantics without reopening traffic", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "1",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}\n${readFileSync(path.join(fixture.root, "docker.log"), "utf8")}`).toBe(0);
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: CANDIDATE_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
  }, 30_000);
});
