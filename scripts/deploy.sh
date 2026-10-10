#!/usr/bin/env bash
# Exact-SHA production app release. Ordinary deploy is migration-free.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT_DIR"

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly APP_SERVICE="app"
readonly APP_CONTAINER="bodycast-app-prod"
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
source "$ROOT_DIR/scripts/production-release-lock.sh"
bodycast_acquire_production_release_lock
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
[[ "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "APP_HOST is invalid." >&2; exit 1; }

assert_current_main_sha() {
  bodycast_assert_current_main_sha "$DEPLOY_SHA"
}
assert_current_main_sha

source "$ROOT_DIR/scripts/production-route-primitives.sh"
export BODYCAST_DEPLOY_SHA="$DEPLOY_SHA"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

release_state="PREPARE"
maintenance_marker=""
route_stage=""
candidate_image_id=""
candidate_container_id=""
candidate_start_attempted=false
previous_app_present=false
previous_app_sha=""
previous_app_image_id=""
previous_app_container_id=""
previous_app_healthy=false
rollback_image_pinned=false
active_schema_cutover=false

stop_exact_app_container() {
  local expected_sha="$1" expected_image_id="$2" expected_container_id="${3:-}" existing_app app_sha app_image_id app_container_id app_state restart_policy remaining_app
  if ! existing_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"; then
    echo "Docker app listing failed; app presence is UNKNOWN, not absent." >&2
    return 1
  fi
  [[ "$existing_app" == "$APP_CONTAINER" ]] || {
    echo "Expected exact app container is absent or its identity is ambiguous." >&2
    return 1
  }
  app_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
  app_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
  app_container_id="$(docker inspect --format '{{.Id}}' "$APP_CONTAINER")"
  [[ "$app_sha" == "$expected_sha" && "$app_image_id" == "$expected_image_id" \
    && ( -z "$expected_container_id" || "$app_container_id" == "$expected_container_id" ) ]] || {
    echo "App SHA/image/container identity changed; refusing to stop an unverified container." >&2
    return 1
  }
  docker update --restart=no "$APP_CONTAINER" >/dev/null
  if ! compose stop "$APP_SERVICE" >/dev/null 2>&1; then
    docker stop --time 0 "$APP_CONTAINER" >/dev/null
  fi
  app_state="$(docker inspect --format '{{.State.Status}}' "$APP_CONTAINER")"
  restart_policy="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$APP_CONTAINER")"
  [[ "$app_state" == "exited" && "$restart_policy" == "no" ]] || {
    echo "Exact app container did not stop with automatic restart disabled." >&2
    return 1
  }
  compose rm --force "$APP_SERVICE" >/dev/null
  if ! remaining_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"; then
    echo "Final Docker app listing failed; app presence is UNKNOWN, not absent." >&2
    return 1
  fi
  [[ -z "$remaining_app" ]] || { echo "App container remains after removal." >&2; return 1; }
}

stop_candidate_fail_closed() {
  local existing_app app_sha app_image_id
  if ! existing_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"; then
    echo "Candidate cleanup blocked: Docker app presence is UNKNOWN." >&2
    return 1
  fi
  [[ -n "$existing_app" ]] || return 0
  [[ "$existing_app" == "$APP_CONTAINER" ]] || { echo "Candidate cleanup blocked: app identity is ambiguous." >&2; return 1; }
  [[ "$candidate_container_id" =~ ^[a-f0-9]{64}$ ]] || { echo "Candidate cleanup blocked: same-attempt container identity is unavailable." >&2; return 1; }
  if ! app_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")" \
      || ! app_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"; then
    echo "Candidate cleanup blocked: app identity is UNKNOWN." >&2
    return 1
  fi
  if [[ "$app_sha" != "$DEPLOY_SHA" || "$app_image_id" != "$candidate_image_id" ]]; then
    echo "Candidate cleanup blocked: the present app is not the exact candidate; maintenance remains active." >&2
    return 1
  fi
  stop_exact_app_container "$DEPLOY_SHA" "$candidate_image_id" "$candidate_container_id"
}

release_failure() {
  local exit_code=$?
  if [[ $# -gt 0 ]]; then exit_code="$1"; fi
  trap - ERR
  set +e
  if [[ "$release_state" == "COMMITTED" ]]; then
    echo "A post-commit command failed; the committed release was left untouched." >&2
    exit 0
  fi
  if [[ -n "$route_stage" && -f "$route_stage" ]]; then rm -f -- "$route_stage"; fi
  if [[ "$release_state" == "PREPARE" ]]; then
    echo "Deploy failed before maintenance was confirmed; the previous app was not stopped or replaced." >&2
  else
    echo "Deploy failed before serving commit; traffic remains in maintenance." >&2
    if [[ "$candidate_start_attempted" == "true" ]]; then
      if ! stop_candidate_fail_closed; then
        echo "Candidate could not be safely removed; operator intervention is required." >&2
      fi
    fi
    if [[ "$rollback_image_pinned" == "true" ]]; then
      echo "Captured prior release ${previous_app_sha} / ${previous_app_image_id} remains pinned for operator recovery." >&2
    fi
    if [[ "$previous_app_healthy" == "true" ]]; then
      echo "Automatic prior-app restoration is disabled because this attempt has no proof of the exact prior runtime configuration." >&2
    fi
  fi
  exit "$exit_code"
}
trap release_failure ERR

read_release_marker() {
  if read_bodycast_release_marker; then return 0; else return $?; fi
}

assert_existing_db_healthy() {
  local db_status
  if ! db_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER")"; then
    echo "Existing production database is unavailable; deploy will not start it." >&2
    return 1
  fi
  [[ "$db_status" == "healthy" ]] || {
    echo "Existing production database is not healthy (state: ${db_status}); deploy will not start it." >&2
    return 1
  }
}

run_v4_traffic_check() {
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-traffic-check.mjs --profile-id 1
}

publish_and_confirm_maintenance() {
  local stage reload_failed=false
  maintenance_marker="$(bodycast_new_maintenance_marker)"
  bodycast_stage_maintenance_route_config "$maintenance_marker"
  stage="$BODYCAST_ROUTE_STAGE_PATH"
  if ! bodycast_assert_safe_routes_location; then rm -f -- "$stage"; return 1; fi
  if ! mv -f -- "$stage" "${CADDY_ROUTES_PATH%/}/bodycast.caddy"; then
    rm -f -- "$stage"
    echo "Maintenance route replacement failed; the old app remains untouched." >&2
    return 1
  fi
  if ! docker exec gymbeam-caddy caddy reload \
    --address unix//run/caddy-admin/admin.sock \
    --config /etc/caddy/Caddyfile; then
    reload_failed=true
  fi
  if ! bodycast_probe_public_maintenance "$maintenance_marker"; then
    if [[ "$reload_failed" == "true" ]]; then
      echo "Maintenance was not externally confirmed and Caddy reload also failed; old app remains untouched." >&2
    else
      echo "Maintenance was not externally confirmed; old app remains untouched." >&2
    fi
    return 1
  fi
  if [[ "$reload_failed" == "true" ]]; then
    echo "Caddy reload failed, but the exact per-attempt public maintenance response confirms traffic is closed." >&2
  fi
  release_state="MAINTENANCE_CONFIRMED"
}

capture_previous_release() {
  local existing_app app_status pinned_image_id
  if ! existing_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"; then
    echo "Docker app listing failed; previous app presence is UNKNOWN, not absent." >&2
    return 1
  fi
  if [[ -z "$existing_app" ]]; then
    previous_app_present=false
    release_state="PREVIOUS_RELEASE_CAPTURED"
    echo "No previous app exists; this first release has no automatic rollback target."
    return 0
  fi
  [[ "$existing_app" == "$APP_CONTAINER" ]] || { echo "Previous app identity is ambiguous." >&2; return 1; }
  previous_app_container_id="$(docker inspect --format '{{.Id}}' "$APP_CONTAINER")"
  previous_app_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
  previous_app_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
  app_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")"
  [[ "$previous_app_container_id" =~ ^[a-f0-9]{64}$ \
    && "$previous_app_sha" =~ ^[a-f0-9]{40}$ \
    && "$previous_app_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || {
    echo "Previous app SHA, container, or immutable image identity is unavailable." >&2
    return 1
  }
  previous_app_present=true
  if [[ "$app_status" == "healthy" ]]; then
    previous_app_healthy=true
    docker image tag "$previous_app_image_id" "$ROLLBACK_IMAGE"
    pinned_image_id="$(docker image inspect --format '{{.Id}}' "$ROLLBACK_IMAGE")"
    [[ "$pinned_image_id" == "$previous_app_image_id" ]] || {
      echo "Pinned rollback image does not match the captured immutable image ID." >&2
      return 1
    }
    rollback_image_pinned=true
  fi
  release_state="PREVIOUS_RELEASE_CAPTURED"
  echo "Captured previous app SHA=${previous_app_sha}, container=${previous_app_container_id}, image=${previous_app_image_id}, health=${app_status}."
}

echo "Preparing exact release ${DEPLOY_SHA}; ordinary deploy does not mutate the database."
assert_current_main_sha

marker_status=1
if read_release_marker; then marker_status=0; else marker_status=$?; fi
if [[ "$BODYCAST_NON_SERVING_DEPLOY" == "1" && "$marker_status" -eq 0 \
  && "$BODYCAST_MARKER_RELEASE_SHA" != "$DEPLOY_SHA" \
  && ( \
    ( "$BODYCAST_MARKER_SCHEMA_VERSION" == 2 && "$BODYCAST_MARKER_STATE" == "schema-applied" ) \
    || ( "$BODYCAST_MARKER_SCHEMA_VERSION" == 3 \
      && ( "$BODYCAST_MARKER_STATE" == "schema-applied" || "$BODYCAST_MARKER_STATE" == "app-ready" ) ) \
  ) ]]; then
  node "$ROOT_DIR/scripts/production-schema-deploy-handoff.mjs" --check \
    "$BODYCAST_MARKER_FILE_PATH" "$DEPLOY_SHA" "$ROOT_DIR"
  bash "$ROOT_DIR/scripts/deploy-preflight-schema.sh"
  node "$ROOT_DIR/scripts/production-schema-deploy-handoff.mjs" --apply \
    "$BODYCAST_MARKER_FILE_PATH" "$DEPLOY_SHA" "$ROOT_DIR"
  if read_release_marker; then marker_status=0; else marker_status=$?; fi
fi
if [[ "$marker_status" -eq 0 ]]; then
  [[ "$BODYCAST_MARKER_RELEASE_SHA" == "$DEPLOY_SHA" \
    && ( "$BODYCAST_MARKER_STATE" == "schema-applied" || "$BODYCAST_MARKER_STATE" == "app-ready" ) ]] || {
    echo "Deployment SHA/state does not match the pending production schema-cutover marker; refusing app start." >&2
    release_failure 1
  }
  [[ "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]] || {
    echo "A schema-cutover marker requires an exact-SHA non-serving deployment first." >&2
    release_failure 1
  }
  active_schema_cutover=true
elif [[ "$marker_status" -ne 1 ]]; then
  echo "Invalid production release marker; refusing deployment." >&2
  release_failure 1
fi
if [[ "$BODYCAST_NON_SERVING_DEPLOY" == "1" && "$marker_status" -ne 0 ]]; then
  echo "A non-serving app deploy requires the exact-SHA schema-applied marker; the candidate will not start on the old schema." >&2
  release_failure 1
fi

compose config --quiet
assert_existing_db_healthy
bash "${ROOT_DIR}/scripts/deploy-preflight-schema.sh"
compose --profile tools build migrate
if [[ "$BODYCAST_NON_SERVING_DEPLOY" == "0" ]]; then
  run_v4_traffic_check
fi
compose build "$APP_SERVICE"
candidate_image_id="$(docker image inspect --format '{{.Id}}' "$CURRENT_IMAGE")"
[[ "$candidate_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  echo "Built candidate image does not have an immutable image ID." >&2
  release_failure 1
}

if [[ "$BODYCAST_NON_SERVING_DEPLOY" == "0" ]]; then
  bodycast_stage_serving_route_config
  route_stage="$BODYCAST_ROUTE_STAGE_PATH"
fi

# Maintenance is externally proven before prior-release capture or any app stop.
publish_and_confirm_maintenance
capture_previous_release

if [[ "$previous_app_present" == "true" ]]; then
  stop_exact_app_container "$previous_app_sha" "$previous_app_image_id" "$previous_app_container_id"
fi

# DB is deliberately excluded from this exact-SHA app-only replacement.
candidate_start_attempted=true
assert_current_main_sha
BODYCAST_DEPLOY_SHA="$DEPLOY_SHA" compose up -d --no-deps --force-recreate "$APP_SERVICE"
candidate_container_id="$(docker inspect --format '{{.Id}}' "$APP_CONTAINER")"
[[ "$candidate_container_id" =~ ^[a-f0-9]{64}$ ]] || { echo "Candidate container identity is unavailable." >&2; release_failure 1; }

candidate_healthy=false
for attempt in $(seq 1 30); do
  app_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER")"
  if [[ "$app_status" == "healthy" ]]; then candidate_healthy=true; break; fi
  if [[ "$app_status" == "unhealthy" || "$app_status" == "exited" ]]; then
    compose logs --tail=100 "$APP_SERVICE"
    release_failure 1
  fi
  [[ "$attempt" == "30" ]] && { echo "Application healthcheck timed out." >&2; release_failure 1; }
  sleep 5
done
[[ "$candidate_healthy" == "true" ]] || { echo "Candidate app did not become healthy." >&2; release_failure 1; }

docker exec "$APP_CONTAINER" wget --quiet --tries=1 --output-document=- \
  http://127.0.0.1:3000/api/health | grep -q '"status":"ok"'

deployed_container_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER")"
[[ "$deployed_container_sha" == "$DEPLOY_SHA" ]] || {
  echo "Running app container release label does not match the authorized exact SHA." >&2
  release_failure 1
}
deployed_container_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
[[ "$deployed_container_image_id" == "$candidate_image_id" ]] || {
  echo "Running app container image ID does not match the immutable built candidate image." >&2
  release_failure 1
}

if [[ "$active_schema_cutover" == "true" ]]; then
  release_state="CANDIDATE_VERIFIED"
  assert_current_main_sha
  write_bodycast_release_marker "$DEPLOY_SHA" app-ready
  echo "Exact SHA is deployed in confirmed maintenance; explicit V4 activation/replay and traffic check remain separate."
  exit 0
fi
if [[ "$BODYCAST_NON_SERVING_DEPLOY" == "1" ]]; then
  release_state="CANDIDATE_VERIFIED"
  echo "Exact SHA is deployed in confirmed maintenance; serving commit was explicitly skipped."
  exit 0
fi

# All fatal correctness checks precede the only potentially serving mutation.
assert_existing_db_healthy
bash "${ROOT_DIR}/scripts/deploy-preflight-schema.sh"
run_v4_traffic_check
marker_status=1
if read_release_marker; then marker_status=0; else marker_status=$?; fi
[[ "$marker_status" -eq 1 ]] || { echo "A release/recovery marker blocks ordinary serving." >&2; release_failure 1; }
bodycast_assert_safe_routes_location
[[ -f "$route_stage" && ! -L "$route_stage" ]] || { echo "Validated candidate route stage is missing or unsafe." >&2; release_failure 1; }
docker exec -i gymbeam-caddy caddy validate --adapter caddyfile --config - < "$route_stage"
assert_current_main_sha
bodycast_assert_safe_routes_location
[[ -f "$route_stage" && ! -L "$route_stage" ]] || { echo "Validated candidate route stage is missing or unsafe." >&2; release_failure 1; }

release_state="CANDIDATE_VERIFIED"
release_state="SERVING_COMMIT"
if ! mv -f -- "$route_stage" "${CADDY_ROUTES_PATH%/}/bodycast.caddy"; then
  echo "Serving route replacement failed before commit; traffic remains in maintenance." >&2
  release_failure 1
fi
release_state="COMMITTED"
route_stage=""
trap - ERR
set +e
echo "SERVING_COMMIT: exact candidate route replacement completed; release state is COMMITTED."

# Everything below is observational or cleanup. No failure can roll back the
# route or candidate after the live route replacement.
if ! docker exec gymbeam-caddy caddy reload \
  --address unix//run/caddy-admin/admin.sock \
  --config /etc/caddy/Caddyfile; then
  echo "POST-COMMIT VERIFICATION WARNING: explicit Caddy reload failed; committed route was not rolled back." >&2
fi
if ! bodycast_probe_public_candidate_observational; then
  echo "POST-COMMIT VERIFICATION WARNING: public APP_HOST health probe did not confirm HTTP 200; committed release was left untouched." >&2
fi
if [[ "$rollback_image_pinned" == "true" ]] && ! docker image rm "$ROLLBACK_IMAGE" >/dev/null 2>&1; then
  echo "POST-COMMIT CLEANUP WARNING: prior image pin could not be removed." >&2
fi
echo "BodyCast deployment completed for ${DEPLOY_SHA}; serving commit is ${release_state}."
echo "DEPLOYED_SHA=${DEPLOY_SHA}"
exit 0
