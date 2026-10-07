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
grep -Fq 'fetch --no-tags --prune bodycast-canonical' "$DEPLOY"
grep -Fq -- '--before-ddl' "$DEPLOY"
grep -Fq -- '--after-ddl' "$DEPLOY"
grep -Fq 'BODYCAST_FINAL_GUARD_RECEIPT' "$DEPLOY"
grep -Fq 'execution-proof.jwt' "$DEPLOY"
grep -Fq 'BODYCAST_EXECUTION_PROOF' "$DEPLOY"
grep -Fq 'BODYCAST_DDL_ATTESTATION_NONCE_DIR' "$DEPLOY"
grep -Fq 'BODYCAST_EXECUTION_PROOF_HANDOFF' "$DEPLOY"
grep -Fq 'BODYCAST_DDL_EXECUTION_CHALLENGE' "$DEPLOY"
grep -Fq 'verifyFinalGuardReceipt' "$WRAPPER"
grep -Fq 'verifyGitHubExecutionProof' "$WRAPPER"
grep -Fq 'assertPrismaTargetMatchesSignedIdentity' "$WRAPPER"
grep -Fq 'readLatestApplicablePreflightForDdl' "$WRAPPER"
grep -Fq 'assertCurrentMigrationRunMatchesProof' "$WRAPPER"
grep -Fq 'withPrismaLockTimeout(databaseUrl, 5000)' "$WRAPPER"
! grep -Fq 'BODYCAST_FINAL_GUARD_READY' "$DEPLOY" "$WRAPPER"
! grep -Fq 'CONFIRM_PRODUCTION_MIGRATE' "$DEPLOY" "$WRAPPER"
grep -Fq 'environment: production-migration-authorization' "$MIGRATE"
grep -Fq 'npx prisma migrate deploy --schema prisma/schema.prisma' "$PREFLIGHT"
grep -Fq 'DATABASE_URL: postgresql://bodycast_restore:' "$PREFLIGHT"
grep -Fq 'production migration: NOT EXECUTED' "$PREFLIGHT"
grep -Fq 'compose rm --force app' "$CUTOVER"
grep -Fq 'state !== "absent"' "$WRITER_DRAIN"
grep -Fq 'Irreversible recovery boundary' "$DEPLOY"
MARKER_LINE="$(grep -nF 'write_bodycast_release_marker "$RELEASE_SHA" ddl-started' "$DEPLOY" | cut -d: -f1)"
PRISMA_SPAWN_LINE="$(grep -nF '  migrate' "$DEPLOY" | tail -n1 | cut -d: -f1)"
AFTER_DDL_LINE="$(grep -nF -- '--after-ddl' "$DEPLOY" | cut -d: -f1)"
SCHEMA_APPLIED_LINE="$(grep -nF 'write_bodycast_release_marker "$RELEASE_SHA" schema-applied' "$DEPLOY" | cut -d: -f1)"
APP_READY_LINE="$(grep -nF 'write_bodycast_release_marker "$DEPLOY_SHA" app-ready' "$ROOT/scripts/deploy.sh" | cut -d: -f1)"
APP_SHA_CHECK_LINE="$(grep -nF 'deployed_container_sha=' "$ROOT/scripts/deploy.sh" | cut -d: -f1)"
[[ -n "$MARKER_LINE" && -n "$PRISMA_SPAWN_LINE" && -n "$AFTER_DDL_LINE" && -n "$SCHEMA_APPLIED_LINE" ]]
[[ "$MARKER_LINE" -lt "$PRISMA_SPAWN_LINE" && "$PRISMA_SPAWN_LINE" -lt "$AFTER_DDL_LINE" && "$AFTER_DDL_LINE" -lt "$SCHEMA_APPLIED_LINE" ]]
[[ -n "$APP_READY_LINE" && -n "$APP_SHA_CHECK_LINE" && "$APP_SHA_CHECK_LINE" -lt "$APP_READY_LINE" ]]
! grep -Eq 'trap .*clear_bodycast_release_marker|clear_bodycast_release_marker' "$DEPLOY"

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

