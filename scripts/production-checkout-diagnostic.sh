#!/usr/bin/env bash

# Read-only inspector for the production checkout, fixed runtime, and public
# maintenance state. Inputs are provided by the fixed GitHub workflow over SSH
# stdin; secret values, arbitrary paths, and response bodies are never emitted.
set -uo pipefail
export LC_ALL=C
export GIT_OPTIONAL_LOCKS=0
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR \
  GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_PARAMETERS

emit() {
  printf '%s=%s\n' "$1" "$2"
}

bool() {
  if [[ "$1" == 1 ]]; then printf 'yes'; else printf 'no'; fi
}

count_nul_records() {
  local count=0 record
  while IFS= read -r -d '' record; do
    count=$((count + 1))
  done
  printf '%s' "$count"
}

safe_path_sample() {
  local count=0 path='' lower_path='' safe_path=''
  while IFS= read -r -d '' path; do
    if (( count < 20 )); then
      if (( count > 0 )); then printf ';'; fi
      lower_path="${path,,}"
      case "$lower_path" in
        .*|*/.*|*secret*|*credential*|*password*|*token*|*private*|*config*|*runtime*|*backup*|*.pem|*.key|*.crt|*.p12|*.pfx|*.sql|*.dump|*.db|*.sqlite|*.env|*.env.*)
          safe_path='[redacted]'
          ;;
        *)
          safe_path="${path//[^A-Za-z0-9._\/+@-]/?}"
          ;;
      esac
      printf '%s' "$safe_path"
    fi
    count=$((count + 1))
  done
  if (( count == 0 )); then printf 'none'; elif (( count > 20 )); then printf ';[additional paths omitted]'; fi
}

git_ro() {
  GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false -c core.untrackedCache=false "$@"
}

stat_fields() {
  stat -Lc '%u %g %a' -- "$1" 2>/dev/null || printf 'unavailable unavailable unavailable'
}

if [[ ! "${DEPLOY_PATH_B64:-}" =~ ^[A-Za-z0-9+/]+={0,2}$ ]]; then
  emit diagnostic_status invalid_path_input
  exit 2
fi

if [[ ! "${APP_HOST_B64:-}" =~ ^[A-Za-z0-9+/]+={0,2}$ ]]; then
  emit diagnostic_status invalid_app_host_input
  exit 2
fi

APP_HOST="$(printf '%s' "$APP_HOST_B64" | base64 --decode 2>/dev/null)" || {
  emit diagnostic_status invalid_app_host_input
  exit 2
}
if [[ ! "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  emit diagnostic_status invalid_app_host_input
  exit 2
fi

DEPLOY_PATH="$(printf '%s' "$DEPLOY_PATH_B64" | base64 --decode 2>/dev/null)" || {
  emit diagnostic_status invalid_path_input
  exit 2
}
if [[ "$DEPLOY_PATH" != /* || "$DEPLOY_PATH" == *$'\n'* || "$DEPLOY_PATH" == *$'\r'* ]]; then
  emit diagnostic_status invalid_path_input
  exit 2
fi

DEPLOY_EXISTS=0
DEPLOY_IS_DIR=0
DEPLOY_IS_SYMLINK=0
DEPLOY_HAS_TRAILING_SLASH=0
DEPLOY_NORMALIZED=""
if [[ -e "$DEPLOY_PATH" || -L "$DEPLOY_PATH" ]]; then DEPLOY_EXISTS=1; fi
if [[ -d "$DEPLOY_PATH" ]]; then DEPLOY_IS_DIR=1; fi
if [[ -L "$DEPLOY_PATH" ]]; then DEPLOY_IS_SYMLINK=1; fi
if [[ "$DEPLOY_PATH" == */ ]]; then DEPLOY_HAS_TRAILING_SLASH=1; fi
DEPLOY_NORMALIZED="$(realpath -m -- "$DEPLOY_PATH" 2>/dev/null || true)"
DEPLOY_NORMALIZED_DIFFERS=0
if [[ -n "$DEPLOY_NORMALIZED" && "$DEPLOY_NORMALIZED" != "$DEPLOY_PATH" ]]; then DEPLOY_NORMALIZED_DIFFERS=1; fi

DEPLOY_HAS_SYMLINK_COMPONENT=0
path_parts=()
IFS='/' read -r -a path_parts <<< "$DEPLOY_PATH"
path_prefix=''
path_component=''
for path_component in "${path_parts[@]}"; do
  [[ -n "$path_component" ]] || continue
  if [[ "$path_component" == . || "$path_component" == .. ]]; then continue; fi
  if [[ "$path_prefix" == '' ]]; then path_prefix="/$path_component"; else path_prefix="$path_prefix/$path_component"; fi
  if [[ -L "$path_prefix" ]]; then DEPLOY_HAS_SYMLINK_COMPONENT=1; fi
done

GIT_ROOT="$(git_ro -C "$DEPLOY_PATH" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$GIT_ROOT" ]]; then
  emit diagnostic_status no_git_worktree_at_configured_path
  emit deploy_path_exists "$(bool "$DEPLOY_EXISTS")"
  emit deploy_path_is_directory "$(bool "$DEPLOY_IS_DIR")"
  emit deploy_path_is_symlink "$(bool "$DEPLOY_IS_SYMLINK")"
  emit deploy_path_has_symlink_component "$(bool "$DEPLOY_HAS_SYMLINK_COMPONENT")"
  emit deploy_path_has_trailing_slash "$(bool "$DEPLOY_HAS_TRAILING_SLASH")"
  emit deploy_path_normalization_changes_value "$(bool "$DEPLOY_NORMALIZED_DIFFERS")"
  emit effective_uid "$(id -u 2>/dev/null || printf unavailable)"
  read -r DEPLOY_UID DEPLOY_GID DEPLOY_MODE <<< "$(stat_fields "$DEPLOY_PATH")"
  emit deploy_path_uid "$DEPLOY_UID"
  emit deploy_path_gid "$DEPLOY_GID"
  emit deploy_path_mode "$DEPLOY_MODE"
  emit deploy_path_readable "$(bool "$([[ -r "$DEPLOY_PATH" ]] && echo 1 || echo 0)")"
  emit deploy_path_writable "$(bool "$([[ -w "$DEPLOY_PATH" ]] && echo 1 || echo 0)")"
  exit 0
