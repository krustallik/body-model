import { execFileSync, spawnSync } from "node:child_process";
import {
  accessSync,
  copyFileSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect } from "vitest";

const temporaryRoots: string[] = [];
export const PREVIOUS_SHA = "1".repeat(40);
export const PREVIOUS_CONTAINER_ID = "e".repeat(64);
export const PREVIOUS_IMAGE_ID = `sha256:${"a".repeat(64)}`;
export const LATEST_IMAGE_ID = `sha256:${"b".repeat(64)}`;
export const CANDIDATE_IMAGE_ID = `sha256:${"c".repeat(64)}`;
export const WRONG_IMAGE_ID = `sha256:${"d".repeat(64)}`;

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function findBash(): string | null {
  const probe = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (!probe.error && probe.status === 0) return "bash";
  if (process.platform !== "win32") return null;
  const where = spawnSync("where.exe", ["git"], { encoding: "utf8" });
  const gitExe = where.stdout.split(/\r?\n/).find((entry) => entry.toLowerCase().endsWith("\\git.exe"));
  if (!gitExe) return null;
  const gitBash = path.resolve(path.dirname(gitExe), "..", "bin", "bash.exe");
  return existsSync(gitBash) ? gitBash : null;
}

function findGitExecutable(): string {
  let executable: string | undefined;
  if (process.platform === "win32") {
    const where = spawnSync("where.exe", ["git"], { encoding: "utf8" });
    executable = where.stdout?.split(/\r?\n/).find((entry) => entry.toLowerCase().endsWith("\\git.exe"));
  } else {
    for (const entry of process.env.PATH?.split(path.delimiter) ?? []) {
      const candidate = path.resolve(entry || process.cwd(), "git");
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, fsConstants.X_OK);
        executable = realpathSync(candidate);
        break;
      } catch {
        // Keep searching PATH; the final error explains that Git is required.
      }
    }
  }

  if (!executable) {
    throw new Error("Unable to resolve the real Git executable for the release-cutover fixture.");
  }
  const absoluteExecutable = path.resolve(executable);
  if (!path.isAbsolute(absoluteExecutable)) {
    throw new Error("Resolved Git executable path must be absolute for the release-cutover fixture.");
  }
  return absoluteExecutable;
}

export function toBashPath(value: string): string {
  if (process.platform !== "win32") return value;
  const match = /^([A-Za-z]):\\(.*)$/.exec(value);
  if (!match) return value.replace(/\\/g, "/");
  return `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

export function maintenanceRoute(marker = "fixture-attempt"): string {
  return `http://bodycast.example.test {
    redir https://bodycast.example.test{uri} permanent
}

bodycast.example.test {
    encode zstd gzip
    header {
        -Server
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        Cache-Control "no-store"
        X-BodyCast-Deploy-Maintenance "${marker}"
    }
    respond "BodyCast is temporarily unavailable while the model is updated." 503
}
`;
}

function servingRoute(): string {
  return `http://bodycast.example.test {
    redir https://bodycast.example.test{uri} permanent
}

bodycast.example.test {
    encode zstd gzip
    header {
        -Server
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
    reverse_proxy bodycast-app-prod:3000
}
`;
}

function shellScript(strings: TemplateStringsArray): string {
  return strings.raw[0].replaceAll("\\${", "${");
}

const fakeDocker = shellScript`#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$DOCKER_LOG"
event() { printf '%s\n' "$*" >> "$EVENT_LOG"; }
advance_main() {
  local trigger="\${1:-v4}"
  case "$trigger" in
    v4) [[ "\${ADVANCE_ONCE:-}" == "1" ]] || return 0 ;;
    v3) [[ "\${ADVANCE_ON_V3:-}" == "1" ]] || return 0 ;;
    final-v3) [[ "\${ADVANCE_ON_FINAL_V3:-}" == "1" ]] || return 0 ;;
    final-schema) [[ "\${ADVANCE_ON_FINAL_SCHEMA_PREFLIGHT:-}" == "1" ]] || return 0 ;;
    validate) [[ "\${ADVANCE_ON_VALIDATE:-}" == "1" ]] || return 0 ;;
  esac
  [[ ! -e "$ADVANCE_MARKER" ]] || return 0
  "\${REAL_GIT}" -C "$FIXTURE_REPO" push --quiet origin "\${ADVANCE_SHA}:refs/heads/main"
  : > "$ADVANCE_MARKER"
  event "main-advanced"
}
joined=" $* "
if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  if [[ "$3" == "--format" ]]; then format="$4"; image="$5"; else format=""; image="$3"; fi
  case "$image" in
    bodycast-app:latest) image_file="$IMAGE_LATEST" ;;
    bodycast-app:rollback) image_file="$IMAGE_ROLLBACK" ;;
    *) exit 1 ;;
  esac
  [[ -s "$image_file" ]] || exit 1
  if [[ "$format" == *".Id"* ]]; then cat "$image_file"; fi
  exit 0
