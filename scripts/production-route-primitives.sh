# Fixed production route primitives. Callers choose only maintenance or serving;
# route directives and upstream identity are never supplied as arbitrary text.

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
    echo "CADDY_ROUTES_PATH must be canonical." >&2
    return 1
  }
  route_file="${CADDY_ROUTES_PATH%/}/bodycast.caddy"
  [[ ! -L "$route_file" && ( ! -e "$route_file" || -f "$route_file" ) ]] || {
    echo "The live Caddy route must be a regular file or absent, never a symlink or special path." >&2
    return 1
  }
  route_parent="$(dirname "$CADDY_ROUTES_PATH")"
  [[ "$route_parent" != "$CADDY_ROUTES_PATH" ]] || { echo "CADDY_ROUTES_PATH must be a dedicated non-root directory." >&2; return 1; }
  parent_canonical="$(realpath -e "$route_parent")"
  [[ "$parent_canonical" == "$route_parent" ]] || { echo "The staging parent must be canonical." >&2; return 1; }
  if [[ "$route_parent" == "/" ]]; then parent_prefix="/"; else parent_prefix="${route_parent}/"; fi
  [[ "$route_canonical" == "$parent_prefix"* && "$route_canonical" != "$route_parent" ]] || {
    echo "The staging parent must be strictly outside the live routes directory." >&2
    return 1
  }
  route_mount="$(stat -c '%d:%m' "$CADDY_ROUTES_PATH")"
  stage_mount="$(stat -c '%d:%m' "$route_parent")"
  [[ "$route_mount" == "$stage_mount" ]] || {
    echo "Cannot atomically replace the live route from its staging parent." >&2
    return 1
  }
}

bodycast_new_maintenance_marker() {
  local release_prefix="${DEPLOY_SHA:-${RELEASE_SHA:-manual}}"
  printf '%s-%s-%s-%s\n' "${release_prefix:0:12}" "$(date -u +%Y%m%dT%H%M%SZ)" "$$" "$RANDOM$RANDOM"
}

bodycast_render_route_header() {
  local maintenance_marker="${1:-}"
  cat <<EOF
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
EOF
  if [[ -n "$maintenance_marker" ]]; then
    cat <<EOF
        Cache-Control "no-store"
        X-BodyCast-Deploy-Maintenance "${maintenance_marker}"
EOF
  fi
  printf '%s\n' '    }'
}

bodycast_stage_maintenance_route_config() {
  local marker="$1" route_parent temporary
  [[ "$marker" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { echo "Maintenance marker is invalid." >&2; return 1; }
  bodycast_assert_safe_routes_location || return 1
  route_parent="$(dirname "$CADDY_ROUTES_PATH")"
  temporary="$(mktemp "${route_parent}/.bodycast-route-stage.XXXXXX")" || return 1
  {
    bodycast_render_route_header "$marker"
    cat <<EOF
    respond "BodyCast is temporarily unavailable while the model is updated." 503
}
EOF
  } > "$temporary"
  chmod 0644 "$temporary"
  if ! docker exec -i gymbeam-caddy caddy validate --adapter caddyfile --config - < "$temporary"; then
    rm -f -- "$temporary"
    echo "Caddy rejected the staged maintenance route." >&2
    return 1
  fi
  BODYCAST_ROUTE_STAGE_PATH="$temporary"
}

bodycast_stage_serving_route_config() {
  local route_parent temporary
  bodycast_assert_safe_routes_location || return 1
  route_parent="$(dirname "$CADDY_ROUTES_PATH")"
  temporary="$(mktemp "${route_parent}/.bodycast-route-stage.XXXXXX")" || return 1
  {
    bodycast_render_route_header
    cat <<EOF
    reverse_proxy bodycast-app-prod:3000
}
EOF
  } > "$temporary"
  chmod 0644 "$temporary"
  if ! docker exec -i gymbeam-caddy caddy validate --adapter caddyfile --config - < "$temporary"; then
    rm -f -- "$temporary"
    echo "Caddy rejected the staged serving route." >&2
    return 1
  fi
  BODYCAST_ROUTE_STAGE_PATH="$temporary"
}

