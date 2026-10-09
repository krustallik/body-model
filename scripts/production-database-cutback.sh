#!/usr/bin/env bash
# Owner-dispatched, manual cutback to the verified pre-DDL database snapshot.
# The migrated database is retained under a failed-run name until the restored
# database and exact previous app image pass every gate.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT_DIR"
readonly DB_CONTAINER="bodycast-db-prod"
readonly APP_CONTAINER="bodycast-app-prod"
readonly CADDY_CONTAINER="gymbeam-caddy"
readonly POSTGRES_IMAGE="postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24"
readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly CURRENT_MAIN_SHA="${BODYCAST_CUTBACK_CURRENT_MAIN_SHA:-}"
readonly FAILED_RELEASE_SHA="${BODYCAST_CUTBACK_FAILED_RELEASE_SHA:-}"
readonly FAILED_MIGRATION_RUN_ID="${BODYCAST_CUTBACK_FAILED_RUN_ID:-}"
readonly CUTBACK_RUN_ID="${BODYCAST_CUTBACK_RUN_ID:-}"
readonly CONTEXT_DIR="${BODYCAST_CUTBACK_CONTEXT_DIR:-}"
readonly ARCHIVE_SHA256="${BODYCAST_CUTBACK_ARCHIVE_SHA256:-}"
readonly CONFIRMATION="${BODYCAST_CUTBACK_CONFIRMATION:-}"
readonly APP_HOST="${APP_HOST:?APP_HOST is required}"
CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:?CADDY_ROUTES_PATH is required}"
source "$ROOT_DIR/scripts/production-route-path.sh"
bodycast_canonicalize_routes_path || exit 1
readonly CADDY_ROUTES_PATH
export APP_HOST CADDY_ROUTES_PATH
source "$ROOT_DIR/scripts/production-release-marker.sh"
source "$ROOT_DIR/scripts/deploy-main-freshness.sh"
source "$ROOT_DIR/scripts/production-release-lock.sh"
source "$ROOT_DIR/scripts/production-route-primitives.sh"

