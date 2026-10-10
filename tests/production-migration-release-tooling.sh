#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/production-migration-readiness.sh"
source "$ROOT/scripts/production-migration-summary.sh"

DEPLOY="$ROOT/scripts/deploy-migrate.sh"
WRAPPER="$ROOT/scripts/run-prisma-migrate-with-lock-timeout.mjs"
PREFLIGHT="$ROOT/.github/workflows/production-migration-preflight.yml"
MIGRATE="$ROOT/.github/workflows/production-migrate.yml"
CUTOVER="$ROOT/scripts/production-traffic-cutover.sh"
WRITER_DRAIN="$ROOT/scripts/production-writer-drain.mjs"
DEPLOY_SCRIPT="$ROOT/scripts/deploy.sh"
SCHEMA_PREFLIGHT="$ROOT/scripts/deploy-preflight-schema.sh"
LOCK="$ROOT/scripts/production-release-lock.sh"
DEPLOY_WORKFLOW="$ROOT/.github/workflows/deploy-production.yml"
ACTIVATE_WORKFLOW="$ROOT/.github/workflows/activate-unified-v4-production.yml"
grep -Fq 'fetch --no-tags --prune bodycast-canonical' "$DEPLOY"
grep -Fq 'active-energy-unified-v2' "$DEPLOY"
grep -Fq -- '--before-ddl' "$DEPLOY"
grep -Fq -- '--after-ddl' "$DEPLOY"
! grep -Fq 'prisma migrate deploy' "$DEPLOY"
! grep -Fq 'bodycast-production-operation' "$DEPLOY" "$CUTOVER"
! grep -Fq 'docker compose -f docker-compose.prod.yml up -d db' "$DEPLOY" "$SCHEMA_PREFLIGHT" "$CUTOVER"
grep -Fq 'write_bodycast_release_marker "$RELEASE_SHA" schema-applied' "$DEPLOY"
grep -Fq 'verifyFinalGuardReceipt' "$WRAPPER"
grep -Fq 'assertPrismaTargetMatchesSignedIdentity' "$WRAPPER"
grep -Fq 'assertBackupFreshAtDdlStart' "$WRAPPER"
grep -Fq 'writeDdlStartingMarker' "$WRAPPER"
grep -Fq 'spawnAcknowledger({' "$WRAPPER"
grep -Fq 'withPrismaLockTimeout(authorized.databaseUrl, 5000)' "$WRAPPER"
! grep -Fq 'fetch(' "$WRAPPER"
! grep -Fq 'CONFIRM_PRODUCTION_MIGRATE' "$DEPLOY" "$WRAPPER"
grep -Fq 'github.actor_id == '\''126446430'\''' "$MIGRATE"
grep -Fq 'assertTrustedOwnerWorkflowRun' "$MIGRATE"
grep -Fq 'run.triggering_actor?.id' "$ROOT/scripts/github-owner-identity.mjs"
grep -Fq 'workflow_dispatch:' "$DEPLOY_WORKFLOW"
! grep -Fq 'workflow_run:' "$DEPLOY_WORKFLOW"
grep -Fq '126446430' "$DEPLOY_WORKFLOW" "$PREFLIGHT" "$ACTIVATE_WORKFLOW"
grep -Fq 'workflow_dispatch:' "$ACTIVATE_WORKFLOW"
grep -Fq 'ACTIVATE_UNIFIED_V4_AND_SERVE' "$ACTIVATE_WORKFLOW"
! grep -Fq 'workflow_run:' "$ACTIVATE_WORKFLOW"
grep -Fq 'production-traffic-cutover.sh activate-v4-and-serve' "$ACTIVATE_WORKFLOW"
! grep -Fq 'production-traffic-cutover.sh v3-postflight' "$ACTIVATE_WORKFLOW"
! grep -Fq 'unified-v4-activate-replay.mjs --activate-v4' "$ACTIVATE_WORKFLOW"
grep -Fq 'unified-v4-activate-replay.mjs --activate-v4' "$CUTOVER"
grep -Fq 'npx prisma migrate deploy --schema prisma/schema.prisma' "$PREFLIGHT"
grep -Fq 'DATABASE_URL: postgresql://bodycast_restore:' "$PREFLIGHT"
grep -Fq 'production migration: NOT EXECUTED' "$PREFLIGHT"
grep -Fq 'compose rm --force app' "$CUTOVER"
grep -Fq 'app?.state === "absent"' "$WRITER_DRAIN"
grep -Fq 'schema-cutover marker' "$DEPLOY_SCRIPT"
grep -Fq 'production-release-lock.sh' "$DEPLOY" "$DEPLOY_SCRIPT" "$CUTOVER"
grep -Fq 'flock -n 9' "$LOCK"
! grep -Fq 'compose up -d --no-deps --force-recreate db' "$DEPLOY_SCRIPT" "$SCHEMA_PREFLIGHT"
grep -Fq 'compose up -d --no-deps --force-recreate "$APP_SERVICE"' "$DEPLOY_SCRIPT"
grep -Fq 'BODYCAST_NON_SERVING_DEPLOY=1' "$DEPLOY_WORKFLOW"
grep -Fq 'Deployment SHA/state does not match' "$DEPLOY_SCRIPT"
grep -Fq 'Automatic prior-app restoration is disabled' "$DEPLOY_SCRIPT"
PREFLIGHT_MAINTENANCE_LINE="$(grep -nF 'Enter maintenance and drain the old app before backup' "$PREFLIGHT" | cut -d: -f1)"
PREFLIGHT_BACKUP_LINE="$(grep -nF 'Capture pg_dump start on production host and create encrypted backup' "$PREFLIGHT" | cut -d: -f1)"
PREFLIGHT_RESTORE_LINE="$(grep -nF 'Restore snapshot, compare source state, and rehearse exact migrations' "$PREFLIGHT" | cut -d: -f1)"
[[ -n "$PREFLIGHT_MAINTENANCE_LINE" && -n "$PREFLIGHT_BACKUP_LINE" && -n "$PREFLIGHT_RESTORE_LINE" ]]
[[ "$PREFLIGHT_MAINTENANCE_LINE" -lt "$PREFLIGHT_BACKUP_LINE" && "$PREFLIGHT_BACKUP_LINE" -lt "$PREFLIGHT_RESTORE_LINE" ]]
FINAL_GUARD_LINE="$(grep -nF '  --before-ddl' "$DEPLOY" | cut -d: -f1)"
MIGRATE_LINE="$(grep -nF 'run-prisma-migrate-with-lock-timeout.mjs' "$DEPLOY" | cut -d: -f1)"
POSTFLIGHT_LINE="$(grep -nF '  --after-ddl' "$DEPLOY" | cut -d: -f1)"
SCHEMA_APPLIED_LINE="$(grep -nF 'write_bodycast_release_marker "$RELEASE_SHA" schema-applied' "$DEPLOY" | cut -d: -f1)"
FINAL_IDENTITY_LINE="$(grep -nF 'assertPrismaTargetMatchesSignedIdentity(finalGuard.receipt, actualIdentity' "$WRAPPER" | cut -d: -f1)"
MARKER_WRITE_LINE="$(grep -nF 'const marker = await markerWriter({' "$WRAPPER" | cut -d: -f1)"
PRISMA_SPAWN_LINE="$(grep -nF 'child = spawn(' "$WRAPPER" | cut -d: -f1)"
SPAWN_ACK_LINE="$(grep -nF 'spawnAcknowledger({' "$WRAPPER" | cut -d: -f1)"
APP_READY_LINE="$(grep -nF 'write_bodycast_release_marker "$DEPLOY_SHA" app-ready' "$DEPLOY_SCRIPT" | cut -d: -f1)"
APP_SHA_CHECK_LINE="$(grep -nF 'deployed_container_sha=' "$ROOT/scripts/deploy.sh" | cut -d: -f1)"
[[ -n "$FINAL_GUARD_LINE" && -n "$MIGRATE_LINE" && -n "$POSTFLIGHT_LINE" && -n "$SCHEMA_APPLIED_LINE" ]]
[[ "$FINAL_GUARD_LINE" -lt "$MIGRATE_LINE" && "$MIGRATE_LINE" -lt "$POSTFLIGHT_LINE" && "$POSTFLIGHT_LINE" -lt "$SCHEMA_APPLIED_LINE" ]]
[[ -n "$FINAL_IDENTITY_LINE" && -n "$MARKER_WRITE_LINE" && -n "$PRISMA_SPAWN_LINE" && -n "$SPAWN_ACK_LINE" ]]
[[ "$FINAL_IDENTITY_LINE" -lt "$MARKER_WRITE_LINE" && "$MARKER_WRITE_LINE" -lt "$PRISMA_SPAWN_LINE" && "$PRISMA_SPAWN_LINE" -lt "$SPAWN_ACK_LINE" ]]
[[ -n "$APP_READY_LINE" && -n "$APP_SHA_CHECK_LINE" && "$APP_SHA_CHECK_LINE" -lt "$APP_READY_LINE" ]]
! grep -Eq 'trap .*clear_bodycast_release_marker|clear_bodycast_release_marker' "$DEPLOY" "$DEPLOY_SCRIPT"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/read-stdin-and-fail" <<'COMMAND'
#!/usr/bin/env bash
cat >/dev/null
printf '%s\n' 'synthetic child diagnostic' 'P1000: postgresql://bodycast:db-secret@db.example/bodycast PASSWORD=separate-secret' >&2
exit 7
COMMAND
chmod +x "$TMP/read-stdin-and-fail"