bodycast_publish_staged_route() {
  local temporary="$1" route_parent route_file
  bodycast_assert_safe_routes_location || return 1
  route_parent="$(dirname "$CADDY_ROUTES_PATH")"
  route_file="${CADDY_ROUTES_PATH%/}/bodycast.caddy"
  [[ "$temporary" == "$route_parent"/.bodycast-route-stage.* && -f "$temporary" && ! -L "$temporary" ]] || {
    echo "Staged route path is not an approved fixed-route temporary file." >&2
    return 1
  }
  mv -f -- "$temporary" "$route_file"
}

bodycast_maintenance_marker_from_route() {
  local route_file="${CADDY_ROUTES_PATH%/}/bodycast.caddy" marker expected_file exact=false
  [[ -f "$route_file" && ! -L "$route_file" ]] || { echo "Maintenance route is missing or unsafe." >&2; return 1; }
  marker="$(sed -n 's/^[[:space:]]*X-BodyCast-Deploy-Maintenance "\([A-Za-z0-9][A-Za-z0-9._-]*\)"[[:space:]]*$/\1/p' "$route_file")"
  [[ "$marker" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { echo "Maintenance route marker is missing or invalid." >&2; return 1; }
  expected_file="$(mktemp)"
  {
    bodycast_render_route_header "$marker"
    cat <<EOF
    respond "BodyCast is temporarily unavailable while the model is updated." 503
}
EOF
  } > "$expected_file"
  cmp -s "$expected_file" "$route_file" && exact=true
  rm -f -- "$expected_file"
  [[ "$exact" == true ]] || { echo "Caddy route is not the exact fixed maintenance route." >&2; return 1; }
  printf '%s\n' "$marker"
}

bodycast_verify_exact_maintenance_route() {
  bodycast_maintenance_marker_from_route >/dev/null || return 1
  docker exec gymbeam-caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null
}

bodycast_probe_public_maintenance() {
  local marker="$1" headers body status
  headers="$(mktemp)"
  body="$(mktemp)"
  if ! status="$(curl --silent --show-error --max-redirs 0 --connect-timeout 5 --max-time 15 \
    --dump-header "$headers" --output "$body" --write-out '%{http_code}' "https://${APP_HOST}/")"; then
    rm -f -- "$headers" "$body"
    echo "Public maintenance probe failed to reach APP_HOST." >&2
    return 1
  fi
  if [[ "$status" != "503" ]] \
      || ! grep -Fqx 'BodyCast is temporarily unavailable while the model is updated.' "$body" \
      || ! awk -v expected="$marker" 'BEGIN { IGNORECASE = 1 } /^X-BodyCast-Deploy-Maintenance:/ { sub(/^[^:]*:[[:space:]]*/, ""); sub(/[[:space:]]*\r$/, ""); if ($0 == expected) found = 1 } END { exit !found }' "$headers" \
      || ! awk 'BEGIN { IGNORECASE = 1 } /^Cache-Control:/ { sub(/^[^:]*:[[:space:]]*/, ""); sub(/[[:space:]]*\r$/, ""); if (tolower($0) == "no-store") found = 1 } END { exit !found }' "$headers"; then
    rm -f -- "$headers" "$body"
    echo "Public maintenance probe did not return the exact uncached per-attempt 503 response." >&2
    return 1
  fi
  rm -f -- "$headers" "$body"
}

bodycast_probe_public_candidate_observational() {
  local headers body status
  headers="$(mktemp)"
  body="$(mktemp)"
  if status="$(curl --silent --show-error --max-redirs 0 --connect-timeout 5 --max-time 15 \
    --dump-header "$headers" --output "$body" --write-out '%{http_code}' "https://${APP_HOST}/api/health")" \
      && [[ "$status" == "200" ]] && grep -Fq '"status":"ok"' "$body"; then
    rm -f -- "$headers" "$body"
    return 0
  fi
  rm -f -- "$headers" "$body"
  return 1
}
