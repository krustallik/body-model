import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bashExecutable } from "./helpers/production-release-cutover-fixture";

const deploySh = readFileSync(resolve("scripts/deploy.sh"), "utf8").replace(/\r\n/g, "\n");
const deployWorkflow = readFileSync(resolve(".github/workflows/deploy-production.yml"), "utf8").replace(/\r\n/g, "\n");
const preflightSh = readFileSync(resolve("scripts/deploy-preflight-schema.sh"), "utf8");
const migrateSh = readFileSync(resolve("scripts/deploy-migrate.sh"), "utf8");
const migrateGuard = readFileSync(resolve("scripts/run-prisma-migrate-with-lock-timeout.mjs"), "utf8");
const cutoverSh = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
const trafficCheck = readFileSync(resolve("scripts/unified-v4-traffic-check.ts"), "utf8");
const routePrimitivesSh = readFileSync(resolve("scripts/production-route-primitives.sh"), "utf8");
const routePathSh = readFileSync(resolve("scripts/production-route-path.sh"), "utf8");
const releaseMarkerSh = readFileSync(resolve("scripts/production-release-marker.sh"), "utf8");
const composeYaml = readFileSync(resolve("docker-compose.prod.yml"), "utf8");
const modelForecastService = readFileSync(resolve("src/modules/model-forecast/model-forecast.service.ts"), "utf8");

