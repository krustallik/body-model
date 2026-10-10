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
    const provenance = readFileSync(resolve("scripts/production-previous-app-provenance.mjs"), "utf8");
    expect(cutback).toContain("RESTORE_PRE_DDL_DATABASE");
    expect(cutback).toContain("production-writer-drain.sh\" --assert");
    expect(cutback).toContain("--verify-previous-app-runtime");
    expect(cutback).toContain("--single-transaction");
    expect(cutback).toContain("database-restored");
    expect(cutback).toContain("rollback-app-ready");
    expect(cutback).toContain("bodycast_failed_${FAILED_MIGRATION_RUN_ID}");
    expect(cutback).toContain("bodycast-production-pre-ddl-release");
    expect(cutback).toContain('record_lines" == "12"');
    expect(workflow).toContain('echo "current_main_sha=$CURRENT_MAIN_SHA" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('flock -n 9');
    expect(workflow).toContain('CUTBACK_RUN_ATTEMPT="$5"');
    expect(workflow).toContain('/tmp/bodycast-cutback-context-$CUTBACK_RUN_ID-$CUTBACK_RUN_ATTEMPT');
    expect(capture).toContain("previousRuntimeConfigDigest");
    expect(capture).toContain("production-previous-app-provenance.mjs");
    expect(provenance).toContain('LEGACY_PREVIOUS_APP_PROVENANCE = "legacy-unlabeled-v1"');
    expect(provenance).toContain('CUTBACK_LEGACY_PREVIOUS_APP_PROVENANCE = "legacy-cutback-receipt-v1"');
    expect(provenance).toContain("readVerifiedCutbackReceiptFromGitDir");
    expect(cutback).toContain("PREVIOUS_PROVENANCE_KIND");
    expect(cutback).toContain('BODYCAST_DEPLOY_SHA="unknown"');
    expect(cutback).toContain("PREVIOUS_RUNTIME_CONFIG_DIGEST");
  });

  it("captures versioned previous-app and DB history provenance before stopping the app, then binds it to the checked preflight", () => {
    const capture = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
    const workflow = readFileSync(resolve(workflowDir, "production-migration-preflight.yml"), "utf8");
    const captureOrder = [
      'node "$ROOT_DIR/scripts/production-previous-app-provenance.mjs" capture "$target_sha"',
      'docker image tag "$previous_image_id" bodycast-app:rollback',
      "stop_old_app",
    ].map((fragment, index) => index === 2 ? capture.lastIndexOf(fragment) : capture.indexOf(fragment));
    expect(captureOrder.every((index) => index >= 0)).toBe(true);
    expect(captureOrder).toEqual([...captureOrder].sort((left, right) => left - right));
    const preflightOrder = [
      'node scripts/production-migration-preflight.mjs --preflight',
      "--verify-preflight",
      'name: Capture pg_dump start on production host and create encrypted backup',
    ].map((fragment) => workflow.indexOf(fragment));
    expect(preflightOrder.every((index) => index >= 0)).toBe(true);
    expect(preflightOrder).toEqual([...preflightOrder].sort((left, right) => left - right));
  });

  it("resumes a prior pre-DDL capture only after owner-run, maintenance, marker, image, drain, and live-DB checks", () => {
    const capture = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
    const workflow = readFileSync(resolve(workflowDir, "production-migration-preflight.yml"), "utf8");
    const resumeVerifier = readFileSync(resolve("scripts/production-preflight-resume.mjs"), "utf8");
    expect(workflow).toContain("resume_previous_preflight_run_id:");
    expect(workflow).toContain("production-preflight-resume.mjs --verify-source");
    expect(workflow).toContain("sourceRunAttempt");
    expect(workflow).toContain("RESUME_RECEIPT_B64");
    expect(workflow).toContain("result.previousAppCaptureResume = {");
    expect(resumeVerifier).toContain("assertTrustedOwnerWorkflowRun(sourceRun");
    expect(resumeVerifier).toContain('"Restore snapshot, compare source state, and rehearse exact migrations": "failure"');
    expect(resumeVerifier).toContain("sourceArtifacts?.total_count");
    expect(resumeVerifier).toContain("another release or preflight workflow exists");

    const resumeStart = capture.indexOf("resume_pre_ddl_previous_release() {");
    const markerCheck = capture.indexOf("read_bodycast_release_marker", resumeStart);
    const appCheck = capture.indexOf("docker ps --all", resumeStart);
    const writerDrain = capture.indexOf('production-writer-drain.sh" --assert', resumeStart);
    const imagePinCheck = capture.indexOf("docker image inspect --format '{{.Id}}' bodycast-app:rollback", resumeStart);
    const freshDbCheck = capture.indexOf("--resume-capture", resumeStart);
    const archive = capture.indexOf("bodycast-production-pre-ddl-release-before-", resumeStart);
    const recordReplace = capture.indexOf('mv -f -- "$record_tmp" "$record_path"', resumeStart);
    expect([resumeStart, markerCheck, appCheck, writerDrain, imagePinCheck, freshDbCheck, archive, recordReplace]
      .every((index) => index >= 0)).toBe(true);
    expect(markerCheck).toBeLessThan(appCheck);
    expect(appCheck).toBeLessThan(writerDrain);
    expect(writerDrain).toBeLessThan(imagePinCheck);
    expect(imagePinCheck).toBeLessThan(freshDbCheck);
    expect(freshDbCheck).toBeLessThan(recordReplace);
    expect(recordReplace).toBeLessThan(capture.indexOf("BODYCAST_PRE_DDL_RESUME_RECEIPT=", resumeStart));
    expect(capture).toContain("git merge-base --is-ancestor");
    expect(capture).toContain("bodycast_assert_current_main_sha \"$target_sha\"");
  });

  it("admits the migration-failure resume only with three exact run IDs and verifies its host-side recapture", () => {
    const workflow = readFileSync(resolve(workflowDir, "production-migration-preflight.yml"), "utf8");
    const migrationWorkflow = readFileSync(resolve(workflowDir, "production-migrate.yml"), "utf8");
    const resumeVerifier = readFileSync(resolve("scripts/production-preflight-resume.mjs"), "utf8");
    const migrationScript = readFileSync(resolve("scripts/deploy-migrate.sh"), "utf8");
    const prismaWrapper = readFileSync(resolve("scripts/run-prisma-migrate-with-lock-timeout.mjs"), "utf8");
    expect(workflow).toContain("resume_pre_ddl_migration_failure_run_id:");
    expect(workflow).toContain("resume_blocked_capture_preflight_run_id:");
    expect(workflow).toContain("Pre-DDL migration resume requires the exact source, failed migration, and blocked capture run IDs.");
    expect(workflow).toContain('MIGRATION_EXECUTION_JOB_ID="$(jq -er');
    expect(workflow).toContain('node scripts/github-forward-resume-evidence.mjs "$RUNNER_TEMP/forward-github-evidence" "$GITHUB_RUN_ID" "$MAIN_TIP"');
    expect(workflow).toContain('--job "$MIGRATION_EXECUTION_JOB_ID" --log-failed');
    expect(workflow).toContain("production-preflight-resume.mjs --verify-pre-ddl-migration-failure");
    expect(migrationWorkflow).toMatch(/- name: Remove temporary runner credentials\s+if: always\(\)\s+run: rm -rf "\$RUNNER_TEMP\/bodycast-migrate-ssh"/);
    expect(resumeVerifier).toContain("two failed live probes, successful writer-drain observation, and final-guard import failure");
    expect(resumeVerifier).toContain("verified-pre-ddl-migration-failure");
    expect(resumeVerifier).toContain("must create a new backup");
    const finalGuard = migrationScript.indexOf("production-migration-final-guard.mjs");
    const markerMount = migrationScript.indexOf('BODYCAST_RELEASE_MARKER_DIRECTORY:/run/bodycast-release-marker:rw');
    const prismaInvocation = migrationScript.indexOf("run-prisma-migrate-with-lock-timeout.mjs");
    const durableMarker = prismaWrapper.indexOf("markerWriter({");
    const prismaSpawn = prismaWrapper.indexOf('spawn("npx", ["prisma", "migrate", "deploy"]');
    expect(finalGuard).toBeGreaterThanOrEqual(0);
    expect(markerMount).toBeGreaterThan(finalGuard);
    expect(prismaInvocation).toBeGreaterThan(markerMount);
    expect(durableMarker).toBeGreaterThanOrEqual(0);
    expect(durableMarker).toBeLessThan(prismaSpawn);
  });

  it("collects complete dynamic GitHub evidence with native transport before production access", () => {
    const workflow = readFileSync(resolve(workflowDir, "production-migration-preflight.yml"), "utf8");
    const collector = readFileSync(resolve("scripts/github-forward-resume-evidence.mjs"), "utf8");
    expect(workflow).toContain("node scripts/github-forward-resume-evidence.mjs");
    expect(workflow).not.toContain("FORWARD_SAFE_PREFLIGHT_RETRY_RUN_IDS");
    expect(workflow).not.toContain("--allow-escape-sequences");
    expect(collector).toContain('"merge-base", "--is-ancestor"');
    expect(collector).toContain('"repository-since-source"');
    expect(collector).toContain('redirect: "manual"');
  });

  it("keeps Prisma-only lock-timeout URL options out of libpq postflight probes", () => {
    const workflow = readFileSync(resolve(workflowDir, "production-migration-preflight.yml"), "utf8");
    const restoreStart = workflow.indexOf("name: Restore snapshot, compare source state, and rehearse exact migrations");
    const restoreEnd = workflow.indexOf("      - name: Create preflight evidence bundle", restoreStart);
    const restoreStep = workflow.slice(restoreStart, restoreEnd);
    const prismaDeploy = restoreStep.indexOf('DATABASE_URL="$PRISMA_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma');
    const postflightProbe = restoreStep.indexOf('node scripts/production-db-preflight.mjs | psql "$DATABASE_URL"', prismaDeploy);

    expect(restoreStart).toBeGreaterThanOrEqual(0);
    expect(restoreEnd).toBeGreaterThan(restoreStart);
    expect(restoreStep).toContain("PRISMA_DATABASE_URL=\"$(node --input-type=module -e");
    expect(prismaDeploy).toBeGreaterThanOrEqual(0);
    expect(postflightProbe).toBeGreaterThan(prismaDeploy);
    expect(restoreStep).not.toContain("export DATABASE_URL");
  });

  it("keeps the destructive DB swap behind owner context, maintenance, restore, history, and compatibility gates", () => {
    const cutback = readFileSync(resolve("scripts/production-database-cutback.sh"), "utf8");
    const promotion = readFileSync(resolve("scripts/production-database-cutback-promotion.sh"), "utf8");
    const promotionInvocation = 'if bodycast_cutback_promote_databases "$stage_db" "$failed_db"; then';
    const promotionIndex = cutback.indexOf(promotionInvocation);
    const ordered = [
      "--verify-context",
      "bodycast_verify_exact_maintenance_route",
      "production-writer-drain.sh\" --assert",
      "pg_restore --list",
      "--verify-live-identity",
      "CREATE DATABASE ${stage_db}",
      "--verify-restored",
      "--verify-previous-app",
      promotionIndex,
      cutback.indexOf("--verify-restored-identity", promotionIndex),
      "promoted-previous-app-compatibility",
      'write_bodycast_release_marker "$FAILED_RELEASE_SHA" database-restored',
      "compose up -d --no-deps --no-build app",
      "bodycast_publish_staged_route",
      "clear_bodycast_release_marker",
    ].map((fragment) => typeof fragment === "number" ? fragment : cutback.indexOf(fragment));
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
    expect(cutback).toContain("RESTORE_PRE_DDL_DATABASE");
    expect(cutback).toContain("bodycast_failed_${FAILED_MIGRATION_RUN_ID}");
    expect(cutback).not.toContain("prisma migrate deploy");
    const retainLive = promotion.indexOf('admin_sql "ALTER DATABASE ${source_db} RENAME TO ${failed_db};"');
    const promoteRestore = promotion.indexOf('admin_sql "ALTER DATABASE ${stage_db} RENAME TO ${source_db};"');
    const restoreOriginal = promotion.indexOf('admin_sql "ALTER DATABASE ${failed_db} RENAME TO ${source_db};"');
    expect(retainLive).toBeGreaterThanOrEqual(0);
    expect(promoteRestore).toBeGreaterThan(retainLive);
    expect(restoreOriginal).toBeGreaterThan(promoteRestore);
    const preflight = readFileSync(resolve(workflowDir, "production-migration-preflight.yml"), "utf8");
    expect(preflight).toContain("--verify-preflight");
    expect(preflight).toContain("previous-app-provenance-verification.json");
    expect(preflight).toContain("result.previousAppProvenance = binding");
    expect(preflight).toContain("bodycast-production-pre-ddl-release");
    expect(readFileSync(resolve("scripts/production-database-cutback.mjs"), "utf8"))
      .toContain("assertPreviousAppProvenanceBoundToPreflight(record, preflightResult)");
  });
});
