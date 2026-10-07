import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const deploySh = readFileSync(resolve("scripts/deploy.sh"), "utf8");
const preflightSh = readFileSync(resolve("scripts/deploy-preflight-schema.sh"), "utf8");
const migrateSh = readFileSync(resolve("scripts/deploy-migrate.sh"), "utf8");
const migrateGuard = readFileSync(resolve("scripts/run-prisma-migrate-with-lock-timeout.mjs"), "utf8");
const cutoverSh = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
const releaseMarkerSh = readFileSync(resolve("scripts/production-release-marker.sh"), "utf8");
const composeYaml = readFileSync(resolve("docker-compose.prod.yml"), "utf8");

describe("production deploy script safety contracts", () => {
  it("runs schema preflight before app cutover", () => {
    const preflightAt = deploySh.indexOf("deploy-preflight-schema.sh");
    const cutOverAt = deploySh.indexOf("app_cut_over=true");
    expect(preflightAt).toBeGreaterThan(-1);
    expect(cutOverAt).toBeGreaterThan(preflightAt);
    expect(deploySh.slice(cutOverAt)).toContain('force-recreate "$APP_SERVICE"');
    expect(deploySh.indexOf("compose build \"$APP_SERVICE\"")).toBeGreaterThan(preflightAt);
  });

  it("does not recreate the running app on pre-cutover failure", () => {
    expect(deploySh).toContain('app_cut_over=false');
    expect(deploySh).toContain("leaving the running application unchanged");
    expect(deploySh).toMatch(/if \[\[ "\$app_cut_over" != "true" \]\]/);
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
    expect(migrateSh).toContain("write_bodycast_release_marker \"$RELEASE_SHA\" ddl-started");
    expect(migrateSh).toContain("write_bodycast_release_marker \"$RELEASE_SHA\" schema-applied");
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

  it("keeps production migrate behind signed final authorization with no confirmation-variable bypass", () => {
    expect(migrateSh).toContain("authorization-envelope.json");
    expect(migrateSh).toContain("execution-proof.jwt");
    expect(migrateSh).toContain("BODYCAST_DDL_ATTESTATION_NONCE_DIR");
    expect(migrateSh).toContain("BODYCAST_EXECUTION_PROOF");
    expect(migrateSh).toContain("BODYCAST_EXECUTION_PROOF_HANDOFF");
    expect(migrateSh).toContain("BODYCAST_DDL_CHALLENGE:");
    expect(migrateSh).toContain("BODYCAST_DDL_EXECUTION_CHALLENGE");
    expect(migrateSh).toContain("--before-ddl");
    expect(migrateSh).toContain("final-guard-receipt.json");
    expect(migrateGuard).toContain("verifyFinalGuardReceipt");
    expect(migrateGuard).toContain("verifyGitHubExecutionProof");
    expect(migrateGuard).toContain("assertCurrentMigrationRunMatchesProof");
    expect(migrateGuard).toContain("assertPrismaTargetMatchesSignedIdentity");
    expect(migrateGuard).not.toContain("BODYCAST_FINAL_GUARD_READY");
    expect(migrateGuard).not.toContain("CONFIRM_PRODUCTION_MIGRATE");
    expect(migrateSh).toMatch(/compose --profile tools run --rm --no-deps[\s\S]*\bmigrate\b/);
  });
});
