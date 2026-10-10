#!/usr/bin/env bash
# Host-persistent state for the incompatible-schema maintenance cutover.
set -Eeuo pipefail

BODYCAST_RELEASE_MARKER_DIRECTORY="$(git rev-parse --absolute-git-dir)/bodycast-production-release-marker"
BODYCAST_RELEASE_MARKER_PATH="$BODYCAST_RELEASE_MARKER_DIRECTORY/marker"
BODYCAST_RELEASE_MARKER_LEGACY_PATH="$(git rev-parse --absolute-git-dir)/bodycast-production-schema-cutover"
readonly BODYCAST_RECOVERY_MARKER_V2_PATH="/var/lib/bodycast/recovery/marker-v2.json"
BODYCAST_MARKER_MANIFEST_ID=""
BODYCAST_MARKER_RELEASE_SHA=""
BODYCAST_MARKER_STATE=""
BODYCAST_MARKER_SCHEMA_VERSION=""
BODYCAST_MARKER_WORKFLOW_RUN_ID=""
BODYCAST_MARKER_WORKFLOW_RUN_ATTEMPT=""
BODYCAST_MARKER_AUTHORIZATION_ID=""
BODYCAST_MARKER_LINEAGE_DIGEST=""
BODYCAST_MARKER_SPAWN_STATE=""
BODYCAST_MARKER_FILE_PATH=""

