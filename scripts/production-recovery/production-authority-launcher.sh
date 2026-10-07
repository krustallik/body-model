#!/usr/bin/env bash
set -Eeuo pipefail

# Installed root-owned as /usr/local/sbin/bodycast-production-recovery-authority.
# It selects only the immutable package version committed by the root installer.
readonly INSTALL_ROOT="/usr/local/lib/bodycast/production-recovery"
[[ "$(id -u)" == "0" ]] || { echo "Recovery authority launcher requires root." >&2; exit 1; }
[[ "$#" -eq 1 && "$1" == "--serve" ]] || { echo "Only the fixed --serve mode is allowed." >&2; exit 1; }
[[ -d "$INSTALL_ROOT" && ! -L "$INSTALL_ROOT" && -f "$INSTALL_ROOT/current-version" && ! -L "$INSTALL_ROOT/current-version" ]] || {
  echo "Immutable recovery authority installation is unavailable." >&2; exit 1;
}
readonly VERSION="$(cat "$INSTALL_ROOT/current-version")"
[[ "$VERSION" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
  echo "Authority current-version pointer is malformed." >&2; exit 1;
}
readonly VERSION_DIR="$INSTALL_ROOT/$VERSION"
readonly AUTHORITY_BINARY="$VERSION_DIR/bodycast-recovery-authority"
[[ -d "$VERSION_DIR" && ! -L "$VERSION_DIR" && -f "$AUTHORITY_BINARY" && ! -L "$AUTHORITY_BINARY" && -x "$AUTHORITY_BINARY" ]] || {
  echo "Selected immutable authority package is incomplete." >&2; exit 1;
}
if [[ "$(stat -c '%u:%a' "$INSTALL_ROOT")" != "0:700" \
  || "$(stat -c '%u:%a' "$VERSION_DIR")" != "0:700" \
  || "$(stat -c '%u' "$AUTHORITY_BINARY")" != "0" ]]; then
  echo "Authority installation ownership or permissions are unsafe." >&2
  exit 1
fi
exec /usr/bin/node "$AUTHORITY_BINARY" --serve
