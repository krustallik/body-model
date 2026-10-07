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
  local temporary
  temporary="$(mktemp "${BODYCAST_RELEASE_MARKER_PATH}.new.XXXXXX")"
  chmod 600 "$temporary"
  printf 'schemaVersion=1\nmanifestId=active-energy-unified-v2\nreleaseSha=%s\nstate=%s\n' \
    "$release_sha" "$state" > "$temporary"
  mv -f "$temporary" "$BODYCAST_RELEASE_MARKER_PATH"
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
}
