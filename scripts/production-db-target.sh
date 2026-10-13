#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
readonly DB_NETWORK="bodycast-backend-prod"

effective_psql_url() {
  docker compose -f "$COMPOSE_FILE" --profile tools run --rm --no-deps \
    --volume "$ROOT_DIR/scripts/production-db-target-url.mjs:/run/bodycast-production-db-target-url.mjs:ro" \
    --entrypoint node migrate /run/bodycast-production-db-target-url.mjs < /dev/null
}

inspect_fixed_database_target() {
  local metadata
  metadata="$(docker inspect --format "{{.Id}}|{{.Name}}|{{with index .NetworkSettings.Networks \"$DB_NETWORK\"}}{{.IPAddress}}{{end}}" "$DB_CONTAINER")"
  [[ "$metadata" == *"|/$DB_CONTAINER|"* ]] || { echo "The fixed production PostgreSQL container identity is unavailable." >&2; return 1; }
  FIXED_DB_CONTAINER_ID="${metadata%%|*}"
  FIXED_DB_ADDRESS="${metadata##*|}"
  [[ "$FIXED_DB_CONTAINER_ID" =~ ^[a-f0-9]{64}$ && "$FIXED_DB_ADDRESS" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "The fixed production PostgreSQL network endpoint is missing or malformed." >&2; return 1;
  }
}

assert_fixed_database_container_unchanged() {
  [[ "$(docker inspect --format '{{.Id}}' "$DB_CONTAINER")" == "$FIXED_DB_CONTAINER_ID" ]] || {
    echo "Production PostgreSQL container changed during the read-only preflight." >&2; return 1;
  }
}

verify_report_endpoint() {
  local report="$1"
  printf '%s\n' "$report" | node "$ROOT_DIR/scripts/production-db-endpoint-binding.mjs" --verify-stdin "$FIXED_DB_ADDRESS"
  assert_fixed_database_container_unchanged
}

case "${1:-}" in
  --psql-url)
    effective_psql_url
    ;;
  --preflight)
    DB_CONTAINER="${2:-}"
    [[ "$DB_CONTAINER" == "bodycast-db-prod" ]] || { echo "Refusing preflight against an unreviewed PostgreSQL container." >&2; exit 1; }
    inspect_fixed_database_target
    TARGET_URL="$(effective_psql_url)"
    TOPOLOGY_REPORT="$(APP_HOST="${APP_HOST:-}" CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:-}" \
      bash "$ROOT_DIR/scripts/production-writer-drain.sh" --report)"
    export BODYCAST_PSQL_DATABASE_URL="$TARGET_URL"
    unset TARGET_URL
    RAW_REPORT="$(docker exec -i --env BODYCAST_PSQL_DATABASE_URL \
      --env "BODYCAST_WRITER_TOPOLOGY_JSON=$TOPOLOGY_REPORT" \
      --env 'PGAPPNAME=bodycast-production-preflight' \
      --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000' \
      "$DB_CONTAINER" sh -c 'exec psql "$BODYCAST_PSQL_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set="BODYCAST_WRITER_TOPOLOGY_JSON=$BODYCAST_WRITER_TOPOLOGY_JSON"'
    )"
    unset BODYCAST_PSQL_DATABASE_URL
    verify_report_endpoint "$RAW_REPORT"
    DATA_FINGERPRINT="$(bash "$ROOT_DIR/scripts/production-db-data-fingerprint.sh" --production-container "$DB_CONTAINER")"
    [[ "$DATA_FINGERPRINT" =~ ^[a-f0-9]{64}$ ]] || { echo "Production logical data fingerprint is malformed." >&2; exit 1; }
    assert_fixed_database_container_unchanged
    printf '%s\n' "$RAW_REPORT" | node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const report = JSON.parse(readFileSync(0, "utf8"));
      const digest = process.argv[1];
      if (!report || typeof report !== "object" || Array.isArray(report) || !/^[a-f0-9]{64}$/.test(digest)) {
        throw new Error("Production database report or logical data fingerprint is invalid.");
      }
      report.logicalDataFingerprint = digest;
      process.stdout.write(`${JSON.stringify(report)}\n`);
    ' "$DATA_FINGERPRINT"
    ;;
  --previous-app-compatibility-snapshot)
    DB_CONTAINER="${2:-}"
    [[ "$DB_CONTAINER" == "bodycast-db-prod" ]] || { echo "Refusing compatibility snapshot against an unreviewed PostgreSQL container." >&2; exit 1; }
    inspect_fixed_database_target
    TARGET_URL="$(effective_psql_url)"
    # This fixed read-only snapshot records only DB identity/schema/history for
    # binding the old app image. It explicitly cannot attest writer drain or
    # admit migration; the normal --preflight path must pass after app removal.
    TOPOLOGY_REPORT='{"schemaVersion":1,"contract":"bodycast-previous-app-compatibility-snapshot-v1","ready":false,"blockers":["writer drain is not asserted by a previous-app compatibility snapshot"]}'
    export BODYCAST_PSQL_DATABASE_URL="$TARGET_URL"
    unset TARGET_URL
    RAW_REPORT="$(docker exec -i --env BODYCAST_PSQL_DATABASE_URL \
      --env "BODYCAST_WRITER_TOPOLOGY_JSON=$TOPOLOGY_REPORT" \
      --env 'PGAPPNAME=bodycast-production-preflight' \
      --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000' \
      "$DB_CONTAINER" sh -c 'exec psql "$BODYCAST_PSQL_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set="BODYCAST_WRITER_TOPOLOGY_JSON=$BODYCAST_WRITER_TOPOLOGY_JSON"'
    )"
    unset BODYCAST_PSQL_DATABASE_URL
    verify_report_endpoint "$RAW_REPORT"
    printf '%s\n' "$RAW_REPORT"
    ;;
  *)
    echo "Usage: production-db-target.sh --psql-url|--preflight|--previous-app-compatibility-snapshot bodycast-db-prod" >&2
    exit 2
    ;;
esac