# Exercise the real deploy gate with a disposable fixture and command stubs. A
# missing marker permits the prior SHA to reach the ordinary guarded deploy path;
# a post-marker process failure must leave the marker in place and block that SHA.
RECOVERY_ROOT="$TMP/release-marker-deploy-fixture"
RECOVERY_GIT_DIR="$RECOVERY_ROOT/.git"
RECOVERY_BIN="$TMP/release-marker-command-stubs"
RECOVERY_DOCKER_LOG="$TMP/release-marker-docker.log"
OLD_RELEASE_SHA="1111111111111111111111111111111111111111"
NEW_RELEASE_SHA="6d7582fd63e8b96ac843e172bcccbfb941999a07"
REAL_GIT="$(command -v git)"
mkdir -p "$RECOVERY_ROOT/scripts" "$RECOVERY_GIT_DIR" "$RECOVERY_BIN"
export FAKE_GIT_LOG="$TMP/recovery-git.log"
cp "$ROOT/scripts/deploy.sh" "$RECOVERY_ROOT/scripts/deploy.sh"
cp "$ROOT/scripts/deploy-migrate.sh" "$RECOVERY_ROOT/scripts/deploy-migrate.sh"
cp "$ROOT/scripts/production-release-marker.sh" "$RECOVERY_ROOT/scripts/production-release-marker.sh"
# Redirect only the disposable script copy to a temp host-client path. The real
# production entrypoint remains pinned to /usr/local/bin.
sed -i "s|/usr/local/bin/bodycast-production-operation|$RECOVERY_BIN/bodycast-production-operation|g" \
  "$RECOVERY_ROOT/scripts/deploy-migrate.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$RECOVERY_ROOT/scripts/deploy-preflight-schema.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$RECOVERY_ROOT/scripts/production-traffic-cutover.sh"
printf '#!/usr/bin/env bash\ncat >/dev/null\nprintf "{}\\n"\n' > "$RECOVERY_ROOT/scripts/production-db-target.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$RECOVERY_ROOT/scripts/production-writer-drain.sh"
printf 'services: {}\n' > "$RECOVERY_ROOT/docker-compose.prod.yml"
RECOVERY_CONTEXT="$TMP/release-marker-context"
mkdir -p "$RECOVERY_CONTEXT"
for context_file in authorization-envelope.json preflight-result.json preflight-evidence.json restore-result.json artifact-metadata.json; do
  : > "$RECOVERY_CONTEXT/$context_file"
done
for migration_name in \
  20261002100000_active_energy_canonical_resolution \
  20261002150000_add_production_publication_generation \
  20261003120000_add_episode_aware_unified_experimental_physiology_v2 \
  20261005120000_episode_relative_muscle_core \
  20261006110000_relative_muscle_legacy_identity \
  20261006130000_unified_v4_glycogen_water_rollout; do
  migration_path="prisma/migrations/$migration_name/migration.sql"
  mkdir -p "$RECOVERY_ROOT/$(dirname "$migration_path")"
  "$REAL_GIT" -C "$ROOT" cat-file blob "$NEW_RELEASE_SHA:$migration_path" > "$RECOVERY_ROOT/$migration_path"
done
cat > "$RECOVERY_BIN/git" <<'COMMAND'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s | gitdir=%s\n' "$*" "${RECOVERY_GIT_DIR:-unset}" >> "$FAKE_GIT_LOG"
if [[ "$1" == "rev-parse" && "$2" == "--absolute-git-dir" ]]; then
  printf '%s\n' "$RECOVERY_GIT_DIR"