fi

GIT_ROOT_CANONICAL="$(realpath -e -- "$GIT_ROOT" 2>/dev/null || true)"
DEPLOY_CANONICAL="$(realpath -e -- "$DEPLOY_PATH" 2>/dev/null || true)"
LITERAL_MATCH=0
CANONICAL_MATCH=0
if [[ "$DEPLOY_PATH" == "$GIT_ROOT" ]]; then LITERAL_MATCH=1; fi
if [[ -n "$DEPLOY_CANONICAL" && -n "$GIT_ROOT_CANONICAL" && "$DEPLOY_CANONICAL" == "$GIT_ROOT_CANONICAL" ]]; then
  CANONICAL_MATCH=1
fi

HEAD_SHA="$(git_ro -C "$GIT_ROOT" rev-parse --verify HEAD 2>/dev/null || printf unavailable)"
BRANCH="$(git_ro -C "$GIT_ROOT" symbolic-ref -q --short HEAD 2>/dev/null || printf DETACHED)"
ORIGIN_MAIN_SHA="$(git_ro -C "$GIT_ROOT" rev-parse --verify refs/remotes/origin/main 2>/dev/null || printf unavailable)"
STATUS_RC=0
STATUS_OUTPUT="$(git_ro -C "$GIT_ROOT" status --porcelain=v1 --untracked-files=all 2>/dev/null)" || STATUS_RC=$?
STATUS_DIRTY=0
if [[ -n "$STATUS_OUTPUT" ]]; then STATUS_DIRTY=1; fi

UNSTAGED_TRACKED_COUNT="$(git_ro -C "$GIT_ROOT" diff --name-only --no-renames -z 2>/dev/null | count_nul_records)"
STAGED_TRACKED_COUNT="$(git_ro -C "$GIT_ROOT" diff --cached --name-only --no-renames -z 2>/dev/null | count_nul_records)"
UNTRACKED_COUNT="$(git_ro -C "$GIT_ROOT" ls-files --others --exclude-standard -z 2>/dev/null | count_nul_records)"
UNMERGED_RECORD_COUNT="$(git_ro -C "$GIT_ROOT" ls-files -u -z 2>/dev/null | count_nul_records)"

