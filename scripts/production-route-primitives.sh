# Shared route primitives. This library can validate and stage a route, but it
# deliberately cannot publish/reload one. Mode-specific entrypoints own that
# final effect after enforcing their full authorization and freshness gates.

bodycast_verify_exact_maintenance_route() {
  local route_file="${CADDY_ROUTES_PATH%/}/bodycast.caddy"
  [[ -f "$route_file" && ! -L "$route_file" ]] || { echo "Maintenance route file is missing or unsafe." >&2; return 1; }
  local expected_file
  expected_file="$(mktemp)"
  cat > "$expected_file" <<EOF
http://${APP_HOST} {
    redir https://${APP_HOST}{uri} permanent
}

${APP_HOST} {
    encode zstd gzip
    header {
        -Server
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
    respond "BodyCast is temporarily unavailable while the model is updated." 503
}
EOF
  local exact=false
  cmp -s "$expected_file" "$route_file" && exact=true
  rm -f "$expected_file"
  [[ "$exact" == true ]] || { echo "Caddy is not on the exact maintenance-only route." >&2; return 1; }
  docker exec gymbeam-caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null
}

bodycast_assert_safe_routes_location() {
  local route_canonical route_parent parent_canonical route_mount stage_mount parent_prefix route_file
  [[ "$CADDY_ROUTES_PATH" == /* ]] || { echo "CADDY_ROUTES_PATH must be absolute." >&2; return 1; }
  [[ "$CADDY_ROUTES_PATH" != "/" ]] || { echo "CADDY_ROUTES_PATH may not be the filesystem root." >&2; return 1; }
  [[ -d "$CADDY_ROUTES_PATH" && ! -L "$CADDY_ROUTES_PATH" ]] || {
    echo "CADDY_ROUTES_PATH must be an existing non-symlink directory." >&2
    return 1
  }
  route_canonical="$(realpath -e "$CADDY_ROUTES_PATH")"
  [[ "$route_canonical" == "$CADDY_ROUTES_PATH" ]] || {
    echo "CADDY_ROUTES_PATH must be canonical so staging is outside the live route directory." >&2
    return 1
  }
  route_file="${CADDY_ROUTES_PATH%/}/bodycast.caddy"
  [[ ! -L "$route_file" && ( ! -e "$route_file" || -f "$route_file" ) ]] || {
    echo "The live Caddy route must be a regular file or absent, never a symlink or special path." >&2
    return 1
  }
  route_parent="$(dirname "$CADDY_ROUTES_PATH")"
  [[ "$route_parent" != "$CADDY_ROUTES_PATH" ]] || {
    echo "CADDY_ROUTES_PATH must be a dedicated non-root live-routes directory." >&2
    return 1
  }
  parent_canonical="$(realpath -e "$route_parent")"
  [[ "$parent_canonical" == "$route_parent" ]] || {
    echo "The staging parent must be canonical." >&2
    return 1
  }
  if [[ "$route_parent" == "/" ]]; then parent_prefix="/"; else parent_prefix="${route_parent}/"; fi
  [[ "$route_canonical" == "$parent_prefix"* && "$route_canonical" != "$route_parent" ]] || {
    echo "The staging parent must be strictly outside the live routes directory." >&2
    return 1
  }
  route_mount="$(stat -c '%d:%m' "$CADDY_ROUTES_PATH")"
  stage_mount="$(stat -c '%d:%m' "$route_parent")"
  [[ "$route_mount" == "$stage_mount" ]] || {
    echo "Cannot stage the route outside the watched directory on the same filesystem; refusing a non-atomic cutover." >&2
    return 1
  }
}

# $1 is a mode-derived directive, never a complete route or a serving input
# from the CLI. The returned path is only a validated off-live staging file;
# callers must still enforce mode-specific gates before their own atomic publish.
bodycast_stage_route_config() {
  local directive="$1" route_parent temporary
  bodycast_assert_safe_routes_location || return 1
  route_parent="$(dirname "$CADDY_ROUTES_PATH")"
  temporary="$(mktemp "${route_parent}/.bodycast-route-stage.XXXXXX")" || return 1
  cat >"$temporary" <<EOF
http://${APP_HOST} {
    redir https://${APP_HOST}{uri} permanent
}

${APP_HOST} {
    encode zstd gzip
    header {
        -Server
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
    ${directive}
}
EOF
  chmod 0644 "$temporary"
  if ! docker exec -i gymbeam-caddy caddy validate --adapter caddyfile --config - < "$temporary"; then
    rm -f -- "$temporary"
    echo "Caddy rejected the staged route; the live route was not changed." >&2
    return 1
  fi
  BODYCAST_ROUTE_STAGE_PATH="$temporary"
}
