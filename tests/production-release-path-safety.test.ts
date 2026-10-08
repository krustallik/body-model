import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bashAvailable, createFixture, runFixture, toBashPath } from "./helpers/production-release-cutover-fixture";

describe("production release route path safety", () => {
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
});
