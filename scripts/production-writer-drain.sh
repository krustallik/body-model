#!/usr/bin/env bash
# Fail-closed evidence for the reviewed production compose topology. This is a
# host-side check: do not infer client identity from PostgreSQL client_addr.
set -uo pipefail

readonly CONTRACT="bodycast-compose-internal-db-single-writer-v1"
readonly APP_CONTAINER="bodycast-app-prod"
readonly DB_CONTAINER="bodycast-db-prod"
readonly CADDY_CONTAINER="gymbeam-caddy"
readonly DB_NETWORK="bodycast-backend-prod"
readonly ROUTE_RESPONSE='respond "BodyCast is temporarily unavailable while the model is updated." 503'
MODE="${1:-}"
APP_HOST="${APP_HOST:-}"
CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:-}"

[[ "$MODE" == "--report" || "$MODE" == "--assert" ]] || {
  echo "Usage: APP_HOST=... CADDY_ROUTES_PATH=... bash scripts/production-writer-drain.sh --report|--assert" >&2
  exit 2
}

blockers=()
app_state=""; app_restart=""; db_state=""; db_health=""; db_networks=""; db_ports=""
backend_containers=""; caddy_state=""; caddy_validated=false; route_verified=false
route_sha=""
observed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ ! "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  blockers+=("APP_HOST is missing or invalid.")
fi
if [[ "$CADDY_ROUTES_PATH" != /* || ! -d "$CADDY_ROUTES_PATH" || -L "$CADDY_ROUTES_PATH" ]]; then
  blockers+=("CADDY_ROUTES_PATH must be an existing absolute non-symlink directory.")
elif [[ "$(realpath -e "$CADDY_ROUTES_PATH" 2>/dev/null || true)" != "$CADDY_ROUTES_PATH" ]]; then
  blockers+=("CADDY_ROUTES_PATH must be canonical; symlinked or ambiguous paths are not accepted.")
fi

if ! docker info >/dev/null 2>&1; then
  blockers+=("Docker daemon identity/state is unavailable.")
else
  app_name="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}' 2>/dev/null)" || {
    blockers+=("The old BodyCast app container inventory is unavailable.")
  }
  if [[ -z "${app_name:-}" ]]; then
    app_state="absent"
    app_restart=""
  else
    app_state="present"
    app_restart="unknown"
    blockers+=("The old BodyCast app container still exists and could be restarted against the migrated schema.")
  fi
fi

db_meta="$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' "$DB_CONTAINER" 2>/dev/null || true)"
IFS='|' read -r db_state db_health <<< "$db_meta"
[[ "$db_state" == "running" && "$db_health" == "healthy" ]] || blockers+=("The reviewed local PostgreSQL container is not healthy or its state is unknown.")
db_ports="$(docker port "$DB_CONTAINER" 5432/tcp 2>/dev/null || true)"
[[ -z "$db_ports" ]] || blockers+=("PostgreSQL has a published port; host/NAT client identity is not proven.")
db_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$DB_CONTAINER" 2>/dev/null | sed '/^[[:space:]]*$/d' | sort | paste -sd, - || true)"
[[ "$db_networks" == "$DB_NETWORK" ]] || blockers+=("PostgreSQL is attached to an unreviewed or ambiguous network topology.")

backend_containers="$(docker network inspect --format '{{range $id, $container := .Containers}}{{println $container.Name}}{{end}}' "$DB_NETWORK" 2>/dev/null | sed '/^[[:space:]]*$/d' | sort | paste -sd, - || true)"
[[ "$backend_containers" == "$DB_CONTAINER" ]] || blockers+=("The internal database network contains an unknown or unapproved client container.")

caddy_state="$(docker inspect --format '{{.State.Status}}' "$CADDY_CONTAINER" 2>/dev/null || true)"
if [[ "$caddy_state" == "running" ]] && docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  caddy_validated=true
else
  blockers+=("The reviewed Caddy proxy is stopped or its active configuration cannot be validated.")
fi

route_file="${CADDY_ROUTES_PATH%/}/bodycast.caddy"
if [[ -f "$route_file" && ! -L "$route_file" && "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  expected_file="$(mktemp)"
  cat > "$expected_file" <<EOF
http://${APP_HOST} {
    redir https://${APP_HOST}{uri} permanent
}

${APP_HOST} {
    encode zstd gzip
    header {
        -Server
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
    ${ROUTE_RESPONSE}
}
EOF
  if cmp -s "$expected_file" "$route_file"; then route_verified=true; fi
  rm -f "$expected_file"
  route_sha="$(sha256sum "$route_file" 2>/dev/null | awk '{print $1}')"
fi
[[ "$route_verified" == true ]] || blockers+=("The configured Caddy route is not the exact maintenance-only route for APP_HOST.")
[[ "$route_sha" =~ ^[a-f0-9]{64}$ ]] || blockers+=("The maintenance route file digest is unavailable.")

ready=false
[[ "${#blockers[@]}" -eq 0 ]] && ready=true
blocker_json=""
for blocker in "${blockers[@]}"; do
  [[ -z "$blocker_json" ]] || blocker_json+=,
  case "$blocker" in
    "APP_HOST is missing or invalid.") encoded='"APP_HOST is missing or invalid."' ;;
    "CADDY_ROUTES_PATH must be an existing absolute non-symlink directory.") encoded='"CADDY_ROUTES_PATH must be an existing absolute non-symlink directory."' ;;
    "CADDY_ROUTES_PATH must be canonical; symlinked or ambiguous paths are not accepted.") encoded='"CADDY_ROUTES_PATH must be canonical; symlinked or ambiguous paths are not accepted."' ;;
    "Docker daemon identity/state is unavailable.") encoded='"Docker daemon identity/state is unavailable."' ;;
    "The old BodyCast app container inventory is unavailable.") encoded='"The old BodyCast app container inventory is unavailable."' ;;
    "The old BodyCast app container still exists and could be restarted against the migrated schema.") encoded='"The old BodyCast app container still exists and could be restarted against the migrated schema."' ;;
    "The reviewed local PostgreSQL container is not healthy or its state is unknown.") encoded='"The reviewed local PostgreSQL container is not healthy or its state is unknown."' ;;
    "PostgreSQL has a published port; host/NAT client identity is not proven.") encoded='"PostgreSQL has a published port; host/NAT client identity is not proven."' ;;
    "PostgreSQL is attached to an unreviewed or ambiguous network topology.") encoded='"PostgreSQL is attached to an unreviewed or ambiguous network topology."' ;;
    "The internal database network contains an unknown or unapproved client container.") encoded='"The internal database network contains an unknown or unapproved client container."' ;;
    "The reviewed Caddy proxy is stopped or its active configuration cannot be validated.") encoded='"The reviewed Caddy proxy is stopped or its active configuration cannot be validated."' ;;
    "The configured Caddy route is not the exact maintenance-only route for APP_HOST.") encoded='"The configured Caddy route is not the exact maintenance-only route for APP_HOST."' ;;
    "The maintenance route file digest is unavailable.") encoded='"The maintenance route file digest is unavailable."' ;;
    *) encoded='"Unknown writer-drain topology blocker."' ;;
  esac
  blocker_json+="$encoded"
done
[[ -n "$blocker_json" ]] || blocker_json=""

json_array_or_null() { [[ "$2" == "$3" ]] && printf '["%s"]' "$1" || printf 'null'; }
printf '{"schemaVersion":1,"contract":"%s","ready":%s,"blockers":[%s],"observedAt":"%s",' "$CONTRACT" "$ready" "$blocker_json" "$observed_at"
printf '"app":{"name":"%s","state":%s,"restartPolicy":%s},' "$APP_CONTAINER" "$( [[ "$app_state" == absent ]] && printf '"absent"' || printf 'null' )" "$( [[ "$app_restart" == no ]] && printf '"no"' || printf 'null' )"
printf '"database":{"name":"%s","state":%s,"health":%s,"publishedPostgresPort":%s,"networks":%s},' \
  "$DB_CONTAINER" "$( [[ "$db_state" == running ]] && printf '"running"' || printf 'null' )" "$( [[ "$db_health" == healthy ]] && printf '"healthy"' || printf 'null' )" \
  "$( [[ -z "$db_ports" ]] && printf false || printf true )" "$(json_array_or_null "$DB_NETWORK" "$db_networks" "$DB_NETWORK")"
printf '"backendNetwork":{"name":"%s","containers":%s},' "$DB_NETWORK" "$(json_array_or_null "$DB_CONTAINER" "$backend_containers" "$DB_CONTAINER")"
printf '"caddy":{"name":"%s","state":%s,"configValidated":%s},' "$CADDY_CONTAINER" "$( [[ "$caddy_state" == running ]] && printf '"running"' || printf 'null' )" "$caddy_validated"
printf '"routeFile":{"verified":%s,"maintenanceResponse":%s,"containsReverseProxy":false,"sha256":%s}}\n' \
  "$route_verified" "$route_verified" "$( [[ "$route_sha" =~ ^[a-f0-9]{64}$ ]] && printf '"%s"' "$route_sha" || printf 'null' )"

if [[ "$ready" != true ]]; then
  printf '%s\n' "${blockers[@]}" >&2
  exit 1
fi