fi
if [[ "$1" == "image" && "$2" == "tag" ]]; then
  case "$3:$4" in
    bodycast-app:latest:bodycast-app:rollback) cp "$IMAGE_LATEST" "$IMAGE_ROLLBACK" ;;
    bodycast-app:rollback:bodycast-app:latest) cp "$IMAGE_ROLLBACK" "$IMAGE_LATEST" ;;
    sha256:*:bodycast-app:rollback)
      printf '%s\n' "$3" > "$IMAGE_ROLLBACK"
      ;;
    *) exit 2 ;;
  esac
  event "image-tag:$3:$4"
  exit 0
fi
if [[ "$1" == "image" && "$2" == "rm" ]]; then
  if [[ "\${FAIL_IMAGE_RM:-0}" == "1" ]]; then
    event "image-rm-failed"
    exit 55
  fi
  rm -f "$IMAGE_ROLLBACK"
  exit 0
fi
if [[ "$1" == "compose" ]]; then
  if [[ "$joined" == *" up -d db "* ]]; then
    event "forbidden-db-start"
    exit 80
  fi
  if [[ "$joined" == *"production-db-target-url.mjs"* ]]; then
    event "previous-app-db-url-resolved"
    printf '%s\n' 'postgresql://bodycast:fixture@bodycast-db-prod:5432/bodycast'
    exit 0
  fi
  if [[ "$joined" == *" config --quiet "* || "$joined" == *" build migrate "* || "$joined" == *" logs --tail=100 "* ]]; then exit 0; fi
  if [[ "$joined" == *" run --rm --no-deps --entrypoint npx migrate prisma migrate status "* ]]; then
    event "schema-preflight-no-deps"
    schema_count="$(cat "$SCHEMA_PREFLIGHT_COUNT_FILE" 2>/dev/null || printf '0')"
    schema_count=$((schema_count + 1))
    printf '%s\n' "$schema_count" > "$SCHEMA_PREFLIGHT_COUNT_FILE"
    if [[ "\${FAIL_SCHEMA_PREFLIGHT:-0}" == "1" \
        || ( "\${FAIL_SECOND_SCHEMA_PREFLIGHT:-0}" == "1" && "$schema_count" -ge 2 ) ]]; then exit 41; fi
    printf '%s\n' 'Database schema is up to date!'
    if [[ "$schema_count" -ge 2 ]]; then advance_main final-schema; fi
    exit 0
  fi
  if [[ "$joined" == *" run --rm --no-deps --entrypoint node migrate "* ]]; then
    if [[ "$joined" == *"unified-v3-postflight.mjs"* ]]; then
      event "unified-v3-postflight"
      v3_count="$(cat "$V3_POSTFLIGHT_COUNT_FILE" 2>/dev/null || printf '0')"
      v3_count=$((v3_count + 1))
      printf '%s\n' "$v3_count" > "$V3_POSTFLIGHT_COUNT_FILE"
      if [[ "$v3_count" -ge 2 ]]; then
        event "v3-postflight:final"
        advance_main final-v3
        if [[ "\${FAIL_CANONICAL_FETCH_AFTER_V3:-0}" == "1" ]]; then : > "$MAIN_FETCH_FAILURE_MARKER"; fi
      else
        event "v3-postflight:initial"
        advance_main v3
      fi
      exit 0
    fi
    if [[ "$joined" == *"unified-v4-activate-replay.mjs"* ]]; then
      event "unified-v4-activation"
      if [[ "\${FAIL_V4_ACTIVATION:-0}" == "1" ]]; then exit 44; fi
      exit 0
    fi
    if [[ "$joined" == *"unified-v4-traffic-check.mjs"* ]]; then event "unified-v4-check"; fi
    if [[ "$joined" == *"unified-v4-traffic-check.mjs"* \
        && "\${FAIL_ROLLBACK_V4:-0}" == "1" && -e "$FAIL_CANDIDATE_MARKER" ]]; then exit 42; fi
    if [[ "$joined" == *"unified-v4-traffic-check.mjs"* \
        && "\${FAIL_FINAL_V4_CHECK:-0}" == "1" \
        && "$(cat "$APP_SHA_FILE" 2>/dev/null || true)" == "\${CANDIDATE_SHA:-}" \
        && "$(cat "$ACTIVE_ROUTE_FILE" 2>/dev/null || true)" == "maintenance" ]]; then exit 42; fi
    if [[ "$joined" == *"unified-v4-traffic-check.mjs"* \
        && "$(cat "$APP_SHA_FILE" 2>/dev/null || true)" == "\${CANDIDATE_SHA:-}" \
        && "$(cat "$ACTIVE_ROUTE_FILE" 2>/dev/null || true)" == "maintenance" ]]; then
      advance_main
    fi
    exit 0
  fi
  if [[ "$joined" == *" build app "* ]]; then
    printf '%s\n' "$CANDIDATE_IMAGE_ID" > "$IMAGE_LATEST"
    exit 0
  fi
  if [[ "$joined" == *" up -d --no-deps --force-recreate app "* || "$joined" == *" up -d --no-deps --no-build app "* ]]; then
    if [[ "\${FAIL_CANDIDATE_UP:-0}" == "1" \
        && "\${BODYCAST_DEPLOY_SHA:-}" == "\${CANDIDATE_SHA:-}" \
        && ! -e "$FAIL_CANDIDATE_MARKER" ]]; then
      : > "$FAIL_CANDIDATE_MARKER"
      if [[ "\${ADD_MARKER_ON_CANDIDATE_FAILURE:-0}" == "1" ]]; then
        marker_path="$("$REAL_GIT" -C "$FIXTURE_REPO" rev-parse --absolute-git-dir)/bodycast-production-schema-cutover"
        printf 'schemaVersion=1\nmanifestId=active-energy-unified-v2\nreleaseSha=%s\nstate=ddl-started\n' "$CANDIDATE_SHA" > "$marker_path"
      fi
      exit 31
    fi
    restored_image_id="$(cat "$IMAGE_LATEST")"
    if [[ "\${CANDIDATE_CONTAINER_IMAGE_MISMATCH:-0}" == "1" \
        && "\${BODYCAST_DEPLOY_SHA:-}" == "\${CANDIDATE_SHA:-}" ]]; then
      restored_image_id="$WRONG_IMAGE_ID"
    fi
    if [[ "\${ROLLBACK_CONTAINER_IMAGE_MISMATCH:-0}" == "1" \
        && "\${BODYCAST_DEPLOY_SHA:-}" == "\${PREVIOUS_SHA:-}" ]]; then
      restored_image_id="$WRONG_IMAGE_ID"
    fi
    printf '%s\n' "$restored_image_id" > "$APP_IMAGE_ID_FILE"
    if [[ "\${CANDIDATE_CONTAINER_SHA_MISMATCH:-0}" == "1" \
        && "\${BODYCAST_DEPLOY_SHA:-}" == "\${CANDIDATE_SHA:-}" ]]; then
      printf '%s\n' "$PREVIOUS_SHA" > "$APP_SHA_FILE"
    else
      printf '%s\n' "\${BODYCAST_DEPLOY_SHA:?}" > "$APP_SHA_FILE"
    fi
    printf '%s\n' healthy > "$APP_STATUS_FILE"
    printf '%s\n' "\${CANDIDATE_CONTAINER_ID:-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff}" > "$APP_CONTAINER_ID_FILE"
    printf '%s\n' true > "$APP_PRESENT_FILE"
    printf '%s\n' always > "$APP_RESTART_FILE"
    if [[ "\${ADD_MARKER_AFTER_CANDIDATE_START:-0}" == "1" \
        && "\${BODYCAST_DEPLOY_SHA:-}" == "\${CANDIDATE_SHA:-}" ]]; then
      marker_path="$("$REAL_GIT" -C "$FIXTURE_REPO" rev-parse --absolute-git-dir)/bodycast-production-schema-cutover"
      printf 'schemaVersion=1\nmanifestId=active-energy-unified-v2\nreleaseSha=%s\nstate=ddl-started\n' "$BODYCAST_DEPLOY_SHA" > "$marker_path"
    fi
    exit 0
  fi
  if [[ "$joined" == *" stop app "* ]]; then
    event "compose-stop-app"
    if [[ "\${FAIL_COMPOSE_STOP:-0}" == "1" ]]; then
      event "compose-stop-app-failed"
      exit 56
    fi
    printf '%s\n' exited > "$APP_STATUS_FILE"
    exit 0
  fi
  if [[ "$joined" == *" rm --force app "* ]]; then
    event "compose-remove-app"
    if [[ "\${FAIL_COMPOSE_RM:-0}" == "1" ]]; then
      event "compose-remove-app-failed"
      exit 57
    fi
    printf '%s\n' false > "$APP_PRESENT_FILE"
    exit 0
  fi
  echo "unhandled docker compose fixture command: $*" >&2
  exit 90
