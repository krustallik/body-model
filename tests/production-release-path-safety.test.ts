import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bashAvailable, createFixture, runFixture } from "./helpers/production-release-cutover-fixture";

describe("direct SSH-script production release path safety", () => {
  it.skipIf(!bashAvailable)("rejects unsafe route roots before Docker or Git freshness operations", () => {
    for (const invalidPath of ["/", "/./", "//", "/../"]) {
      const fixture = createFixture();
      const result = runFixture(fixture, "bash scripts/deploy.sh", {
        DEPLOY_SHA: fixture.candidateSha,
        CADDY_ROUTES_PATH: invalidPath,
      });

      expect(result.status, `path ${invalidPath}`).not.toBe(0);
      expect(result.stderr).toContain("CADDY_ROUTES_PATH may not resolve to the filesystem root.");
      expect(existsSync(path.join(fixture.root, "docker.log"))).toBe(false);
      expect(existsSync(path.join(fixture.root, "events.log"))).toBe(false);
    }
  }, 30_000);

  it.skipIf(!bashAvailable)("runs the fixed exact-SHA deploy script without a host authority installation", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(readFileSync(path.join(fixture.root, "app-sha"), "utf8").trim()).toBe(fixture.candidateSha);
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).toContain("build app");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("up -d db");
  }, 30_000);

  it.skipIf(!bashAvailable)("rejects unsafe route roots at the direct traffic entrypoint before Docker", () => {
    for (const invalidPath of ["/", "/./", "//", "/../"]) {
      const fixture = createFixture();
      const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
        CADDY_ROUTES_PATH: invalidPath,
      });

      expect(result.status, `path ${invalidPath}`).not.toBe(0);
      expect(result.stderr).toContain("CADDY_ROUTES_PATH may not resolve to the filesystem root.");
      expect(existsSync(path.join(fixture.root, "docker.log"))).toBe(false);
      expect(existsSync(path.join(fixture.root, "events.log"))).toBe(false);
    }
  }, 30_000);

  it.skipIf(!bashAvailable)("performs maintenance and writer drain directly when no authority service is installed", () => {
    const fixture = createFixture();
    const routePath = path.join(fixture.routes, "bodycast.caddy");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(routePath, "utf8")).toContain(
      'respond "BodyCast is temporarily unavailable while the model is updated." 503',
    );
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.root, "app-present"), "utf8").trim()).toBe("false");
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).toContain("stop app");
    expect(dockerLog).not.toContain("up -d db");
    expect(result.stdout).toContain("PostgreSQL writers are drained");
  }, 30_000);
});
