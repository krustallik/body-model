#!/usr/bin/env bash
# Read-only production snapshot and encrypted-dump source for the separate
# database-only V4 preparation workflow. This never enters maintenance, changes
# Docker/traffic/markers, or executes production DDL.
set -Eeuo pipefail
umask 077

readonly EXPECTED_SOURCE_RUN_ID="38211169161"
readonly EXPECTED_SOURCE_ATTEMPT="1"
readonly EXPECTED_RESUME_SHA="3ede9e1644616e65edb3ac29a49df2f109786942"
readonly DB_CONTAINER="bodycast-db-prod"
readonly DB_NETWORK="bodycast-backend-prod"
readonly APP_CONTAINER="bodycast-app-prod"
readonly DB_IMAGE="postgres:17-alpine"

release_sha="${1:-}"
deploy_path="${DEPLOY_PATH:-}"
app_host="${APP_HOST:-}"
routes_path="${CADDY_ROUTES_PATH:-}"
[[ "$release_sha" =~ ^[a-f0-9]{40}$ ]] || { echo "Exact release SHA is malformed." >&2; exit 2; }
[[ "$deploy_path" == /* && "$deploy_path" != *$'\n'* && "$deploy_path" != *$'\r'* ]] || { echo "Deployment path is invalid." >&2; exit 2; }
[[ "$app_host" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "APP_HOST is invalid." >&2; exit 2; }
[[ "$routes_path" == /* && "$routes_path" != *$'\n'* && "$routes_path" != *$'\r'* ]] || { echo "Caddy route path is invalid." >&2; exit 2; }
[[ "${BODYCAST_PG_RESTORE_VERSION:-}" =~ ^pg_restore\ \(PostgreSQL\)\ [0-9]+(\.[0-9]+)*$ ]] || {
  echo "Pinned pg_restore version is missing or malformed." >&2; exit 2;
}
[[ -n "${BODYCAST_CAPTURE_HISTORY_PROOF_B64:-}" && -n "${BODYCAST_PRODUCTION_RUNS_B64:-}"
  && "${BODYCAST_CURRENT_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]] || {
  echo "Exact source-run identity or current workflow metadata is missing." >&2; exit 2;
}

cd -- "$deploy_path"
assert_exact_release_checkout() {
  [[ "$(git rev-parse --show-toplevel)" == "$deploy_path" && "$(git rev-parse HEAD)" == "$release_sha"
    && "$(git rev-parse refs/remotes/origin/main 2>/dev/null || true)" == "$release_sha"
    && -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || {
    echo "Production checkout is not clean at the exact requested current-main SHA." >&2; return 1;
  }
}

# Resolve the shared lock implementation from the requested commit object,
# verify that object, then acquire the lock before reading any production state.
# The checkout is checked again under the lock to close the precheck race.
assert_exact_release_checkout
git_dir="$(git rev-parse --absolute-git-dir)"
[[ -d "$git_dir" && ! -L "$git_dir" ]] || { echo "Production Git metadata directory is unavailable." >&2; exit 1; }
lock_helper_blob="$(git rev-parse "$release_sha:scripts/production-release-lock.sh")"
[[ "$lock_helper_blob" =~ ^[a-f0-9]{40}$
  && "$(git cat-file -t "${release_sha}^{commit}")" == "commit"
  && "$(git hash-object --stdin < <(git cat-file blob "$lock_helper_blob"))" == "$lock_helper_blob" ]] || {
  echo "Exact-SHA production release lock helper is unavailable or invalid." >&2; exit 1;
}
source <(git cat-file blob "$lock_helper_blob")
bodycast_acquire_production_release_lock
assert_exact_release_checkout

source "$deploy_path/scripts/production-release-marker.sh"
marker_status=1
if read_bodycast_release_marker >/dev/null 2>&1; then marker_status=0; else marker_status=$?; fi
[[ "$marker_status" -eq 1 ]] || { echo "A release/recovery marker exists or has unknown state." >&2; exit 1; }
source "$deploy_path/scripts/production-route-primitives.sh"

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

read_private_file() {
  local file="$1" bytes mode owner
  [[ -f "$file" && ! -L "$file" ]] || { echo "Required capture lineage file is missing or unsafe." >&2; return 1; }
  bytes="$(stat -c '%s' -- "$file")"
  mode="$(stat -c '%a' -- "$file")"
  owner="$(stat -c '%u' -- "$file")"
  [[ "$bytes" =~ ^[0-9]+$ && "$bytes" -gt 0 && "$bytes" -le 8192
    && "$mode" =~ ^[0-7]{3,4}$ && $((8#$mode & 077)) -eq 0 && "$owner" == "$(id -u)" ]] || {
    echo "Capture lineage file permissions, owner, or size are invalid." >&2; return 1;
  }
}

capture_path="$git_dir/bodycast-production-pre-ddl-release"
source_capture_path="$git_dir/bodycast-production-pre-ddl-release-before-${EXPECTED_RESUME_SHA}"
receipt_path="$git_dir/bodycast-production-pre-ddl-release-resume-${EXPECTED_SOURCE_RUN_ID}-${EXPECTED_SOURCE_ATTEMPT}"

collect_snapshot() {
  local suffix="$1" topology marker db_meta container_id db_address fingerprint pin_name pinned_image_id target_url
  local sql_file="$tmp/preflight-${suffix}.sql" raw_file="$tmp/raw-${suffix}.json" report_file="$tmp/report-${suffix}.json"
  local writer_file="$tmp/writer-${suffix}.json" preflight_file="$tmp/preflight-result-${suffix}.json"
  local payload_file="$tmp/host-snapshot-${suffix}.json" verified_file="$tmp/verified-${suffix}.json"
  local app_ids_file="$tmp/app-ids-${suffix}.txt" public_headers="$tmp/public-headers-${suffix}" public_body="$tmp/public-body-${suffix}"
  local current_capture="$tmp/current-capture-${suffix}" source_capture="$tmp/source-capture-${suffix}"
  local current_receipt="$tmp/current-receipt-${suffix}"

  read_private_file "$capture_path"
  read_private_file "$source_capture_path"
  read_private_file "$receipt_path"
  cp -- "$capture_path" "$current_capture"
  cp -- "$source_capture_path" "$source_capture"
  cp -- "$receipt_path" "$current_receipt"

  # Search both the reviewed fixed app name and every app service in the
  # production Compose project, including stopped containers.
  docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.ID}}' > "$app_ids_file"
  docker ps --all --filter 'label=com.docker.compose.project=bodycast-prod' \
    --filter 'label=com.docker.compose.service=app' --format '{{.ID}}' >> "$app_ids_file"
  [[ ! -s "$app_ids_file" ]] || { echo "A production app-service container is present; no-app mode is forbidden." >&2; return 1; }

  db_meta="$(docker inspect --format "{{.Id}}|{{.Name}}|{{.Config.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}|{{with index .NetworkSettings.Networks \"$DB_NETWORK\"}}{{.IPAddress}}{{end}}" "$DB_CONTAINER")"
  [[ "$db_meta" == *"|/$DB_CONTAINER|$DB_IMAGE|running|healthy|"* ]] || {
    echo "The fixed production PostgreSQL container identity or health is unexpected." >&2; return 1;
  }
  container_id="${db_meta%%|*}"
  db_address="${db_meta##*|}"
  [[ "$container_id" =~ ^[a-f0-9]{64}$ ]] || { echo "Production database container ID is malformed." >&2; return 1; }
  [[ -n "$db_address" && "$db_address" != *$'\n'* && "$db_address" != *$'\r'* ]] || {
    echo "Production database backend endpoint is missing or malformed." >&2; return 1;
  }
  local pg_dump_version
  pg_dump_version="$(docker exec "$DB_CONTAINER" pg_dump --version)"
  node --input-type=module - "$pg_dump_version" "$BODYCAST_PG_RESTORE_VERSION" <<'NODE'
import { assertPostgresClientCompatibility } from "./scripts/postgres-client-versions.mjs";
assertPostgresClientCompatibility(process.argv[2], process.argv[3]);
NODE

  export APP_HOST="$app_host" CADDY_ROUTES_PATH="$routes_path" DEPLOY_SHA="$release_sha" RELEASE_SHA="$release_sha"
  topology="$(bash "$deploy_path/scripts/production-writer-drain.sh" --report)"
  marker="$(bodycast_maintenance_marker_from_route)"
  bodycast_verify_exact_maintenance_route
  bodycast_probe_public_maintenance "$marker"
  local status
  status="$(curl --silent --show-error --max-redirs 0 --connect-timeout 5 --max-time 15 \
    --dump-header "$public_headers" --output "$public_body" --write-out '%{http_code}' "https://${app_host}/")"
  [[ "$status" == "503" ]] \
    && grep -Fqx 'BodyCast is temporarily unavailable while the model is updated.' "$public_body" \
    && awk -v expected="$marker" 'BEGIN { IGNORECASE = 1 } /^X-BodyCast-Deploy-Maintenance:/ { sub(/^[^:]*:[[:space:]]*/, ""); sub(/[[:space:]]*\r$/, ""); if ($0 == expected) found = 1 } END { exit !found }' "$public_headers" \
    && awk 'BEGIN { IGNORECASE = 1 } /^Cache-Control:/ { sub(/^[^:]*:[[:space:]]*/, ""); sub(/[[:space:]]*\r$/, ""); if (tolower($0) == "no-store") found = 1 } END { exit !found }' "$public_headers" || {
    echo "Live public maintenance response is inconsistent or cacheable." >&2; return 1;
  }

  node "$deploy_path/scripts/production-db-preflight.mjs" > "$sql_file"
  # Keep the preflight on the reviewed Compose DATABASE_URL; a socket default
  # would make inet_server_addr()/inet_server_port() null and identity unverifiable.
  target_url="$(bash "$deploy_path/scripts/production-db-target.sh" --psql-url)"
  [[ "$target_url" == postgresql://* || "$target_url" == postgres://* ]] \
    && [[ "$target_url" != *$'\n'* && "$target_url" != *$'\r'* ]] || {
    echo "The reviewed production PostgreSQL target URL is missing or malformed." >&2; return 1;
  }
  export BODYCAST_PSQL_DATABASE_URL="$target_url"
  unset target_url
  docker exec -i \
    --env BODYCAST_PSQL_DATABASE_URL \
    --env "BODYCAST_WRITER_TOPOLOGY_JSON=$topology" \
    --env 'PGAPPNAME=bodycast-production-preflight' \
    --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000' \
    "$DB_CONTAINER" sh -c 'exec psql "$BODYCAST_PSQL_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set="BODYCAST_WRITER_TOPOLOGY_JSON=$BODYCAST_WRITER_TOPOLOGY_JSON"' \
    < "$sql_file" > "$raw_file"
  unset BODYCAST_PSQL_DATABASE_URL
  node --input-type=module - "$raw_file" "$db_address" <<'NODE'
import { readFileSync } from "node:fs";
import { assertNoAppDatabaseEndpointBinding } from "./scripts/production-no-app-db-target.mjs";
const [reportPath, expectedAddress] = process.argv.slice(2);
assertNoAppDatabaseEndpointBinding(JSON.parse(readFileSync(reportPath, "utf8")), expectedAddress);
NODE
  fingerprint="$(bash "$deploy_path/scripts/production-db-data-fingerprint.sh" --production-container "$DB_CONTAINER")"
  [[ "$fingerprint" =~ ^[a-f0-9]{64}$ ]] || { echo "Production data fingerprint is malformed." >&2; return 1; }
  node --input-type=module - "$raw_file" "$report_file" "$fingerprint" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [rawPath, outputPath, digest] = process.argv.slice(2);
const report = JSON.parse(readFileSync(rawPath, "utf8"));
if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Malformed production fingerprint.");
report.logicalDataFingerprint = digest;
writeFileSync(outputPath, `${JSON.stringify(report)}\n`, { flag: "wx", mode: 0o600 });
NODE
  node "$deploy_path/scripts/production-migration-preflight.mjs" --preflight \
    --manifest unified-v4-republication-v1 --release-sha "$release_sha" \
    --repository "$deploy_path" --report "$report_file" > "$preflight_file"
  pin_name="$(sed -n 's/^previousImagePin=//p' "$current_capture")"
  [[ "$pin_name" =~ ^bodycast-app:rollback-preflight-[1-9][0-9]*-[1-9][0-9]*$ ]] || {
    echo "Saved capture lacks its exact attempt-bound rollback image pin." >&2; return 1;
  }
  pinned_image_id="$(docker image inspect --format '{{.Id}}' "$pin_name")"
  [[ "$pinned_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "Saved rollback image pin identity is unknown." >&2; return 1; }

  BODYCAST_PINNED_IMAGE_ID="$pinned_image_id" node --input-type=module - "$report_file" "$preflight_file" "$payload_file" "$current_capture" \
    "$source_capture" "$current_receipt" "$container_id" "$marker" "$release_sha" "$pg_dump_version" "$BODYCAST_PG_RESTORE_VERSION" \
  "$BODYCAST_CURRENT_RUN_ID" "$BODYCAST_CAPTURE_HISTORY_PROOF_B64" "$BODYCAST_PRODUCTION_RUNS_B64" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [reportPath, preflightPath, outputPath, currentPath, sourcePath, receiptPath,
  containerId, routeMarker, releaseSha, pgDumpVersion, pgRestoreVersion, currentRunId, proofB64, runsB64] = process.argv.slice(2);
function decode(value) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("Non-canonical base64 evidence.");
  return JSON.parse(bytes.toString("utf8"));
}
const publicBody = "BodyCast is temporarily unavailable while the model is updated.\n";
const input = {
  releaseSha, canonicalMainSha: releaseSha, manifestId: "unified-v4-republication-v1",
  report: JSON.parse(readFileSync(reportPath, "utf8")),
  preflightResult: JSON.parse(readFileSync(preflightPath, "utf8")),
  postgresClientVersions: { pgDump: pgDumpVersion, pgRestore: pgRestoreVersion },
  databaseContainerId: containerId,
  currentRecordText: readFileSync(currentPath, "utf8"), sourceRecordText: readFileSync(sourcePath, "utf8"),
  currentReceiptText: readFileSync(receiptPath, "utf8"),
  databaseReport: JSON.parse(readFileSync(reportPath, "utf8")), captureHistoryProof: decode(proofB64),
  pinnedImageId: process.env.BODYCAST_PINNED_IMAGE_ID,
  appContainerIds: [], routeMarker, routeSha: JSON.parse(readFileSync(reportPath, "utf8")).writerDrain.topology.routeFile.sha256,
  publicProbe: { status: 503, body: publicBody, maintenanceMarker: routeMarker, cacheControl: "no-store" },
  releaseMarkerState: "absent", productionRuns: decode(runsB64), currentRunId,
};
writeFileSync(outputPath, `${JSON.stringify(input)}\n`, { flag: "wx", mode: 0o600 });
NODE
  node "$deploy_path/scripts/production-no-app-preflight.mjs" --verify-host-snapshot \
    < "$payload_file" > "$verified_file"
  node --input-type=module - "$verified_file" <<'NODE'
import { readFileSync } from "node:fs";
const snapshot = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (snapshot.schemaVersion !== 1 || snapshot.preparationResult?.ddlAuthorization !== false
  || snapshot.preparationResult?.readyForOwnerAuthorization !== false
  || snapshot.preparationResult?.appRuntime !== "unavailable"
  || snapshot.preparationResult?.rollbackReadiness !== "unverified") {
  throw new Error("No-app snapshot did not remain preparation-only.");
}
NODE

  printf '%s\n' "$container_id" > "$tmp/container-id-${suffix}"
  printf '%s\n' "$marker" > "$tmp/route-marker-${suffix}"
  cp -- "$verified_file" "$tmp/verified-${suffix}.json"
}

collect_snapshot before
collect_snapshot immediately-before-dump
node --input-type=module - "$tmp/verified-before.json" "$tmp/verified-immediately-before-dump.json" \
  "$tmp/container-id-before" "$tmp/container-id-immediately-before-dump" \
  "$tmp/route-marker-before" "$tmp/route-marker-immediately-before-dump" > "$tmp/final-snapshot.json" <<'NODE'
import { readFileSync } from "node:fs";
import { canonicalSha256 } from "./scripts/production-migration-authorization.mjs";
import { stableNoAppSnapshot } from "./scripts/production-no-app-preflight.mjs";
import { assertFreshWriterDrain } from "./scripts/production-writer-drain.mjs";
const [beforePath, afterPath, beforeContainerPath, afterContainerPath, beforeRoutePath, afterRoutePath] = process.argv.slice(2);
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));
if (canonicalSha256(stableNoAppSnapshot(before)) !== canonicalSha256(stableNoAppSnapshot(after))
  || readFileSync(beforeContainerPath, "utf8") !== readFileSync(afterContainerPath, "utf8")
  || readFileSync(beforeRoutePath, "utf8") !== readFileSync(afterRoutePath, "utf8")) {
  throw new Error("Production DB, route, capture, or Docker identity changed between no-app preflight and dump.");
}
assertFreshWriterDrain(after.report, { now: Date.now(), maxAgeMs: 30_000 });
process.stdout.write(`${JSON.stringify(before)}\n`);
NODE