fi
if [[ "$1" == "inspect" ]]; then
  if [[ "$2" == "bodycast-app-prod" && "$#" -eq 2 ]]; then
    if [[ "\${FAIL_DOCKER_APP_INSPECT:-0}" == "1" ]]; then
      event "docker-app-inspect-json-failed"
      exit 58
    fi
    event "docker-app-inspect-json"
    cat "$APP_INSPECT_JSON_FILE"
    exit 0
  fi
  format="$3"
  target="$4"
  if [[ "$target" == "bodycast-db-prod" && "\${FAIL_DB_INSPECT:-0}" == "1" ]]; then
    event "docker-db-inspect-failed"
    exit 62
  fi
  if [[ "$target" == "bodycast-app-prod" && "\${FAIL_DOCKER_APP_INSPECT:-0}" == "1" ]]; then
    event "docker-app-inspect-failed:$format"
    exit 58
  fi
  if [[ "$target" == "bodycast-app-prod" && "$format" == *".Id"* ]]; then
    event "capture-app-container-id"
    cat "$APP_CONTAINER_ID_FILE"
    exit 0
  fi
  case "$target:$format" in
    bodycast-db-prod:*State.Status*Health*) printf '%s\n' 'running|healthy' ;;
    bodycast-db-prod:*Health.Status*|bodycast-db-prod:*State.Health*) printf '%s\n' healthy ;;
    bodycast-db-prod:*NetworkSettings.Networks*) printf '%s\n' bodycast-backend-prod ;;
    bodycast-db-prod:*) printf '%s\n' running ;;
    bodycast-app-prod:*Image*) cat "$APP_IMAGE_ID_FILE" ;;
    bodycast-app-prod:*Health.Status*|bodycast-app-prod:*State.Health*) cat "$APP_STATUS_FILE" ;;
    bodycast-app-prod:*org.bodycast.release-sha*) cat "$APP_SHA_FILE" ;;
    bodycast-app-prod:*HostConfig.RestartPolicy.Name*) cat "$APP_RESTART_FILE" ;;
    bodycast-app-prod:*State.Status*) cat "$APP_STATUS_FILE" ;;
    gymbeam-caddy:*State.Status*) printf '%s\n' running ;;
    *) echo "unhandled docker inspect fixture target/format: $target $format" >&2; exit 91 ;;
  esac
  exit 0
