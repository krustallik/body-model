import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const deploySh = readFileSync(resolve("scripts/deploy.sh"), "utf8").replace(/\r\n/g, "\n");
const deployWorkflow = readFileSync(resolve(".github/workflows/deploy-production.yml"), "utf8").replace(/\r\n/g, "\n");
const preflightSh = readFileSync(resolve("scripts/deploy-preflight-schema.sh"), "utf8");
const migrateSh = readFileSync(resolve("scripts/deploy-migrate.sh"), "utf8");
const migrateGuard = readFileSync(resolve("scripts/run-prisma-migrate-with-lock-timeout.mjs"), "utf8");
const cutoverSh = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
const routePrimitivesSh = readFileSync(resolve("scripts/production-route-primitives.sh"), "utf8");
const routePathSh = readFileSync(resolve("scripts/production-route-path.sh"), "utf8");
const releaseMarkerSh = readFileSync(resolve("scripts/production-release-marker.sh"), "utf8");
const composeYaml = readFileSync(resolve("docker-compose.prod.yml"), "utf8");

describe("production maintenance-first deploy safety contracts", () => {
  it("requires manual owner authorization and never starts an automatic post-merge deployment", () => {
    expect(deployWorkflow).toContain("workflow_dispatch:");
    expect(deployWorkflow).not.toContain("workflow_run:");
    expect(deployWorkflow).toContain('github.actor_id }}');
    expect(deployWorkflow).toContain('"126446430"');
    expect(deployWorkflow).toContain("assertTrustedOwnerWorkflowRun");
    expect(deployWorkflow).toContain("BODYCAST_NON_SERVING_DEPLOY=1");
    expect(deployWorkflow).toContain("BodyCast CI/CD");
    expect(deployWorkflow).not.toContain("git checkout --detach --force");
    expect(deployWorkflow).toContain('git checkout --detach "$DEPLOY_SHA"');
  });

  it("implements the approved maintenance-first state machine and live-route commit", () => {
    const states = [
      'release_state="PREPARE"',
      'release_state="MAINTENANCE_CONFIRMED"',
      'release_state="PREVIOUS_RELEASE_CAPTURED"',
      'release_state="CANDIDATE_VERIFIED"',
      'release_state="SERVING_COMMIT"',
      'release_state="COMMITTED"',
    ].map((needle) => deploySh.indexOf(needle));
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
    expect(confirmAt).toBeGreaterThan(-1);
    expect(captureAt).toBeGreaterThan(confirmAt);
    expect(stopAt).toBeGreaterThan(captureAt);
    const publishDefinitionAt = deploySh.indexOf("publish_and_confirm_maintenance() {");
    const captureDefinitionAt = deploySh.indexOf("capture_previous_release() {");
    const publishBody = deploySh.slice(publishDefinitionAt, captureDefinitionAt);
    expect(publishBody).toContain("bodycast_probe_public_maintenance");
    expect(publishBody).toContain('release_state="MAINTENANCE_CONFIRMED"');
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

    const v4At = deploySh.lastIndexOf("run_v4_traffic_check\n");
    const mainFenceAt = deploySh.lastIndexOf("assert_current_main_sha\nbodycast_assert_safe_routes_location");
    const routeStageCheckAt = deploySh.indexOf('[[ -f "$route_stage"', mainFenceAt);
    const commitAt = deploySh.indexOf("release_state=\"SERVING_COMMIT\"", routeStageCheckAt);
    expect(v4At).toBeGreaterThan(-1);
    expect(mainFenceAt).toBeGreaterThan(v4At);
    expect(routeStageCheckAt).toBeGreaterThan(mainFenceAt);
    expect(commitAt).toBeGreaterThan(routeStageCheckAt);
  });

  it("leaves pre-commit failures fail-closed without assuming the prior runtime can be reproduced", () => {
    const failureAt = deploySh.indexOf("release_failure() {");
    const failureEnd = deploySh.indexOf("trap release_failure ERR", failureAt);
    const failureBody = deploySh.slice(failureAt, failureEnd);
    expect(failureBody).toContain('release_state" == "PREPARE"');
    expect(failureBody).toContain("traffic remains in maintenance");
    expect(failureBody).toContain("stop_candidate_fail_closed");
    expect(failureBody).toContain("Automatic prior-app restoration is disabled because this attempt has no proof of the exact prior runtime configuration.");
    expect(failureBody).not.toContain("compose up");
    expect(failureBody).not.toContain("publish_captured_previous_route");
    expect(failureBody).not.toContain("clear_bodycast_release_marker");
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
    expect(deploySh).toContain('BODYCAST_NON_SERVING_DEPLOY" == "1"');
    expect(deploySh).toContain('write_bodycast_release_marker "$DEPLOY_SHA" app-ready');
    expect(migrateSh).toContain("read_bodycast_release_marker");
    expect(migrateSh).toContain("only the exact legacy V1 ddl-started marker has a supported owner-authorized forward-resume path");
    expect(releaseMarkerSh).toContain("Both current and legacy production release markers exist; state is ambiguous.");
    expect(migrateGuard).toContain('["prisma", "migrate", "deploy"]');
    expect(releaseMarkerSh).toMatch(/ddl-started\|schema-applied\|app-ready/);
    expect(composeYaml).toContain("org.bodycast.release-sha: ${BODYCAST_DEPLOY_SHA:-unknown}");
    expect(deploySh).toContain('[[ "$deployed_container_sha" == "$DEPLOY_SHA" ]]');
    expect(deploySh).toContain('[[ "$deployed_container_image_id" == "$candidate_image_id" ]]');
    expect(cutoverSh).toContain("SERVING_COMMIT_OCCURRED=true");
  });
});