fail() { echo "Production database cutback blocked: $*" >&2; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
admin_sql() {
  docker exec "$DB_CONTAINER" sh -c \
    'exec psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname=postgres --command="$1"' \
    _ "$1"
}

[[ "$CONFIRMATION" == "RESTORE_PRE_DDL_DATABASE" ]] || fail "the owner-only workflow confirmation is missing."
[[ "$CURRENT_MAIN_SHA" =~ ^[a-f0-9]{40}$ && "$FAILED_RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "current-main and failed-release SHA values must be full commits."
[[ "$FAILED_MIGRATION_RUN_ID" =~ ^[1-9][0-9]*$ && "$CUTBACK_RUN_ID" =~ ^[1-9][0-9]*$ ]] || fail "workflow run IDs are invalid."
[[ "$ARCHIVE_SHA256" =~ ^[a-f0-9]{64}$ ]] || fail "authenticated decrypted archive digest is missing."
[[ "$CONTEXT_DIR" =~ ^/tmp/bodycast-cutback-context-[1-9][0-9]*-[1-9][0-9]*$ && -d "$CONTEXT_DIR" && ! -L "$CONTEXT_DIR" ]] || fail "the fixed signed-context directory is unavailable."
for name in authorization-envelope.json artifact-metadata.json preflight-evidence.json preflight-report.json preflight-result.json restore-result.json; do
  [[ -f "$CONTEXT_DIR/$name" && ! -L "$CONTEXT_DIR/$name" ]] || fail "signed cutback provenance is missing or unsafe: $name"
done

bodycast_acquire_production_release_lock
[[ "$(git rev-parse --show-toplevel)" == "$ROOT_DIR" && "$(git rev-parse HEAD)" == "$CURRENT_MAIN_SHA" ]] || fail "the host checkout is not the exact cutback tooling SHA."
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || fail "the production checkout is dirty."
bodycast_assert_current_main_sha "$CURRENT_MAIN_SHA"

node "$ROOT_DIR/scripts/production-database-cutback.mjs" --verify-context \
  "$CONTEXT_DIR" "$FAILED_MIGRATION_RUN_ID" "$FAILED_RELEASE_SHA" "$CONTEXT_DIR/production-backup.pgdump.enc" \
  > "$CONTEXT_DIR/cutback-context-verification.json"
record_path="$(git rev-parse --absolute-git-dir)/bodycast-production-pre-ddl-release"
[[ -f "$record_path" && ! -L "$record_path" ]] || fail "the immutable pre-DDL previous-app capture is missing."
record_lines="$(wc -l < "$record_path" | tr -d ' ')"
[[ "$record_lines" == "6" ]] || fail "the previous-app capture has an unsupported schema."
mapfile -t record= < "$record_path"
[[ "${record[0]}" == "schemaVersion=1" && "${record[1]}" == "targetSha=$FAILED_RELEASE_SHA" ]] || fail "previous-app capture is bound to a different migration."
PREVIOUS_SHA="${record[2]#previousSha=}"
PREVIOUS_IMAGE_ID="${record[3]#previousImageId=}"
PREVIOUS_CONTAINER_ID="${record[4]#previousContainerId=}"
PREVIOUS_RUNTIME_CONFIG_DIGEST="${record[5]#previousRuntimeConfigDigest=}"
[[ "${record[2]}" == previousSha=* && "$PREVIOUS_SHA" =~ ^[a-f0-9]{40}$ \
  && "${record[3]}" == previousImageId=* && "$PREVIOUS_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ \
  && "${record[4]}" == previousContainerId=* && "$PREVIOUS_CONTAINER_ID" =~ ^[a-f0-9]{64}$ \
  && "${record[5]}" == previousRuntimeConfigDigest=* && "$PREVIOUS_RUNTIME_CONFIG_DIGEST" =~ ^[a-f0-9]{64}$ ]] || fail "previous app identity/runtime capture is malformed."
[[ "$(docker image inspect --format '{{.Id}}' bodycast-app:rollback 2>/dev/null || true)" == "$PREVIOUS_IMAGE_ID" ]] || fail "the pinned previous app image differs from the captured immutable image ID."

marker_status=1
if read_bodycast_release_marker; then marker_status=0; else marker_status=$?; fi
[[ "$marker_status" -eq 0 && "$BODYCAST_MARKER_RELEASE_SHA" == "$FAILED_RELEASE_SHA" \
  && "$BODYCAST_MARKER_STATE" =~ ^(ddl-started|schema-applied|app-ready|v4-ready)$ ]] || fail "the exact failed-release marker is absent, conflicting, or outside the reviewed cutback states."
bodycast_verify_exact_maintenance_route
maintenance_marker="$(bodycast_maintenance_marker_from_route)"
bodycast_probe_public_maintenance "$maintenance_marker"
app_names="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"
[[ -z "$app_names" ]] || fail "an app container exists; remove/stop it under the reviewed maintenance procedure before cutback."
bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert
[[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER")" == "healthy" ]] || fail "the existing PostgreSQL container is not healthy."

TMP_DIR="$(mktemp -d "/dev/shm/bodycast-cutback-${CUTBACK_RUN_ID}.XXXXXX")" || fail "a private tmpfs staging directory is unavailable."
chmod 700 "$TMP_DIR"
ARCHIVE="$TMP_DIR/pre-ddl.pgdump"
STAGING_REPORT="$TMP_DIR/staging-report.json"
STAGING_READABILITY="$TMP_DIR/staging-readability.json"
LIVE_REPORT="$TMP_DIR/live-report.json"
stage_db="bodycast_cutback_${FAILED_MIGRATION_RUN_ID}"
failed_db="bodycast_failed_${FAILED_MIGRATION_RUN_ID}"
stage_created=false
database_swapped=false
route_committed=false
app_started=false

cleanup_cutback() {
  local status=$?
  trap - ERR EXIT
  set +e
  if [[ "$database_swapped" == "false" && "$stage_created" == "true" ]]; then
    admin_sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${stage_db}' AND pid <> pg_backend_pid();" >/dev/null 2>&1
    admin_sql "DROP DATABASE IF EXISTS ${stage_db};" >/dev/null 2>&1
  fi
  if [[ "$app_started" == "true" && "$route_committed" == "false" ]]; then
    if [[ "$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER" 2>/dev/null || true)" == "$PREVIOUS_SHA" \
      && "$(docker inspect --format '{{.Image}}' "$APP_CONTAINER" 2>/dev/null || true)" == "$PREVIOUS_IMAGE_ID" ]]; then
      docker update --restart=no "$APP_CONTAINER" >/dev/null 2>&1
      docker stop --time 0 "$APP_CONTAINER" >/dev/null 2>&1
      compose rm --force app >/dev/null 2>&1
    fi
  fi
  if [[ "$database_swapped" == "true" && ! -e "$BODYCAST_RELEASE_MARKER_PATH" ]]; then
    # No marker removal is attempted here; recovery state remains blocking.
    :
  fi
  if [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" && ! -L "$TMP_DIR" ]]; then rm -rf -- "$TMP_DIR"; fi
  if [[ "$route_committed" == "true" ]]; then exit 0; fi
  exit "$status"
}
trap cleanup_cutback EXIT

# No production database mutation occurs until the complete plaintext archive
# has arrived over the authenticated SSH stream and its digest is verified.
cat > "$ARCHIVE"
chmod 600 "$ARCHIVE"
actual_archive_sha="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
[[ "$actual_archive_sha" == "$ARCHIVE_SHA256" ]] || fail "decrypted archive stream digest differs from the runner's authenticated bytes."
docker run --rm --volume "$ARCHIVE:/restore/pre-ddl.pgdump:ro" "$POSTGRES_IMAGE" \
  pg_restore --list /restore/pre-ddl.pgdump >/dev/null

# Recheck the exact signed target immediately before staging the restore.
APP_HOST="$APP_HOST" CADDY_ROUTES_PATH="$CADDY_ROUTES_PATH" \
  bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" > "$LIVE_REPORT"
node "$ROOT_DIR/scripts/production-database-cutback.mjs" --verify-live-identity "$CONTEXT_DIR" "$LIVE_REPORT" >/dev/null
stage_exists="$(admin_sql "SELECT count(*) FROM pg_database WHERE datname='${stage_db}';" | tr -d '[:space:]')"
failed_exists="$(admin_sql "SELECT count(*) FROM pg_database WHERE datname='${failed_db}';" | tr -d '[:space:]')"
[[ "$stage_exists" == "0" && "$failed_exists" == "0" ]] || fail "a staging or retained failed database already exists for this run; operator review is required."
admin_sql "CREATE DATABASE ${stage_db} OWNER bodycast;" >/dev/null
stage_created=true
docker exec -i "$DB_CONTAINER" sh -c \
  'exec pg_restore --exit-on-error --no-owner --no-privileges --single-transaction --username="$POSTGRES_USER" --dbname="$1"' \
  _ "$stage_db" < "$ARCHIVE"

node "$ROOT_DIR/scripts/production-db-preflight.mjs" \
  | docker exec -i "$DB_CONTAINER" sh -c \
    'exec psql --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=BODYCAST_WRITER_TOPOLOGY_JSON=null --username="$POSTGRES_USER" --dbname="$1"' \
    _ "$stage_db" > "$STAGING_REPORT"
docker exec -i "$DB_CONTAINER" sh -c \
  'exec psql --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$1"' \
  _ "$stage_db" < "$ROOT_DIR/scripts/verify-restored-backup.sql" > "$STAGING_READABILITY"
node "$ROOT_DIR/scripts/production-database-cutback.mjs" --verify-restored \
  "$CONTEXT_DIR" "$STAGING_REPORT" "$STAGING_READABILITY" > "$TMP_DIR/restore-verification.json"
node "$ROOT_DIR/scripts/production-database-cutback.mjs" --verify-previous-release \
  "$PREVIOUS_SHA" "$STAGING_READABILITY" > "$TMP_DIR/previous-release-verification.json"
node "$ROOT_DIR/scripts/production-database-cutback.mjs" --verify-restored-identity \
  "$CONTEXT_DIR" "$STAGING_REPORT" "$stage_db" > "$TMP_DIR/staging-identity-verification.json"

# All destructive cutback preconditions have passed: exact signed backup,
# authenticated bytes, exact target cluster, maintenance, zero writers, complete
# restore, schema/history/data checks, and the immutable previous app image.
bodycast_assert_current_main_sha "$CURRENT_MAIN_SHA"
marker_status=1
if read_bodycast_release_marker; then marker_status=0; else marker_status=$?; fi
[[ "$marker_status" -eq 0 && "$BODYCAST_MARKER_RELEASE_SHA" == "$FAILED_RELEASE_SHA" ]] || fail "release marker changed during cutback preparation."
bodycast_verify_exact_maintenance_route
bodycast_probe_public_maintenance "$maintenance_marker"
bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert
APP_HOST="$APP_HOST" CADDY_ROUTES_PATH="$CADDY_ROUTES_PATH" \
  bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" > "$LIVE_REPORT"
node "$ROOT_DIR/scripts/production-database-cutback.mjs" --verify-live-identity "$CONTEXT_DIR" "$LIVE_REPORT" >/dev/null
bodycast_assert_current_main_sha "$CURRENT_MAIN_SHA"

admin_sql "ALTER DATABASE bodycast RENAME TO ${failed_db};" >/dev/null
if ! admin_sql "ALTER DATABASE ${stage_db} RENAME TO bodycast;" >/dev/null; then
  admin_sql "ALTER DATABASE ${failed_db} RENAME TO bodycast;" >/dev/null 2>&1 || true
  fail "restored DB rename failed; the original migrated database was retained and traffic remains in maintenance."
fi
database_swapped=true
stage_created=false
APP_HOST="$APP_HOST" CADDY_ROUTES_PATH="$CADDY_ROUTES_PATH" \
  bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" > "$LIVE_REPORT"
node "$ROOT_DIR/scripts/production-database-cutback.mjs" --verify-restored-identity \
  "$CONTEXT_DIR" "$LIVE_REPORT" > "$TMP_DIR/restored-target-identity.json"
write_bodycast_release_marker "$FAILED_RELEASE_SHA" database-restored

# Only the exact captured previous image may start, and only after the restored
# schema/history/data checks and database identity checks above succeeded.
docker image tag bodycast-app:rollback bodycast-app:latest
[[ "$(docker image inspect --format '{{.Id}}' bodycast-app:latest)" == "$PREVIOUS_IMAGE_ID" ]] || fail "previous image retag differs from the captured immutable image."
BODYCAST_DEPLOY_SHA="$PREVIOUS_SHA" compose up -d --no-deps --no-build app
app_started=true
app_ready=false
for attempt in $(seq 1 60); do
  app_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER" 2>/dev/null || true)"
  app_image="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"
  app_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER" 2>/dev/null || true)"
  if [[ "$app_sha" == "$PREVIOUS_SHA" && "$app_image" == "$PREVIOUS_IMAGE_ID" && "$app_health" == "healthy" ]]; then
    app_ready=true
    break
  fi
  [[ "$attempt" == "60" ]] || sleep 5
done
[[ "$app_ready" == "true" ]] || fail "captured previous app did not return healthy on the verified restored schema."
runtime_digest="$(docker inspect "$APP_CONTAINER" | node "$ROOT_DIR/scripts/production-app-runtime-digest.mjs")"
[[ "$runtime_digest" == "$PREVIOUS_RUNTIME_CONFIG_DIGEST" ]] || fail "the recreated previous app runtime configuration differs from the exact captured prior runtime."
docker exec "$APP_CONTAINER" wget --quiet --tries=1 --output-document=- http://127.0.0.1:3000/api/health | grep -q '"status":"ok"' \
  || fail "captured previous app local health endpoint failed."
write_bodycast_release_marker "$FAILED_RELEASE_SHA" rollback-app-ready

bodycast_verify_exact_maintenance_route
bodycast_probe_public_maintenance "$maintenance_marker"
bodycast_stage_serving_route_config
route_stage="$BODYCAST_ROUTE_STAGE_PATH"
docker exec -i "$CADDY_CONTAINER" caddy validate --adapter caddyfile --config - < "$route_stage"
bodycast_assert_safe_routes_location
[[ "$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")" == "$PREVIOUS_SHA" \
  && "$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")" == "$PREVIOUS_IMAGE_ID" ]] || fail "previous app identity changed before serving."
bodycast_assert_current_main_sha "$CURRENT_MAIN_SHA"
bodycast_assert_safe_routes_location
[[ -f "$route_stage" && ! -L "$route_stage" ]] || fail "validated serving route stage is missing or unsafe."
bodycast_publish_staged_route "$route_stage" || fail "atomic serving route replacement failed before serving commit."
route_committed=true
set +e
if ! docker exec "$CADDY_CONTAINER" caddy reload --address unix//run/caddy-admin/admin.sock --config /etc/caddy/Caddyfile; then
  echo "POST-COMMIT VERIFICATION WARNING: Caddy reload failed; the committed route was not rolled back." >&2
fi
if ! bodycast_probe_public_candidate_observational; then
  echo "POST-COMMIT VERIFICATION WARNING: public app probe failed; the committed recovery route was not changed." >&2
fi
if ! clear_bodycast_release_marker; then
  echo "POST-COMMIT CLEANUP WARNING: restored app is serving but the release marker remains fail-closed for later operations." >&2
else
  rm -f -- "$record_path"
  sync -f "$(dirname "$record_path")"
fi
echo "Production database cutback completed from the verified pre-DDL archive; previous app ${PREVIOUS_SHA} is serving."
exit 0
