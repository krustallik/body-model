#!/usr/bin/env bash
# Protected, no-restart preparation of the BodyCast Auth runtime environment.
# The workflow streams this fixed script over the pinned SSH connection.
set -Eeuo pipefail
set +x
export LC_ALL=C
umask 077

MANAGED_KEYS="BETTER_AUTH_SECRET BETTER_AUTH_URL AUTH_TRUSTED_ORIGINS AUTH_TRUSTED_PROXIES AUTH_PROFILE_ONE_OWNER_EMAIL AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED AUTH_PUBLIC_REGISTRATION_ENABLED BREVO_API_KEY BREVO_SENDER_EMAIL BREVO_SENDER_NAME LEGACY_IOS_SHORTCUT_ENABLED"

verify_pinned_release_file() {
  local path="$1" expected="$2" label="$3" actual
  [[ -f "$path" && ! -L "$path" ]] || {
    echo "The pinned $label release file is unavailable or unsafe." >&2
    return 1
  }
  actual="$(sha256sum "$path" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || {
    echo "The production checkout $label release file differs from exact main." >&2
    return 1
  }
}

rewrite_runtime_env() {
  local source_file="$1" target_file="$2"
  local key value
  for key in $MANAGED_KEYS; do
    value="${!key-}"
    [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || {
      echo "Auth configuration contains an empty or multiline managed value." >&2
      return 1
    }
  done

  awk -v managed_keys="$MANAGED_KEYS" '
    BEGIN {
      count = split(managed_keys, keys, " ")
      for (i = 1; i <= count; i++) managed[keys[i]] = 1
    }
    {
      separator = index($0, "=")
      key = separator ? substr($0, 1, separator - 1) : ""
      if (key in managed) {
        seen[key]++
        next
      }
      print
    }
    END {
      for (i = 1; i <= count; i++) {
        key = keys[i]
        if (seen[key] > 1) {
          print "Duplicate managed runtime variable: " key > "/dev/stderr"
          exit 41
        }
      }
      for (i = 1; i <= count; i++) {
        key = keys[i]
        if (!(key in ENVIRON)) {
          print "Missing managed runtime variable: " key > "/dev/stderr"
          exit 42
        }
        print key "=" ENVIRON[key]
      }
    }
  ' "$source_file" > "$target_file"
}

select_better_auth_secret() {
  local source_file="$1" count value
  count="$(awk -F= '$1 == "BETTER_AUTH_SECRET" { count++ } END { print count + 0 }' "$source_file")"
  [[ "$count" -le 1 ]] || { echo "BETTER_AUTH_SECRET is duplicated in the runtime environment." >&2; return 1; }
  value="$(awk -F= '$1 == "BETTER_AUTH_SECRET" { sub(/^[^=]*=/, ""); print }' "$source_file")"
  if [[ "$value" == \"*\" && ${#value} -ge 2 ]]; then value="${value#\"}"; value="${value%\"}"; fi
  if [[ "$value" == \'*\' && ${#value} -ge 2 ]]; then value="${value#\'}"; value="${value%\'}"; fi
  case "$value" in
    change_me|replace_with_long_random_secret|replace_with_strong_database_password|replace_with_at_least_32_random_characters|bodycast-local-development-only-secret-change-me|bodycast-ci-only-auth-secret-not-for-deployment|integration-test-secret|fixture-better-auth-secret-0123456789|fixture-ios-shortcut-secret|isolated-test-shortcut-key-000000|isolated-auth-test-secret-with-32-characters|isolated-work-interval-auth-secret-with-32-characters|a-long-test-secret|a-long-model-test-secret)
      value=""
      ;;
  esac
  if [[ "$value" =~ ^[A-Za-z0-9_+/=-]{32,}$ ]]; then
    printf '%s' "$value"
  else
    openssl rand -hex 32
  fi
}

if [[ "${BODYCAST_AUTH_CONFIG_TEST_ONLY:-}" == "1" ]]; then
  if [[ "$#" == 2 && "$1" == "--select-secret-test" ]]; then
    select_better_auth_secret "$2"
    exit 0
  fi
  if [[ "$#" == 4 && "$1" == "--verify-pinned-file-test" ]]; then
    verify_pinned_release_file "$2" "$3" "$4"
    exit $?
  fi
  [[ "$#" == 3 && "$1" == "--rewrite-test" ]] || exit 2
  rewrite_runtime_env "$2" "$3"
  exit 0
fi

decode_input() {
  [[ "${!1-}" =~ ^[A-Za-z0-9+/]*={0,2}$ ]] || {
    echo "Protected configuration input is malformed." >&2
    return 1
  }
  printf '%s' "${!1}" | base64 --decode
}

DEPLOY_PATH="$(decode_input BODYCAST_DEPLOY_PATH_B64)"
APP_HOST="$(decode_input BODYCAST_APP_HOST_B64)"
OWNER_EMAIL="$(decode_input BODYCAST_OWNER_EMAIL_B64)"
BREVO_API_KEY="$(decode_input BODYCAST_BREVO_API_KEY_B64)"
RELEASE_SHA="${BODYCAST_RELEASE_SHA:-}"
RUN_ID="${BODYCAST_WORKFLOW_RUN_ID:-}"
RUN_ATTEMPT="${BODYCAST_WORKFLOW_RUN_ATTEMPT:-}"
RELEASE_LOCK_SHA256="${BODYCAST_RELEASE_LOCK_SHA256:-}"
RELEASE_MARKER_SHA256="${BODYCAST_RELEASE_MARKER_SHA256:-}"
SCHEMA_HANDOFF_SHA256="${BODYCAST_SCHEMA_HANDOFF_SHA256:-}"
APP_CAPABILITIES_SHA256="${BODYCAST_APP_CAPABILITIES_SHA256:-}"
PROD_COMPOSE_SHA256="${BODYCAST_PROD_COMPOSE_SHA256:-}"
unset BODYCAST_DEPLOY_PATH_B64 BODYCAST_APP_HOST_B64 BODYCAST_OWNER_EMAIL_B64 BODYCAST_BREVO_API_KEY_B64

[[ "$DEPLOY_PATH" == "/srv/bodycast" && "$APP_HOST" == "bodycast.ihorhub.eu" \
  && "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ \
  && "$RUN_ID" =~ ^[1-9][0-9]{0,19}$ \
  && "$RUN_ATTEMPT" =~ ^[1-9][0-9]{0,19}$ \
  && "$RELEASE_LOCK_SHA256" =~ ^[0-9a-f]{64}$ \
  && "$RELEASE_MARKER_SHA256" =~ ^[0-9a-f]{64}$ \
  && "$SCHEMA_HANDOFF_SHA256" =~ ^[0-9a-f]{64}$ \
  && "$APP_CAPABILITIES_SHA256" =~ ^[0-9a-f]{64}$ \
  && "$PROD_COMPOSE_SHA256" =~ ^[0-9a-f]{64}$ \
  && "$BREVO_API_KEY" =~ ^[A-Za-z0-9_-]{20,}$ ]] || {
  echo "Pinned production Auth configuration inputs are invalid." >&2
  exit 1
}

DEPLOY_CANONICAL="$(realpath -e -- "$DEPLOY_PATH")"
[[ "$DEPLOY_CANONICAL" == "$DEPLOY_PATH" && -d "$DEPLOY_PATH" && ! -L "$DEPLOY_PATH" ]] || {
  echo "The configured BodyCast deployment path is not canonical." >&2
  exit 1
}
GIT_ROOT="$(git -C "$DEPLOY_PATH" rev-parse --show-toplevel 2>/dev/null)"
GIT_DIR="$(git -C "$DEPLOY_PATH" rev-parse --absolute-git-dir 2>/dev/null)"
[[ "$GIT_ROOT" == "$DEPLOY_PATH" && -d "$GIT_DIR" && ! -L "$GIT_DIR" ]] || {
  echo "The configured path is not the BodyCast Git checkout." >&2
  exit 1
}
ORIGIN_URL="$(git -C "$DEPLOY_PATH" remote get-url origin)"
[[ "$ORIGIN_URL" == "git@github.com:krustallik/body-model.git" || "$ORIGIN_URL" == "https://github.com/krustallik/body-model.git" ]] || {
  echo "The configured checkout is not the canonical BodyCast repository." >&2
  exit 1
}
# Reuse only release primitives whose bytes match exact main. The server
# checkout may serve an older app SHA, so its HEAD is intentionally not pinned.
verify_pinned_release_file "$DEPLOY_PATH/scripts/production-release-lock.sh" "$RELEASE_LOCK_SHA256" "lock" || exit 1
cd -- "$DEPLOY_PATH"
[[ "$(git rev-parse --absolute-git-dir 2>/dev/null)" == "$GIT_DIR" ]] || {
  echo "The working directory does not resolve to the pinned BodyCast Git metadata." >&2
  exit 1
}
source "$DEPLOY_PATH/scripts/production-release-lock.sh"
bodycast_acquire_production_release_lock

# Recheck checkout state only after serialization with release writers.
[[ "$(git rev-parse --show-toplevel 2>/dev/null)" == "$DEPLOY_PATH" \
  && "$(git rev-parse --absolute-git-dir 2>/dev/null)" == "$GIT_DIR" \
  && -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || {
  echo "The BodyCast checkout changed or is dirty under the release lock." >&2
  exit 1
}
verify_pinned_release_file "$DEPLOY_PATH/scripts/production-release-lock.sh" "$RELEASE_LOCK_SHA256" "lock" || exit 1
verify_pinned_release_file "$DEPLOY_PATH/scripts/production-release-marker.sh" "$RELEASE_MARKER_SHA256" "marker" || exit 1
verify_pinned_release_file "$DEPLOY_PATH/scripts/production-schema-deploy-handoff.mjs" "$SCHEMA_HANDOFF_SHA256" "schema handoff validator" || exit 1
verify_pinned_release_file "$DEPLOY_PATH/scripts/production-app-capabilities.mjs" "$APP_CAPABILITIES_SHA256" "app capabilities dependency" || exit 1
verify_pinned_release_file "$DEPLOY_PATH/docker-compose.prod.yml" "$PROD_COMPOSE_SHA256" "production Compose" || exit 1

if [[ "$ORIGIN_URL" == "git@github.com:krustallik/body-model.git" ]]; then
  GITHUB_DEPLOY_KEY="/root/.ssh/bodycast_github_deploy"
  [[ -f "$GITHUB_DEPLOY_KEY" && ! -L "$GITHUB_DEPLOY_KEY" \
    && "$(stat -c '%u' "$GITHUB_DEPLOY_KEY")" == "0" \
    && ( "$(stat -c '%a' "$GITHUB_DEPLOY_KEY")" == "600" || "$(stat -c '%a' "$GITHUB_DEPLOY_KEY")" == "400" ) ]] || {
    echo "The root-only read-only BodyCast GitHub deploy key is unavailable or unsafe." >&2
    exit 1
  }
  export GIT_SSH_COMMAND="ssh -i $GITHUB_DEPLOY_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes"
fi
export GIT_TERMINAL_PROMPT=0
REMOTE_MAIN="$(git -C "$DEPLOY_PATH" ls-remote origin refs/heads/main | awk 'NR == 1 { print $1 }')" || {
  echo "The current BodyCast main SHA could not be verified from the production checkout." >&2
  exit 1
}
[[ "$REMOTE_MAIN" == "$RELEASE_SHA" ]] || {
  echo "Production configuration candidate is no longer the exact current main SHA." >&2
  exit 1
}

# Reuse the release marker reader used by existing production paths.
source "$DEPLOY_PATH/scripts/production-release-marker.sh"
if read_bodycast_release_marker; then
  echo "An active production release marker blocks Auth configuration." >&2
  exit 1
else
  marker_status=$?
  [[ "$marker_status" == 1 ]] || {
    echo "Production release marker state is ambiguous." >&2
    exit 1
  }
fi

ENV_FILE="$DEPLOY_PATH/.env"
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" && "$(stat -c '%u' "$ENV_FILE")" == "0" ]] || {
  echo "The BodyCast runtime environment file is absent or not root-owned." >&2
  exit 1
}
ENV_MODE="$(stat -c '%a' "$ENV_FILE")"
[[ "$ENV_MODE" =~ ^[0-7]{3,4}$ ]] && (( (8#$ENV_MODE & 0022) == 0 )) || {
  echo "The BodyCast runtime environment file has unsafe write permissions." >&2
  exit 1
}
ENV_DIGEST_BEFORE="$(sha256sum "$ENV_FILE" | awk '{print $1}')"

TEMP_ROOT="$(mktemp -d /var/tmp/bodycast-auth-config.XXXXXX)"
chmod 700 "$TEMP_ROOT"
TEMP_ENV=""
BACKUP_FILE=""
committed=0
cleanup() {
  local status=$? rollback_tmp
  trap - EXIT INT TERM HUP
  if [[ "$committed" == "1" && -f "$BACKUP_FILE" && ! -L "$BACKUP_FILE" ]]; then
    rollback_tmp="$(mktemp "$DEPLOY_PATH/.env.bodycast-auth-rollback.XXXXXX")"
    cp -- "$BACKUP_FILE" "$rollback_tmp"
    chmod 600 "$rollback_tmp"
    sync -f "$rollback_tmp"
    mv -fT -- "$rollback_tmp" "$ENV_FILE"
    sync -f "$DEPLOY_PATH"
    committed=0
    rm -f -- "$BACKUP_FILE"
    echo "Previous Auth runtime configuration restored." >&2
  elif [[ "$committed" == "0" && -n "$BACKUP_FILE" ]]; then
    rm -f -- "$BACKUP_FILE"
  fi
  [[ -z "$TEMP_ENV" ]] || rm -f -- "$TEMP_ENV"
  [[ -z "$TEMP_ROOT" ]] || rm -rf -- "$TEMP_ROOT"
  [[ "$committed" != "2" || -z "$BACKUP_FILE" ]] || rm -f -- "$BACKUP_FILE"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

assert_public_serving() {
  local tag="$1" home_status api_status
  command -v curl >/dev/null 2>&1 || { echo "HTTPS health probe is unavailable." >&2; return 1; }
  home_status="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
    --dump-header "$TEMP_ROOT/${tag}-home.headers" --output "$TEMP_ROOT/${tag}-home.body" \
    --write-out '%{http_code}' "https://$APP_HOST/" 2>"$TEMP_ROOT/${tag}-home.err")" || {
    echo "The current BodyCast HTTPS endpoint is unavailable." >&2; return 1;
  }
  [[ "$home_status" =~ ^(200|301|302|303|307|308)$ ]] \
    && ! grep -qi '^x-bodycast-deploy-maintenance:' "$TEMP_ROOT/${tag}-home.headers" \
    && ! grep -Fq 'BodyCast is temporarily unavailable while the model is updated.' "$TEMP_ROOT/${tag}-home.body" || {
      echo "The current BodyCast website is in maintenance or returned an unexpected status." >&2; return 1;
    }
  api_status="$(curl --silent --show-error --connect-timeout 5 --max-time 10 \
    --output "$TEMP_ROOT/${tag}-health.body" --write-out '%{http_code}' \
    "https://$APP_HOST/api/health" 2>"$TEMP_ROOT/${tag}-health.err")" || {
    echo "The current BodyCast health API is unavailable." >&2; return 1;
  }
  [[ "$api_status" == 200 ]] && grep -Fq '"status":"ok"' "$TEMP_ROOT/${tag}-health.body" || {
    echo "The current BodyCast health API is not healthy." >&2; return 1;
  }
}

app_state() {
  docker inspect --format '{{.Id}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{json .Config.Env}}' bodycast-app-prod 2>/dev/null
}
db_state() {
  docker inspect --format '{{.Id}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}' bodycast-db-prod 2>/dev/null
}

APP_BEFORE="$(app_state)" || { echo "The existing BodyCast app container is unavailable." >&2; exit 1; }
DB_BEFORE="$(db_state)" || { echo "The existing BodyCast PostgreSQL container is unavailable." >&2; exit 1; }
APP_ID_BEFORE="${APP_BEFORE%%|*}"
DB_ID_BEFORE="${DB_BEFORE%%|*}"
[[ "${APP_BEFORE#*|}" == true\|healthy\|* && "${DB_BEFORE#*|}" == true\|healthy\|* ]] || {
  echo "The existing BodyCast app or PostgreSQL is not healthy; runtime configuration was not changed." >&2
  exit 1
}
assert_public_serving before || exit 1

CADDY_IDS="$(docker ps -aq --filter name=caddy)"
CADDY_MATCHES=0
CADDY_IP=""
while IFS= read -r caddy_id; do
  [[ -n "$caddy_id" ]] || continue
  caddy_name="$(docker inspect --format '{{.Name}}' "$caddy_id" 2>/dev/null | sed 's#^/##')"
  caddy_state="$(docker inspect --format '{{.State.Running}}' "$caddy_id" 2>/dev/null || true)"
  caddy_ip="$(docker inspect --format '{{with index .NetworkSettings.Networks "gymbeam-internal"}}{{.IPAddress}}{{end}}' "$caddy_id" 2>/dev/null || true)"
  if [[ "$caddy_name" =~ [Cc][Aa][Dd][Dd][Yy] && "$caddy_state" == true && "$caddy_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    CADDY_MATCHES=$((CADDY_MATCHES + 1))
    CADDY_IP="$caddy_ip"
  fi
done <<< "$CADDY_IDS"
[[ "$CADDY_MATCHES" == 1 ]] || {
  echo "The verified BodyCast reverse proxy is not running on its configured Docker network." >&2
  exit 1
}

DB_LINES_BEFORE="$(awk -F= '$1 == "DATABASE_URL" { count++; print } END { if (count != 1) exit 1 }' "$ENV_FILE")" || {
  echo "DATABASE_URL must occur exactly once in the existing runtime environment." >&2; exit 1;
}
SHORTCUT_LINES_BEFORE="$(awk -F= '$1 == "IOS_SHORTCUT_API_KEY" { count++; print } END { if (count != 1) exit 1 }' "$ENV_FILE")" || {
  echo "IOS_SHORTCUT_API_KEY must occur exactly once in the existing runtime environment." >&2; exit 1;
}
BETTER_AUTH_SECRET="$(select_better_auth_secret "$ENV_FILE")"

BETTER_AUTH_URL="https://$APP_HOST"
AUTH_TRUSTED_ORIGINS="https://$APP_HOST"
AUTH_TRUSTED_PROXIES="$CADDY_IP/32"
AUTH_PROFILE_ONE_OWNER_EMAIL="$(printf '%s' "$OWNER_EMAIL" | tr '[:upper:]' '[:lower:]')"
AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED=true
AUTH_PUBLIC_REGISTRATION_ENABLED=false
BREVO_SENDER_EMAIL="no-reply@ihorhub.eu"
BREVO_SENDER_NAME="BodyCast"
LEGACY_IOS_SHORTCUT_ENABLED=true
export BETTER_AUTH_SECRET BETTER_AUTH_URL AUTH_TRUSTED_ORIGINS AUTH_TRUSTED_PROXIES \
  AUTH_PROFILE_ONE_OWNER_EMAIL AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED AUTH_PUBLIC_REGISTRATION_ENABLED \
  BREVO_API_KEY BREVO_SENDER_EMAIL BREVO_SENDER_NAME LEGACY_IOS_SHORTCUT_ENABLED

CANDIDATE_ENV="$TEMP_ROOT/.env"
rewrite_runtime_env "$ENV_FILE" "$CANDIDATE_ENV"
chmod 600 "$CANDIDATE_ENV"
CANDIDATE_DIGEST="$(sha256sum "$CANDIDATE_ENV" | awk '{print $1}')"
[[ "$(awk -F= '$1 == "DATABASE_URL" { count++; print } END { if (count != 1) exit 1 }' "$CANDIDATE_ENV")" == "$DB_LINES_BEFORE" \
  && "$(awk -F= '$1 == "IOS_SHORTCUT_API_KEY" { count++; print } END { if (count != 1) exit 1 }' "$CANDIDATE_ENV")" == "$SHORTCUT_LINES_BEFORE" ]] || {
  echo "The candidate environment did not preserve database and Shortcut entries exactly." >&2; exit 1;
}

COMPOSE_DIR="$TEMP_ROOT/compose"
mkdir -m 700 "$COMPOSE_DIR"
cp -- "$DEPLOY_PATH/docker-compose.prod.yml" "$COMPOSE_DIR/docker-compose.prod.yml"
cp -- "$CANDIDATE_ENV" "$COMPOSE_DIR/.env"
chmod 600 "$COMPOSE_DIR/.env"
COMPOSE_JSON="$TEMP_ROOT/compose.json"
if ! docker compose --project-directory "$COMPOSE_DIR" --env-file "$COMPOSE_DIR/.env" \
  -f "$COMPOSE_DIR/docker-compose.prod.yml" config --format json > "$COMPOSE_JSON" 2> "$TEMP_ROOT/compose.err"; then
  echo "Candidate production Compose configuration failed validation." >&2
  exit 1
fi
chmod 600 "$COMPOSE_JSON"

validate_candidate() {
  local runtime_json="$1" result="$2"
  if {
    base64 -w0 < "$COMPOSE_JSON"
    printf '\n'
    printf '%s' "$runtime_json" | base64 -w0
    printf '\n%s\n' "$CADDY_IP"
  } | docker exec --interactive --env "BODYCAST_CONFIG_APP_HOST=$APP_HOST" bodycast-app-prod node --input-type=module -e '
let input = "";
for await (const chunk of process.stdin) input += chunk;
const lines = input.trim().split(/\r?\n/);
const report = Object.create(null);
const yes = (key, value) => { report[key] = value ? "yes" : "no"; };
let ready = false;
try {
  if (lines.length !== 3) throw new Error("input");
  const doc = JSON.parse(Buffer.from(lines[0], "base64").toString("utf8"));
  const live = new Map(JSON.parse(Buffer.from(lines[1], "base64").toString("utf8")).map((item) => {
    const at = item.indexOf("="); return [item.slice(0, at), item.slice(at + 1)];
  }));
  const caddyIp = lines[2];
  const env = doc?.services?.app?.environment;
  if (!env || typeof env !== "object" || Array.isArray(env)) throw new Error("compose");
  const origin = `https://${process.env.BODYCAST_CONFIG_APP_HOST}`;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const secretValid = typeof env.BETTER_AUTH_SECRET === "string" && /^[A-Za-z0-9_+\/=\-]{32,}$/.test(env.BETTER_AUTH_SECRET);
  const origins = String(env.AUTH_TRUSTED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const proxies = String(env.AUTH_TRUSTED_PROXIES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  yes("auth_config_node_env_production", env.NODE_ENV === "production");
  yes("auth_config_secret_valid", secretValid);
  yes("auth_config_url_matches", env.BETTER_AUTH_URL === origin);
  yes("auth_config_origins_valid", origins.length > 0 && origins.every((value) => value === origin));
  const { isIP } = await import("node:net");
  yes("auth_config_proxy_matches_caddy", isIP(caddyIp) === 4 && proxies.length === 1 && proxies[0] === `${caddyIp}/32`);
  yes("auth_config_owner_email_valid", emailPattern.test(env.AUTH_PROFILE_ONE_OWNER_EMAIL ?? ""));
  yes("auth_config_bootstrap_enabled", env.AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED === "true");
  yes("auth_config_public_registration_disabled", env.AUTH_PUBLIC_REGISTRATION_ENABLED === "false");
  yes("auth_config_brevo_configured", typeof env.BREVO_API_KEY === "string" && env.BREVO_API_KEY.length > 0
    && env.BREVO_SENDER_EMAIL === "no-reply@ihorhub.eu" && env.BREVO_SENDER_NAME === "BodyCast");
  yes("auth_config_legacy_shortcut_enabled", env.LEGACY_IOS_SHORTCUT_ENABLED === "true");
  yes("auth_config_database_url_unchanged", env.DATABASE_URL === live.get("DATABASE_URL"));
  yes("auth_config_shortcut_key_unchanged", env.IOS_SHORTCUT_API_KEY === live.get("IOS_SHORTCUT_API_KEY"));
  if (!Object.values(report).every((value) => value === "yes")) throw new Error("static");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const headers = { "api-key": env.BREVO_API_KEY, accept: "application/json" };
    const get = (path) => fetch(`https://api.brevo.com/v3/${path}`, {
      method: "GET", headers, redirect: "error", cache: "no-store", signal: controller.signal,
    });
    const [accountResponse, senderResponse, domainResponse, reportResponse] = await Promise.all([
      get("account"), get("senders"), get("senders/domains"), get("smtp/statistics/reports?days=1&limit=1"),
    ]);
    report.auth_config_brevo_api_status = "account=" + accountResponse.status
      + ",senders=" + senderResponse.status + ",domains=" + domainResponse.status
      + ",smtp_report=" + reportResponse.status;
    yes("auth_config_brevo_api", [accountResponse, senderResponse, domainResponse, reportResponse].every((response) => response.ok));
    const account = accountResponse.ok ? await accountResponse.json() : {};
    const senders = senderResponse.ok ? await senderResponse.json() : {};
    const domains = domainResponse.ok ? await domainResponse.json() : {};
    const activeSender = Array.isArray(senders?.senders) && senders.senders.some((sender) =>
      sender?.email?.toLowerCase() === env.BREVO_SENDER_EMAIL.toLowerCase()
        && sender?.name === env.BREVO_SENDER_NAME && sender?.active === true);
    const domainAuthenticated = Array.isArray(domains?.domains) && domains.domains.some((domain) =>
      domain?.domain_name?.toLowerCase() === "ihorhub.eu" && domain?.authenticated === true && domain?.verified === true);
    const credits = Array.isArray(account?.plan) ? account.plan.filter((item) => item?.creditsType === "sendLimit") : [];
    const creditStatus = credits.length === 0 ? "not_reported"
      : credits.some((item) => Number(item?.credits) > 0) ? "positive" : "zero";
    yes("auth_config_brevo_sender_active", activeSender);
    yes("auth_config_brevo_domain_authenticated", domainAuthenticated);
    yes("auth_config_brevo_transactional_relay_enabled", account?.relay?.enabled === true);
    yes("auth_config_brevo_transactional_stats_available", reportResponse.ok);
    report.auth_config_brevo_send_limit_status = creditStatus;
    ready = activeSender && domainAuthenticated && account?.relay?.enabled === true
      && reportResponse.ok && creditStatus === "positive";
    yes("auth_config_candidate_ready", ready);
  } finally { clearTimeout(timeout); }
} catch {
  if (!("auth_config_candidate_ready" in report)) yes("auth_config_candidate_ready", false);
  if (!("auth_config_brevo_api" in report)) report.auth_config_brevo_api = "not_verified";
  if (!("auth_config_brevo_api_status" in report)) report.auth_config_brevo_api_status = "network_or_response_error";
}
for (const [key, value] of Object.entries(report)) process.stdout.write(`${key}=${value}\n`);
if (!ready || !Object.entries(report).every(([key, value]) => key.endsWith("_candidate_ready") ? value === "yes"
  : value === "yes" || key === "auth_config_brevo_send_limit_status" || key === "auth_config_brevo_api_status")) process.exitCode = 1;
' > "$result" 2>/dev/null; then
    return 0
  else
    [[ ! -f "$result" ]] || cat "$result"
    echo "Candidate Auth/Brevo configuration validation failed; provider response details were suppressed." >&2
    return 1
  fi
}

VALIDATION_RESULT="$TEMP_ROOT/validation.result"
# Extract the existing live container environment without exposing it in output.
RUNTIME_JSON="$(docker inspect --format '{{json .Config.Env}}' bodycast-app-prod 2>/dev/null)" || {
  echo "The existing app runtime environment could not be inspected." >&2; exit 1;
}
if ! validate_candidate "$RUNTIME_JSON" "$VALIDATION_RESULT"; then exit 1; fi

# Keep an owner-only rollback copy until the on-disk config has passed its
# post-commit Compose/provider checks. The currently serving container is never restarted.
BACKUP_CANDIDATE="$DEPLOY_PATH/.env.bodycast-auth-backup.${RUN_ID}.${RUN_ATTEMPT}"
[[ ! -e "$BACKUP_CANDIDATE" && ! -L "$BACKUP_CANDIDATE" ]] || {
  echo "A prior Auth configuration recovery copy exists; refusing to overwrite it." >&2
  exit 1
}
BACKUP_FILE="$BACKUP_CANDIDATE"
[[ "$(sha256sum "$ENV_FILE" | awk '{print $1}')" == "$ENV_DIGEST_BEFORE" ]] || {
  echo "The BodyCast runtime environment changed during candidate validation; refusing to overwrite it." >&2
  exit 1
}
cp -p -- "$ENV_FILE" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"
sync -f "$BACKUP_FILE"
[[ "$(sha256sum "$BACKUP_FILE" | awk '{print $1}')" == "$ENV_DIGEST_BEFORE" ]] || {
  echo "The Auth runtime recovery copy does not match the original environment." >&2
  exit 1
}
TEMP_ENV="$(mktemp "$DEPLOY_PATH/.env.bodycast-auth-new.XXXXXX")"
chmod 600 "$TEMP_ENV"
rewrite_runtime_env "$BACKUP_FILE" "$TEMP_ENV"
[[ "$(sha256sum "$TEMP_ENV" | awk '{print $1}')" == "$CANDIDATE_DIGEST" ]] || {
  echo "The final Auth candidate differs from the previously validated configuration." >&2
  exit 1
}
[[ "$(awk -F= '$1 == "DATABASE_URL" { count++; print } END { if (count != 1) exit 1 }' "$TEMP_ENV")" == "$DB_LINES_BEFORE" \
  && "$(awk -F= '$1 == "IOS_SHORTCUT_API_KEY" { count++; print } END { if (count != 1) exit 1 }' "$TEMP_ENV")" == "$SHORTCUT_LINES_BEFORE" ]] || {
  rm -f -- "$TEMP_ENV"
  echo "Runtime environment preservation check failed before commit." >&2
  exit 1
}
[[ "$(sha256sum "$ENV_FILE" | awk '{print $1}')" == "$ENV_DIGEST_BEFORE" ]] || {
  echo "The BodyCast runtime environment changed before atomic commit; refusing to overwrite it." >&2
  exit 1
}
[[ "$(sha256sum "$BACKUP_FILE" | awk '{print $1}')" == "$ENV_DIGEST_BEFORE" ]] || {
  echo "The Auth runtime recovery copy changed before atomic commit; refusing to overwrite the environment." >&2
  exit 1
}
sync -f "$TEMP_ENV"
committed=1
mv -fT -- "$TEMP_ENV" "$ENV_FILE"
sync -f "$DEPLOY_PATH"
# Re-render the committed file and repeat all candidate checks before removing
# the recovery copy. This remains read-only with respect to Docker and PostgreSQL.
cp -- "$ENV_FILE" "$COMPOSE_DIR/.env"
chmod 600 "$COMPOSE_DIR/.env"
if ! docker compose --project-directory "$COMPOSE_DIR" --env-file "$COMPOSE_DIR/.env" \
  -f "$COMPOSE_DIR/docker-compose.prod.yml" config --format json > "$COMPOSE_JSON" 2> "$TEMP_ROOT/compose-post.err"; then
  echo "Committed Auth environment failed Compose validation; restoring the previous configuration." >&2
  exit 1
fi
chmod 600 "$COMPOSE_JSON"
if ! validate_candidate "$RUNTIME_JSON" "$VALIDATION_RESULT"; then
  echo "Committed Auth environment failed provider validation; restoring the previous configuration." >&2
  exit 1
fi
assert_public_serving after || { echo "Public health changed during configuration; restoring the previous configuration." >&2; exit 1; }

APP_AFTER="$(app_state)" || { echo "The existing app container disappeared during configuration." >&2; exit 1; }
DB_AFTER="$(db_state)" || { echo "PostgreSQL disappeared during configuration." >&2; exit 1; }
[[ "${APP_AFTER%%|*}" == "$APP_ID_BEFORE" && "${DB_AFTER%%|*}" == "$DB_ID_BEFORE" \
  && "$APP_AFTER" == "$APP_BEFORE" && "$DB_AFTER" == "$DB_BEFORE" ]] || {
  echo "A BodyCast container changed during Auth configuration; restoring the previous configuration." >&2
  exit 1
}

cat "$VALIDATION_RESULT"
printf 'auth_config_prepared=yes\ncurrent_live_container_unchanged=yes\ncandidate_runtime_verified=yes\n'
committed=2
rm -f -- "$BACKUP_FILE"
trap - EXIT INT TERM HUP
rm -rf -- "$TEMP_ROOT"
