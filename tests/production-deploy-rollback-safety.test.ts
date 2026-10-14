import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CANDIDATE_IMAGE_ID, PREVIOUS_SHA, PREVIOUS_IMAGE_ID, WRONG_IMAGE_ID, bashAvailable, createFixture, runFixture, appState, toBashPath } from "./helpers/production-release-cutover-fixture";
import { capturePreviousAppProvenance, parsePreviousAppProvenance, serializePreviousAppProvenance } from "../scripts/production-previous-app-provenance.mjs";

function seedCapturedPreviousRelease(fixture: ReturnType<typeof createFixture>, options: {
  targetSha?: string;
  imagePin?: string;
} = {}) {
  const report = JSON.parse(readFileSync(path.join(fixture.root, "previous-db-report.json"), "utf8"));
  const [container] = JSON.parse(readFileSync(path.join(fixture.root, "app-inspect.json"), "utf8"));
  const targetSha = options.targetSha ?? fixture.candidateSha;
  const record = capturePreviousAppProvenance({ container, databaseReport: report, targetSha, imagePin: options.imagePin ?? null });
  const recordPath = path.join(fixture.repo, ".git", "bodycast-production-pre-ddl-release");
  writeFileSync(recordPath, serializePreviousAppProvenance(record), { mode: 0o600 });
  execFileSync(fixture.bash, ["--noprofile", "--norc", "-c", `chmod 600 "${toBashPath(recordPath)}"`], { env: fixture.env, stdio: "ignore" });
  writeFileSync(path.join(fixture.root, "app-present"), "false\n");
  writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
  if (options.imagePin) {
    const pinSuffix = options.imagePin.replace("bodycast-app:rollback-preflight-", "");
    writeFileSync(path.join(fixture.root, `image-rollback-preflight-${pinSuffix}`), `${PREVIOUS_IMAGE_ID}\n`);
  } else {
    writeFileSync(path.join(fixture.root, "image-rollback"), `${PREVIOUS_IMAGE_ID}\n`);
  }
  execFileSync("git", ["push", "origin", `${fixture.advanceSha}:refs/heads/main`], { cwd: fixture.repo, stdio: "ignore" });
  execFileSync("git", ["checkout", "--detach", "--force", fixture.advanceSha], { cwd: fixture.repo, stdio: "ignore" });
  return { record, recordPath };
}

function findForbiddenDatabaseContainerOperations(dockerLog: string): string[] {
  const composeLifecycleActions = new Set(["up", "down", "start", "stop", "restart", "rm", "create", "kill", "pause", "unpause"]);
  const composeExecutionActions = new Set(["exec", "run"]);
  const directReadOnlyActions = new Set(["inspect", "ps", "logs", "stats", "port"]);
  return dockerLog.split(/\r?\n/).filter((command) => {
    const args = command.trim().split(/\s+/).filter(Boolean);
    if (!args.length) return false;
    if (args[0] === "compose") {
      const composeArgs = args.slice(1);
      const actionIndex = composeArgs.findIndex((arg) => composeLifecycleActions.has(arg));
      if (actionIndex >= 0) {
        const targets = composeArgs.slice(actionIndex + 1).filter((arg) => !arg.startsWith("-"));
        return targets.length === 0 || targets.includes("db") || targets.includes("bodycast-db-prod");
      }
      const targetsDatabase = args.includes("db") || args.includes("bodycast-db-prod");
      return targetsDatabase && composeArgs.some((arg) => composeExecutionActions.has(arg));
    }
    const action = args[0] === "container" ? args[1] : args[0];
    if (!args.includes("bodycast-db-prod") || directReadOnlyActions.has(action ?? "")) return false;
    if (action === "exec") {
      const guardedReadOnlyPsql = command.includes("PGOPTIONS=-c default_transaction_read_only=on")
        && command.includes("statement_timeout=")
        && command.includes("lock_timeout=")
        && command.includes("psql")
        && command.includes("ON_ERROR_STOP=1");
      return !guardedReadOnlyPsql;
    }
    return true;
  });
}

function expectNoDatabaseContainerMutation(dockerLog: string) {
  const databaseMutations = findForbiddenDatabaseContainerOperations(dockerLog);
  expect(databaseMutations).toEqual([]);
}

