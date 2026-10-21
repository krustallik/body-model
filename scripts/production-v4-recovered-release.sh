#!/usr/bin/env bash
# Read-only binding from a completed no-app V4 recovery to an exact app release.

bodycast_recovery_raw_fingerprint_from_marker_image() (
  set -Eeuo pipefail
  umask 077
  local marker_path="$1" recovery_sha="$2" metadata owner_run_id image_id archive_sha archive_dir archive
  local loaded_id db_config database_url networks network tmp_dir fingerprint
  metadata="$(node --input-type=module - "$marker_path" <<'NODE'
import { readFileSync } from "node:fs";
const marker = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!/^[1-9][0-9]*$/.test(String(marker.ownerRunId ?? ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(marker.imageId ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(marker.archiveSha ?? ""))
    || !/^[a-f0-9]{40}$/.test(String(marker.workflowSha ?? ""))) {
  throw new Error("The completed recovery marker has no valid bound image artifact identity.");
}
process.stdout.write([marker.ownerRunId, marker.imageId, marker.archiveSha, marker.workflowSha].join("\n"));
NODE
  )" || return 1
  mapfile -t metadata_fields <<< "$metadata"
  [[ "${#metadata_fields[@]}" -eq 4 ]] || return 1
  owner_run_id="${metadata_fields[0]}"
  image_id="${metadata_fields[1]}"
  archive_sha="${metadata_fields[2]}"
  archive_dir="/var/lib/bodycast/recovery/artifacts/$recovery_sha/$owner_run_id"
  archive="$archive_dir/image.tar"
  [[ -d "$archive_dir" && ! -L "$archive_dir" && "$(realpath -e "$archive_dir" 2>/dev/null || true)" == "$archive_dir" \
    && "$(stat -c '%u' "$archive_dir")" == "0" && -f "$archive" && ! -L "$archive" \
    && "$(realpath -e "$archive" 2>/dev/null || true)" == "$archive" && "$(stat -c '%u' "$archive")" == "0" ]] || return 1
  [[ "$(sha256sum "$archive" | awk '{print $1}')" == "$archive_sha" ]] || return 1

  loaded_id="$(docker image inspect --format '{{.Id}}' "$image_id" 2>/dev/null || true)"
  if [[ "$loaded_id" != "$image_id" ]]; then
    tmp_dir="$(mktemp -d /var/tmp/bodycast-v4-serve-evidence.XXXXXX)" || return 1
    chmod 0700 "$tmp_dir"
    if ! docker load --input "$archive" > "$tmp_dir/image-load.log" 2>&1; then
      rm -f -- "$tmp_dir/image-load.log"
      rmdir "$tmp_dir" 2>/dev/null || true
      return 1
    fi
    loaded_id="$(docker image inspect --format '{{.Id}}' "$image_id" 2>/dev/null || true)"
    rm -f -- "$tmp_dir/image-load.log"
    rmdir "$tmp_dir" || return 1
  fi
  [[ "$loaded_id" == "$image_id" ]] || return 1

  db_config="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$DB_CONTAINER")" || return 1
  database_url="$(BODYCAST_DB_CONFIG="$db_config" node --input-type=module <<'NODE'
const config = new Map(process.env.BODYCAST_DB_CONFIG.split(/\r?\n/).filter(Boolean).map((line) => {
  const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)];
}));
const database = config.get("POSTGRES_DB");
const username = config.get("POSTGRES_USER");
const password = config.get("POSTGRES_PASSWORD");
if (![database, username, password].every((value) => typeof value === "string" && value.length > 0)) {
  throw new Error("PostgreSQL runtime identity is incomplete.");
}
const url = new URL("postgresql://localhost");
url.username = username; url.password = password; url.hostname = "bodycast-db-prod"; url.port = "5432";
url.pathname = `/${database}`; url.searchParams.set("schema", "public");
process.stdout.write(url.toString());
NODE
  )" || return 1
  unset db_config
  networks="$(docker inspect --format '{{json .NetworkSettings.Networks}}' "$DB_CONTAINER")" || return 1
  network="$(BODYCAST_DB_NETWORKS="$networks" node --input-type=module <<'NODE'