fi
if [[ "$1" == "exec" && "$*" == *"BODYCAST_WRITER_TOPOLOGY_JSON="* && "$*" == *"bodycast-db-prod"* ]]; then
  input="$(cat)"
  if [[ "$input" != *"BEGIN READ ONLY;"* || "$input" != *"SELECT json_build_object("* ]]; then
    event "previous-app-compatibility-snapshot-missing-read-only-sql"
    echo "previous-app compatibility snapshot did not receive the rendered read-only SQL" >&2
    exit 86
  fi
  event "previous-app-compatibility-sql-validated"
  if [[ "\${FAIL_PREVIOUS_DB_SNAPSHOT:-0}" == "1" ]]; then
    event "previous-app-compatibility-snapshot-failed"
    echo "synthetic read-only compatibility snapshot failure" >&2
    exit 87
  fi
  event "previous-app-compatibility-snapshot"
  cat "$PREVIOUS_DB_REPORT_FILE"
  exit 0
fi
if [[ "$1" == "ps" ]]; then
  if [[ "\${FAIL_DOCKER_PS:-0}" == "1" ]]; then
    event "docker-ps-failed"
    exit 59
  fi
  if [[ "$(cat "$APP_PRESENT_FILE" 2>/dev/null || true)" == "true" ]]; then printf '%s\n' bodycast-app-prod; fi
  exit 0
fi
if [[ "$1" == "update" ]]; then
  printf '%s\n' no > "$APP_RESTART_FILE"
  event "restart-disabled"
  exit 0
fi
if [[ "$1" == "stop" && "$2" == "--time" && "$4" == "bodycast-app-prod" ]]; then
  if [[ "\${FAIL_DOCKER_STOP:-0}" == "1" ]]; then
    event "direct-app-stop-failed"
    exit 60
  fi
  printf '%s\n' exited > "$APP_STATUS_FILE"
  event "direct-app-stop"
  exit 0
fi
if [[ "$1" == "info" || "$1" == "port" ]]; then exit 0; fi
if [[ "$1" == "network" && "$2" == "inspect" ]]; then
  event "writer-drain-topology-check"
  printf '%s\n' bodycast-db-prod
  if [[ "\${FAIL_UNKNOWN_NETWORK_CLIENT:-0}" == "1" ]]; then printf '%s\n' unapproved-client; fi
  exit 0
