#!/usr/bin/env bash
# SEPARATE AUTHORIZATION REQUIRED.
# Applies pending Prisma migrations in production. Never called by ordinary
# automatic deployment. Do not wire this into workflow_run auto-deploy.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${CONFIRM_PRODUCTION_MIGRATE:-}" != "migrate" ]]; then
  echo "Refusing production migrate. Set CONFIRM_PRODUCTION_MIGRATE=migrate after explicit authorization." >&2
  exit 1
fi

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly DB_SERVICE="db"
readonly DB_CONTAINER="bodycast-db-prod"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

compose up -d "$DB_SERVICE"
for attempt in $(seq 1 30); do
  db_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER")"
  [[ "$db_status" == "healthy" ]] && break
  [[ "$attempt" == "30" ]] && { echo "Database healthcheck timed out." >&2; exit 1; }
  sleep 5
done

compose --profile tools build migrate
compose --profile tools run --rm migrate
echo "Production migrate deploy finished. Replay and selection-v1 activation were not run."