read_bodycast_release_marker() {
  if [[ -e "$BODYCAST_RECOVERY_MARKER_V2_PATH" || -L "$BODYCAST_RECOVERY_MARKER_V2_PATH" ]]; then
    echo "Production recovery marker V2 exists; ordinary release operations are blocked." >&2
    return 2
  fi
  local new_exists=false legacy_exists=false marker_file
  [[ -e "$BODYCAST_RELEASE_MARKER_PATH" || -L "$BODYCAST_RELEASE_MARKER_PATH" ]] && new_exists=true
  [[ -e "$BODYCAST_RELEASE_MARKER_LEGACY_PATH" || -L "$BODYCAST_RELEASE_MARKER_LEGACY_PATH" ]] && legacy_exists=true
  if [[ "$new_exists" == true && "$legacy_exists" == true ]]; then
    echo "Both current and legacy production release markers exist; state is ambiguous." >&2
    return 2
  fi
  if [[ "$new_exists" == true ]]; then marker_file="$BODYCAST_RELEASE_MARKER_PATH"
  elif [[ "$legacy_exists" == true ]]; then marker_file="$BODYCAST_RELEASE_MARKER_LEGACY_PATH"
  else return 1
  fi
  [[ -f "$marker_file" && ! -L "$marker_file" ]] || { echo "Production release marker is not a regular file." >&2; return 2; }
  local -a lines=()
  mapfile -t lines < "$marker_file"
  BODYCAST_MARKER_SCHEMA_VERSION="${lines[0]#schemaVersion=}"
  BODYCAST_MARKER_MANIFEST_ID=""
  BODYCAST_MARKER_RELEASE_SHA=""
  BODYCAST_MARKER_STATE=""
  BODYCAST_MARKER_WORKFLOW_RUN_ID=""
  BODYCAST_MARKER_WORKFLOW_RUN_ATTEMPT=""
  BODYCAST_MARKER_AUTHORIZATION_ID=""
  BODYCAST_MARKER_LINEAGE_DIGEST=""
  BODYCAST_MARKER_SPAWN_STATE=""
  if [[ "${#lines[@]}" -eq 4 && "${lines[0]}" == "schemaVersion=1" ]]; then
    [[ "${lines[1]}" == manifestId=* && "${lines[2]}" == releaseSha=* && "${lines[3]}" == state=* ]] || {
      echo "Production release marker has unsupported fields." >&2; return 2;
    }
    BODYCAST_MARKER_MANIFEST_ID="${lines[1]#manifestId=}"
    BODYCAST_MARKER_RELEASE_SHA="${lines[2]#releaseSha=}"
    BODYCAST_MARKER_STATE="${lines[3]#state=}"
  elif [[ "${#lines[@]}" -eq 9 && "${lines[0]}" == "schemaVersion=2" ]]; then
    [[ "${lines[1]}" == manifestId=* && "${lines[2]}" == releaseSha=* && "${lines[3]}" == state=* \
      && "${lines[4]}" == workflowRunId=* && "${lines[5]}" == workflowRunAttempt=* \
      && "${lines[6]}" == authorizationId=* && "${lines[7]}" == lineageDigest=* \
      && "${lines[8]}" == spawnState=* ]] || { echo "Production release marker V2 has unsupported fields." >&2; return 2; }
    BODYCAST_MARKER_MANIFEST_ID="${lines[1]#manifestId=}"
    BODYCAST_MARKER_RELEASE_SHA="${lines[2]#releaseSha=}"
    BODYCAST_MARKER_STATE="${lines[3]#state=}"
    BODYCAST_MARKER_WORKFLOW_RUN_ID="${lines[4]#workflowRunId=}"
    BODYCAST_MARKER_WORKFLOW_RUN_ATTEMPT="${lines[5]#workflowRunAttempt=}"
    BODYCAST_MARKER_AUTHORIZATION_ID="${lines[6]#authorizationId=}"
    BODYCAST_MARKER_LINEAGE_DIGEST="${lines[7]#lineageDigest=}"
    BODYCAST_MARKER_SPAWN_STATE="${lines[8]#spawnState=}"
    [[ "$BODYCAST_MARKER_WORKFLOW_RUN_ID" =~ ^[1-9][0-9]*$ \
      && "$BODYCAST_MARKER_WORKFLOW_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ \
      && "$BODYCAST_MARKER_AUTHORIZATION_ID" =~ ^[A-Za-z0-9-]{16,80}$ \
      && "$BODYCAST_MARKER_LINEAGE_DIGEST" =~ ^[a-f0-9]{64}$ \
      && "$BODYCAST_MARKER_SPAWN_STATE" =~ ^(not-started|started)$ ]] || {
      echo "Production release marker V2 lineage is malformed." >&2; return 2;
    }
  else
    echo "Production release marker is malformed or unsupported." >&2; return 2
  fi
  [[ "$BODYCAST_MARKER_MANIFEST_ID" == "active-energy-unified-v2" \
    && ( "$BODYCAST_MARKER_SCHEMA_VERSION" == 1 || "$BODYCAST_MARKER_SCHEMA_VERSION" == 2 ) \
    && ( "$BODYCAST_MARKER_RELEASE_SHA" =~ ^[a-f0-9]{40}$ || "$BODYCAST_MARKER_RELEASE_SHA" == "unknown" ) \
    && "$BODYCAST_MARKER_STATE" =~ ^(ddl-starting|ddl-started|schema-applied|app-ready|v4-ready|database-restored|rollback-app-ready|forward-resume-armed)$ ]] || {
    echo "Production release marker values are not recognized." >&2; return 2;
  }
  if [[ "$BODYCAST_MARKER_SCHEMA_VERSION" == 2 ]]; then
    [[ "$BODYCAST_MARKER_STATE" == "ddl-starting" && "$BODYCAST_MARKER_SPAWN_STATE" == "not-started" \
      || ( "$BODYCAST_MARKER_STATE" =~ ^(ddl-started|schema-applied|app-ready|v4-ready)$ && "$BODYCAST_MARKER_SPAWN_STATE" == "started" ) \
      || "$BODYCAST_MARKER_STATE" == "forward-resume-armed" ]] || {
      echo "Production release marker spawn state is inconsistent." >&2; return 2;
    }
  fi
  BODYCAST_MARKER_FILE_PATH="$marker_file"
  return 0
}

bodycast_prepare_release_marker_directory() {
  local git_dir
  git_dir="$(git rev-parse --absolute-git-dir)"
  [[ -d "$git_dir" && ! -L "$git_dir" ]] || { echo "Git metadata directory is unavailable or unsafe." >&2; return 2; }
  if [[ ! -e "$BODYCAST_RELEASE_MARKER_DIRECTORY" && ! -L "$BODYCAST_RELEASE_MARKER_DIRECTORY" ]]; then
    mkdir -m 700 -- "$BODYCAST_RELEASE_MARKER_DIRECTORY"
    sync -f "$git_dir"
  fi
  [[ -d "$BODYCAST_RELEASE_MARKER_DIRECTORY" && ! -L "$BODYCAST_RELEASE_MARKER_DIRECTORY" \
    && "$(realpath -e "$BODYCAST_RELEASE_MARKER_DIRECTORY")" == "$BODYCAST_RELEASE_MARKER_DIRECTORY" ]] || {
    echo "Production release marker directory is not canonical." >&2; return 2;
  }
}

write_bodycast_release_marker() {
  local release_sha="$1" state="$2" current_state="" marker_status=1 target_path legacy=false
  [[ "$release_sha" =~ ^[a-f0-9]{40}$ && "$state" =~ ^(ddl-started|schema-applied|app-ready|v4-ready|database-restored|rollback-app-ready)$ ]] || {
    echo "Refusing invalid production release marker values." >&2; return 2;
  }
  if read_bodycast_release_marker; then
    marker_status=0
    [[ "$BODYCAST_MARKER_RELEASE_SHA" == "$release_sha" ]] || { echo "Production release marker belongs to another SHA." >&2; return 2; }
    current_state="$BODYCAST_MARKER_STATE"
    target_path="$BODYCAST_MARKER_FILE_PATH"
    [[ "$BODYCAST_MARKER_SCHEMA_VERSION" == 1 ]] && legacy=true
  else marker_status=$?; fi
  if [[ "$marker_status" -eq 1 ]]; then
    [[ "$state" == "ddl-started" ]] || { echo "Only a DDL marker may be created from an absent state." >&2; return 2; }
    target_path="$BODYCAST_RELEASE_MARKER_LEGACY_PATH"
    legacy=true
  elif [[ "$marker_status" -ne 0 ]]; then return 2
  elif [[ ! ( "$current_state" == "ddl-started" && "$state" == "schema-applied" ) \
    && ! ( "$current_state" == "schema-applied" && "$state" == "app-ready" ) \
    && ! ( "$current_state" == "app-ready" && ( "$state" == "app-ready" || "$state" == "v4-ready" ) ) \
    && ! ( "$current_state" == "v4-ready" && "$state" == "v4-ready" ) \
    && ! ( ( "$current_state" == "ddl-started" || "$current_state" == "schema-applied" || "$current_state" == "app-ready" || "$current_state" == "v4-ready" ) && "$state" == "database-restored" ) \
    && ! ( "$current_state" == "database-restored" && "$state" == "rollback-app-ready" ) ]]; then
    echo "Production release marker transition is invalid: ${current_state} -> ${state}." >&2; return 2
  fi
  local temporary
  temporary="$(mktemp "${target_path}.new.XXXXXX")"
  trap 'rm -f -- "$temporary"' RETURN
  chmod 600 "$temporary"
  if [[ "$legacy" == true ]]; then
    printf 'schemaVersion=1\nmanifestId=active-energy-unified-v2\nreleaseSha=%s\nstate=%s\n' "$release_sha" "$state" > "$temporary"
  else
    printf 'schemaVersion=2\nmanifestId=active-energy-unified-v2\nreleaseSha=%s\nstate=%s\nworkflowRunId=%s\nworkflowRunAttempt=%s\nauthorizationId=%s\nlineageDigest=%s\nspawnState=%s\n' \
      "$release_sha" "$state" "$BODYCAST_MARKER_WORKFLOW_RUN_ID" "$BODYCAST_MARKER_WORKFLOW_RUN_ATTEMPT" \
      "$BODYCAST_MARKER_AUTHORIZATION_ID" "$BODYCAST_MARKER_LINEAGE_DIGEST" "$BODYCAST_MARKER_SPAWN_STATE" > "$temporary"
  fi
  sync -f "$temporary"
  mv -f -- "$temporary" "$target_path"
  sync -f "$(dirname "$target_path")"
  trap - RETURN
}

write_bodycast_forward_resume_marker() {
  local source_sha="$1" release_sha="$2" run_id="$3" attempt="$4" authorization_id="$5" lineage_digest="$6" expected_source_digest="$7"
  local marker_status=1 current_digest temporary
  [[ "$source_sha" =~ ^[a-f0-9]{40}$ && "$release_sha" =~ ^[a-f0-9]{40}$ \
    && "$run_id" =~ ^[1-9][0-9]*$ && "$attempt" =~ ^[1-9][0-9]*$ \
    && "$authorization_id" =~ ^[A-Za-z0-9-]{16,80}$ && "$lineage_digest" =~ ^[a-f0-9]{64}$ \
    && "$expected_source_digest" =~ ^[a-f0-9]{64}$ ]] || {
    echo "Forward-resume marker lineage is malformed." >&2; return 2;
  }
  if read_bodycast_release_marker; then marker_status=0; else marker_status=$?; fi
  [[ "$marker_status" -eq 0 && "$BODYCAST_MARKER_SCHEMA_VERSION" == 1 \
    && "$BODYCAST_MARKER_RELEASE_SHA" == "$source_sha" && "$BODYCAST_MARKER_STATE" == "ddl-started" ]] || {
    echo "Forward-resume requires the exact legacy V1 ddl-started marker from the verified no-spawn failure." >&2; return 2;
  }
  current_digest="$(sha256sum "$BODYCAST_MARKER_FILE_PATH" | awk '{print $1}')"
  [[ "$current_digest" == "$expected_source_digest" ]] || { echo "Forward-resume source marker digest changed after verification." >&2; return 2; }
  bodycast_prepare_release_marker_directory
  temporary="$(mktemp "$BODYCAST_RELEASE_MARKER_PATH.new.XXXXXX")"
  trap 'rm -f -- "$temporary"' RETURN
  chmod 600 "$temporary"
  printf 'schemaVersion=2\nmanifestId=active-energy-unified-v2\nreleaseSha=%s\nstate=forward-resume-armed\nworkflowRunId=%s\nworkflowRunAttempt=%s\nauthorizationId=%s\nlineageDigest=%s\nspawnState=not-started\n' \
    "$release_sha" "$run_id" "$attempt" "$authorization_id" "$lineage_digest" > "$temporary"
  sync -f "$temporary"
  latest="$(sha256sum "$BODYCAST_MARKER_FILE_PATH" | awk '{print $1}')"
  [[ "$latest" == "$current_digest" ]] || { echo "Release marker changed during forward-resume lineage publication." >&2; return 2; }
  if [[ "$BODYCAST_MARKER_FILE_PATH" == "$BODYCAST_RELEASE_MARKER_PATH" ]]; then
    mv -f -- "$temporary" "$BODYCAST_RELEASE_MARKER_PATH"
  else
    ln -- "$temporary" "$BODYCAST_RELEASE_MARKER_PATH" || { echo "Current marker path is already occupied." >&2; return 2; }
    rm -- "$temporary"
  fi
  sync -f "$BODYCAST_RELEASE_MARKER_DIRECTORY"
  if [[ "$BODYCAST_MARKER_FILE_PATH" == "$BODYCAST_RELEASE_MARKER_LEGACY_PATH" ]]; then
    rm -- "$BODYCAST_RELEASE_MARKER_LEGACY_PATH"
    sync -f "$(dirname "$BODYCAST_RELEASE_MARKER_LEGACY_PATH")"
  fi
  trap - RETURN
}

clear_bodycast_release_marker() {
  read_bodycast_release_marker || { echo "Refusing to clear a missing or invalid production release marker." >&2; return 2; }
  rm -- "$BODYCAST_MARKER_FILE_PATH"
  sync -f "$(dirname "$BODYCAST_MARKER_FILE_PATH")"
}
