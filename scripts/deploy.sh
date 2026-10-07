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
source "$ROOT_DIR/scripts/production-release-marker.sh"

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly APP_SERVICE="app"
readonly APP_CONTAINER="bodycast-app-prod"
readonly DB_SERVICE="db"
readonly DB_CONTAINER="bodycast-db-prod"
readonly CURRENT_IMAGE="bodycast-app:latest"
readonly ROLLBACK_IMAGE="bodycast-app:rollback"
readonly APP_HOST="${APP_HOST:?APP_HOST is required}"
readonly CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:?CADDY_ROUTES_PATH is required}"
export APP_HOST CADDY_ROUTES_PATH
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

# After the separate host-preparation checkpoint, the release principal has no
# Docker/Caddy privileges. A fixed systemd-broker client executes the reviewed
# release operation; its request has no caller-supplied command or path. Before
# that checkpoint the absent client preserves today's ordinary deployment path.
HOST_OPERATION_CLIENT="/usr/local/bin/bodycast-production-operation"
if [[ -x "$HOST_OPERATION_CLIENT" && "${BODYCAST_AUTHORITY_EXECUTION:-0}" != "1" ]]; then
  release_mode="serving"
  [[ "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]] && release_mode="non-serving"
  exec "$HOST_OPERATION_CLIENT" ordinary-release \
    --request-id "deploy-${DEPLOY_SHA}-$$" \
    --release-sha "$DEPLOY_SHA" \
    --canonical-main-sha "$DEPLOY_SHA" \
    --release-mode "$release_mode"
fi

echo "Deploying exact commit ${DEPLOY_SHA} (app recreate only; migrate/replay/activation not run)."

git fetch --no-tags origin "$DEPLOY_SHA"
git checkout --detach --force "$DEPLOY_SHA"
deployed_sha="$(git rev-parse HEAD)"
if [[ "$deployed_sha" != "$DEPLOY_SHA" ]]; then
  echo "Checked-out SHA ${deployed_sha} does not match DEPLOY_SHA ${DEPLOY_SHA}." >&2
  exit 1
fi
marker_status=1
if read_bodycast_release_marker; then
  marker_status=0
else
  marker_status=$?
fi
active_schema_cutover=false
if [[ "$marker_status" -eq 0 ]]; then
  [[ "$BODYCAST_MARKER_RELEASE_SHA" == "$DEPLOY_SHA" \
    && ( "$BODYCAST_MARKER_STATE" == "schema-applied" || "$BODYCAST_MARKER_STATE" == "app-ready" ) ]] || {
    echo "Deployment SHA/state does not match the pending production schema-cutover marker; refusing app start." >&2
    exit 1
  }
  [[ "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]] || {
    echo "A schema-cutover marker requires an exact-SHA non-serving deployment first." >&2
    exit 1
  }
  active_schema_cutover=true
elif [[ "$marker_status" -ne 1 ]]; then
  echo "Invalid production release marker; refusing deployment." >&2
  exit 1
fi
export BODYCAST_DEPLOY_SHA="$DEPLOY_SHA"
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
    if [[ "$active_schema_cutover" == "true" || "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]]; then
      bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" maintenance || true
    elif [[ "$previous_image_exists" == "true" ]] && docker image inspect "$ROLLBACK_IMAGE" >/dev/null 2>&1; then
      # Restore :latest tag for cleanliness without recreating the container.
      docker image tag "$ROLLBACK_IMAGE" "$CURRENT_IMAGE" || true
    fi
    compose logs --tail=100 "$APP_SERVICE" || true
    exit "$exit_code"
  fi

  if [[ "$active_schema_cutover" == "true" || "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]]; then
    echo "Non-serving/schema-cutover deployment failed; keeping maintenance active and refusing to restart the prior binary." >&2
    bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" maintenance || true
    docker update --restart=no "$APP_CONTAINER" >/dev/null 2>&1 || true
    compose stop "$APP_SERVICE" >/dev/null 2>&1 || true
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
  bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" maintenance
else
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

deployed_container_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
[[ "$deployed_container_sha" == "$DEPLOY_SHA" ]] || {
  echo "Running app container release label does not match the authorized exact SHA." >&2
  exit 1
}

if [[ "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]]; then
  if [[ "$active_schema_cutover" == "true" ]]; then
    write_bodycast_release_marker "$DEPLOY_SHA" app-ready
  fi
  echo "Exact SHA is deployed in non-serving maintenance mode; explicit V4 activation/replay and traffic check remain required."
else
  bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" serve
fi

trap - ERR
docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1 || true
echo "BodyCast deployment completed successfully for ${DEPLOY_SHA}."
echo "DEPLOYED_SHA=${DEPLOY_SHA}"
