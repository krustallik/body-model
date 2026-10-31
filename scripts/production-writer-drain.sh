#!/usr/bin/env bash
# Fail-closed evidence for the reviewed production compose topology. This is a
# host-side check: do not infer client identity from PostgreSQL client_addr.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
readonly CONTRACT="bodycast-compose-internal-db-single-writer-v1"
readonly PRE_MAINTENANCE_CONTRACT="bodycast-compose-internal-db-pre-maintenance-v1"
readonly APP_CONTAINER="bodycast-app-prod"
readonly DB_CONTAINER="bodycast-db-prod"
readonly CADDY_CONTAINER="gymbeam-caddy"
readonly DB_NETWORK="bodycast-backend-prod"
readonly ROUTE_RESPONSE='respond "BodyCast is temporarily unavailable while the model is updated." 503'
MODE="${1:-}"
APP_HOST="${APP_HOST:-}"
CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:-}"

[[ "$MODE" == "--report" || "$MODE" == "--assert" || "$MODE" == "--pre-maintenance-report" ]] || {
  echo "Usage: APP_HOST=... CADDY_ROUTES_PATH=... bash scripts/production-writer-drain.sh --report|--assert|--pre-maintenance-report" >&2
  exit 2
}

blockers=()
app_state=""; app_restart=""; db_state=""; db_health=""; db_networks=""; db_ports=""
backend_containers=""; caddy_state=""; caddy_validated=false; route_verified=false
route_sha=""
observed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ "$MODE" == "--pre-maintenance-report" ]]; then
  blockers=()
  [[ "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || blockers+=("APP_HOST is missing or invalid.")
  [[ "$CADDY_ROUTES_PATH" == /* && -d "$CADDY_ROUTES_PATH" && ! -L "$CADDY_ROUTES_PATH" \
    && "$(realpath -e "$CADDY_ROUTES_PATH" 2>/dev/null || true)" == "$CADDY_ROUTES_PATH" ]] \
    || blockers+=("CADDY_ROUTES_PATH is missing, non-canonical, or unsafe.")
  docker info >/dev/null 2>&1 || blockers+=("Docker daemon identity/state is unavailable.")

  app_id=""; app_image_id=""; app_health=""; app_release_sha=""; app_restart=""
  if ! app_names="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}' 2>/dev/null)"; then
    app_state="unknown"
    blockers+=("The old BodyCast app container inventory is unavailable.")
  elif [[ -n "$app_names" ]]; then
    [[ "$app_names" == "$APP_CONTAINER" ]] || blockers+=("The old BodyCast app container inventory is ambiguous.")
    app_id="$(docker inspect --format '{{.Id}}' "$APP_CONTAINER" 2>/dev/null || true)"
    app_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"
    app_state="$(docker inspect --format '{{.State.Status}}' "$APP_CONTAINER" 2>/dev/null || true)"
    app_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$APP_CONTAINER" 2>/dev/null || true)"
    app_release_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER" 2>/dev/null || true)"
    app_restart="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$APP_CONTAINER" 2>/dev/null || true)"
    [[ "$app_id" =~ ^[a-f0-9]{64}$ && "$app_image_id" =~ ^sha256:[a-f0-9]{64}$ \
      && "$app_state" == running && "$app_health" == healthy && "$app_restart" == unless-stopped \
      && ( "$app_release_sha" =~ ^[a-f0-9]{40}$ || "$app_release_sha" == unknown ) ]] \
      || blockers+=("The prior app is not a healthy immutable running container with the reviewed restart policy.")
  else
    app_state="absent"
  fi

  db_id="$(docker inspect --format '{{.Id}}' "$DB_CONTAINER" 2>/dev/null || true)"
  db_state="$(docker inspect --format '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)"
  db_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$DB_CONTAINER" 2>/dev/null || true)"
  db_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$DB_CONTAINER" 2>/dev/null | sed '/^[[:space:]]*$/d' | sort | paste -sd, - || true)"
  db_ports="$(docker port "$DB_CONTAINER" 5432/tcp 2>/dev/null || true)"
  [[ "$db_id" =~ ^[a-f0-9]{64}$ && "$db_state" == running && "$db_health" == healthy \
    && "$db_networks" == "$DB_NETWORK" && -z "$db_ports" ]] \
    || blockers+=("The reviewed private PostgreSQL container is not healthy or its identity/topology is unknown.")

  backend_containers="$(docker network inspect --format '{{range $id, $container := .Containers}}{{println $container.Name}}{{end}}' "$DB_NETWORK" 2>/dev/null | sed '/^[[:space:]]*$/d' | sort | paste -sd, - || true)"
  if [[ "$app_state" == running ]]; then
    [[ "$backend_containers" == "$APP_CONTAINER,$DB_CONTAINER" ]] \
      || blockers+=("The PostgreSQL network contains an unknown or unapproved client container.")
  else
    [[ "$backend_containers" == "$DB_CONTAINER" ]] \
      || blockers+=("The PostgreSQL network contains an unknown or unapproved client container.")
  fi

  caddy_state="$(docker inspect --format '{{.State.Status}}' "$CADDY_CONTAINER" 2>/dev/null || true)"
  caddy_validated=false
  if [[ "$caddy_state" == running ]] && docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    caddy_validated=true
  else
    blockers+=("The production Caddy configuration is not positively healthy.")
  fi

  if [[ "$CADDY_ROUTES_PATH" == /* && -d "$CADDY_ROUTES_PATH" ]]; then
    source "$ROOT_DIR/scripts/production-route-path.sh"
    source "$ROOT_DIR/scripts/production-route-primitives.sh"
    bodycast_canonicalize_routes_path || blockers+=("The BodyCast route directory is ambiguous.")
    readonly CADDY_ROUTES_PATH
    route_file="${CADDY_ROUTES_PATH%/}/bodycast.caddy"
    route_sha="$(sha256sum "$route_file" 2>/dev/null | awk '{print $1}')"
    if bodycast_verify_exact_serving_route >/dev/null 2>&1; then
      serving_response=true; maintenance_response=false; contains_reverse_proxy=true
    elif bodycast_verify_exact_maintenance_route >/dev/null 2>&1; then
      serving_response=false; maintenance_response=true; contains_reverse_proxy=false
    else
      blockers+=("The BodyCast route is neither the exact serving route nor the exact maintenance route.")
      serving_response=false; maintenance_response=false; contains_reverse_proxy=false
    fi
    if [[ "$app_state" == absent && "$maintenance_response" != true ]]; then
      blockers+=("An absent app requires the exact maintenance-only BodyCast route.")
    fi
  else
    route_sha=""; serving_response=false; maintenance_response=false; contains_reverse_proxy=false
    blockers+=("The BodyCast route directory is missing or unsafe.")
  fi
  [[ "$route_sha" =~ ^[a-f0-9]{64}$ ]] || blockers+=("The BodyCast route digest is unavailable.")

  if (( ${#blockers[@]} > 0 )); then
    printf '%s\n' "${blockers[@]}" >&2
    exit 1
  fi

  APP_ID="$app_id" APP_IMAGE_ID="$app_image_id" APP_STATE="$app_state" APP_HEALTH="$app_health" \
    APP_RELEASE_SHA="$app_release_sha" APP_RESTART="$app_restart" DB_ID="$db_id" DB_STATE="$db_state" \
    DB_HEALTH="$db_health" DB_NETWORKS="$db_networks" BACKEND_CONTAINERS="$backend_containers" \
    CADDY_STATE="$caddy_state" CADDY_VALIDATED="$caddy_validated" ROUTE_SHA="$route_sha" \
    ROUTE_SERVING="$serving_response" ROUTE_MAINTENANCE="$maintenance_response" \
    ROUTE_PROXY="$contains_reverse_proxy" OBSERVED_AT="$observed_at" PRE_MAINTENANCE_CONTRACT="$PRE_MAINTENANCE_CONTRACT" \
    node --input-type=module <<'NODE'
const appState = process.env.APP_STATE;
const app = appState === "running"
  ? { name: "bodycast-app-prod", containerId: process.env.APP_ID, imageId: process.env.APP_IMAGE_ID,
    state: appState, health: process.env.APP_HEALTH, restartPolicy: process.env.APP_RESTART, releaseSha: process.env.APP_RELEASE_SHA }
  : { name: "bodycast-app-prod", containerId: null, imageId: null, state: "absent", health: null, restartPolicy: null, releaseSha: null };
const topology = {
  schemaVersion: 1, contract: process.env.PRE_MAINTENANCE_CONTRACT, ready: true, blockers: [], observedAt: process.env.OBSERVED_AT,
  app,
  database: { name: "bodycast-db-prod", containerId: process.env.DB_ID, state: process.env.DB_STATE,
    health: process.env.DB_HEALTH, publishedPostgresPort: false, networks: ["bodycast-backend-prod"] },
  backendNetwork: { name: "bodycast-backend-prod", containers: process.env.BACKEND_CONTAINERS.split(",") },
  caddy: { name: "gymbeam-caddy", state: process.env.CADDY_STATE, configValidated: process.env.CADDY_VALIDATED === "true" },
  routeFile: { verified: true, servingResponse: process.env.ROUTE_SERVING === "true",
    maintenanceResponse: process.env.ROUTE_MAINTENANCE === "true", containsReverseProxy: process.env.ROUTE_PROXY === "true", sha256: process.env.ROUTE_SHA },
};
process.stdout.write(`${JSON.stringify(topology)}\n`);
NODE
  exit 0
fi

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
  if [[ "$route_verified" != true ]]; then
    marker="$(sed -n 's/^[[:space:]]*X-BodyCast-Deploy-Maintenance "\([A-Za-z0-9][A-Za-z0-9._-]*\)"[[:space:]]*$/\1/p' "$route_file")"
    if [[ "$marker" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
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
        Cache-Control "no-store"
        X-BodyCast-Deploy-Maintenance "${marker}"
    }
    ${ROUTE_RESPONSE}
}
EOF
      cmp -s "$expected_file" "$route_file" && route_verified=true
    fi
  fi
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