elif [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then
  printf '%s\n' "$RECOVERY_ROOT"
elif [[ "$1" == "rev-parse" && "$2" == "HEAD" ]]; then
  printf '%s\n' "$FAKE_DEPLOY_SHA"
elif [[ "$1" == "rev-parse" && "$2" == "--verify" ]]; then
  printf '%s\n' "$FAKE_DEPLOY_SHA"
elif [[ "$1" == "cat-file" ]]; then
  "$REAL_GIT" -C "$SOURCE_ROOT" "$@"
elif [[ "$1" == "-c" && "$3" == "fetch" ]]; then
  exit 0
elif [[ "$1" == "fetch" || "$1" == "checkout" ]]; then
  exit 0
elif [[ "$1" == "status" ]]; then
  exit 0
else
  echo "Unexpected fixture git command: $*" >&2
  exit 90
fi
COMMAND
cat > "$RECOVERY_BIN/docker" <<'COMMAND'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [[ "$1" == "image" && "$2" == "inspect" ]]; then exit 1; fi
if [[ "$1" == "inspect" ]]; then printf 'healthy\n'; exit 0; fi
if [[ "$1" == "compose" && "$*" == *"config --quiet"* ]]; then exit 47; fi
if [[ "$1" == "compose" && "$*" == *"production-db-preflight.mjs"* ]]; then printf '{}\n'; exit 0; fi
if [[ "$1" == "compose" && "$*" == *"--before-ddl"* ]]; then printf '{}\n'; exit 0; fi
if [[ "$1" == "compose" && "$*" == *"production-migration-image-check.mjs"* ]]; then printf 'fixture image checked\n'; exit 0; fi
if [[ "$1" == "compose" && "$*" == *"run"* && "$*" == *" migrate" ]]; then
  echo "Unexpected Prisma migration spawn in marker failure test." >&2
  exit 99
fi
exit 0
COMMAND
cat > "$RECOVERY_BIN/flock" <<'COMMAND'
#!/usr/bin/env bash
exit 0
COMMAND
chmod +x "$RECOVERY_BIN/git" "$RECOVERY_BIN/docker" "$RECOVERY_BIN/flock"

run_fixture_deploy() {
  local sha="$1"
  : > "$RECOVERY_DOCKER_LOG"
  if env PATH="$RECOVERY_BIN:$PATH" \
    RECOVERY_ROOT="$RECOVERY_ROOT" RECOVERY_GIT_DIR="$RECOVERY_GIT_DIR" FAKE_DEPLOY_SHA="$sha" \
    FAKE_DOCKER_LOG="$RECOVERY_DOCKER_LOG" FAKE_GIT_LOG="$TMP/recovery-git.log" DEPLOY_SHA="$sha" \
    APP_HOST=bodycast.example CADDY_ROUTES_PATH="$TMP/recovery-caddy" \
    bash "$RECOVERY_ROOT/scripts/deploy.sh" > "$TMP/recovery-deploy.log" 2>&1; then
    echo "Expected fixture deployment to stop at its deliberate pre-cutover failure." >&2
    return 1
  else
    local status=$?
    [[ "$status" -ne 0 ]]
  fi
}

# Before the irreversible marker, the prior SHA can reach the guarded deploy path.
run_fixture_deploy "$OLD_RELEASE_SHA"
grep -Fq 'compose -f docker-compose.prod.yml config --quiet' "$RECOVERY_DOCKER_LOG"
test ! -e "$RECOVERY_GIT_DIR/bodycast-production-schema-cutover"

# Migration must fail closed when authority is absent; caller-controlled env
# cannot enable the old in-checkout migration implementation.
AUTHORITY_LOG="$TMP/migration-authority.log"
: > "$RECOVERY_DOCKER_LOG"
if env PATH="$RECOVERY_BIN:$PATH" \
  RECOVERY_ROOT="$RECOVERY_ROOT" RECOVERY_GIT_DIR="$RECOVERY_GIT_DIR" \
  FAKE_DEPLOY_SHA="$NEW_RELEASE_SHA" REAL_GIT="$REAL_GIT" SOURCE_ROOT="$ROOT" \
  FAKE_DOCKER_LOG="$RECOVERY_DOCKER_LOG" FAKE_GIT_LOG="$TMP/recovery-git.log" \
  FAKE_AUTHORITY_LOG="$AUTHORITY_LOG" BODYCAST_AUTHORITY_EXECUTION=1 \
  BODYCAST_MIGRATION_MANIFEST_ID=active-energy-unified-v2 RELEASE_SHA="$NEW_RELEASE_SHA" \
  BODYCAST_MIGRATION_CONTEXT_DIR="$RECOVERY_CONTEXT" APP_HOST=bodycast.example \
  CADDY_ROUTES_PATH="$TMP/recovery-caddy" \
  BODYCAST_AUTHORIZATION_WORKFLOW_ID=1 BODYCAST_AUTHORIZATION_RUN_ID=2 \
  BODYCAST_AUTHORIZATION_RUN_ATTEMPT=1 \
  bash "$RECOVERY_ROOT/scripts/deploy-migrate.sh" > "$TMP/recovery-migrate.log" 2>&1; then
  echo "Expected production migration to fail closed without the host authority." >&2
  exit 1
fi
grep -Fq 'recovery-aware host authority is unavailable' "$TMP/recovery-migrate.log"
test ! -s "$AUTHORITY_LOG"
test ! -e "$RECOVERY_GIT_DIR/bodycast-production-schema-cutover"
test ! -s "$RECOVERY_DOCKER_LOG"

# With the fixed host client present the script sends only the typed operation.
# The host broker owns readiness and invokes its immutable fixed adapter; this
# release-side process has no internal bypass even when the old env flag is set.
cat > "$RECOVERY_BIN/bodycast-production-operation" <<'COMMAND'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_AUTHORITY_LOG"
COMMAND
chmod +x "$RECOVERY_BIN/bodycast-production-operation"
: > "$AUTHORITY_LOG"
env PATH="$RECOVERY_BIN:$PATH" \
  RECOVERY_ROOT="$RECOVERY_ROOT" RECOVERY_GIT_DIR="$RECOVERY_GIT_DIR" \
  FAKE_DEPLOY_SHA="$NEW_RELEASE_SHA" REAL_GIT="$REAL_GIT" SOURCE_ROOT="$ROOT" \
  FAKE_DOCKER_LOG="$RECOVERY_DOCKER_LOG" FAKE_GIT_LOG="$TMP/recovery-git.log" \
  FAKE_AUTHORITY_LOG="$AUTHORITY_LOG" BODYCAST_AUTHORITY_EXECUTION=1 \
  BODYCAST_MIGRATION_MANIFEST_ID=active-energy-unified-v2 RELEASE_SHA="$NEW_RELEASE_SHA" \
  BODYCAST_MIGRATION_CONTEXT_DIR="$RECOVERY_CONTEXT" APP_HOST=bodycast.example \
  CADDY_ROUTES_PATH="$TMP/recovery-caddy" \
  BODYCAST_AUTHORIZATION_WORKFLOW_ID=1 BODYCAST_AUTHORIZATION_RUN_ID=2 \
  BODYCAST_AUTHORIZATION_RUN_ATTEMPT=1 \
  bash "$RECOVERY_ROOT/scripts/deploy-migrate.sh" > "$TMP/recovery-migrate.log" 2>&1
grep -Fq "forward-migration --request-id migration-1-2-1-request --release-sha $NEW_RELEASE_SHA --canonical-main-sha $NEW_RELEASE_SHA --migration-manifest-id active-energy-unified-v2 --authorization-context-id migration-1-2-1" "$AUTHORITY_LOG"
test ! -e "$RECOVERY_GIT_DIR/bodycast-production-schema-cutover"
test ! -s "$RECOVERY_DOCKER_LOG"

# An active marker blocks the old binary. The authority-mediated migration
# readiness test covers the corresponding host-side block.
(
  cd "$RECOVERY_ROOT"
  PATH="$RECOVERY_BIN:$PATH" RECOVERY_GIT_DIR="$RECOVERY_GIT_DIR" FAKE_GIT_LOG="$TMP/recovery-git.log" \
    bash -c 'source scripts/production-release-marker.sh; write_bodycast_release_marker "$1" ddl-started' _ "$NEW_RELEASE_SHA"
)
run_fixture_deploy "$OLD_RELEASE_SHA"
grep -Fq 'Deployment SHA/state does not match' "$TMP/recovery-deploy.log" || {
  cat "$TMP/recovery-deploy.log" >&2
  cat "$TMP/recovery-git.log" >&2
  cat "$RECOVERY_GIT_DIR/bodycast-production-schema-cutover" >&2
  (cd "$RECOVERY_ROOT" && PATH="$RECOVERY_BIN:$PATH" RECOVERY_GIT_DIR="$RECOVERY_GIT_DIR" FAKE_GIT_LOG="$TMP/recovery-git.log" bash -c 'source scripts/production-release-marker.sh; printf "path=%s\n" "$BODYCAST_RELEASE_MARKER_PATH"; read_bodycast_release_marker; printf "state=%s sha=%s\n" "$BODYCAST_MARKER_STATE" "$BODYCAST_MARKER_RELEASE_SHA"') >&2
  exit 1
}
test ! -s "$RECOVERY_DOCKER_LOG"

# Only an explicit operator recovery step after verified restore removes the
# marker; the same prior-SHA deploy then reaches the ordinary guarded path.
(
  cd "$RECOVERY_ROOT"
  PATH="$RECOVERY_BIN:$PATH" RECOVERY_GIT_DIR="$RECOVERY_GIT_DIR" RESTORE_VERIFIED=1 FAKE_GIT_LOG="$TMP/recovery-git.log" \
    bash -c 'test "$RESTORE_VERIFIED" = 1; source scripts/production-release-marker.sh; clear_bodycast_release_marker'
)
test ! -e "$RECOVERY_GIT_DIR/bodycast-production-schema-cutover"
run_fixture_deploy "$OLD_RELEASE_SHA"
grep -Fq 'compose -f docker-compose.prod.yml config --quiet' "$RECOVERY_DOCKER_LOG"

printf '%s\n' 'Production migration release-tooling shell regressions passed.'
