# Validate and freeze the production live-routes directory before any broker,
# Docker, Caddy, or route-file operation is allowed.
bodycast_canonicalize_routes_path() {
  local requested_path="$CADDY_ROUTES_PATH" canonical_path slashless_path
  [[ "$requested_path" == /* ]] || { echo "CADDY_ROUTES_PATH must be absolute." >&2; return 1; }
  [[ -d "$requested_path" && ! -L "$requested_path" ]] || {
    echo "CADDY_ROUTES_PATH must be an existing non-symlink directory." >&2
    return 1
  }
  if ! canonical_path="$(realpath -e -- "$requested_path")"; then
    echo "CADDY_ROUTES_PATH could not be canonicalized." >&2
    return 1
  fi
  slashless_path="${canonical_path//\//}"
  [[ -n "$slashless_path" ]] || {
    echo "CADDY_ROUTES_PATH may not resolve to the filesystem root." >&2
    return 1
  }
  [[ "$canonical_path" == "$requested_path" ]] || {
    echo "CADDY_ROUTES_PATH must use its exact canonical path." >&2
    return 1
  }
  [[ -d "$canonical_path" && ! -L "$canonical_path" ]] || {
    echo "Canonical CADDY_ROUTES_PATH is not a safe directory." >&2
    return 1
  }
  CADDY_ROUTES_PATH="$canonical_path"
  export CADDY_ROUTES_PATH
}
