#!/usr/bin/env bash
# Read-only binding from a completed no-app V4 recovery to an exact app release.

bodycast_assert_completed_v4_recovery_for_release() {
  local release_sha="${1:-${DEPLOY_SHA:-}}" recovery_sha marker marker_digest migration_tree schema_blob
  local schema_digest schema_contract schema_helper_sha source_fingerprint database_id database_image ledger_json
  local migration_count ledger_digest
  [[ "$release_sha" =~ ^[a-f0-9]{40}$ ]] || { echo "Recovered-V4 release requires an exact SHA." >&2; return 1; }
  recovery_sha="$(node --input-type=module -e 'import { LEGACY_V4_RECOVERY } from "./scripts/production-v4-derived-recovery.mjs"; process.stdout.write(LEGACY_V4_RECOVERY.sourceSha)')" || return 1
  [[ "$recovery_sha" =~ ^[a-f0-9]{40}$ ]] || { echo "Pinned V4 recovery source is malformed." >&2; return 1; }
  marker="/var/lib/bodycast/recovery/unified-v4-derived-${recovery_sha}.json"
  [[ -f "$marker" && ! -L "$marker" && "$(stat -c '%a:%u' "$marker")" == "600:0" ]] || {
    echo "An exact root-only completed V4 recovery marker is required." >&2; return 1;
  }

  migration_tree="$(git rev-parse --verify "$release_sha:prisma/migrations")" || return 1
  schema_blob="$(git rev-parse --verify "$release_sha:prisma/schema.prisma")" || return 1
  ledger_json="$(docker compose -f "$COMPOSE_FILE" --profile tools run --rm --no-deps \
    --env "BODYCAST_RELEASE_SHA=$release_sha" --entrypoint node migrate \
    /app/scripts/production-empty-install-ledger.mjs --production-schema-postflight)" || {
      echo "The current PostgreSQL migration ledger failed its read-only 74-schema verification." >&2; return 1;
    }
  migration_count="$(printf '%s' "$ledger_json" | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; const r=JSON.parse(s); process.stdout.write(String(r.migrationCount))')" || return 1
  [[ "$migration_count" == "74" ]] || { echo "Recovered serving requires exactly 74 successful migrations." >&2; return 1; }
  ledger_digest="$(printf '%s' "$ledger_json" | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; const r=JSON.parse(s); process.stdout.write(r.migrationTreeDigest)')" || return 1
  [[ "$ledger_digest" =~ ^[a-f0-9]{64}$ ]] || { echo "Current migration ledger digest is malformed." >&2; return 1; }

  schema_digest="$(docker exec "$DB_CONTAINER" sh -c 'pg_dump --schema-only --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
    | node "$ROOT_DIR/scripts/production-v4-schema-digest.mjs")" || return 1
  schema_contract="$(node "$ROOT_DIR/scripts/production-v4-schema-digest.mjs" --contract)" || return 1
  schema_helper_sha="$(sha256sum "$ROOT_DIR/scripts/production-v4-schema-digest.mjs" | awk '{print $1}')" || return 1
  source_fingerprint="$(bash "$ROOT_DIR/scripts/production-db-data-fingerprint.sh" \
    --production-container "$DB_CONTAINER" --v4-replay-inputs)" || return 1
  database_id="$(docker inspect --format '{{.Id}}' "$DB_CONTAINER")" || return 1
  database_image="$(docker inspect --format '{{.Image}}' "$DB_CONTAINER")" || return 1
  marker_digest="$(sha256sum "$marker" | awk '{print $1}')" || return 1

  BODYCAST_RECOVERY_MARKER_PATH="$marker" BODYCAST_RECOVERY_MARKER_DIGEST="$marker_digest" \
    BODYCAST_RECOVERY_RELEASE_SHA="$release_sha" BODYCAST_RECOVERY_MIGRATION_TREE="$migration_tree" \
    BODYCAST_RECOVERY_SCHEMA_BLOB="$schema_blob" BODYCAST_RECOVERY_LEDGER_DIGEST="$ledger_digest" \
    BODYCAST_RECOVERY_SCHEMA_SHA256="$schema_digest" BODYCAST_RECOVERY_SOURCE_FINGERPRINT="$source_fingerprint" \
    BODYCAST_RECOVERY_SCHEMA_CONTRACT="$schema_contract" BODYCAST_RECOVERY_SCHEMA_HELPER_SHA256="$schema_helper_sha" \
    BODYCAST_RECOVERY_DATABASE_CONTAINER_ID="$database_id" BODYCAST_RECOVERY_DATABASE_IMAGE_ID="$database_image" \
    node --input-type=module <<'NODE'
import { readFileSync, statSync } from "node:fs";
import { assertCompletedV4RecoveryForServe, sha256 } from "./scripts/production-v4-derived-recovery.mjs";
const markerPath = process.env.BODYCAST_RECOVERY_MARKER_PATH;
const stat = statSync(markerPath);
if (stat.uid !== 0 || (stat.mode & 0o777) !== 0o600) throw new Error("V4 recovery marker ownership or mode is invalid.");
const markerBytes = readFileSync(markerPath);
if (sha256(markerBytes) !== process.env.BODYCAST_RECOVERY_MARKER_DIGEST) throw new Error("V4 recovery marker changed during verification.");
const marker = JSON.parse(markerBytes.toString("utf8"));
assertCompletedV4RecoveryForServe({ marker, releaseSha: process.env.BODYCAST_RECOVERY_RELEASE_SHA,
  migrationTree: process.env.BODYCAST_RECOVERY_MIGRATION_TREE, prismaSchemaBlob: process.env.BODYCAST_RECOVERY_SCHEMA_BLOB,
  ledgerDigest: process.env.BODYCAST_RECOVERY_LEDGER_DIGEST, schemaSha256: process.env.BODYCAST_RECOVERY_SCHEMA_SHA256,
  sourceFingerprint: process.env.BODYCAST_RECOVERY_SOURCE_FINGERPRINT,
  databaseContainerId: process.env.BODYCAST_RECOVERY_DATABASE_CONTAINER_ID,
  databaseImageId: process.env.BODYCAST_RECOVERY_DATABASE_IMAGE_ID,
  schemaDigestContract: process.env.BODYCAST_RECOVERY_SCHEMA_CONTRACT,
  schemaDigestHelperSha256: process.env.BODYCAST_RECOVERY_SCHEMA_HELPER_SHA256 });
NODE
  docker compose -f "$COMPOSE_FILE" --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-traffic-check.mjs --profile-id 1 || {
      echo "Unified V4 is no longer CURRENT for the recovered production profile." >&2; return 1;
    }
  printf 'BODYCAST_RECOVERED_V4_RELEASE_OK release_sha=%s migration_count=74\n' "$release_sha"
}
