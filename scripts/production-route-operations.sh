# Internal route operations shared by the deployment and traffic-gate entrypoints.
# This file intentionally exposes shell functions only; it is not a CLI.

bodycast_verify_exact_maintenance_route() {
  local route_file="${CADDY_ROUTES_PATH}/bodycast.caddy"
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

bodycast_write_route() {
  local body="$1"
  local freshness_sha="${2:-}"
  local route_file="${CADDY_ROUTES_PATH}/bodycast.caddy"
  local route_parent route_mount stage_mount route_canonical temporary

  mkdir -p "$CADDY_ROUTES_PATH"
  [[ -d "$CADDY_ROUTES_PATH" && ! -L "$CADDY_ROUTES_PATH" ]] || {
    echo "CADDY_ROUTES_PATH must be an existing non-symlink directory." >&2
    return 1
  }
  route_canonical="$(realpath -e "$CADDY_ROUTES_PATH")"
  [[ "$route_canonical" == "$CADDY_ROUTES_PATH" ]] || {
    echo "CADDY_ROUTES_PATH must be canonical so staging is outside the live route directory." >&2
    return 1
  }
  route_parent="$(dirname "$CADDY_ROUTES_PATH")"
  route_mount="$(stat -c '%d:%m' "$CADDY_ROUTES_PATH")"
  stage_mount="$(stat -c '%d:%m' "$route_parent")"
  [[ "$route_mount" == "$stage_mount" ]] || {
    echo "Cannot stage the route outside the watched directory on the same filesystem; refusing a non-atomic cutover." >&2
    return 1
  }
  # Stage beside, but outside, the live routes directory. No candidate bytes
  # touch a path imported from the production route directory before publish.
  temporary="$(mktemp "${route_parent}/.bodycast-route-stage.XXXXXX")"
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
    ${body}
}
EOF
  chmod 0644 "$temporary"
  # Validate exact staged route bytes while the live watched route is unchanged.
  if ! docker exec -i gymbeam-caddy caddy validate --adapter caddyfile --config - < "$temporary"; then
    rm -f -- "$temporary"
    echo "Caddy rejected the staged route; the live route was not changed." >&2
    return 1
  fi

  # Candidate publication has a final canonical-main fence. Restoring the
  # exact captured pre-deploy release intentionally passes no freshness SHA.
  if [[ -n "$freshness_sha" ]] && ! bodycast_assert_current_main_sha "$freshness_sha"; then
    rm -f -- "$temporary"
    return 1
  fi
  # Atomic replacement is the serving effect; never publish then roll back as a fence.
  if ! mv -f -- "$temporary" "$route_file"; then
    rm -f -- "$temporary"
    echo "Atomic live-route replacement failed; the previous route remains in place." >&2
    return 1
  fi
  if ! docker exec gymbeam-caddy caddy reload \
    --address unix//run/caddy-admin/admin.sock \
    --config /etc/caddy/Caddyfile; then
    echo "Caddy reload failed after the atomic route effect; caller must retain or restore maintenance." >&2
    return 1
  fi
}
