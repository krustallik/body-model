#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
INSPECTOR="$REPO_ROOT/scripts/production-checkout-diagnostic.sh"
IS_LINUX=0
if [[ "$(uname -s)" == Linux ]]; then IS_LINUX=1; fi
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/bodycast-checkout-diagnostic.XXXXXX")"
trap 'rm -rf -- "$FIXTURE_ROOT"' EXIT
FIXTURE_BIN="$FIXTURE_ROOT/bin"
mkdir -p "$FIXTURE_BIN"

cat > "$FIXTURE_BIN/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == info ]]; then
  [[ "${DOCKER_INFO_FAIL:-0}" == 0 ]] || exit 91
  exit 0
fi
if [[ "$1" == image ]]; then
  case "${2:-}" in
    ls)
      [[ "${DOCKER_IMAGE_LS_FAIL:-0}" == 0 ]] || exit 93
      [[ "${3:-}" == --no-trunc && "${4:-}" == --format && "${5:-}" == '{{.ID}}' \
        && "${6:-}" == bodycast-app:deploy-rollback && "$#" == 6 ]] || exit 94
      [[ -z "${DOCKER_IMAGE_LIST_OUTPUT:-}" ]] || printf '%s\n' "$DOCKER_IMAGE_LIST_OUTPUT"
      exit 0
      ;;
    inspect)
      [[ "${DOCKER_IMAGE_INSPECT_FAIL:-0}" == 0 ]] || exit 95
      [[ "${3:-}" == --format && "${4:-}" == '{{.Id}}' \
        && "${5:-}" == bodycast-app:deploy-rollback && "$#" == 5 ]] || exit 96
      printf '%s\n' "${DOCKER_IMAGE_INSPECT_OUTPUT:-sha256:1111111111111111111111111111111111111111111111111111111111111111}"
      exit 0
      ;;
    *) exit 97 ;;
  esac
fi
if [[ "$1" == ps ]]; then
  [[ "${DOCKER_PS_FAIL:-0}" == 0 ]] || exit 91
  requested=""
  case "${4:-}" in
    name=^/bodycast-app-prod$) requested=bodycast-app-prod ;;
    name=^/bodycast-db-prod$) requested=bodycast-db-prod ;;
    name=^/gymbeam-caddy$) requested=gymbeam-caddy ;;
    *) exit 92 ;;
  esac
  [[ "${DOCKER_PS_PRESENT:-}" == "$requested" ]] && printf '%s\n' "$requested"
  exit 0
fi
[[ "$1" == inspect ]] || exit 90
container="${@: -1}"
[[ "${DOCKER_INSPECT_FAIL:-}" != "$container" ]] || exit 1
case "$container" in
  bodycast-app-prod)
    printf '%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|running|healthy|unless-stopped|1111111111111111111111111111111111111111'
    ;;
  bodycast-db-prod)
    printf '%s\n' 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc|sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd|running|healthy|unless-stopped|'
    ;;
  gymbeam-caddy)
    printf '%s\n' 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee|sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff|running|none|unless-stopped|'
    ;;
  *) exit 1 ;;
esac
DOCKER

cat > "$FIXTURE_BIN/curl" <<'CURL'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$CURL_EVENTS"
case "$*" in
  *'/api/health'*)
    printf '%s\n%s\n' "${FIXTURE_API_HEALTH_BODY:-{\"status\":\"ok\"}}" "${FIXTURE_API_HEALTH_STATUS:-200}"
    ;;
  *'--write-out'*)
    ui_url="${*: -1}"
    if [[ "$ui_url" == 'https://bodycast.example.test/' ]]; then
      printf 'HTTP/2 307\r\nLocation: %s\r\n\r\n__BODYCAST_UI_RESULT__307|text/html; charset=utf-8' "${FIXTURE_UI_REDIRECT_LOCATION:-/login}"
    elif [[ "$ui_url" == 'https://bodycast.example.test/login' ]]; then
      printf 'HTTP/2 %s\r\nContent-Type: %s\r\n\r\n__BODYCAST_UI_RESULT__%s|%s' \
        "${FIXTURE_UI_FINAL_STATUS:-200}" "${FIXTURE_UI_CONTENT_TYPE:-text/html; charset=utf-8}" \
        "${FIXTURE_UI_FINAL_STATUS:-200}" "${FIXTURE_UI_CONTENT_TYPE:-text/html; charset=utf-8}"
    else
      printf 'HTTP/2 404\r\n\r\n__BODYCAST_UI_RESULT__404|text/plain'
    fi
    ;;
  *)
