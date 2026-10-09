import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIOUS_SHA, PREVIOUS_IMAGE_ID, CANDIDATE_IMAGE_ID, WRONG_IMAGE_ID, bashAvailable, toBashPath, maintenanceRoute, createFixture, runFixture, appState } from "./helpers/production-release-cutover-fixture";

function prepareV4ActivationFixture(fixture: ReturnType<typeof createFixture>) {
  writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
  writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
  writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
  writeFileSync(path.join(fixture.root, "app-image-id"), `${CANDIDATE_IMAGE_ID}\n`);
  writeFileSync(path.join(fixture.root, "image-latest"), `${CANDIDATE_IMAGE_ID}\n`);
  writeFileSync(path.join(fixture.root, "app-status"), "healthy\n");
  const gitDir = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
  writeFileSync(path.join(gitDir, "bodycast-production-schema-cutover"),
    `schemaVersion=1\nmanifestId=active-energy-unified-v2\nreleaseSha=${fixture.candidateSha}\nstate=app-ready\n`);
}

describe("fallback production traffic cutover freshness and recovery", () => {
  it.skipIf(!bashAvailable)("holds one production lock through V3, V4 activation, postflight, and serving", () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(path.join(fixture.root, "lock-count"), "utf8").trim()).toBe("1");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    const v3 = events.indexOf("unified-v3-postflight");
    const activation = events.indexOf("unified-v4-activation");
    const checks = events.map((event, index) => event === "unified-v4-check" ? index : -1).filter((index) => index >= 0);
    const serving = events.indexOf("live-route-mutation:serving");
    expect(v3).toBeGreaterThan(-1);
    expect(activation).toBeGreaterThan(v3);
    expect(checks.length).toBeGreaterThanOrEqual(2);
    expect(checks.at(-1)).toBeLessThan(serving);
    expect(serving).toBeGreaterThan(activation);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("blocks V4 mutation when canonical main advances after V3", () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      ADVANCE_ON_V3: "1",
    });

    expect(result.status).not.toBe(0);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("unified-v3-postflight");
    expect(events).toContain("main-advanced");
    expect(events).not.toContain("unified-v4-activation");
    expect(events).not.toContain("live-route-mutation:serving");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("does no Docker or traffic mutation when the shared production lock is contended", () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      LOCK_BUSY: "1",
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(path.join(fixture.root, "docker.log"))).toBe(false);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps maintenance and the migration marker after failed V4 activation", () => {
    const fixture = createFixture();
    prepareV4ActivationFixture(fixture);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh activate-v4-and-serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      FAIL_V4_ACTIVATION: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    const gitDir = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
    expect(readFileSync(path.join(gitDir, "bodycast-production-schema-cutover"), "utf8")).toContain("state=app-ready");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("live-route-mutation:serving");
  }, 30_000);

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

  it.skipIf(!bashAvailable)("does not invoke a legacy authority shim for the fixed traffic operation", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
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
      HOST_CLIENT_LOG: toBashPath(hostClientLog),
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(hostClientLog)).toBe(false);
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).toContain("unified-v4-traffic-check.mjs");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("live-route-mutation:serving");
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
