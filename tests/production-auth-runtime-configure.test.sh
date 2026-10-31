#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/production-auth-runtime-configure.sh"
WORKFLOW="$ROOT/.github/workflows/production-auth-runtime-configure.yml"
TEMP="$(mktemp -d)"
trap 'rm -rf -- "$TEMP"' EXIT

cat > "$TEMP/.env" <<'ENV'
NODE_ENV=production
POSTGRES_DB=bodycast
POSTGRES_USER=bodycast
POSTGRES_PASSWORD=fixture-db-password
DATABASE_URL=postgresql://bodycast:fixture-db-password@db:5432/bodycast
IOS_SHORTCUT_API_KEY=fixture-shortcut-key-with-more-than-sixteen
BETTER_AUTH_SECRET=replace_with_at_least_32_random_characters
BETTER_AUTH_URL=https://old.example.test
AUTH_TRUSTED_ORIGINS=https://old.example.test
AUTH_TRUSTED_PROXIES=127.0.0.1/32
AUTH_PROFILE_ONE_OWNER_EMAIL=old@example.test
AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED=false
AUTH_PUBLIC_REGISTRATION_ENABLED=true
BREVO_API_KEY=old-key
BREVO_SENDER_EMAIL=old@example.test
BREVO_SENDER_NAME=Old
LEGACY_IOS_SHORTCUT_ENABLED=false
OTHER_RUNTIME_VALUE=preserve-this-line
ENV

fixture_secret="$(openssl rand -hex 32)"
export BETTER_AUTH_SECRET="$fixture_secret"
export BETTER_AUTH_URL="https://bodycast.ihorhub.eu"
export AUTH_TRUSTED_ORIGINS="https://bodycast.ihorhub.eu"
export AUTH_TRUSTED_PROXIES="172.19.0.4/32"
export AUTH_PROFILE_ONE_OWNER_EMAIL="owner@example.test"
export AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED=true
export AUTH_PUBLIC_REGISTRATION_ENABLED=false
export BREVO_API_KEY="fixture-brevo-api-key-not-a-secret"
export BREVO_SENDER_EMAIL="no-reply@ihorhub.eu"
export BREVO_SENDER_NAME="BodyCast"
export LEGACY_IOS_SHORTCUT_ENABLED=true

BODYCAST_AUTH_CONFIG_TEST_ONLY=1 bash "$SCRIPT" --rewrite-test "$TEMP/.env" "$TEMP/.env.next" > "$TEMP/stdout" 2> "$TEMP/stderr"
grep -Fxq 'DATABASE_URL=postgresql://bodycast:fixture-db-password@db:5432/bodycast' "$TEMP/.env.next"
grep -Fxq 'IOS_SHORTCUT_API_KEY=fixture-shortcut-key-with-more-than-sixteen' "$TEMP/.env.next"
grep -Fxq 'OTHER_RUNTIME_VALUE=preserve-this-line' "$TEMP/.env.next"
grep -Fxq 'AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED=true' "$TEMP/.env.next"
grep -Fxq 'AUTH_PUBLIC_REGISTRATION_ENABLED=false' "$TEMP/.env.next"
grep -Fxq 'BREVO_API_KEY=fixture-brevo-api-key-not-a-secret' "$TEMP/.env.next"
[[ "$(grep -c '^DATABASE_URL=' "$TEMP/.env.next")" == 1 ]]
[[ "$(grep -c '^IOS_SHORTCUT_API_KEY=' "$TEMP/.env.next")" == 1 ]]
! grep -Fq 'fixture-brevo-api-key-not-a-secret' "$TEMP/stdout" "$TEMP/stderr"
! grep -Fq "$fixture_secret" "$TEMP/stdout" "$TEMP/stderr"

generated_secret="$(BODYCAST_AUTH_CONFIG_TEST_ONLY=1 bash "$SCRIPT" --select-secret-test "$TEMP/.env")"
[[ "$generated_secret" =~ ^[a-f0-9]{64}$ ]]
cat > "$TEMP/.env.secret" <<'ENV'
BETTER_AUTH_SECRET=runtime+secret/with/base64==characters0123456789
ENV
selected_secret="$(BODYCAST_AUTH_CONFIG_TEST_ONLY=1 bash "$SCRIPT" --select-secret-test "$TEMP/.env.secret")"
[[ "$selected_secret" == "runtime+secret/with/base64==characters0123456789" ]]
printf 'BETTER_AUTH_SECRET="runtime+secret/with/base64==characters0123456789"\n' > "$TEMP/.env.quoted"
selected_secret="$(BODYCAST_AUTH_CONFIG_TEST_ONLY=1 bash "$SCRIPT" --select-secret-test "$TEMP/.env.quoted")"
[[ "$selected_secret" == "runtime+secret/with/base64==characters0123456789" ]]
export BETTER_AUTH_SECRET="$generated_secret"
BODYCAST_AUTH_CONFIG_TEST_ONLY=1 bash "$SCRIPT" --rewrite-test "$TEMP/.env" "$TEMP/.env.generated"
selected_secret="$(BODYCAST_AUTH_CONFIG_TEST_ONLY=1 bash "$SCRIPT" --select-secret-test "$TEMP/.env.generated")"
[[ "$selected_secret" == "$generated_secret" ]]
export BETTER_AUTH_SECRET="$fixture_secret"
unset generated_secret selected_secret

