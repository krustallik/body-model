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
[[ "$MODE" == "maintenance" || "$MODE" == "check" || "$MODE" == "v3-postflight" || "$MODE" == "serve" || "$MODE" == "activate-v4-and-serve" ]] || {
  echo "Usage: APP_HOST=... CADDY_ROUTES_PATH=... bash scripts/production-traffic-cutover.sh maintenance|check|v3-postflight|serve|activate-v4-and-serve" >&2
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

capture_pre_ddl_previous_release() {
  [[ "${BODYCAST_CAPTURE_PRE_DDL_RELEASE:-0}" == "1" ]] || return 0
  local target_sha existing_app capture_text provenance_kind previous_sha previous_image_id previous_container_id previous_health previous_runtime_digest pinned_id
  local record_path record_tmp git_dir
  target_sha="${BODYCAST_DEPLOY_SHA:-${DEPLOY_SHA:-}}"
  [[ "$target_sha" =~ ^[a-f0-9]{40}$ ]] || { echo "Pre-DDL recovery capture requires the exact target SHA." >&2; return 1; }
  git_dir="$(git rev-parse --absolute-git-dir)"
  record_path="$git_dir/bodycast-production-pre-ddl-release"
  [[ ! -e "$record_path" && ! -L "$record_path" ]] || {
    echo "An earlier pre-DDL release capture exists; operator review is required before another migration attempt." >&2
    return 1
  }
  existing_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"
  [[ "$existing_app" == "$APP_CONTAINER" ]] || { echo "A healthy prior app is required for recoverable migration preflight." >&2; return 1; }
  if ! capture_text="$(node "$ROOT_DIR/scripts/production-previous-app-provenance.mjs" capture "$target_sha")"; then
    echo "The prior app image/runtime or read-only database migration/schema provenance is not verifiable." >&2
    return 1
  fi
  provenance_kind="$(printf '%s\n' "$capture_text" | sed -n 's/^provenanceKind=//p')"
  previous_sha="$(printf '%s\n' "$capture_text" | sed -n 's/^previousSha=//p')"
  previous_image_id="$(printf '%s\n' "$capture_text" | sed -n 's/^previousImageId=//p')"
  previous_container_id="$(printf '%s\n' "$capture_text" | sed -n 's/^previousContainerId=//p')"
  previous_health="$(printf '%s\n' "$capture_text" | sed -n 's/^previousHealth=//p')"
  previous_runtime_digest="$(printf '%s\n' "$capture_text" | sed -n 's/^previousRuntimeConfigDigest=//p')"
  [[ "$provenance_kind" == "release-sha-v1" && "$previous_sha" =~ ^[a-f0-9]{40}$ \
    || "$provenance_kind" == "legacy-unlabeled-v1" && "$previous_sha" == "unavailable" ]] || {
    echo "The previous app does not satisfy a supported versioned provenance contract." >&2
    return 1
  }
  [[ "$previous_image_id" =~ ^sha256:[a-f0-9]{64}$ && "$previous_container_id" =~ ^[a-f0-9]{64}$ \
    && "$previous_health" == "healthy" && "$previous_runtime_digest" =~ ^[a-f0-9]{64}$ ]] || {
    echo "The prior app immutable image/container, health, or runtime identity is invalid." >&2
    return 1
  }
  if docker image inspect --format '{{.Id}}' bodycast-app:rollback >/dev/null 2>&1; then
    echo "A previous-app image pin already exists and will not be overwritten." >&2
    return 1
  fi
  docker image tag "$previous_image_id" bodycast-app:rollback
  pinned_id="$(docker image inspect --format '{{.Id}}' bodycast-app:rollback)"
  [[ "$pinned_id" == "$previous_image_id" ]] || { echo "Prior-app image pin does not match the captured immutable image." >&2; return 1; }
  record_tmp="$(mktemp "$git_dir/bodycast-production-pre-ddl-release.new.XXXXXX")"
  trap 'rm -f -- "$record_tmp"' RETURN
  chmod 600 "$record_tmp"
  printf '%s\n' "$capture_text" > "$record_tmp"
  sync -f "$record_tmp"
  ln -- "$record_tmp" "$record_path"
  rm -- "$record_tmp"
  sync -f "$git_dir"
  trap - RETURN
  echo "Captured versioned prior-app provenance and read-only pre-DDL database compatibility digests for manual cutback."
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
  if ! bodycast_publish_staged_route "$temporary"; then
    rm -f -- "$temporary"
    echo "Serving-route replacement failed before serving commit." >&2
    return 1
  fi
  # The live rename is the first possible serving effect. Treat success as the
  # commit immediately; subsequent reload/probe failures are observational.
  SERVING_COMMIT_OCCURRED=true
  set +e
  if [[ "$marker_status" -eq 0 ]] && ! clear_bodycast_release_marker; then
    echo "POST-COMMIT CLEANUP WARNING: serving is committed but the release marker remains fail-closed." >&2
  fi
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
  capture_pre_ddl_previous_release
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

activate_v4_and_serve() {
  local expected_release_sha app_release_sha candidate_image_id candidate_image_after marker_status recovery_image_id
  expected_release_sha="${BODYCAST_DEPLOY_SHA:-${DEPLOY_SHA:-}}"
  [[ "$expected_release_sha" =~ ^[a-f0-9]{40}$ ]] || {
    echo "Owner-authorized V4 activation requires a full exact release SHA." >&2
    return 1
  }

  require_ready_release_marker
  [[ "$BODYCAST_MARKER_RELEASE_SHA" == "$expected_release_sha" ]] || {
    echo "V4 activation is blocked because the app-ready marker belongs to another SHA." >&2
    return 1
  }
  bodycast_assert_current_main_sha "$expected_release_sha"
  bodycast_verify_exact_maintenance_route
  local maintenance_marker
  maintenance_marker="$(bodycast_maintenance_marker_from_route)"
  bodycast_probe_public_maintenance "$maintenance_marker"

  # Capture the exact immutable app image before removing its container. It is
  # restarted only from that same image after V4 passes, still behind maintenance.
  candidate_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
  [[ "$candidate_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || {
    echo "The candidate app image identity is not an immutable image digest." >&2
    return 1
  }

  compose --profile tools build migrate
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v3-postflight.mjs --profile-id 1

  # Stop/remove the app so the fixed topology can prove there are no persistent
  # database writers while activation/replay runs. Any failure remains under
  # maintenance with the release marker intact.
  stop_old_app
  bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert
  bash "$ROOT_DIR/scripts/deploy-preflight-schema.sh"

  # Recheck all mutable release/database predicates immediately before V4 DML.
  bodycast_assert_current_main_sha "$expected_release_sha"
  if read_bodycast_release_marker; then
    marker_status=0
  else
    marker_status=$?
  fi
  [[ "$marker_status" -eq 0 \
    && "$BODYCAST_MARKER_RELEASE_SHA" == "$expected_release_sha" \
    && "$BODYCAST_MARKER_STATE" == "app-ready" ]] || {
    echo "V4 activation is blocked by a missing, conflicting, or changed migration/recovery marker." >&2
    return 1
  }
  [[ "$(git rev-parse HEAD)" == "$expected_release_sha" ]] || {
    echo "The checked-out deployed revision differs from the exact V4 release SHA." >&2
    return 1
  }
  candidate_image_after="$(docker image inspect --format '{{.Id}}' bodycast-app:latest)"
  [[ "$candidate_image_after" == "$candidate_image_id" ]] || {
    echo "The immutable deployed app image changed before V4 activation." >&2
    return 1
  }
  bodycast_verify_exact_maintenance_route
  bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert
  bash "$ROOT_DIR/scripts/deploy-preflight-schema.sh"
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v3-postflight.mjs --profile-id 1

  # V3/schema checks are read-only but can take long enough for canonical main
  # to advance. Refresh it as the final gate immediately before V4 DML.
  bodycast_assert_current_main_sha "$expected_release_sha"

  # This fixed owner-authorized execution path holds the global flock from the
  # first V3 check through activation, postflight, app restart, and serving.
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-activate-replay.mjs --activate-v4 --owner-authorized --profile-id 1
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-traffic-check.mjs --profile-id 1

  bodycast_assert_current_main_sha "$expected_release_sha"
  [[ "$(docker image inspect --format '{{.Id}}' bodycast-app:latest)" == "$candidate_image_id" ]] || {
    echo "The immutable candidate image changed after V4 activation." >&2
    return 1
  }
  BODYCAST_DEPLOY_SHA="$expected_release_sha" compose up -d --no-deps --no-build app
  app_release_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
  [[ "$app_release_sha" == "$expected_release_sha" \
    && "$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")" == "$candidate_image_id" \
    && "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")" == "healthy" ]] || {
    echo "Exact candidate image did not return healthy after V4 activation; traffic remains in maintenance." >&2
    return 1
  }
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-traffic-check.mjs --profile-id 1
  bodycast_assert_current_main_sha "$expected_release_sha"
  write_bodycast_release_marker "$expected_release_sha" v4-ready
  marker_status=0
  SERVING_COMMIT_OCCURRED=false
  publish_candidate_route
  if [[ "$SERVING_COMMIT_OCCURRED" == "true" ]]; then
    local recovery_record="$(git rev-parse --absolute-git-dir)/bodycast-production-pre-ddl-release"
    marker_status=1
    if read_bodycast_release_marker; then marker_status=0; else marker_status=$?; fi
    if [[ "$marker_status" -eq 1 && -f "$recovery_record" && ! -L "$recovery_record" ]] \
      && grep -Fqx "targetSha=$expected_release_sha" "$recovery_record"; then
      recovery_image_id="$(sed -n 's/^previousImageId=//p' "$recovery_record")"
      if [[ "$recovery_image_id" =~ ^sha256:[a-f0-9]{64}$ \
        && "$(docker image inspect --format '{{.Id}}' bodycast-app:rollback 2>/dev/null || true)" == "$recovery_image_id" ]]; then
      if docker image rm bodycast-app:rollback >/dev/null 2>&1; then
        rm -f -- "$recovery_record"
        sync -f "$(dirname "$recovery_record")"
      else
        echo "POST-COMMIT CLEANUP WARNING: prior-app recovery pin remains after successful serving commit." >&2
      fi
      fi
    elif [[ "$marker_status" -ne 1 ]]; then
      echo "POST-COMMIT CLEANUP WARNING: keeping the pre-DDL image pin because the release marker remains present or invalid." >&2
    fi
  fi
}

if [[ "$MODE" == "activate-v4-and-serve" ]]; then
  activate_v4_and_serve
  echo "Unified V4 activation/replay, currentness gates, and exact-SHA serve completed under one production lock."
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
    && "$BODYCAST_MARKER_STATE" == "v4-ready" ]] || {
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