cat <<'RESPONSE'
HTTP/2 503
Cache-Control: no-store
X-BodyCast-Deploy-Maintenance: fixture-marker-secret

BodyCast is temporarily unavailable while the model is updated.
RESPONSE
    ;;
esac
CURL
chmod +x "$FIXTURE_BIN/docker" "$FIXTURE_BIN/curl"
: > "$FIXTURE_ROOT/curl-events"

TEST_REPO="$FIXTURE_ROOT/repo"
mkdir -p "$TEST_REPO"
git -C "$TEST_REPO" init --quiet
git -C "$TEST_REPO" config user.name 'BodyCast diagnostic test'
git -C "$TEST_REPO" config user.email 'diagnostic-test@example.invalid'
printf 'tracked baseline\n' > "$TEST_REPO/tracked.txt"
git -C "$TEST_REPO" add tracked.txt
git -C "$TEST_REPO" commit --quiet -m 'fixture baseline'

assert_field() {
  local report="$1" field="$2" expected="$3" actual
  actual="$(printf '%s\n' "$report" | awk -F= -v wanted="$field" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }')"
  if [[ "$actual" != "$expected" ]]; then
    printf 'Expected %s=%s, got %s\n' "$field" "$expected" "${actual:-<missing>}" >&2
    exit 1
  fi
}

run_inspector() {
  local path="$1"
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null PATH="$FIXTURE_BIN:$PATH" \
    CURL_EVENTS="$FIXTURE_ROOT/curl-events" \
    DOCKER_INSPECT_FAIL="${DOCKER_INSPECT_FAIL:-}" \
    DOCKER_PS_PRESENT="${DOCKER_PS_PRESENT:-}" \
    DOCKER_PS_FAIL="${DOCKER_PS_FAIL:-0}" \
    DOCKER_INFO_FAIL="${DOCKER_INFO_FAIL:-0}" \
    DOCKER_IMAGE_LS_FAIL="${DOCKER_IMAGE_LS_FAIL:-0}" \
    DOCKER_IMAGE_LIST_OUTPUT="${DOCKER_IMAGE_LIST_OUTPUT-sha256:1111111111111111111111111111111111111111111111111111111111111111}" \
    DOCKER_IMAGE_INSPECT_FAIL="${DOCKER_IMAGE_INSPECT_FAIL:-0}" \
    DOCKER_IMAGE_INSPECT_OUTPUT="${DOCKER_IMAGE_INSPECT_OUTPUT:-sha256:1111111111111111111111111111111111111111111111111111111111111111}" \
    FIXTURE_API_HEALTH_STATUS="${FIXTURE_API_HEALTH_STATUS:-200}" \
    FIXTURE_API_HEALTH_BODY="${FIXTURE_API_HEALTH_BODY:-{\"status\":\"ok\"}}" \
    FIXTURE_UI_FINAL_STATUS="${FIXTURE_UI_FINAL_STATUS:-200}" \
    FIXTURE_UI_CONTENT_TYPE="${FIXTURE_UI_CONTENT_TYPE:-text/html; charset=utf-8}" \
    FIXTURE_UI_REDIRECT_LOCATION="${FIXTURE_UI_REDIRECT_LOCATION:-/login}" \
    APP_HOST_B64="$(printf '%s' 'bodycast.example.test' | base64 -w0)" \
    DEPLOY_PATH_B64="$(printf '%s' "$path" | base64 -w0)" bash "$INSPECTOR"
}

INDEX_BEFORE="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
CLEAN_REPORT="$(run_inspector "$TEST_REPO")"
INDEX_AFTER="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
[[ "$INDEX_BEFORE" == "$INDEX_AFTER" ]] || { echo 'Read-only status inspection changed the Git index.' >&2; exit 1; }
assert_field "$CLEAN_REPORT" diagnostic_status complete
if [[ "$IS_LINUX" == 1 ]]; then
  assert_field "$CLEAN_REPORT" deploy_path_literal_matches_git_root yes
  assert_field "$CLEAN_REPORT" deploy_path_canonical_matches_git_root yes
