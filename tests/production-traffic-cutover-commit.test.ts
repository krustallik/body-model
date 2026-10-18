import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bashAvailable, maintenanceRoute, createFixture, runFixture, stagedCandidatePath, assertStageOutsideLiveRoutes, assertNoWatcherServingBeforeAtomicPublish } from "./helpers/production-release-cutover-fixture";

function prepareTrainingServeFixture() {
  const fixture = createFixture();
  const migrationPath = "prisma/migrations/20261016120000_training_mutation_ledger_queue/migration.sql";
  const absoluteMigrationPath = path.join(fixture.repo, migrationPath);
  mkdirSync(path.dirname(absoluteMigrationPath), { recursive: true });
  execFileSync(fixture.realGit, ["-C", fixture.repo, "checkout", "-B", "main", fixture.candidateSha], { stdio: "ignore" });
  writeFileSync(absoluteMigrationPath, "-- Training release identity fixture\n");
  execFileSync(fixture.realGit, ["-C", fixture.repo, "add", migrationPath]);
  execFileSync(fixture.realGit, ["-C", fixture.repo, "commit", "-m", "fixture Training release"], { stdio: "ignore" });
  const trainingReleaseSha = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  execFileSync(fixture.realGit, ["-C", fixture.repo, "push", "origin", "main"], { stdio: "ignore" });
  writeFileSync(path.join(fixture.repo, "advance-after-training.txt"), "new main tip\n");
  execFileSync(fixture.realGit, ["-C", fixture.repo, "add", "advance-after-training.txt"]);
  execFileSync(fixture.realGit, ["-C", fixture.repo, "commit", "-m", "advance Training main"], { stdio: "ignore" });
  const advancedMainSha = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  execFileSync(fixture.realGit, ["-C", fixture.repo, "push", "origin", `${advancedMainSha}:refs/heads/training-advance`], { stdio: "ignore" });
  fixture.env.ADVANCE_SHA = advancedMainSha;
  execFileSync(fixture.realGit, ["-C", fixture.repo, "checkout", "--detach", trainingReleaseSha], { stdio: "ignore" });

  writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
  writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
  writeFileSync(path.join(fixture.root, "app-sha"), trainingReleaseSha + "\n");
  writeFileSync(path.join(fixture.root, "app-image-id"), fixture.env.CANDIDATE_IMAGE_ID + "\n");
  writeFileSync(path.join(fixture.root, "image-latest"), fixture.env.CANDIDATE_IMAGE_ID + "\n");
  const markerDirectory = path.join(fixture.repo, ".git", "bodycast-production-release-marker");
  mkdirSync(markerDirectory, { recursive: true });
  const markerPath = path.join(markerDirectory, "marker");
  writeFileSync(markerPath, [
    "schemaVersion=3",
    "manifestId=training-mutation-ledger-refresh-queue-v1",
    "migrationOriginSha=" + trainingReleaseSha,
    "deploySha=" + trainingReleaseSha,
    "state=app-ready",
    "workflowRunId=40123456790",
    "workflowRunAttempt=1",
    "authorizationId=training-migration-authorization-01",
    "lineageDigest=" + "b".repeat(64),
    "spawnState=started",
    "sourceMarkerDigest=" + "c".repeat(64),
    "compatibilityDigest=" + "d".repeat(64),
    "",
  ].join("\n"));
  writeFileSync(path.join(fixture.repo, ".git", "bodycast-production-pre-ddl-release"), [
    `targetSha=${trainingReleaseSha}`,
    `previousImageId=${fixture.env.PREVIOUS_IMAGE_ID}`,
    "previousImagePin=bodycast-app:rollback",
    "",
  ].join("\n"));
  writeFileSync(fixture.env.IMAGE_ROLLBACK!, `${fixture.env.PREVIOUS_IMAGE_ID}\n`);
  return { fixture, trainingReleaseSha, advancedMainSha, markerPath };
}

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

  it.skipIf(!bashAvailable)("restores maintenance and fails if serving reload fails", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    writeFileSync(path.join(fixture.root, "app-sha"), fixture.candidateSha + "\n");
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: fixture.candidateSha,
      DEPLOY_SHA: fixture.candidateSha,
      FAIL_SERVING_RELOAD: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("X-BodyCast-Deploy-Maintenance");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(result.stderr).toContain("Serving-route verification failed; maintenance marker is retained for safe recovery.");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("caddy-reload-failed:serving");
    expect(events).toContain("caddy-reload:maintenance");
    expect(events).toContain("public-probe:503:https://bodycast.example.test/");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("stop --time 0 bodycast-app-prod");
  }, 30_000);

  it.skipIf(!bashAvailable)("serves Training only after exact V3 marker, immutable image, and held V4 fence", () => {
    const { fixture, trainingReleaseSha, markerPath } = prepareTrainingServeFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: trainingReleaseSha,
      DEPLOY_SHA: trainingReleaseSha,
      CANDIDATE_SHA: trainingReleaseSha,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("reverse_proxy bodycast-app-prod:3000");
    expect(existsSync(markerPath)).toBe(false);
    expect(existsSync(path.join(fixture.repo, ".git", "bodycast-production-pre-ddl-release"))).toBe(false);
    expect(existsSync(fixture.env.IMAGE_ROLLBACK!)).toBe(false);
    expect(readdirSync(fixture.routes).some((name) => name.startsWith(".bodycast-maintenance-backup."))).toBe(false);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    const fenceReady = events.indexOf("unified-v4-fence-ready");
    const finalMainFetch = events.lastIndexOf("canonical-main-fetch");
    const finalMaintenanceProbe = events.lastIndexOf("public-probe:503:https://bodycast.example.test/");
    const routeCommit = events.indexOf("live-route-mutation:serving");
    const reload = events.indexOf("caddy-reload:serving");
    const healthProbe = events.indexOf("public-probe:200:https://bodycast.example.test/api/health");
    const fenceCommit = events.indexOf("unified-v4-fence-committed");
    expect(fenceReady).toBeGreaterThanOrEqual(0);
    expect(fenceReady).toBeLessThan(finalMainFetch);
    expect(finalMainFetch).toBeLessThan(routeCommit);
    expect(finalMainFetch).toBeLessThan(finalMaintenanceProbe);
    expect(finalMaintenanceProbe).toBeLessThan(routeCommit);
    expect(routeCommit).toBeLessThan(reload);
    expect(reload).toBeLessThan(healthProbe);
    expect(healthProbe).toBeLessThan(fenceCommit);
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("migration-context-pin");
  }, 30_000);

  it.skipIf(!bashAvailable)("does not publish the route when the final maintenance 503 probe fails", () => {
    const { fixture, trainingReleaseSha, markerPath } = prepareTrainingServeFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: trainingReleaseSha,
      DEPLOY_SHA: trainingReleaseSha,
      CANDIDATE_SHA: trainingReleaseSha,
      FAIL_THIRD_MAINTENANCE_PROBE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Public maintenance probe did not return the exact uncached per-attempt 503 response.");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(maintenanceRoute());
    expect(existsSync(markerPath)).toBe(true);
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("public-probe:502:https://bodycast.example.test/");
    expect(events).not.toContain("live-route-mutation:serving");
    expect(events).not.toContain("caddy-reload:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("retains Training recovery evidence when a serving reload times out ambiguously", async () => {
    const { fixture, trainingReleaseSha, markerPath } = prepareTrainingServeFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: trainingReleaseSha,
      DEPLOY_SHA: trainingReleaseSha,
      CANDIDATE_SHA: trainingReleaseSha,
      AMBIGUOUS_SERVING_RELOAD: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Caddy state remains UNKNOWN");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(maintenanceRoute());
    expect(existsSync(markerPath)).toBe(true);
    expect(readdirSync(fixture.routes).filter((name) => name.startsWith(".bodycast-maintenance-backup."))).toHaveLength(1);
    expect(readFileSync(path.join(fixture.root, "app-status"), "utf8").trim()).toBe("exited");
    expect(readFileSync(path.join(fixture.root, "app-restart"), "utf8").trim()).toBe("no");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8").trim().split(/\r?\n/);
    expect(events).toContain("caddy-reload-timeout:serving");
    expect(events.filter((event) => event === "public-probe:503:https://bodycast.example.test/")).toHaveLength(3);
    expect(events).not.toContain("caddy-reload:maintenance");

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("serving");
    expect(readFileSync(path.join(fixture.root, "app-status"), "utf8").trim()).toBe("exited");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("late-caddy-serving-config");
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps maintenance when the V4 fence exits after READY and before route publication", () => {
    const { fixture, trainingReleaseSha, markerPath } = prepareTrainingServeFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: trainingReleaseSha,
      DEPLOY_SHA: trainingReleaseSha,
      CANDIDATE_SHA: trainingReleaseSha,
      FAIL_TRAINING_FENCE_AFTER_READY: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(maintenanceRoute());
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).not.toContain("live-route-mutation:serving");
    expect(existsSync(markerPath)).toBe(true);
  }, 30_000);

  it.skipIf(!bashAvailable)("restores maintenance and retains marker when the Training V4 fence fails after route health", () => {
    const { fixture, trainingReleaseSha, markerPath } = prepareTrainingServeFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: trainingReleaseSha,
      DEPLOY_SHA: trainingReleaseSha,
      CANDIDATE_SHA: trainingReleaseSha,
      FAIL_TRAINING_FENCE_COMMIT: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(maintenanceRoute());
    expect(existsSync(markerPath)).toBe(true);
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("unified-v4-fence-commit-failed");
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("public-probe:503:https://bodycast.example.test/");
    expect(existsSync(path.join(fixture.repo, ".git", "bodycast-production-pre-ddl-release"))).toBe(true);
    expect(existsSync(fixture.env.IMAGE_ROLLBACK!)).toBe(true);
    expect(readdirSync(fixture.routes).some((name) => name.startsWith(".bodycast-maintenance-backup."))).toBe(false);
  }, 30_000);

  it.skipIf(!bashAvailable)("keeps maintenance active when Training V4 currentness is stale", () => {
    const { fixture, trainingReleaseSha } = prepareTrainingServeFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: trainingReleaseSha,
      DEPLOY_SHA: trainingReleaseSha,
      CANDIDATE_SHA: trainingReleaseSha,
      FAIL_TRAINING_V4_CHECK: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(maintenanceRoute());
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("unified-v4-fence-rejected");
    expect(readFileSync(path.join(fixture.root, "docker.log"), "utf8")).not.toContain("caddy reload");
  }, 30_000);

  it.skipIf(!bashAvailable)("rejects main movement after Training currentness and before route publication", () => {
    const { fixture, trainingReleaseSha, advancedMainSha } = prepareTrainingServeFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: trainingReleaseSha,
      DEPLOY_SHA: trainingReleaseSha,
      CANDIDATE_SHA: trainingReleaseSha,
      ADVANCE_SHA: advancedMainSha,
      ADVANCE_ON_MAIN_FETCH_NUMBER: "2",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing stale release SHA");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(maintenanceRoute());
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("unified-v4-fence-ready");
    expect(events).toContain("main-advanced");
    expect(events).not.toContain("live-route-mutation:serving");
  }, 30_000);

  it.skipIf(!bashAvailable)("restores maintenance if Training route health fails under the V4 fence", () => {
    const { fixture, trainingReleaseSha } = prepareTrainingServeFixture();
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: trainingReleaseSha,
      DEPLOY_SHA: trainingReleaseSha,
      CANDIDATE_SHA: trainingReleaseSha,
      FAIL_CANDIDATE_PUBLIC_PROBE: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(maintenanceRoute());
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("unified-v4-fence-ready");
    expect(events).toContain("caddy-reload:maintenance");
    expect(events).toContain("unified-v4-fence-aborted");
  }, 30_000);

  it.skipIf(!bashAvailable)("fails closed instead of markerless V4 serving for a Training release tree", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    const migrationPath = "prisma/migrations/20261016120000_training_mutation_ledger_queue/migration.sql";
    const absoluteMigrationPath = path.join(fixture.repo, migrationPath);
    mkdirSync(path.dirname(absoluteMigrationPath), { recursive: true });
    writeFileSync(absoluteMigrationPath, "-- Training release identity fixture\n");
    execFileSync(fixture.realGit, ["-C", fixture.repo, "add", migrationPath]);
    execFileSync(fixture.realGit, ["-C", fixture.repo, "commit", "-m", "fixture Training release"], { stdio: "ignore" });
    const trainingReleaseSha = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    execFileSync(fixture.realGit, ["-C", fixture.repo, "push", "origin", `${trainingReleaseSha}:refs/heads/main`], { stdio: "ignore" });

    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: trainingReleaseSha,
      DEPLOY_SHA: trainingReleaseSha,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("The exact-SHA app-ready marker is required for this rollout step.");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(maintenanceRoute());
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("canonical-main-fetch");
    expect(existsSync(path.join(fixture.root, "docker.log"))).toBe(false);
  }, 30_000);

  it.skipIf(!bashAvailable)("fails closed when the exact release commit is unavailable", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    const unknownSha = "f".repeat(40);
    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: unknownSha,
      DEPLOY_SHA: unknownSha,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exact release tree is unavailable; migration lineage cannot be classified");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(maintenanceRoute());
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("lock-acquired");
    expect(existsSync(path.join(fixture.root, "docker.log"))).toBe(false);
  }, 30_000);

  it.skipIf(!bashAvailable)("blocks a Training V2 v4-ready marker instead of routing it through legacy serving", () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.routes, "bodycast.caddy"), maintenanceRoute());
    writeFileSync(path.join(fixture.root, "active-route"), "maintenance\n");
    const migrationPath = "prisma/migrations/20261016120000_training_mutation_ledger_queue/migration.sql";
    const absoluteMigrationPath = path.join(fixture.repo, migrationPath);
    mkdirSync(path.dirname(absoluteMigrationPath), { recursive: true });
    writeFileSync(absoluteMigrationPath, "-- Training release identity fixture\n");
    execFileSync(fixture.realGit, ["-C", fixture.repo, "add", migrationPath]);
    execFileSync(fixture.realGit, ["-C", fixture.repo, "commit", "-m", "fixture Training release"], { stdio: "ignore" });
    const trainingReleaseSha = execFileSync(fixture.realGit, ["-C", fixture.repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    execFileSync(fixture.realGit, ["-C", fixture.repo, "push", "origin", `${trainingReleaseSha}:refs/heads/main`], { stdio: "ignore" });
    writeFileSync(path.join(fixture.repo, ".git", "bodycast-production-schema-cutover"), [
      "schemaVersion=2",
      "manifestId=training-mutation-ledger-refresh-queue-v1",
      `releaseSha=${trainingReleaseSha}`,
      "state=v4-ready",
      "workflowRunId=21",
      "workflowRunAttempt=1",
      "authorizationId=training-migration-authorization-01",
      `lineageDigest=${"a".repeat(64)}`,
      "spawnState=started",
      "",
    ].join("\n"));

    const result = runFixture(fixture, "bash scripts/production-traffic-cutover.sh serve", {
      BODYCAST_DEPLOY_SHA: trainingReleaseSha,
      DEPLOY_SHA: trainingReleaseSha,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("The exact-SHA app-ready marker is required for this rollout step.");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toBe(maintenanceRoute());
    expect(readFileSync(path.join(fixture.root, "events.log"), "utf8")).toContain("canonical-main-fetch");
    expect(existsSync(path.join(fixture.root, "docker.log"))).toBe(false);
  }, 30_000);

  it.skipIf(!bashAvailable)("restores maintenance if auto-watch serves candidate before a failed reload", () => {
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

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.routes, "bodycast.caddy"), "utf8")).toContain("X-BodyCast-Deploy-Maintenance");
    expect(readFileSync(path.join(fixture.root, "active-route"), "utf8").trim()).toBe("maintenance");
    const events = readFileSync(path.join(fixture.root, "events.log"), "utf8");
    expect(events).toContain("auto-watch-serving-effect");
    expect(events).toContain("caddy-reload-failed:serving");
    expect(events).toContain("caddy-reload:maintenance");
    expect(events).toContain("public-probe:503:https://bodycast.example.test/");
    expect(result.stderr).toContain("Serving-route verification failed; maintenance marker is retained for safe recovery.");
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
