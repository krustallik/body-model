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
readonly ROUTE_FILE="${CADDY_ROUTES_PATH}/bodycast.caddy"

[[ "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "APP_HOST is invalid." >&2; exit 1; }
[[ "$CADDY_ROUTES_PATH" == /* ]] || { echo "CADDY_ROUTES_PATH must be absolute." >&2; exit 1; }
[[ "$MODE" == "maintenance" || "$MODE" == "check" || "$MODE" == "serve" ]] || {
  echo "Usage: APP_HOST=... CADDY_ROUTES_PATH=... bash scripts/production-traffic-cutover.sh maintenance|check|serve" >&2
  exit 1
}

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

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
  write_route 'respond "BodyCast is temporarily unavailable while the model is updated." 503'
  compose stop app
  echo "Traffic is in maintenance mode and the app writer container is stopped."
  exit 0
fi

if [[ "$MODE" == "check" ]]; then
  compose --profile tools build migrate
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-traffic-check.mjs --profile-id 1
  exit 0
fi

app_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")"
[[ "$app_status" == "healthy" ]] || { echo "Forecast V2 serving requires a healthy app container." >&2; exit 1; }
compose --profile tools build migrate
compose --profile tools run --rm --no-deps --entrypoint node migrate \
  /app/scripts/unified-v4-traffic-check.mjs --profile-id 1
write_route "reverse_proxy ${APP_CONTAINER}:3000"
if ! curl --fail --silent --show-error --retry 12 --retry-delay 5 "https://${APP_HOST}/api/health" | grep -q '"status":"ok"'; then
  write_route 'respond "BodyCast is temporarily unavailable while the model is updated." 503'
  echo "Health check failed after serving cutover; traffic returned to maintenance." >&2
  exit 1
fi
echo "Forecast V2 serving enabled after exact Unified V4 currentness verification."
