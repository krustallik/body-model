#!/usr/bin/env bash
# One-time owner-authorized initialization of a genuinely empty BodyCast host.
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT_DIR"

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly DB_CONTAINER="bodycast-db-prod"
readonly APP_CONTAINER="bodycast-app-prod"
readonly DB_VOLUME="bodycast-postgres-prod"
readonly EXPECTED_CADDY="gymbeam-caddy"
readonly EXPECTED_SHARED_NETWORK="gymbeam-internal"
readonly RELEASE_SHA="${1:-}"
readonly WORKFLOW_RUN_ID="${2:-}"
readonly WORKFLOW_RUN_ATTEMPT="${3:-}"
readonly CONFIRMATION="${BODYCAST_EMPTY_INSTALL_CONFIRMATION:-}"
readonly EXPECTED_TARGET_IP="${BODYCAST_EMPTY_INSTALL_TARGET_IP:-}"
readonly APP_HOST="${APP_HOST:-}"
CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:-}"

[[ "$(id -u)" == "0" ]] || { echo "Fresh BodyCast initialization requires the root owner of the clean VPS checkout." >&2; exit 2; }
[[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ && "$WORKFLOW_RUN_ID" =~ ^[1-9][0-9]*$ \
  && "$WORKFLOW_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]] || {
  echo "Fresh BodyCast initialization requires exact release SHA and workflow run/attempt." >&2; exit 2;
}
[[ "$CONFIRMATION" == "initialize-empty-bodycast-db" \
  && "$EXPECTED_TARGET_IP" == "169.58.239.149" \
  && "$APP_HOST" == "bodycast.ihorhub.eu" \
  && "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || {
  echo "Fresh BodyCast initialization confirmation or new-VPS target binding is invalid." >&2; exit 2;
}
[[ -d "$ROOT_DIR/.git" || -f "$ROOT_DIR/.git" ]] || { echo "Expected clean BodyCast Git checkout is missing." >&2; exit 2; }
[[ "$(git rev-parse --show-toplevel)" == "$ROOT_DIR" \
  && "$(git rev-parse HEAD)" == "$RELEASE_SHA" \
  && -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || {
  echo "Fresh installation requires the exact clean release checkout." >&2; exit 2;
}
remote_url="$(git remote get-url origin 2>/dev/null || true)"
[[ "$remote_url" =~ ^(git@github\.com:krustallik/body-model\.git|https://github\.com/krustallik/body-model\.git)$ ]] || {
  echo "Fresh installation checkout is not the canonical BodyCast repository." >&2; exit 2;
}

source "$ROOT_DIR/scripts/deploy-main-freshness.sh"
bodycast_assert_current_main_sha "$RELEASE_SHA"
source "$ROOT_DIR/scripts/production-release-lock.sh"
bodycast_acquire_production_release_lock
source "$ROOT_DIR/scripts/production-route-path.sh"
CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:?CADDY_ROUTES_PATH is required}"
bodycast_canonicalize_routes_path || exit 1
readonly CADDY_ROUTES_PATH
export APP_HOST CADDY_ROUTES_PATH
source "$ROOT_DIR/scripts/production-route-primitives.sh"

[[ ! -e "$ROOT_DIR/.env" && ! -L "$ROOT_DIR/.env" ]] || {
  echo "Fresh installation is blocked because a runtime .env already exists." >&2; exit 2;
}
[[ ! -e "$ROOT_DIR/.git/bodycast-production-empty-install" \
  && ! -L "$ROOT_DIR/.git/bodycast-production-empty-install" ]] || {
  echo "Fresh installation is one-shot; a prior attempt marker already exists." >&2; exit 2;
}
docker info >/dev/null 2>&1 || { echo "Docker is unavailable; no installation changes were made." >&2; exit 2; }
bodycast_assert_safe_routes_location
[[ ! -e "${CADDY_ROUTES_PATH%/}/bodycast.caddy" && ! -L "${CADDY_ROUTES_PATH%/}/bodycast.caddy" ]] || {
  echo "Fresh installation is blocked because a BodyCast Caddy route already exists." >&2; exit 2;
}
docker network inspect "$EXPECTED_SHARED_NETWORK" >/dev/null 2>&1 || {
  echo "The pre-existing shared Caddy network is unavailable; no new network will be created." >&2; exit 2;
}
caddy_state="$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{if index .NetworkSettings.Networks "gymbeam-internal"}}yes{{else}}no{{end}}' "$EXPECTED_CADDY" 2>/dev/null || true)"
[[ "$caddy_state" == "running|healthy|yes" || "$caddy_state" == "running|none|yes" ]] || {
  echo "The existing Caddy container is not running on the shared network; BodyCast will not change it." >&2; exit 2;
}
getent ahostsv4 "$APP_HOST" | awk -v expected="$EXPECTED_TARGET_IP" '$1 == expected { found = 1 } END { exit !found }' || {
  echo "APP_HOST does not currently resolve to the authorized new VPS IPv4 address." >&2; exit 2;
}
all_containers="$(docker ps --all --format '{{.Names}}')"
if printf '%s\n' "$all_containers" | grep -Eq '^(bodycast-app-prod|bodycast-db-prod)$'; then
  echo "Fresh installation is blocked because a BodyCast app/database container already exists." >&2; exit 2
fi
compose_containers="$(docker ps --all --filter 'label=com.docker.compose.project=bodycast-prod' --format '{{.Names}}')"
[[ -z "$compose_containers" ]] || { echo "Fresh installation is blocked by an existing BodyCast Compose container." >&2; exit 2; }
all_volumes="$(docker volume ls --format '{{.Name}}')"
if printf '%s\n' "$all_volumes" | grep -Fxq "$DB_VOLUME"; then
  echo "Fresh installation is blocked because the BodyCast PostgreSQL volume already exists." >&2; exit 2
fi

# Credentials are generated only after every pre-DDL host/topology check passes.
postgres_password="$(openssl rand -hex 32)"
shortcut_key="$(openssl rand -hex 32)"
env_tmp="$(mktemp "$ROOT_DIR/.env.new.XXXXXX")"
trap 'rm -f -- "$env_tmp"' EXIT
chmod 0600 "$env_tmp"
printf 'POSTGRES_DB=bodycast\nPOSTGRES_USER=bodycast\nPOSTGRES_PASSWORD=%s\nDATABASE_URL=postgresql://bodycast:%s@db:5432/bodycast?schema=public\nIOS_SHORTCUT_API_KEY=%s\n' \
  "$postgres_password" "$postgres_password" "$shortcut_key" > "$env_tmp"
ln -- "$env_tmp" "$ROOT_DIR/.env" || { echo "Could not create the new root-only BodyCast runtime environment." >&2; exit 1; }
rm -- "$env_tmp"
trap - EXIT
unset postgres_password shortcut_key
chmod 0600 "$ROOT_DIR/.env"
[[ "$(stat -c '%u:%a' "$ROOT_DIR/.env")" == "0:600" ]] || { echo "Generated BodyCast runtime environment permissions are invalid." >&2; exit 1; }
docker compose -f "$COMPOSE_FILE" config --quiet

git_dir="$(git rev-parse --absolute-git-dir)"
[[ -d "$git_dir" && ! -L "$git_dir" ]] || { echo "Canonical Git metadata directory is unavailable." >&2; exit 1; }
marker_path="$git_dir/bodycast-production-empty-install"
marker_tmp="$(mktemp "$git_dir/bodycast-production-empty-install.new.XXXXXX")"
chmod 0600 "$marker_tmp"
printf 'schemaVersion=1\nstate=started\nreleaseSha=%s\nworkflowRunId=%s\nworkflowRunAttempt=%s\nmigrationTreeDigest=unknown\nappImageId=unknown\n' \
  "$RELEASE_SHA" "$WORKFLOW_RUN_ID" "$WORKFLOW_RUN_ATTEMPT" > "$marker_tmp"
sync -f "$marker_tmp"
ln -- "$marker_tmp" "$marker_path" || { rm -f -- "$marker_tmp"; echo "Could not establish one-shot fresh-install marker." >&2; exit 1; }
rm -- "$marker_tmp"
sync -f "$git_dir"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
compose up -d --no-deps db

db_healthy=false
for attempt in $(seq 1 60); do
  db_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER")"
  if [[ "$db_state" == "healthy" ]]; then db_healthy=true; break; fi
  [[ "$db_state" != "unhealthy" && "$db_state" != "exited" ]] || {
    echo "New PostgreSQL container failed its health check; preserving it and stopping without retry." >&2; exit 1;
  }
  sleep 2
done
[[ "$db_healthy" == true ]] || { echo "New PostgreSQL container did not become healthy within the bounded startup window." >&2; exit 1; }

public_table_count="$(compose exec -T db psql --no-psqlrc --quiet --tuples-only --no-align -U bodycast -d bodycast \
  --set=ON_ERROR_STOP=1 --command="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'")"
[[ "$public_table_count" == "0" ]] || { echo "New PostgreSQL database is not empty before migration; refusing DDL." >&2; exit 1; }
compose --profile tools build migrate
compose --profile tools run --rm --no-deps --entrypoint npx migrate prisma migrate deploy --schema prisma/schema.prisma

migration_status="$(compose --profile tools run --rm --no-deps --entrypoint npx migrate prisma migrate status --schema prisma/schema.prisma 2>&1)" || {
  printf '%s\n' "$migration_status" >&2
  echo "Fresh Prisma migration status failed; preserving the database and one-shot marker without retry." >&2
  exit 1
}
printf '%s\n' "$migration_status" | grep -Eqi 'Database schema is up to date' || {
  echo "Prisma did not confirm that the fresh schema is up to date; preserving the database without retry." >&2; exit 1;
}
ledger_result="$(compose --profile tools run --rm --no-deps --env "BODYCAST_EMPTY_INSTALL_RUN_ID=$WORKFLOW_RUN_ID" \
  --entrypoint node migrate /app/scripts/production-empty-install-ledger.mjs --production-empty-install)" || {
  echo "Fresh migration ledger or empty-source verification failed; preserving the database without retry." >&2; exit 1;
}
migration_count="$(printf '%s\n' "$ledger_result" | sed -n 's/.*"migrationCount":\([0-9][0-9]*\).*/\1/p')"
migration_digest="$(printf '%s\n' "$ledger_result" | sed -n 's/.*"migrationTreeDigest":"\([a-f0-9]\{64\}\)".*/\1/p')"
expected_migration_count="$(find "$ROOT_DIR/prisma/migrations" -mindepth 2 -maxdepth 2 -name migration.sql -type f | wc -l | tr -d ' ')"
[[ "$migration_count" == "$expected_migration_count" && "$migration_count" == "74" \
  && "$migration_digest" =~ ^[a-f0-9]{64}$ ]] || {
  echo "Fresh migration verification did not match the exact 74-directory release tree; preserving the database without retry." >&2; exit 1;
}

marker_tmp="$(mktemp "$git_dir/bodycast-production-empty-install.new.XXXXXX")"
chmod 0600 "$marker_tmp"
printf 'schemaVersion=1\nstate=schema-applied\nreleaseSha=%s\nworkflowRunId=%s\nworkflowRunAttempt=%s\nmigrationTreeDigest=%s\nappImageId=unknown\n' \
  "$RELEASE_SHA" "$WORKFLOW_RUN_ID" "$WORKFLOW_RUN_ATTEMPT" "$migration_digest" > "$marker_tmp"
sync -f "$marker_tmp"
mv -fT -- "$marker_tmp" "$marker_path"
sync -f "$git_dir"

# The exact empty-schema case has no user profile or model history to claim as
# Unified V4 current. The app shell is served; V4 remains uninitialized until
# real profile/source inputs are entered through the application.
env BODYCAST_PRODUCTION_RELEASE_LOCK_HELD=1 CADDY_ROUTES_PATH="$CADDY_ROUTES_PATH" \
  DEPLOY_SHA="$RELEASE_SHA" BODYCAST_NON_SERVING_DEPLOY=0 bash "$ROOT_DIR/scripts/deploy.sh"

app_identity="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}|{{.Image}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$APP_CONTAINER")"
IFS='|' read -r app_sha app_image_id app_health <<< "$app_identity"
[[ "$app_sha" == "$RELEASE_SHA" && "$app_image_id" =~ ^sha256:[a-f0-9]{64}$ && "$app_health" == "healthy" ]] || {
  echo "Fresh app serving postflight did not confirm the exact healthy image; preserve marker and inspect read-only." >&2; exit 1;
}
final_ledger="$(compose --profile tools run --rm --no-deps --env "BODYCAST_EMPTY_INSTALL_RUN_ID=$WORKFLOW_RUN_ID" \
  --entrypoint node migrate /app/scripts/production-empty-install-ledger.mjs --production-empty-install)" || {
  echo "Post-deploy empty-source verification failed; serving is committed and must be investigated read-only." >&2; exit 1;
}
final_digest="$(printf '%s\n' "$final_ledger" | sed -n 's/.*"migrationTreeDigest":"\([a-f0-9]\{64\}\)".*/\1/p')"
[[ "$final_digest" == "$migration_digest" ]] || { echo "Migration tree changed during app deployment; keep evidence and stop." >&2; exit 1; }

marker_tmp="$(mktemp "$git_dir/bodycast-production-empty-install.new.XXXXXX")"
chmod 0600 "$marker_tmp"
printf 'schemaVersion=1\nstate=complete\nreleaseSha=%s\nworkflowRunId=%s\nworkflowRunAttempt=%s\nmigrationTreeDigest=%s\nappImageId=%s\n' \
  "$RELEASE_SHA" "$WORKFLOW_RUN_ID" "$WORKFLOW_RUN_ATTEMPT" "$migration_digest" "$app_image_id" > "$marker_tmp"
sync -f "$marker_tmp"
mv -fT -- "$marker_tmp" "$marker_path"
sync -f "$git_dir"
printf 'BODYCAST_EMPTY_INSTALL_COMPLETE releaseSha=%s migrationCount=%s migrationTreeDigest=%s v4=not-initialized profileCount=0 appImageId=%s\n' \
  "$RELEASE_SHA" "$migration_count" "$migration_digest" "$app_image_id"