for invalid_secret in \
  change_me replace_with_long_random_secret replace_with_strong_database_password \
  replace_with_at_least_32_random_characters bodycast-local-development-only-secret-change-me \
  bodycast-ci-only-auth-secret-not-for-deployment integration-test-secret \
  fixture-better-auth-secret-0123456789 fixture-ios-shortcut-secret \
  isolated-test-shortcut-key-000000 isolated-auth-test-secret-with-32-characters \
  isolated-work-interval-auth-secret-with-32-characters a-long-test-secret a-long-model-test-secret; do
  printf 'BETTER_AUTH_SECRET=%s\n' "$invalid_secret" > "$TEMP/.env.placeholder"
  selected_secret="$(BODYCAST_AUTH_CONFIG_TEST_ONLY=1 bash "$SCRIPT" --select-secret-test "$TEMP/.env.placeholder")"
  [[ "$selected_secret" =~ ^[a-f0-9]{64}$ && "$selected_secret" != "$invalid_secret" ]]
done

cat >> "$TEMP/.env" <<'ENV'
AUTH_TRUSTED_ORIGINS=https://duplicate.example.test
ENV
if BODYCAST_AUTH_CONFIG_TEST_ONLY=1 bash "$SCRIPT" --rewrite-test "$TEMP/.env" "$TEMP/duplicate.next" > "$TEMP/duplicate.stdout" 2> "$TEMP/duplicate.stderr"; then
  echo "Duplicate managed runtime variables must fail closed." >&2
  exit 1
fi
grep -q 'Duplicate managed runtime variable: AUTH_TRUSTED_ORIGINS' "$TEMP/duplicate.stderr"
grep -Fxq 'AUTH_TRUSTED_ORIGINS=https://duplicate.example.test' "$TEMP/.env"

grep -Fq 'environment: production' "$WORKFLOW"
grep -Fq "github.actor_id == '126446430'" "$WORKFLOW"
grep -Fq 'SSH_HOST_FINGERPRINT' "$WORKFLOW"
grep -Fq 'DEPLOY_PATH" == "/srv/bodycast"' "$WORKFLOW"
grep -Fq 'BODYCAST_RELEASE_LOCK_SHA256' "$WORKFLOW"
grep -Fq 'BODYCAST_RELEASE_MARKER_SHA256' "$WORKFLOW"
grep -Fq 'BODYCAST_PROD_COMPOSE_SHA256' "$WORKFLOW"
grep -Fq 'BREVO_API_KEY' "$WORKFLOW"
! grep -Fq 'BODYCAST_AUTH_CONFIG_TEST_ONLY' "$WORKFLOW"
grep -Fq 'production-release-lock.sh' "$SCRIPT"
grep -Fq 'verify_pinned_release_file' "$SCRIPT"
grep -Fq 'cd -- "$DEPLOY_PATH"' "$SCRIPT"
[[ "$(grep -Fc 'verify_pinned_release_file "$DEPLOY_PATH/scripts/production-release-lock.sh"' "$SCRIPT")" == 2 ]]
grep -Fq 'DEPLOY_PATH" == "/srv/bodycast"' "$SCRIPT"
grep -Fq 'sha256sum "$BACKUP_FILE"' "$SCRIPT"
grep -Fq 'CANDIDATE_DIGEST' "$SCRIPT"
grep -Fq 'docker compose' "$SCRIPT"
! grep -Eq 'docker (compose )?(up|down|stop|start|restart|rm|run)([[:space:]]|$)' "$SCRIPT"
! grep -Eq 'prisma|psql|ALTER TABLE|DELETE FROM|UPDATE ' "$SCRIPT"
! grep -Fq 'BREVO_API_KEY=' "$WORKFLOW"

printf 'production Auth runtime configuration regression: PASS\n'
