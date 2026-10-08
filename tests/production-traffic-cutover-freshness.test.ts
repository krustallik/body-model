import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIOUS_SHA, PREVIOUS_IMAGE_ID, WRONG_IMAGE_ID, bashAvailable, toBashPath, maintenanceRoute, createFixture, runFixture, appState } from "./helpers/production-release-cutover-fixture";

describe("fallback production traffic cutover freshness and recovery", () => {
  it.skipIf(!bashAvailable)("uses an absolute real Git binary for fixture shim passthrough", () => {
    const fixture = createFixture();
    const fixtureGitShim = path.join(fixture.root, "bin", process.platform === "win32" ? "git.exe" : "git");

    expect(path.isAbsolute(fixture.realGit)).toBe(true);
    expect(path.resolve(fixture.realGit).toLowerCase()).not.toBe(path.resolve(fixtureGitShim).toLowerCase());

    const result = runFixture(fixture, "git --version");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/^git version /m);
  });

  it.skipIf(!bashAvailable)("rejects the filesystem root as the live routes directory before Docker access", () => {
    const fixture = createFixture();
    const before = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      CADDY_ROUTES_PATH: "/",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CADDY_ROUTES_PATH may not resolve to the filesystem root.");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(before);
    expect(existsSync(path.join(fixture.root, "docker.log"))).toBe(false);
  }, 30_000);

  it.skipIf(!bashAvailable)("does not stop the old app when maintenance cannot be confirmed after reload failure", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);

    const serving = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
    });
    expect(serving.status).toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });

    const failedDeploy = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      FAIL_MAINTENANCE_RELOAD: "1",
    });

    expect(failedDeploy.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain(
      'respond "BodyCast is temporarily unavailable while the model is updated." 503',
    );
    // Without the exact public maintenance response, the fallback deploy must
    // leave the old app running and refuse to start/replace a candidate.
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(appState(fixture)).toMatchObject({ sha: fixture.candidateSha, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "app-restart"), "utf8").trim()).toBe("always");
    const docker = path.join(fixture.root, "docker.log");
    expect(readFileSync(docker, "utf8")).not.toContain("stop --time 0 bodycast-app-prod");
    expect(readFileSync(docker, "utf8")).not.toContain("rm --force app");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    expect(events).toContain("live-route-mutation:maintenance");
    expect(events).toContain("caddy-reload-failed:maintenance");
    expect(events.some((event) => event.startsWith("public-probe:200:https://bodycast.example.test/"))).toBe(true);
    expect(events).not.toContain("direct-app-stop");
    expect(events).not.toContain("compose-remove-app");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(runFixture(fixture, "curl --fail https://bodycast.example.test/api/health").status).toBe(0);
  }, 30_000);

  it.skipIf(!bashAvailable)("refuses public rollback mode even with caller-selected historical SHA and image", () => {
    const fixture = createFixture();
    const beforeRoute = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh rollback-previous", {
      BODYCAST_ROLLBACK_SHA: "9".repeat(40),
      BODYCAST_ROLLBACK_IMAGE_ID: WRONG_IMAGE_ID,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Usage:");
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(beforeRoute);
    expect(existsSync(path.join(fixture.root, "docker.log"))).toBe(false);
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps the installed host-operation client boundary for supported traffic operations", () => {
    const fixture = createFixture();
    const hostClient = path.join(fixture.root, "bodycast-production-operation");
    const hostClientLog = path.join(fixture.root, "host-operation.log");
    writeFileSync(hostClient, "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$HOST_CLIENT_LOG\"\nexit 47\n", { mode: 0o755 });
    const trafficScriptPath = path.join(fixture.repo, "scripts", "production-traffic-cutover.sh");
    const trafficScript = readFileSync(trafficScriptPath, "utf8");
    writeFileSync(trafficScriptPath, trafficScript.replace(
      'HOST_OPERATION_CLIENT="/usr/local/bin/bodycast-production-operation"',
      `HOST_OPERATION_CLIENT="${toBashPath(hostClient)}"`,
    ));

    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_AUTHORIZATION_WORKFLOW_ID: "1",
      BODYCAST_AUTHORIZATION_RUN_ID: "2",
      BODYCAST_AUTHORIZATION_RUN_ATTEMPT: "1",
      HOST_CLIENT_LOG: toBashPath(hostClientLog),
    });

    expect(result.status).toBe(47);
    expect(readFileSync(hostClientLog, "utf8")).toContain("traffic-serve");
    expect(existsSync(path.join(fixture.root, "docker.log"))).toBe(false);
  }, 30_000);

  it.skipIf(!bashAvailable)("blocks serving when main advances during the final V4 child check", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
    const before = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
      ADVANCE_ONCE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(before);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("caddy reload");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("live-route-mutation:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("blocks the route write when main advances at its final freshness fence", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
    const before = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
      ADVANCE_ONCE: "1",
      ADVANCE_ON_MAIN_FETCH: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(before);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("caddy reload");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("staged-route-validated");
    expect(events).toContain("main-advanced");
    expect(events).not.toContain("live-route-mutation:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("stages candidate bytes away from the live route and rejects them if main advances before atomic publish", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
    const before = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
      ADVANCE_ON_VALIDATE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(before);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("caddy reload");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    expect(events.indexOf("live-route-before-validate:maintenance")).toBeLessThan(events.indexOf("staged-route-validated"));
    expect(events.indexOf("staged-route-validated")).toBeLessThan(events.indexOf("main-advanced"));
    expect(events).not.toContain("live-route-mutation:serving");
  }, 30_000);


});