const networks = JSON.parse(process.env.BODYCAST_DB_NETWORKS);
const name = "bodycast-backend-prod";
const network = networks[name];
if (!network?.IPAddress || !network.Aliases?.includes("bodycast-db-prod")) {
  throw new Error("The production database is not on its expected private network.");
}
process.stdout.write(name);
NODE
  )" || return 1

  tmp_dir="$(mktemp -d /var/tmp/bodycast-v4-serve-evidence.XXXXXX)" || return 1
  chmod 0700 "$tmp_dir"
  trap 'rm -f -- "$tmp_dir/database.env" "$tmp_dir/report.json" "$tmp_dir/container.stderr"; rmdir "$tmp_dir" 2>/dev/null || true' EXIT
  printf 'DATABASE_URL=%s\n' "$database_url" > "$tmp_dir/database.env"
  chmod 0600 "$tmp_dir/database.env"
  unset database_url
  if ! docker run --rm --network "$network" --read-only --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
    --cap-drop=ALL --security-opt=no-new-privileges --env-file "$tmp_dir/database.env" "$image_id" \
    node /app/dist/production-v4-recovery-evidence.mjs > "$tmp_dir/report.json" 2> "$tmp_dir/container.stderr"; then
    return 1
  fi
  chmod 0600 "$tmp_dir/report.json" "$tmp_dir/container.stderr"
  fingerprint="$(node --input-type=module - "$tmp_dir/report.json" <<'NODE'
import { readFileSync } from "node:fs";
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!/^[a-f0-9]{64}$/.test(String(report.sourceFingerprint ?? ""))) {
  throw new Error("The marker-bound recovery image returned malformed source evidence.");
}
process.stdout.write(report.sourceFingerprint);
NODE
  )" || return 1
  printf '%s' "$fingerprint"
)

bodycast_assert_completed_v4_recovery_for_release() {
  local release_sha="${1:-${DEPLOY_SHA:-}}" recovery_sha marker marker_digest migration_tree schema_blob
  local schema_digest schema_contract schema_helper_sha source_fingerprint database_id database_image ledger_json
  local migration_count ledger_digest marker_workflow_sha runtime_compatibility_proof="" changed_paths_json
  [[ "$release_sha" =~ ^[a-f0-9]{40}$ ]] || { echo "Recovered-V4 release requires an exact SHA." >&2; return 1; }
  recovery_sha="$(node --input-type=module -e 'import { LEGACY_V4_RECOVERY } from "./scripts/production-v4-derived-recovery.mjs"; process.stdout.write(LEGACY_V4_RECOVERY.sourceSha)')" || return 1
  [[ "$recovery_sha" =~ ^[a-f0-9]{40}$ ]] || { echo "Pinned V4 recovery source is malformed." >&2; return 1; }
  marker="/var/lib/bodycast/recovery/unified-v4-derived-${recovery_sha}.json"
  [[ -f "$marker" && ! -L "$marker" && "$(stat -c '%a:%u' "$marker")" == "600:0" ]] || {
    echo "An exact root-only completed V4 recovery marker is required." >&2; return 1;
  }

  marker_workflow_sha="$(node --input-type=module - "$marker" <<'NODE'
import { readFileSync } from "node:fs";
const marker = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!/^[a-f0-9]{40}$/.test(String(marker.workflowSha ?? ""))) throw new Error("The recovery workflow SHA is malformed.");
process.stdout.write(marker.workflowSha);
NODE
  )" || return 1
  if [[ "$marker_workflow_sha" != "$release_sha" ]]; then
    [[ "$(git -C "$ROOT_DIR" rev-parse "$release_sha^" 2>/dev/null || true)" == "$marker_workflow_sha" \
      && "$(git -C "$ROOT_DIR" rev-list --count "$marker_workflow_sha..$release_sha" 2>/dev/null || true)" == "1" ]] || {
      echo "Recovered-V4 serving compatibility permits only one direct tooling-only commit after the exact recovery workflow SHA." >&2; return 1;
    }
    changed_paths_json="$(git -C "$ROOT_DIR" diff --no-renames --name-only "$marker_workflow_sha" "$release_sha" \
      | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; process.stdout.write(JSON.stringify(s.split(/\r?\n/).filter(Boolean)))')" || return 1
    runtime_compatibility_proof="$(BODYCAST_RECOVERY_WORKFLOW_SHA="$marker_workflow_sha" BODYCAST_RELEASE_SHA="$release_sha" \
      BODYCAST_CHANGED_PATHS_JSON="$changed_paths_json" node --input-type=module <<'NODE'
const changedPaths = JSON.parse(process.env.BODYCAST_CHANGED_PATHS_JSON);
if (!Array.isArray(changedPaths)) throw new Error("Release compatibility paths are malformed.");
process.stdout.write(JSON.stringify({ recoveryWorkflowSha: process.env.BODYCAST_RECOVERY_WORKFLOW_SHA,
  releaseSha: process.env.BODYCAST_RELEASE_SHA, directChildVerified: true, changedPaths }));
