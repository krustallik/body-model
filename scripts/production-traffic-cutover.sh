#!/usr/bin/env bash
# Maintenance/serving route gate for the Forecast V2 + Unified V4 release.
set -Eeuo pipefail

MODE="${1:-}"
bodycast_v4_cutover_phase="arguments"
report_bodycast_v4_cutover_failure() {
  local status=$?
  if [[ "$MODE" == "v4-post-ddl-backup" ]] && (( status != 0 )); then
    printf 'BODYCAST_V4_CUTOVER_FAILURE phase=%s status=%s\n' "$bodycast_v4_cutover_phase" "$status" >&2
  fi
}
if [[ "$MODE" == "v4-post-ddl-backup" ]]; then trap report_bodycast_v4_cutover_failure EXIT; fi
ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT_DIR"

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly APP_CONTAINER="bodycast-app-prod"
readonly DB_CONTAINER="bodycast-db-prod"
readonly APP_HOST="${APP_HOST:?APP_HOST is required}"
CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:?CADDY_ROUTES_PATH is required}"
bodycast_v4_cutover_phase="route-setup"
source "${ROOT_DIR}/scripts/production-route-path.sh"
bodycast_canonicalize_routes_path || exit 1
readonly CADDY_ROUTES_PATH
export APP_HOST CADDY_ROUTES_PATH
bodycast_v4_cutover_phase="release-lock-setup"
source "${ROOT_DIR}/scripts/production-release-marker.sh"
source "${ROOT_DIR}/scripts/deploy-main-freshness.sh"
source "${ROOT_DIR}/scripts/production-release-lock.sh"
source "${ROOT_DIR}/scripts/production-v4-recovered-release.sh"

