#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"

effective_psql_url() {
  docker compose -f "$COMPOSE_FILE" --profile tools run --rm --no-deps \
    --volume "$ROOT_DIR/scripts/production-db-target-url.mjs:/run/bodycast-production-db-target-url.mjs:ro" \
    --entrypoint node migrate /run/bodycast-production-db-target-url.mjs < /dev/null
}

case "${1:-}" in
  --psql-url)
    effective_psql_url
    ;;
  --preflight)
    DB_CONTAINER="${2:-}"
    [[ "$DB_CONTAINER" == "bodycast-db-prod" ]] || { echo "Refusing preflight against an unreviewed PostgreSQL container." >&2; exit 1; }
    TARGET_URL="$(effective_psql_url)"
    docker exec -i --env "BODYCAST_PSQL_DATABASE_URL=$TARGET_URL" \
      --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000' \
      "$DB_CONTAINER" sh -c 'exec psql "$BODYCAST_PSQL_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1'
    ;;
  *)
    echo "Usage: production-db-target.sh --psql-url|--preflight bodycast-db-prod" >&2
    exit 2
    ;;
esac
