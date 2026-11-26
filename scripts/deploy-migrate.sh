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
SOURCE_MARKER_DIGEST=""
if [[ "$marker_status" -eq 0 ]]; then
  if [[ "$MANIFEST_ID" == "training-session-context-v1" \
    && "$BODYCAST_MARKER_SCHEMA_VERSION" == "3" \
    && "$BODYCAST_MARKER_MANIFEST_ID" == "auth-multiuser-v1" \
    && "$BODYCAST_MARKER_STATE" == "app-ready" ]]; then
    node --input-type=module - "$CONTEXT_DIR/preflight-result.json" "$BODYCAST_MARKER_FILE_PATH" "$ROOT_DIR" <<'NODE' \
      || fail "the Auth predecessor marker is not the exact signed Training preflight source."
import { readFileSync } from "node:fs";
import { validateAuthMarkerForTrainingMigrationHandoff } from "./scripts/production-schema-deploy-handoff.mjs";
const [preflightPath, markerPath, repositoryPath] = process.argv.slice(2);
const preflight = JSON.parse(readFileSync(preflightPath, "utf8"));
const witness = preflight.sourceReleaseMarker;
if (!witness || preflight.manifestId !== "training-session-context-v1") throw new Error("Training preflight marker witness is missing.");
const current = validateAuthMarkerForTrainingMigrationHandoff(readFileSync(markerPath, "utf8"), {
  liveAppSha: witness.liveAppSha, repositoryPath,
});
const currentWitness = { ...current, liveAppSha: witness.liveAppSha };
if (JSON.stringify(currentWitness) !== JSON.stringify(witness)) throw new Error("Current Auth marker differs from the signed preflight witness.");
NODE
    SOURCE_MARKER_DIGEST="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sourceReleaseMarker.digest' "$CONTEXT_DIR/preflight-result.json")"
    [[ "$SOURCE_MARKER_DIGEST" == "$(sha256sum "$BODYCAST_MARKER_FILE_PATH" | awk '{print $1}')" ]] \
      || fail "the Auth predecessor marker digest differs from the signed preflight source."
  else
    fail "an existing production marker is not the verified Auth app-ready predecessor for this Training migration."
  fi
elif [[ "$marker_status" -ne 1 ]]; then
  fail "production release marker state is unknown; migration is blocked."
fi

# Fetch canonical main into a dedicated ref without changing the mutable origin remote.
GIT_TERMINAL_PROMPT=0 git -c "remote.bodycast-canonical.url=$CANONICAL_URL" \
  fetch --no-tags --prune bodycast-canonical +refs/heads/main:refs/remotes/bodycast-canonical/main
CANONICAL_MAIN_SHA="$(git rev-parse --verify 'refs/remotes/bodycast-canonical/main^{commit}')"
[[ "$CANONICAL_MAIN_SHA" == "$RELEASE_SHA" ]] || fail "release SHA is no longer the canonical repository main tip."

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
db_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER")" \
  || fail "existing production PostgreSQL is unavailable; migration will not start it."
[[ "$db_status" == "healthy" ]] || fail "existing production PostgreSQL is not healthy; migration will not start it."

compose --profile tools build migrate

# Refresh the read-only report immediately before the final freshness-bound writer drain.
BODYCAST_DB_PREFLIGHT_MANIFEST="$MANIFEST_ID" \
  bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" \
  > "$CONTEXT_DIR/live-report.json"

# Complete slow read-only checks before taking the final freshness-bound writer
# drain; otherwise these fingerprints can age out its 30-second evidence window.
GUARD_RECEIPT="$CONTEXT_DIR/final-guard-receipt.json"
if [[ "$MANIFEST_ID" == "training-mutation-ledger-refresh-queue-v1" ]]; then
  compose --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-traffic-check.mjs --profile-id 1 --pre-training-migration \
    || fail "Unified V4 must already be current before Training DDL; no Training replay is authorized by this manifest."
fi
AUTH_SOURCE_DATA_FINGERPRINT=""
AUTH_SOURCE_GUARD_ARGS=()
if [[ "$MANIFEST_ID" == "auth-multiuser-v1" ]]; then
  AUTH_SOURCE_DATA_FINGERPRINT="$(bash "$ROOT_DIR/scripts/production-db-data-fingerprint.sh" \
    --production-container "$DB_CONTAINER" --auth-multiuser-source-inputs)" \
    || fail "Could not capture the pre-DDL Auth source-input fingerprint."
  [[ "$AUTH_SOURCE_DATA_FINGERPRINT" =~ ^[a-f0-9]{64}$ ]] \
    || fail "Pre-DDL Auth source-input fingerprint is malformed."
  AUTH_SOURCE_GUARD_ARGS=(--env "BODYCAST_AUTH_SOURCE_DATA_FINGERPRINT=$AUTH_SOURCE_DATA_FINGERPRINT")
fi
# This host-only topology assertion and final DB report remain fail-closed.
# The DB report fingerprints all logical rows first, then samples PostgreSQL
# writers and Docker/Caddy topology for immediate final-guard consumption.
bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert
BODYCAST_DB_PREFLIGHT_MANIFEST="$MANIFEST_ID" \
  bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" \
  > "$CONTEXT_DIR/live-report-final.json"