function replaceCurrentAppAndDatabase(fixture: ReturnType<typeof createFixture>) {
  const appImageId = `sha256:${"b".repeat(64)}`;
  const appContainerId = "f".repeat(64);
  writeFileSync(path.join(fixture.root, "app-image-id"), `${appImageId}\n`);
  writeFileSync(path.join(fixture.root, "app-container-id"), `${appContainerId}\n`);
  writeFileSync(path.join(fixture.root, "app-sha"), `${"2".repeat(40)}\n`);
  writeFileSync(path.join(fixture.root, "app-present"), "true\n");
  const [container] = JSON.parse(readFileSync(path.join(fixture.root, "app-inspect.json"), "utf8"));
  container.Id = appContainerId;
  container.Image = appImageId;
  container.Config.Labels["org.bodycast.release-sha"] = "2".repeat(40);
  container.State.Status = "running";
  writeFileSync(path.join(fixture.root, "app-inspect.json"), `${JSON.stringify([container])}\n`);
  const databaseReport = JSON.parse(readFileSync(path.join(fixture.root, "previous-db-report.json"), "utf8"));
  databaseReport.objects[0].signature = "new live schema before the V4 republication migrations";
  writeFileSync(path.join(fixture.root, "previous-db-report.json"), `${JSON.stringify(databaseReport)}\n`);
  return { appImageId, appContainerId };
}

