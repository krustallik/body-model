#!/usr/bin/env bash
# Maintenance/serving route gate for the Forecast V2 + Unified V4 release.
set -Eeuo pipefail

MODE="${1:-}"
ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT_DIR"

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly APP_CONTAINER="bodycast-app-prod"
readonly ROLLBACK_IMAGE="bodycast-app:rollback"
readonly APP_HOST="${APP_HOST:?APP_HOST is required}"
readonly CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:?CADDY_ROUTES_PATH is required}"
export APP_HOST CADDY_ROUTES_PATH
readonly ROUTE_FILE="${CADDY_ROUTES_PATH}/bodycast.caddy"
source "${ROOT_DIR}/scripts/production-release-marker.sh"
source "${ROOT_DIR}/scripts/deploy-main-freshness.sh"

[[ "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "APP_HOST is invalid." >&2; exit 1; }
[[ "$CADDY_ROUTES_PATH" == /* ]] || { echo "CADDY_ROUTES_PATH must be absolute." >&2; exit 1; }
[[ "$MODE" == "maintenance" || "$MODE" == "check" || "$MODE" == "v3-postflight" || "$MODE" == "serve" || "$MODE" == "rollback-previous" ]] || {
  echo "Usage: APP_HOST=... CADDY_ROUTES_PATH=... bash scripts/production-traffic-cutover.sh maintenance|check|v3-postflight|serve|rollback-previous" >&2
  exit 1
}

# After host preparation, even direct traffic-script invocations cross the same
# fixed root broker. This prevents bypassing deploy.sh by calling Caddy/Docker
# operations from a stale or manually checked-out release tree.
HOST_OPERATION_CLIENT="/usr/local/bin/bodycast-production-operation"
if [[ -x "$HOST_OPERATION_CLIENT" ]]; then
  RELEASE_SHA="${BODYCAST_DEPLOY_SHA:-${DEPLOY_SHA:-${RELEASE_SHA:-}}}"
  CANONICAL_MAIN_SHA="${BODYCAST_CANONICAL_MAIN_SHA:-$RELEASE_SHA}"
  [[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ && "$CANONICAL_MAIN_SHA" =~ ^[a-f0-9]{40}$ ]] || {
    echo "A current exact release SHA is required for the production operation authority." >&2
    exit 1
  }
  [[ "${BODYCAST_AUTHORIZATION_WORKFLOW_ID:-}" =~ ^[1-9][0-9]*$ \
    && "${BODYCAST_AUTHORIZATION_RUN_ID:-}" =~ ^[1-9][0-9]*$ \
    && "${BODYCAST_AUTHORIZATION_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]] || {
    echo "A signed forward-release authorization context is required for direct traffic operations." >&2
    exit 1
  }
  AUTHORIZATION_CONTEXT_ID="migration-${BODYCAST_AUTHORIZATION_WORKFLOW_ID}-${BODYCAST_AUTHORIZATION_RUN_ID}-${BODYCAST_AUTHORIZATION_RUN_ATTEMPT}"
  case "$MODE" in
    check) OPERATION="traffic-check" ;;
    v3-postflight) OPERATION="v3-postflight" ;;
    maintenance) OPERATION="traffic-maintenance" ;;
    serve) OPERATION="traffic-serve" ;;
    rollback-previous)
      echo "Prior-release fallback is unavailable through the installed host authority; refusing direct route mutation." >&2
      exit 1
      ;;
  esac
  exec "$HOST_OPERATION_CLIENT" "$OPERATION" \
    --request-id "traffic-${MODE}-$(date -u +%s)-$$" \
    --release-sha "$RELEASE_SHA" \
    --canonical-main-sha "$CANONICAL_MAIN_SHA" \
    --authorization-context-id "$AUTHORIZATION_CONTEXT_ID"
fi

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
  local freshness_sha="${2:-}"
  local route_parent route_mount stage_mount route_canonical temporary
  mkdir -p "$CADDY_ROUTES_PATH"
  [[ -d "$CADDY_ROUTES_PATH" && ! -L "$CADDY_ROUTES_PATH" ]] || {
    echo "CADDY_ROUTES_PATH must be an existing non-symlink directory." >&2
    return 1
  }
  route_canonical="$(realpath -e "$CADDY_ROUTES_PATH")"
  [[ "$route_canonical" == "$CADDY_ROUTES_PATH" ]] || {
    echo "CADDY_ROUTES_PATH must be canonical so staging is outside the live route directory." >&2
    return 1
  }
  route_parent="$(dirname "$CADDY_ROUTES_PATH")"
  route_mount="$(stat -c '%d:%m' "$CADDY_ROUTES_PATH")"
  stage_mount="$(stat -c '%d:%m' "$route_parent")"
  [[ "$route_mount" == "$stage_mount" ]] || {
    echo "Cannot stage the route outside the watched directory on the same filesystem; refusing a non-atomic cutover." >&2
    return 1
  }
  # Stage beside, but outside, the live routes directory. No candidate bytes
  # touch a path imported from the production route directory before publish.
  temporary="$(mktemp "${route_parent}/.bodycast-route-stage.XXXXXX")"
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
  chmod 0644 "$temporary"
  # Validate the exact staged route bytes through Caddy's adapter while the
  # live watched route remains unchanged.
  if ! docker exec -i gymbeam-caddy caddy validate --adapter caddyfile --config - < "$temporary"; then
    rm -f -- "$temporary"
    echo "Caddy rejected the staged route; the live route was not changed." >&2
    return 1
  fi

  # Candidate health, exact SHA, and Unified V4 checks are completed by the
  # caller. This is the final canonical-main fence immediately before publish.
  if [[ -n "$freshness_sha" ]] && ! bodycast_assert_current_main_sha "$freshness_sha"; then
    rm -f -- "$temporary"
    return 1
  fi
  # Atomic replacement of the live route is itself the serving effect. Caddy
  # may watch this path, so no stale-after-write rollback is used as a fence.
  if ! mv -f -- "$temporary" "$ROUTE_FILE"; then
    rm -f -- "$temporary"
    echo "Atomic live-route replacement failed; the previous route remains in place." >&2
    return 1
  fi
  if ! docker exec gymbeam-caddy caddy reload \
    --address unix//run/caddy-admin/admin.sock \
    --config /etc/caddy/Caddyfile; then
    echo "Caddy reload failed after the atomic route effect; caller must retain or restore maintenance." >&2
    return 1
  fi
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

if [[ "$MODE" == "rollback-previous" ]]; then
  rollback_sha="${BODYCAST_ROLLBACK_SHA:-}"
  rollback_image_id="${BODYCAST_ROLLBACK_IMAGE_ID:-}"
  [[ "$rollback_sha" =~ ^[a-f0-9]{40}$ && "$rollback_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || {
    echo "A full prior app SHA and immutable image ID are required for safe fallback." >&2; exit 1;
  }
  app_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")"
  app_release_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
  app_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
  pinned_image_id="$(docker image inspect --format '{{.Id}}' "$ROLLBACK_IMAGE")"
  [[ "$app_status" == "healthy" && "$app_release_sha" == "$rollback_sha" \
    && "$app_image_id" == "$rollback_image_id" && "$pinned_image_id" == "$rollback_image_id" ]] || {
    echo "Prior-release fallback requires the exact healthy app SHA and pinned immutable image ID." >&2; exit 1;
  }
  verify_exact_maintenance_route
  marker_status=1
  if read_bodycast_release_marker; then marker_status=0; else marker_status=$?; fi
  [[ "$marker_status" -eq 1 ]] || { echo "Prior-release fallback is blocked by a release/recovery marker." >&2; exit 1; }
  compose --profile tools build migrate
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-traffic-check.mjs --profile-id 1
  # This restores the exact pre-deploy release after verifying its immutable
  # image, SHA, health, marker state, maintenance route, and current V4 state.
  # It is not a candidate publish and does not depend on candidate freshness.
  write_route "reverse_proxy ${APP_CONTAINER}:3000"
  if ! curl --fail --silent --show-error --retry 12 --retry-delay 5 "https://${APP_HOST}/api/health" | grep -q '"status":"ok"'; then
    enter_maintenance
    echo "Prior app failed the post-cutover health check; traffic returned to maintenance." >&2
    exit 1
  fi
  echo "Previously serving exact app ${rollback_sha} restored after candidate release rollback."
  exit 0
fi

app_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")"
[[ "$app_status" == "healthy" ]] || { echo "Forecast V2 serving requires a healthy app container." >&2; exit 1; }
app_release_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
expected_release_sha="${BODYCAST_DEPLOY_SHA:-${DEPLOY_SHA:-}}"
[[ "$expected_release_sha" =~ ^[a-f0-9]{40}$ && "$app_release_sha" == "$expected_release_sha" ]] || {
  echo "Forecast V2 serving requires the healthy app to match the exact requested release SHA." >&2; exit 1;
}
verify_exact_maintenance_route
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
write_route "reverse_proxy ${APP_CONTAINER}:3000" "$expected_release_sha"
if ! curl --fail --silent --show-error --retry 12 --retry-delay 5 "https://${APP_HOST}/api/health" | grep -q '"status":"ok"'; then
  enter_maintenance
  echo "Health check failed after serving cutover; traffic returned to maintenance." >&2
  exit 1
fi
if [[ "$marker_status" -eq 0 ]]; then
  clear_bodycast_release_marker
fi
echo "Forecast V2 serving enabled after exact Unified V4 currentness verification."
