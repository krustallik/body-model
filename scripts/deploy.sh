#!/usr/bin/env bash
# Production app release (no Prisma migrate, no replay, no selection activation).
# Requires DEPLOY_SHA (exact main commit that passed CI).
#
# Ordering contract:
# 1) verify exact SHA
# 2) verify compose config + DB readiness
# 3) schema preflight (non-destructive)
# 4) require current V4 before serving
# 5) build release image while the previous app remains serving
# 6) enter maintenance, then replace and verify the app before serving
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
CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:?CADDY_ROUTES_PATH is required}"
source "$ROOT_DIR/scripts/production-route-path.sh"
bodycast_canonicalize_routes_path || exit 1
readonly CADDY_ROUTES_PATH
export APP_HOST CADDY_ROUTES_PATH
source "$ROOT_DIR/scripts/production-release-marker.sh"
source "$ROOT_DIR/scripts/deploy-main-freshness.sh"
readonly DEPLOY_SHA="${DEPLOY_SHA:?DEPLOY_SHA is required}"
readonly BODYCAST_NON_SERVING_DEPLOY="${BODYCAST_NON_SERVING_DEPLOY:-0}"
freshness_blocked=false

assert_current_main_sha() {
  if ! bodycast_assert_current_main_sha "$DEPLOY_SHA"; then
    freshness_blocked=true
    return 1
  fi
}

