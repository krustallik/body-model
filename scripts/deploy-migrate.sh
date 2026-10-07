#!/usr/bin/env bash
# Protected final migration guard. Confirmation strings alone never authorize DDL.
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

# Once host recovery preparation is installed, all production migration work is
# performed by the fixed typed host service. The service resolves this opaque run
# context from its private store and independently verifies every signed proof.
# This path never passes a shell command, filesystem path, or Docker argument.
HOST_OPERATION_CLIENT="/usr/local/bin/bodycast-production-operation"
[[ -x "$HOST_OPERATION_CLIENT" ]] || fail "the recovery-aware host authority is unavailable; production migration is fail-closed."
authorization_context_id="migration-${BODYCAST_AUTHORIZATION_WORKFLOW_ID}-${BODYCAST_AUTHORIZATION_RUN_ID}-${BODYCAST_AUTHORIZATION_RUN_ATTEMPT}"
exec "$HOST_OPERATION_CLIENT" forward-migration \
  --request-id "${authorization_context_id}-request" \
  --release-sha "$RELEASE_SHA" \
  --canonical-main-sha "$RELEASE_SHA" \
  --migration-manifest-id "$MANIFEST_ID" \
  --authorization-context-id "$authorization_context_id"

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

GIT_DIR="$(git rev-parse --absolute-git-dir)"
command -v flock >/dev/null 2>&1 || fail "flock is unavailable; migration serialization cannot be guaranteed."
exec 9>"$GIT_DIR/bodycast-production-migration.lock"
flock -n 9 || fail "another production migration process holds the repository lock."

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
compose up -d db
for attempt in $(seq 1 30); do
  db_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER")"
  [[ "$db_status" == "healthy" ]] && break
  [[ "$attempt" != "30" ]] || fail "production PostgreSQL did not become healthy."
  sleep 5
done

compose --profile tools build migrate
IMAGE_RESULT="$(compose --profile tools run --rm --no-deps --entrypoint node migrate /app/scripts/production-migration-image-check.mjs /app)"
printf '%s\n' "$IMAGE_RESULT"

# Refresh a read-only report only after canonical fetch and image byte verification.
bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" \
  < <(compose --profile tools run --rm --no-deps --entrypoint node migrate /app/scripts/production-db-preflight.mjs) \
  > "$CONTEXT_DIR/live-report.json"

# Re-evaluate the live full pending set and signed provenance immediately before DDL.
CHALLENGE_GUARD_RECEIPT="$CONTEXT_DIR/challenge-guard-receipt.json"
GUARD_RECEIPT="$CONTEXT_DIR/final-guard-receipt.json"
[[ ! -e "$CHALLENGE_GUARD_RECEIPT" && ! -L "$CHALLENGE_GUARD_RECEIPT" \
  && ! -e "$GUARD_RECEIPT" && ! -L "$GUARD_RECEIPT" ]] || fail "a guard receipt already exists in the private context."
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
  --live-report /run/bodycast/live-report.json \
  --main-sha "$CANONICAL_MAIN_SHA" \
  --release-sha "$RELEASE_SHA" \
  --manifest "$MANIFEST_ID" \
  --current-workflow-id "$BODYCAST_AUTHORIZATION_WORKFLOW_ID" \
  --current-workflow-run-id "$BODYCAST_AUTHORIZATION_RUN_ID" \
  --current-workflow-run-attempt "$BODYCAST_AUTHORIZATION_RUN_ATTEMPT" \
  --keys /app/scripts/production-migration-verification-keys.json \
  --repository /app \
  > "$CHALLENGE_GUARD_RECEIPT"
chmod 600 "$CHALLENGE_GUARD_RECEIPT"