fi
assert_field "$CLEAN_REPORT" checkout_clean_as_existing_guard yes
assert_field "$CLEAN_REPORT" status_exit_code 0
assert_field "$CLEAN_REPORT" tracked_unstaged_path_count 0
assert_field "$CLEAN_REPORT" tracked_staged_path_count 0
assert_field "$CLEAN_REPORT" untracked_path_count 0
assert_field "$CLEAN_REPORT" docker_daemon_available yes
assert_field "$CLEAN_REPORT" bodycast_app_prod_found yes
assert_field "$CLEAN_REPORT" bodycast_app_prod_state running
assert_field "$CLEAN_REPORT" bodycast_app_prod_health healthy
assert_field "$CLEAN_REPORT" bodycast_app_prod_release_sha 1111111111111111111111111111111111111111
assert_field "$CLEAN_REPORT" bodycast_db_prod_health healthy
assert_field "$CLEAN_REPORT" gymbeam_caddy_state running
assert_field "$CLEAN_REPORT" deploy_rollback_pin_state present
assert_field "$CLEAN_REPORT" deploy_rollback_pin_image_id sha256:1111111111111111111111111111111111111111111111111111111111111111
assert_field "$CLEAN_REPORT" public_https_status 503
assert_field "$CLEAN_REPORT" maintenance_header_present yes
assert_field "$CLEAN_REPORT" maintenance_body_matches yes
assert_field "$CLEAN_REPORT" maintenance_cache_control_no_store yes
assert_field "$CLEAN_REPORT" public_https_probe_exit_code 0
assert_field "$CLEAN_REPORT" public_api_health_status 200
assert_field "$CLEAN_REPORT" public_api_health_body_matches yes
assert_field "$CLEAN_REPORT" public_api_health_probe_exit_code 0
assert_field "$CLEAN_REPORT" public_ui_status 200
assert_field "$CLEAN_REPORT" public_ui_html_response yes
assert_field "$CLEAN_REPORT" public_ui_origin_matches_app_host yes
assert_field "$CLEAN_REPORT" public_ui_redirect_blocked no
assert_field "$CLEAN_REPORT" public_ui_probe_exit_code 0
UI_CURL_EVENT="$(grep -F -- '--dump-header -' "$FIXTURE_ROOT/curl-events" || true)"
[[ -n "$UI_CURL_EVENT" && "$UI_CURL_EVENT" != *'--location'* && "$UI_CURL_EVENT" != *'--location-trusted'* ]] || {
  echo 'UI probe must validate each redirect before following it.' >&2
  exit 1
}
if [[ "$CLEAN_REPORT" == *'bodycast.example.test'* || "$CLEAN_REPORT" == *'fixture-marker-secret'* || "$CLEAN_REPORT" == *'BodyCast is temporarily unavailable'* ]]; then
  echo 'Runtime diagnostic exposed the hostname, marker value, or raw HTTP body.' >&2
  exit 1
fi

PIN_ABSENT_REPORT="$(DOCKER_IMAGE_LIST_OUTPUT= run_inspector "$TEST_REPO")"
assert_field "$PIN_ABSENT_REPORT" deploy_rollback_pin_state absent
assert_field "$PIN_ABSENT_REPORT" deploy_rollback_pin_image_id unavailable

PIN_LIST_ERROR_REPORT="$(DOCKER_IMAGE_LS_FAIL=1 run_inspector "$TEST_REPO")"
assert_field "$PIN_LIST_ERROR_REPORT" deploy_rollback_pin_state unknown

PIN_MULTIPLE_ROWS_REPORT="$(DOCKER_IMAGE_LIST_OUTPUT=$'sha256:1111111111111111111111111111111111111111111111111111111111111111\nsha256:2222222222222222222222222222222222222222222222222222222222222222' run_inspector "$TEST_REPO")"
assert_field "$PIN_MULTIPLE_ROWS_REPORT" deploy_rollback_pin_state unknown
assert_field "$PIN_MULTIPLE_ROWS_REPORT" deploy_rollback_pin_image_id unavailable

