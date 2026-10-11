#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
HEALTH_WAITER="$REPO_ROOT/scripts/production-app-container-health-wait.sh"
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/bodycast-app-health-wait.XXXXXX")"
trap 'rm -rf -- "$FIXTURE_ROOT"' EXIT

readonly EXPECTED_SHA='b693be7d7b7103e263d35bd67b542f77114c5dca'
readonly EXPECTED_IMAGE='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
readonly CONTAINER_ID='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

new_fixture() {
  local name="$1"
  FIXTURE="$FIXTURE_ROOT/$name"
  mkdir -p "$FIXTURE/bin"
  cat > "$FIXTURE/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$DOCKER_EVENTS"
[[ "${1:-}" == inspect || "${1:-}" == exec ]] || exit 90
if [[ "$1" == exec ]]; then
  [[ "${HEALTH_PROBE_FAIL:-0}" == 0 ]] || exit 1
  printf '{"status":"ok"}\n'
  exit 0
fi
[[ "${INSPECT_FAIL:-0}" == 0 ]] || exit 1
format="${3:-}"
case "$format" in
  *".Id}}|{{.Image"* )
    count=0
    [[ -f "$HEALTH_COUNT_FILE" ]] && count="$(cat "$HEALTH_COUNT_FILE")"
    count=$((count + 1))
    printf '%s\n' "$count" > "$HEALTH_COUNT_FILE"
    IFS=, read -r -a statuses <<< "${HEALTH_SEQUENCE:-healthy}"
    index=$((count - 1))
    (( index >= ${#statuses[@]} )) && index=$((${#statuses[@]} - 1))
    IFS=, read -r -a container_ids <<< "${CONTAINER_SEQUENCE:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
    (( index >= ${#container_ids[@]} )) && container_index=$((${#container_ids[@]} - 1)) || container_index="$index"
    printf '%s|%s|%s|%s|%s\n' \
      "${container_ids[$container_index]}" \
      "${FIXTURE_IMAGE_ID:-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" \
      "${FIXTURE_RELEASE_SHA:-b693be7d7b7103e263d35bd67b542f77114c5dca}" \
      "${FIXTURE_STATE:-running}" "${statuses[$index]}"
    ;;
  *".Id"* ) printf '%s\n' "${FIXTURE_CONTAINER_ID:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}" ;;
  *".Image"* ) printf '%s\n' "${FIXTURE_IMAGE_ID:-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;
  *"org.bodycast.release-sha"* ) printf '%s\n' "${FIXTURE_RELEASE_SHA:-b693be7d7b7103e263d35bd67b542f77114c5dca}" ;;
  * ) exit 91 ;;
esac
DOCKER
  cat > "$FIXTURE/bin/sleep" <<'SLEEP'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "${1:-}" >> "$SLEEP_EVENTS"
SLEEP
  chmod +x "$FIXTURE/bin/docker" "$FIXTURE/bin/sleep"
  : > "$FIXTURE/docker-events"
  : > "$FIXTURE/sleep-events"
  : > "$FIXTURE/health-count"
  DOCKER_EVENTS="$FIXTURE/docker-events"
  SLEEP_EVENTS="$FIXTURE/sleep-events"
  HEALTH_COUNT_FILE="$FIXTURE/health-count"
}

run_waiter() {
  local name="$1" sequence="${2:-healthy}" extra_env="${3:-}"
  new_fixture "$name"
  if [[ -n "$extra_env" ]]; then
    env PATH="$FIXTURE/bin:$PATH" DOCKER_EVENTS="$DOCKER_EVENTS" SLEEP_EVENTS="$SLEEP_EVENTS" \
      HEALTH_COUNT_FILE="$HEALTH_COUNT_FILE" HEALTH_SEQUENCE="$sequence" $extra_env \
      bash "$HEALTH_WAITER" "$EXPECTED_SHA" "$EXPECTED_IMAGE" > "$FIXTURE/output"
  else
    env PATH="$FIXTURE/bin:$PATH" DOCKER_EVENTS="$DOCKER_EVENTS" SLEEP_EVENTS="$SLEEP_EVENTS" \
      HEALTH_COUNT_FILE="$HEALTH_COUNT_FILE" HEALTH_SEQUENCE="$sequence" \
      bash "$HEALTH_WAITER" "$EXPECTED_SHA" "$EXPECTED_IMAGE" > "$FIXTURE/output"
  fi
  cat "$FIXTURE/output"
}

run_waiter delayed 'starting,starting,healthy' >/dev/null
SUCCESS_OUTPUT="$(cat "$FIXTURE/output")"
[[ "$SUCCESS_OUTPUT" == *'after 3 health sample(s)'* ]] || { echo 'Delayed healthy startup was not observed.' >&2; exit 1; }
[[ "$(wc -l < "$SLEEP_EVENTS")" -eq 2 ]] || { echo 'Waiter did not wait between health samples.' >&2; exit 1; }
grep -q 'exec bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb wget' "$DOCKER_EVENTS" \
  || { echo 'Exact container health endpoint was not checked.' >&2; exit 1; }
grep -q -- '--timeout=5' "$DOCKER_EVENTS" \
  || { echo 'In-container health endpoint probe is not bounded.' >&2; exit 1; }
if awk '$1 != "inspect" && $1 != "exec" { exit 1 }' "$DOCKER_EVENTS"; then :; else
  echo 'Readiness helper issued an unsupported Docker command.' >&2
  exit 1
fi
if grep -Eq 'stop|rm |compose|restart|kill|route|recalculate' "$DOCKER_EVENTS"; then
  echo 'Readiness helper attempted an unrelated or mutating Docker operation.' >&2
  exit 1
fi

new_fixture wrong-image
if env PATH="$FIXTURE/bin:$PATH" DOCKER_EVENTS="$DOCKER_EVENTS" SLEEP_EVENTS="$SLEEP_EVENTS" \
  HEALTH_COUNT_FILE="$HEALTH_COUNT_FILE" FIXTURE_IMAGE_ID='sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' \
  bash "$HEALTH_WAITER" "$EXPECTED_SHA" "$EXPECTED_IMAGE" >/dev/null 2>&1; then
  echo 'Wrong immutable image was accepted.' >&2; exit 1
fi
[[ ! -s "$SLEEP_EVENTS" ]] || { echo 'Wrong image caused a wait.' >&2; exit 1; }

new_fixture wrong-sha
if env PATH="$FIXTURE/bin:$PATH" DOCKER_EVENTS="$DOCKER_EVENTS" SLEEP_EVENTS="$SLEEP_EVENTS" \
  HEALTH_COUNT_FILE="$HEALTH_COUNT_FILE" FIXTURE_RELEASE_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  bash "$HEALTH_WAITER" "$EXPECTED_SHA" "$EXPECTED_IMAGE" >/dev/null 2>&1; then
  echo 'Wrong release SHA was accepted.' >&2; exit 1
fi

new_fixture unhealthy
if env PATH="$FIXTURE/bin:$PATH" DOCKER_EVENTS="$DOCKER_EVENTS" SLEEP_EVENTS="$SLEEP_EVENTS" \
  HEALTH_COUNT_FILE="$HEALTH_COUNT_FILE" HEALTH_SEQUENCE=unhealthy \
  bash "$HEALTH_WAITER" "$EXPECTED_SHA" "$EXPECTED_IMAGE" >/dev/null 2>&1; then
  echo 'Unhealthy app was accepted.' >&2; exit 1
fi
[[ ! -s "$SLEEP_EVENTS" ]] || { echo 'Unhealthy state should fail immediately.' >&2; exit 1; }

new_fixture exited
if env PATH="$FIXTURE/bin:$PATH" DOCKER_EVENTS="$DOCKER_EVENTS" SLEEP_EVENTS="$SLEEP_EVENTS" \
  HEALTH_COUNT_FILE="$HEALTH_COUNT_FILE" FIXTURE_STATE=exited \
  bash "$HEALTH_WAITER" "$EXPECTED_SHA" "$EXPECTED_IMAGE" >/dev/null 2>&1; then
  echo 'Exited container was accepted.' >&2; exit 1
fi

new_fixture inspect-error
if env PATH="$FIXTURE/bin:$PATH" DOCKER_EVENTS="$DOCKER_EVENTS" SLEEP_EVENTS="$SLEEP_EVENTS" \
  HEALTH_COUNT_FILE="$HEALTH_COUNT_FILE" INSPECT_FAIL=1 \
  bash "$HEALTH_WAITER" "$EXPECTED_SHA" "$EXPECTED_IMAGE" >/dev/null 2>&1; then
  echo 'Failed inspection was accepted.' >&2; exit 1
fi

new_fixture identity-drift
if env PATH="$FIXTURE/bin:$PATH" DOCKER_EVENTS="$DOCKER_EVENTS" SLEEP_EVENTS="$SLEEP_EVENTS" \
  HEALTH_COUNT_FILE="$HEALTH_COUNT_FILE" HEALTH_SEQUENCE=starting,healthy \
  CONTAINER_SEQUENCE='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' \
  bash "$HEALTH_WAITER" "$EXPECTED_SHA" "$EXPECTED_IMAGE" >/dev/null 2>&1; then
  echo 'Container identity drift was accepted.' >&2; exit 1
fi
if grep -q '^exec ' "$DOCKER_EVENTS"; then
  echo 'Container identity drift reached the health endpoint probe.' >&2
  exit 1
fi

new_fixture failed-health-endpoint
if env PATH="$FIXTURE/bin:$PATH" DOCKER_EVENTS="$DOCKER_EVENTS" SLEEP_EVENTS="$SLEEP_EVENTS" \
  HEALTH_COUNT_FILE="$HEALTH_COUNT_FILE" HEALTH_PROBE_FAIL=1 \
  bash "$HEALTH_WAITER" "$EXPECTED_SHA" "$EXPECTED_IMAGE" >/dev/null 2>&1; then
  echo 'Failed in-container health endpoint was accepted.' >&2; exit 1
fi

new_fixture timeout
if env PATH="$FIXTURE/bin:$PATH" DOCKER_EVENTS="$DOCKER_EVENTS" SLEEP_EVENTS="$SLEEP_EVENTS" \
  HEALTH_COUNT_FILE="$HEALTH_COUNT_FILE" HEALTH_SEQUENCE=starting \
  bash "$HEALTH_WAITER" "$EXPECTED_SHA" "$EXPECTED_IMAGE" >/dev/null 2>&1; then
  echo 'Health timeout was accepted.' >&2; exit 1
fi
[[ "$(wc -l < "$SLEEP_EVENTS")" -eq 29 ]] || { echo 'Timeout polling did not use exactly 30 samples.' >&2; exit 1; }

echo 'Production app container health wait regression fixture passed.'
