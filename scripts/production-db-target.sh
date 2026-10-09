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
    TOPOLOGY_REPORT="$(APP_HOST="${APP_HOST:-}" CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:-}" \
      bash "$ROOT_DIR/scripts/production-writer-drain.sh" --report)"
    docker exec -i --env "BODYCAST_PSQL_DATABASE_URL=$TARGET_URL" \
      --env "BODYCAST_WRITER_TOPOLOGY_JSON=$TOPOLOGY_REPORT" \
      --env 'PGAPPNAME=bodycast-production-preflight' \
      --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000' \
      "$DB_CONTAINER" sh -c 'exec psql "$BODYCAST_PSQL_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set="BODYCAST_WRITER_TOPOLOGY_JSON=$BODYCAST_WRITER_TOPOLOGY_JSON"'
    ;;
  --previous-app-compatibility-snapshot)
    DB_CONTAINER="${2:-}"
    [[ "$DB_CONTAINER" == "bodycast-db-prod" ]] || { echo "Refusing compatibility snapshot against an unreviewed PostgreSQL container." >&2; exit 1; }
    TARGET_URL="$(effective_psql_url)"
    # This fixed read-only snapshot records only DB identity/schema/history for
    # binding the old app image. It explicitly cannot attest writer drain or
    # admit migration; the normal --preflight path must pass after app removal.
    TOPOLOGY_REPORT='{"schemaVersion":1,"contract":"bodycast-previous-app-compatibility-snapshot-v1","ready":false,"blockers":["writer drain is not asserted by a previous-app compatibility snapshot"]}'
    docker exec -i --env "BODYCAST_PSQL_DATABASE_URL=$TARGET_URL" \
      --env "BODYCAST_WRITER_TOPOLOGY_JSON=$TOPOLOGY_REPORT" \
      --env 'PGAPPNAME=bodycast-production-preflight' \
      --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000' \
      "$DB_CONTAINER" sh -c 'exec psql "$BODYCAST_PSQL_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set="BODYCAST_WRITER_TOPOLOGY_JSON=$BODYCAST_WRITER_TOPOLOGY_JSON"'
    ;;
  *)
    echo "Usage: production-db-target.sh --psql-url|--preflight|--previous-app-compatibility-snapshot bodycast-db-prod" >&2
    exit 2
    ;;
esac
