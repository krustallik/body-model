#!/usr/bin/env bash
# Protected final migration guard. Only the owner-gated workflow invokes this fixed script.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT_DIR"

readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly DB_CONTAINER="bodycast-db-prod"
readonly CANONICAL_URL="https://github.com/krustallik/body-model.git"
readonly MANIFEST_ID="$BODYCAST_MIGRATION_MANIFEST_ID"
readonly RELEASE_SHA="$RELEASE_SHA"
readonly CONTEXT_DIR="$BODYCAST_MIGRATION_CONTEXT_DIR"
readonly APP_HOST="${APP_HOST:?APP_HOST is required for the maintenance topology gate}"
readonly CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:?CADDY_ROUTES_PATH is required for the maintenance topology gate}"
export APP_HOST CADDY_ROUTES_PATH
source "$ROOT_DIR/scripts/production-release-marker.sh"
source "$ROOT_DIR/scripts/production-release-lock.sh"

fail() { echo "Production migration blocked: $*" >&2; exit 1; }

[[ "$MANIFEST_ID" == "active-energy-unified-v2" ]] || fail "a closed reviewed manifest id is required."
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "RELEASE_SHA must be a full lowercase commit SHA."
[[ "$BODYCAST_AUTHORIZATION_WORKFLOW_ID" =~ ^[1-9][0-9]*$ \
  && "$BODYCAST_AUTHORIZATION_RUN_ID" =~ ^[1-9][0-9]*$ \
  && "$BODYCAST_AUTHORIZATION_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]] || fail "current authorization workflow identity is required."
[[ "$CONTEXT_DIR" == /* && -d "$CONTEXT_DIR" && ! -L "$CONTEXT_DIR" ]] || fail "a private absolute migration context directory is required."
for name in authorization-envelope.json preflight-result.json preflight-evidence.json restore-result.json artifact-metadata.json; do
  [[ -f "$CONTEXT_DIR/$name" && ! -L "$CONTEXT_DIR/$name" ]] || fail "required signed context file is missing or a symlink: $name"
done

bodycast_acquire_production_release_lock

[[ "$(git rev-parse --show-toplevel)" == "$ROOT_DIR" ]] || fail "repository root does not match the deployment checkout."
[[ "$(git rev-parse HEAD)" == "$RELEASE_SHA" ]] || fail "deployment checkout does not equal the authorized release SHA."
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || fail "deployment checkout is not clean."
marker_status=1
if read_bodycast_release_marker; then
  marker_status=0
else
  marker_status=$?
fi
[[ "$marker_status" -eq 1 ]] || fail "an existing schema-cutover marker requires explicit recovery; this migration run cannot reuse it."

# Fetch canonical main into a dedicated ref without changing the mutable origin remote.
GIT_TERMINAL_PROMPT=0 git -c "remote.bodycast-canonical.url=$CANONICAL_URL" \
  fetch --no-tags --prune bodycast-canonical +refs/heads/main:refs/remotes/bodycast-canonical/main
CANONICAL_MAIN_SHA="$(git rev-parse --verify 'refs/remotes/bodycast-canonical/main^{commit}')"
[[ "$CANONICAL_MAIN_SHA" == "$RELEASE_SHA" ]] || fail "release SHA is no longer the canonical repository main tip."

# The manifest hash authority is the committed Git blob. The materialized host file
# that Docker will copy must match those bytes exactly; line-ending normalization is forbidden.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
while IFS='|' read -r migration_name expected_hash; do
  relative="prisma/migrations/$migration_name/migration.sql"
  git cat-file blob "$RELEASE_SHA:$relative" > "$TMP_DIR/committed.sql"
  actual_hash="$(sha256sum "$TMP_DIR/committed.sql" | awk '{print $1}')"
  [[ "$actual_hash" == "$expected_hash" ]] || fail "committed Git blob differs from reviewed manifest: $migration_name."
  cmp -s "$TMP_DIR/committed.sql" "$ROOT_DIR/$relative" || fail "working migration file differs byte-for-byte from committed Git blob: $migration_name."
done <<'MIGRATIONS'
20261002100000_active_energy_canonical_resolution|45711a527d809775a5ce66d3d9e529954158dcb65ed0065f70a0f948a4693a0b
20261002150000_add_production_publication_generation|9f1e38182dc3ec2449da5297786b603d8c0370498ed68db97059f640220bbbd7
20261003120000_add_episode_aware_unified_experimental_physiology_v2|0bb495d988ead0c1729f8e657b85f85bc4c20673fdedd5b61a7644cb0dcaf9b6
20261005120000_episode_relative_muscle_core|afef76464e4e77e6fd13a6ed6f8b04a6972d98229e3c5fc12a7e7dd8e3fd6588
20261006110000_relative_muscle_legacy_identity|56d8a64d4c966428835a96058783d01c4eac5984f8ed51928d26b13d6290208e
20261006130000_unified_v4_glycogen_water_rollout|9e50a8f33ec93e5f7d74681a611bd7272038f7e5e25563054f4a4dbb093b5408
MIGRATIONS

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
db_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER")" \
  || fail "existing production PostgreSQL is unavailable; migration will not start it."
[[ "$db_status" == "healthy" ]] || fail "existing production PostgreSQL is not healthy; migration will not start it."

compose --profile tools build migrate
IMAGE_RESULT="$(compose --profile tools run --rm --no-deps --entrypoint node migrate /app/scripts/production-migration-image-check.mjs /app)"
printf '%s\n' "$IMAGE_RESULT"

# Refresh a read-only report only after canonical fetch and image byte verification.
bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" \
  < <(compose --profile tools run --rm --no-deps --entrypoint node migrate /app/scripts/production-db-preflight.mjs) \
  > "$CONTEXT_DIR/live-report.json"

# Re-evaluate the live full pending set and signed provenance immediately before DDL.
GUARD_RECEIPT="$CONTEXT_DIR/final-guard-receipt.json"
# Re-sample PostgreSQL sessions and host topology immediately before the DDL
# boundary. The signed preflight is verified, but never reused as the final drain.
bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" \
  < <(compose --profile tools run --rm --no-deps --entrypoint node migrate /app/scripts/production-db-preflight.mjs) \
  > "$CONTEXT_DIR/live-report-final.json"
bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert
[[ ! -e "$GUARD_RECEIPT" && ! -L "$GUARD_RECEIPT" ]] || fail "a final guard receipt already exists in the private context."
compose --profile tools run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  --volume "$CONTEXT_DIR:/run/bodycast:ro" \
  --entrypoint node migrate /app/scripts/production-migration-final-guard.mjs \
  --before-ddl \
  --envelope /run/bodycast/authorization-envelope.json \
  --preflight /run/bodycast/preflight-result.json \
  --evidence /run/bodycast/preflight-evidence.json \
  --restore /run/bodycast/restore-result.json \
  --artifact /run/bodycast/artifact-metadata.json \
  --live-report /run/bodycast/live-report-final.json \
  --main-sha "$CANONICAL_MAIN_SHA" \
  --release-sha "$RELEASE_SHA" \
  --manifest "$MANIFEST_ID" \
  --current-workflow-id "$BODYCAST_AUTHORIZATION_WORKFLOW_ID" \
  --current-workflow-run-id "$BODYCAST_AUTHORIZATION_RUN_ID" \
  --current-workflow-run-attempt "$BODYCAST_AUTHORIZATION_RUN_ATTEMPT" \
  --keys /app/scripts/production-migration-verification-keys.json \
  --repository /app \
  > "$GUARD_RECEIPT"
chmod 600 "$GUARD_RECEIPT"

# This durable marker is the irreversible boundary. From this point onward any
# error leaves traffic in maintenance and blocks both app deploy and rerunning DDL.
write_bodycast_release_marker "$RELEASE_SHA" ddl-started
compose --profile tools run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  --volume "$CONTEXT_DIR:/run/bodycast:ro" \
  --env "BODYCAST_RELEASE_SHA=$RELEASE_SHA" \
  --env "BODYCAST_CANONICAL_MAIN_SHA=$CANONICAL_MAIN_SHA" \
  --env "BODYCAST_AUTHORIZATION_WORKFLOW_ID=$BODYCAST_AUTHORIZATION_WORKFLOW_ID" \
  --env "BODYCAST_AUTHORIZATION_RUN_ID=$BODYCAST_AUTHORIZATION_RUN_ID" \
  --env "BODYCAST_AUTHORIZATION_RUN_ATTEMPT=$BODYCAST_AUTHORIZATION_RUN_ATTEMPT" \
  --env BODYCAST_FINAL_GUARD_RECEIPT=/run/bodycast/final-guard-receipt.json \
  --env BODYCAST_AUTHORIZATION_ENVELOPE=/run/bodycast/authorization-envelope.json \
  --env BODYCAST_VERIFICATION_KEYS=/app/scripts/production-migration-verification-keys.json \
  --entrypoint node migrate /app/scripts/run-prisma-migrate-with-lock-timeout.mjs

# The postflight is read-only and must match the rehearsed encrypted-backup restore.
bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" \
  < <(compose --profile tools run --rm --no-deps --entrypoint node migrate /app/scripts/production-db-preflight.mjs) \
  > "$CONTEXT_DIR/live-report-postflight.json"
compose --profile tools run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  --volume "$CONTEXT_DIR:/run/bodycast:ro" \
  --entrypoint node migrate /app/scripts/production-migration-final-guard.mjs \
  --after-ddl \
  --report /run/bodycast/live-report-postflight.json \
  --restore /run/bodycast/restore-result.json \
  --manifest "$MANIFEST_ID" \
  --repository /app \
  > "$CONTEXT_DIR/postflight-result.json"
write_bodycast_release_marker "$RELEASE_SHA" schema-applied
echo "Reviewed migrations completed and read-only postflight passed; production remains in maintenance until exact-SHA non-serving deploy and V3/V4 gates pass."