[[ ! -e "$GUARD_RECEIPT" && ! -L "$GUARD_RECEIPT" ]] || fail "a final guard receipt already exists in the private context."
compose --profile tools run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  --volume "$CONTEXT_DIR:/run/bodycast:ro" \
  "${AUTH_SOURCE_GUARD_ARGS[@]}" \
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

# Reconfirm the exact canonical main tip after all read-only DB, drain, restore,
# and authorization gates, immediately before any durable DDL-marker transition.
GIT_TERMINAL_PROMPT=0 git -c "remote.bodycast-canonical.url=$CANONICAL_URL" \
  fetch --no-tags bodycast-canonical +refs/heads/main:refs/remotes/bodycast-canonical/main
CANONICAL_MAIN_SHA="$(git rev-parse --verify 'refs/remotes/bodycast-canonical/main^{commit}')"
[[ "$CANONICAL_MAIN_SHA" == "$RELEASE_SHA" ]] || fail "canonical main moved after the final DB identity/writer-drain guard."

# The wrapper makes the last PostgreSQL identity/writer-drain observation, then
# durably publishes ddl-starting before it attempts to create Prisma. The
# validated Auth predecessor may be atomically replaced by the wrapper.
bodycast_prepare_release_marker_directory
compose --profile tools run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  --volume "$CONTEXT_DIR:/run/bodycast:ro" \
  --volume "$BODYCAST_RELEASE_MARKER_DIRECTORY:/run/bodycast-release-marker:rw" \
  --env "BODYCAST_RELEASE_SHA=$RELEASE_SHA" \
  --env "BODYCAST_CANONICAL_MAIN_SHA=$CANONICAL_MAIN_SHA" \
  --env "BODYCAST_AUTHORIZATION_WORKFLOW_ID=$BODYCAST_AUTHORIZATION_WORKFLOW_ID" \
  --env "BODYCAST_AUTHORIZATION_RUN_ID=$BODYCAST_AUTHORIZATION_RUN_ID" \
  --env "BODYCAST_AUTHORIZATION_RUN_ATTEMPT=$BODYCAST_AUTHORIZATION_RUN_ATTEMPT" \
  --env BODYCAST_RELEASE_MARKER_DIRECTORY=/run/bodycast-release-marker \
  --env BODYCAST_FINAL_GUARD_RECEIPT=/run/bodycast/final-guard-receipt.json \
  --env BODYCAST_AUTHORIZATION_ENVELOPE=/run/bodycast/authorization-envelope.json \
  --env BODYCAST_VERIFICATION_KEYS=/app/scripts/production-migration-verification-keys.json \
  --entrypoint node migrate /app/scripts/run-prisma-migrate-with-lock-timeout.mjs

read_bodycast_release_marker || fail "the guarded Prisma handoff did not leave a valid durable marker."
[[ "$BODYCAST_MARKER_RELEASE_SHA" == "$RELEASE_SHA" && "$BODYCAST_MARKER_STATE" == "ddl-started" \
  && "$BODYCAST_MARKER_SPAWN_STATE" == "started" ]] || fail "Prisma returned without an acknowledged durable spawn marker; maintenance remains active."

# The postflight is read-only and must match the rehearsed encrypted-backup restore.
BODYCAST_DB_PREFLIGHT_MANIFEST="$MANIFEST_ID" \
  bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" \
  > "$CONTEXT_DIR/live-report-postflight.json"
AUTH_SOURCE_GUARD_ARGS=()
if [[ "$MANIFEST_ID" == "auth-multiuser-v1" ]]; then
  AUTH_SOURCE_DATA_FINGERPRINT="$(bash "$ROOT_DIR/scripts/production-db-data-fingerprint.sh" \
    --production-container "$DB_CONTAINER" --auth-multiuser-source-inputs)" \
    || fail "Could not capture the post-DDL Auth source-input fingerprint."
  [[ "$AUTH_SOURCE_DATA_FINGERPRINT" =~ ^[a-f0-9]{64}$ ]] \
    || fail "Post-DDL Auth source-input fingerprint is malformed."
  AUTH_SOURCE_GUARD_ARGS=(--env "BODYCAST_AUTH_SOURCE_DATA_FINGERPRINT=$AUTH_SOURCE_DATA_FINGERPRINT")
fi
compose --profile tools run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  --volume "$CONTEXT_DIR:/run/bodycast:ro" \
  "${AUTH_SOURCE_GUARD_ARGS[@]}" \
  --entrypoint node migrate /app/scripts/production-migration-final-guard.mjs \
  --after-ddl \
  --report /run/bodycast/live-report-postflight.json \
  --restore /run/bodycast/restore-result.json \
  --preflight /run/bodycast/preflight-result.json \
  --manifest "$MANIFEST_ID" \
  --repository /app \
  > "$CONTEXT_DIR/postflight-result.json"
if [[ "$MANIFEST_ID" == "auth-multiuser-v1" ]]; then
  echo "Post-DDL Auth source-input projection matches the isolated migration rehearsal."
fi
write_bodycast_release_marker "$RELEASE_SHA" schema-applied
echo "Reviewed migrations completed and read-only postflight passed; production remains in maintenance until exact-SHA non-serving deploy and V3/V4 gates pass."
