import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bashAvailable, maintenanceRoute, createFixture, runFixture, stagedCandidatePath, assertStageOutsideLiveRoutes, assertNoWatcherServingBeforeAtomicPublish } from "./helpers/production-release-cutover-fixture";

describe("serving-route commit boundary", () => {
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
    expect(events.filter((event) => event === "caddy-active-config:serving")).toHaveLength(1);
    expect(events.indexOf("atomic-live-route-replacement:bodycast.caddy"))
      .toBeLessThan(events.indexOf("caddy-reload:serving"));
    expect(events.indexOf("caddy-reload:serving"))
      .toBeLessThan(events.indexOf("caddy-active-config:serving"));
    expect(events.indexOf("live-route-before-validate:maintenance")).toBeLessThan(events.indexOf("canonical-main-fetch"));
    expect(events.indexOf("canonical-main-fetch")).toBeLessThan(events.indexOf("live-route-mutation:serving"));
    expect(events.indexOf("live-route-mutation:serving")).toBeLessThan(events.indexOf("caddy-reload:serving"));
  }, 30_000);

  it.skipIf(!bashAvailable)("returns success after route commit if explicit reload fails and Caddy still serves maintenance", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), fixture.candidateSha + "\n");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
      FAIL_SERVING_RELOAD: "1",
    });

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("reverse_proxy bodycast-app-prod:3000");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(result.stderr).toContain("route state was not rolled back");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("stop --time 0 bodycast-app-prod");
  }, 30_000);

  it.skipIf(!bashAvailable)("returns success after route commit if auto-watch serves candidate before a failed reload", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), fixture.candidateSha + "\n");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
      CADDY_AUTO_WATCH: "1",
      FAIL_SERVING_RELOAD: "1",
    });

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("reverse_proxy bodycast-app-prod:3000");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("auto-watch-serving-effect");
    expect(events).toContain("caddy-reload-failed:serving");
    expect(result.stderr).toContain("POST-COMMIT VERIFICATION WARNING");
  }, 30_000);

  it.skipIf(!bashAvailable)("fails the watcher-safety invariant if candidate staging moves under the live routes directory", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);

    const primitivesPath = path.join(fixture.repo, "scripts", "production-route-primitives.sh");
    const primitives = readFileSync(primitivesPath, "utf8");
    const safeStage = 'temporary="$(mktemp "${route_parent}/.bodycast-route-stage.XXXXXX")"';
    const unsafeStage = 'temporary="$(mktemp "${CADDY_ROUTES_PATH}/.bodycast-route-stage.XXXXXX")"';
    expect(primitives).toContain(safeStage);
    const servingStageAt = primitives.indexOf("bodycast_stage_serving_route_config() {");
    const beforeServingStage = primitives.slice(0, servingStageAt);
    const servingStage = primitives.slice(servingStageAt);
    expect(servingStage).toContain(safeStage);
    writeFileSync(primitivesPath, beforeServingStage + servingStage.replace(safeStage, unsafeStage));

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
});
