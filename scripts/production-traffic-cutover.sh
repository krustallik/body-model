#!/usr/bin/env bash
# Maintenance/serving route gate for the Forecast V2 + Unified V4 release.
set -Eeuo pipefail

MODE="${1:-}"
ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT_DIR"

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly APP_CONTAINER="bodycast-app-prod"
readonly APP_HOST="${APP_HOST:?APP_HOST is required}"
readonly CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:?CADDY_ROUTES_PATH is required}"
export APP_HOST CADDY_ROUTES_PATH
readonly ROUTE_FILE="${CADDY_ROUTES_PATH}/bodycast.caddy"
source "${ROOT_DIR}/scripts/production-release-marker.sh"

[[ "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "APP_HOST is invalid." >&2; exit 1; }
[[ "$CADDY_ROUTES_PATH" == /* ]] || { echo "CADDY_ROUTES_PATH must be absolute." >&2; exit 1; }
[[ "$MODE" == "maintenance" || "$MODE" == "check" || "$MODE" == "v3-postflight" || "$MODE" == "serve" ]] || {
  echo "Usage: APP_HOST=... CADDY_ROUTES_PATH=... bash scripts/production-traffic-cutover.sh maintenance|check|v3-postflight|serve" >&2
  exit 1
}

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

verify_exact_maintenance_route() {
  [[ -f "$ROUTE_FILE" && ! -L "$ROUTE_FILE" ]] || { echo "Maintenance route file is missing or unsafe." >&2; return 1; }
  local expected_file
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
    respond "BodyCast is temporarily unavailable while the model is updated." 503
}
EOF
  local exact=false
  cmp -s "$expected_file" "$ROUTE_FILE" && exact=true
  rm -f "$expected_file"
  [[ "$exact" == true ]] || { echo "Caddy is not on the exact maintenance-only route." >&2; return 1; }
  docker exec gymbeam-caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null
}

require_ready_release_marker() {
  local marker_status app_release_sha
  if read_bodycast_release_marker; then
    marker_status=0
  else
    marker_status=$?
  fi
  [[ "$marker_status" -eq 0 && "$BODYCAST_MARKER_STATE" == "app-ready" ]] || {
    echo "The exact-SHA app-ready marker is required for this rollout step." >&2
    return 1
  }
  app_release_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
  [[ "$app_release_sha" == "$BODYCAST_MARKER_RELEASE_SHA" ]] || {
    echo "Running app SHA differs from the release marker." >&2
    return 1
  }
  [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")" == "healthy" ]] || {
    echo "The exact-SHA app is not healthy." >&2
    return 1
  }
}

stop_old_app() {
  local existing_app app_state app_restart remaining_app
  existing_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"
  if [[ -n "$existing_app" ]]; then
    [[ "$existing_app" == "$APP_CONTAINER" ]] || { echo "App container identity is ambiguous." >&2; return 1; }
    docker update --restart=no "$APP_CONTAINER" >/dev/null
    compose stop app
    app_state="$(docker inspect --format '{{.State.Status}}' "$APP_CONTAINER")"
    app_restart="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$APP_CONTAINER")"
    [[ "$app_state" == "exited" && "$app_restart" == "no" ]] || {
      echo "Old BodyCast app did not stop with automatic restart disabled." >&2
      return 1
    }
    compose rm --force app >/dev/null
  fi
  docker info >/dev/null
  remaining_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"
  if [[ -n "$remaining_app" ]]; then
    echo "Old BodyCast app container still exists and could be manually restarted." >&2
    return 1
  fi
}

enter_maintenance() {
  write_route 'respond "BodyCast is temporarily unavailable while the model is updated." 503'
  stop_old_app
}

write_route() {
  local body="$1"
  mkdir -p "$CADDY_ROUTES_PATH"
  local temporary="${ROUTE_FILE}.new"
  cat >"$temporary" <<EOF
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
    ${body}
}
EOF
  mv -f "$temporary" "$ROUTE_FILE"
  docker exec gymbeam-caddy caddy validate --config /etc/caddy/Caddyfile
  docker exec gymbeam-caddy caddy reload \
    --address unix//run/caddy-admin/admin.sock \
    --config /etc/caddy/Caddyfile
}

if [[ "$MODE" == "maintenance" ]]; then
  enter_maintenance
  bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert
  echo "Traffic is in maintenance mode; the old app container is removed and PostgreSQL writers are drained."
  exit 0
fi

if [[ "$MODE" == "check" ]]; then
  compose --profile tools build migrate
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-traffic-check.mjs --profile-id 1
  exit 0
fi

if [[ "$MODE" == "v3-postflight" ]]; then
  require_ready_release_marker
  verify_exact_maintenance_route
  compose --profile tools build migrate
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v3-postflight.mjs --profile-id 1
  echo "Unified V3 postflight passed while traffic remains in maintenance; V4 activation/replay is still separate."
  exit 0
fi

app_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")"
[[ "$app_status" == "healthy" ]] || { echo "Forecast V2 serving requires a healthy app container." >&2; exit 1; }
app_release_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
[[ "$app_release_sha" =~ ^[a-f0-9]{40}$ ]] || { echo "App container does not declare an exact release SHA." >&2; exit 1; }
marker_status=1
if read_bodycast_release_marker; then
  marker_status=0
else
  marker_status=$?
fi
if [[ "$marker_status" -eq 0 ]]; then
  [[ "$BODYCAST_MARKER_RELEASE_SHA" == "$app_release_sha" \
    && "$BODYCAST_MARKER_STATE" == "app-ready" ]] || {
    echo "Serving is blocked: the running exact-SHA app does not satisfy the pending schema-cutover marker." >&2
    exit 1
  }
elif [[ "$marker_status" -ne 1 ]]; then
  echo "Serving is blocked by an invalid release marker." >&2
  exit 1
fi
compose --profile tools build migrate
compose --profile tools run --rm --no-deps --entrypoint node migrate \
  /app/scripts/unified-v4-traffic-check.mjs --profile-id 1
write_route "reverse_proxy ${APP_CONTAINER}:3000"
if ! curl --fail --silent --show-error --retry 12 --retry-delay 5 "https://${APP_HOST}/api/health" | grep -q '"status":"ok"'; then
  enter_maintenance
  echo "Health check failed after serving cutover; traffic returned to maintenance." >&2
  exit 1
fi
if [[ "$marker_status" -eq 0 ]]; then
  clear_bodycast_release_marker
fi
echo "Forecast V2 serving enabled after exact Unified V4 currentness verification."
