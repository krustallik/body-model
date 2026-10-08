import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appState, bashAvailable, createFixture, runFixture } from "./helpers/production-release-cutover-fixture";

describe("maintenance operation Docker state certainty", () => {
  it.skipIf(!bashAvailable)("keeps Docker discovery errors UNKNOWN and never accepts them as absence", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      FAIL_DOCKER_PS: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("app presence is UNKNOWN, not absent");
    expect(appState(fixture)).toMatchObject({ status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("docker-ps-failed");
    expect(result.stdout).not.toContain("old app container is removed");
  }, 30_000);

  it.skipIf(!bashAvailable)("does not remove an app when Docker inspect leaves its state UNKNOWN", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      FAIL_DOCKER_APP_INSPECT: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("app state is UNKNOWN");
    expect(appState(fixture)).toMatchObject({ status: "exited", present: "true" });
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("rm --force app");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("fails closed when both Docker stop mechanisms fail", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      FAIL_COMPOSE_STOP: "1",
      FAIL_DOCKER_STOP: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toMatchObject({ status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("rm --force app");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("direct-app-stop-failed");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("does not report maintenance completion when Docker removal fails", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      FAIL_COMPOSE_RM: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toMatchObject({ status: "exited", present: "true" });
    expect(result.stdout).not.toContain("old app container is removed");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("compose-remove-app-failed");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);
});
