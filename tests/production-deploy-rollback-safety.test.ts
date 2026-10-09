import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIOUS_SHA, PREVIOUS_IMAGE_ID, bashAvailable, createFixture, runFixture, appState } from "./helpers/production-release-cutover-fixture";

describe("maintenance-first deploy fail-closed checks", () => {
  it.skipIf(!bashAvailable)("confirms the attempt-marked 503 before capturing and stopping the previous app", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
    });

    expect(result.status).toBe(0);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    const maintenanceProbeAt = events.findIndex((event) => event.startsWith("public-probe:503:https://bodycast.example.test/"));
    const captureAt = events.indexOf("capture-app-container-id");
    const stopAt = events.indexOf("compose-stop-app");
    expect(maintenanceProbeAt).toBeGreaterThan(-1);
    expect(captureAt).toBeGreaterThan(maintenanceProbeAt);
    expect(stopAt).toBeGreaterThan(captureAt);
    expect(events).toContain("schema-preflight-no-deps");
    expect(events).not.toContain("forbidden-db-start");
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).not.toContain("up -d db");
    expect(dockerLog).toContain("run --rm --no-deps --entrypoint npx migrate prisma migrate status");
  }, 30_000);

  it.skipIf(!bashAvailable)("fails before maintenance when the existing DB is unavailable", () => {
    const fixture = createFixture();
    const beforeRoute = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      FAIL_DB_INSPECT: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("deploy will not start it");
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(beforeRoute);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("up -d db");
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps Docker discovery failures UNKNOWN after maintenance and never assumes old-app absence", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_DOCKER_PS: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("app presence is UNKNOWN, not absent");
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("docker-ps-failed");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("up -d --no-deps --force-recreate app");
  }, 30_000);

  it.skipIf(!bashAvailable)("does not replace an app when Docker inspect leaves its state UNKNOWN during maintenance operation", () => {
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

  it.skipIf(!bashAvailable)("keeps the app running behind confirmed maintenance when versioned provenance capture fails", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_CAPTURE_PRE_DDL_RELEASE: "1",
      FAIL_DOCKER_APP_INSPECT: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("prior app image/runtime or read-only database migration/schema provenance is not verifiable");
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("public-probe:503:https://bodycast.example.test/");
    expect(events).not.toContain("compose-stop-app");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("image tag");
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps the app running behind maintenance when the read-only compatibility query fails", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_CAPTURE_PRE_DDL_RELEASE: "1",
      FAIL_PREVIOUS_DB_SNAPSHOT: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("synthetic read-only compatibility snapshot failure");
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("previous-app-compatibility-snapshot-failed");
    expect(events).not.toContain("compose-stop-app");
  }, 30_000);

  it.skipIf(!bashAvailable)("captures previous-app schema provenance without admitting migration, then stops the app before full writer drain", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_CAPTURE_PRE_DDL_RELEASE: "1",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    const maintenanceProbeAt = events.findIndex((event) => event.startsWith("public-probe:503:"));
    const compatibilitySnapshotAt = events.indexOf("previous-app-compatibility-snapshot");
    const stopAt = events.indexOf("compose-stop-app");
    const removeAt = events.indexOf("compose-remove-app");
    const writerDrainAt = events.lastIndexOf("writer-drain-topology-check");
    expect(maintenanceProbeAt).toBeGreaterThan(-1);
    expect(compatibilitySnapshotAt).toBeGreaterThan(maintenanceProbeAt);
    expect(stopAt).toBeGreaterThan(compatibilitySnapshotAt);
    expect(removeAt).toBeGreaterThan(stopAt);
    expect(writerDrainAt).toBeGreaterThan(removeAt);
    expect(appState(fixture)).toMatchObject({ status: "exited", present: "false" });
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).toContain("production-db-target-url.mjs");
    expect(dockerLog).toContain("PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000");
    const provenanceSource = readFileSync(path.resolve("scripts/production-previous-app-provenance.mjs"), "utf8");
    expect(provenanceSource).toContain('"--previous-app-compatibility-snapshot", "bodycast-db-prod"');
    expect(provenanceSource).not.toContain('"--preflight", "bodycast-db-prod"');
    expect(readFileSync(path.join(fixture.repo, ".git", "bodycast-production-pre-ddl-release"), "utf8"))
      .toContain(`targetSha=${fixture.candidateSha}`);
    expect(result.stdout).toContain("PostgreSQL writers are drained");
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps maintenance and fails closed when another DB-network client remains after stopping the old app", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_CAPTURE_PRE_DDL_RELEASE: "1",
      FAIL_UNKNOWN_NETWORK_CLIENT: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("internal database network contains an unknown or unapproved client container");
    expect(appState(fixture)).toMatchObject({ status: "exited", present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).not.toContain("reverse_proxy");
  }, 30_000);

});