bodycast_v4_cutover_phase="app-host-validation"
[[ "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "APP_HOST is invalid." >&2; exit 1; }
bodycast_v4_cutover_phase="mode-validation"
[[ "$MODE" == "maintenance" || "$MODE" == "check" || "$MODE" == "v3-postflight" || "$MODE" == "full-history-recalculate" || "$MODE" == "serve" || "$MODE" == "activate-v4-and-serve" || "$MODE" == "v4-post-ddl-backup" ]] || {
  echo "Usage: APP_HOST=... CADDY_ROUTES_PATH=... bash scripts/production-traffic-cutover.sh maintenance|check|v3-postflight|full-history-recalculate|serve|activate-v4-and-serve|v4-post-ddl-backup" >&2
  exit 1
}

bodycast_v4_cutover_phase="release-lock"
bodycast_acquire_production_release_lock
bodycast_v4_cutover_phase="route-primitives"
source "${ROOT_DIR}/scripts/production-route-primitives.sh"

if [[ "$MODE" == "v4-post-ddl-backup" ]]; then
  bodycast_v4_cutover_phase="backup-host"
  if BODYCAST_PRODUCTION_RELEASE_LOCK_HELD=1 bash "$ROOT_DIR/scripts/production-v4-post-ddl-backup-host.sh"; then
    exit 0
  else
    cutover_status=$?
    exit "$cutover_status"
  fi
fi

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
  if [[ -e "$record_path" || -L "$record_path" ]]; then
    if [[ "${BODYCAST_REFRESH_PRE_DDL_CAPTURE:-0}" == "1" ]]; then
      refresh_pre_ddl_previous_release "$target_sha" "$record_path" "$git_dir"
      return
    fi
    [[ "${BODYCAST_RESUME_PRE_DDL_CAPTURE:-0}" == "1" ]] || {
      echo "An earlier pre-DDL release capture exists; operator review is required before another migration attempt." >&2
      return 1
    }
    resume_pre_ddl_previous_release "$target_sha" "$record_path" "$git_dir"
    return
  fi
  [[ "${BODYCAST_REFRESH_PRE_DDL_CAPTURE:-0}" != "1" ]] || {
    echo "Fresh capture refresh was requested but no earlier capture exists to preserve." >&2
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
    || "$provenance_kind" =~ ^legacy-(unlabeled|cutback-receipt)-v1$ && "$previous_sha" == "unavailable" ]] || {
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

refresh_pre_ddl_previous_release() {
  local target_sha="$1" record_path="$2" git_dir="$3"
  local current_run_id current_attempt marker_status maintenance_marker existing_app app_status old_meta old_pin old_image archive_path
  local capture_text capture_meta new_pin new_image pin_id record_tmp canonical_record
  current_run_id="${BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ID:-}"
  current_attempt="${BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ATTEMPT:-}"
  [[ "$current_run_id" =~ ^[1-9][0-9]*$ && "$current_attempt" =~ ^[1-9][0-9]*$ ]] || {
    echo "Fresh capture refresh lacks the trusted current workflow run identity." >&2; return 1;
  }
  bodycast_assert_current_main_sha "$target_sha" || return 1
  marker_status=1
  if read_bodycast_release_marker; then marker_status=0; else marker_status=$?; fi
  [[ "$marker_status" -eq 1 ]] || { echo "A release marker is present or unreadable; fresh capture refresh is blocked." >&2; return 1; }
  bodycast_verify_exact_maintenance_route || return 1
  maintenance_marker="$(bodycast_maintenance_marker_from_route)" || return 1
  bodycast_probe_public_maintenance "$maintenance_marker" || return 1
  [[ -f "$record_path" && ! -L "$record_path" ]] || { echo "The existing previous-app capture is not a regular file." >&2; return 1; }
  old_meta="$(cat -- "$record_path" | node "$ROOT_DIR/scripts/production-previous-app-provenance.mjs" --verify-record)" || {
    echo "The existing previous-app capture is invalid and cannot be safely archived." >&2; return 1;
  }
  old_pin="$(printf '%s' "$old_meta" | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; process.stdout.write(JSON.parse(s).previousImagePin)')"
  old_image="$(printf '%s' "$old_meta" | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; process.stdout.write(JSON.parse(s).previousImageId)')"
  [[ "$(docker image inspect --format '{{.Id}}' "$old_pin" 2>/dev/null || true)" == "$old_image" ]] || {
    echo "The existing capture's immutable prior-app image pin is unavailable or mismatched; refresh is blocked." >&2; return 1;
  }
  if ! existing_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"; then
    echo "Docker app listing failed; the current app identity is UNKNOWN." >&2; return 1;
  fi
  [[ "$existing_app" == "$APP_CONTAINER" ]] || { echo "Capture refresh requires exactly one existing BodyCast app container." >&2; return 1; }
  if ! app_status="$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$APP_CONTAINER")"; then
    echo "Docker app state inspection failed; capture refresh is blocked." >&2; return 1;
  fi
  [[ "$app_status" == "running|healthy" ]] || { echo "Capture refresh requires the current app to be running and healthy." >&2; return 1; }

  new_pin="bodycast-app:rollback-preflight-${current_run_id}-${current_attempt}"
  capture_text="$(node "$ROOT_DIR/scripts/production-previous-app-provenance.mjs" capture "$target_sha" "$new_pin")" || {
    echo "The current app or read-only database compatibility snapshot could not be captured." >&2; return 1;
  }
  capture_meta="$(printf '%s\n' "$capture_text" | node "$ROOT_DIR/scripts/production-previous-app-provenance.mjs" --verify-record)" || {
    echo "The refreshed previous-app capture failed its closed-schema validation." >&2; return 1;
  }
  new_image="$(printf '%s' "$capture_meta" | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; const r=JSON.parse(s); if(r.targetSha!==process.argv[1]||r.previousImagePin!==process.argv[2]||r.schemaVersion!==3) process.exit(2); process.stdout.write(r.previousImageId)' "$target_sha" "$new_pin")" || {
    echo "The refreshed capture is not bound to the exact target SHA and attempt-specific pin." >&2; return 1;
  }
  archive_path="$git_dir/bodycast-production-pre-ddl-release-archive-${current_run_id}-${current_attempt}"
  if [[ -e "$archive_path" || -L "$archive_path" ]]; then
    [[ -f "$archive_path" && ! -L "$archive_path" ]] || { echo "The attempt-specific capture archive is not a regular file." >&2; return 1; }
    cmp -s -- "$record_path" "$archive_path" || { echo "The attempt-specific capture archive already contains different bytes." >&2; return 1; }
  else
    ln -- "$record_path" "$archive_path" || { echo "Could not preserve the existing capture without overwriting an archive." >&2; return 1; }
    sync -f "$git_dir"
  fi
  [[ "$(docker image inspect --format '{{.Id}}' "$new_pin" 2>/dev/null || true)" == "" ]] || {
    pin_id="$(docker image inspect --format '{{.Id}}' "$new_pin" 2>/dev/null || true)"
    [[ "$pin_id" == "$new_image" ]] || { echo "The attempt-specific image pin already names a different image." >&2; return 1; }
  }
  if [[ "$(docker image inspect --format '{{.Id}}' "$new_pin" 2>/dev/null || true)" == "" ]]; then
    docker image tag "$new_image" "$new_pin" || { echo "Could not create the attempt-specific immutable previous-app image pin." >&2; return 1; }
  fi
  pin_id="$(docker image inspect --format '{{.Id}}' "$new_pin")" || { echo "The refreshed image pin is unreadable." >&2; return 1; }
  [[ "$pin_id" == "$new_image" ]] || { echo "The refreshed image pin does not match the captured immutable image." >&2; return 1; }
  record_tmp="$(mktemp "$git_dir/bodycast-production-pre-ddl-release.new.XXXXXX")"
  trap 'rm -f -- "$record_tmp"' RETURN
  chmod 600 "$record_tmp"
  printf '%s\n' "$capture_text" > "$record_tmp"
  sync -f "$record_tmp"
  bodycast_assert_current_main_sha "$target_sha" || return 1
  mv -fT -- "$record_tmp" "$record_path"
  sync -f "$git_dir"
  trap - RETURN
  canonical_record="$(cat -- "$record_path")"
  [[ "$canonical_record" == "$capture_text" ]] || { echo "The durable refreshed capture differs from the verified record." >&2; return 1; }
  [[ "$(docker image inspect --format '{{.Id}}' "$new_pin")" == "$new_image" ]] || { echo "The refreshed image pin changed after the capture was committed." >&2; return 1; }
  printf '%s\n' "$capture_text" | node "$ROOT_DIR/scripts/production-previous-app-provenance.mjs" --verify-live-container || return 1
  echo "Preserved the prior capture and image pin, durably refreshed current-app provenance, and verified the exact live app before stop."
}

resume_pre_ddl_previous_release() {
  local target_sha="$1" record_path="$2" git_dir="$3"
  local source_sha source_run_id source_attempt current_run_id current_attempt source_target previous_image_id previous_image_pin record_verification pinned_id marker_status existing_app archive_path source_record_text resume_json rebound_record receipt_json receipt_path receipt_tmp record_tmp current_record forward_resume=false expected_marker_digest marker_digest failed_run_id failed_sha failure_proof_digest
  failed_run_id=""; failed_sha=""; failure_proof_digest=""; expected_marker_digest=""
  source_sha="${BODYCAST_PRE_DDL_CAPTURE_SOURCE_SHA:-}"
  source_run_id="${BODYCAST_PRE_DDL_CAPTURE_SOURCE_RUN_ID:-}"
  source_attempt="${BODYCAST_PRE_DDL_CAPTURE_SOURCE_RUN_ATTEMPT:-}"
  current_run_id="${BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ID:-}"
  current_attempt="${BODYCAST_PRE_DDL_CAPTURE_CURRENT_RUN_ATTEMPT:-}"
  [[ "$source_sha" =~ ^[a-f0-9]{40}$ && "$source_run_id" =~ ^[1-9][0-9]*$ && "$source_attempt" =~ ^[1-9][0-9]*$ \
    && "$current_run_id" =~ ^[1-9][0-9]*$ && "$current_attempt" =~ ^[1-9][0-9]*$ ]] || {
    echo "Preflight capture resume lacks verified source-run identity." >&2; return 1;
  }
  git merge-base --is-ancestor "$source_sha" "$target_sha" || {
    echo "The prior failed preflight SHA is not an ancestor of the current release SHA." >&2; return 1;
  }
  bodycast_assert_current_main_sha "$target_sha" || return 1
  if [[ "${BODYCAST_FORWARD_RESUME_CAPTURE:-0}" == "1" ]]; then
    forward_resume=true
    failed_run_id="${BODYCAST_FORWARD_RESUME_FAILED_RUN_ID:-}"
    failed_sha="${BODYCAST_FORWARD_RESUME_FAILED_SHA:-}"
    failure_proof_digest="${BODYCAST_FORWARD_RESUME_FAILURE_PROOF_DIGEST:-}"
    expected_marker_digest="${BODYCAST_FORWARD_RESUME_MARKER_DIGEST:-}"
    if ! read_bodycast_release_marker; then
      echo "The expected verified pre-spawn marker is missing or invalid; forward capture resume is blocked." >&2
      return 1
    fi
    marker_digest="$(sha256sum "$BODYCAST_MARKER_FILE_PATH" | awk '{print $1}')"
    [[ ( "$failed_run_id" == "38022978032" || "$failed_run_id" == "38062632284" ) && "$failed_sha" == "$source_sha" \
      && "$failure_proof_digest" =~ ^[a-f0-9]{64}$ && "$expected_marker_digest" =~ ^[a-f0-9]{64}$ \
      && "$marker_digest" == "$expected_marker_digest" && "$BODYCAST_MARKER_RELEASE_SHA" == "$failed_sha" \
      && ( ( "$failed_run_id" == "38022978032" && "$BODYCAST_MARKER_SCHEMA_VERSION" == 1 \
        && "$BODYCAST_MARKER_STATE" == "ddl-started" ) \
        || ( "$failed_run_id" == "38062632284" && "$BODYCAST_MARKER_SCHEMA_VERSION" == 2 \
          && "$BODYCAST_MARKER_STATE" == "forward-resume-armed" && "$BODYCAST_MARKER_WORKFLOW_RUN_ID" == "$failed_run_id" \
          && "$BODYCAST_MARKER_WORKFLOW_RUN_ATTEMPT" == 1 && "$BODYCAST_MARKER_SPAWN_STATE" == "not-started" ) ) ]] || {
      echo "The marker does not match the independently verified no-spawn failure and source digest." >&2
      return 1
    }
  elif read_bodycast_release_marker; then
    echo "A production release marker exists; ordinary preflight capture resume is blocked." >&2
    return 1
  else
    marker_status=$?
    [[ "$marker_status" -eq 1 ]] || { echo "Production marker state is unknown; capture resume is blocked." >&2; return 1; }
  fi
  if ! existing_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"; then
    echo "Docker app listing failed; previous-app state is UNKNOWN." >&2; return 1;
  fi
  [[ -z "$existing_app" ]] || { echo "A BodyCast app container exists; preflight capture resume is blocked." >&2; return 1; }
  bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert || {
    echo "A complete production writer drain is required before resuming the prior-app capture." >&2; return 1;
  }
  [[ -f "$record_path" && ! -L "$record_path" ]] || { echo "The saved previous-app capture is not a regular file." >&2; return 1; }
  source_target="$(sed -n 's/^targetSha=//p' "$record_path")"
  archive_path="$git_dir/bodycast-production-pre-ddl-release-before-$target_sha"
  if [[ "$source_target" == "$source_sha" ]]; then
    source_record_text="$(cat -- "$record_path")"
    if [[ -e "$archive_path" || -L "$archive_path" ]]; then
      [[ -f "$archive_path" && ! -L "$archive_path" ]] || { echo "An earlier capture archive is not a regular file." >&2; return 1; }
      cmp -s -- "$record_path" "$archive_path" || { echo "An earlier capture archive differs from the canonical preflight record." >&2; return 1; }
    fi
  elif [[ "$source_target" == "$target_sha" && "$source_sha" != "$target_sha" ]]; then
    [[ -f "$archive_path" && ! -L "$archive_path" ]] || { echo "The original capture archive required for resume is missing." >&2; return 1; }
    source_record_text="$(cat -- "$archive_path")"
  elif [[ "$source_target" == "$target_sha" && "$source_sha" == "$target_sha" ]]; then
    source_record_text="$(cat -- "$record_path")"
  else
    echo "The durable previous-app capture belongs to neither the verified source nor the exact target SHA." >&2
    return 1
  fi
  previous_image_id="$(printf '%s\n' "$source_record_text" | sed -n 's/^previousImageId=//p')"
  [[ "$previous_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "Saved immutable prior-app image identity is malformed." >&2; return 1; }
  if ! record_verification="$(printf '%s\n' "$source_record_text" | node "$ROOT_DIR/scripts/production-previous-app-provenance.mjs" --verify-record)"; then
    echo "Saved previous-app capture is invalid; capture resume is blocked." >&2; return 1;
  fi
  previous_image_pin="$(printf '%s' "$record_verification" | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; const r=JSON.parse(s); process.stdout.write(r.previousImagePin)')"
  [[ "$previous_image_pin" == "bodycast-app:rollback" \
    || "$previous_image_pin" =~ ^bodycast-app:rollback-preflight-[1-9][0-9]*-[1-9][0-9]*$ ]] || {
    echo "Saved previous-app capture has no supported immutable image pin." >&2; return 1;
  }
  if ! pinned_id="$(docker image inspect --format '{{.Id}}' "$previous_image_pin")"; then
    echo "The pinned previous-app image is unavailable; capture resume is blocked." >&2; return 1;
  fi
  [[ "$pinned_id" == "$previous_image_id" ]] || { echo "The attempt-bound previous-app image pin differs from the captured immutable image." >&2; return 1; }
  if ! resume_json="$(printf '%s\n' "$source_record_text" | node "$ROOT_DIR/scripts/production-previous-app-provenance.mjs" \
    --resume-capture "$source_sha" "$target_sha" "$source_run_id" "$source_attempt")"; then
    echo "Fresh production DB compatibility does not match the durable previous-app capture." >&2
    return 1
  fi
  rebound_record="$(printf '%s' "$resume_json" | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; const r=JSON.parse(s); process.stdout.write(r.recordText)')"
  receipt_json="$(printf '%s' "$resume_json" | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; const r=JSON.parse(s); process.stdout.write(JSON.stringify(r.receipt))')"
  receipt_json="$(printf '%s' "$receipt_json" | node "$ROOT_DIR/scripts/production-capture-resume-receipt.mjs" --produce \
    "$source_run_id" "$source_attempt" "$source_sha" "$target_sha" "$current_run_id" "$current_attempt" \
    "$failed_run_id" "$failed_sha" "$failure_proof_digest" "$expected_marker_digest")"
  receipt_path="$git_dir/bodycast-production-pre-ddl-release-resume-$current_run_id-$current_attempt"
  [[ ! -e "$receipt_path" && ! -L "$receipt_path" ]] || { echo "A receipt already exists for this exact preflight attempt." >&2; return 1; }
  if [[ "$source_target" != "$target_sha" ]]; then
    if [[ ! -e "$archive_path" && ! -L "$archive_path" ]]; then
      ln -- "$record_path" "$archive_path"
      sync -f "$git_dir"
    fi
    cmp -s -- "$record_path" "$archive_path" || { echo "The original preflight capture archive does not match the canonical record." >&2; return 1; }
    record_tmp="$(mktemp "$git_dir/bodycast-production-pre-ddl-release.new.XXXXXX")"
    trap 'rm -f -- "$record_tmp"' RETURN
    chmod 600 "$record_tmp"
    printf '%s\n' "$rebound_record" > "$record_tmp"
    sync -f "$record_tmp"
    mv -f -- "$record_tmp" "$record_path"
    sync -f "$git_dir"
    trap - RETURN
  else
    current_record="$(cat -- "$record_path")"
    [[ "$current_record" == "$rebound_record" ]] || { echo "The current capture record differs from the verified resume result." >&2; return 1; }
  fi
  receipt_tmp="$(mktemp "$git_dir/bodycast-production-pre-ddl-release-resume.new.XXXXXX")"
  trap 'rm -f -- "$receipt_tmp"' RETURN
  chmod 600 "$receipt_tmp"
  printf '%s\n' "$receipt_json" > "$receipt_tmp"
  sync -f "$receipt_tmp"
  ln -- "$receipt_tmp" "$receipt_path"
  rm -- "$receipt_tmp"
  sync -f "$git_dir"
  trap - RETURN
  printf 'BODYCAST_PRE_DDL_RESUME_RECEIPT=%s\n' "$(printf '%s' "$receipt_json" | base64 -w0)"
  echo "Verified and rebound the durable previous-app capture after matching fresh DB identity, migration history, schema, image pin, maintenance, and writer drain."
}

publish_candidate_route() {
  local temporary marker reload_failed=false reload_unknown=false route_file maintenance_backup marker_status require_absent_marker
  local expected_marker_sha="${1:-}" expected_marker_digest="${2:-}" expected_marker_state="${3:-v4-ready}"
  local staged_route="${4:-}" main_sha_already_refreshed="${5:-false}"
  local fence_pid="${6:-}" defer_fence_finalize="${7:-false}"
  require_absent_marker="${8:-false}"
  marker="$(bodycast_maintenance_marker_from_route)" || return 1
  bodycast_verify_exact_maintenance_route || return 1
  if [[ -n "$staged_route" ]]; then
    [[ "$staged_route" == "${BODYCAST_ROUTE_STAGE_PATH:-}" && -f "$staged_route" && ! -L "$staged_route" ]] || {
      echo "Prevalidated serving route staging path changed before publication." >&2
      return 1
    }
    temporary="$staged_route"
  else
    bodycast_stage_serving_route_config || return 1
    temporary="$BODYCAST_ROUTE_STAGE_PATH"
  fi
  bodycast_probe_public_maintenance "$marker" || { rm -f -- "$temporary"; return 1; }
  # Staged bytes are validated before the final canonical-main fence. No route
  # mutation occurs unless this mode's required exact SHA remains current.
  if [[ "$main_sha_already_refreshed" == "true" ]]; then
    local cached_main_sha
    cached_main_sha="$(git rev-parse --verify 'refs/remotes/origin/main^{commit}')" || {
      rm -f -- "$temporary"
      echo "Canonical origin/main is unavailable after its bounded refresh." >&2
      return 1
    }
    if [[ "$cached_main_sha" != "$expected_release_sha" ]]; then
      rm -f -- "$temporary"
      echo "Refusing stale release SHA after the fenced currentness check." >&2
      return 1
    fi
  elif ! bodycast_assert_current_main_sha "$expected_release_sha"; then
    rm -f -- "$temporary"
    return 1
  fi
  if ! bodycast_assert_safe_routes_location; then
    rm -f -- "$temporary"
    return 1
  fi
  route_file="${CADDY_ROUTES_PATH%/}/bodycast.caddy"
  if [[ "$require_absent_marker" == "true" ]]; then
    if read_bodycast_release_marker; then
      rm -f -- "$temporary"
      echo "A production release marker appeared before the recovered-V4 route commit." >&2
      return 1
    else
      marker_status=$?
    fi
    [[ "$marker_status" -eq 1 ]] || {
      rm -f -- "$temporary"
      echo "Production release marker state is unreadable before recovered-V4 route commit." >&2
      return 1
    }
  elif [[ -n "$expected_marker_sha$expected_marker_digest" ]]; then
    [[ -n "$expected_marker_sha" && -n "$expected_marker_digest" ]] || {
      rm -f -- "$temporary"
      echo "Route resume marker compare is incomplete." >&2
      return 1
    }
    assert_bodycast_release_marker_matches "$expected_marker_sha" "$expected_marker_state" "$expected_marker_digest" || {
      rm -f -- "$temporary"
      return 1
    }
    marker_status=0
  else
    if read_bodycast_release_marker; then marker_status=0; else marker_status=$?; fi
    [[ "$marker_status" -eq 0 || "$marker_status" -eq 1 ]] || {
      rm -f -- "$temporary"
      echo "Production release marker is unreadable before route publication." >&2
      return 1
    }
  fi
  maintenance_backup="$(mktemp "$(dirname "$route_file")/.bodycast-maintenance-backup.XXXXXX")" || {
    rm -f -- "$temporary"
    return 1
  }
  if ! cp -- "$route_file" "$maintenance_backup" || ! chmod 0644 "$maintenance_backup" \
    || ! sync -f "$maintenance_backup" || ! sync -f "$(dirname "$route_file")"; then
    rm -f -- "$temporary" "$maintenance_backup"
    echo "Maintenance-route recovery copy could not be made durable before publication." >&2
    return 1
  fi
  if [[ -n "$fence_pid" ]] && ! kill -0 "$fence_pid" 2>/dev/null; then
    rm -f -- "$temporary" "$maintenance_backup"
    echo "Unified V4 database fence exited before the atomic route swap." >&2
    return 1
  fi
  # Recheck the externally visible maintenance response immediately before
  # the first serving effect. The earlier probe may be separated from this
  # point by the bounded canonical-main refresh and durable backup write.
  if ! bodycast_probe_public_maintenance "$marker"; then
    rm -f -- "$temporary" "$maintenance_backup"
    echo "Maintenance 503 was not confirmed immediately before route publication." >&2
    return 1
  fi
  if ! bodycast_publish_staged_route "$temporary"; then
    rm -f -- "$temporary"
    rm -f -- "$maintenance_backup"
    echo "Serving-route replacement failed before serving commit." >&2
    return 1
  fi
  if ! sync -f "$(dirname "$route_file")"; then
    reload_failed=true
    echo "Serving route rename could not be durably synchronized." >&2
  fi
  # The live rename is the first possible serving effect. Training keeps a
  # durable maintenance-route backup until the database fence commits.
  SERVING_COMMIT_OCCURRED=true
  set +e
  if [[ "$reload_failed" == "false" ]]; then
    if [[ -n "$fence_pid" ]] && ! kill -0 "$fence_pid" 2>/dev/null; then
      reload_failed=true
      echo "Unified V4 database fence exited during the route transition." >&2
    elif ! timeout 8s docker exec gymbeam-caddy caddy reload \
      --address unix//run/caddy-admin/admin.sock \
      --config /etc/caddy/Caddyfile; then
      reload_failed=true
      reload_unknown=true
      echo "Caddy serving reload returned a non-success status; its server-side completion is unknown." >&2
    fi
  fi
  if [[ "$reload_failed" == "false" ]] && ! bodycast_probe_public_candidate_observational; then
    reload_failed=true
    echo "POST-COMMIT VERIFICATION FAILED: candidate health probe failed." >&2
  fi
  if [[ "$reload_failed" == "false" && -n "$fence_pid" ]] && ! kill -0 "$fence_pid" 2>/dev/null; then
    reload_failed=true
    echo "Unified V4 database fence exited before route verification completed." >&2
  fi
  if [[ "$reload_failed" == "false" && "$marker_status" -eq 0 && "$defer_fence_finalize" != "true" ]]; then
    if [[ -n "$expected_marker_sha" ]]; then
      clear_bodycast_release_marker "$expected_marker_sha" "$expected_marker_state" "$expected_marker_digest" || reload_failed=true
    else
      clear_bodycast_release_marker || reload_failed=true
    fi
  fi
  if [[ "$reload_failed" == "true" ]]; then
    set -e
    if [[ "$defer_fence_finalize" == "true" ]]; then
      BODYCAST_TRAINING_MAINTENANCE_BACKUP="$maintenance_backup"
      if [[ "$reload_unknown" == "true" ]]; then
        contain_ambiguous_training_reload "$maintenance_backup" || true
      else
        restore_training_maintenance_after_fence_failure || true
      fi
      echo "Training serving did not finalize; the release marker is retained. Follow the route recovery status above before any further action." >&2
      return 1
    fi
    local recovery_route
    recovery_route="$(mktemp "$(dirname "$route_file")/.bodycast-maintenance-recovery.XXXXXX")" || recovery_route=""
    if [[ -n "$recovery_route" ]] && cp -- "$maintenance_backup" "$recovery_route" \
      && chmod 0644 "$recovery_route" && mv -f -- "$recovery_route" "$route_file"; then
      if ! timeout 8s docker exec gymbeam-caddy caddy reload \
        --address unix//run/caddy-admin/admin.sock \
        --config /etc/caddy/Caddyfile; then
        echo "ROUTE RECOVERY WARNING: maintenance config was restored on disk but Caddy reload failed." >&2
      fi
      if ! bodycast_probe_public_maintenance "$marker"; then
        echo "ROUTE RECOVERY UNRESOLVED: public maintenance 503 could not be confirmed after rollback; serving state requires operator inspection. Backup retained at $maintenance_backup." >&2
      else
        SERVING_COMMIT_OCCURRED=false
        rm -f -- "$maintenance_backup"
        BODYCAST_TRAINING_MAINTENANCE_BACKUP=""
      fi
    else
      [[ -z "$recovery_route" ]] || rm -f -- "$recovery_route"
      echo "ROUTE RECOVERY FAILURE: could not restore maintenance config; release marker is retained." >&2
    fi
    echo "Serving-route verification failed; maintenance marker is retained for safe recovery." >&2
    return 1
  fi
  set -e
  if [[ "$defer_fence_finalize" == "true" ]]; then
    BODYCAST_TRAINING_MAINTENANCE_BACKUP="$maintenance_backup"
  elif ! rm -f -- "$maintenance_backup"; then
    echo "POST-COMMIT CLEANUP WARNING: maintenance backup remains at $maintenance_backup." >&2
  fi
}

write_training_maintenance_route_from_backup() {
  local backup="$1" routes_dir route_file temporary
  bodycast_assert_safe_routes_location || return 1
  routes_dir="$CADDY_ROUTES_PATH"
  route_file="${CADDY_ROUTES_PATH%/}/bodycast.caddy"
  [[ "$backup" == "$routes_dir"/.bodycast-maintenance-backup.* && -f "$backup" && ! -L "$backup" ]] || {
    echo "Training maintenance backup path is unsafe or unavailable." >&2
    return 1
  }
  temporary="$(mktemp "$routes_dir/.bodycast-maintenance-recovery.XXXXXX")" || return 1
  if ! cp -- "$backup" "$temporary" || ! chmod 0644 "$temporary" || ! mv -f -- "$temporary" "$route_file"; then
    rm -f -- "$temporary"
    echo "Training maintenance route could not be atomically restored; backup retained at $backup." >&2
    return 1
  fi
  if ! sync -f "$routes_dir"; then
    echo "Training maintenance route rename did not confirm directory durability." >&2
  fi
  bodycast_maintenance_marker_from_route >/dev/null
}

contain_ambiguous_training_reload() {
  local backup="$1"
  BODYCAST_TRAINING_MAINTENANCE_BACKUP="$backup"
  if restore_training_maintenance_after_fence_failure; then
    echo "Ambiguous Caddy reload reconciled: the maintenance reload completed and the exact public 503 was confirmed. The candidate remains running; the release marker is retained." >&2
    return 0
  fi
  echo "Caddy state remains UNKNOWN; the candidate remains running, and the release marker plus route backup require operator inspection. Maintenance is not confirmed." >&2
  return 1
}

restore_training_maintenance_after_fence_failure() {
  local route_file backup routes_dir temporary maintenance_marker
  backup="${BODYCAST_TRAINING_MAINTENANCE_BACKUP:-}"
  [[ -n "$backup" ]] || {
    echo "Training route backup is missing; maintenance recovery cannot be proven." >&2
    return 1
  }
  bodycast_assert_safe_routes_location || return 1
  routes_dir="$CADDY_ROUTES_PATH"
  route_file="${CADDY_ROUTES_PATH%/}/bodycast.caddy"
  [[ "$backup" == "$routes_dir"/.bodycast-maintenance-backup.* && -f "$backup" && ! -L "$backup" ]] || {
    echo "Training maintenance backup path is unsafe or unavailable." >&2
    return 1
  }
  maintenance_marker="$(sed -n 's/^[[:space:]]*X-BodyCast-Deploy-Maintenance "\([A-Za-z0-9][A-Za-z0-9._-]*\)"[[:space:]]*$/\1/p' "$backup")"
  [[ "$maintenance_marker" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || {
    echo "Training maintenance backup does not contain a valid maintenance route marker." >&2
    return 1
  }
  write_training_maintenance_route_from_backup "$backup" || return 1
  if ! timeout 8s docker exec gymbeam-caddy caddy reload \
    --address unix//run/caddy-admin/admin.sock \
    --config /etc/caddy/Caddyfile; then
    echo "Training maintenance reload outcome is UNKNOWN; candidate remains running and marker/backup are retained. Maintenance is not confirmed." >&2
    return 1
  fi
  if ! bodycast_probe_public_maintenance "$maintenance_marker"; then
    echo "Training recovery unresolved: external maintenance 503 was not confirmed; candidate remains running and marker/backup are retained. Maintenance is not confirmed." >&2
    return 1
  fi
  SERVING_COMMIT_OCCURRED=false
  if ! rm -f -- "$backup"; then
    echo "Training maintenance is confirmed, but its extra recovery backup remains at $backup." >&2
  fi
  BODYCAST_TRAINING_MAINTENANCE_BACKUP=""
}

serve_training_release() {
  local expected_release_sha="$1" marker_digest="" app_image_id latest_image_id maintenance_marker staged_route
  local fence_output_fd fence_input_fd fence_pid fence_deadline fence_remaining fence_line fence_ready=false
  local fence_status fence_route_budget_ms
  local recovered_v4_release=false recovery_marker_path recovery_marker_digest

  [[ "$expected_release_sha" =~ ^[a-f0-9]{40}$ ]] || {
    echo "Training serving requires an exact requested release SHA." >&2; return 1;
  }
  bodycast_assert_current_main_sha "$expected_release_sha"
  git cat-file -e "$expected_release_sha:prisma/migrations/20261016120000_training_mutation_ledger_queue/migration.sql" 2>/dev/null || {
    echo "The exact requested SHA does not contain the Training queue migration." >&2; return 1;
  }
  if [[ "${BODYCAST_RECOVERED_V4_SERVE:-0}" == "1" ]]; then
    [[ "${BODYCAST_RECOVERED_V4_SERVE}" == "1" ]] || return 1
    if read_bodycast_release_marker; then
      echo "Recovered-V4 serving cannot override an existing schema/deploy release marker." >&2
      return 1
    else
      local release_marker_status=$?
      [[ "$release_marker_status" -eq 1 ]] || return 1
    fi
    bodycast_assert_completed_v4_recovery_for_release "$expected_release_sha"
    recovery_marker_path="/var/lib/bodycast/recovery/unified-v4-derived-$(node --input-type=module -e 'import { LEGACY_V4_RECOVERY } from "./scripts/production-v4-derived-recovery.mjs"; process.stdout.write(LEGACY_V4_RECOVERY.sourceSha)').json"
    recovery_marker_digest="$(sha256sum "$recovery_marker_path" | awk '{print $1}')"
    [[ "$recovery_marker_digest" =~ ^[a-f0-9]{64}$ ]] || { echo "Completed V4 recovery marker digest is invalid." >&2; return 1; }
    recovered_v4_release=true
  else
    require_ready_release_marker
    [[ "$BODYCAST_MARKER_SCHEMA_VERSION" == "3" \
      && "$BODYCAST_MARKER_MANIFEST_ID" == "training-mutation-ledger-refresh-queue-v1" \
      && "$BODYCAST_MARKER_STATE" == "app-ready" \
      && "$BODYCAST_MARKER_MIGRATION_ORIGIN_SHA" == "$expected_release_sha" \
      && "$BODYCAST_MARKER_DEPLOY_SHA" == "$expected_release_sha" ]] || {
      echo "Training serving requires the exact V3 app-ready marker bound to the migration and deploy SHA." >&2
      return 1
    }
    node "$ROOT_DIR/scripts/production-schema-deploy-handoff.mjs" --check \
      "$BODYCAST_MARKER_FILE_PATH" "$expected_release_sha" "$ROOT_DIR"
    marker_digest="$(sha256sum "$BODYCAST_MARKER_FILE_PATH" | awk '{print $1}')"
    [[ "$marker_digest" =~ ^[a-f0-9]{64}$ ]] || { echo "Training V3 marker digest is invalid." >&2; return 1; }
  fi

  app_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
  latest_image_id="$(docker image inspect --format '{{.Id}}' bodycast-app:latest)"
  [[ "$app_image_id" =~ ^sha256:[a-f0-9]{64}$ && "$latest_image_id" == "$app_image_id" ]] || {
    echo "Training serving requires the exact healthy app's immutable image to match bodycast-app:latest." >&2
    return 1
  }
  bodycast_verify_exact_maintenance_route
  maintenance_marker="$(bodycast_maintenance_marker_from_route)"
  bodycast_probe_public_maintenance "$maintenance_marker"
  compose --profile tools build migrate
  if [[ "$recovered_v4_release" == "true" ]]; then
    bodycast_assert_completed_v4_recovery_for_release "$expected_release_sha"
  fi
  bodycast_stage_serving_route_config
  staged_route="$BODYCAST_ROUTE_STAGE_PATH"
  # Hold the same profile advisory transaction lock used by Training/Health
  # mutations until the route and its health postcondition pass.
  coproc BODYCAST_TRAINING_V4_FENCE {
    timeout 95s docker compose -f "$COMPOSE_FILE" --profile tools run --rm --no-deps --interactive --no-TTY \
      --entrypoint node migrate /app/scripts/unified-v4-traffic-check.mjs \
      --profile-id 1 --hold-currentness-fence
  }
  fence_pid="$BODYCAST_TRAINING_V4_FENCE_PID"
  exec {fence_output_fd}<&"${BODYCAST_TRAINING_V4_FENCE[0]}"
  exec {fence_input_fd}>&"${BODYCAST_TRAINING_V4_FENCE[1]}"
  fence_deadline=$((SECONDS + 95))
  while (( SECONDS < fence_deadline )); do
    fence_remaining=$((fence_deadline - SECONDS))
    if IFS= read -r -t "$fence_remaining" -u "$fence_output_fd" fence_line; then
      if [[ "$fence_line" == BODYCAST_UNIFIED_V4_FENCE_READY\ * ]]; then
        fence_route_budget_ms="${fence_line#BODYCAST_UNIFIED_V4_FENCE_READY }"
        [[ "$fence_route_budget_ms" =~ ^[0-9]+$ && "$fence_route_budget_ms" -ge 75000 ]] || {
          printf 'abort\n' >&"$fence_input_fd" 2>/dev/null || true
          exec {fence_input_fd}>&-
          if wait "$fence_pid"; then fence_status=0; else fence_status=$?; fi
          exec {fence_output_fd}<&-
          rm -f -- "$staged_route"
          echo "Training serve blocked: the fenced currentness check left too little time for a bounded route transition." >&2
          return 1
        }
        fence_ready=true
        break
      fi
      printf '%s\n' "$fence_line" >&2
    else
      break
    fi
  done
  if [[ "$fence_ready" != true ]]; then
    printf 'abort\n' >&"$fence_input_fd" 2>/dev/null || true
    exec {fence_input_fd}>&-
    if wait "$fence_pid"; then fence_status=0; else fence_status=$?; fi
    exec {fence_output_fd}<&-
    rm -f -- "$staged_route"
    echo "Training serve blocked: Unified V4 did not establish a currentness fence." >&2
    return 1
  fi

  SERVING_COMMIT_OCCURRED=false
  if ! bodycast_assert_current_main_sha "$expected_release_sha"; then
    printf 'abort\n' >&"$fence_input_fd" 2>/dev/null || true
    exec {fence_input_fd}>&-
    if wait "$fence_pid"; then fence_status=0; else fence_status=$?; fi
    exec {fence_output_fd}<&-
    rm -f -- "$staged_route"
    echo "Training serve blocked: canonical-main freshness could not be confirmed within the fenced route budget." >&2
    return 1
  fi
  if [[ "$recovered_v4_release" == "true" ]]; then
    bodycast_assert_completed_v4_recovery_for_release "$expected_release_sha"
    [[ "$(sha256sum "$recovery_marker_path" | awk '{print $1}')" == "$recovery_marker_digest" ]] || {
      printf 'abort\n' >&"$fence_input_fd" 2>/dev/null || true
      exec {fence_input_fd}>&-
      if wait "$fence_pid"; then fence_status=0; else fence_status=$?; fi
      exec {fence_output_fd}<&-
      rm -f -- "$staged_route"
      echo "Completed V4 recovery evidence changed during the currentness fence." >&2
      return 1
    }
  fi
  if [[ "$recovered_v4_release" == "true" ]]; then
    if ! publish_candidate_route "" "" "" "$staged_route" true "$fence_pid" true true; then
      printf 'abort\n' >&"$fence_input_fd" 2>/dev/null || true
      exec {fence_input_fd}>&-
      if wait "$fence_pid"; then fence_status=0; else fence_status=$?; fi
      exec {fence_output_fd}<&-
      return 1
    fi
  elif ! publish_candidate_route "$expected_release_sha" "$marker_digest" "app-ready" "$staged_route" true "$fence_pid" true; then
    printf 'abort\n' >&"$fence_input_fd" 2>/dev/null || true
    exec {fence_input_fd}>&-
    if wait "$fence_pid"; then fence_status=0; else fence_status=$?; fi
    exec {fence_output_fd}<&-
    return 1
  fi
  if ! printf 'route-committed\n' >&"$fence_input_fd"; then
    exec {fence_input_fd}>&-
    if wait "$fence_pid"; then fence_status=0; else fence_status=$?; fi
    exec {fence_output_fd}<&-
    echo "Serving route committed, but the bounded Unified V4 fence acknowledgement was lost; restoring maintenance." >&2
    restore_training_maintenance_after_fence_failure || true
    return 1
  fi
  exec {fence_input_fd}>&-
  if wait "$fence_pid"; then
    fence_status=0
  else
    fence_status=$?
  fi
  while IFS= read -r -t 1 -u "$fence_output_fd" fence_line; do printf '%s\n' "$fence_line" >&2; done
  exec {fence_output_fd}<&-
  [[ "$fence_status" -eq 0 ]] || {
    echo "Serving route committed, but the PostgreSQL currentness fence did not complete cleanly; restoring maintenance." >&2
    restore_training_maintenance_after_fence_failure || true
    return 1
  }
  if [[ "$recovered_v4_release" != "true" ]] \
    && ! assert_bodycast_release_marker_matches "$expected_release_sha" "app-ready" "$marker_digest"; then
    echo "Training serving was committed by the PostgreSQL fence, but final marker/route verification failed; the serving route and recovery evidence are retained for operator inspection." >&2
    return 1
  fi
  if ! bodycast_verify_exact_serving_route; then
    echo "Training serving was committed by the PostgreSQL fence, but final route verification failed; the serving route and recovery evidence are retained for operator inspection." >&2
    return 1
  fi
  if [[ "$recovered_v4_release" == "true" ]]; then
    if ! rm -f -- "$BODYCAST_TRAINING_MAINTENANCE_BACKUP"; then
      echo "Training serving committed with V4 recovery provenance; route backup remains at $BODYCAST_TRAINING_MAINTENANCE_BACKUP." >&2
      return 1
    fi
    BODYCAST_TRAINING_MAINTENANCE_BACKUP=""
    echo "Exact recovered V4 release is serving under the atomic currentness fence; the terminal recovery marker is retained."
    return 0
  fi
  local marker_backup marker_directory marker_tmp
  marker_directory="$(dirname "$BODYCAST_MARKER_FILE_PATH")"
  marker_backup="$(mktemp "$marker_directory/.bodycast-training-marker-backup.XXXXXX")"
  chmod 0600 "$marker_backup"
  if ! cp -- "$BODYCAST_MARKER_FILE_PATH" "$marker_backup" || ! sync -f "$marker_backup"; then
    rm -f -- "$marker_backup"
    echo "Training serving was committed by the PostgreSQL fence, but marker cleanup could not be prepared; the serving route and release marker are retained for operator inspection." >&2
    return 1
  fi
  if ! clear_bodycast_release_marker "$expected_release_sha" "app-ready" "$marker_digest"; then
    if [[ ! -f "$BODYCAST_MARKER_FILE_PATH" || -L "$BODYCAST_MARKER_FILE_PATH" ]]; then
      marker_tmp="$(mktemp "$marker_directory/.bodycast-training-marker-restore.XXXXXX")"
      cp -- "$marker_backup" "$marker_tmp"
      chmod 0600 "$marker_tmp"
      mv -f -- "$marker_tmp" "$BODYCAST_MARKER_FILE_PATH"
      sync -f "$marker_directory"
    fi
    rm -f -- "$marker_backup"
    echo "Training serving was committed by the PostgreSQL fence, but release marker cleanup failed; the serving route and recovery evidence are retained for operator inspection." >&2
    return 1
  fi
  rm -f -- "$marker_backup"
  if [[ -n "${BODYCAST_TRAINING_MAINTENANCE_BACKUP:-}" ]]; then
    if ! rm -f -- "$BODYCAST_TRAINING_MAINTENANCE_BACKUP"; then
      echo "Training is serving, but the prior maintenance route backup remains at $BODYCAST_TRAINING_MAINTENANCE_BACKUP." >&2
    fi
    BODYCAST_TRAINING_MAINTENANCE_BACKUP=""
  fi
  cleanup_pre_ddl_recovery_pin_after_serving_commit "$expected_release_sha"
  echo "Training exact-SHA route is serving after V3 marker, immutable image, and fenced Unified V4 currentness checks."
}

cleanup_pre_ddl_recovery_pin_after_serving_commit() {
  local release_sha="$1" recovery_record recovery_image_id recovery_image_pin marker_status
  [[ "$release_sha" =~ ^[a-f0-9]{40}$ && "$SERVING_COMMIT_OCCURRED" == "true" ]] || return 0
  recovery_record="$(git rev-parse --absolute-git-dir)/bodycast-production-pre-ddl-release"
  marker_status=1
  if read_bodycast_release_marker; then marker_status=0; else marker_status=$?; fi
  if [[ "$marker_status" -eq 1 && -f "$recovery_record" && ! -L "$recovery_record" ]] \
    && grep -Fqx "targetSha=$release_sha" "$recovery_record"; then
    recovery_image_id="$(sed -n 's/^previousImageId=//p' "$recovery_record")"
    recovery_image_pin="$(sed -n 's/^previousImagePin=//p' "$recovery_record")"
    [[ -n "$recovery_image_pin" ]] || recovery_image_pin="bodycast-app:rollback"
    if [[ "$recovery_image_id" =~ ^sha256:[a-f0-9]{64}$ \
      && ( "$recovery_image_pin" == "bodycast-app:rollback" \
        || "$recovery_image_pin" =~ ^bodycast-app:rollback-preflight-[1-9][0-9]*-[1-9][0-9]*$ ) \
      && "$(docker image inspect --format '{{.Id}}' "$recovery_image_pin" 2>/dev/null || true)" == "$recovery_image_id" ]]; then
      if docker image rm "$recovery_image_pin" >/dev/null 2>&1; then
        rm -f -- "$recovery_record"
        sync -f "$(dirname "$recovery_record")"
      else
        echo "POST-COMMIT CLEANUP WARNING: prior-app recovery pin remains after successful serving commit." >&2
      fi
    fi
  elif [[ "$marker_status" -ne 1 ]]; then
    echo "POST-COMMIT CLEANUP WARNING: keeping the pre-DDL image pin because the release marker remains present or invalid." >&2
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

if [[ "$MODE" == "full-history-recalculate" ]]; then
  expected_release_sha="${BODYCAST_DEPLOY_SHA:-${DEPLOY_SHA:-}}"
  [[ "$expected_release_sha" =~ ^[a-f0-9]{40}$ ]] || {
    echo "Owner-authorized full-history recalculation requires a full exact release SHA." >&2
    exit 1
  }
  require_ready_release_marker
  [[ "$BODYCAST_MARKER_RELEASE_SHA" == "$expected_release_sha" ]] || {
    echo "Full-history recalculation is blocked because the app-ready marker belongs to another SHA." >&2
    exit 1
  }
  bodycast_assert_current_main_sha "$expected_release_sha"
  bodycast_verify_exact_maintenance_route
  maintenance_marker="$(bodycast_maintenance_marker_from_route)"
  bodycast_probe_public_maintenance "$maintenance_marker"
  candidate_image_id="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
  [[ "$candidate_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || {
    echo "The candidate app image identity is not an immutable image digest." >&2
    exit 1
  }

  # Stop the app so recalculation DML cannot race persistent application writers.
  stop_old_app
  bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert
  bash "$ROOT_DIR/scripts/deploy-preflight-schema.sh"
  bodycast_assert_current_main_sha "$expected_release_sha"
  [[ "$(git rev-parse HEAD)" == "$expected_release_sha" ]] || {
    echo "The checked-out deployed revision differs from the exact recalculation release SHA." >&2
    exit 1
  }
  [[ "$(docker image inspect --format '{{.Id}}' bodycast-app:latest)" == "$candidate_image_id" ]] || {
    echo "The immutable deployed app image changed before full-history recalculation." >&2
    exit 1
  }
  bodycast_verify_exact_maintenance_route
  bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert

  compose --profile tools build migrate
  # Building the migrator may take long enough for canonical main to advance.
  # Revalidate the owner-authorized release immediately before its first DML.
  bodycast_assert_current_main_sha "$expected_release_sha"
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/production-full-history-recalculate.mjs \
    --full-history-recalculate --owner-authorized --profile-id 1
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v3-postflight.mjs --profile-id 1

  bodycast_assert_current_main_sha "$expected_release_sha"
  [[ "$(docker image inspect --format '{{.Id}}' bodycast-app:latest)" == "$candidate_image_id" ]] || {
    echo "The immutable candidate image changed after full-history recalculation." >&2
    exit 1
  }
  BODYCAST_DEPLOY_SHA="$expected_release_sha" compose up -d --no-deps --no-build app
  bash "$ROOT_DIR/scripts/production-app-container-health-wait.sh" "$expected_release_sha" "$candidate_image_id"
  echo "Owner-authorized full-history recalculation and Unified V3 postflight completed; traffic remains in maintenance."
  exit 0
fi

inspect_unified_v4_lifecycle() {
  local output
  output="$(compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-activate-replay.mjs --inspect-lifecycle --profile-id 1)" || return 1
  case "$output" in
    '{"command":"unified-v4-activate-replay","profileId":1,"state":"v3-ready"}') printf '%s\n' "v3-ready" ;;
    '{"command":"unified-v4-activate-replay","profileId":1,"state":"v4-replayable"}') printf '%s\n' "v4-replayable" ;;
    '{"command":"unified-v4-activate-replay","profileId":1,"state":"v4-current"}') printf '%s\n' "v4-current" ;;
    *) echo "Unified lifecycle inspection returned unknown or malformed evidence." >&2; return 1 ;;
  esac
}

activate_v4_and_serve() {
  local expected_release_sha app_release_sha candidate_image_id candidate_image_after marker_status maintenance_marker marker_digest lifecycle_state lifecycle_state_after expected_raw_fingerprint current_raw_fingerprint
  local expected_binding_b64 expected_replay_stable_state_fingerprint expected_replay_lifecycle_digest migration_run_b64 pre_ddl_raw_fingerprint pg_restore_version
  expected_release_sha="${BODYCAST_DEPLOY_SHA:-${DEPLOY_SHA:-}}"
  expected_raw_fingerprint="${BODYCAST_V4_REPLAY_INPUT_FINGERPRINT:-}"
  expected_binding_b64="${BODYCAST_V4_RECOVERY_BINDING_B64:-}"
  expected_replay_stable_state_fingerprint="${BODYCAST_V4_EXPECTED_REPLAY_STABLE_STATE_FINGERPRINT:-}"
  expected_replay_lifecycle_digest="${BODYCAST_V4_EXPECTED_REPLAY_LIFECYCLE_DIGEST:-}"
  migration_run_b64="${BODYCAST_V4_MIGRATION_RUN_B64:-}"
  pre_ddl_raw_fingerprint="${BODYCAST_EXPECTED_PRE_DDL_RAW_FINGERPRINT:-}"
  pg_restore_version="${BODYCAST_PG_RESTORE_VERSION:-}"
  [[ "$expected_release_sha" =~ ^[a-f0-9]{40}$ ]] || {
    echo "Owner-authorized V4 activation requires a full exact release SHA." >&2
    return 1
  }
  [[ "$expected_raw_fingerprint" =~ ^[a-f0-9]{64}$ ]] || {
    echo "V4 activation requires the raw-source fingerprint from the verified post-DDL backup and rehearsal." >&2
    return 1
  }
  [[ "$expected_binding_b64" =~ ^[A-Za-z0-9+/]+=*$ && "$expected_replay_stable_state_fingerprint" =~ ^[a-f0-9]{64}$ \
    && "$expected_replay_lifecycle_digest" =~ ^[a-f0-9]{64}$ \
    && -n "$migration_run_b64" && "$pre_ddl_raw_fingerprint" == "$expected_raw_fingerprint" \
    && "$pg_restore_version" =~ ^pg_restore\ \(PostgreSQL\)\ 17\.[0-9]+$ ]] || {
    echo "V4 activation requires the verified backup binding and isolated rehearsal's deterministic post-replay stable-state fingerprint." >&2
    return 1
  }

  assert_v4_replay_source_unchanged() {
    current_raw_fingerprint="$(bash "$ROOT_DIR/scripts/production-db-data-fingerprint.sh" --production-container "$DB_CONTAINER" --v4-replay-inputs)" || return 1
    [[ "$current_raw_fingerprint" == "$expected_raw_fingerprint" ]] || {
      echo "Production V4 replay-input fingerprint changed after backup rehearsal; activation is blocked." >&2
      return 1
    }
  }

  assert_v4_recovery_boundary() {
    local phase="$1" boundary_tmp observed_json
    boundary_tmp="$(mktemp -d /tmp/bodycast-v4-boundary.XXXXXX)" || return 1
    chmod 700 "$boundary_tmp"
    if ! printf '%s' "$expected_binding_b64" | base64 --decode > "$boundary_tmp/expected.json" \
      || [[ "$(base64 -w0 "$boundary_tmp/expected.json")" != "$expected_binding_b64" ]]; then
      rm -rf -- "$boundary_tmp"
      echo "Verified V4 recovery binding is not canonical base64." >&2
      return 1
    fi
    if ! observed_json="$(BODYCAST_PRODUCTION_RELEASE_LOCK_HELD=1 BODYCAST_V4_CANDIDATE_APP_IMAGE_ID="$candidate_image_id" \
      BODYCAST_V4_MIGRATION_RUN_B64="$migration_run_b64" BODYCAST_EXPECTED_PRE_DDL_RAW_FINGERPRINT="$pre_ddl_raw_fingerprint" \
      BODYCAST_PG_RESTORE_VERSION="$pg_restore_version" bash "$ROOT_DIR/scripts/production-v4-post-ddl-backup-host.sh" snapshot-only)"; then
      rm -rf -- "$boundary_tmp"
      echo "Fresh read-only V4 production boundary capture failed." >&2
      return 1
    fi
    printf '%s\n' "$observed_json" > "$boundary_tmp/observed.json"
    if ! node "$ROOT_DIR/scripts/production-v4-recovery.mjs" --assert-replay-boundary \
      "$boundary_tmp/expected.json" "$boundary_tmp/observed.json" "$phase" "$expected_replay_stable_state_fingerprint" \
      "$expected_replay_lifecycle_digest" >/dev/null; then
      rm -rf -- "$boundary_tmp"
      return 1
    fi
    rm -rf -- "$boundary_tmp"
  }

  # A route-file failure can happen after V4 replay has committed and v4-ready
  # was durably written. Reconcile that state by repeating only read-only
  # readiness checks and route publication; never repeat activation/replay.
  if read_bodycast_release_marker; then
    marker_status=0
    if [[ "$BODYCAST_MARKER_RELEASE_SHA" == "$expected_release_sha" \
      && "$BODYCAST_MARKER_STATE" == "v4-ready" ]]; then
      bodycast_assert_current_main_sha "$expected_release_sha"
      marker_digest="$(sha256sum "$BODYCAST_MARKER_FILE_PATH" | awk '{print $1}')"
      bodycast_verify_exact_maintenance_route
      maintenance_marker="$(bodycast_maintenance_marker_from_route)"
      bodycast_probe_public_maintenance "$maintenance_marker"
      assert_v4_replay_source_unchanged
      local app_identity app_id app_image app_sha app_state app_health
      app_identity="$(docker inspect --format '{{.Id}}|{{.Image}}|{{index .Config.Labels "org.bodycast.release-sha"}}|{{.State.Status}}|{{.State.Health.Status}}' "$APP_CONTAINER")"
      IFS='|' read -r app_id app_image app_sha app_state app_health <<< "$app_identity"
      [[ "$app_id" =~ ^[a-f0-9]{64}$ && "$app_image" =~ ^sha256:[a-f0-9]{64}$ \
        && "$app_sha" == "$expected_release_sha" && "$app_state" == "running" && "$app_health" == "healthy" \
        && "$(docker image inspect --format '{{.Id}}' bodycast-app:latest)" == "$app_image" ]] || {
        echo "The v4-ready route resume requires the exact healthy app and matching immutable image pin." >&2
        return 1
      }
      compose --profile tools build migrate
      compose --profile tools run --rm --no-deps --entrypoint node migrate \
        /app/scripts/unified-v4-traffic-check.mjs --profile-id 1
      bodycast_assert_current_main_sha "$expected_release_sha"
      assert_bodycast_release_marker_matches "$expected_release_sha" "v4-ready" "$marker_digest"
      SERVING_COMMIT_OCCURRED=false
      publish_candidate_route "$expected_release_sha" "$marker_digest"
      cleanup_pre_ddl_recovery_pin_after_serving_commit "$expected_release_sha"
      return 0
    fi
  else
    marker_status=$?
  fi

  require_ready_release_marker
  [[ "$BODYCAST_MARKER_RELEASE_SHA" == "$expected_release_sha" ]] || {
    echo "V4 activation is blocked because the app-ready marker belongs to another SHA." >&2
    return 1
  }
  bodycast_assert_current_main_sha "$expected_release_sha"
  bodycast_verify_exact_maintenance_route
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
  lifecycle_state="$(inspect_unified_v4_lifecycle)" || return 1
  if [[ "$lifecycle_state" == "v3-ready" ]]; then
    compose --profile tools run --rm --no-deps --entrypoint node migrate \
      /app/scripts/unified-v3-postflight.mjs --profile-id 1
  fi

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
  lifecycle_state_after="$(inspect_unified_v4_lifecycle)" || return 1
  [[ "$lifecycle_state_after" == "$lifecycle_state" ]] || {
    echo "Unified lifecycle changed between inspection and V4 activation." >&2
    return 1
  }
  if [[ "$lifecycle_state_after" == "v3-ready" ]]; then
    compose --profile tools run --rm --no-deps --entrypoint node migrate \
      /app/scripts/unified-v3-postflight.mjs --profile-id 1
  fi

  assert_v4_replay_source_unchanged

  # Rebind the complete live DB/schema/history/raw-data state to the verified
  # backup and rehearsal immediately before the owner-authorized V4 DML.
  assert_v4_recovery_boundary before-replay

  # Lifecycle/schema checks are read-only but can take long enough for canonical main
  # to advance. Refresh it as the final gate immediately before V4 DML.
  bodycast_assert_current_main_sha "$expected_release_sha"

  # This fixed owner-authorized execution path holds the global flock from the
  # first V3 check through activation, postflight, app restart, and serving.
  if [[ "$lifecycle_state_after" != "v4-current" ]]; then
    compose --profile tools run --rm --no-deps --entrypoint node migrate \
      /app/scripts/unified-v4-activate-replay.mjs --activate-v4 --owner-authorized --profile-id 1
  else
    echo "Unified V4 is already current; resume serving without repeating production replay."
  fi
  assert_v4_replay_source_unchanged
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-traffic-check.mjs --profile-id 1

  # Confirm the actual replay matches the isolated rehearsal before restarting
  # the application or changing the maintenance route.
  assert_v4_recovery_boundary after-replay

  bodycast_assert_current_main_sha "$expected_release_sha"
  [[ "$(docker image inspect --format '{{.Id}}' bodycast-app:latest)" == "$candidate_image_id" ]] || {
    echo "The immutable candidate image changed after V4 activation." >&2
    return 1
  }
  BODYCAST_DEPLOY_SHA="$expected_release_sha" compose up -d --no-deps --no-build app
  bash "$ROOT_DIR/scripts/production-app-container-health-wait.sh" "$expected_release_sha" "$candidate_image_id"
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-traffic-check.mjs --profile-id 1
  bodycast_assert_current_main_sha "$expected_release_sha"
  write_bodycast_release_marker "$expected_release_sha" v4-ready
  marker_status=0
  SERVING_COMMIT_OCCURRED=false
  publish_candidate_route
  if [[ "$SERVING_COMMIT_OCCURRED" == "true" ]]; then
    cleanup_pre_ddl_recovery_pin_after_serving_commit "$expected_release_sha"
  fi
}

if [[ "$MODE" == "activate-v4-and-serve" ]]; then
  activate_v4_and_serve
  echo "Unified V4 activation/replay, currentness gates, and exact-SHA serve completed under one production lock."
  exit 0
fi

if [[ "$MODE" == "serve" ]]; then
  requested_release_sha="$BODYCAST_DEPLOY_SHA"
  [[ -n "$requested_release_sha" ]] || requested_release_sha="$DEPLOY_SHA"
  [[ "$requested_release_sha" =~ ^[a-f0-9]{40}$ ]] || {
    echo "Serving requires an exact requested release SHA for migration-tree classification." >&2; exit 1;
  }
  git cat-file -e "$requested_release_sha^{commit}" 2>/dev/null || {
    echo "Serving is blocked because the exact release tree is unavailable; migration lineage cannot be classified." >&2; exit 1;
  }
  if git cat-file -e "$requested_release_sha:prisma/migrations/20261016120000_training_mutation_ledger_queue/migration.sql" 2>/dev/null; then
    serve_training_release "$requested_release_sha"
    exit $?
  fi
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
