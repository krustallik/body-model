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
  "production-v4-derived-recovery.yml",
  "production-auth-runtime-configure.yml",
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

  it("keeps Auth runtime configuration owner-gated, exact-main, and non-restarting", () => {
    const workflow = readFileSync(resolve(workflowDir, "production-auth-runtime-configure.yml"), "utf8").replace(/\r\n/g, "\n");
    const remote = readFileSync(resolve("scripts/production-auth-runtime-configure.sh"), "utf8");
    expect(workflow).toContain("permissions:\n  contents: read\n  actions: read");
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).toContain("github.repository == 'krustallik/body-model'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("github.actor_id == '126446430'");
    expect(workflow).toContain("assertTrustedOwnerWorkflowRun");
    expect(workflow).toContain('&& "$MAIN_TIP" == "$GITHUB_SHA" && "$MAIN_TIP" == "$DISPATCH_SHA"');
    expect(workflow).toContain('run.head_sha === tip && run.head_branch === "main" && run.event === "push"');
    expect(workflow).toContain('"repos/krustallik/body-model/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=100"');
    expect(workflow).toContain('"repos/krustallik/body-model/actions/workflows/production-migration-safety-ci.yml/runs?branch=main&event=push&per_page=100"');
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("secrets.SSH_PRIVATE_KEY");
    expect(workflow).toContain("secrets.SSH_HOST_FINGERPRINT");
    expect(workflow).toContain("secrets.AUTH_PROFILE_ONE_OWNER_EMAIL_EXPECTED");
    expect(workflow).toContain("secrets.BREVO_API_KEY");
    expect(workflow).toContain('StrictHostKeyChecking=yes');
    expect(workflow).toContain("BODYCAST_SCHEMA_HANDOFF_SHA256");
    expect(workflow).not.toContain("BODYCAST_MIGRATION_MANIFESTS_SHA256");
    expect(workflow).toContain("BODYCAST_APP_CAPABILITIES_SHA256");
    expect(remote).toContain('verify_pinned_release_file "$DEPLOY_PATH/scripts/production-schema-deploy-handoff.mjs"');
    expect(remote).toContain("mv -fT -- \"$TEMP_ENV\" \"$ENV_FILE\"");
    expect(remote).toContain("current_live_container_unchanged");
    expect(remote).not.toMatch(/docker compose[^\n]*(?:\bup\b|\brestart\b|\bstop\b|\bdown\b)/);
    expect(remote).not.toMatch(/\b(?:prisma|psql)\b|\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|DATABASE)\b/);
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
    expect(workflow).toContain("id: checkout_metadata");
    expect(workflow).toContain('[[ "$REMOTE_HEAD_SHA" =~ ^[a-f0-9]{40}$ && "$REMOTE_ORIGIN_MAIN_SHA" == "$REMOTE_HEAD_SHA" && "$REMOTE_CLEAN" == "yes" ]]');
    expect(workflow).toContain('echo "remote_head_sha=$REMOTE_HEAD_SHA" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("Inspect production database schema read-only");
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("export GIT_OPTIONAL_LOCKS=0");
    expect(workflow).toContain("BODYCAST_DB_PREFLIGHT_MANIFEST=training-session-context-v1");
    expect(workflow).toContain("bash scripts/production-db-target.sh --preflight bodycast-db-prod");
    const databaseDiagnostic = workflow.slice(workflow.indexOf("      - name: Inspect production database schema read-only"), workflow.indexOf("      - name: Remove temporary SSH credentials"));
    const writerDrainGateIndex = databaseDiagnostic.indexOf("bash scripts/production-writer-drain.sh --assert");
    const databaseScanIndex = databaseDiagnostic.indexOf("bash scripts/production-db-target.sh --preflight bodycast-db-prod");
    expect(writerDrainGateIndex).toBe(-1);
    expect(databaseScanIndex).toBeGreaterThanOrEqual(0);
    expect(databaseDiagnostic).toContain("APP_HOST: ${{ secrets.APP_HOST }}");
    expect(databaseDiagnostic).toContain("CADDY_ROUTES_PATH: ${{ secrets.CADDY_ROUTES_PATH }}");
    expect(databaseDiagnostic).toContain("REMOTE_CHECKOUT_SHA: ${{ steps.checkout_metadata.outputs.remote_head_sha }}");
    expect(databaseDiagnostic).toContain('git merge-base --is-ancestor "$REMOTE_CHECKOUT_SHA" "$RELEASE_SHA"');
    expect(databaseDiagnostic).toContain('git diff --quiet "$REMOTE_CHECKOUT_SHA" "$RELEASE_SHA" -- scripts prisma docker-compose.prod.yml');
    expect(databaseDiagnostic).toContain('APP_HOST_B64="$(printf \'%s\' "$APP_HOST" | base64 -w0)"');
    expect(databaseDiagnostic).toContain('CADDY_ROUTES_PATH_B64="$(printf \'%s\' "$CADDY_ROUTES_PATH" | base64 -w0)"');
    expect(databaseDiagnostic).toContain('app_host="$(printf \'%s\' "$3" | base64 --decode)"');
    expect(databaseDiagnostic).toContain('routes_path="$(printf \'%s\' "$4" | base64 --decode)"');
    expect(databaseDiagnostic).toContain('remote_sha="$2"');
    expect(databaseDiagnostic).toContain('rev-parse HEAD)" == "$remote_sha"');
    expect(databaseDiagnostic).toMatch(/REMOTE_COMMAND=.*'\$DEPLOY_PATH_B64' '\$REMOTE_CHECKOUT_SHA' '\$APP_HOST_B64' '\$CADDY_ROUTES_PATH_B64'/);
    expect(databaseDiagnostic).toContain('APP_HOST="$app_host" CADDY_ROUTES_PATH="$routes_path" BODYCAST_DB_PREFLIGHT_MANIFEST=training-session-context-v1');
    const topologyEncodeIndex = databaseDiagnostic.indexOf('APP_HOST_B64="$(printf \'%s\' "$APP_HOST" | base64 -w0)"');
    const routesEncodeIndex = databaseDiagnostic.indexOf('CADDY_ROUTES_PATH_B64="$(printf \'%s\' "$CADDY_ROUTES_PATH" | base64 -w0)"');
    const topologyDecodeIndex = databaseDiagnostic.indexOf('app_host="$(printf \'%s\' "$3" | base64 --decode)"');
    const routesDecodeIndex = databaseDiagnostic.indexOf('routes_path="$(printf \'%s\' "$4" | base64 --decode)"');
    const topologyEnvIndex = databaseDiagnostic.indexOf('APP_HOST="$app_host" CADDY_ROUTES_PATH="$routes_path" BODYCAST_DB_PREFLIGHT_MANIFEST=training-session-context-v1');
    const remoteCommandIndex = databaseDiagnostic.indexOf("REMOTE_COMMAND=");
    const sshInvocationIndex = databaseDiagnostic.indexOf("timeout 5m ssh -T -p");
    expect(routesEncodeIndex).toBeGreaterThan(topologyEncodeIndex);
    expect(topologyDecodeIndex).toBeGreaterThan(routesEncodeIndex);
    expect(routesDecodeIndex).toBeGreaterThan(topologyDecodeIndex);
    expect(topologyEnvIndex).toBeGreaterThan(routesDecodeIndex);
    expect(remoteCommandIndex).toBeGreaterThan(topologyEnvIndex);
    expect(sshInvocationIndex).toBeGreaterThan(remoteCommandIndex);
    expect(databaseDiagnostic).toMatch(/timeout 5m ssh -T -p "\$SSH_PORT"[\s\S]*?"\$REMOTE_COMMAND" > "\$DB_REPORT"/);
    expect(workflow).toContain("chmod 600 \"$DB_REPORT\" \"$DB_RESULT\"");
    expect(workflow).toContain("Only bounded escaped blocker messages follow.");
    expect(workflow).toContain("result.blockers.slice(0, 100)");
    expect(workflow).toContain("value.slice(0, 500)");
    expect(workflow).not.toContain("upload-artifact");
    expect(workflow).not.toContain("production-migrate.yml");
    expect(inspector).toContain("GIT_OPTIONAL_LOCKS=0");
    expect(inspector).toContain("status --porcelain=v1 --untracked-files=all");
    expect(inspector).toContain("rev-parse --show-toplevel");
    expect(inspector).not.toMatch(/\bgit\s+(?:fetch|checkout|reset|clean|add|commit)\b/);
    expect(inspector).toContain("docker inspect");
    expect(inspector).toContain("curl --silent --show-error --max-time 10");
    const dockerRootCommands = [...inspector.matchAll(/\bdocker\s+([a-z][a-z-]*)\b/g)].map((match) => match[1]).sort();
    expect(inspector.match(/\bdocker\s+/g)).toHaveLength(13);
    expect(dockerRootCommands).toEqual(["compose", "exec", "exec", "image", "image", "info", "inspect", "inspect", "inspect", "inspect", "ps", "ps"]);
    expect(inspector.match(/\bdocker\s+compose\b/g)).toHaveLength(1);
    expect(inspector).toContain("docker compose -f docker-compose.prod.yml config --format json");
    expect(inspector.match(/\bdocker\s+exec\b/g)).toHaveLength(2);
    expect(inspector).toMatch(/docker exec --interactive --env "BODYCAST_AUTH_DIAGNOSTIC_APP_HOST=\$APP_HOST" \\\s+bodycast-app-prod node --input-type=module 2>\/dev\/null/);
    expect(inspector.match(/\bdocker\s+image\b/g)).toHaveLength(2);
    expect(inspector.match(/\bdocker\s+image\s+ls\b/g)).toHaveLength(1);
    expect(inspector.match(/\bdocker\s+image\s+inspect\b/g)).toHaveLength(1);
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

  it("discovers the current Training migration set without a migration-ID allowlist", () => {
    const migration = readFileSync(resolve(workflowDir, "production-migrate.yml"), "utf8");
    const preflight = readFileSync(resolve(workflowDir, "production-migration-preflight.yml"), "utf8");
    const runner = readFileSync(resolve("scripts/deploy-migrate.sh"), "utf8");
    const manifests = readFileSync(resolve("scripts/production-migration-manifests.mjs"), "utf8");
    const cutover = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8");
    const dockerfile = readFileSync(resolve("Dockerfile"), "utf8");
    const remoteScript = migration.match(/REMOTE_SCRIPT="\$\(cat <<'REMOTE'\r?\n([\s\S]*?)\r?\n\s*REMOTE\r?\n\s*\)"/)?.[1] ?? "";
    const exactCheckoutAt = remoteScript.indexOf('git checkout --detach "$RELEASE_SHA"');
    const manifestLookupAt = remoteScript.indexOf("getProductionMigrationManifest");
    const migrateRunnerAt = remoteScript.indexOf("bash scripts/deploy-migrate.sh");
    expect(manifests).toContain('id: "training-session-context-v1"');
    expect(manifests).toContain("dynamicMigrationSet: true");
    expect(manifests).toContain("migrations: Object.freeze([])");
    expect(migration).toContain("pending migrations are discovered from the exact release tree");
    expect(migration).toContain("MIGRATE_PRODUCTION:[0-9a-f]{40}:[0-9a-f]{64}");
    expect(exactCheckoutAt).toBeGreaterThan(-1);
    expect(manifestLookupAt === -1 || manifestLookupAt > exactCheckoutAt).toBe(true);
    expect(migrateRunnerAt).toBeGreaterThan(exactCheckoutAt);
    expect(preflight).toContain("pending migrations are discovered from the exact release tree");
    expect(preflight).not.toContain("type: choice");
    expect(migration).not.toContain("type: choice");
    expect(preflight).not.toMatch(/RESUME_SOURCE_RUN_ID|RESUME_MIGRATION_FAILURE_RUN_ID|FORWARD_RESUME/);
    expect(runner).toContain('"$MANIFEST_ID" == "training-session-context-v1"');
    expect(migration).not.toContain("execution_mode");
    expect(cutover).toContain("getProductionMigrationManifest(id).ciOnly");
    expect(cutover).not.toContain('"active-energy-unified-v2" ||');
    expect(dockerfile).toContain("COPY scripts/production-writer-drain.mjs ./scripts/");
  });

  it("compares the retained Auth marker with the complete Training preflight witness", () => {
    const runner = readFileSync(resolve("scripts/deploy-migrate.sh"), "utf8");
    expect(runner).toContain("const currentWitness = { ...current, liveAppSha: witness.liveAppSha };");
    expect(runner).toContain("JSON.stringify(currentWitness) !== JSON.stringify(witness)");
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
    expect(deploy).not.toContain("migration_free_expected_migration_count");
    expect(deploy).not.toContain("BODYCAST_EXPECTED_MIGRATION_COUNT");
    expect(deploy).toContain("--capture-raw-input-fingerprint");
    expect(deploy).toContain("production-writer-drain.sh\" --assert");
    expect(deploy).toContain('production-traffic-cutover.sh" migration-free-serving');
    expect(deploy).toContain('docker compose');
    expect(deploy).toContain('--no-deps --force-recreate "$APP_SERVICE"');
    expect(deploy).not.toMatch(/prisma\s+migrate\s+deploy|prisma\s+migrate\s+reset/);

    expect(schemaPreflight).toContain("prisma migrate status");
    expect(schemaPreflight).not.toContain("EXPECTED_MIGRATION_COUNT");
    expect(schemaPreflight).not.toContain('"_prisma_migrations"');
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
    expect(workflow.match(/git -c url\.https:\/\/github\.com\/krustallik\/body-model\.git\.insteadOf=git@github\.com:krustallik\/body-model\.git fetch --no-tags origin/g))
      .toHaveLength(4);
    expect(workflow.match(/GIT_CONFIG_KEY_0=url\.https:\/\/github\.com\/krustallik\/body-model\.git\.insteadOf/g))
      .toHaveLength(3);
    expect(workflow.match(/GIT_CONFIG_VALUE_0=git@github\.com:krustallik\/body-model\.git/g))
      .toHaveLength(3);
    const maintenanceCutover = workflow.indexOf("exec bash scripts/production-traffic-cutover.sh maintenance");
    expect(maintenanceCutover).toBeGreaterThan(-1);
    expect(workflow.slice(maintenanceCutover - 350, maintenanceCutover)).toContain("GIT_CONFIG_KEY_0=url.https://github.com/krustallik/body-model.git.insteadOf");
    const finalCutover = workflow.indexOf("exec bash scripts/production-traffic-cutover.sh full-history-recalculate");
    expect(finalCutover).toBeGreaterThan(-1);
    expect(workflow.slice(finalCutover - 350, finalCutover)).toContain("GIT_CONFIG_KEY_0=url.https://github.com/krustallik/body-model.git.insteadOf");
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
    expect(cutback).toContain('mapfile -t record < "$record_path"');
    expect(cutback).not.toContain('mapfile -t record= < "$record_path"');
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
    const capture = readFileSync(resolve("scripts/production-traffic-cutover.sh"), "utf8").replace(/\r\n/g, "\n");
    const workflow = readFileSync(resolve(workflowDir, "production-migration-preflight.yml"), "utf8");
    const captureOrder = [
      'node "$ROOT_DIR/scripts/production-previous-app-provenance.mjs" "${capture_args[@]}"',
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

    const enterMaintenance = capture.indexOf("enter_maintenance() {");
    const preMaintenanceGate = capture.indexOf('assert_pre_maintenance_migration_state "$preflight_result_path"', enterMaintenance);
    const recoveryCapture = capture.indexOf('capture_pre_ddl_previous_release "$preflight_result_path"', enterMaintenance);
    const exactShaRecheck = capture.indexOf('bodycast_assert_current_main_sha "${BODYCAST_DEPLOY_SHA:-${DEPLOY_SHA:-}}" || return 1', recoveryCapture);
    const routeMutation = capture.indexOf("publish_maintenance_route || return 1", enterMaintenance);
    const appStop = capture.indexOf("  stop_old_app\n}", enterMaintenance);
    expect([enterMaintenance, preMaintenanceGate, recoveryCapture, exactShaRecheck, routeMutation, appStop].every((index) => index >= 0)).toBe(true);
    expect(preMaintenanceGate).toBeLessThan(recoveryCapture);
    expect(recoveryCapture).toBeLessThan(exactShaRecheck);
    expect(exactShaRecheck).toBeLessThan(routeMutation);
    expect(routeMutation).toBeLessThan(appStop);
    expect(capture).toContain("--pre-maintenance-snapshot bodycast-db-prod");
    expect(capture).toContain("--pre-maintenance \\");
    expect(capture).toContain("bodycast_assert_current_main_sha \"$target_sha\"");
    expect(workflow).toContain("BODYCAST_PRODUCTION_MIGRATION_MANIFEST_ID=\"$MANIFEST_ID\"");
    expect(capture).toContain('[[ "${BODYCAST_CAPTURE_PRE_DDL_RELEASE:-0}" == "1" ]]');
  });

  it("keeps Prisma-only lock-timeout URL options out of libpq postflight probes", () => {
    const workflow = readFileSync(resolve(workflowDir, "production-migration-preflight.yml"), "utf8");
    const restoreStart = workflow.indexOf("name: Restore snapshot, compare source state, and rehearse exact migrations");
    const restoreEnd = workflow.indexOf("      - name: Create preflight evidence bundle", restoreStart);
    const restoreStep = workflow.slice(restoreStart, restoreEnd);
    const prismaDeploy = restoreStep.indexOf('DATABASE_URL="$PRISMA_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma');
    const postflightProbe = restoreStep.indexOf('node scripts/production-db-preflight.mjs --manifest "$MANIFEST_ID" | psql "$DATABASE_URL"', prismaDeploy);

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
    const restoreStart = cutback.indexOf("# No production database mutation occurs until the complete plaintext archive");
    const ordered = [
      "--verify-context",
      "bodycast_verify_exact_maintenance_route",
      "production-writer-drain.sh\" --assert",
      restoreStart,
      cutback.indexOf("pg_restore --list", restoreStart),
      cutback.indexOf("--verify-live-identity", restoreStart),
      cutback.indexOf("CREATE DATABASE ${stage_db}", restoreStart),
      cutback.indexOf("--verify-restored", restoreStart),
      cutback.indexOf("--verify-previous-app", restoreStart),
      promotionIndex,
      cutback.indexOf("--verify-restored-identity", promotionIndex),
      "promoted-previous-app-compatibility",
      'write_bodycast_release_marker "$FAILED_RELEASE_SHA" database-restored',
      cutback.indexOf("compose up -d --no-deps --no-build app", restoreStart),
      cutback.indexOf("bodycast_publish_staged_route", restoreStart),
      "clear_bodycast_release_marker",
    ].map((fragment, index) => typeof fragment === "number" ? fragment
      : cutback.indexOf(fragment, index < 3 ? 0 : restoreStart));
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

  it("recovers the captured source app without restoring or mutating the pre-DDL database", () => {
    const workflow = readFileSync(resolve(workflowDir, "production-database-cutback.yml"), "utf8");
    const cutback = readFileSync(resolve("scripts/production-database-cutback.sh"), "utf8");
    const lifecycle = readFileSync(resolve("scripts/production-database-cutback-lifecycle.sh"), "utf8");
    expect(workflow).toContain("source-app-only");
    expect(workflow).toContain("RECOVER_PRE_DDL_SOURCE_APP");
    expect(workflow).toContain("id: source_gate");
    expect(workflow).toContain("if: inputs.recovery_mode == 'source-app-only'");
    expect(workflow).toContain("if: needs.authorize.outputs.recovery_mode == 'database-and-app'");
    expect(workflow).not.toContain("manifest?.id === \"training-session-context-v1\"");
    expect(workflow).toContain('if [[ "$RECOVERY_MODE" == "database-and-app" ]]; then');
    expect(workflow).not.toContain("--verify-context \"$BUNDLE\" \"$FAILED_MIGRATION_RUN_ID\" \"$FAILED_SHA\" --source-app-only");
    expect(workflow).toContain('FILES+=(production-backup.pgdump.enc)');
    const signedEvidenceStep = workflow.split("- name: Resolve signed migration recovery evidence")[1]?.split("\n      - name: ")[0] ?? "";
    expect(signedEvidenceStep).toContain("if: inputs.recovery_mode == 'database-and-app'");
    expect(signedEvidenceStep).toContain("gh run download");
    expect(workflow).not.toContain('if (run.status !== "completed" || run.conclusion !== "failure")');
    expect(workflow).not.toContain('assertTrustedOwnerWorkflowRun(run, { actorId: process.env.DISPATCH_ACTOR_ID,\n            workflowPath: ".github/workflows/production-migration-preflight.yml"');
    expect(workflow).toContain('flock -n 9');
    const originCheck = workflow.indexOf('ORIGIN_URL="$(git remote get-url origin)"');
    const deployKey = workflow.indexOf('GITHUB_DEPLOY_KEY="/root/.ssh/bodycast_github_deploy"', originCheck);
    const identity = workflow.indexOf('export GIT_SSH_COMMAND=', deployKey);
    const readProbe = workflow.indexOf('git ls-remote origin refs/heads/main >/dev/null', identity);
    const canonicalFetch = workflow.indexOf('git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main', readProbe);
    expect(originCheck).toBeGreaterThan(-1);
    expect(deployKey).toBeGreaterThan(originCheck);
    expect(identity).toBeGreaterThan(deployKey);
    expect(readProbe).toBeGreaterThan(identity);
    expect(canonicalFetch).toBeGreaterThan(readProbe);
    expect(workflow).toContain('git@github.com:krustallik/body-model.git|https://github.com/krustallik/body-model.git');
    expect(workflow).toContain('StrictHostKeyChecking=yes');
    expect(workflow).toContain('git checkout --detach "$CURRENT_MAIN_SHA"');
    expect(workflow).toContain('if [[ "$RECOVERY_MODE" == "database-and-app" ]]; then');
    expect(workflow).toContain('timeout 30m "${SSH[@]}" "$SSH_USER@$SSH_HOST" "$REMOTE_COMMAND" </dev/null');
    expect(workflow).toContain('"repos/krustallik/body-model/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=100"');
    expect(workflow).toContain('"repos/krustallik/body-model/actions/workflows/production-migration-safety-ci.yml/runs?branch=main&event=push&per_page=100"');
    expect(workflow).toContain('current_main_safety_ci_url=$SAFETY_CI_URL');
    expect(workflow).toContain('id: ci_gate');
    expect(workflow).toContain('current_main_sha: ${{ steps.ci_gate.outputs.current_main_sha }}');
    expect(workflow).toContain('current_main_ci_url: ${{ steps.ci_gate.outputs.current_main_ci_url }}');
    expect(workflow).toContain('current_main_safety_ci_url: ${{ steps.ci_gate.outputs.current_main_safety_ci_url }}');
    expect(workflow).toContain('run.head_sha === expectedSha && run.head_branch === "main" && run.event === "push"');

    const recoveryStart = cutback.lastIndexOf('if [[ "$RECOVERY_MODE" == "source-app-only" ]]; then');
    const normalDatabasePath = cutback.indexOf("# No production database mutation occurs until the complete plaintext archive", recoveryStart);
    expect(recoveryStart).toBeGreaterThan(-1);
    expect(normalDatabasePath).toBeGreaterThan(recoveryStart);
    expect(cutback.indexOf('bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert')).toBeLessThan(recoveryStart);
    const recovery = cutback.slice(recoveryStart, normalDatabasePath);
    const ordered = [
      'BODYCAST_DB_PREFLIGHT_MANIFEST=training-session-context-v1',
      '--verify-captured-source-app-recovery',
      'docker image tag "$PREVIOUS_IMAGE_PIN" bodycast-app:latest',
      'compose up -d --no-deps --no-build app',
      '--verify-previous-app-runtime',
      'bodycast_publish_staged_route',
      'bodycast_probe_public_candidate_observational',
    ].map((fragment) => recovery.indexOf(fragment));
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
    expect(recovery).not.toContain('APP_HOST="$APP_HOST"');
    expect(recovery).toContain('"$LIVE_REPORT" "$record_path"');
    expect(recovery).toContain('"$(sha256sum "$BODYCAST_MARKER_FILE_PATH" | awk \'{print $1}\')" == "$marker_digest_before"');
    expect(recovery).not.toMatch(/write_bodycast_release_marker|clear_bodycast_release_marker|admin_sql|prisma migrate deploy|CREATE DATABASE|ALTER DATABASE/);
    expect(lifecycle).toContain('if [[ "${app_started:-false}" == "true" && "${route_committed:-false}" == "false" ]]; then');
    expect(lifecycle).toContain('return "$original_status"');
    expect(lifecycle).not.toContain('if [[ "${route_committed:-false}" == "true" ]]; then return 0; fi');
  });
});