fi
if [[ "$1" == "exec" && ( "$2" == "gymbeam-caddy" || ( "$2" == "-i" && "$3" == "gymbeam-caddy" ) ) ]]; then
  if [[ "$*" == *" validate "* ]]; then
    if [[ "$*" == *"--config -"* ]]; then
      staged_route="$(cat)"
      if grep -q reverse_proxy "$ROUTE_FILE"; then event "live-route-before-validate:serving"; else event "live-route-before-validate:maintenance"; fi
      staged_path="$(tail -n 1 "$STAGE_PATH_LOG" 2>/dev/null || true)"
      if [[ -n "$staged_path" ]]; then
        case "$staged_path" in
          "$CADDY_ROUTES_PATH"/*)
            event "watch-live-file-change:$(basename "$staged_path")"
            if [[ "$staged_route" == *"reverse_proxy"* ]]; then
              printf '%s\n' serving > "$ACTIVE_ROUTE_FILE"
              event "watch-serving-effect:$(basename "$staged_path")"
            fi
            ;;
          *) event "watch-ignored-outside-live-routes:$(basename "$staged_path")" ;;
        esac
      fi
      event "staged-route-validated"
      if [[ "$staged_route" == *"reverse_proxy"* && -n "$staged_path" ]]; then
        printf '%s\n' "$staged_path" >> "$CANDIDATE_STAGE_PATH_LOG"
      fi
      if [[ "$staged_route" == *"reverse_proxy"* ]]; then advance_main validate; fi
    fi
    exit 0
  fi
  if [[ "$*" == *" reload "* ]]; then
    route_kind=maintenance
    grep -q reverse_proxy "$ROUTE_FILE" && route_kind=serving
    event "caddy-reload:$route_kind"
    if [[ "\${FAIL_CADDY_RELOAD:-0}" == "1" \
        || ( "$route_kind" == "maintenance" && "\${FAIL_MAINTENANCE_RELOAD:-0}" == "1" ) \
        || ( "$route_kind" == "serving" && "\${FAIL_SERVING_RELOAD:-0}" == "1" ) ]]; then
      event "caddy-reload-failed:$route_kind"
      exit 43
    fi
    if [[ "$route_kind" == "serving" ]]; then
      printf '%s\n' serving > "$ACTIVE_ROUTE_FILE"
      event "caddy-serving-sha:$(cat "$APP_SHA_FILE")"
    else
      printf '%s\n' maintenance > "$ACTIVE_ROUTE_FILE"
    fi
    event "caddy-active-config:$route_kind"
    exit 0
  fi
fi
if [[ "$1" == "exec" && "$2" == "bodycast-app-prod" ]]; then
  if [[ "\${FAIL_CANDIDATE_LOCAL_HEALTH:-0}" == "1" \
      && "$(cat "$APP_SHA_FILE" 2>/dev/null || true)" == "\${CANDIDATE_SHA:-}" ]]; then
    event "candidate-local-health-failed"
    exit 22
  fi
  printf '%s\n' '{"status":"ok"}'
  exit 0
fi
echo "unhandled docker fixture command: $*" >&2
exit 92
`;

const fakeCurl = shellScript`#!/usr/bin/env bash
set -Eeuo pipefail
headers=""
body=""
write_out=""
url=""
fail_on_error=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fail|--fail-with-body) fail_on_error=true; shift ;;
    --dump-header) headers="$2"; shift 2 ;;
    --output) body="$2"; shift 2 ;;
    --write-out) write_out="$2"; shift 2 ;;
    --silent|--show-error|--max-redirs|--connect-timeout|--max-time) shift; [[ $# -eq 0 || "$1" == -* ]] || shift ;;
    *) url="$1"; shift ;;
  esac
done
status=503
route_marker=""
response_body='BodyCast is temporarily unavailable while the model is updated.'
response_headers=$'HTTP/1.1 503 Service Unavailable\r\nCache-Control: no-store\r\n'
if [[ "$(cat "$ACTIVE_ROUTE_FILE" 2>/dev/null || true)" == "maintenance" ]]; then
  route_marker="$(sed -n 's/^[[:space:]]*X-BodyCast-Deploy-Maintenance "\([A-Za-z0-9][A-Za-z0-9._-]*\)"[[:space:]]*$/\1/p' "$ROUTE_FILE" | head -n 1)"
  response_headers+="X-BodyCast-Deploy-Maintenance: $route_marker"$'\r\n'
elif [[ "$(cat "$ACTIVE_ROUTE_FILE" 2>/dev/null || true)" == "serving" \
    && "$(cat "$APP_PRESENT_FILE" 2>/dev/null || true)" == "true" \
    && "$(cat "$APP_STATUS_FILE" 2>/dev/null || true)" == "healthy" ]]; then
  status=200
  response_body='{"status":"ok"}'
  response_headers=$'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n'
else
  status=502
  response_body='unavailable'
  response_headers=$'HTTP/1.1 502 Bad Gateway\r\n'
fi
if [[ "$url" == *"/" && "\${CURL_REDIRECT:-0}" == "1" ]]; then
  status=302
  response_headers=$'HTTP/1.1 302 Found\r\nLocation: /redirected\r\n'
fi
if [[ "\${FAIL_MAINTENANCE_PROBE:-0}" == "1" && "$url" == *"/" ]]; then status=200; fi
if [[ "\${FAIL_CANDIDATE_PUBLIC_PROBE:-0}" == "1" && "$url" == *"/api/health" ]]; then
  status=502
  response_body='unavailable'
  response_headers=$'HTTP/1.1 502 Bad Gateway\r\n'
fi
if [[ "\${CURL_WRONG_MARKER:-0}" == "1" && "$route_marker" != "" ]]; then
  response_headers="\${response_headers/X-BodyCast-Deploy-Maintenance: $route_marker/X-BodyCast-Deploy-Maintenance: wrong-marker}"
fi
if [[ "\${CURL_NO_STORE_MISSING:-0}" == "1" ]]; then
  response_headers=$'HTTP/1.1 503 Service Unavailable\\r\\nX-BodyCast-Deploy-Maintenance: '"$route_marker"$'\\r\\n'
fi
[[ -z "$headers" ]] || printf '%s' "$response_headers" > "$headers"
[[ -z "$body" ]] || printf '%s\n' "$response_body" > "$body"
if [[ "$write_out" == '%{http_code}' ]]; then printf '%s' "$status"; fi
printf '%s\n' "public-probe:$status:$url" >> "$EVENT_LOG"
if [[ "$fail_on_error" == "true" && "$status" -ge 400 ]]; then exit 22; fi
exit 0
`;

const fakeGit = shellScript`#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == "fetch" && "$*" == *"refs/heads/main:refs/remotes/origin/main"* \
    && "\${ADVANCE_ON_MAIN_FETCH:-0}" == "1" && ! -e "$ADVANCE_MARKER" ]]; then
  "$REAL_GIT" -C "$FIXTURE_REPO" push --quiet origin "\${ADVANCE_SHA}:refs/heads/main"
  : > "$ADVANCE_MARKER"
  printf '%s\n' main-advanced >> "$EVENT_LOG"
fi
if [[ "$1" == "fetch" && "$*" == *"refs/heads/main:refs/remotes/origin/main"* ]]; then
  if [[ "\${FAIL_CANONICAL_FETCH_AFTER_V3:-0}" == "1" && -e "$MAIN_FETCH_FAILURE_MARKER" ]]; then
    printf '%s\n' canonical-main-fetch-failed >> "$EVENT_LOG"
    exit 88
  fi
  printf '%s\n' canonical-main-fetch >> "$EVENT_LOG"
fi
exec "$REAL_GIT" "$@"
`;

const fakeMv = shellScript`mv() {
  local destination source
  destination="\${!#}"
  if [[ "$#" -ge 4 && "$1" == "-f" && "$2" == "--" ]]; then source="$3"; fi
  if [[ "\${FAIL_SERVING_ROUTE_PUBLISH:-0}" == "1" \
    && "$destination" == "$CADDY_ROUTES_PATH/bodycast.caddy" \
    && -n "$source" && -f "$source" ]] && grep -q reverse_proxy "$source"; then
    printf '%s\n' serving-route-publish-failed >> "$EVENT_LOG"
    return 1
  fi
  command mv "$@"
  case "$destination" in
    "$CADDY_ROUTES_PATH"/*)
      event_path="\${destination##*/}"
      printf '%s\n' "atomic-live-route-replacement:$event_path" >> "$EVENT_LOG"
      printf '%s\n' "watch-live-file-change:$event_path" >> "$EVENT_LOG"
      if grep -q reverse_proxy "$destination"; then
        printf '%s\n' live-route-mutation:serving >> "$EVENT_LOG"
        if [[ "\${CADDY_AUTO_WATCH:-0}" == "1" ]]; then
          printf '%s\n' serving > "$ACTIVE_ROUTE_FILE"
          printf '%s\n' auto-watch-serving-effect >> "$EVENT_LOG"
        fi
      else
        printf '%s\n' live-route-mutation:maintenance >> "$EVENT_LOG"
        if [[ "\${CADDY_AUTO_WATCH:-0}" == "1" ]]; then
          printf '%s\n' maintenance > "$ACTIVE_ROUTE_FILE"
          printf '%s\n' auto-watch-maintenance-effect >> "$EVENT_LOG"
        fi
      fi
      ;;
  esac
}
export -f mv`;

const fakeMktemp = shellScript`mktemp() {
  local template="\${1:-}" created
  created="$(command mktemp "$@")"
  case "$template" in
    *.bodycast-route-stage.*)
      printf '%s\n' "$created" >> "$STAGE_PATH_LOG"
      case "$created" in
        "$CADDY_ROUTES_PATH"/*) printf '%s\n' "watch-live-file-created:\${created##*/}" >> "$EVENT_LOG" ;;
        *) printf '%s\n' "watch-ignored-outside-live-routes:\${created##*/}" >> "$EVENT_LOG" ;;
      esac
      ;;
  esac
  printf '%s\n' "$created"
}
export -f mktemp`;

export type Fixture = {
  root: string;
  repo: string;
  routes: string;
  candidateSha: string;
  advanceSha: string;
  bash: string;
  realGit: string;
  env: NodeJS.ProcessEnv;
};

export function createFixture(): Fixture {
  // Capture Git before this fixture prepends its own shim to the child PATH.
  const realGit = findGitExecutable();
  const root = mkdtempSync(path.join(os.tmpdir(), "bodycast-release-freshness-"));
  temporaryRoots.push(root);
  const repo = path.join(root, "repo");
  const remote = path.join(root, "origin.git");
  const bin = path.join(root, "bin");
  const routes = path.join(root, "routes");
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(routes, { recursive: true });

  for (const file of [
    "deploy.sh",
    "deploy-main-freshness.sh",
    "deploy-preflight-schema.sh",
    "production-release-marker.sh",
    "production-route-path.sh",
    "production-route-primitives.sh",
    "production-release-lock.sh",
    "production-traffic-cutover.sh",
    "production-writer-drain.sh",
    "production-previous-app-provenance.mjs",
    "production-capture-resume-receipt.mjs",
    "production-db-target.sh",
    "production-db-target-url.mjs",
    "production-db-preflight.mjs",
    "production-db-preflight.sql",
    "production-app-runtime-digest.mjs",
    "production-migration-authorization.mjs",
    "github-owner-identity.mjs",
    "production-migration-manifests.mjs",
    "production-migration-integrity.mjs",
    "production-migration-preflight.mjs",
    "production-writer-drain.mjs",
    "postgres-database-identity.mjs",
  ]) {
    copyFileSync(path.resolve("scripts", file), path.join(repo, "scripts", file));
  }
  writeFileSync(path.join(repo, "docker-compose.prod.yml"), "services: {}\n");
  writeFileSync(path.join(bin, "docker"), fakeDocker, { mode: 0o755 });
  writeFileSync(path.join(bin, "curl"), fakeCurl, { mode: 0o755 });
  writeFileSync(path.join(bin, "git"), fakeGit, { mode: 0o755 });
  writeFileSync(path.join(bin, "flock"), shellScript`#!/usr/bin/env bash
