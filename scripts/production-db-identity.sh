#!/usr/bin/env bash
# Read-only identity checks for the fixed production PostgreSQL container and
# the Prisma DATABASE_URL endpoint used by the migrator and app.
set -Eeuo pipefail

bodycast_capture_production_db_identity() {
  local container="${1:-}" container_id image_id server_ip endpoint_identity database database_oid cluster_id role server_version server_address server_port
  [[ "$container" == "bodycast-db-prod" ]] || {
    echo "Production database identity is restricted to bodycast-db-prod." >&2
    return 1
  }
  container_id="$(docker inspect --format '{{.Id}}' "$container")" || return 1
  image_id="$(docker inspect --format '{{.Image}}' "$container")" || return 1
  server_ip="$(docker inspect --format '{{ with index .NetworkSettings.Networks "bodycast-backend-prod" }}{{.IPAddress}}{{end}}' "$container")" || return 1
  [[ -n "$server_ip" && "$server_ip" != *'|'* ]] || {
    echo "Production PostgreSQL is not attached to its fixed BodyCast backend network." >&2
    return 1
  }
  endpoint_identity="$(docker exec --interactive "$container" bash -s -- "$server_ip" \
    'SELECT current_database() || chr(124) || (SELECT oid::text FROM pg_database WHERE datname = current_database()) || chr(124) || (SELECT system_identifier::text FROM pg_control_system()) || chr(124) || current_user || chr(124) || current_setting('"'"'server_version'"'"') || chr(124) || host(inet_server_addr()) || chr(124) || inet_server_port()::text WHERE pg_is_in_recovery() = false' <<'BASH'
set -Eeuo pipefail
server_ip="$1"
query="$2"
[[ "${POSTGRES_USER:-}" == "bodycast" && -n "${POSTGRES_PASSWORD:-}" ]] || {
  echo "Production PostgreSQL credentials are unavailable for the read-only identity check." >&2
  exit 1
}
if [[ "$POSTGRES_PASSWORD" == *$'\n'* || "$POSTGRES_PASSWORD" == *$'\r'* ]]; then
  echo "Production PostgreSQL password cannot be represented in a protected libpq passfile." >&2
  exit 1
fi
umask 077
passfile="$(mktemp /tmp/bodycast-production-db-identity.XXXXXX)"
trap 'rm -f -- "$passfile"' EXIT
chmod 600 "$passfile"
escaped_password="${POSTGRES_PASSWORD//\\/\\\\}"
escaped_password="${escaped_password//:/\\:}"
printf '%s:%s:%s:%s:%s\n' "$server_ip" 5432 bodycast "$POSTGRES_USER" "$escaped_password" > "$passfile"
PGPASSFILE="$passfile" \
PGAPPNAME=bodycast-production-db-identity \
PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000' \
  psql --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --host "$server_ip" --username="$POSTGRES_USER" --dbname=bodycast --command "$query"
BASH
  )" || return 1
  IFS='|' read -r database database_oid cluster_id role server_version server_address server_port <<< "$endpoint_identity"
  [[ "$container_id" =~ ^[a-f0-9]{64}$ && "$image_id" =~ ^sha256:[a-f0-9]{64}$ \
    && "$database" == "bodycast" && "$database_oid" =~ ^[1-9][0-9]*$ \
    && "$cluster_id" =~ ^[1-9][0-9]*$ && "$role" == "bodycast" \
    && "$server_version" == 17.* && "$server_address" == "$server_ip" && "$server_port" == "5432" ]] || {
    echo "Production PostgreSQL identity is not the expected BodyCast database primary." >&2
    return 1
  }
  printf '%s|%s|%s\n' "$container_id" "$image_id" "$endpoint_identity"
}

bodycast_production_db_endpoint_from_identity() {
  local endpoint_identity
  IFS='|' read -r _ _ endpoint_identity <<< "${1:-}"
  [[ -n "$endpoint_identity" ]] || return 1
  printf '%s\n' "$endpoint_identity"
}

bodycast_assert_production_db_identity_unchanged() {
  local expected="${1:-}" actual
  [[ "$expected" =~ ^[a-f0-9]{64}\|sha256:[a-f0-9]{64}\|bodycast\|[1-9][0-9]*\|[1-9][0-9]*\|bodycast\|17\.[^\|]+\|[^\|]+\|5432$ ]] || {
    echo "Expected production database identity is missing or malformed." >&2
    return 1
  }
  actual="$(bodycast_capture_production_db_identity bodycast-db-prod)" || return 1
  [[ "$actual" == "$expected" ]] || {
    echo "Production PostgreSQL container, cluster, database, or endpoint changed during the app release." >&2
    return 1
  }
}

bodycast_assert_prisma_database_identity_matches() {
  local expected_container_identity="${1:-}" expected_endpoint actual_output actual_identity expected_endpoint_identity
  expected_endpoint_identity="$(bodycast_production_db_endpoint_from_identity "$expected_container_identity")" || return 1
  actual_output="$(docker compose --project-directory "$ROOT_DIR" -f "$ROOT_DIR/docker-compose.prod.yml" \
    --profile tools run --rm --no-deps -e "BODYCAST_EXPECTED_PRISMA_DB_IDENTITY=$expected_endpoint_identity" \
    --entrypoint node migrate /app/scripts/unified-v4-traffic-check.mjs --profile-id 1 --assert-prisma-database-identity)" || return 1
  actual_identity="$(printf '%s\n' "$actual_output" | sed -n 's/^BODYCAST_PRISMA_DB_IDENTITY=//p')"
  [[ "$actual_identity" == "$expected_endpoint_identity" ]] || {
    echo "Prisma DATABASE_URL does not resolve to the exact bodycast-db-prod cluster/database endpoint." >&2
    return 1
  }
}
