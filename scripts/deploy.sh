#!/usr/bin/env bash
# Production app release (no Prisma migrate, no replay, no selection activation).
# Requires DEPLOY_SHA (exact main commit that passed CI).
#
# Ordering contract:
# 1) verify exact SHA
# 2) verify compose config + DB readiness
# 3) schema preflight (non-destructive)
# 4) require current V4 before serving, or switch to maintenance first
# 5) build release image
# 6) only then recreate the running app
# A failed preflight must leave the running application container unchanged.
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
readonly DEPLOY_SHA="${DEPLOY_SHA:?DEPLOY_SHA is required}"
readonly BODYCAST_NON_SERVING_DEPLOY="${BODYCAST_NON_SERVING_DEPLOY:-0}"

if [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "DEPLOY_SHA must be a full 40-character commit SHA (got: ${DEPLOY_SHA})." >&2
  exit 1
fi
if [[ "$BODYCAST_NON_SERVING_DEPLOY" != "0" && "$BODYCAST_NON_SERVING_DEPLOY" != "1" ]]; then
  echo "BODYCAST_NON_SERVING_DEPLOY must be 0 or 1." >&2
  exit 1
fi

echo "Deploying exact commit ${DEPLOY_SHA} (app recreate only; migrate/replay/activation not run)."

git fetch --no-tags origin "$DEPLOY_SHA"
git checkout --detach --force "$DEPLOY_SHA"
deployed_sha="$(git rev-parse HEAD)"
if [[ "$deployed_sha" != "$DEPLOY_SHA" ]]; then
  echo "Checked-out SHA ${deployed_sha} does not match DEPLOY_SHA ${DEPLOY_SHA}." >&2
  exit 1
fi
chmod +x "${ROOT_DIR}/scripts/deploy.sh" "${ROOT_DIR}/scripts/deploy-preflight-schema.sh" "${ROOT_DIR}/scripts/production-traffic-cutover.sh"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

previous_image_exists=false
app_cut_over=false

if docker image inspect "$CURRENT_IMAGE" >/dev/null 2>&1; then
  docker image tag "$CURRENT_IMAGE" "$ROLLBACK_IMAGE"
  previous_image_exists=true
fi

rollback() {
  exit_code=$?
  if [[ "$app_cut_over" != "true" ]]; then
    echo "Deployment failed before app cutover; leaving the running application unchanged." >&2
    if [[ "$previous_image_exists" == "true" ]] && docker image inspect "$ROLLBACK_IMAGE" >/dev/null 2>&1; then
      # Restore :latest tag for cleanliness without recreating the container.
      docker image tag "$ROLLBACK_IMAGE" "$CURRENT_IMAGE" || true
    fi
    compose logs --tail=100 "$APP_SERVICE" || true
    exit "$exit_code"
  fi

  echo "Deployment failed after app cutover; restoring the previous application image." >&2
  if [[ "$previous_image_exists" == "true" ]] && docker image inspect "$ROLLBACK_IMAGE" >/dev/null 2>&1; then
    docker image tag "$ROLLBACK_IMAGE" "$CURRENT_IMAGE"
    compose up -d --no-deps --force-recreate "$APP_SERVICE" || true
  fi
  compose logs --tail=100 "$APP_SERVICE" || true
  exit "$exit_code"
}
trap rollback ERR

compose config --quiet
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

# Schema must already be compatible. Ordinary deploy never runs migrate deploy.
# Preflight runs before build/cutover so pending migrations never bounce the live app.
bash "${ROOT_DIR}/scripts/deploy-preflight-schema.sh"

# A rollout deploy is explicitly non-serving. A normal app cutover first checks
# that Forecast V2's required physical Unified V4 snapshot is already current.
if [[ "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]]; then
  APP_HOST="$APP_HOST" CADDY_ROUTES_PATH="$CADDY_ROUTES_PATH" \
    bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" maintenance
else
  APP_HOST="$APP_HOST" CADDY_ROUTES_PATH="$CADDY_ROUTES_PATH" \
    bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" check
fi

compose build "$APP_SERVICE"

# Cutover boundary: only recreate the running app after successful preflight + build.
app_cut_over=true
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

if [[ "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]]; then
  echo "Exact SHA is deployed in non-serving maintenance mode; explicit V4 activation/replay and traffic check remain required."
else
  APP_HOST="$APP_HOST" CADDY_ROUTES_PATH="$CADDY_ROUTES_PATH" \
    bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" serve
fi

trap - ERR
docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1 || true
echo "BodyCast deployment completed successfully for ${DEPLOY_SHA}."
echo "DEPLOYED_SHA=${DEPLOY_SHA}"