PIN_INSPECT_ERROR_REPORT="$(DOCKER_IMAGE_INSPECT_FAIL=1 run_inspector "$TEST_REPO")"
assert_field "$PIN_INSPECT_ERROR_REPORT" deploy_rollback_pin_state unknown

PIN_ID_MISMATCH_REPORT="$(DOCKER_IMAGE_INSPECT_OUTPUT='sha256:2222222222222222222222222222222222222222222222222222222222222222' run_inspector "$TEST_REPO")"
assert_field "$PIN_ID_MISMATCH_REPORT" deploy_rollback_pin_state unknown
assert_field "$PIN_ID_MISMATCH_REPORT" deploy_rollback_pin_image_id unavailable

PIN_MALFORMED_REPORT="$(DOCKER_IMAGE_INSPECT_OUTPUT='secret-raw-docker-error' run_inspector "$TEST_REPO")"
assert_field "$PIN_MALFORMED_REPORT" deploy_rollback_pin_state unknown
assert_field "$PIN_MALFORMED_REPORT" deploy_rollback_pin_image_id unavailable
if [[ "$PIN_MALFORMED_REPORT" == *'secret-raw-docker-error'* ]]; then
  echo 'Malformed Docker output leaked into the diagnostic.' >&2
  exit 1
fi

DOCKER_UNAVAILABLE_REPORT="$(DOCKER_INFO_FAIL=1 run_inspector "$TEST_REPO")"
assert_field "$DOCKER_UNAVAILABLE_REPORT" docker_daemon_available no
assert_field "$DOCKER_UNAVAILABLE_REPORT" deploy_rollback_pin_state unknown

API_FAILURE_REPORT="$(FIXTURE_API_HEALTH_STATUS=503 FIXTURE_API_HEALTH_BODY='{"status":"error","private":"do-not-print"}' run_inspector "$TEST_REPO")"
assert_field "$API_FAILURE_REPORT" public_api_health_status 503
assert_field "$API_FAILURE_REPORT" public_api_health_body_matches no
if [[ "$API_FAILURE_REPORT" == *'do-not-print'* ]]; then
  echo 'API diagnostic leaked response body content.' >&2
  exit 1
fi

: > "$FIXTURE_ROOT/curl-events"
UI_EXTERNAL_REDIRECT_REPORT="$(FIXTURE_UI_REDIRECT_LOCATION='https://other.example.test/login' run_inspector "$TEST_REPO")"
EXTERNAL_REDIRECT_CURL_EVENTS="$(cat "$FIXTURE_ROOT/curl-events")"
assert_field "$UI_EXTERNAL_REDIRECT_REPORT" public_ui_status 307
assert_field "$UI_EXTERNAL_REDIRECT_REPORT" public_ui_html_response no
assert_field "$UI_EXTERNAL_REDIRECT_REPORT" public_ui_origin_matches_app_host no
assert_field "$UI_EXTERNAL_REDIRECT_REPORT" public_ui_redirect_blocked yes
assert_field "$UI_EXTERNAL_REDIRECT_REPORT" public_ui_probe_exit_code 47
if [[ "$UI_EXTERNAL_REDIRECT_REPORT" == *'other.example.test'* ]]; then
  echo 'UI diagnostic leaked an effective redirect host.' >&2
  exit 1
fi
if [[ "$EXTERNAL_REDIRECT_CURL_EVENTS" == *'https://other.example.test'* ]]; then
  echo 'UI diagnostic followed a redirect to another host.' >&2
  exit 1
fi

UI_UNHEALTHY_REPORT="$(FIXTURE_UI_FINAL_STATUS=503 run_inspector "$TEST_REPO")"
assert_field "$UI_UNHEALTHY_REPORT" public_ui_status 503
assert_field "$UI_UNHEALTHY_REPORT" public_ui_html_response yes

INSPECT_ERROR_PRESENT_REPORT="$(DOCKER_INSPECT_FAIL=bodycast-db-prod DOCKER_PS_PRESENT=bodycast-db-prod run_inspector "$TEST_REPO")"
assert_field "$INSPECT_ERROR_PRESENT_REPORT" bodycast_db_prod_found unknown
assert_field "$INSPECT_ERROR_PRESENT_REPORT" bodycast_db_prod_state unknown

