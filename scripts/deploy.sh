#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly APP_SERVICE="app"
readonly APP_CONTAINER="bodycast-app-prod"
readonly DB_SERVICE="db"
readonly DB_CONTAINER="bodycast-db-prod"
readonly CURRENT_IMAGE="bodycast-app:latest"
readonly ROLLBACK_IMAGE="bodycast-app:rollback"
readonly APP_HOST="${APP_HOST:?APP_HOST is required}"
readonly CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:?CADDY_ROUTES_PATH is required}"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

previous_image_exists=false
if docker image inspect "$CURRENT_IMAGE" >/dev/null 2>&1; then
  docker image tag "$CURRENT_IMAGE" "$ROLLBACK_IMAGE"
  previous_image_exists=true
fi

rollback() {
  exit_code=$?
  echo "Deployment failed; restoring the previous application image." >&2
  if [[ "$previous_image_exists" == "true" ]] && docker image inspect "$ROLLBACK_IMAGE" >/dev/null 2>&1; then
    docker image tag "$ROLLBACK_IMAGE" "$CURRENT_IMAGE"
    compose up -d --no-deps --force-recreate "$APP_SERVICE" || true
  fi
  compose logs --tail=100 "$APP_SERVICE" || true
  exit "$exit_code"
}
trap rollback ERR

compose config --quiet
compose build "$APP_SERVICE"
compose --profile tools build migrate
compose up -d "$DB_SERVICE"

for attempt in $(seq 1 30); do
  db_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER")"
  [[ "$db_status" == "healthy" ]] && break
  if [[ "$db_status" == "unhealthy" || "$db_status" == "exited" ]]; then
    compose logs --tail=100 "$DB_SERVICE"
    exit 1
  fi
  [[ "$attempt" == "30" ]] && { echo "Database healthcheck timed out." >&2; exit 1; }
  sleep 5
done

compose --profile tools run --rm migrate
compose up -d --no-deps --force-recreate "$APP_SERVICE"

for attempt in $(seq 1 30); do
  app_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")"
  [[ "$app_status" == "healthy" ]] && break
  if [[ "$app_status" == "unhealthy" || "$app_status" == "exited" ]]; then
    compose logs --tail=100 "$APP_SERVICE"
    exit 1
  fi
  [[ "$attempt" == "30" ]] && { echo "Application healthcheck timed out." >&2; exit 1; }
  sleep 5
done

docker exec "$APP_CONTAINER" wget --quiet --tries=1 --output-document=- \
  http://127.0.0.1:3000/api/health | grep -q '"status":"ok"'

route_file="${CADDY_ROUTES_PATH}/bodycast.caddy"
temporary_route="${route_file}.new"
mkdir -p "$CADDY_ROUTES_PATH"

cat >"$temporary_route" <<EOF
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
    reverse_proxy ${APP_CONTAINER}:3000
}
EOF

mv -f "$temporary_route" "$route_file"
docker exec gymbeam-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec gymbeam-caddy caddy reload \
  --address unix//run/caddy-admin/admin.sock \
  --config /etc/caddy/Caddyfile

curl --fail --silent --show-error --retry 12 --retry-delay 5 \
  "https://${APP_HOST}/api/health" | grep -q '"status":"ok"'

trap - ERR
docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1 || true
echo "BodyCast deployment completed successfully."