describe("production maintenance-first deploy safety contracts", () => {
  it("pauses automatic serving deploys and keeps manual non-serving deploy owner-gated", () => {
    expect(deployWorkflow).toContain("workflow_dispatch:");
    expect(deployWorkflow).not.toMatch(/^  workflow_run:\s*$/m);
    expect(deployWorkflow).toContain('github.actor_id }}');
    expect(deployWorkflow).toContain('"126446430"');
    expect(deployWorkflow).toContain("assertTrustedOwnerWorkflowRun");
    expect(deployWorkflow).toContain('DEPLOY_MODE: ${{ needs.authorize.outputs.deploy_mode }}');
    expect(deployWorkflow).toContain('DEPLOY_MODE="${5:-}"');
    expect(deployWorkflow).toContain("'$ROUTES_PATH_B64' '$DEPLOY_MODE'");
    expect(deployWorkflow).toContain('BODYCAST_NON_SERVING_DEPLOY="$NON_SERVING"');
    expect(deployWorkflow).toContain('workflowRunEventAttempt: process.env.EVENT_RUN_ATTEMPT || null');
    expect(deployWorkflow).not.toContain("git checkout --detach --force");
    expect(deployWorkflow).toContain('git checkout --detach "$DEPLOY_SHA"');
    expect(deployWorkflow).toContain("migration_free_serving:");
    expect(deployWorkflow).toContain('"serve-migration-free"');
    expect(deployWorkflow).toContain('MODE="migration-free-serving"');

  });

  it.skipIf(!bashExecutable)("passes the authorized deploy mode through SSH and routes migration-free serving through the fenced runner", () => {
    const remoteScript = deployWorkflow.match(/REMOTE_SCRIPT="\$\(cat <<'REMOTE'\n([\s\S]*?)\n\s*REMOTE\n/)?.[1];
    expect(remoteScript).toBeTruthy();
      expect(remoteScript).toContain('DEPLOY_MODE="${5:-}"');
    expect(deployWorkflow).toContain("'$ROUTES_PATH_B64' '$DEPLOY_MODE'");

    const modeBlock = remoteScript!.match(/case "\$DEPLOY_MODE" in[\s\S]*?esac/)?.[0];
    expect(modeBlock).toBeTruthy();
    for (const [mode, expected] of [["serving", "0"], ["non-serving", "1"]] as const) {
      const result = spawnSync(bashExecutable ?? "bash", ["--noprofile", "--norc", "-c", `${modeBlock}; printf '%s' "$NON_SERVING"`], {
        encoding: "utf8",
        env: { ...process.env, DEPLOY_MODE: mode },
      });
      expect(result.status, mode).toBe(0);
      expect(result.stdout, mode).toBe(expected);
    }
    expect(modeBlock).toContain("migration-free-serving)");
    expect(modeBlock).toContain("BODYCAST_MIGRATION_FREE_CANDIDATE=1");
    expect(modeBlock).toContain('bash scripts/deploy.sh');
  });

  it("checks out current main before the production-job owner identity import", () => {
    for (const [label, workflow, jobName] of [
      ["deploy", deployWorkflow, "name: Deploy exact current-main SHA"],
    ] as const) {
      const job = workflow.slice(workflow.indexOf(jobName));
      const checkoutAt = job.indexOf("actions/checkout@");
      const identityAt = job.indexOf('from "./scripts/github-owner-identity.mjs"');
      const secretAt = job.search(/SSH_PRIVATE_KEY:/);
      expect(checkoutAt, label).toBeGreaterThan(-1);
      expect(identityAt, label).toBeGreaterThan(checkoutAt);
      expect(secretAt, label).toBeGreaterThan(identityAt);
    }
  });

  it("pins the V4 handoff verifier before loading production SSH credentials", () => {
    const deployJob = deployWorkflow.slice(deployWorkflow.indexOf("name: Deploy exact current-main SHA"));
    const pinCheckAt = deployJob.indexOf("Verify externally pinned V4 handoff verifier");
    const sshInputsAt = deployJob.indexOf("Validate SSH inputs and pin the production host");
    expect(deployJob).toContain("vars.BODYCAST_V4_HANDOFF_BLOB");
    expect(pinCheckAt).toBeGreaterThan(-1);
    expect(sshInputsAt).toBeGreaterThan(pinCheckAt);
  });

  it("implements the approved maintenance-first state machine and live-route commit", () => {
    const states = [
      'release_state="PREPARE"',
      'release_state="MAINTENANCE_PUBLISHED_UNCONFIRMED"',
      'release_state="MAINTENANCE_CONFIRMED"',
      'release_state="PREVIOUS_RELEASE_CAPTURED"',
      'release_state="CANDIDATE_VERIFIED"',
      'release_state="SERVING_COMMIT"',
      'release_state="COMMITTED"',
    ].map((needle, index) => index === 4 || index === 6
      ? deploySh.lastIndexOf(needle)
      : deploySh.indexOf(needle));
    expect(states.every((index) => index >= 0)).toBe(true);
    expect(states).toEqual([...states].sort((left, right) => left - right));

    const routeReplaceAt = deploySh.indexOf('mv -f -- "$route_stage" "${CADDY_ROUTES_PATH%/}/bodycast.caddy"');
    const committedAt = deploySh.indexOf('release_state="COMMITTED"', routeReplaceAt);
    const trapDisarmAt = deploySh.indexOf("trap - ERR", committedAt);
    const reloadAt = deploySh.indexOf("docker exec gymbeam-caddy caddy reload", trapDisarmAt);
    const publicProbeAt = deploySh.indexOf("bodycast_probe_public_candidate_observational", reloadAt);
    expect(routeReplaceAt).toBeGreaterThan(states[4]);
    expect(committedAt).toBeGreaterThan(routeReplaceAt);
    expect(deploySh.slice(routeReplaceAt, committedAt + 'release_state="COMMITTED"'.length))
      .toContain('fi\nrelease_state="COMMITTED"');
    expect(trapDisarmAt).toBeGreaterThan(committedAt);
    expect(reloadAt).toBeGreaterThan(trapDisarmAt);
    expect(publicProbeAt).toBeGreaterThan(reloadAt);
    expect(deploySh.slice(reloadAt)).not.toContain("assert_current_main_sha");
    expect(deploySh.slice(reloadAt)).not.toContain("stop_candidate_fail_closed");
  });

  it("requires an exact uncached public maintenance response before stopping the old app", () => {
    expect(routePrimitivesSh).toContain('respond "BodyCast is temporarily unavailable while the model is updated." 503');
    expect(routePrimitivesSh).toContain('Cache-Control "no-store"');
    expect(routePrimitivesSh).toContain('X-BodyCast-Deploy-Maintenance "${maintenance_marker}"');
    expect(routePrimitivesSh).toContain("--max-redirs 0");
    expect(routePrimitivesSh).toContain('[[ "$status" != "503" ]]');
    expect(routePrimitivesSh).toContain("Public maintenance probe did not return the exact uncached per-attempt 503 response.");

    const confirmAt = deploySh.indexOf("publish_and_confirm_maintenance\n");
    const stopAt = deploySh.indexOf("stop_exact_app_container \"$previous_app_sha\"", confirmAt);
    const captureAt = deploySh.indexOf("capture_previous_release\n", confirmAt);
    const migrateBuildAt = deploySh.indexOf("compose --profile tools build migrate", captureAt);
    const appBuildAt = deploySh.indexOf('compose build "$APP_SERVICE"', captureAt);
    expect(confirmAt).toBeGreaterThan(-1);
    expect(captureAt).toBeGreaterThan(confirmAt);
    expect(migrateBuildAt).toBeGreaterThan(captureAt);
    expect(appBuildAt).toBeGreaterThan(migrateBuildAt);
    expect(stopAt).toBeGreaterThan(appBuildAt);
    const publishDefinitionAt = deploySh.indexOf("publish_and_confirm_maintenance() {");
    const captureDefinitionAt = deploySh.indexOf("capture_previous_release() {");
    const publishBody = deploySh.slice(publishDefinitionAt, captureDefinitionAt);
    expect(publishBody).toContain("bodycast_probe_public_maintenance");
    expect(publishBody).toContain('release_state="MAINTENANCE_PUBLISHED_UNCONFIRMED"');
    expect(publishBody).toContain('release_state="MAINTENANCE_CONFIRMED"');
    const maintenanceFence = publishBody.lastIndexOf("assert_current_main_sha");
    const maintenanceMove = publishBody.indexOf('mv -f -- "$stage"', maintenanceFence);
    expect(maintenanceFence).toBeGreaterThan(-1);
    expect(maintenanceMove).toBeGreaterThan(maintenanceFence);
    expect(publishBody.slice(maintenanceFence, maintenanceMove + 'mv -f -- "$stage"'.length))
      .toMatch(/assert_current_main_sha[\s\S]*?mv -f -- "\$stage"/);
    const captureBody = deploySh.slice(captureDefinitionAt, deploySh.indexOf("\necho \"Preparing exact release"));
    expect(captureBody).toContain("docker image inspect --format '{{.Id}}' \"$previous_app_image_id\"");
    expect(captureBody).toContain('docker image tag "$previous_app_image_id" "$DEPLOY_ROLLBACK_IMAGE"');
    expect(captureBody).toContain('[[ "$pinned_image_id" == "$previous_app_image_id" ]]');
    expect(captureBody).not.toContain("docker commit");
    expect(captureBody).not.toContain("continuing with exact container-identity stop only");
  });

  it("supports a no-app migration-free roll-forward with the same writer and raw-integrity gates", () => {
    const releaseStart = deploySh.indexOf("publish_and_confirm_maintenance\n");
    const captureAt = deploySh.indexOf("capture_previous_release\n", releaseStart);
    const toolsBuildAt = deploySh.indexOf("compose --profile tools build migrate", captureAt);
    const appBuildAt = deploySh.indexOf('compose build "$APP_SERVICE"', toolsBuildAt);
    const previousAppBlockStart = deploySh.indexOf('if [[ "$previous_app_present" == "true" ]]; then', appBuildAt);
    const previousAppBlockEnd = deploySh.indexOf('\nfi\n\nif [[ "$BODYCAST_MIGRATION_FREE_CANDIDATE" == "1" ]]; then', previousAppBlockStart);
    const previousAppBlock = deploySh.slice(previousAppBlockStart, previousAppBlockEnd);
    const writerDrainAt = deploySh.indexOf('bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert', previousAppBlockEnd);
    const rawFingerprintAt = deploySh.indexOf("--capture-raw-input-fingerprint", writerDrainAt);
    const candidateStartAt = deploySh.indexOf('candidate_start_attempted=true', rawFingerprintAt);

    expect(releaseStart).toBeGreaterThan(-1);
    expect(captureAt).toBeGreaterThan(releaseStart);
    expect(toolsBuildAt).toBeGreaterThan(captureAt);
    expect(appBuildAt).toBeGreaterThan(toolsBuildAt);
    expect(previousAppBlockStart).toBeGreaterThan(appBuildAt);
    expect(previousAppBlockEnd).toBeGreaterThan(previousAppBlockStart);
    expect(previousAppBlock).toContain('stop_exact_app_container "$previous_app_sha"');
    expect(previousAppBlock).not.toContain('production-writer-drain.sh" --assert');
    expect(previousAppBlock).not.toContain("--capture-raw-input-fingerprint");
    expect(writerDrainAt).toBeGreaterThan(previousAppBlockEnd);
    expect(rawFingerprintAt).toBeGreaterThan(writerDrainAt);
    expect(candidateStartAt).toBeGreaterThan(rawFingerprintAt);
    expect(deploySh).not.toContain('BODYCAST_MIGRATION_FREE_CANDIDATE" == "1" && "$previous_app_present" != "true"');
    expect(deploySh).toContain('if [[ "$previous_app_present" == "true" ]]; then');
    expect(deploySh).toContain('bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert');
    expect(deploySh).toContain("BODYCAST_EXPECTED_RAW_SOURCE_FINGERPRINT");
    expect(deploySh).toContain("BODYCAST_EXPECTED_HEALTH_SYNC_AUDIT_RETENTION_BASELINE");
    expect(deploySh).toContain('bash "$ROOT_DIR/scripts/production-traffic-cutover.sh" migration-free-serving');

    const migrationFreeCutoverAt = deploySh.indexOf(
      'if [[ "$BODYCAST_MIGRATION_FREE_CANDIDATE" == "1" ]]; then',
      candidateStartAt,
    );
    const migrationFreeCutoverBlock = deploySh.slice(
      migrationFreeCutoverAt,
      deploySh.indexOf('\nif [[ "$BODYCAST_NON_SERVING_DEPLOY"', migrationFreeCutoverAt),
    );
    expect(migrationFreeCutoverBlock).toContain('BODYCAST_DEPLOY_SHA="$DEPLOY_SHA"');
    expect(deploySh).toContain("export BODYCAST_RELEASE_WORKFLOW_RUN_ID BODYCAST_RELEASE_WORKFLOW_RUN_ATTEMPT");
    expect(deploySh).toContain("export APP_HOST CADDY_ROUTES_PATH");
    expect(migrationFreeCutoverBlock).not.toMatch(
      /(?:^|\s)(?:DEPLOY_SHA|BODYCAST_RELEASE_WORKFLOW_RUN_ID|BODYCAST_RELEASE_WORKFLOW_RUN_ATTEMPT|APP_HOST|CADDY_ROUTES_PATH)=/,
    );
  });

  it("never starts the DB and prevents Compose dependency startup during read-only preflight", () => {
    expect(deploySh).not.toMatch(/compose\s+up\s+-d\s+db\b/);
    expect(deploySh).not.toMatch(/compose\s+up\s+-d\s+\"\$DB/);
    expect(preflightSh).not.toMatch(/compose\s+up\s+-d\s+db\b/);
    expect(deploySh).toContain('compose up -d --no-deps --force-recreate "$APP_SERVICE"');
    expect(deploySh).toContain("Existing production database is unavailable; deploy will not start it.");
    expect(preflightSh).toContain('docker inspect --format');
    expect(preflightSh).toContain('run --rm --no-deps --entrypoint npx migrate prisma migrate status');
    expect(preflightSh).not.toMatch(/^\s*(?:compose.*run|npx|prisma)\s+.*prisma\s+migrate\s+deploy/m);
  });

  it("prepares and validates a fixed serving route off-live before the final main fence", () => {
    expect(routePathSh).toContain('realpath -e -- "$requested_path"');
    expect(routePathSh).toContain('CADDY_ROUTES_PATH="$canonical_path"');
    expect(routePrimitivesSh).toContain('mktemp "${route_parent}/.bodycast-route-stage.XXXXXX"');
    expect(routePrimitivesSh).toContain('caddy validate --adapter caddyfile --config -');
    expect(routePrimitivesSh).not.toContain("bodycast_write_route");
    expect(deploySh).not.toContain("bodycast_write_route");
    expect(deploySh).not.toContain("bodycast_stage_route_config");

    const mainFenceAt = deploySh.lastIndexOf("assert_current_main_sha\nbodycast_assert_safe_routes_location");
    const routeStageCheckAt = deploySh.indexOf('[[ -f "$route_stage"', mainFenceAt);
    const commitAt = deploySh.indexOf("release_state=\"SERVING_COMMIT\"", routeStageCheckAt);
    expect(deploySh).not.toContain("run_v4_traffic_check");
    expect(deploySh).toContain("--capture-raw-input-fingerprint");
    expect(deploySh).toContain("BODYCAST_HEALTH_SYNC_AUDIT_RETENTION_BASELINE");
    expect(deploySh).toContain("BODYCAST_HEALTH_SYNC_AUDIT_PRUNE_V1");
    expect(deploySh).not.toContain("--hold-currentness-fence");
    expect(deploySh).toContain('bash "$ROOT_DIR/scripts/production-traffic-cutover.sh" migration-free-serving');
    const trainingCurrentWaitAt = cutoverSh.indexOf("--wait-training-refresh-current");
    const activeEnergyConvergenceAt = cutoverSh.indexOf("--owner-authorized-active-energy-convergence");
    const currentnessFenceAt = cutoverSh.indexOf("--hold-currentness-fence --expected-raw-input-fingerprint");
    expect(cutoverSh).toContain('if [[ "$migration_free_serving" == "true" ]]; then');
    expect(cutoverSh).toContain("Owner-authorized Active Energy convergence did not complete; traffic remains in maintenance.");
    expect(trafficCheck).toContain("--owner-authorized-active-energy-convergence");
    expect(trafficCheck).toContain("exact Prisma database identity");
    expect(trafficCheck).toContain("recalculateModelEpisode({ requireDependentStages: true })");
    expect(trafficCheck).toContain("rebuildUnifiedExperimentalPhysiologyStateV1({");
    expect(trafficCheck).toContain("fromDate: recalculation.effectiveReplayFromDate");
    expect(trafficCheck).toContain("targetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION");
    expect(trafficCheck.indexOf("recalculateModelEpisode({ requireDependentStages: true })"))
      .toBeLessThan(trafficCheck.indexOf("rebuildUnifiedExperimentalPhysiologyStateV1({"));
    expect(trainingCurrentWaitAt).toBeGreaterThan(-1);
    expect(activeEnergyConvergenceAt).toBeGreaterThan(trainingCurrentWaitAt);
    expect(currentnessFenceAt).toBeGreaterThan(activeEnergyConvergenceAt);
    expect(cutoverSh).toContain("--hold-currentness-fence --expected-raw-input-fingerprint");
    expect(cutoverSh).toContain("BODYCAST_EXPECTED_HEALTH_SYNC_AUDIT_RETENTION_BASELINE");
    expect(cutoverSh).toContain("BODYCAST_EXPECTED_HEALTH_SYNC_AUDIT_PRUNE_EVENTS");
    expect(modelForecastService).toContain("if (!v4IsCurrent) return blockedV2");
    expect(modelForecastService).toContain("latestUnifiedRow?.modelRevision !== UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION");
    expect(mainFenceAt).toBeGreaterThan(-1);
    expect(routeStageCheckAt).toBeGreaterThan(mainFenceAt);
    expect(commitAt).toBeGreaterThan(routeStageCheckAt);
  });

  it("waits longer for cleanup evidence than the bounded cleanup transaction", () => {
    const cleanupSource = readFileSync(resolve("src/modules/health/health-sync-audit.ts"), "utf8");
    const cleanupTimeoutMs = Number(cleanupSource.match(/timeout:\s*([\d_]+),/)?.[1]?.replaceAll("_", ""));
    const cleanupMaxWaitMs = Number(cleanupSource.match(/maxWait:\s*([\d_]+),/)?.[1]?.replaceAll("_", ""));
    const evidenceStart = deploySh.indexOf('prune_event_lines=""');
    const evidenceBlock = deploySh.slice(evidenceStart, deploySh.indexOf('\nfi\n\nif [[ "$active_schema_cutover"', evidenceStart));
    const evidenceWaitSeconds = Number(evidenceBlock.match(/for attempt in \$\(seq 1 (\d+)\); do/)?.[1]);

    expect(cleanupTimeoutMs).toBeGreaterThan(0);
    expect(cleanupMaxWaitMs).toBeGreaterThan(0);
    expect(evidenceStart).toBeGreaterThan(-1);
    expect(evidenceWaitSeconds * 1_000).toBeGreaterThan(cleanupMaxWaitMs + cleanupTimeoutMs);
  });

  it("leaves pre-commit failures fail-closed without assuming the prior runtime can be reproduced", () => {
    const failureAt = deploySh.indexOf("release_failure() {");
    const failureEnd = deploySh.indexOf("trap release_failure ERR", failureAt);
    const failureBody = deploySh.slice(failureAt, failureEnd);
    expect(failureBody).toContain('release_state" == "PREPARE"');
    expect(failureBody).toContain("traffic remains in maintenance");
    expect(failureBody).toContain("bodycast_probe_public_maintenance");
    expect(failureBody).toContain('maintenance_confirmed" == "true"');
    expect(failureBody).toContain("stop_candidate_fail_closed");
    expect(failureBody).toContain("Automatic prior-app restoration is disabled because this attempt has no proof of the exact prior runtime configuration.");
    expect(failureBody).not.toContain("compose up");
    expect(failureBody).not.toContain("publish_captured_previous_route");
    expect(failureBody).not.toContain("clear_bodycast_release_marker");
  });

  it("reports post-commit public verification failure without rolling back the committed route", () => {
    expect(deploySh).toContain("post_commit_probe_failed=true");
    expect(deploySh).toContain('if [[ "${post_commit_probe_failed}" == "true" ]]');
    expect(deploySh).toContain('echo "Post-commit public verification failed; release remains committed and requires read-only investigation." >&2');
    const committedAt = deploySh.indexOf('release_state="COMMITTED"');
    expect(deploySh.slice(committedAt)).not.toContain("publish_and_confirm_maintenance");
    expect(deploySh.slice(committedAt)).not.toContain("stop_candidate_fail_closed");
  });

  it("binds prior and candidate stop operations to captured same-attempt container identities", () => {
    expect(deploySh).toContain('previous_app_container_id="$(docker inspect --format \'{{.Id}}\' "$APP_CONTAINER")"');
    expect(deploySh).toContain('candidate_container_id="$(docker inspect --format \'{{.Id}}\' "$APP_CONTAINER")"');
    expect(deploySh).toContain('stop_exact_app_container "$previous_app_sha" "$previous_app_image_id" "$previous_app_container_id"');
    expect(deploySh).toContain('stop_exact_app_container "$DEPLOY_SHA" "$candidate_image_id" "$candidate_container_id"');
    expect(deploySh).toContain('app_container_id" == "$expected_container_id"');
  });

  it("keeps ordinary deploy migration-free and uses the owner-gated fixed migration script", () => {
    expect(deploySh).not.toMatch(/npx\s+prisma\s+migrate\s+deploy|prisma\s+migrate\s+deploy(?!\.)/);
    expect(deploySh).not.toMatch(/prisma\s+migrate\s+reset/);
    expect(deploySh).not.toMatch(/selection-v1|historical replay/i);
    expect(preflightSh).toContain("prisma migrate status");
    expect(preflightSh).not.toContain("--entrypoint npx migrate prisma migrate deploy");
    expect(deploySh).not.toContain("bodycast-production-operation");
    expect(deploySh).toContain("bodycast_acquire_production_release_lock");
    expect(deploySh).toContain("BODYCAST_MIGRATION_FREE_CANDIDATE");
    expect(deploySh).toContain("production-writer-drain.sh");
    expect(deploySh).toContain("bodycast_capture_production_db_identity");
    expect(preflightSh).toContain("BODYCAST_EXPECTED_MIGRATION_COUNT");
    expect(preflightSh).toContain('"_prisma_migrations"');
    expect(readFileSync(resolve("scripts/production-db-identity.sh"), "utf8"))
      .toContain("bodycast_assert_production_db_identity_unchanged");
    expect(migrateSh).toContain("authorization-envelope.json");
    expect(migrateSh).toContain("--before-ddl");
    expect(migrateSh).toContain("run-prisma-migrate-with-lock-timeout.mjs");
    expect(migrateGuard).toContain("writeDdlStartingMarker");
    expect(migrateGuard).toContain("acknowledgePrismaSpawn");
    expect(migrateGuard.indexOf("markerWriter({")).toBeLessThan(migrateGuard.indexOf('spawn("npx", ["prisma", "migrate", "deploy"]'));
    expect(migrateSh).not.toMatch(/compose\s+up\s+-d\s+db\b/);
    expect(migrateSh).not.toContain("bodycast-production-operation");
    expect(migrateGuard).toContain("verifyFinalGuardReceipt");
    expect(migrateGuard).toContain("readPrismaDatabaseIdentity");
    expect(migrateGuard).toContain("assertPrismaTargetMatchesSignedIdentity");
    expect(migrateGuard).not.toContain("OIDC");
  });

  it("retains schema marker requirements and exact release image labels", () => {
    expect(deploySh).toContain('BODYCAST_MARKER_RELEASE_SHA" == "$DEPLOY_SHA');
    const scriptAt = deploySh.indexOf("production-schema-deploy-handoff.mjs");
    const checkAt = deploySh.indexOf("--check", scriptAt);
    const preflightAt = deploySh.indexOf('bash "$ROOT_DIR/scripts/deploy-preflight-schema.sh"', checkAt);
    const applyAt = deploySh.indexOf("--apply", checkAt);
    const exactShaAt = deploySh.indexOf('BODYCAST_MARKER_RELEASE_SHA" == "$DEPLOY_SHA', applyAt);
    expect(checkAt).toBeGreaterThan(-1);
    expect(preflightAt).toBeGreaterThan(checkAt);
    expect(applyAt).toBeGreaterThan(preflightAt);
    expect(exactShaAt).toBeGreaterThan(applyAt);
    expect(deploySh).toContain('BODYCAST_NON_SERVING_DEPLOY" == "1"');
    expect(deploySh).toContain('BODYCAST_MARKER_MANIFEST_ID" == "unified-v4-republication-v1"');
    expect(deploySh).toContain('BODYCAST_MARKER_MANIFEST_ID" == "training-mutation-ledger-refresh-queue-v1"');
    expect(deploySh).toContain('write_bodycast_release_marker "$DEPLOY_SHA" app-ready');
    expect(migrateSh).toContain("read_bodycast_release_marker");
    expect(migrateSh).toContain("only an exact verified pre-spawn marker has an owner-authorized forward-resume path");
    expect(migrateSh).toContain('"$FORWARD_SOURCE_MARKER_SCHEMA_VERSION" == 2');
    expect(migrateSh).toContain('"$SOURCE_MARKER_DIGEST"');
    expect(releaseMarkerSh).toContain("Both current and legacy production release markers exist; state is ambiguous.");
    expect(migrateGuard).toContain('["prisma", "migrate", "deploy"]');
    expect(releaseMarkerSh).toMatch(/ddl-started\|schema-applied\|app-ready/);
    expect(composeYaml).toContain("org.bodycast.release-sha: ${BODYCAST_DEPLOY_SHA:-unknown}");
    expect(deploySh).toContain('[[ "$deployed_container_sha" == "$DEPLOY_SHA" ]]');
    expect(deploySh).toContain('[[ "$deployed_container_image_id" == "$candidate_image_id" ]]');
    expect(cutoverSh).toContain("SERVING_COMMIT_OCCURRED=true");
  });
});
