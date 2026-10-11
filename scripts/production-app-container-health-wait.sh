#!/usr/bin/env bash
set -Eeuo pipefail

# Wait for the fixed production app container created by the full-history
# recalculation workflow. This script never starts, stops, removes, or serves a
# container; it only verifies immutable identity and readiness.
readonly APP_CONTAINER='bodycast-app-prod'
readonly MAX_ATTEMPTS=30
readonly POLL_SECONDS=5
readonly EXPECTED_SHA="${1:-}"
readonly EXPECTED_IMAGE_ID="${2:-}"

fail() {
  printf 'Exact-SHA app readiness check failed: %s\n' "$1" >&2
  exit 1
}

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid expected release SHA'
[[ "$EXPECTED_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'invalid expected immutable image ID'

read_app_identity() {
  local fields
  fields="$(docker inspect --format '{{.Id}}|{{.Image}}|{{index .Config.Labels "org.bodycast.release-sha"}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$APP_CONTAINER")" \
    || fail 'container inspection was unavailable'
  IFS='|' read -r CONTAINER_ID IMAGE_ID RELEASE_SHA STATE HEALTH <<< "$fields"
  [[ "$CONTAINER_ID" =~ ^[a-f0-9]{64}$ ]] || fail 'container identity was invalid'
  [[ "$IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'container image identity was invalid'
  [[ "$RELEASE_SHA" == "$EXPECTED_SHA" ]] || fail 'container release SHA changed'
  [[ "$IMAGE_ID" == "$EXPECTED_IMAGE_ID" ]] || fail 'container image ID changed'
  [[ "$STATE" == running || "$STATE" == created || "$STATE" == restarting ]] \
    || fail "container entered terminal state $STATE"
  [[ "$HEALTH" == starting || "$HEALTH" == healthy || "$HEALTH" == unhealthy ]] \
    || fail 'container healthcheck is missing or invalid'
  [[ "$HEALTH" != unhealthy ]] || fail 'container healthcheck reported unhealthy'
}

INITIAL_CONTAINER_ID=''

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
  read_app_identity
  if [[ -z "$INITIAL_CONTAINER_ID" ]]; then
    INITIAL_CONTAINER_ID="$CONTAINER_ID"
  fi
  [[ "$CONTAINER_ID" == "$INITIAL_CONTAINER_ID" ]] || fail 'container was replaced while waiting'
  if [[ "$STATE" == running && "$HEALTH" == healthy ]]; then
    docker exec "$INITIAL_CONTAINER_ID" wget --quiet --tries=1 --timeout=5 --output-document=- \
      http://127.0.0.1:3000/api/health 2>/dev/null | grep -Fq '"status":"ok"' \
      || fail 'in-container health endpoint did not confirm readiness'
    read_app_identity
    [[ "$CONTAINER_ID" == "$INITIAL_CONTAINER_ID" && "$STATE" == running && "$HEALTH" == healthy ]] \
      || fail 'container identity or health changed after the readiness probe'
    printf 'Exact-SHA app readiness verified after %s health sample(s).\n' "$attempt"
    exit 0
  fi
  if [[ "$STATE" == running && "$HEALTH" == starting && "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
    sleep "$POLL_SECONDS"
    continue
  fi
  [[ "$attempt" -lt "$MAX_ATTEMPTS" ]] || fail 'container healthcheck timed out'
  sleep "$POLL_SECONDS"
done

fail 'container healthcheck timed out'