if [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "DEPLOY_SHA must be a full 40-character commit SHA (got: ${DEPLOY_SHA})." >&2
  exit 1
fi
if [[ "$BODYCAST_NON_SERVING_DEPLOY" != "0" && "$BODYCAST_NON_SERVING_DEPLOY" != "1" ]]; then
  echo "BODYCAST_NON_SERVING_DEPLOY must be 0 or 1." >&2
  exit 1
fi

# Both the host-authority and fallback paths independently read canonical
# origin/main before any release operation begins.
assert_current_main_sha

# After the separate host-preparation checkpoint, the release principal has no
# Docker/Caddy privileges. A fixed systemd-broker client executes the reviewed
# release operation; its request has no caller-supplied command or path. Before
# that checkpoint the absent client preserves today's ordinary deployment path.
HOST_OPERATION_CLIENT="/usr/local/bin/bodycast-production-operation"
if [[ -x "$HOST_OPERATION_CLIENT" ]]; then
  release_mode="serving"
  [[ "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]] && release_mode="non-serving"
  exec "$HOST_OPERATION_CLIENT" ordinary-release \
    --request-id "deploy-${DEPLOY_SHA}-$$" \
    --release-sha "$DEPLOY_SHA" \
    --canonical-main-sha "$DEPLOY_SHA" \
    --canonical-main-fence fresh-current-main-v1 \
    --release-mode "$release_mode"
fi

source "$ROOT_DIR/scripts/production-route-primitives.sh"

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

stop_current_app_fail_closed() {
  local existing_app remaining_app stop_failed=0
  if ! existing_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"; then
    echo "Docker app listing failed; app presence is UNKNOWN, not absent." >&2
    return 1
  fi
  if [[ -n "$existing_app" ]]; then
    if [[ "$existing_app" != "$APP_CONTAINER" ]]; then
      echo "App container identity is ambiguous; cannot confirm fail-closed stop." >&2
      return 1
    fi
    if ! docker update --restart=no "$APP_CONTAINER" >/dev/null 2>&1; then stop_failed=1; fi
    if ! compose stop "$APP_SERVICE" >/dev/null 2>&1; then stop_failed=1; fi
    if ! docker stop --time 0 "$APP_CONTAINER" >/dev/null 2>&1; then stop_failed=1; fi
    local app_state app_restart
    if ! app_state="$(docker inspect --format '{{.State.Status}}' "$APP_CONTAINER")"; then
      app_state="UNKNOWN"
      echo "Docker app state inspection failed; app state is UNKNOWN." >&2
      stop_failed=1
    fi
    if ! app_restart="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$APP_CONTAINER")"; then
      app_restart="UNKNOWN"
      echo "Docker restart-policy inspection failed; restart policy is UNKNOWN." >&2
      stop_failed=1
    fi
    if [[ "$app_state" == "exited" && "$app_restart" == "no" ]]; then
      if ! compose rm --force "$APP_SERVICE" >/dev/null 2>&1; then stop_failed=1; fi
    else
      echo "App is not confirmed stopped with restart disabled; refusing removal." >&2
      stop_failed=1
    fi
  fi
  if ! remaining_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"; then
    echo "Final Docker app listing failed; app presence is UNKNOWN, not absent." >&2
    return 1
  fi
  if [[ -n "$remaining_app" ]]; then
    echo "Candidate app container remains after fail-closed stop attempts." >&2
    stop_failed=1
  fi
  [[ "$stop_failed" -eq 0 ]]
}

# Same-attempt rollback only: this function has no caller-supplied route text
# or SHA. It is reached only after the trap has reverified the captured prior
# image/SHA, marker absence, maintenance route, health, and Unified V4 state.
publish_captured_previous_route() {
  local route_file="${CADDY_ROUTES_PATH%/}/bodycast.caddy" temporary
  bodycast_stage_route_config "reverse_proxy ${APP_CONTAINER}:3000" || return 1
  temporary="$BODYCAST_ROUTE_STAGE_PATH"
  local restored_status restored_sha restored_image_id pinned_image_id rollback_marker_status
  if ! restored_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")" \
      || ! restored_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")" \
      || ! restored_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")" \
      || ! pinned_image_id="$(docker image inspect --format '{{.Id}}' "$ROLLBACK_IMAGE")"; then
    rm -f -- "$temporary"
    echo "Docker identity inspection failed; prior-release state is UNKNOWN." >&2
    return 1
  fi
  rollback_marker_status=1
  if read_bodycast_release_marker; then rollback_marker_status=0; else rollback_marker_status=$?; fi
  if [[ "$restored_status" != "healthy" || "$restored_sha" != "$previous_app_sha" \
      || "$restored_image_id" != "$previous_app_image_id" \
      || "$pinned_image_id" != "$previous_app_image_id" \
      || "$rollback_marker_status" -ne 1 ]] || ! bodycast_verify_exact_maintenance_route; then
    rm -f -- "$temporary"
    echo "Captured prior release or maintenance authorization changed before publication." >&2
    return 1
  fi
  if ! bodycast_assert_safe_routes_location; then
    rm -f -- "$temporary"
    return 1
  fi
  if ! mv -f -- "$temporary" "$route_file"; then
    rm -f -- "$temporary"
    echo "Atomic captured-prior route replacement failed; the previous Caddy config remains active." >&2
    return 1
  fi
  if ! docker exec gymbeam-caddy caddy reload \
    --address unix//run/caddy-admin/admin.sock \
    --config /etc/caddy/Caddyfile; then
    echo "Caddy did not confirm the captured-prior route; the previous active config remains in force." >&2
    return 1
  fi
}

previous_image_exists=false
maintenance_started=false
previous_app_healthy=false
previous_app_sha=""
previous_app_image_id=""
candidate_image_id=""

if ! existing_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"; then
  echo "Docker app listing failed; app presence is UNKNOWN, not absent; deployment stopped before cutover." >&2
  exit 1
fi
if [[ "$existing_app" == "$APP_CONTAINER" ]]; then
  previous_app_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
  previous_app_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
  previous_app_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")"
  if [[ "$previous_app_sha" =~ ^[0-9a-f]{40}$ \
      && "$previous_app_image_id" =~ ^sha256:[0-9a-f]{64}$ \
      && "$previous_app_status" == "healthy" ]]; then
    previous_app_healthy=true
    # Pin the exact immutable image backing the running healthy container.
    # The mutable :latest tag is not evidence of the previous release image.
    docker image tag "$previous_app_image_id" "$ROLLBACK_IMAGE"
    pinned_rollback_image_id="$(docker image inspect --format '{{.Id}}' "$ROLLBACK_IMAGE")"
    [[ "$pinned_rollback_image_id" == "$previous_app_image_id" ]] || {
      echo "Rollback image reference does not resolve to the running app's immutable image ID." >&2
      exit 1
    }
    previous_image_exists=true
  fi
fi

rollback() {
  exit_code=$?
  trap - ERR
  set +e
  if [[ "$active_schema_cutover" == "true" || "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]]; then
    echo "Non-serving/schema-cutover deployment failed; prior binary restart is refused." >&2
    if ! bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" maintenance; then
      echo "Maintenance activation failed; the prior Caddy config may still be active." >&2
    fi
    if ! stop_current_app_fail_closed; then
      echo "Fail-closed app removal could not be confirmed after non-serving failure; operator intervention is required." >&2
    fi
    compose logs --tail=100 "$APP_SERVICE"
    exit "$exit_code"
  fi

  if [[ "$exit_code" -eq 75 && "$maintenance_started" == "true" ]]; then
    echo "Candidate Caddy serving load failed; the previously active maintenance config remains authoritative; same-attempt prior-release serving is not attempted." >&2
    if ! bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" maintenance; then
      echo "Maintenance route refresh failed; Caddy retained its last confirmed active config." >&2
    fi
    if ! stop_current_app_fail_closed; then
      echo "Candidate app cleanup could not be confirmed; active maintenance still prevents external candidate traffic." >&2
    fi
    compose logs --tail=100 "$APP_SERVICE"
    exit "$exit_code"
  fi

  if [[ "$maintenance_started" != "true" ]]; then
    if [[ "$freshness_blocked" == "true" ]]; then
      echo "Release candidate was superseded before maintenance; previous app and route remain unchanged." >&2
    else
      echo "Deployment failed before maintenance; previous app and route remain serving." >&2
    fi
    if [[ "$previous_image_exists" == "true" ]] && ! docker image tag "$ROLLBACK_IMAGE" "$CURRENT_IMAGE"; then
      echo "Could not restore the previous image tag; the running container remains unchanged." >&2
    fi
    compose logs --tail=100 "$APP_SERVICE"
    exit "$exit_code"
  fi

  echo "Deployment failed after maintenance began; restoring only the previously healthy app." >&2
  if ! bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" maintenance; then
    echo "Maintenance activation failed; no replacement will be started behind an unproven route." >&2
    if ! stop_current_app_fail_closed; then
      echo "Fail-closed app removal could not be confirmed; operator intervention is required." >&2
    fi
    compose logs --tail=100 "$APP_SERVICE"
    exit "$exit_code"
  fi
  if ! bodycast_verify_exact_maintenance_route; then
    echo "The exact maintenance route is not active; prior-release restoration is blocked." >&2
    if ! stop_current_app_fail_closed; then
      echo "Fail-closed app removal could not be confirmed; operator intervention is required." >&2
    fi
    compose logs --tail=100 "$APP_SERVICE"
    exit "$exit_code"
  fi
  if [[ "$previous_image_exists" == "true" && "$previous_app_healthy" == "true" \
      && "$previous_app_sha" =~ ^[0-9a-f]{40}$ \
      && "$previous_app_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    pinned_rollback_image_id="$(docker image inspect --format '{{.Id}}' "$ROLLBACK_IMAGE")"
    if [[ "$pinned_rollback_image_id" != "$previous_app_image_id" ]]; then
      echo "Pinned rollback image changed identity; traffic remains in maintenance." >&2
      compose logs --tail=100 "$APP_SERVICE"
      exit "$exit_code"
    fi
    if ! docker image tag "$ROLLBACK_IMAGE" "$CURRENT_IMAGE"; then
      echo "Previous image tag could not be restored; traffic remains in maintenance." >&2
      compose logs --tail=100 "$APP_SERVICE"
      exit "$exit_code"
    fi
    restored_latest_image_id="$(docker image inspect --format '{{.Id}}' "$CURRENT_IMAGE")"
    if [[ "$restored_latest_image_id" != "$previous_app_image_id" ]]; then
      echo "The app image tag does not resolve to the captured previous image; traffic remains in maintenance." >&2
      compose logs --tail=100 "$APP_SERVICE"
      exit "$exit_code"
    fi
    if ! BODYCAST_DEPLOY_SHA="$previous_app_sha" compose up -d --no-deps --force-recreate "$APP_SERVICE"; then
      echo "Previous app could not be recreated; traffic remains in maintenance." >&2
      compose logs --tail=100 "$APP_SERVICE"
      exit "$exit_code"
    fi
    previous_restored=false
    for attempt in $(seq 1 30); do
      restored_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")"
      if [[ "$restored_status" == "healthy" ]]; then
        restored_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
        restored_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
        if [[ "$restored_sha" == "$previous_app_sha" \
            && "$restored_image_id" == "$previous_app_image_id" ]]; then
          previous_restored=true
        fi
        break
      fi
      if [[ "$restored_status" == "unhealthy" || "$restored_status" == "exited" ]]; then break; fi
      sleep 5
    done
    if [[ "$previous_restored" == "true" ]]; then
      rollback_marker_status=1
      if read_bodycast_release_marker; then rollback_marker_status=0; else rollback_marker_status=$?; fi
      if [[ "$rollback_marker_status" -ne 1 ]]; then
        echo "A release/recovery marker blocks prior-release restoration; traffic remains in maintenance." >&2
      elif ! bodycast_verify_exact_maintenance_route; then
        echo "The exact maintenance route could not be verified; traffic remains in maintenance." >&2
      elif ! compose --profile tools build migrate; then
        echo "The Unified V4 verifier image could not be prepared; traffic remains in maintenance." >&2
      elif ! compose --profile tools run --rm --no-deps --entrypoint node migrate \
        /app/scripts/unified-v4-traffic-check.mjs --profile-id 1; then
        echo "Unified V4 currentness blocks prior-release restoration; traffic remains in maintenance." >&2
      else
        # The only rollback target is the exact healthy SHA/image captured and
        # pinned by this deploy process before it replaced the old container.
        # Do not use candidate-main freshness to restore that pre-deploy state.
        restored_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")"
        restored_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
        restored_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
        pinned_rollback_image_id="$(docker image inspect --format '{{.Id}}' "$ROLLBACK_IMAGE")"
        rollback_marker_status=1
        if read_bodycast_release_marker; then rollback_marker_status=0; else rollback_marker_status=$?; fi
        if [[ "$restored_status" != "healthy" || "$restored_sha" != "$previous_app_sha" \
            || "$restored_image_id" != "$previous_app_image_id" \
            || "$pinned_rollback_image_id" != "$previous_app_image_id" \
            || "$rollback_marker_status" -ne 1 ]]; then
          echo "The captured prior release or marker state changed before route publication; traffic remains in maintenance." >&2
        elif ! bodycast_verify_exact_maintenance_route; then
          echo "Maintenance changed before prior-release route publication; traffic remains in maintenance." >&2
        elif ! docker exec "$APP_CONTAINER" wget --quiet --tries=1 --output-document=- \
          http://127.0.0.1:3000/api/health | grep -q '"status":"ok"'; then
          echo "Captured prior app failed its pre-publication local health check; traffic remains in maintenance." >&2
        elif ! publish_captured_previous_route; then
          echo "The captured prior release could not be published safely; traffic remains in maintenance." >&2
        else
          echo "Previously serving app ${previous_app_sha} was restored from immutable image ${previous_app_image_id} and passed the V4 traffic gate." >&2
        fi
      fi
    else
      echo "Previous app did not return healthy with its exact image ID and release label; traffic remains in maintenance." >&2
    fi
  else
    echo "No previously healthy exact-SHA app is available; traffic remains in maintenance." >&2
  fi
  compose logs --tail=100 "$APP_SERVICE"
  exit "$exit_code"
}
trap rollback ERR

compose config --quiet
assert_current_main_sha
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
  assert_current_main_sha
  maintenance_started=true
  bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" maintenance
else
  bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" check
fi

compose build "$APP_SERVICE"
candidate_image_id="$(docker image inspect --format '{{.Id}}' "$CURRENT_IMAGE")"
[[ "$candidate_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "Built candidate image does not have an immutable image ID." >&2
  exit 1
}

# Do not put ordinary releases into maintenance during the expensive image build.
# Once the image is ready, hold traffic at 503 until replacement, health, exact
# SHA, V4 currentness, and final canonical-main checks all pass.
if [[ "$BODYCAST_NON_SERVING_DEPLOY" == "0" ]]; then
  assert_current_main_sha
  maintenance_started=true
  bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" maintenance
fi

# Cutover boundary: only recreate the app after maintenance is active.
assert_current_main_sha
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
deployed_container_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
[[ "$deployed_container_image_id" == "$candidate_image_id" ]] || {
  echo "Running app container image ID does not match the immutable built candidate image." >&2
  exit 1
}

if [[ "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]]; then
  if [[ "$active_schema_cutover" == "true" ]]; then
    assert_current_main_sha
    write_bodycast_release_marker "$DEPLOY_SHA" app-ready
  fi
  echo "Exact SHA is deployed in non-serving maintenance mode; explicit V4 activation/replay and traffic check remain required."
else
  assert_current_main_sha
  bash "${ROOT_DIR}/scripts/production-traffic-cutover.sh" serve
  # The serving child returns success only after its terminal Caddy load.
  # Disable rollback immediately; all remaining work is non-fatal reporting or cleanup.
  trap - ERR
fi

trap - ERR
if ! docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1; then
  echo "Non-fatal rollback image cleanup failed; the verified serving release remains committed." >&2
fi
echo "BodyCast deployment completed successfully for ${DEPLOY_SHA}."
echo "DEPLOYED_SHA=${DEPLOY_SHA}"