if bodycast_capture_subcommand "synthetic stdin-consuming child" "$TMP/child.out" "$TMP/child.err" /dev/null "$TMP/read-stdin-and-fail" > "$TMP/child.diagnostics" 2>&1; then
  echo "Expected synthetic child to fail." >&2
  exit 1
else
  CHILD_STATUS=$?
fi
[[ "$CHILD_STATUS" == "7" ]]
grep -Fq 'Production readiness subcommand: synthetic stdin-consuming child (exit code 7)' "$TMP/child.diagnostics"
grep -Fq 'synthetic child diagnostic' "$TMP/child.diagnostics"
grep -Fq 'postgresql://[REDACTED]' "$TMP/child.diagnostics"
! grep -Fq 'db-secret' "$TMP/child.diagnostics"
! grep -Fq 'separate-secret' "$TMP/child.diagnostics"

if bash -s -- "$ROOT" "$TMP" > "$TMP/bash-s-stdin.log" 2>&1 <<'REMOTE'
set -Eeuo pipefail
source "$1/scripts/production-migration-readiness.sh"
if bodycast_capture_subcommand "child cannot consume bash -s program" "$2/nested.out" "$2/nested.err" /dev/null "$2/read-stdin-and-fail"; then
  CHILD_STATUS=0
else
  CHILD_STATUS=$?
