#!/usr/bin/env bash
set -Eeuo pipefail

# This public, root-owned, non-privileged client bundle contains no journal
# paths, keys, or production configuration. The root service revalidates every
# request, so the release user does not traverse the mode-0700 authority store.
readonly CLIENT_BINARY="/usr/local/lib/bodycast/production-recovery-client.mjs"
[[ -f "$CLIENT_BINARY" && ! -L "$CLIENT_BINARY" && -r "$CLIENT_BINARY" ]] || {
  echo "Production operation client is unavailable." >&2; exit 1;
}
exec /usr/bin/node "$CLIENT_BINARY" "$@"
