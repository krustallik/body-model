#!/usr/bin/env bash
# Host-persistent state for the incompatible-schema maintenance cutover.
set -Eeuo pipefail

BODYCAST_RELEASE_MARKER_PATH="$(git rev-parse --absolute-git-dir)/bodycast-production-schema-cutover"
# This fixed root-owned projection is the V2 blocking boundary. It is deliberately
# not configurable from the release environment or mutable checkout.
readonly BODYCAST_RECOVERY_MARKER_V2_PATH="/var/lib/bodycast/recovery/marker-v2.json"
BODYCAST_MARKER_MANIFEST_ID=""
BODYCAST_MARKER_RELEASE_SHA=""
BODYCAST_MARKER_STATE=""

read_bodycast_release_marker() {
  # Existence is blocking before parsing. An unreadable, malformed, future, or
  # recovery-state projection must never be mistaken for marker absence.
  if [[ -e "$BODYCAST_RECOVERY_MARKER_V2_PATH" || -L "$BODYCAST_RECOVERY_MARKER_V2_PATH" ]]; then
    echo "Production recovery marker V2 exists; ordinary release operations are blocked." >&2
    return 2
  fi
  [[ -e "$BODYCAST_RELEASE_MARKER_PATH" || -L "$BODYCAST_RELEASE_MARKER_PATH" ]] || return 1
  [[ -f "$BODYCAST_RELEASE_MARKER_PATH" && ! -L "$BODYCAST_RELEASE_MARKER_PATH" ]] || {
    echo "Production release marker is not a regular file." >&2; return 2;
  }
  local -a lines=()
  mapfile -t lines < "$BODYCAST_RELEASE_MARKER_PATH"
  [[ "${#lines[@]}" -eq 4 && "${lines[0]}" == "schemaVersion=1" ]] || {
    echo "Production release marker is malformed." >&2; return 2;
  }
  [[ "${lines[1]}" == manifestId=* && "${lines[2]}" == releaseSha=* && "${lines[3]}" == state=* ]] || {
    echo "Production release marker has unsupported fields." >&2; return 2;
  }
  BODYCAST_MARKER_MANIFEST_ID="${lines[1]#manifestId=}"
  BODYCAST_MARKER_RELEASE_SHA="${lines[2]#releaseSha=}"
  BODYCAST_MARKER_STATE="${lines[3]#state=}"
  [[ "$BODYCAST_MARKER_MANIFEST_ID" == "active-energy-unified-v2" \
    && "$BODYCAST_MARKER_RELEASE_SHA" =~ ^[a-f0-9]{40}$ \
    && "$BODYCAST_MARKER_STATE" =~ ^(ddl-started|schema-applied|app-ready)$ ]] || {
    echo "Production release marker values are not recognized." >&2; return 2;
  }
  return 0
}

write_bodycast_release_marker() {
  if [[ -e "$BODYCAST_RECOVERY_MARKER_V2_PATH" || -L "$BODYCAST_RECOVERY_MARKER_V2_PATH" ]]; then
    echo "Recovery marker V2 exists; ordinary release tooling cannot write a V1 marker." >&2
    return 2
  fi
  local release_sha="$1" state="$2"
  [[ "$release_sha" =~ ^[a-f0-9]{40}$ && "$state" =~ ^(ddl-started|schema-applied|app-ready)$ ]] || {
    echo "Refusing invalid production release marker values." >&2; return 2;
  }
  [[ -d "$(dirname "$BODYCAST_RELEASE_MARKER_PATH")" && ! -L "$(dirname "$BODYCAST_RELEASE_MARKER_PATH")" ]] || {
    echo "Production Git metadata directory is unavailable or ambiguous." >&2; return 2;
  }
  local current_state="" marker_status=1
  if read_bodycast_release_marker; then
    marker_status=0
    [[ "$BODYCAST_MARKER_RELEASE_SHA" == "$release_sha" ]] || {
      echo "Production release marker belongs to another SHA; refusing to replace it." >&2; return 2;
    }
    current_state="$BODYCAST_MARKER_STATE"
  else
    marker_status=$?
  fi
  if [[ "$marker_status" -eq 1 ]]; then
    [[ "$state" == "ddl-started" ]] || {
      echo "Only the irreversible ddl-started marker may be created from an absent state." >&2; return 2;
    }
  elif [[ "$marker_status" -ne 0 ]]; then
    echo "Existing production release marker is invalid; refusing to replace it." >&2; return 2
  elif [[ ! ( "$current_state" == "ddl-started" && "$state" == "schema-applied" ) \
    && ! ( "$current_state" == "schema-applied" && "$state" == "app-ready" ) \
    && ! ( "$current_state" == "app-ready" && "$state" == "app-ready" ) ]]; then
    echo "Production release marker transition is invalid: ${current_state} -> ${state}." >&2; return 2
  fi
  local temporary
  temporary="$(mktemp "${BODYCAST_RELEASE_MARKER_PATH}.new.XXXXXX")"
  trap 'rm -f -- "$temporary"' RETURN
  chmod 600 "$temporary"
  printf 'schemaVersion=1\nmanifestId=active-energy-unified-v2\nreleaseSha=%s\nstate=%s\n' \
    "$release_sha" "$state" > "$temporary"
  sync -f "$temporary"
  if [[ "$marker_status" -eq 1 ]]; then
    # Hard-link publication is atomic and refuses to overwrite a concurrent marker.
    ln -- "$temporary" "$BODYCAST_RELEASE_MARKER_PATH"
    rm -- "$temporary"
  else
    mv -f -- "$temporary" "$BODYCAST_RELEASE_MARKER_PATH"
  fi
  sync -f "$(dirname "$BODYCAST_RELEASE_MARKER_PATH")"
  trap - RETURN
}

clear_bodycast_release_marker() {
  if [[ -e "$BODYCAST_RECOVERY_MARKER_V2_PATH" || -L "$BODYCAST_RECOVERY_MARKER_V2_PATH" ]]; then
    echo "Recovery marker V2 exists; ordinary release tooling cannot clear a marker." >&2
    return 2
  fi
  read_bodycast_release_marker || {
    echo "Refusing to clear a missing or invalid production release marker." >&2; return 2;
  }
  rm -- "$BODYCAST_RELEASE_MARKER_PATH"
  sync -f "$(dirname "$BODYCAST_RELEASE_MARKER_PATH")"
}