fi
test "$CHILD_STATUS" -eq 7
printf '%s\n' 'SCRIPT_CONTINUED'
REMOTE
then
  :
else
  echo "The nested bash -s stdin isolation check failed." >&2
  cat "$TMP/bash-s-stdin.log" >&2
  exit 1
fi
grep -Fq 'SCRIPT_CONTINUED' "$TMP/bash-s-stdin.log"

ARTIFACT_PROBE='bodycast-artifact-command-probe'
cat > "$TMP/$ARTIFACT_PROBE" <<'COMMAND'
#!/usr/bin/env bash
printf '%s\n' 'executed' > "$SUMMARY_PROBE_MARKER"
COMMAND
chmod +x "$TMP/$ARTIFACT_PROBE"
export PATH="$TMP:$PATH"
export SUMMARY_PROBE_MARKER="$TMP/artifact-command-was-executed"
SUMMARY_FILE="$TMP/summary.md"
bodycast_append_encrypted_backup_summary "$SUMMARY_FILE" "$ARTIFACT_PROBE" 12345
bodycast_append_production_readiness_summary "$SUMMARY_FILE" 0123456789012345678901234567890123456789 "$ARTIFACT_PROBE" https://github.com/example/artifact 12345
test ! -e "$SUMMARY_PROBE_MARKER"
EXPECTED_BACKUP_LINE='- artifact: `'"$ARTIFACT_PROBE"'`'
EXPECTED_FINAL_LINE='- backup artifact: [`'"$ARTIFACT_PROBE"'`](https://github.com/example/artifact)'
grep -Fq -- "$EXPECTED_BACKUP_LINE" "$SUMMARY_FILE"
grep -Fq -- "$EXPECTED_FINAL_LINE" "$SUMMARY_FILE"

