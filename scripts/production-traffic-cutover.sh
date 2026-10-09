#!/usr/bin/env bash
# Maintenance/serving route gate for the Forecast V2 + Unified V4 release.
set -Eeuo pipefail

MODE="${1:-}"
ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT_DIR"

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly APP_CONTAINER="bodycast-app-prod"
readonly APP_HOST="${APP_HOST:?APP_HOST is required}"
CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:?CADDY_ROUTES_PATH is required}"
source "${ROOT_DIR}/scripts/production-route-path.sh"
bodycast_canonicalize_routes_path || exit 1
readonly CADDY_ROUTES_PATH
export APP_HOST CADDY_ROUTES_PATH
source "${ROOT_DIR}/scripts/production-release-marker.sh"
source "${ROOT_DIR}/scripts/deploy-main-freshness.sh"
source "${ROOT_DIR}/scripts/production-release-lock.sh"

[[ "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "APP_HOST is invalid." >&2; exit 1; }
[[ "$MODE" == "maintenance" || "$MODE" == "check" || "$MODE" == "v3-postflight" || "$MODE" == "serve" ]] || {
  echo "Usage: APP_HOST=... CADDY_ROUTES_PATH=... bash scripts/production-traffic-cutover.sh maintenance|check|v3-postflight|serve" >&2
  exit 1
}

bodycast_acquire_production_release_lock
source "${ROOT_DIR}/scripts/production-route-primitives.sh"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

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
  local existing_app app_state app_restart remaining_app stop_failed=0
  if ! existing_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"; then
    echo "Docker app listing failed; app presence is UNKNOWN, not absent." >&2
    return 1
  fi
  if [[ -n "$existing_app" ]]; then
    [[ "$existing_app" == "$APP_CONTAINER" ]] || { echo "App container identity is ambiguous." >&2; return 1; }
    if ! docker update --restart=no "$APP_CONTAINER" >/dev/null; then stop_failed=1; fi
    if ! compose stop app >/dev/null 2>&1; then stop_failed=1; fi
    # Attempt a direct stop even if the Compose operation failed. This path is
    # also be used if Caddy retained its prior active config.
    if ! docker stop --time 0 "$APP_CONTAINER" >/dev/null 2>&1; then stop_failed=1; fi
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
      if ! compose rm --force app >/dev/null 2>&1; then stop_failed=1; fi
    else
      echo "Old BodyCast app did not stop with automatic restart disabled." >&2
      stop_failed=1
    fi
  fi
  if ! docker info >/dev/null 2>&1; then stop_failed=1; fi
  if ! remaining_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"; then
    echo "Final Docker app listing failed; app presence is UNKNOWN, not absent." >&2
    return 1
  fi
  if [[ -n "$remaining_app" ]]; then
    echo "Old BodyCast app container still exists and could be manually restarted." >&2
    stop_failed=1
  fi
  [[ "$stop_failed" -eq 0 ]]
}

publish_maintenance_route() {
  local temporary marker reload_failed=false
  marker="$(bodycast_new_maintenance_marker)"
  bodycast_stage_maintenance_route_config "$marker" || return 1
  temporary="$BODYCAST_ROUTE_STAGE_PATH"
  if ! bodycast_publish_staged_route "$temporary"; then
    rm -f -- "$temporary"
    echo "Maintenance route replacement failed." >&2
    return 1
  fi
  if ! docker exec gymbeam-caddy caddy reload \
    --address unix//run/caddy-admin/admin.sock \
    --config /etc/caddy/Caddyfile; then
    reload_failed=true
  fi
  if ! bodycast_probe_public_maintenance "$marker"; then
    echo "Maintenance was not externally confirmed; the app was not stopped." >&2
    return 1
  fi
  if [[ "$reload_failed" == "true" ]]; then
    echo "Caddy reload failed, but the exact public maintenance response confirms traffic is closed." >&2
  fi
}

publish_candidate_route() {
  local temporary marker reload_failed=false
  marker="$(bodycast_maintenance_marker_from_route)" || return 1
  bodycast_verify_exact_maintenance_route || return 1
  bodycast_probe_public_maintenance "$marker" || return 1
  bodycast_stage_serving_route_config || return 1
  temporary="$BODYCAST_ROUTE_STAGE_PATH"
  # Staged bytes are validated before the final canonical-main fence. No route
  # mutation occurs unless this mode's required exact SHA remains current.
  if ! bodycast_assert_current_main_sha "$expected_release_sha"; then
    rm -f -- "$temporary"
    return 1
  fi
  if ! bodycast_assert_safe_routes_location; then
    rm -f -- "$temporary"
    return 1
  fi
  # Marker removal is a fatal pre-cutover requirement, not post-serving
  # bookkeeping. A failure leaves the active maintenance config untouched.
  if [[ "$marker_status" -eq 0 ]] && ! clear_bodycast_release_marker; then
    rm -f -- "$temporary"
    return 1
  fi
  # Recheck after marker mutation so the only live route effect follows a fresh
  # canonical-main fence and safe-path verification.
  if ! bodycast_assert_current_main_sha "$expected_release_sha"; then
    rm -f -- "$temporary"
    return 1
  fi
  if ! bodycast_assert_safe_routes_location; then
    rm -f -- "$temporary"
    return 1
  fi
  if ! bodycast_publish_staged_route "$temporary"; then
    rm -f -- "$temporary"
    echo "Serving-route replacement failed before serving commit." >&2
    return 1
  fi
  # The live rename is the first possible serving effect. Treat success as the
  # commit immediately; subsequent reload/probe failures are observational.
  SERVING_COMMIT_OCCURRED=true
  set +e
  if ! docker exec gymbeam-caddy caddy reload \
    --address unix//run/caddy-admin/admin.sock \
    --config /etc/caddy/Caddyfile; then
    reload_failed=true
    echo "POST-COMMIT VERIFICATION WARNING: Caddy serving reload failed; route state was not rolled back." >&2
  fi
  if ! bodycast_probe_public_candidate_observational; then
    echo "POST-COMMIT VERIFICATION WARNING: public candidate probe failed; route state was not changed." >&2
  fi
  if [[ "$reload_failed" == "true" ]]; then
    echo "Serving commit remains complete despite the explicit reload error." >&2
  fi
}

enter_maintenance() {
  if ! publish_maintenance_route; then
    return 1
  fi
  stop_old_app
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
  bodycast_verify_exact_maintenance_route
  compose --profile tools build migrate
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v3-postflight.mjs --profile-id 1
  echo "Unified V3 postflight passed while traffic remains in maintenance; V4 activation/replay is still separate."
  exit 0
fi

app_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")"
[[ "$app_status" == "healthy" ]] || { echo "Forecast V2 serving requires a healthy app container." >&2; exit 1; }
app_release_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
expected_release_sha="${BODYCAST_DEPLOY_SHA:-${DEPLOY_SHA:-}}"
[[ "$expected_release_sha" =~ ^[a-f0-9]{40}$ && "$app_release_sha" == "$expected_release_sha" ]] || {
  echo "Forecast V2 serving requires the healthy app to match the exact requested release SHA." >&2; exit 1;
}
bodycast_verify_exact_maintenance_route
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
publish_candidate_route
exit 0
