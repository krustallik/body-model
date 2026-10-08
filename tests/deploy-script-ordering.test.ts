import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const deploySh = readFileSync(resolve("scripts/deploy.sh"), "utf8").replace(/\r\n/g, "\n");
const mainFreshnessSh = readFileSync(resolve("scripts/deploy-main-freshness.sh"), "utf8").replace(/\r\n/g, "\n");
const deployWorkflow = readFileSync(resolve(".github/workflows/deploy-production.yml"), "utf8").replace(/\r\n/g, "\n");
const preflightSh = readFileSync(resolve("scripts/deploy-preflight-schema.sh"), "utf8");
const migrateSh = readFileSync(resolve("scripts/deploy-migrate.sh"), "utf8");
const migrateGuard = readFileSync(resolve("scripts/run-prisma-migrate-with-lock-timeout.mjs"), "utf8");
const cutoverSh = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
const releaseMarkerSh = readFileSync(resolve("scripts/production-release-marker.sh"), "utf8");
const composeYaml = readFileSync(resolve("docker-compose.prod.yml"), "utf8");

describe("production deploy script safety contracts", () => {
  it("keeps automatic workflow_run deploy and rechecks main after deployment creation immediately before SSH", () => {
    expect(deployWorkflow).toContain("workflow_run:");
    expect(deployWorkflow).toContain("workflows:\n      - BodyCast CI/CD");
    const deploymentObjectAt = deployWorkflow.indexOf("- name: Create GitHub deployment");
    const sshFenceAt = deployWorkflow.indexOf("- name: Recheck canonical main immediately before SSH deploy");
    const sshAt = deployWorkflow.indexOf("- name: Deploy over SSH (exact SHA, no migrate)");
    expect(deploymentObjectAt).toBeGreaterThan(-1);
    expect(sshFenceAt).toBeGreaterThan(deploymentObjectAt);
    expect(sshAt).toBeGreaterThan(sshFenceAt);
    expect(deployWorkflow.slice(sshFenceAt, sshAt)).toContain('gh api "repos/${{ github.repository }}/commits/main" --jq .sha');
    expect(deployWorkflow.slice(sshFenceAt, sshAt)).toContain("isCurrentMainSha(CANDIDATE");
  });

  it("fetches canonical origin/main and fences both fallback route and Caddy serving mutations", () => {
    expect(mainFreshnessSh).toContain("git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main");
    expect(mainFreshnessSh).toContain("git rev-parse --verify 'refs/remotes/origin/main^{commit}'");
    expect(mainFreshnessSh).toMatch(/\[\[ "\$candidate_sha" == "\$canonical_main_sha" \]\]/);

    const hostClientAt = deploySh.indexOf('if [[ -x "$HOST_OPERATION_CLIENT" ]]');
    expect(deploySh.indexOf("assert_current_main_sha")).toBeGreaterThan(-1);
    expect(deploySh.indexOf("assert_current_main_sha")).toBeLessThan(hostClientAt);
    expect(deploySh).toContain("--canonical-main-fence fresh-current-main-v1");
    expect(deploySh.indexOf("assert_current_main_sha\ncompose up -d \"$DB_SERVICE\""))
      .toBeGreaterThan(-1);
    const buildAt = deploySh.indexOf('compose build "$APP_SERVICE"');
    const maintenanceBoundaryAt = deploySh.indexOf('maintenance_started=true\n  bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" maintenance', buildAt);
    const appRecreateFenceAt = deploySh.indexOf("assert_current_main_sha\ncompose up -d --no-deps --force-recreate", buildAt);
    const appRecreateAt = deploySh.indexOf('compose up -d --no-deps --force-recreate "$APP_SERVICE"', appRecreateFenceAt);
    const serveFenceAt = deploySh.lastIndexOf("assert_current_main_sha\n  bash \"${ROOT_DIR}/scripts/production-traffic-cutover.sh\" serve");
    const serveAt = deploySh.lastIndexOf('bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" serve');
    const stageValidationAt = cutoverSh.indexOf('caddy validate --adapter caddyfile --config -');
    const routeFenceAt = cutoverSh.indexOf('bodycast_assert_current_main_sha "$freshness_sha"');
    const routeWriteAt = cutoverSh.indexOf('mv -f -- "$temporary" "$ROUTE_FILE"');
    const caddyReloadAt = cutoverSh.indexOf('if ! docker exec gymbeam-caddy caddy reload');
    expect(maintenanceBoundaryAt).toBeGreaterThan(buildAt);
    expect(appRecreateFenceAt).toBeGreaterThan(maintenanceBoundaryAt);
    expect(appRecreateAt).toBeGreaterThan(appRecreateFenceAt);
    expect(serveFenceAt).toBeGreaterThan(appRecreateAt);
    expect(serveAt).toBeGreaterThan(serveFenceAt);
    expect(cutoverSh).toContain('source "${ROOT_DIR}/scripts/deploy-main-freshness.sh"');
    expect(stageValidationAt).toBeGreaterThan(-1);
    expect(stageValidationAt).toBeLessThan(routeFenceAt);
    expect(routeFenceAt).toBeGreaterThan(-1);
    expect(routeFenceAt).toBeLessThan(routeWriteAt);
    expect(routeWriteAt).toBeLessThan(caddyReloadAt);
    expect(cutoverSh).toContain('write_route "reverse_proxy ${APP_CONTAINER}:3000" "$expected_release_sha"');
    expect(cutoverSh).toContain('verify_exact_maintenance_route');
    expect(cutoverSh.slice(routeWriteAt)).not.toContain('bodycast_assert_current_main_sha "$freshness_sha"');
    expect(cutoverSh).toContain('Stage beside, but outside, the live routes directory');
    expect(deploySh).toContain("previous app and route remain unchanged");
  });

  it("runs schema preflight before app cutover", () => {
    const preflightAt = deploySh.indexOf("deploy-preflight-schema.sh");
    const cutOverAt = deploySh.indexOf('compose up -d --no-deps --force-recreate "$APP_SERVICE"');
    expect(preflightAt).toBeGreaterThan(-1);
    expect(cutOverAt).toBeGreaterThan(preflightAt);
    expect(deploySh.slice(cutOverAt)).toContain('force-recreate "$APP_SERVICE"');
    expect(deploySh.indexOf("compose build \"$APP_SERVICE\"")).toBeGreaterThan(preflightAt);
    expect(deploySh.lastIndexOf('maintenance_started=true\n  bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" maintenance'))
      .toBeGreaterThan(deploySh.indexOf('compose build "$APP_SERVICE"'));
  });

  it("does not recreate the running app on pre-cutover failure", () => {
    expect(deploySh).toContain('maintenance_started=false');
    expect(deploySh).toContain("previous app and route remain serving");
    expect(deploySh).toContain("Release candidate was superseded before maintenance");
    expect(deploySh).toContain("Previously serving app");
    expect(deploySh).toContain("traffic remains in maintenance");
  });

  it("requires exact 40-character DEPLOY_SHA", () => {
    expect(deploySh).toMatch(/DEPLOY_SHA.*\[0-9a-f\]\{40\}/);
  });

  it("keeps an incompatible-schema cutover on the exact SHA through non-serving startup", () => {
    expect(deploySh).toContain("source \"$ROOT_DIR/scripts/production-release-marker.sh\"");
    expect(deploySh).toContain('BODYCAST_MARKER_RELEASE_SHA" == "$DEPLOY_SHA');
    expect(deploySh).toContain('BODYCAST_NON_SERVING_DEPLOY" == "1"');
    expect(deploySh).toContain('write_bodycast_release_marker "$DEPLOY_SHA" app-ready');
    expect(deploySh).toContain("refusing to restart the prior binary");
    expect(migrateSh).not.toContain("write_bodycast_release_marker");
    expect(migrateSh).toContain("read_bodycast_release_marker");
    expect(migrateSh).toContain("existing schema-cutover marker requires explicit recovery");
    expect(migrateSh).toContain('HOST_OPERATION_CLIENT="/usr/local/bin/bodycast-production-operation"');
    expect(migrateSh).toContain('"$HOST_OPERATION_CLIENT" migration-challenge');
    expect(migrateSh).toContain('"$HOST_OPERATION_CLIENT" forward-migration');
    expect(releaseMarkerSh).toContain("state=%s");
    expect(releaseMarkerSh).toContain('"$release_sha" "$state"');
    expect(releaseMarkerSh).toMatch(/ddl-started\|schema-applied\|app-ready/);
    expect(releaseMarkerSh).toContain("active-energy-unified-v2");
    expect(composeYaml).toContain("org.bodycast.release-sha: ${BODYCAST_DEPLOY_SHA:-unknown}");
  });

  it("requires V3 postflight and V4 currentness before serving and stops on health failure", () => {
    expect(cutoverSh).toContain('MODE" == "v3-postflight"');
    expect(cutoverSh).toContain("unified-v3-postflight.mjs --profile-id 1");
    expect(cutoverSh).toContain("unified-v4-traffic-check.mjs --profile-id 1");
    expect(cutoverSh).toContain("require_ready_release_marker");
    expect(cutoverSh).toContain("enter_maintenance");
    expect(cutoverSh).toContain("docker update --restart=no");
    expect(cutoverSh).toContain("compose rm --force app");
    expect(cutoverSh).toContain("manually restarted");
    expect(cutoverSh).toContain("clear_bodycast_release_marker");
  });

  it("never runs migrate deploy / reset / replay / selection activation on ordinary path", () => {
    expect(deploySh).not.toMatch(/npx\s+prisma\s+migrate\s+deploy|prisma\s+migrate\s+deploy(?!\.)/);
    expect(deploySh).not.toMatch(/prisma\s+migrate\s+reset/);
    expect(deploySh).not.toMatch(/selection-v1/);
    expect(deploySh.toLowerCase()).not.toMatch(/historical replay/);
    // Preflight may mention migrate deploy in operator guidance, but must only execute status.
    expect(preflightSh).toMatch(/prisma migrate status/);
    expect(preflightSh).not.toMatch(/run --rm migrate(?!\s)/);
    expect(preflightSh).not.toMatch(/entrypoint npx migrate prisma migrate deploy/);
  });

  it("keeps production migration behind the host challenge and stdin proof handoff", () => {
    expect(migrateSh).toContain("authorization-envelope.json");
    expect(migrateSh).toContain("BODYCAST_DDL_CHALLENGE:");
    expect(migrateSh).toContain("--challenge-id \"$CHALLENGE_ID\"");
    expect(migrateSh).toContain("--challenge-digest \"$CHALLENGE_DIGEST\"");
    expect(migrateSh).toContain("--execution-proof-stdin");
    expect(migrateSh).toContain("IFS= read -r EXECUTION_PROOF");
    expect(migrateSh).toContain("--before-ddl");
    expect(migrateSh).toContain("final-guard-receipt.json");
    const challengeRequestAt = migrateSh.indexOf('"$HOST_OPERATION_CLIENT" migration-challenge');
    const challengeHandoffAt = migrateSh.indexOf("BODYCAST_DDL_CHALLENGE:");
    const proofReadAt = migrateSh.indexOf("IFS= read -r EXECUTION_PROOF");
    const postOidcGuardSectionAt = migrateSh.indexOf("# Re-sample PostgreSQL sessions and host topology after the OIDC round trip.");
    const postOidcGuardAt = migrateSh.indexOf("--before-ddl", postOidcGuardSectionAt);
    const forwardMigrationAt = migrateSh.indexOf('"$HOST_OPERATION_CLIENT" forward-migration');
    expect(challengeRequestAt).toBeGreaterThan(-1);
    expect(challengeRequestAt).toBeLessThan(challengeHandoffAt);
    expect(challengeHandoffAt).toBeLessThan(proofReadAt);
    expect(proofReadAt).toBeLessThan(postOidcGuardSectionAt);
    expect(postOidcGuardAt).toBeGreaterThan(postOidcGuardSectionAt);
    expect(postOidcGuardAt).toBeLessThan(forwardMigrationAt);
    for (const obsoleteCallerContract of [
      "execution-proof.jwt",
      "BODYCAST_DDL_ATTESTATION_NONCE_DIR",
      "BODYCAST_EXECUTION_PROOF",
      "BODYCAST_EXECUTION_PROOF_HANDOFF",
      "BODYCAST_DDL_EXECUTION_CHALLENGE",
    ]) {
      expect(migrateSh).not.toContain(obsoleteCallerContract);
    }
    expect(migrateSh).not.toMatch(/\bprisma\s+migrate\s+deploy\b/i);
    expect(migrateGuard).toContain("verifyFinalGuardReceipt");
    expect(migrateGuard).toContain("verifyGitHubExecutionProof");
    expect(migrateGuard).toContain("assertCurrentMigrationRunMatchesProof");
    expect(migrateGuard).toContain("assertPrismaTargetMatchesSignedIdentity");
    expect(migrateGuard).not.toContain("BODYCAST_FINAL_GUARD_READY");
    expect(migrateGuard).not.toContain("CONFIRM_PRODUCTION_MIGRATE");
  });
});
