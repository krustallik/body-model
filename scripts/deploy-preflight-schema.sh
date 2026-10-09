#!/usr/bin/env bash
# Non-destructive production schema compatibility preflight.
# Blocks ordinary deploy when Prisma migrations are pending.
# Never runs prisma migrate deploy / reset, replay, or activation.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly DB_CONTAINER="bodycast-db-prod"

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

compose --profile tools build migrate

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

rm -f "$status_log"
echo "Schema preflight OK: production database schema matches applied migrations for this checkout."