# Exercise exact script effects with a disposable fake Git/Docker host. The
# migration guard rejection must happen before the durable marker and DDL; once
# the marker is written, a failed Prisma process remains one-shot and blocks the
# prior app without Docker mutations.
FIXTURE_ROOT="$TMP/release-fixture"
FIXTURE_GIT_DIR="$FIXTURE_ROOT/.git"
FIXTURE_BIN="$TMP/release-fixture-bin"
DOCKER_LOG="$TMP/release-fixture-docker.log"
MIGRATION_COUNT="$TMP/release-fixture-migration-count"
OLD_RELEASE_SHA="1111111111111111111111111111111111111111"
REAL_GIT="$(command -v git)"
NEW_RELEASE_SHA="$("$REAL_GIT" -C "$ROOT" rev-parse --verify 'HEAD^{commit}')"
[[ "$NEW_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Fixture source SHA is invalid." >&2; exit 1; }
mkdir -p "$FIXTURE_ROOT/scripts" "$FIXTURE_GIT_DIR" "$FIXTURE_BIN" "$TMP/fixture-caddy"
export FAKE_GIT_LOG="$TMP/release-fixture-git.log"
cp "$DEPLOY_SCRIPT" "$FIXTURE_ROOT/scripts/deploy.sh"
cp "$ROOT/scripts/deploy-main-freshness.sh" "$FIXTURE_ROOT/scripts/deploy-main-freshness.sh"
cp "$ROOT/scripts/production-route-path.sh" "$FIXTURE_ROOT/scripts/production-route-path.sh"
cp "$ROOT/scripts/production-route-primitives.sh" "$FIXTURE_ROOT/scripts/production-route-primitives.sh"
cp "$DEPLOY" "$FIXTURE_ROOT/scripts/deploy-migrate.sh"
cp "$ROOT/scripts/production-release-marker.sh" "$FIXTURE_ROOT/scripts/production-release-marker.sh"
cp "$LOCK" "$FIXTURE_ROOT/scripts/production-release-lock.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FIXTURE_ROOT/scripts/deploy-preflight-schema.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FIXTURE_ROOT/scripts/production-traffic-cutover.sh"
printf '#!/usr/bin/env bash\ncat >/dev/null\nprintf "{}\\n"\n' > "$FIXTURE_ROOT/scripts/production-db-target.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FIXTURE_ROOT/scripts/production-writer-drain.sh"
printf 'services: {}\n' > "$FIXTURE_ROOT/docker-compose.prod.yml"
FIXTURE_CONTEXT="$TMP/release-fixture-context"
mkdir -p "$FIXTURE_CONTEXT"
for context_file in authorization-envelope.json preflight-result.json preflight-evidence.json restore-result.json artifact-metadata.json; do
  : > "$FIXTURE_CONTEXT/$context_file"
done
for migration_name in \
  20261002100000_active_energy_canonical_resolution \
  20261002150000_add_production_publication_generation \
  20261003120000_add_episode_aware_unified_experimental_physiology_v2 \
  20261005120000_episode_relative_muscle_core \
  20261006110000_relative_muscle_legacy_identity \
  20261006130000_unified_v4_glycogen_water_rollout; do
  migration_path="prisma/migrations/$migration_name/migration.sql"
  mkdir -p "$FIXTURE_ROOT/$(dirname "$migration_path")"
  "$REAL_GIT" -C "$ROOT" cat-file blob "$NEW_RELEASE_SHA:$migration_path" > "$FIXTURE_ROOT/$migration_path"
done
cat > "$FIXTURE_BIN/git" <<'COMMAND'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$FAKE_GIT_LOG"
if [[ "$1" == "rev-parse" && "$2" == "--absolute-git-dir" ]]; then
  printf '%s\n' "$FIXTURE_GIT_DIR"
elif [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then
  printf '%s\n' "$FIXTURE_ROOT"
elif [[ "$1" == "rev-parse" && ( "$2" == "HEAD" || "$2" == "--verify" ) ]]; then
  printf '%s\n' "$FAKE_DEPLOY_SHA"
elif [[ "$1" == "cat-file" ]]; then
  "$REAL_GIT" -C "$SOURCE_ROOT" "$@"
elif [[ "$1" == "-c" && "$3" == "fetch" || "$1" == "fetch" ]]; then
  exit 0
elif [[ "$1" == "status" ]]; then
  exit 0
else
  echo "Unexpected fixture git command: $*" >&2
  exit 90
fi
COMMAND
cat > "$FIXTURE_BIN/docker" <<'COMMAND'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [[ "$1" == "inspect" ]]; then printf 'healthy\n'; exit 0; fi
if [[ "$1" == "compose" && "$*" == *"config --quiet"* ]]; then exit 47; fi
if [[ "$1" == "compose" && "$*" == *"production-db-preflight.mjs"* ]]; then printf '{}\n'; exit 0; fi
if [[ "$1" == "compose" && "$*" == *"production-migration-image-check.mjs"* ]]; then printf 'fixture image checked\n'; exit 0; fi
if [[ "$1" == "compose" && "$*" == *"--before-ddl"* ]]; then
  [[ "${FAKE_GUARD_MODE:-allow}" == "allow" ]] || { echo "final signed backup/restore guard rejected" >&2; exit 41; }
  printf '{"ready":true}\n'
  exit 0
fi
if [[ "$1" == "compose" && "$*" == *"run-prisma-migrate-with-lock-timeout.mjs"* ]]; then
  count=0
  [[ ! -f "$FAKE_MIGRATION_COUNT" ]] || count="$(<"$FAKE_MIGRATION_COUNT")"
  printf '%s\n' "$((count + 1))" > "$FAKE_MIGRATION_COUNT"
  [[ "${FAKE_MIGRATION_EXIT:-77}" == "0" ]] && exit 0
  echo "synthetic Prisma failure after the DDL boundary" >&2
  exit 77
fi
exit 0
COMMAND
cat > "$FIXTURE_BIN/flock" <<'COMMAND'
#!/usr/bin/env bash
exit 0
COMMAND
chmod +x "$FIXTURE_BIN/git" "$FIXTURE_BIN/docker" "$FIXTURE_BIN/flock"

run_fixture_command() {
  local mode="$1" sha="$2" output="$3" script="$4"
  env PATH="$FIXTURE_BIN:$PATH" FIXTURE_ROOT="$FIXTURE_ROOT" FIXTURE_GIT_DIR="$FIXTURE_GIT_DIR" \
    FAKE_DEPLOY_SHA="$sha" REAL_GIT="$REAL_GIT" SOURCE_ROOT="$ROOT" \
    FAKE_DOCKER_LOG="$DOCKER_LOG" FAKE_GIT_LOG="$FAKE_GIT_LOG" \
    FAKE_MIGRATION_COUNT="$MIGRATION_COUNT" FAKE_GUARD_MODE="$mode" \
    BODYCAST_MIGRATION_MANIFEST_ID=active-energy-unified-v2 RELEASE_SHA="$NEW_RELEASE_SHA" \
    BODYCAST_MIGRATION_CONTEXT_DIR="$FIXTURE_CONTEXT" \
    BODYCAST_AUTHORIZATION_WORKFLOW_ID=1 BODYCAST_AUTHORIZATION_RUN_ID=2 BODYCAST_AUTHORIZATION_RUN_ATTEMPT=1 \
    DEPLOY_SHA="$sha" APP_HOST=bodycast.example CADDY_ROUTES_PATH="$TMP/fixture-caddy" \
    bash "$script" > "$output" 2>&1
}

# Before the marker, a rejected signed final guard leaves the database and
# marker untouched and does not invoke Prisma (covers missing/invalid backup,
# key, restore rehearsal, or other signed readiness facts as one fail-closed gate).
: > "$DOCKER_LOG"
if run_fixture_command reject "$NEW_RELEASE_SHA" "$TMP/guard-rejected.log" "$FIXTURE_ROOT/scripts/deploy-migrate.sh"; then
  echo "Expected the final migration guard to reject incomplete backup/restore evidence." >&2
  exit 1
fi
grep -Fq 'final signed backup/restore guard rejected' "$TMP/guard-rejected.log"
test ! -e "$FIXTURE_GIT_DIR/bodycast-production-schema-cutover"
test ! -e "$MIGRATION_COUNT"
! grep -Fq 'run-prisma-migrate-with-lock-timeout.mjs' "$DOCKER_LOG"

# Failure after the durable boundary is not retried and leaves the prior app
# blocked before any Docker operation.
rm -f "$FIXTURE_CONTEXT/final-guard-receipt.json"
: > "$DOCKER_LOG"
if run_fixture_command allow "$NEW_RELEASE_SHA" "$TMP/migration-failed.log" "$FIXTURE_ROOT/scripts/deploy-migrate.sh"; then
  echo "Expected the Prisma fixture to fail after the irreversible marker." >&2
  exit 1
fi
grep -Fq 'synthetic Prisma failure after the DDL boundary' "$TMP/migration-failed.log" || {
  cat "$TMP/migration-failed.log" >&2
  exit 1
}
grep -Eq '^state=ddl-started$' "$FIXTURE_GIT_DIR/bodycast-production-schema-cutover"
[[ "$(<"$MIGRATION_COUNT")" == "1" ]]
test ! -e "$FIXTURE_GIT_DIR/bodycast-production-schema-cutover.new"

: > "$DOCKER_LOG"
if run_fixture_command allow "$NEW_RELEASE_SHA" "$TMP/migration-rerun-blocked.log" "$FIXTURE_ROOT/scripts/deploy-migrate.sh"; then
  echo "Expected a second migration attempt to be blocked by the durable marker." >&2
  exit 1
fi
grep -Fq 'existing schema-cutover marker requires explicit recovery' "$TMP/migration-rerun-blocked.log"
test ! -s "$DOCKER_LOG"
[[ "$(<"$MIGRATION_COUNT")" == "1" ]]

if run_fixture_command allow "$OLD_RELEASE_SHA" "$TMP/old-app-blocked.log" "$FIXTURE_ROOT/scripts/deploy.sh"; then
  echo "Expected the previous app SHA to be blocked while the marker exists." >&2
  exit 1
fi
grep -Fq 'Deployment SHA/state does not match' "$TMP/old-app-blocked.log"
test ! -s "$DOCKER_LOG"

# With no marker, prior-release deploy reaches only the read-only/preflight path;
# this fixture deliberately stops at config validation before any app mutation.
rm -f "$FIXTURE_GIT_DIR/bodycast-production-schema-cutover"
: > "$DOCKER_LOG"
if run_fixture_command allow "$OLD_RELEASE_SHA" "$TMP/pre-marker-deploy.log" "$FIXTURE_ROOT/scripts/deploy.sh"; then
  echo "Expected the fixture to stop at its intentional Compose config failure." >&2
  exit 1
fi
grep -Fq 'compose -f docker-compose.prod.yml config --quiet' "$DOCKER_LOG"
test ! -e "$FIXTURE_GIT_DIR/bodycast-production-schema-cutover"

printf '%s\n' 'Production migration release-tooling shell regressions passed.'
