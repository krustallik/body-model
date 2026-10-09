import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowDir = resolve(".github/workflows");
const releaseWorkflows = [
  "deploy-production.yml",
  "production-migration-preflight.yml",
  "production-migrate.yml",
  "activate-unified-v4-production.yml",
  "production-database-cutback.yml",
];
const legacyWorkflows = [
  "production-recovery-phase-a.yml",
  "production-recovery-phase-b.yml",
  "production-recovery-transition.yml",
];
const readOnlyDiagnosticWorkflows = ["production-checkout-diagnostic.yml"];

describe("active production release entrypoints", () => {
  it("removes the legacy authority recovery dispatch paths while preserving unrelated workflow history", () => {
    for (const name of legacyWorkflows) expect(existsSync(resolve(workflowDir, name))).toBe(false);
    const all = readdirSync(workflowDir).filter((name) => name.endsWith(".yml"));
    const productionDispatches = all.filter((name) => {
      const source = readFileSync(resolve(workflowDir, name), "utf8");
      return /production|unified-v4/i.test(name) && source.includes("workflow_dispatch:")
        && !readOnlyDiagnosticWorkflows.includes(name);
    }).sort();
    expect(productionDispatches).toEqual([...releaseWorkflows].sort());
  });

  it("keeps the production checkout diagnostic owner-only, exact-main, and read-only", () => {
    const workflow = readFileSync(resolve(workflowDir, "production-checkout-diagnostic.yml"), "utf8");
    const inspector = readFileSync(resolve("scripts/production-checkout-diagnostic.sh"), "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("diagnose-production-checkout-read-only");
    expect(workflow).toContain("126446430");
    expect(workflow).toContain("refs/heads/main");
    expect(workflow).toContain("assertTrustedOwnerWorkflowRun");
    expect(workflow).toContain("bodycast-production-release");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).toContain("Inspect checkout metadata read-only");
    expect(inspector).toContain("GIT_OPTIONAL_LOCKS=0");
    expect(inspector).toContain("status --porcelain=v1 --untracked-files=all");
    expect(inspector).toContain("rev-parse --show-toplevel");
    expect(inspector).not.toMatch(/\bgit\s+(?:fetch|checkout|reset|clean|add|commit)\b/);
    expect(inspector).not.toMatch(/\b(?:docker|psql|caddy|prisma)\b/);
  });

  it("requires pinned owner, exact current main, and shared serialization on every production dispatch", () => {
    for (const name of releaseWorkflows) {
      const source = readFileSync(resolve(workflowDir, name), "utf8");
      expect(source, name).toContain("workflow_dispatch:");
      expect(source, name).toContain("126446430");
      expect(source, name).toContain("bodycast-production-release");
      expect(source, name).toContain("refs/heads/main");
      expect(source, name).toContain("assertTrustedOwnerWorkflowRun");
      expect(source, name).toContain("commits/main");
    }
  });

  it("keeps V3, explicit V4 activation/replay, V4 postflight, and serving in one fixed host invocation", () => {
    const workflow = readFileSync(resolve(workflowDir, "activate-unified-v4-production.yml"), "utf8");
    const cutover = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
    expect(workflow).toContain("production-traffic-cutover.sh activate-v4-and-serve");
    expect(workflow).not.toContain("production-traffic-cutover.sh v3-postflight");
    expect(workflow).not.toContain("unified-v4-activate-replay.mjs --activate-v4");
    expect(cutover).toContain("bodycast_acquire_production_release_lock");
    expect(cutover).toContain("unified-v3-postflight.mjs");
    expect(cutover).toContain("unified-v4-activate-replay.mjs --activate-v4 --owner-authorized");
    expect(cutover).toContain("unified-v4-traffic-check.mjs");
    expect(cutover).toContain("production-writer-drain.sh\" --assert");
    expect(cutover).toContain("deploy-preflight-schema.sh");
    expect(cutover).toContain('write_bodycast_release_marker "$expected_release_sha" v4-ready');
    const routePublish = cutover.indexOf('bodycast_publish_staged_route "$temporary"');
    const servingCommit = cutover.indexOf("SERVING_COMMIT_OCCURRED=true", routePublish);
    const markerCleanup = cutover.indexOf("clear_bodycast_release_marker", routePublish);
    expect(routePublish).toBeGreaterThan(-1);
    expect(servingCommit).toBeGreaterThan(routePublish);
    expect(markerCleanup).toBeGreaterThan(servingCommit);
    expect(cutover).toContain('marker_status" -eq 1 && -f "$recovery_record"');
  });

  it("uses immutable previous image plus a runtime-config digest for manual cutback only", () => {
    const cutback = readFileSync(resolve("scripts/production-database-cutback.sh"), "utf8");
    const workflow = readFileSync(resolve(workflowDir, "production-database-cutback.yml"), "utf8");
    const capture = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
    expect(cutback).toContain("RESTORE_PRE_DDL_DATABASE");
    expect(cutback).toContain("production-writer-drain.sh\" --assert");
    expect(cutback).toContain("production-app-runtime-digest.mjs");
    expect(cutback).toContain("--single-transaction");
    expect(cutback).toContain("database-restored");
    expect(cutback).toContain("rollback-app-ready");
    expect(cutback).toContain("bodycast_failed_${FAILED_MIGRATION_RUN_ID}");
    expect(cutback).toContain("bodycast-production-pre-ddl-release");
    expect(cutback).toContain('record_lines" == "6"');
    expect(workflow).toContain('echo "current_main_sha=$CURRENT_MAIN_SHA" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('flock -n 9');
    expect(workflow).toContain('CUTBACK_RUN_ATTEMPT="$5"');
    expect(workflow).toContain('/tmp/bodycast-cutback-context-$CUTBACK_RUN_ID-$CUTBACK_RUN_ATTEMPT');
    expect(capture).toContain("previousRuntimeConfigDigest");
  });

  it("keeps the destructive DB swap behind owner context, maintenance, restore, history, and compatibility gates", () => {
    const cutback = readFileSync(resolve("scripts/production-database-cutback.sh"), "utf8");
    const ordered = [
      "--verify-context",
      "bodycast_verify_exact_maintenance_route",
      "production-writer-drain.sh\" --assert",
      "pg_restore --list",
      "--verify-live-identity",
      "CREATE DATABASE ${stage_db}",
      "--verify-restored",
      "--verify-previous-release",
      "ALTER DATABASE bodycast RENAME TO ${failed_db}",
      'write_bodycast_release_marker "$FAILED_RELEASE_SHA" database-restored',
      "compose up -d --no-deps --no-build app",
      "bodycast_publish_staged_route",
      "clear_bodycast_release_marker",
    ].map((fragment) => cutback.indexOf(fragment));
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
    expect(cutback).toContain("RESTORE_PRE_DDL_DATABASE");
    expect(cutback).toContain("bodycast_failed_${FAILED_MIGRATION_RUN_ID}");
    expect(cutback).not.toContain("prisma migrate deploy");
  });
});