GIT_DIR="$(git_ro -C "$GIT_ROOT" rev-parse --absolute-git-dir 2>/dev/null || true)"
COMMON_DIR="$(git_ro -C "$GIT_ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
if [[ -n "$COMMON_DIR" && "$COMMON_DIR" != /* ]]; then COMMON_DIR="$GIT_ROOT/$COMMON_DIR"; fi
COMMON_DIR="$(realpath -e -- "$COMMON_DIR" 2>/dev/null || true)"
INDEX_PATH="$(git_ro -C "$GIT_ROOT" rev-parse --git-path index 2>/dev/null || true)"
if [[ -n "$INDEX_PATH" && "$INDEX_PATH" != /* ]]; then INDEX_PATH="$GIT_ROOT/$INDEX_PATH"; fi

WORKTREE_COUNT="$(git_ro -C "$GIT_ROOT" worktree list --porcelain 2>/dev/null | awk '$1 == "worktree" { count++ } END { print count + 0 }')"
IS_LINKED_WORKTREE=0
if [[ -n "$GIT_DIR" && -n "$COMMON_DIR" ]]; then
  GIT_DIR_CANONICAL="$(realpath -e -- "$GIT_DIR" 2>/dev/null || true)"
  if [[ -n "$GIT_DIR_CANONICAL" && "$GIT_DIR_CANONICAL" != "$COMMON_DIR" ]]; then IS_LINKED_WORKTREE=1; fi
fi

EUID_VALUE="$(id -u 2>/dev/null || printf unavailable)"
read -r DEPLOY_UID DEPLOY_GID DEPLOY_MODE <<< "$(stat_fields "$DEPLOY_PATH")"
read -r ROOT_UID ROOT_GID ROOT_MODE <<< "$(stat_fields "$GIT_ROOT")"
read -r GIT_DIR_UID GIT_DIR_GID GIT_DIR_MODE <<< "$(stat_fields "$GIT_DIR")"
read -r COMMON_UID COMMON_GID COMMON_MODE <<< "$(stat_fields "$COMMON_DIR")"
read -r INDEX_UID INDEX_GID INDEX_MODE <<< "$(stat_fields "$INDEX_PATH")"
CHECKOUT_CLEAN=0
if [[ "$STATUS_RC" == 0 && "$STATUS_DIRTY" == 0 ]]; then CHECKOUT_CLEAN=1; fi

emit diagnostic_status complete
emit deploy_path_exists "$(bool "$DEPLOY_EXISTS")"
emit deploy_path_is_directory "$(bool "$DEPLOY_IS_DIR")"
emit deploy_path_is_symlink "$(bool "$DEPLOY_IS_SYMLINK")"
emit deploy_path_has_symlink_component "$(bool "$DEPLOY_HAS_SYMLINK_COMPONENT")"
emit deploy_path_has_trailing_slash "$(bool "$DEPLOY_HAS_TRAILING_SLASH")"
emit deploy_path_normalization_changes_value "$(bool "$DEPLOY_NORMALIZED_DIFFERS")"
emit deploy_path_literal_matches_git_root "$(bool "$LITERAL_MATCH")"
emit deploy_path_canonical_matches_git_root "$(bool "$CANONICAL_MATCH")"
emit head_sha "$HEAD_SHA"
emit branch "$BRANCH"
emit origin_main_sha "$ORIGIN_MAIN_SHA"
emit worktree_count "$WORKTREE_COUNT"
emit is_linked_worktree "$(bool "$IS_LINKED_WORKTREE")"
emit status_exit_code "$STATUS_RC"
emit git_status_dirty "$(bool "$STATUS_DIRTY")"
emit checkout_clean_as_existing_guard "$(bool "$CHECKOUT_CLEAN")"
emit tracked_unstaged_path_count "$UNSTAGED_TRACKED_COUNT"
emit tracked_staged_path_count "$STAGED_TRACKED_COUNT"
emit untracked_path_count "$UNTRACKED_COUNT"
emit unmerged_index_record_count "$UNMERGED_RECORD_COUNT"
emit tracked_unstaged_path_sample "$(git_ro -C "$GIT_ROOT" diff --name-only --no-renames -z 2>/dev/null | safe_path_sample)"
emit tracked_staged_path_sample "$(git_ro -C "$GIT_ROOT" diff --cached --name-only --no-renames -z 2>/dev/null | safe_path_sample)"
emit untracked_path_sample "$(git_ro -C "$GIT_ROOT" ls-files --others --exclude-standard -z 2>/dev/null | safe_path_sample)"
emit effective_uid "$EUID_VALUE"
emit deploy_path_uid "$DEPLOY_UID"
emit deploy_path_gid "$DEPLOY_GID"
emit deploy_path_mode "$DEPLOY_MODE"
emit deploy_path_readable "$(bool "$([[ -r "$DEPLOY_PATH" ]] && echo 1 || echo 0)")"
emit deploy_path_searchable "$(bool "$([[ -x "$DEPLOY_PATH" ]] && echo 1 || echo 0)")"
emit deploy_path_writable "$(bool "$([[ -w "$DEPLOY_PATH" ]] && echo 1 || echo 0)")"
emit git_root_uid "$ROOT_UID"
emit git_root_gid "$ROOT_GID"
emit git_root_mode "$ROOT_MODE"
emit git_dir_uid "$GIT_DIR_UID"
emit git_dir_gid "$GIT_DIR_GID"
emit git_dir_mode "$GIT_DIR_MODE"
emit git_dir_writable "$(bool "$([[ -w "$GIT_DIR" ]] && echo 1 || echo 0)")"
emit git_common_dir_uid "$COMMON_UID"
emit git_common_dir_gid "$COMMON_GID"
emit git_common_dir_mode "$COMMON_MODE"
emit git_common_dir_writable "$(bool "$([[ -w "$COMMON_DIR" ]] && echo 1 || echo 0)")"
emit git_index_uid "$INDEX_UID"
emit git_index_gid "$INDEX_GID"
emit git_index_mode "$INDEX_MODE"
emit git_index_readable "$(bool "$([[ -r "$INDEX_PATH" ]] && echo 1 || echo 0)")"
emit git_index_writable "$(bool "$([[ -w "$INDEX_PATH" ]] && echo 1 || echo 0)")"
emit deploy_path_owner_matches_effective_user "$(bool "$([[ "$DEPLOY_UID" == "$EUID_VALUE" ]] && echo 1 || echo 0)")"
emit git_root_owner_matches_effective_user "$(bool "$([[ "$ROOT_UID" == "$EUID_VALUE" ]] && echo 1 || echo 0)")"
emit git_common_dir_owner_matches_effective_user "$(bool "$([[ "$COMMON_UID" == "$EUID_VALUE" ]] && echo 1 || echo 0)")"
emit git_index_owner_matches_effective_user "$(bool "$([[ "$INDEX_UID" == "$EUID_VALUE" ]] && echo 1 || echo 0)")"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  emit docker_daemon_available yes
  for container in bodycast-app-prod bodycast-db-prod gymbeam-caddy; do
    key="${container//-/_}"
    fields="$(docker inspect --format '{{.Id}}|{{.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.HostConfig.RestartPolicy.Name}}|{{index .Config.Labels "org.bodycast.release-sha"}}' "$container" 2>/dev/null)"
    inspect_status=$?
    if [[ "$inspect_status" -ne 0 || -z "$fields" ]]; then
      if container_names="$(docker ps -a --filter "name=^/${container}$" --format '{{.Names}}' 2>/dev/null)"; then
        if [[ -z "$container_names" ]]; then
          emit "${key}_found" no
        else
          emit "${key}_found" unknown
        fi
      else
        emit "${key}_found" unknown
      fi
      emit "${key}_state" unknown
      continue
    fi
    IFS='|' read -r container_id image_id container_state container_health restart_policy release_sha <<< "$fields"
    [[ "$container_id" =~ ^[a-f0-9]{64}$ ]] || container_id=unknown
    [[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || image_id=unknown
    case "$container_state" in running|created|restarting|paused|exited|dead|removing) ;; *) container_state=unknown ;; esac
    case "$container_health" in healthy|unhealthy|starting|none) ;; *) container_health=unknown ;; esac
    case "$restart_policy" in no|always|unless-stopped|on-failure) ;; *) restart_policy=unknown ;; esac
    [[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || release_sha=unknown
    emit "${key}_found" yes
    emit "${key}_container_id" "$container_id"
    emit "${key}_image_id" "$image_id"
    emit "${key}_state" "$container_state"
    emit "${key}_health" "$container_health"
    emit "${key}_restart_policy" "$restart_policy"
    emit "${key}_release_sha" "$release_sha"
  done
else
  emit docker_daemon_available no
  emit bodycast_app_prod_found unknown
  emit bodycast_db_prod_found unknown
  emit gymbeam_caddy_found unknown
fi

if command -v curl >/dev/null 2>&1; then
  curl --silent --show-error --max-time 10 --dump-header - "https://${APP_HOST}/" 2>/dev/null \
    | awk '
      BEGIN { in_headers = 1; status = "unavailable"; body_match = 0; maintenance_header = 0; no_store = 0 }
      /^HTTP\/[0-9.]+[[:space:]]+[0-9][0-9][0-9]/ { status = $2; in_headers = 1; next }
      in_headers && /^\r?$/ { in_headers = 0; next }
      in_headers && tolower($0) ~ /^x-bodycast-deploy-maintenance:/ { maintenance_header = 1; next }
      in_headers && tolower($0) ~ /^cache-control:/ && tolower($0) ~ /(^|[,:[:space:]])no-store([,;[:space:]]|$)/ { no_store = 1; next }
      !in_headers && $0 == "BodyCast is temporarily unavailable while the model is updated." { body_match = 1 }
      END {
        printf "public_https_status=%s\n", status
        printf "maintenance_header_present=%s\n", maintenance_header ? "yes" : "no"
        printf "maintenance_body_matches=%s\n", body_match ? "yes" : "no"
        printf "maintenance_cache_control_no_store=%s\n", no_store ? "yes" : "no"
      }
    '
  CURL_EXIT="${PIPESTATUS[0]}"
  emit public_https_probe_exit_code "$CURL_EXIT"
else
  emit public_https_probe_exit_code unavailable
  emit public_https_status unavailable
  emit maintenance_header_present unavailable
  emit maintenance_body_matches unavailable
  emit maintenance_cache_control_no_store unavailable
fi
