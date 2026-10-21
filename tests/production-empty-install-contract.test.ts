import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const host = readFileSync(resolve("scripts/production-empty-install-host.sh"), "utf8").replace(/\r\n/g, "\n");
const ledger = readFileSync(resolve("scripts/production-empty-install-ledger.mjs"), "utf8");
const workflow = readFileSync(resolve(".github/workflows/deploy-production.yml"), "utf8").replace(/\r\n/g, "\n");
const safetyWorkflow = readFileSync(resolve(".github/workflows/production-migration-safety-ci.yml"), "utf8").replace(/\r\n/g, "\n");
const dockerfile = readFileSync(resolve("Dockerfile"), "utf8").replace(/\r\n/g, "\n");

describe("one-time fresh empty BodyCast install contract", () => {
  it("requires the new VPS, exact clean current-main checkout, owner run binding, and an unused host", () => {
    expect(host).toContain('BODYCAST_EMPTY_INSTALL_CONFIRMATION:-');
    expect(host).toContain('BODYCAST_EMPTY_INSTALL_TARGET_IP:-');
    expect(host).toContain('"$EXPECTED_TARGET_IP" == "169.58.239.149"');
    expect(host).toContain('bodycast_assert_current_main_sha "$RELEASE_SHA"');
    expect(host).toContain('git status --porcelain=v1 --untracked-files=all');
    expect(host).toContain('[[ ! -e "$ROOT_DIR/.env" && ! -L "$ROOT_DIR/.env" ]]');
    expect(host).toContain('[[ ! -e "$ROOT_DIR/.git/bodycast-production-empty-install"');
    expect(host).toContain('DB_VOLUME="bodycast-postgres-prod"');
    expect(host).toContain('EXPECTED_SHARED_NETWORK="gymbeam-internal"');
    expect(host).toContain('EXPECTED_CADDY="gymbeam-caddy"');
  });

  it("proves the database and all 74 migration checksums before starting the app or publishing the route", () => {
    const emptyDbCheckAt = host.indexOf('public_table_count="$(compose exec');
    const migrateAt = host.indexOf("prisma migrate deploy");
    const verifyAt = host.indexOf("--production-empty-install)");
    const schemaMarkerAt = host.indexOf("state=schema-applied");
    const appDeployAt = host.indexOf('bash "$ROOT_DIR/scripts/deploy.sh"');
    expect(emptyDbCheckAt).toBeGreaterThan(-1);
    expect(migrateAt).toBeGreaterThan(emptyDbCheckAt);
    expect(verifyAt).toBeGreaterThan(migrateAt);
    expect(schemaMarkerAt).toBeGreaterThan(verifyAt);
    expect(appDeployAt).toBeGreaterThan(schemaMarkerAt);
    expect(host).toContain('"$migration_count" == "74"');
    expect(host).toContain("--production-empty-install");
    expect(host).toContain("BODYCAST_NON_SERVING_DEPLOY=0");
    expect(host).toContain("v4=not-initialized profileCount=0");
  });

  it("keeps migration and app operations one-shot and does not reset or remove database state", () => {
    expect(host).toContain("prior attempt marker already exists");
    expect(host).toContain("without retry");
    expect(host).not.toMatch(/prisma\s+migrate\s+reset/);
    expect(host).not.toMatch(/docker\s+(?:volume\s+rm|system\s+prune|compose\s+down)/);
    expect(host).not.toMatch(/rm\s+-rf[^\n]*(?:\.env|postgres|volume)/i);
    expect(ledger).toContain('url.hostname !== "db"');
    expect(ledger).toContain('database !== "bodycast"');
    expect(ledger).toContain("sourceCounts");
  });

  it("adds an owner-only, exact-main fresh-install mode bound to the new VPS address", () => {
    expect(workflow).toContain("fresh_empty_install:");
    expect(workflow).toContain('"initialize-empty-bodycast-db"');
    expect(workflow).toContain('[[ "$SSH_HOST" == "169.58.239.149" ]]');
    expect(workflow).toContain('if [[ "$DEPLOY_MODE" == "fresh-empty-install" ]]; then');
    expect(workflow).toContain("production-empty-install-host.sh");
    expect(workflow).toContain("assertTrustedOwnerWorkflowRun");
    expect(workflow).toContain("Exact current main SHA");
    expect(safetyWorkflow).toContain("scripts/production-empty-install-host.sh");
    expect(dockerfile).toContain("COPY scripts/production-empty-install-ledger.mjs ./scripts/");
  });
});