NODE
    )" || return 1
  fi

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
  source_fingerprint="$(bodycast_recovery_raw_fingerprint_from_marker_image "$marker" "$recovery_sha")" || {
    echo "Could not recompute raw-source evidence with the exact recovery image bound by the completed marker." >&2; return 1;
  }
  database_id="$(docker inspect --format '{{.Id}}' "$DB_CONTAINER")" || return 1
  database_image="$(docker inspect --format '{{.Image}}' "$DB_CONTAINER")" || return 1
  marker_digest="$(sha256sum "$marker" | awk '{print $1}')" || return 1

  BODYCAST_RECOVERY_MARKER_PATH="$marker" BODYCAST_RECOVERY_MARKER_DIGEST="$marker_digest" \
    BODYCAST_RECOVERY_RELEASE_SHA="$release_sha" BODYCAST_RECOVERY_MIGRATION_TREE="$migration_tree" \
    BODYCAST_RECOVERY_SCHEMA_BLOB="$schema_blob" BODYCAST_RECOVERY_LEDGER_DIGEST="$ledger_digest" \
    BODYCAST_RECOVERY_SCHEMA_SHA256="$schema_digest" BODYCAST_RECOVERY_SOURCE_FINGERPRINT="$source_fingerprint" \
    BODYCAST_RECOVERY_SCHEMA_CONTRACT="$schema_contract" BODYCAST_RECOVERY_SCHEMA_HELPER_SHA256="$schema_helper_sha" \
    BODYCAST_RECOVERY_DATABASE_CONTAINER_ID="$database_id" BODYCAST_RECOVERY_DATABASE_IMAGE_ID="$database_image" \
  BODYCAST_RECOVERY_RUNTIME_COMPATIBILITY_PROOF="$runtime_compatibility_proof" \
    node --input-type=module <<'NODE'
import { readFileSync, statSync } from "node:fs";
import { assertCompletedV4RecoveryForServe, sha256 } from "./scripts/production-v4-derived-recovery.mjs";
const markerPath = process.env.BODYCAST_RECOVERY_MARKER_PATH;
const stat = statSync(markerPath);
if (stat.uid !== 0 || (stat.mode & 0o777) !== 0o600) throw new Error("V4 recovery marker ownership or mode is invalid.");
const markerBytes = readFileSync(markerPath);
if (sha256(markerBytes) !== process.env.BODYCAST_RECOVERY_MARKER_DIGEST) throw new Error("V4 recovery marker changed during verification.");
const marker = JSON.parse(markerBytes.toString("utf8"));
const runtimeCompatibilityProof = process.env.BODYCAST_RECOVERY_RUNTIME_COMPATIBILITY_PROOF
  ? JSON.parse(process.env.BODYCAST_RECOVERY_RUNTIME_COMPATIBILITY_PROOF) : undefined;
assertCompletedV4RecoveryForServe({ marker, releaseSha: process.env.BODYCAST_RECOVERY_RELEASE_SHA,
  migrationTree: process.env.BODYCAST_RECOVERY_MIGRATION_TREE, prismaSchemaBlob: process.env.BODYCAST_RECOVERY_SCHEMA_BLOB,
  ledgerDigest: process.env.BODYCAST_RECOVERY_LEDGER_DIGEST, schemaSha256: process.env.BODYCAST_RECOVERY_SCHEMA_SHA256,
  sourceFingerprint: process.env.BODYCAST_RECOVERY_SOURCE_FINGERPRINT,
  databaseContainerId: process.env.BODYCAST_RECOVERY_DATABASE_CONTAINER_ID,
  databaseImageId: process.env.BODYCAST_RECOVERY_DATABASE_IMAGE_ID,
  schemaDigestContract: process.env.BODYCAST_RECOVERY_SCHEMA_CONTRACT,
  schemaDigestHelperSha256: process.env.BODYCAST_RECOVERY_SCHEMA_HELPER_SHA256, runtimeCompatibilityProof });
NODE
  docker compose -f "$COMPOSE_FILE" --profile tools run --rm --no-deps --entrypoint node migrate \
    /app/scripts/unified-v4-traffic-check.mjs --profile-id 1 || {
      echo "Unified V4 is no longer CURRENT for the recovered production profile." >&2; return 1;
    }
  printf 'BODYCAST_RECOVERED_V4_RELEASE_OK release_sha=%s migration_count=74\n' "$release_sha"
}
