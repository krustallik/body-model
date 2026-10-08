import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIOUS_SHA, PREVIOUS_IMAGE_ID, WRONG_IMAGE_ID, bashAvailable, toBashPath, maintenanceRoute, createFixture, runFixture, stagedCandidatePath, assertStageOutsideLiveRoutes, assertNoWatcherServingBeforeAtomicPublish, appState } from "./helpers/production-release-cutover-fixture";

describe("fallback production traffic cutover freshness and recovery", () => {
  it.skipIf(!bashAvailable)("serves the exact candidate when canonical main remains unchanged", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("reverse_proxy bodycast-app-prod:3000");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    const stagePath = stagedCandidatePath(fixture);
    assertStageOutsideLiveRoutes(fixture.routes, stagePath);
    expect(events).toContain(`watch-ignored-outside-live-routes:${path.posix.basename(stagePath)}`);
    assertNoWatcherServingBeforeAtomicPublish(events);
    expect(events.filter((event) => event.startsWith("watch-serving-effect:"))).toHaveLength(1);
    expect(events.indexOf("atomic-live-route-replacement:bodycast.caddy"))
      .toBeLessThan(events.indexOf("watch-serving-effect:bodycast.caddy"));
    expect(events.indexOf("live-route-before-validate:maintenance")).toBeLessThan(events.indexOf("canonical-main-fetch"));
    expect(events.indexOf("canonical-main-fetch")).toBeLessThan(events.indexOf("live-route-mutation:serving"));
    expect(events.indexOf("live-route-mutation:serving")).toBeLessThan(events.indexOf("caddy-reload"));
  }, 30_000);

  it.skipIf(!bashAvailable)("fails the watcher-safety invariant if candidate staging moves under the live routes directory", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);

    const operationsPath = path.join(fixture.repo, "scripts", "production-route-operations.sh");
    const operations = readFileSync(operationsPath, "utf8");
    const safeStage = 'temporary="$(mktemp "${route_parent}/.bodycast-route-stage.XXXXXX")"';
    const unsafeStage = 'temporary="$(mktemp "${CADDY_ROUTES_PATH}/.bodycast-route-stage.XXXXXX")"';
    expect(operations).toContain(safeStage);
    writeFileSync(operationsPath, operations.replace(safeStage, unsafeStage));

    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
      ADVANCE_ON_VALIDATE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(maintenanceRoute());
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    expect(events.some((event) => event.startsWith("watch-live-file-created:.bodycast-route-stage."))).toBe(true);
    expect(events.some((event) => event.startsWith("watch-live-file-change:.bodycast-route-stage."))).toBe(true);
    expect(events.some((event) => event.startsWith("watch-serving-effect:.bodycast-route-stage."))).toBe(true);
    expect(events).not.toContain("atomic-live-route-replacement:bodycast.caddy");
    expect(() => assertNoWatcherServingBeforeAtomicPublish(events))
      .toThrow("Caddy watcher served staged candidate bytes before atomic live-route replacement.");
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