describe("maintenance-first deploy fail-closed checks", () => {
  it.each([
    "compose -f docker-compose.prod.yml exec db psql -c UPDATE",
    "compose -f docker-compose.prod.yml run db psql -c UPDATE",
    "compose -f docker-compose.prod.yml down",
    "stop --time 0 bodycast-db-prod",
    "container stop --time 0 bodycast-db-prod",
    "update --restart unless-stopped bodycast-db-prod",
    "rename bodycast-db-prod bodycast-db-prod-old",
  ])("classifies database-targeting Docker operation as a forbidden no-op effect: %s", (command) => {
    expect(findForbiddenDatabaseContainerOperations(command)).toEqual([command]);
  });

  it("allows read-only inspection of the existing database container", () => {
    expect(findForbiddenDatabaseContainerOperations("inspect --format {{.State.Health.Status}} bodycast-db-prod")).toEqual([]);
  });

  it("allows only the explicitly read-only PostgreSQL compatibility probe", () => {
    const guarded = "exec -i --env PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000 bodycast-db-prod sh -c exec psql --set=ON_ERROR_STOP=1";
    expect(findForbiddenDatabaseContainerOperations(guarded)).toEqual([]);
    expect(findForbiddenDatabaseContainerOperations("exec bodycast-db-prod psql -c UPDATE")).toEqual(["exec bodycast-db-prod psql -c UPDATE"]);
  });

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
    const pinAt = events.indexOf(`image-tag:${PREVIOUS_IMAGE_ID}:bodycast-app:deploy-rollback`);
    const appBuildAt = events.indexOf("compose-build-app");
    const stopAt = events.indexOf("compose-stop-app");
    expect(maintenanceProbeAt).toBeGreaterThan(-1);
    expect(captureAt).toBeGreaterThan(maintenanceProbeAt);
    expect(pinAt).toBeGreaterThan(captureAt);
    expect(appBuildAt).toBeGreaterThan(pinAt);
    expect(stopAt).toBeGreaterThan(appBuildAt);
    expect(events).toContain("schema-preflight-no-deps");
    expect(events).not.toContain("forbidden-db-start");
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).not.toContain("up -d db");
    expect(dockerLog).toContain("run --rm --no-deps --entrypoint npx migrate prisma migrate status");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).toContain(
      `${PREVIOUS_IMAGE_ID} bodycast-app:deploy-rollback`,
    );
    expect(existsSync(path.join(fixture.root, "image-deploy-rollback"))).toBe(true);
    expect(readFileSync(path.join(fixture.root, "image-deploy-rollback"), "utf8").trim()).toBe(PREVIOUS_IMAGE_ID);
  }, 30_000);

  it.skipIf(!bashAvailable)("skips app replacement for a duplicate healthy exact SHA after schema checks", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
    writeFileSync(path.join(fixture.root, "app-image-id"), `${CANDIDATE_IMAGE_ID}\n`);
    writeFileSync(path.join(fixture.root, "image-latest"), `${CANDIDATE_IMAGE_ID}\n`);
    const beforeRoute = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("app, database, and route changes are skipped");
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: CANDIDATE_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(beforeRoute);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("schema-preflight-no-deps");
    expect(events).not.toContain("unified-v4-check");
    expect(readFileSync(path.join(fixture.root, "main-fetch-count"), "utf8").trim()).toBe("3");
    expect(events).not.toContain("atomic-live-route-replacement:bodycast.caddy");
    expect(events).not.toContain("compose-stop-app");
    expect(events).not.toContain("compose-remove-app");
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).toMatch(/compose -f docker-compose\.prod\.yml --profile tools build migrate/);
    expect(dockerLog).not.toMatch(/compose -f docker-compose\.prod\.yml build app/);
    expect(dockerLog).not.toMatch(/prisma migrate deploy|unified-v4-activate-replay\.mjs/);
    expectNoDatabaseContainerMutation(dockerLog);
    expect(existsSync(path.join(fixture.root, "image-deploy-rollback"))).toBe(false);
  }, 30_000);

  it.skipIf(!bashAvailable)("rejects the duplicate-deploy no-op if canonical main advances during its final freshness check", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.root, "app-sha"), `${fixture.candidateSha}\n`);
    writeFileSync(path.join(fixture.root, "app-image-id"), `${CANDIDATE_IMAGE_ID}\n`);
    writeFileSync(path.join(fixture.root, "image-latest"), `${CANDIDATE_IMAGE_ID}\n`);
    const beforeRoute = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      ADVANCE_ON_MAIN_FETCH_NUMBER: "3",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing stale release SHA");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(beforeRoute);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(appState(fixture)).toEqual({ sha: fixture.candidateSha, imageId: CANDIDATE_IMAGE_ID, status: "healthy", present: "true" });
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("main-advanced");
    expect(events).not.toContain("atomic-live-route-replacement:bodycast.caddy");
    expect(events).not.toContain("compose-stop-app");
    expect(events).not.toContain("compose-remove-app");
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).not.toMatch(/prisma migrate deploy|unified-v4-activate-replay\.mjs/);
    expectNoDatabaseContainerMutation(dockerLog);
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps the prior app running when its exact image cannot be pinned before candidate build", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_DEPLOY_ROLLBACK_TAG: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Could not pin the exact previous app image");
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("image-tag-deploy-rollback-failed");
    expect(events).not.toContain("compose-build-app");
    expect(events).not.toContain("compose-stop-app");
    expect(events).not.toContain("compose-remove-app");
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).not.toContain("up -d --no-deps --force-recreate app");
    expect(dockerLog).not.toContain("prisma migrate deploy");
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps the prior app running when its immutable image is unavailable before pinning", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      MISSING_PREVIOUS_IMAGE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("The exact previous app image is unavailable");
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).not.toContain("compose-build-app");
    expect(events).not.toContain("compose-stop-app");
    expect(events).not.toContain("compose-remove-app");
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).not.toContain("image tag");
    expect(dockerLog).not.toContain("up -d --no-deps --force-recreate app");
  }, 30_000);

  it.skipIf(!bashAvailable)("rejects a rollback tag that does not resolve to the prior immutable image", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      MISMATCH_DEPLOY_ROLLBACK_TAG: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("The deploy rollback pin does not match the captured immutable image ID");
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).not.toContain("compose-build-app");
    expect(events).not.toContain("compose-stop-app");
    expect(events).not.toContain("compose-remove-app");
  }, 30_000);

  it.skipIf(!bashAvailable)("retains the verified prior image pin if candidate build fails", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_APP_BUILD: "1",
    });

    expect(result.status).not.toBe(0);
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.root, "image-deploy-rollback"), "utf8").trim()).toBe(PREVIOUS_IMAGE_ID);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("image-tag:" + PREVIOUS_IMAGE_ID + ":bodycast-app:deploy-rollback");
    expect(events).not.toContain("compose-stop-app");
    expect(events).not.toContain("compose-remove-app");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("up -d --no-deps --force-recreate app");
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps the prior serving app untouched when main advances during preflight tooling build", () => {
    const fixture = createFixture();
    const beforeRoute = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      ADVANCE_ON_MIGRATOR_BUILD: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing stale release SHA");
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(beforeRoute);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("main-advanced");
    expect(events).not.toContain("atomic-live-route-replacement:bodycast.caddy");
    expect(events).not.toContain("compose-stop-app");
    expect(events).not.toContain("compose-remove-app");
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).not.toContain("up -d --no-deps --force-recreate app");
  }, 30_000);

  it.skipIf(!bashAvailable)("blocks maintenance publication when main advances on the final freshness fetch immediately before route replacement", () => {
    const fixture = createFixture();
    const beforeRoute = readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8");
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      ADVANCE_ON_MAIN_FETCH_NUMBER: "4",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing stale release SHA");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(beforeRoute);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(appState(fixture)).toEqual({ sha: PREVIOUS_SHA, imageId: PREVIOUS_IMAGE_ID, status: "healthy", present: "true" });
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("main-advanced");
    expect(readFileSync(path.join(fixture.root, "main-fetch-count"), "utf8").trim()).toBe("4");
    expect(events).toContain("maintenance-route-validation");
    expect(events).not.toContain("atomic-live-route-replacement:bodycast.caddy");
    expect(events).not.toContain("compose-stop-app");
    expect(events).not.toContain("compose-remove-app");
  }, 30_000);

  it.skipIf(!bashAvailable)("reports maintenance publication as unconfirmed when Caddy reload and the public probe fail", () => {
    const fixture = createFixture();
    const result = runFixture(fixture, "bash scripts/deploy.sh", {
      DEPLOY_SHA: fixture.candidateSha,
      BODYCAST_NON_SERVING_DEPLOY: "0",
      FAIL_MAINTENANCE_RELOAD: "1",
      FAIL_MAINTENANCE_PROBE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain('respond "BodyCast is temporarily unavailable while the model is updated." 503');
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(appState(fixture)).toMatchObject({ sha: PREVIOUS_SHA, status: "healthy", present: "true" });
    expect(result.stderr).toContain("maintenance route file was published, but external maintenance is unconfirmed");
    expect(result.stderr).not.toContain("previous app was not stopped or replaced");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("atomic-live-route-replacement:bodycast.caddy");
    expect(events).toContain("caddy-reload-failed:maintenance");
    expect(events).not.toContain("compose-stop-app");
    expect(events).not.toContain("compose-remove-app");
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
    expect(events).toContain("previous-app-compatibility-sql-validated");
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

  it.skipIf(!bashAvailable)("refreshes a stale capture without replacing its old image pin and verifies the new capture before stopping the app", () => {
    const fixture = createFixture();
    const { record: oldRecord, recordPath } = seedCapturedPreviousRelease(fixture);
    const oldRecordBytes = readFileSync(recordPath, "utf8");
    const { appImageId, appContainerId } = replaceCurrentAppAndDatabase(fixture);
    const runId = "38002000010";
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.advanceSha,
      BODYCAST_CAPTURE_PRE_DDL_RELEASE: "1",
      BODYCAST_REFRESH_PRE_DDL_CAPTURE: "1",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ID: runId,
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ATTEMPT: "1",
      ASSERT_CAPTURE_BEFORE_STOP: "1",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}\n${readFileSync(path.join(fixture.root, "docker.log"), "utf8")}\n${readFileSync(path.join(fixture.root, "events.log"), "utf8")}`).toBe(0);
    const archivePath = path.join(fixture.repo, ".git", `bodycast-production-pre-ddl-release-archive-${runId}-1`);
    expect(readFileSync(archivePath, "utf8")).toBe(oldRecordBytes);
    expect(readFileSync(path.join(fixture.root, "image-rollback"), "utf8").trim()).toBe(oldRecord.previousImageId);
    const refreshed = parsePreviousAppProvenance(readFileSync(recordPath, "utf8"));
    expect(refreshed).toMatchObject({
      schemaVersion: 3,
      targetSha: fixture.advanceSha,
      previousImagePin: `bodycast-app:rollback-preflight-${runId}-1`,
      previousImageId: appImageId,
      previousContainerId: appContainerId,
    });
    expect(refreshed.preDdlDatabaseCompatibilityDigest).not.toBe(oldRecord.preDdlDatabaseCompatibilityDigest);
    expect(readFileSync(path.join(fixture.root, `image-rollback-preflight-${runId}-1`), "utf8").trim()).toBe(appImageId);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    expect(events.indexOf("capture-and-pin-verified-before-stop")).toBeGreaterThan(-1);
    expect(events.indexOf("compose-stop-app")).toBeGreaterThan(events.indexOf("capture-and-pin-verified-before-stop"));
    expect(events).toContain("writer-drain-topology-check");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expectNoDatabaseContainerMutation(readFileSync(path.join(fixture.root, "docker.log"), "utf8"));
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps the old capture, image pin, and running app if refreshed capture creation fails", () => {
    const fixture = createFixture();
    const { recordPath } = seedCapturedPreviousRelease(fixture);
    const oldRecordBytes = readFileSync(recordPath, "utf8");
    replaceCurrentAppAndDatabase(fixture);
    writeFileSync(path.join(fixture.root, "app-present"), "true\n");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.advanceSha,
      BODYCAST_CAPTURE_PRE_DDL_RELEASE: "1",
      BODYCAST_REFRESH_PRE_DDL_CAPTURE: "1",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ID: "38002000011",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ATTEMPT: "1",
      FAIL_PREVIOUS_DB_SNAPSHOT: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("synthetic read-only compatibility snapshot failure");
    expect(readFileSync(recordPath, "utf8")).toBe(oldRecordBytes);
    expect(readFileSync(path.join(fixture.root, "image-rollback"), "utf8").trim()).toBe(PREVIOUS_IMAGE_ID);
    expect(existsSync(path.join(fixture.repo, ".git", "bodycast-production-pre-ddl-release-archive-38002000011-1"))).toBe(false);
    expect(appState(fixture)).toMatchObject({ status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("compose-stop-app");
  }, 30_000);

  it.skipIf(!bashAvailable)("preserves old artifacts and keeps the app running when a refresh pin operation fails", () => {
    const fixture = createFixture();
    const { recordPath } = seedCapturedPreviousRelease(fixture);
    const oldRecordBytes = readFileSync(recordPath, "utf8");
    replaceCurrentAppAndDatabase(fixture);
    writeFileSync(path.join(fixture.root, "app-present"), "true\n");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.advanceSha,
      BODYCAST_CAPTURE_PRE_DDL_RELEASE: "1",
      BODYCAST_REFRESH_PRE_DDL_CAPTURE: "1",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ID: "38002000012",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ATTEMPT: "1",
      FAIL_REFRESH_IMAGE_TAG: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Could not create the attempt-specific immutable previous-app image pin");
    expect(readFileSync(recordPath, "utf8")).toBe(oldRecordBytes);
    expect(readFileSync(path.join(fixture.repo, ".git", "bodycast-production-pre-ddl-release-archive-38002000012-1"), "utf8")).toBe(oldRecordBytes);
    expect(readFileSync(path.join(fixture.root, "image-rollback"), "utf8").trim()).toBe(PREVIOUS_IMAGE_ID);
    expect(appState(fixture)).toMatchObject({ status: "healthy", present: "true" });
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("compose-stop-app");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("rebinds a captured release only after matching fresh DB state and preserves the original capture", () => {
    const fixture = createFixture();
    const { record, recordPath } = seedCapturedPreviousRelease(fixture);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.advanceSha,
      BODYCAST_CAPTURE_PRE_DDL_RELEASE: "1",
      BODYCAST_RESUME_PRE_DDL_CAPTURE: "1",
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_SHA: fixture.candidateSha,
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_RUN_ID: "38000669126",
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_RUN_ATTEMPT: "1",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ID: "38002000000",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ATTEMPT: "1",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const rebound = readFileSync(recordPath, "utf8");
    expect(rebound).toContain(`targetSha=${fixture.advanceSha}`);
    expect(rebound).toContain(`previousImageId=${record.previousImageId}`);
    expect(rebound).toContain(`preDdlDatabaseCompatibilityDigest=${record.preDdlDatabaseCompatibilityDigest}`);
    const archived = readFileSync(path.join(fixture.repo, ".git", `bodycast-production-pre-ddl-release-before-${fixture.advanceSha}`), "utf8");
    expect(archived).toBe(serializePreviousAppProvenance(record));
    const receipt = JSON.parse(readFileSync(path.join(fixture.repo, ".git", "bodycast-production-pre-ddl-release-resume-38002000000-1"), "utf8"));
    expect(receipt).toMatchObject({
      sourceRunId: "38000669126", sourceRunAttempt: 1, sourceSha: fixture.candidateSha, targetSha: fixture.advanceSha,
    });
    expect(receipt.currentRecordDigest).not.toBe(receipt.sourceRecordDigest);
    expect(appState(fixture)).toMatchObject({ present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(result.stdout).toContain("BODYCAST_PRE_DDL_RESUME_RECEIPT=");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("previous-app-compatibility-snapshot");
  }, 30_000);

  it.skipIf(!bashAvailable)("resumes a schema-v3 capture only through its exact attempt-bound image pin", () => {
    const fixture = createFixture();
    const runId = "38002000013";
    const imagePin = `bodycast-app:rollback-preflight-${runId}-1`;
    const { record, recordPath } = seedCapturedPreviousRelease(fixture, { targetSha: fixture.advanceSha, imagePin });
    const recordBytes = readFileSync(recordPath, "utf8");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.advanceSha,
      BODYCAST_CAPTURE_PRE_DDL_RELEASE: "1",
      BODYCAST_RESUME_PRE_DDL_CAPTURE: "1",
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_SHA: fixture.advanceSha,
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_RUN_ID: runId,
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_RUN_ATTEMPT: "1",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ID: "38002000014",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ATTEMPT: "1",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(record.schemaVersion).toBe(3);
    expect(readFileSync(recordPath, "utf8")).toBe(recordBytes);
    const dockerLog = readFileSync(path.join(fixture.root, "docker.log"), "utf8");
    expect(dockerLog).toContain(`image inspect --format {{.Id}} ${imagePin}`);
    expect(dockerLog).not.toContain("image inspect --format {{.Id}} bodycast-app:rollback\n");
    expect(readFileSync(path.join(fixture.repo, ".git", "bodycast-production-pre-ddl-release-resume-38002000014-1"), "utf8"))
      .toContain('"currentRecordDigest"');
    expect(appState(fixture)).toMatchObject({ present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("blocks schema-v3 capture resume when its attempt-bound image pin differs", () => {
    const fixture = createFixture();
    const runId = "38002000015";
    const imagePin = `bodycast-app:rollback-preflight-${runId}-1`;
    const { recordPath } = seedCapturedPreviousRelease(fixture, { targetSha: fixture.advanceSha, imagePin });
    const recordBytes = readFileSync(recordPath, "utf8");
    writeFileSync(path.join(fixture.root, `image-rollback-preflight-${runId}-1`), `${WRONG_IMAGE_ID}\n`);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.advanceSha,
      BODYCAST_CAPTURE_PRE_DDL_RELEASE: "1",
      BODYCAST_RESUME_PRE_DDL_CAPTURE: "1",
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_SHA: fixture.advanceSha,
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_RUN_ID: runId,
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_RUN_ATTEMPT: "1",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ID: "38002000016",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ATTEMPT: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("attempt-bound previous-app image pin differs");
    expect(readFileSync(recordPath, "utf8")).toBe(recordBytes);
    expect(existsSync(path.join(fixture.repo, ".git", "bodycast-production-pre-ddl-release-resume-38002000016-1"))).toBe(false);
    expect(appState(fixture)).toMatchObject({ present: "false" });
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
  }, 30_000);

  it.skipIf(!bashAvailable)("does not rebind the previous capture when a fresh read-only DB snapshot fails", () => {
    const fixture = createFixture();
    const { record, recordPath } = seedCapturedPreviousRelease(fixture);
    const before = readFileSync(recordPath, "utf8");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh maintenance", {
      BODYCAST_DEPLOY_SHA: fixture.advanceSha,
      BODYCAST_CAPTURE_PRE_DDL_RELEASE: "1",
      BODYCAST_RESUME_PRE_DDL_CAPTURE: "1",
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_SHA: fixture.candidateSha,
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_RUN_ID: "38000669126",
      BODYCAST_PRE_DDL_CAPTURE_SOURCE_RUN_ATTEMPT: "1",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ID: "38002000001",
      BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ATTEMPT: "1",
      FAIL_PREVIOUS_DB_SNAPSHOT: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Fresh production DB compatibility does not match the durable previous-app capture");
    expect(readFileSync(recordPath, "utf8")).toBe(before);
    expect(existsSync(path.join(fixture.repo, ".git", `bodycast-production-pre-ddl-release-before-${fixture.advanceSha}`))).toBe(false);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(appState(fixture)).toMatchObject({ present: "false" });
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("previous-app-compatibility-snapshot-failed");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("image tag");
    expect(existsSync(path.join(fixture.repo, ".git", "bodycast-production-pre-ddl-release-resume-38002000001-1"))).toBe(false);
    expect(record.targetSha).toBe(fixture.candidateSha);
  }, 30_000);

});