# The one-time challenge is created only after the live production guard. The
# current GitHub runner reselects the latest admitted preflight and requests a
# short-lived OIDC JWT for this exact audience; the host accepts no caller-made proof.
[[ "${BODYCAST_EXECUTION_PROOF_HANDOFF:-}" == "true" ]] || fail "protected DDL requires a live GitHub OIDC proof handoff."
[[ ! -e "$CONTEXT_DIR/execution-proof.jwt" && ! -L "$CONTEXT_DIR/execution-proof.jwt" ]] || fail "OIDC proof must be created after the live guard."
DDL_CHALLENGE="$(head -c 32 /dev/urandom | od -An -vtx1 | tr -d ' \n')"
[[ "$DDL_CHALLENGE" =~ ^[a-f0-9]{64}$ ]] || fail "could not create a one-time DDL challenge."
printf 'BODYCAST_DDL_CHALLENGE:%s\n' "$DDL_CHALLENGE"
IFS= read -r EXECUTION_PROOF || fail "workflow runner did not return a current GitHub OIDC proof."
[[ -n "$EXECUTION_PROOF" && ${#EXECUTION_PROOF} -le 32768 ]] || fail "GitHub OIDC proof is empty or oversized."
printf '%s\n' "$EXECUTION_PROOF" > "$CONTEXT_DIR/execution-proof.jwt"
chmod 600 "$CONTEXT_DIR/execution-proof.jwt"
export BODYCAST_DDL_EXECUTION_CHALLENGE="$DDL_CHALLENGE"

# Re-sample PostgreSQL sessions and host topology after the OIDC round trip. The
# signed preflight is still verified, but never reused as the final drain result.
bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" \
  < <(compose --profile tools run --rm --no-deps --entrypoint node migrate /app/scripts/production-db-preflight.mjs) \
  > "$CONTEXT_DIR/live-report-final.json"
bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert
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
# Irreversible recovery boundary: this marker is written before the Prisma
# container is spawned. From here on, assume schema state may have changed even
# if spawning Prisma or its first PostgreSQL statement fails. No exit path clears it.
write_bodycast_release_marker "$RELEASE_SHA" ddl-started

# Keep a host-persistent one-use nonce ledger. The container receives only this
# directory and public verification material; no private signing key crosses the SSH boundary.
ATTESTATION_NONCE_DIR="$GIT_DIR/bodycast-production-migration-attestation-nonces"
if [[ -e "$ATTESTATION_NONCE_DIR" || -L "$ATTESTATION_NONCE_DIR" ]]; then
  [[ -d "$ATTESTATION_NONCE_DIR" && ! -L "$ATTESTATION_NONCE_DIR" ]] || fail "challenge-bound execution proof replay ledger is not a regular directory."
else
  mkdir -m 700 "$ATTESTATION_NONCE_DIR"
fi
chmod 700 "$ATTESTATION_NONCE_DIR"

# The command process checks backup freshness at the actual Prisma DDL start and
# independently verifies the signed guard receipt and adds lock_timeout to Prisma's
# PostgreSQL startup options. No retries or boolean authorization switches exist.
compose --profile tools run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  --volume "$CONTEXT_DIR:/run/bodycast:ro" \
  --volume "$ATTESTATION_NONCE_DIR:/run/bodycast-attestation-nonces:rw" \
  -e BODYCAST_FINAL_GUARD_RECEIPT=/run/bodycast/final-guard-receipt.json \
  -e BODYCAST_AUTHORIZATION_ENVELOPE=/run/bodycast/authorization-envelope.json \
  -e BODYCAST_EXECUTION_PROOF=/run/bodycast/execution-proof.jwt \
  -e "BODYCAST_DDL_EXECUTION_CHALLENGE=$BODYCAST_DDL_EXECUTION_CHALLENGE" \
  -e BODYCAST_DDL_ATTESTATION_NONCE_DIR=/run/bodycast-attestation-nonces \
  -e BODYCAST_VERIFICATION_KEYS=/app/scripts/production-migration-verification-keys.json \
  -e "BODYCAST_RELEASE_SHA=$RELEASE_SHA" \
  -e "BODYCAST_CANONICAL_MAIN_SHA=$CANONICAL_MAIN_SHA" \
  -e "BODYCAST_AUTHORIZATION_WORKFLOW_ID=$BODYCAST_AUTHORIZATION_WORKFLOW_ID" \
  -e "BODYCAST_AUTHORIZATION_RUN_ID=$BODYCAST_AUTHORIZATION_RUN_ID" \
  -e "BODYCAST_AUTHORIZATION_RUN_ATTEMPT=$BODYCAST_AUTHORIZATION_RUN_ATTEMPT" \
  migrate

# Verify full migration history and compare exact PostgreSQL object signatures with
# the disposable, restored-and-migrated schema signed in the authorization envelope.
bash "$ROOT_DIR/scripts/production-db-target.sh" --preflight "$DB_CONTAINER" \
  < <(compose --profile tools run --rm --no-deps --entrypoint node migrate /app/scripts/production-db-preflight.mjs) \
  > "$CONTEXT_DIR/postflight-report.json"
compose --profile tools run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  --volume "$CONTEXT_DIR:/run/bodycast:ro" \
  --entrypoint node migrate /app/scripts/production-migration-final-guard.mjs \
  --after-ddl --report /run/bodycast/postflight-report.json --restore /run/bodycast/restore-result.json \
  --manifest "$MANIFEST_ID" --repository /app

write_bodycast_release_marker "$RELEASE_SHA" schema-applied

echo "Authorized production Prisma migrations completed and postflight schema/history matched the disposable rehearsal. No replay, activation, or application cutover ran."
