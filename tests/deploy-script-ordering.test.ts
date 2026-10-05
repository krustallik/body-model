import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const deploySh = readFileSync(resolve("scripts/deploy.sh"), "utf8");
const preflightSh = readFileSync(resolve("scripts/deploy-preflight-schema.sh"), "utf8");
const migrateSh = readFileSync(resolve("scripts/deploy-migrate.sh"), "utf8");
const migrateGuard = readFileSync(resolve("scripts/run-prisma-migrate-with-lock-timeout.mjs"), "utf8");

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
    expect(migrateSh).toContain("execution-attestation.json");
    expect(migrateSh).toContain("execution-key-certificate.json");
    expect(migrateSh).toContain("BODYCAST_DDL_ATTESTATION_NONCE_DIR");
    expect(migrateSh).toContain("BODYCAST_EXECUTION_KEY_CERTIFICATE");
    expect(migrateSh).toContain("BODYCAST_EXECUTION_ATTESTATION_HANDOFF");
    expect(migrateSh).toContain("BODYCAST_DDL_CHALLENGE:");
    expect(migrateSh).toContain("BODYCAST_DDL_EXECUTION_CHALLENGE");
    expect(migrateSh).toContain("--before-ddl");
    expect(migrateSh).toContain("final-guard-receipt.json");
    expect(migrateGuard).toContain("verifyFinalGuardReceipt");
    expect(migrateGuard).toContain("verifyExecutionAttestation");
    expect(migrateGuard).toContain("verifyExecutionKeyDelegation");
    expect(migrateGuard).toContain("assertPrismaTargetMatchesSignedIdentity");
    expect(migrateGuard).not.toContain("BODYCAST_FINAL_GUARD_READY");
    expect(migrateGuard).not.toContain("CONFIRM_PRODUCTION_MIGRATE");
    expect(migrateSh).toMatch(/compose --profile tools run --rm --no-deps[\s\S]*\bmigrate\b/);
  });
});