dump_container_id="$(cat "$tmp/container-id-immediately-before-dump")"
[[ "$dump_container_id" =~ ^[a-f0-9]{64}$ ]] || { echo "Dump target PostgreSQL container identity is malformed." >&2; exit 1; }
[[ "$(docker inspect --format '{{.Id}}' "$DB_CONTAINER")" == "$dump_container_id" ]] || {
  echo "Production PostgreSQL container identity changed at the dump boundary." >&2; exit 1;
}
node --input-type=module - "$tmp/final-snapshot.json" <<'NODE'
import { readFileSync } from "node:fs";
import { assertFreshWriterDrain } from "./scripts/production-writer-drain.mjs";
const snapshot = JSON.parse(readFileSync(process.argv[2], "utf8"));
assertFreshWriterDrain(snapshot.report, { now: Date.now(), maxAgeMs: 30_000 });
NODE

snapshot_b64="$(base64 -w0 "$tmp/final-snapshot.json")"
printf 'BODYCAST_NO_APP_PREPARATION_B64=%s\n' "$snapshot_b64" >&2
dump_pid=""
cleanup() {
  if [[ -n "$dump_pid" ]] && kill -0 "$dump_pid" 2>/dev/null; then
    kill "$dump_pid" 2>/dev/null || true
    wait "$dump_pid" 2>/dev/null || true
  fi
  rm -rf -- "$tmp"
}
trap cleanup EXIT TERM INT HUP
docker exec "$dump_container_id" sh -c \
  'printf "BODYCAST_PGDUMP_INVOCATION_AT=%s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2; exec pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" --dbname=bodycast' &
dump_pid=$!
set +e
wait "$dump_pid"
dump_status=$?
set -e
dump_pid=""
exit "$dump_status"
