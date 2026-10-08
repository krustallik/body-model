import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CANDIDATE_IMAGE_ID, appState, bashAvailable, createFixture, runFixture, toBashPath } from "./helpers/production-release-cutover-fixture";

describe("terminal release publication and fail-closed route boundary", () => {
  it.skipIf(!bashAvailable)("rejects canonical-root aliases through deploy before Docker, Git freshness, or host-broker effects", () => {
    for (const invalidPath of ["/", "/./", "//", "/../"]) {
      const fixture = createFixture();
      const hostClient = path.join(fixture.root, "bodycast-production-operation");
      const hostClientLog = path.join(fixture.root, "host-operation.log");
      writeFileSync(hostClient, "#!/usr/bin/env bash\nprintf '%s\\n' called >> \"$HOST_CLIENT_LOG\"\n", { mode: 0o755 });
      const deployScriptPath = path.join(fixture.repo, "scripts", "deploy.sh");
      const deployScript = readFileSync(deployScriptPath, "utf8");
      writeFileSync(deployScriptPath, deployScript.replace(
        'HOST_OPERATION_CLIENT="/usr/local/bin/bodycast-production-operation"',
        `HOST_OPERATION_CLIENT="${toBashPath(hostClient)}"`,
      ));

      const result = runFixture(fixture, "bash scripts/deploy.sh", {
        DEPLOY_SHA: fixture.candidateSha,
        CADDY_ROUTES_PATH: invalidPath,
        HOST_CLIENT_LOG: toBashPath(hostClientLog),
      });

      expect(result.status, `path ${invalidPath}`).not.toBe(0);
      expect(result.stderr, `path ${invalidPath}`).toContain("CADDY_ROUTES_PATH may not resolve to the filesystem root.");
      expect(existsSync(path.join(fixture.root, "docker.log")), `Docker for ${invalidPath}`).toBe(false);
      expect(existsSync(path.join(fixture.root, "events.log")), `Git/Caddy events for ${invalidPath}`).toBe(false);
      expect(existsSync(hostClientLog), `host broker for ${invalidPath}`).toBe(false);
    }
  }, 30_000);

  it.skipIf(!bashAvailable)("allows a dedicated canonical routes directory through the deploy entrypoint", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
    });

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain(`caddy-serving-sha:${fixture.candidateSha}`);
  }, 30_000);

  it.skipIf(!bashAvailable)("rejects canonical-root aliases at the direct traffic entrypoint before host or Docker access", () => {
    for (const invalidPath of ["/", "/./", "//", "/../"]) {
      const fixture = createFixture();
      const hostClient = path.join(fixture.root, "bodycast-production-operation");
      const hostClientLog = path.join(fixture.root, "host-operation.log");
      writeFileSync(hostClient, "#!/usr/bin/env bash\nprintf '%s\\n' called >> \"$HOST_CLIENT_LOG\"\n", { mode: 0o755 });
      const trafficScriptPath = path.join(fixture.repo, "scripts", "production-traffic-cutover.sh");
      const trafficScript = readFileSync(trafficScriptPath, "utf8");
      writeFileSync(trafficScriptPath, trafficScript.replace(
        'HOST_OPERATION_CLIENT="/usr/local/bin/bodycast-production-operation"',
        `HOST_OPERATION_CLIENT="${toBashPath(hostClient)}"`,
      ));

      const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
        CADDY_ROUTES_PATH: invalidPath,
        HOST_CLIENT_LOG: toBashPath(hostClientLog),
      });

      expect(result.status, `path ${invalidPath}`).not.toBe(0);
      expect(result.stderr, `path ${invalidPath}`).toContain("CADDY_ROUTES_PATH may not resolve to the filesystem root.");
      expect(existsSync(path.join(fixture.root, "docker.log")), `Docker for ${invalidPath}`).toBe(false);
      expect(existsSync(hostClientLog), `host broker for ${invalidPath}`).toBe(false);
    }
  }, 30_000);

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

  it.skipIf(!bashAvailable)("keeps maintenance active when the final candidate Caddy load fails", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_SERVING_RELOAD: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toMatchObject({ sha: fixture.candidateSha, status: "exited", present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("caddy-reload-failed:serving");
    expect(events).not.toContain(`caddy-serving-sha:${fixture.candidateSha}`);
    expect(events.slice(events.indexOf("caddy-reload-failed:serving"))).toContain("caddy-active-config:maintenance");
  }, 30_000);

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
    expect(result.stderr).toContain("Non-fatal rollback image cleanup failed");
  }, 30_000);

});
