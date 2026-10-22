#!/usr/bin/env bash
# Non-destructive production schema compatibility preflight.
# Blocks ordinary deploy when Prisma migrations are pending.
# Never runs prisma migrate deploy / reset, replay, or activation.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly DB_CONTAINER="bodycast-db-prod"
readonly EXPECTED_MIGRATION_COUNT="${BODYCAST_EXPECTED_MIGRATION_COUNT:-}"
readonly EXPECTED_PRODUCTION_DB_IDENTITY="${BODYCAST_EXPECTED_PRODUCTION_DB_IDENTITY:-}"
source "$ROOT_DIR/scripts/production-db-identity.sh"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

if ! db_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER")"; then
  echo "BLOCKED: existing production database container is unavailable; schema preflight will not start it." >&2
  exit 2
fi
[[ "$db_status" == "healthy" ]] || {
  echo "BLOCKED: existing production database is not healthy (state: ${db_status}); schema preflight will not start it." >&2
  exit 2
}

if [[ -n "$EXPECTED_MIGRATION_COUNT" ]]; then
  [[ "$EXPECTED_MIGRATION_COUNT" =~ ^[1-9][0-9]*$ ]] || {
    echo "BLOCKED: expected migration count is malformed." >&2
    exit 2
  }
  migration_directory_count="$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d -printf '.' | wc -c | tr -d '[:space:]')"
  [[ "$migration_directory_count" == "$EXPECTED_MIGRATION_COUNT" ]] || {
    echo "BLOCKED: this exact release contains ${migration_directory_count} Prisma migrations; ${EXPECTED_MIGRATION_COUNT} are required." >&2
    exit 2
  }
fi

compose --profile tools build migrate

if [[ -n "$EXPECTED_PRODUCTION_DB_IDENTITY" ]]; then
  bodycast_assert_production_db_identity_unchanged "$EXPECTED_PRODUCTION_DB_IDENTITY"
  bodycast_assert_prisma_database_identity_matches "$EXPECTED_PRODUCTION_DB_IDENTITY"
fi

status_log="$(mktemp)"
set +e
compose --profile tools run --rm --no-deps --entrypoint npx migrate prisma migrate status >"$status_log" 2>&1
status_code=$?
set -e
cat "$status_log"

if grep -Eqi 'Following migration|have not yet been applied|Database schema is not empty|drift detected|The following migration' "$status_log"; then
  echo "BLOCKED: production schema is not compatible with this application revision." >&2
  echo "Ordinary automatic deployment does not run prisma migrate deploy." >&2
  echo "Pending migration identifiers appear in the status output above." >&2
  echo "Authorize a separate production migration procedure before releasing this commit." >&2
  rm -f "$status_log"
  exit 2
fi

if [[ "$status_code" -ne 0 ]]; then
  echo "BLOCKED: unable to verify production schema compatibility (prisma migrate status exited ${status_code})." >&2
  rm -f "$status_log"
  exit 2
fi

if ! grep -Eqi 'Database schema is up to date' "$status_log"; then
  echo "BLOCKED: prisma migrate status did not confirm an up-to-date schema." >&2
  rm -f "$status_log"
  exit 2
fi

if [[ -n "$EXPECTED_MIGRATION_COUNT" ]]; then
  ledger_state="$(docker exec "$DB_CONTAINER" sh -c \
    'exec psql --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname=bodycast --command "$1"' \
    _ 'SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || chr(124) || count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::text FROM public."_prisma_migrations"')"
  [[ "$ledger_state" == "${EXPECTED_MIGRATION_COUNT}|0" ]] || {
    echo "BLOCKED: the live Prisma ledger is not exactly ${EXPECTED_MIGRATION_COUNT}/${EXPECTED_MIGRATION_COUNT} applied migrations with no unfinished rows." >&2
    rm -f "$status_log"
    exit 2
  }
  echo "Schema migration contract OK: ${EXPECTED_MIGRATION_COUNT}/${EXPECTED_MIGRATION_COUNT} release files and applied ledger rows."
fi

rm -f "$status_log"
echo "Schema preflight OK: production database schema matches applied migrations for this checkout."
