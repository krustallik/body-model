#!/usr/bin/env bash
# Failure cleanup shared by production cutback and its isolated PostgreSQL smoke.

bodycast_cutback_failure_cleanup() {
  local original_status="$1"
  local running_id running_image running_label
  bodycast_cutback_cleanup_unpromoted_stage "${stage_db:-}" || true
  if [[ "${app_started:-false}" == "true" && "${route_committed:-false}" == "false" ]]; then
    running_id="$(docker inspect --format '{{.Id}}' "$APP_CONTAINER" 2>/dev/null || true)"
    running_image="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"
    running_label="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$APP_CONTAINER" 2>/dev/null || true)"
    if [[ "$running_id" =~ ^[a-f0-9]{64}$ && "$running_image" == "$PREVIOUS_IMAGE_ID" \
      && "$running_label" == "$(expected_previous_app_label)" \
      && ( -z "${app_started_container_id:-}" || "$running_id" == "$app_started_container_id" ) ]]; then
      docker update --restart=no "$APP_CONTAINER" >/dev/null 2>&1
      docker stop --time 0 "$APP_CONTAINER" >/dev/null 2>&1
      compose rm --force app >/dev/null 2>&1
    fi
  fi
  if [[ "${database_swapped:-false}" == "true" && ! -e "${BODYCAST_RELEASE_MARKER_PATH:-/nonexistent}" ]]; then
    # No marker removal is attempted here; recovery state remains blocking.
    :
  fi
  if [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" && ! -L "$TMP_DIR" ]]; then rm -rf -- "$TMP_DIR"; fi
  if [[ "${route_committed:-false}" == "true" ]]; then return 0; fi
  return "$original_status"
}
