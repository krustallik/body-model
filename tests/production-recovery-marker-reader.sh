#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
V2_PATH="$TMP/marker-v2.json"
GIT_DIR_PATH="$TMP/git-meta"
mkdir -m 700 "$GIT_DIR_PATH"
git init --bare --quiet "$GIT_DIR_PATH"
sed "s|/var/lib/bodycast/recovery/marker-v2.json|$V2_PATH|g" \
  "$ROOT/scripts/production-release-marker.sh" > "$TMP/production-release-marker.sh"

export GIT_DIR="$GIT_DIR_PATH"
source "$TMP/production-release-marker.sh"
bodycast_prepare_release_marker_directory

status=0
read_bodycast_release_marker || status=$?
[[ "$status" -eq 1 ]] || { echo "Missing markers must be the only absent state." >&2; exit 1; }

printf 'schemaVersion=1\nmanifestId=active-energy-unified-v2\nreleaseSha=%040d\nstate=ddl-started\n' 0 \
  > "$BODYCAST_RELEASE_MARKER_PATH"
read_bodycast_release_marker
[[ "$BODYCAST_MARKER_STATE" == "ddl-started" ]] || { echo "Valid V1 marker was not parsed." >&2; exit 1; }

# Unsupported V1 schema/state is an existing marker failure, never absence.
printf 'schemaVersion=9\nmanifestId=active-energy-unified-v2\nreleaseSha=%040d\nstate=ddl-started\n' 0 \
  > "$BODYCAST_RELEASE_MARKER_PATH"
status=0
read_bodycast_release_marker || status=$?
[[ "$status" -eq 2 ]] || { echo "Unsupported V1 schema was not blocked." >&2; exit 1; }
printf 'schemaVersion=1\nmanifestId=active-energy-unified-v2\nreleaseSha=%040d\nstate=unknown\n' 0 \
  > "$BODYCAST_RELEASE_MARKER_PATH"
status=0
read_bodycast_release_marker || status=$?
[[ "$status" -eq 2 ]] || { echo "Unsupported V1 state was not blocked." >&2; exit 1; }
printf 'schemaVersion=1\nmanifestId=active-energy-unified-v2\nreleaseSha=%040d\nstate=ddl-started\n' 0 \
  > "$BODYCAST_RELEASE_MARKER_PATH"

# Any V2 path existence is blocking before content parsing, even with a valid V1 marker.
for state in ddl-started schema-applied app-ready restore-authorized restore-in-progress restore-verified \
  recovery-authorized rollback-app-ready writers-enabled recovery-complete traffic-open recovery-finalized unknown; do
  printf '{"schemaVersion":2,"state":"%s"}\n' "$state" > "$V2_PATH"
  status=0
  read_bodycast_release_marker || status=$?
  [[ "$status" -eq 2 ]] || { echo "V2 state '$state' did not fail closed." >&2; exit 1; }
done
for content in 'not-json' '{"schemaVersion":999,"state":"future"}' '{"schemaVersion":2,"state":"unknown"}' \
  '{"schemaVersion":2,"state":"restore-authorized","journalGeneration":8}' 'schemaVersion=1'; do
  printf '%s\n' "$content" > "$V2_PATH"
  status=0
  read_bodycast_release_marker || status=$?
  [[ "$status" -eq 2 ]] || { echo "Malformed, future, or legacy V2 marker content was not blocked." >&2; exit 1; }
done

status=0
write_bodycast_release_marker "$(printf '%040d' 1)" app-ready || status=$?
[[ "$status" -eq 2 ]] || { echo "Ordinary V1 writer bypassed an existing V2 marker." >&2; exit 1; }

status=0
clear_bodycast_release_marker || status=$?
[[ "$status" -eq 2 && -f "$BODYCAST_RELEASE_MARKER_PATH" ]] || { echo "Ordinary V1 clear bypassed an existing V2 marker." >&2; exit 1; }

rm "$V2_PATH"
ln -s "$TMP/missing-target" "$V2_PATH"
status=0
read_bodycast_release_marker || status=$?
[[ "$status" -eq 2 ]] || { echo "Symlink V2 marker did not fail closed." >&2; exit 1; }

echo "Production recovery marker reader fail-closed checks passed."