set -Eeuo pipefail
count="$(cat "$LOCK_COUNT_FILE" 2>/dev/null || printf '0')"
count=$((count + 1))
printf '%s\n' "$count" > "$LOCK_COUNT_FILE"
printf '%s\n' lock-acquired >> "$EVENT_LOG"
[[ "\${LOCK_BUSY:-0}" != "1" ]]
`, { mode: 0o755 });
  writeFileSync(path.join(routes, "bodycast.caddy"), servingRoute());

  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], { stdio: "ignore" });
  execFileSync("git", ["init", "--initial-branch=main", repo], { stdio: "ignore" });
  runGit(repo, "config", "user.name", "Cutover fixture");
  runGit(repo, "config", "user.email", "cutover@example.invalid");
  runGit(repo, "remote", "add", "origin", remote);
  runGit(repo, "add", "scripts", "docker-compose.prod.yml");
  runGit(repo, "commit", "-m", "release fixture candidate");
  const candidateSha = runGit(repo, "rev-parse", "HEAD");
  runGit(repo, "push", "--set-upstream", "origin", "main");
  writeFileSync(path.join(repo, "advance.txt"), "main advanced\n");
  runGit(repo, "add", "advance.txt");
  runGit(repo, "commit", "-m", "advance canonical main");
  const advanceSha = runGit(repo, "rev-parse", "HEAD");
  runGit(repo, "push", "origin", `${advanceSha}:refs/heads/advance`);
  runGit(repo, "checkout", "--detach", "--force", candidateSha);

  const paths = {
    APP_SHA_FILE: path.join(root, "app-sha"),
    APP_IMAGE_ID_FILE: path.join(root, "app-image-id"),
    APP_CONTAINER_ID_FILE: path.join(root, "app-container-id"),
    APP_STATUS_FILE: path.join(root, "app-status"),
    APP_PRESENT_FILE: path.join(root, "app-present"),
    APP_RESTART_FILE: path.join(root, "app-restart"),
    APP_INSPECT_JSON_FILE: path.join(root, "app-inspect.json"),
    IMAGE_LATEST: path.join(root, "image-latest"),
    IMAGE_ROLLBACK: path.join(root, "image-rollback"),
    ACTIVE_ROUTE_FILE: path.join(root, "active-route"),
    DOCKER_LOG: path.join(root, "docker.log"),
    EVENT_LOG: path.join(root, "events.log"),
    STAGE_PATH_LOG: path.join(root, "stage-paths.log"),
    CANDIDATE_STAGE_PATH_LOG: path.join(root, "candidate-stage-paths.log"),
    SCHEMA_PREFLIGHT_COUNT_FILE: path.join(root, "schema-preflight-count"),
    PREVIOUS_DB_REPORT_FILE: path.join(root, "previous-db-report.json"),
    V3_POSTFLIGHT_COUNT_FILE: path.join(root, "v3-postflight-count"),
    ADVANCE_MARKER: path.join(root, "advance-once"),
    MAIN_FETCH_FAILURE_MARKER: path.join(root, "fail-main-fetch-after-v3"),
    FAIL_CANDIDATE_MARKER: path.join(root, "fail-candidate-once"),
    LOCK_COUNT_FILE: path.join(root, "lock-count"),
  };
  writeFileSync(paths.APP_SHA_FILE, `${PREVIOUS_SHA}\n`);
  writeFileSync(paths.APP_IMAGE_ID_FILE, `${PREVIOUS_IMAGE_ID}\n`);
  writeFileSync(paths.APP_CONTAINER_ID_FILE, `${PREVIOUS_CONTAINER_ID}\n`);
  writeFileSync(paths.APP_STATUS_FILE, "healthy\n");
  writeFileSync(paths.APP_INSPECT_JSON_FILE, JSON.stringify([{
    Id: PREVIOUS_CONTAINER_ID,
    Image: PREVIOUS_IMAGE_ID,
    Config: { Labels: { "org.bodycast.release-sha": PREVIOUS_SHA }, Env: ["NODE_ENV=production", "DATABASE_URL=fixture"],
      Entrypoint: ["node"], Cmd: ["server.js"], User: "node", WorkingDir: "/app", Healthcheck: { Test: ["CMD", "true"] }, ExposedPorts: { "3000/tcp": {} } },
    HostConfig: { Binds: [], Mounts: [], PortBindings: {}, RestartPolicy: { Name: "unless-stopped" } },
    Mounts: [], NetworkSettings: { Networks: { "bodycast-backend-prod": {} } }, State: { Health: { Status: "healthy" } },
  }]) + "\n");
  writeFileSync(paths.PREVIOUS_DB_REPORT_FILE, JSON.stringify({
    identity: { database: "bodycast", databaseOid: 16384, clusterSystemIdentifier: "7419276301947620311",
      role: "bodycast", serverVersion: "17.5", serverAddress: "172.20.0.2", serverPort: 5432 },
    migrations: [{ name: "20261001_baseline", checksum: "b".repeat(64), startedAt: "2026-10-01T00:00:00.000Z",
      finishedAt: "2026-10-01T00:01:00.000Z", rolledBackAt: null, logsFingerprint: "c".repeat(32) }],
    objects: [{ name: "DailyModelState", present: true, kind: "table", signature: "typed baseline schema" }],
    writerDrain: { schemaVersion: 1, observerPid: 1, observerApplicationName: "bodycast-production-preflight",
      identityPolicy: "no-other-client-backends", observedAt: "2026-10-09T20:00:00.000Z", activeClientBackends: [],
      topology: { schemaVersion: 1, contract: "bodycast-previous-app-compatibility-snapshot-v1", ready: false,
        blockers: ["writer drain is not asserted by a previous-app compatibility snapshot"] } },
  }) + "\n");
  writeFileSync(paths.APP_PRESENT_FILE, "true\n");
  writeFileSync(paths.APP_RESTART_FILE, "always\n");
  writeFileSync(paths.IMAGE_LATEST, `${LATEST_IMAGE_ID}\n`);
  writeFileSync(paths.ACTIVE_ROUTE_FILE, "serving\n");

  return {
    root,
    repo,
    routes,
    candidateSha,
    advanceSha,
    bash: findBash() ?? "bash",
    realGit,
    env: {
      ...process.env,
      ...Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, toBashPath(value)])),
      PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      FIXTURE_BIN: toBashPath(bin),
      FIXTURE_REPO: toBashPath(repo),
      REAL_GIT: toBashPath(realGit),
      ROUTE_FILE: toBashPath(path.join(routes, "bodycast.caddy")),
      APP_HOST: "bodycast.example.test",
      CADDY_ROUTES_PATH: toBashPath(routes),
      CANDIDATE_SHA: candidateSha,
      ADVANCE_SHA: advanceSha,
      PREVIOUS_SHA,
      PREVIOUS_CONTAINER_ID,
      PREVIOUS_IMAGE_ID,
      LATEST_IMAGE_ID,
      CANDIDATE_IMAGE_ID,
      WRONG_IMAGE_ID,
    },
  };
}

export function runFixture(fixture: Fixture, command: string, overrides: Record<string, string | undefined> = {}) {
  return spawnSync(fixture.bash, ["--noprofile", "--norc", "-c",
    `export PATH="$FIXTURE_BIN:$PATH"; curl() { "$FIXTURE_BIN/curl" "$@"; }; export -f curl; ${fakeMv}; ${fakeMktemp}; ${command}`], {
    cwd: fixture.repo,
    encoding: "utf8",
    env: { ...fixture.env, ...overrides },
  });
}

export function stagedCandidatePath(fixture: Fixture): string {
  const entries = readFileSync(path.join(fixture.root, "candidate-stage-paths.log"), "utf8").trim().split(/\r?\n/);
  return entries.at(-1) ?? "";
}

export function assertStageOutsideLiveRoutes(routes: string, stagePath: string): void {
  const relative = path.posix.relative(toBashPath(routes), stagePath);
  expect(stagePath).not.toBe("");
  expect(relative).not.toBe("");
  expect(relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)).toBe(true);
}

export function assertNoWatcherServingBeforeAtomicPublish(events: string[]): void {
  const firstServingEffect = events.findIndex((event) => event.startsWith("watch-serving-effect:"));
  const firstAtomicRouteReplacement = events.findIndex((event) => event === "atomic-live-route-replacement:bodycast.caddy");
  if (firstServingEffect >= 0 && (firstAtomicRouteReplacement < 0 || firstServingEffect < firstAtomicRouteReplacement)) {
    throw new Error("Caddy watcher served staged candidate bytes before atomic live-route replacement.");
  }
}

export function advanceMain(fixture: Fixture): void {
  runGit(fixture.repo, "push", "origin", `${fixture.advanceSha}:refs/heads/main`);
}

export function appState(fixture: Fixture): { sha: string; imageId: string; status: string; present: string } {
  return {
    sha: readFileSync(path.join(fixture.root, "app-sha"), "utf8").trim(),
    imageId: readFileSync(path.join(fixture.root, "app-image-id"), "utf8").trim(),
    status: readFileSync(path.join(fixture.root, "app-status"), "utf8").trim(),
    present: readFileSync(path.join(fixture.root, "app-present"), "utf8").trim(),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

export const bashAvailable = findBash() !== null;
