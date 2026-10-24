import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isProductionV4RecoveryEvidenceEntrypoint } from "../scripts/production-v4-recovery-evidence";

const workflowDir = resolve(".github/workflows");
const releaseWorkflows = [
  "deploy-production.yml",
  "production-migration-preflight.yml",
  "production-migrate.yml",
  "production-full-history-recalculate.yml",
  "production-database-cutback.yml",
  "production-no-app-preflight.yml",
  "production-v4-derived-recovery.yml",
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
    expect(workflow).toContain("bodycast-checkout-diagnostic-output");
    expect(workflow).toContain("production-stepper-shadow-diagnostic.mjs");
    expect(workflow).toContain('> "$DIAGNOSTIC_OUTPUT"');
    expect(inspector).toContain("GIT_OPTIONAL_LOCKS=0");
    expect(inspector).toContain("status --porcelain=v1 --untracked-files=all");
    expect(inspector).toContain("rev-parse --show-toplevel");
    expect(inspector).not.toMatch(/\bgit\s+(?:fetch|checkout|reset|clean|add|commit)\b/);
    expect(inspector).toContain("docker inspect");
    expect(inspector).toContain("curl --silent --show-error --max-time 10");
    expect(inspector).not.toMatch(/\bdocker\s+(?:compose|start|stop|restart|rm|run|update|kill)\b/);
    expect(inspector.match(/\bdocker\s+exec\b/g)).toHaveLength(1);
    expect(inspector).toContain('docker exec --interactive bodycast-db-prod bash -s -- "$server_ip"');
    expect(inspector).toContain('FROM "ExperimentalStepperActiveEnergyShadow" AS s');
    expect(inspector).toContain("energy_diagnostic_workout_56_shadow_payload_b64");
    expect(inspector).toContain("PGOPTIONS='-c default_transaction_read_only=on");
    expect(inspector).toContain('BEGIN READ ONLY;');
    expect(inspector.match(/^\s*psql\b/gm)).toHaveLength(1);
    expect(inspector).toContain("psql --no-psqlrc --quiet --tuples-only --no-align");
    expect(inspector).not.toMatch(/(^|\n)\s*(?:caddy|prisma)\s/m);
  });

  it("binds Workout 56 shadow diagnostics to its unique direct alias when reconciliation adds another event", () => {
    const inspector = readFileSync(resolve("scripts/production-checkout-diagnostic.sh"), "utf8");
    const otherReconciliationEvent = { sourceType: "stepper-reconciliation", sourceId: "group:56", inputFingerprint: "other-event" };
    const workoutEvent = { sourceType: "workout", sourceId: "56", inputFingerprint: "workout-event" };
    const events = [otherReconciliationEvent, workoutEvent];
    const directAlias = events.filter((event) => event.sourceType === "workout" && event.sourceId === "56");

    expect(directAlias).toEqual([workoutEvent]);
    expect(inspector).toContain("target_workout_56_canonical_event AS (");
    expect(inspector).toContain("a.\"sourceType\" = 'workout' AND a.\"sourceId\" = '56'");
    expect(inspector).toContain("target_workout_56_canonical_event AS e");
    expect(inspector).not.toContain("FROM target_workout_56_events AS e LIMIT 1");
  });

  it("routes the Training ledger manifest through only the standard owner-gated migration path", () => {
    const migration = readFileSync(resolve(workflowDir, "production-migrate.yml"), "utf8");
    const preflight = readFileSync(resolve(workflowDir, "production-migration-preflight.yml"), "utf8");
    const runner = readFileSync(resolve("scripts/deploy-migrate.sh"), "utf8");
    const marker = readFileSync(resolve("scripts/production-release-marker.mjs"), "utf8");
    for (const source of [migration, preflight, runner, marker]) {
      expect(source).toContain("training-mutation-ledger-refresh-queue-v1");
    }
    expect(migration).toContain("standard exact-SHA execution");
    expect(preflight).toContain("does not accept historical resume evidence");
    expect(runner).toContain("accepts standard exact-SHA execution only");
  });

  it("requires pinned owner, exact current main, and shared serialization on every production dispatch", () => {
    for (const name of releaseWorkflows) {
      const source = readFileSync(resolve(workflowDir, name), "utf8");
      expect(source, name).toContain("workflow_dispatch:");
      expect(source, name).toContain("126446430");
      expect(source, name).toContain("bodycast-production-release");
      expect(source, name).toContain("refs/heads/main");
      if (name === "production-v4-derived-recovery.yml") {
        expect(source, name).toContain("assertApprovedRecoveryRuns");
        expect(source, name).toContain("environment: production");
      } else {
        expect(source, name).toContain("assertTrustedOwnerWorkflowRun");
      }
      expect(source, name).toContain("commits/main");
    }
  });

  it("removes the one-time V4 activation dispatch while retaining guarded V4 cutover primitives", () => {
    const cutover = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
    expect(existsSync(resolve(workflowDir, "activate-unified-v4-production.yml"))).toBe(false);
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

  it("limits migration-free serving to exact owner confirmation and fenced existing-host replacement", () => {
    const workflow = readFileSync(resolve(workflowDir, "deploy-production.yml"), "utf8");
    const deploy = readFileSync(resolve("scripts/deploy.sh"), "utf8");
    const cutover = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
    const schemaPreflight = readFileSync(resolve("scripts/deploy-preflight-schema.sh"), "utf8");
    const dbIdentity = readFileSync(resolve("scripts/production-db-identity.sh"), "utf8");
    const currentnessCheck = readFileSync(resolve("scripts/unified-v4-traffic-check.ts"), "utf8");
    const recoveryEvidence = readFileSync(resolve("scripts/production-v4-recovery-evidence.ts"), "utf8");
    const attestation = readFileSync(resolve("scripts/production-deploy-attestation.mjs"), "utf8");
    const dockerfile = readFileSync(resolve("Dockerfile"), "utf8");
    const routeProbes = readFileSync(resolve("scripts/production-route-primitives.sh"), "utf8");

    expect(workflow).toContain("migration_free_serving:");
    expect(workflow).toContain('"serve-migration-free"');
    expect(workflow).toContain('MODE="migration-free-serving"');
    expect(workflow).toContain('[[ "$SSH_HOST" == "169.58.239.149" ]]');
    expect(workflow).toContain("assertTrustedOwnerWorkflowRun");
    expect(workflow).toContain("bodycast_acquire_production_release_lock");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("bodycast-production-migration-free-serving");
    expect(workflow.indexOf("bodycast_acquire_production_release_lock"))
      .toBeLessThan(workflow.indexOf('git fetch --no-tags origin "$DEPLOY_SHA"'));

    expect(deploy).toContain("BODYCAST_MIGRATION_FREE_CANDIDATE");
    expect(deploy).toContain("BODYCAST_EXPECTED_MIGRATION_COUNT=74");
    expect(deploy).toContain("--capture-raw-input-fingerprint");
    expect(deploy).toContain("production-writer-drain.sh\" --assert");
    expect(deploy).toContain('production-traffic-cutover.sh" migration-free-serving');
    expect(deploy).toContain('docker compose');
    expect(deploy).toContain('--no-deps --force-recreate "$APP_SERVICE"');
    expect(deploy).not.toMatch(/prisma\s+migrate\s+deploy|prisma\s+migrate\s+reset/);

    expect(schemaPreflight).toContain("EXPECTED_MIGRATION_COUNT");
    expect(schemaPreflight).toContain('"_prisma_migrations"');
    expect(schemaPreflight).toContain("Database schema is up to date");
    expect(dbIdentity).toContain("current_database()");
    expect(dbIdentity).toContain("pg_is_in_recovery()");
    expect(dbIdentity).toContain("bodycast_assert_prisma_database_identity_matches");
    expect(attestation).toContain("verifyProductionDeployAttestation");
    expect(attestation).toContain("consumeProductionDeployAttestationJti");
    expect(dockerfile).toContain("scripts/production-v4-recovery-evidence.ts scripts/production-migration-free-acceptance.ts ./scripts/");
    expect(routeProbes).toContain("/api/v1/days?to=2026-10-22&limit=100&offset=0");
    expect(routeProbes).toContain("BODYCAST_TRAINING_HISTORY_ENERGY_CURRENT");
    expect(cutover).toContain("--hold-currentness-fence --expected-raw-input-fingerprint");
    expect(cutover).toContain("BODYCAST_EXPECTED_HEALTH_SYNC_AUDIT_RETENTION_BASELINE");
    expect(cutover).toContain("BODYCAST_EXPECTED_HEALTH_SYNC_AUDIT_PRUNE_EVENTS");
    expect(currentnessCheck).toContain('requestedGeneration !== trainingRefresh.completedGeneration');
    expect(currentnessCheck).toContain("expectedRawInputFingerprint");
    expect(currentnessCheck).toContain("expectedHealthSyncAuditRetentionBaseline");
    expect(currentnessCheck).toContain("assertHealthSyncAuditRetentionTransitionV1");
    expect(currentnessCheck).toContain("SET TRANSACTION READ ONLY");
    expect(currentnessCheck).toContain("TransactionIsolationLevel.ReadCommitted");
    expect(currentnessCheck).not.toContain("rowsDueForPruneWithinReleaseWindow");
    expect(currentnessCheck).not.toContain("HealthSyncAudit retention could delete raw audit rows");
    expect(recoveryEvidence).not.toContain("import.meta.url");
    expect(cutover).toContain('-e BODYCAST_EXPECTED_PRISMA_DB_IDENTITY="$expected_prisma_database_identity"');
    expect(deploy).toContain('-e BODYCAST_EXPECTED_PRISMA_DB_IDENTITY="$expected_prisma_database_identity"');
    expect(cutover).toContain('require_absent_marker=true');
    expect(currentnessCheck).toContain("Health/Training raw-input integrity differs from the pre-deploy baseline.");
  });

  it("runs recovery evidence only from its own bundled or TypeScript entrypoint", () => {
    expect(isProductionV4RecoveryEvidenceEntrypoint("/app/dist/production-v4-recovery-evidence.mjs")).toBe(true);
    expect(isProductionV4RecoveryEvidenceEntrypoint("/app/scripts/production-v4-recovery-evidence.ts")).toBe(true);
    expect(isProductionV4RecoveryEvidenceEntrypoint("/app/dist/unified-v4-traffic-check.mjs")).toBe(false);
    expect(isProductionV4RecoveryEvidenceEntrypoint(undefined)).toBe(false);
  });

  it("assembles the current retention helper into the isolated legacy recovery image", () => {
    const workflow = readFileSync(resolve(workflowDir, "production-migration-safety-ci.yml"), "utf8");
    expect(workflow).toContain('mkdir -p "$RUNNER_TEMP/bodycast-v4-tool/source/src/modules/health"');
    expect(workflow).toContain("src/modules/health/health-sync-audit-retention-integrity.ts");
    expect(workflow).toContain("$RUNNER_TEMP/bodycast-v4-tool/source/src/modules/health/health-sync-audit-retention-integrity.ts");
  });

  it("keeps owner-authorized full-history recalculation fail-closed before V4 activation", () => {
    const workflow = readFileSync(resolve(workflowDir, "production-full-history-recalculate.yml"), "utf8");
    const cutover = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
    const dockerfile = readFileSync(resolve("Dockerfile"), "utf8");
    const script = readFileSync(resolve("scripts/production-full-history-recalculate.ts"), "utf8");
    expect(workflow).toContain("RECALCULATE_FULL_HISTORY_PROFILE_1");
    expect(workflow).toContain("production-traffic-cutover.sh full-history-recalculate");
    expect(workflow).toContain("production-full-history-recalculate.mjs");
    expect(workflow).toContain("restore-encrypted-postgres-backup.mjs");
    expect(workflow).toContain("docker build");
    expect(workflow).toContain("--target migrator");
    expect(cutover).toContain('MODE" == "full-history-recalculate"');
    expect(cutover).toContain("production-full-history-recalculate.mjs");
    expect(cutover).toContain("--full-history-recalculate --owner-authorized --profile-id 1");
    expect(cutover).toContain("unified-v3-postflight.mjs");
    expect(cutover).not.toContain("full-history-recalculate.mjs --activate-v4");
    expect(dockerfile).toContain("production-full-history-recalculate.ts");
    expect(dockerfile).toContain("production-full-history-recalculate.mjs");
    expect(script).toContain("--full-history-recalculate");
    expect(script).toContain("--owner-authorized");
    expect(script).toContain("runOwnerAuthorizedFullHistoryRecalculation");
    const backupUpload = workflow.indexOf("Upload encrypted backup artifact before restarting the app");
    const appRestart = workflow.indexOf("Restart exact-SHA app behind maintenance after backup drain");
    expect(backupUpload).toBeGreaterThan(-1);
    expect(appRestart).toBeGreaterThan(backupUpload);
    expect(workflow).toContain("production-app-container-health-wait.sh \"$RELEASE_SHA\" \"$IMAGE_ID\"");
    expect(workflow).toContain("source scripts/deploy-main-freshness.sh");
    expect(workflow).toContain('bodycast_assert_current_main_sha "$RELEASE_SHA"');
    const restartStep = workflow.slice(appRestart, workflow.indexOf("\n      - name:", appRestart + 1));
    const restartMainFence = restartStep.indexOf('bodycast_assert_current_main_sha "$RELEASE_SHA"');
    const appMutation = restartStep.indexOf('docker compose -f docker-compose.prod.yml up -d --no-deps --no-build app');
    expect(restartMainFence).toBeGreaterThan(restartStep.indexOf('docker image inspect --format'));
    expect(appMutation).toBeGreaterThan(restartMainFence);
    expect(restartStep.slice(restartMainFence + 'bodycast_assert_current_main_sha "$RELEASE_SHA"'.length, appMutation))
      .toMatch(/^\s*BODYCAST_DEPLOY_SHA="\$RELEASE_SHA"\s*$/);
    expect(restartStep).not.toContain("APP_HEALTH=\"$(docker inspect");
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
    expect(cutback).toContain('record_lines" == "12" || "$record_lines" == "13"');
    expect(cutback).toContain('docker image tag "$PREVIOUS_IMAGE_PIN" bodycast-app:latest');
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

  it("allows only an explicit owner-gated V4 capture refresh and preserves the old capture before replacing it", () => {
    const capture = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
    const workflow = readFileSync(resolve(workflowDir, "production-migration-preflight.yml"), "utf8");
    const cutback = readFileSync(resolve("scripts/production-database-cutback.sh"), "utf8");
    expect(workflow).toContain("refresh_existing_capture_confirmation:");
    expect(workflow).toContain('"$REFRESH_CAPTURE_CONFIRMATION" == "refresh-stale-pre-ddl-capture"');
    expect(workflow).toContain('MANIFEST_ID" == "unified-v4-republication-v1"');
    expect(workflow).toContain("BODYCAST_REFRESH_PRE_DDL_CAPTURE=1");
    expect(workflow).toContain("BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ID");
    expect(workflow).toContain("BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ATTEMPT");
    expect(capture).toContain("refresh_pre_ddl_previous_release");
    expect(capture).toContain('bodycast-production-pre-ddl-release-archive-${current_run_id}-${current_attempt}');
    expect(capture).toContain('bodycast-app:rollback-preflight-${current_run_id}-${current_attempt}');
    expect(capture.indexOf('ln -- "$record_path" "$archive_path"')).toBeLessThan(capture.indexOf('mv -fT -- "$record_tmp" "$record_path"'));
    expect(capture).toContain("--verify-live-container");
    expect(cutback).toContain('PREVIOUS_IMAGE_PIN="${record[5]#previousImagePin=}"');
    expect(workflow).toContain('MANIFEST_ID" == "unified-v4-republication-v1"');
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
    expect(resumeVerifier).toContain("assertHistoricalDeployRun");
    expect(resumeVerifier).not.toContain("assertSafeFailedPreMaintenanceDeploy");
    expect(resumeVerifier).not.toContain("safeFailedDeployRuns");
    expect(resumeVerifier).toContain('historicalEffects: "UNVERIFIED"');
    expect(resumeVerifier).not.toContain("deployControlFilesMatch");
    expect(resumeVerifier).toContain('".github/workflows/production-full-history-recalculate.yml"');
    expect(workflow.match(/actions\/runs\?per_page=100/g)).toHaveLength(2);
    expect(workflow).toContain("resume-historical-deploys.ndjson");
    expect(workflow).not.toContain("resume-safe-failed-deploys.ndjson");
    expect(workflow).not.toContain('actions/runs/$deploy_run_id/jobs');
    expect(workflow).toContain("--log-failed");
    expect(workflow).not.toContain("resume-main-ci-runs.ndjson");

    const resumeStart = capture.indexOf("resume_pre_ddl_previous_release() {");
    const markerCheck = capture.indexOf("read_bodycast_release_marker", resumeStart);
    const appCheck = capture.indexOf("docker ps --all", resumeStart);
    const writerDrain = capture.indexOf('production-writer-drain.sh" --assert', resumeStart);
    const recordPinValidation = capture.indexOf("--verify-record", resumeStart);
    const imagePinCheck = capture.indexOf('docker image inspect --format \'{{.Id}}\' "$previous_image_pin"', resumeStart);
    const freshDbCheck = capture.indexOf("--resume-capture", resumeStart);
    const archive = capture.indexOf("bodycast-production-pre-ddl-release-before-", resumeStart);
    const recordReplace = capture.indexOf('mv -f -- "$record_tmp" "$record_path"', resumeStart);
    expect([resumeStart, markerCheck, appCheck, writerDrain, recordPinValidation, imagePinCheck, freshDbCheck, archive, recordReplace]
      .every((index) => index >= 0)).toBe(true);
    expect(markerCheck).toBeLessThan(appCheck);
    expect(appCheck).toBeLessThan(writerDrain);
    expect(writerDrain).toBeLessThan(imagePinCheck);
    expect(recordPinValidation).toBeLessThan(imagePinCheck);
    expect(imagePinCheck).toBeLessThan(freshDbCheck);
    expect(freshDbCheck).toBeLessThan(recordReplace);
    expect(recordReplace).toBeLessThan(capture.indexOf("BODYCAST_PRE_DDL_RESUME_RECEIPT=", resumeStart));
    expect(capture).toContain("git merge-base --is-ancestor");
    expect(capture).toContain("attempt-bound previous-app image pin differs from the captured immutable image");
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
    expect(workflow).toContain('gh api "repos/krustallik/body-model/actions/runs/$retry_run_id/artifacts"');
    expect(workflow).toContain('artifacts: JSON.parse(readFileSync(artifactsPath, "utf8"))');
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
    expect(workflow).not.toContain('actions/jobs/$inspect_job_id/logs');
    expect(workflow).toContain('--log-failed');
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
    expect(preflight).toContain("validatePreviousAppProvenanceBinding(binding)");
    expect(preflight).not.toContain("binding.schemaVersion !== 2");
    expect(preflight).toContain("bodycast-production-pre-ddl-release");
    expect(readFileSync(resolve("scripts/production-database-cutback.mjs"), "utf8"))
      .toContain("assertPreviousAppProvenanceBoundToPreflight(record, preflightResult)");
  });
});