INSPECT_ERROR_ABSENT_REPORT="$(DOCKER_INSPECT_FAIL=bodycast-db-prod run_inspector "$TEST_REPO")"
assert_field "$INSPECT_ERROR_ABSENT_REPORT" bodycast_db_prod_found no

INSPECT_AND_LIST_ERROR_REPORT="$(DOCKER_INSPECT_FAIL=bodycast-db-prod DOCKER_PS_FAIL=1 run_inspector "$TEST_REPO")"
assert_field "$INSPECT_AND_LIST_ERROR_REPORT" bodycast_db_prod_found unknown

TRAILING_REPORT="$(run_inspector "$TEST_REPO/")"
assert_field "$TRAILING_REPORT" deploy_path_has_trailing_slash yes
if [[ "$IS_LINUX" == 1 ]]; then
  assert_field "$TRAILING_REPORT" deploy_path_literal_matches_git_root no
  assert_field "$TRAILING_REPORT" deploy_path_canonical_matches_git_root yes
fi
assert_field "$TRAILING_REPORT" checkout_clean_as_existing_guard yes

if [[ "$IS_LINUX" == 1 ]] && ln -s "$TEST_REPO" "$FIXTURE_ROOT/repo-link" 2>/dev/null; then
  SYMLINK_REPORT="$(run_inspector "$FIXTURE_ROOT/repo-link")"
  assert_field "$SYMLINK_REPORT" deploy_path_is_symlink yes
  assert_field "$SYMLINK_REPORT" deploy_path_has_symlink_component yes
  assert_field "$SYMLINK_REPORT" deploy_path_canonical_matches_git_root yes
fi

printf 'tracked changed\n' > "$TEST_REPO/tracked.txt"
printf 'untracked\n' > "$TEST_REPO/untracked.txt"
INDEX_BEFORE_DIRTY="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
DIRTY_REPORT="$(run_inspector "$TEST_REPO")"
INDEX_AFTER_DIRTY="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
[[ "$INDEX_BEFORE_DIRTY" == "$INDEX_AFTER_DIRTY" ]] || { echo 'Dirty status inspection changed the Git index.' >&2; exit 1; }
assert_field "$DIRTY_REPORT" checkout_clean_as_existing_guard no
assert_field "$DIRTY_REPORT" tracked_unstaged_path_count 1
assert_field "$DIRTY_REPORT" tracked_staged_path_count 0
assert_field "$DIRTY_REPORT" untracked_path_count 1
assert_field "$DIRTY_REPORT" tracked_unstaged_path_sample tracked.txt
assert_field "$DIRTY_REPORT" untracked_path_sample untracked.txt

git -C "$TEST_REPO" add tracked.txt
printf 'secret-like name\n' > "$TEST_REPO/.env.production"
INDEX_BEFORE_STAGED="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
STAGED_REPORT="$(run_inspector "$TEST_REPO")"
INDEX_AFTER_STAGED="$(sha256sum "$TEST_REPO/.git/index" | awk '{print $1}')"
[[ "$INDEX_BEFORE_STAGED" == "$INDEX_AFTER_STAGED" ]] || { echo 'Staged status inspection changed the Git index.' >&2; exit 1; }
assert_field "$STAGED_REPORT" checkout_clean_as_existing_guard no
assert_field "$STAGED_REPORT" tracked_staged_path_count 1
assert_field "$STAGED_REPORT" untracked_path_count 2
assert_field "$STAGED_REPORT" tracked_staged_path_sample tracked.txt
UNTRACKED_SAMPLE="$(printf '%s\n' "$STAGED_REPORT" | awk -F= '$1 == "untracked_path_sample" { sub(/^[^=]*=/, ""); print; exit }')"
[[ "$UNTRACKED_SAMPLE" == *'untracked.txt'* && "$UNTRACKED_SAMPLE" == *'[redacted]'* ]] || {
  echo 'Expected safe untracked path and redaction marker in diagnostic sample.' >&2; exit 1;
}
if [[ "$STAGED_REPORT" == *'.env.production'* ]]; then
  echo 'Sensitive-looking filename was not redacted from diagnostic output.' >&2
  exit 1
fi

echo 'Production checkout diagnostic fixture passed.'
