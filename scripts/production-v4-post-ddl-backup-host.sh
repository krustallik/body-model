#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
readonly COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
readonly APP_CONTAINER="bodycast-app-prod"
readonly DB_CONTAINER="bodycast-db-prod"
readonly DB_NETWORK="bodycast-backend-prod"
readonly MANIFEST_ID="unified-v4-republication-v1"
readonly RELEASE_SHA="${BODYCAST_DEPLOY_SHA:-}"
readonly RUN_B64="${BODYCAST_V4_MIGRATION_RUN_B64:-}"
readonly EXPECTED_PRE_DDL_RAW_FINGERPRINT="${BODYCAST_EXPECTED_PRE_DDL_RAW_FINGERPRINT:-}"
readonly APP_HOST="${APP_HOST:-}"
readonly CADDY_ROUTES_PATH="${CADDY_ROUTES_PATH:-}"
readonly MODE="${1:-backup}"
readonly EXPECTED_APP_IMAGE_ID="${BODYCAST_V4_CANDIDATE_APP_IMAGE_ID:-}"

[[ ( "$MODE" == backup || "$MODE" == snapshot-only ) \
  && "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ && "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ \
  && "$CADDY_ROUTES_PATH" == /* && -n "$RUN_B64" \
  && "$EXPECTED_PRE_DDL_RAW_FINGERPRINT" =~ ^[a-f0-9]{64}$ \
  && "${BODYCAST_PG_RESTORE_VERSION:-}" =~ ^pg_restore\ \(PostgreSQL\)\ [0-9]+(\.[0-9]+)*$ \
  && ( "$MODE" != snapshot-only || "$EXPECTED_APP_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ) ]] || {
  echo "V4 post-DDL backup requires exact release, route, migration-run, pre-DDL raw baseline, and restore-client bindings." >&2; exit 2;
}

source "$ROOT_DIR/scripts/production-release-marker.sh"
source "$ROOT_DIR/scripts/deploy-main-freshness.sh"
source "$ROOT_DIR/scripts/production-release-lock.sh"
source "$ROOT_DIR/scripts/production-route-path.sh"
bodycast_canonicalize_routes_path || exit 1
readonly CADDY_ROUTES_PATH
source "$ROOT_DIR/scripts/production-route-primitives.sh"
bodycast_acquire_production_release_lock

# SSH stdout is reserved for pg_dump. Keep all other output on stderr.
exec 3>&1
exec 1>&2
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
tmp="$(mktemp -d /tmp/bodycast-v4-post-ddl.XXXXXX)"
chmod 700 "$tmp"
printf '%s' "$RUN_B64" | base64 --decode > "$tmp/migration-run.json"
[[ "$(base64 -w0 "$tmp/migration-run.json")" == "$RUN_B64" ]] || {
  echo "Migration-run metadata is not canonical base64." >&2; exit 1;
}
node --input-type=module - "$tmp/migration-run.json" <<'NODE'
import { readFileSync } from "node:fs";
const run = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (run.actorId !== "126446430" || run.workflowPath !== ".github/workflows/production-migrate.yml"
  || run.event !== "workflow_dispatch" || run.conclusion !== "success"
  || !/^[0-9a-f]{40}$/.test(run.headSha ?? "") || !/^[1-9][0-9]*$/.test(String(run.id ?? ""))
  || !/^[1-9][0-9]*$/.test(String(run.runAttempt ?? ""))) throw new Error("V4 DDL run metadata is not owner-verified.");
NODE
app_stopped=false
candidate_image_id=""
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$app_stopped" == true ]]; then
    if ! BODYCAST_DEPLOY_SHA="$RELEASE_SHA" compose up -d --no-deps --no-build app >/dev/null \
      || ! bash "$ROOT_DIR/scripts/production-app-container-health-wait.sh" "$RELEASE_SHA" "$candidate_image_id"; then
      echo "Failed to restart the exact prior app; maintenance remains active." >&2
      status=1
    else
      app_stopped=false
    fi
  fi
  rm -rf -- "$tmp"
  exit "$status"
}
trap cleanup EXIT

bodycast_assert_current_main_sha "$RELEASE_SHA"
[[ "$(git rev-parse HEAD)" == "$RELEASE_SHA" ]] || { echo "Production checkout is not the exact requested main SHA." >&2; exit 1; }
read_bodycast_release_marker || { echo "A valid schema-v3 production release marker is required." >&2; exit 1; }
[[ "$BODYCAST_MARKER_SCHEMA_VERSION" == 3 && "$BODYCAST_MARKER_MANIFEST_ID" == "$MANIFEST_ID" \
  && "$BODYCAST_MARKER_STATE" == "app-ready" && "$BODYCAST_MARKER_DEPLOY_SHA" == "$RELEASE_SHA" \
  && "$BODYCAST_MARKER_WORKFLOW_RUN_ID" =~ ^[1-9][0-9]*$ \
  && "$BODYCAST_MARKER_WORKFLOW_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]] || {
  echo "Fresh backup requires the exact schema-v3 V4 app-ready migration marker." >&2; exit 1;
}

marker_digest="$(sha256sum "$BODYCAST_MARKER_FILE_PATH" | awk '{print $1}')"
route_digest="$(sha256sum "${CADDY_ROUTES_PATH%/}/bodycast.caddy" | awk '{print $1}')"
bodycast_verify_exact_maintenance_route
maintenance_marker="$(bodycast_maintenance_marker_from_route)"
bodycast_probe_public_maintenance "$maintenance_marker"
if [[ "$MODE" == backup ]]; then
  app_identity="$(docker inspect --format '{{.Id}}|{{.Image}}|{{index .Config.Labels "org.bodycast.release-sha"}}|{{.State.Status}}|{{.State.Health.Status}}' "$APP_CONTAINER")"
  IFS='|' read -r app_id candidate_image_id app_sha app_state app_health <<< "$app_identity"
  [[ "$app_id" =~ ^[a-f0-9]{64}$ && "$candidate_image_id" =~ ^sha256:[a-f0-9]{64}$ \
    && "$app_sha" == "$RELEASE_SHA" && "$app_state" == "running" && "$app_health" == "healthy" \
    && "$(docker image inspect --format '{{.Id}}' bodycast-app:latest)" == "$candidate_image_id" ]] || {
    echo "Only the healthy exact-SHA app on its immutable current image can enter backup preparation." >&2; exit 1;
  }
else
  candidate_image_id="$EXPECTED_APP_IMAGE_ID"
  remaining_app="$(docker ps --all --filter "name=^/${APP_CONTAINER}$" --format '{{.Names}}')"
  [[ -z "$remaining_app" && "$(docker image inspect --format '{{.Id}}' bodycast-app:latest)" == "$candidate_image_id" ]] || {
    echo "Read-only V4 boundary capture requires the exact candidate image and an absent app container." >&2; exit 1;
  }
fi

if [[ "$MODE" == backup ]]; then
  compose --profile tools build migrate
fi
lifecycle_state="$(compose --profile tools run --rm --no-deps --entrypoint node migrate \
  /app/scripts/unified-v4-activate-replay.mjs --inspect-lifecycle --profile-id 1)"
[[ "$lifecycle_state" == '{"command":"unified-v4-activate-replay","profileId":1,"state":"v4-replayable"}' \
  || "$lifecycle_state" == '{"command":"unified-v4-activate-replay","profileId":1,"state":"v4-current"}' ]] || {
  echo "Production lifecycle is not in the supported V4 epoch-1 resume state." >&2; exit 1;
}

if [[ "$MODE" == backup ]]; then
  app_stopped=true
  docker update --restart=no "$APP_CONTAINER" >/dev/null
  compose stop app >/dev/null 2>&1 || true
  docker stop --time 0 "$APP_CONTAINER" >/dev/null 2>&1 || true
  [[ "$(docker inspect --format '{{.State.Status}}|{{.HostConfig.RestartPolicy.Name}}' "$APP_CONTAINER")" == "exited|no" ]] || {
    echo "The exact app container did not stop with restart disabled." >&2; exit 1;
  }
  compose rm --force app >/dev/null
fi
bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert

capture_snapshot() {
  local label="$1" db_metadata db_id db_image_id db_name db_state db_health db_address pg_dump_version current_marker_digest current_route_digest
  local full_fingerprint raw_fingerprint replay_stable_state_fingerprint topology target_url sql_path raw_path report_path postflight_path lifecycle_json
  sql_path="$tmp/preflight-$label.sql"; raw_path="$tmp/raw-$label.json"
  report_path="$tmp/report-$label.json"; postflight_path="$tmp/postflight-$label.json"
  db_metadata="$(docker inspect --format "{{.Id}}|{{.Image}}|{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}|{{with index .NetworkSettings.Networks \"$DB_NETWORK\"}}{{.IPAddress}}{{end}}" "$DB_CONTAINER")"
  IFS='|' read -r db_id db_image_id db_name db_state db_health db_address <<< "$db_metadata"
  [[ "$db_id" =~ ^[a-f0-9]{64}$ && "$db_image_id" =~ ^sha256:[a-f0-9]{64}$ \
    && "$db_name" == "/$DB_CONTAINER" && "$db_state" == "running" && "$db_health" == "healthy" \
    && "$db_address" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "The fixed production PostgreSQL container/image/network identity is unknown." >&2; return 1;
  }
  pg_dump_version="$(docker exec "$db_id" pg_dump --version)"
  node --input-type=module - "$pg_dump_version" "$BODYCAST_PG_RESTORE_VERSION" <<'NODE'
import { assertPostgresClientCompatibility } from "./scripts/postgres-client-versions.mjs";
assertPostgresClientCompatibility(process.argv[2], process.argv[3]);
NODE
  full_fingerprint="$(bash "$ROOT_DIR/scripts/production-db-data-fingerprint.sh" --production-container "$DB_CONTAINER")"
  raw_fingerprint="$(bash "$ROOT_DIR/scripts/production-db-data-fingerprint.sh" --production-container "$DB_CONTAINER" --v4-replay-inputs)"
  replay_stable_state_fingerprint="$(bash "$ROOT_DIR/scripts/production-db-data-fingerprint.sh" --production-container "$DB_CONTAINER" --v4-replay-stable-state)"
  [[ "$full_fingerprint" =~ ^[a-f0-9]{64}$ && "$raw_fingerprint" =~ ^[a-f0-9]{64}$ \
    && "$replay_stable_state_fingerprint" =~ ^[a-f0-9]{64}$ \
    && "$(docker inspect --format '{{.Id}}' "$DB_CONTAINER")" == "$db_id" ]] || {
    echo "Production data fingerprints or fixed DB container identity are invalid." >&2; return 1;
  }
  [[ "$raw_fingerprint" == "$EXPECTED_PRE_DDL_RAW_FINGERPRINT" ]] || {
    echo "Current production raw data differs from the signed pre-DDL encrypted-backup baseline." >&2; return 1;
  }
  topology="$(APP_HOST="$APP_HOST" CADDY_ROUTES_PATH="$CADDY_ROUTES_PATH" bash "$ROOT_DIR/scripts/production-writer-drain.sh" --report)"
  target_url="$(bash "$ROOT_DIR/scripts/production-db-target.sh" --psql-url)"
  [[ "$target_url" == postgresql://* || "$target_url" == postgres://* ]] || { echo "Reviewed production TCP database URL is unavailable." >&2; return 1; }
  node "$ROOT_DIR/scripts/production-db-preflight.mjs" > "$sql_path"
  export BODYCAST_PSQL_DATABASE_URL="$target_url"
  unset target_url
  docker exec -i --env BODYCAST_PSQL_DATABASE_URL --env "BODYCAST_WRITER_TOPOLOGY_JSON=$topology" \
    --env 'PGAPPNAME=bodycast-production-preflight' \
    --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000' \
    "$db_id" sh -c 'exec psql "$BODYCAST_PSQL_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set="BODYCAST_WRITER_TOPOLOGY_JSON=$BODYCAST_WRITER_TOPOLOGY_JSON"' \
    < "$sql_path" > "$raw_path"
  node --input-type=module - "$raw_path" "$report_path" "$db_address" "$full_fingerprint" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { assertProductionDatabaseEndpointBinding } from "./scripts/production-db-endpoint-binding.mjs";
const [rawPath, reportPath, expectedAddress, fingerprint] = process.argv.slice(2);
const report = JSON.parse(readFileSync(rawPath, "utf8"));
assertProductionDatabaseEndpointBinding(report, expectedAddress);
if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("Malformed full production data fingerprint.");
report.logicalDataFingerprint = fingerprint;
writeFileSync(reportPath, `${JSON.stringify(report)}\n`, { flag: "wx", mode: 0o600 });
NODE
  node "$ROOT_DIR/scripts/production-migration-preflight.mjs" --postflight --manifest "$MANIFEST_ID" \
    --release-sha "$RELEASE_SHA" --repository "$ROOT_DIR" --report "$report_path" > "$postflight_path"

  cat > "$tmp/lifecycle.sql" <<'SQL'
SELECT json_build_object(
  'profileId', "profileId", 'invalidationGeneration', "invalidationGeneration",
  'productionPublishedGeneration', "productionPublishedGeneration", 'productionStaleFromDate', "productionStaleFromDate",
  'unifiedTargetRevision', "unifiedTargetRevision", 'unifiedRolloutEpoch', "unifiedRolloutEpoch",
  'unifiedPublishedRolloutEpoch', "unifiedPublishedRolloutEpoch", 'unifiedPublishedGeneration', "unifiedPublishedGeneration",
  'unifiedPublicationBlockedFromDate', "unifiedPublicationBlockedFromDate", 'updatedAt', "updatedAt"
)::text FROM public."PhysiologyV7Lifecycle" WHERE "profileId" = 1;
SQL
  lifecycle_json="$(docker exec -i --env BODYCAST_PSQL_DATABASE_URL --env 'PGAPPNAME=bodycast-production-preflight' \
    --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000' \
    "$db_id" sh -c 'exec psql "$BODYCAST_PSQL_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1' \
    < "$tmp/lifecycle.sql")"
  unset BODYCAST_PSQL_DATABASE_URL
  node --input-type=module - "$report_path" "$postflight_path" "$tmp/snapshot-$label.json" \
    "$db_id" "${db_image_id#sha256:}" "${candidate_image_id#sha256:}" "$marker_digest" "$route_digest" \
    "$raw_fingerprint" "$replay_stable_state_fingerprint" "$pg_dump_version" "$BODYCAST_PG_RESTORE_VERSION" "$lifecycle_state" "$lifecycle_json" "$RELEASE_SHA" \
    "$BODYCAST_MARKER_MANIFEST_ID" "$BODYCAST_MARKER_MIGRATION_ORIGIN_SHA" "$BODYCAST_MARKER_DEPLOY_SHA" \
    "$BODYCAST_MARKER_STATE" "$BODYCAST_MARKER_WORKFLOW_RUN_ID" "$BODYCAST_MARKER_WORKFLOW_RUN_ATTEMPT" \
    "$BODYCAST_MARKER_AUTHORIZATION_ID" "$BODYCAST_MARKER_LINEAGE_DIGEST" "$BODYCAST_MARKER_SOURCE_DIGEST" \
    "$BODYCAST_MARKER_COMPATIBILITY_DIGEST" "$BODYCAST_MARKER_SCHEMA_VERSION" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [reportPath, postflightPath, outputPath, databaseContainerId, databaseImageId, appImageId,
  markerDigest, routeDigest, v4ReplayInputFingerprint, v4ReplayStableStateFingerprint, pgDumpVersion, pgRestoreVersion,
  lifecycleState, lifecycleJson, releaseSha, markerManifestId, migrationOriginSha, deploySha,
  markerState, workflowRunId, workflowRunAttempt, authorizationId, lineageDigest,
  sourceMarkerDigest, compatibilityDigest, markerSchemaVersion] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const postflight = JSON.parse(readFileSync(postflightPath, "utf8"));
const v4Lifecycle = JSON.parse(lifecycleJson);
if (postflight.ready !== true || postflight.blockers?.length !== 0) throw new Error("Production postflight is not ready.");
const snapshot = {
  schemaVersion: 1, manifestId: "unified-v4-republication-v1", releaseSha,
  canonicalMainSha: releaseSha, databaseContainerId, databaseImageId, appImageId,
  markerDigest, routeDigest, v4ReplayInputFingerprint, v4ReplayStableStateFingerprint,
  preDdlReplayInputFingerprint: v4ReplayInputFingerprint, pgDumpVersion, pgRestoreVersion,
  lifecycleState, v4Lifecycle, report,
  marker: {
    schemaVersion: Number(markerSchemaVersion), manifestId: markerManifestId, migrationOriginSha,
    deploySha, state: markerState, workflowRunId, workflowRunAttempt, authorizationId,
    lineageDigest, sourceMarkerDigest, compatibilityDigest,
  },
};
writeFileSync(outputPath, `${JSON.stringify(snapshot)}\n`, { flag: "wx", mode: 0o600 });
NODE
  node "$ROOT_DIR/scripts/production-v4-recovery.mjs" --validate-snapshot \
    "$tmp/snapshot-$label.json" "$ROOT_DIR/prisma/migrations" "$tmp/validated-$label.json" >/dev/null
  read_bodycast_release_marker || { echo "The release marker became unavailable during the backup boundary." >&2; return 1; }
  [[ "$BODYCAST_MARKER_SCHEMA_VERSION" == 3 && "$BODYCAST_MARKER_MANIFEST_ID" == "$MANIFEST_ID" \
    && "$BODYCAST_MARKER_STATE" == "app-ready" && "$BODYCAST_MARKER_DEPLOY_SHA" == "$RELEASE_SHA" ]] || {
    echo "The schema-v3 V4 app-ready marker changed during the backup boundary." >&2; return 1;
  }
  current_marker_digest="$(sha256sum "$BODYCAST_MARKER_FILE_PATH" | awk '{print $1}')"
  bodycast_verify_exact_maintenance_route
  current_route_digest="$(sha256sum "${CADDY_ROUTES_PATH%/}/bodycast.caddy" | awk '{print $1}')"
  bodycast_probe_public_maintenance "$maintenance_marker"
  [[ "$current_marker_digest" == "$marker_digest" && "$current_route_digest" == "$route_digest" ]] || {
    echo "The production marker or maintenance route changed during the backup boundary." >&2; return 1;
  }
  printf '%s\n' "$db_id" "$db_image_id" "$full_fingerprint" "$raw_fingerprint" "$replay_stable_state_fingerprint"
}

if [[ "$MODE" == snapshot-only ]]; then
  capture_snapshot boundary >/dev/null
  cat "$tmp/validated-boundary.json" >&3
  exit 0
fi

before_lines="$(capture_snapshot before)"
mapfile -t before_values <<< "$before_lines"
[[ "${#before_values[@]}" -eq 5 ]] || { echo "Pre-dump snapshot field set is invalid." >&2; exit 1; }
before_db_id="${before_values[0]}"
before_db_image_id="${before_values[1]}"
before_full_fingerprint="${before_values[2]}"
before_raw_fingerprint="${before_values[3]}"
before_replay_stable_state_fingerprint="${before_values[4]}"

bash "$ROOT_DIR/scripts/production-writer-drain.sh" --assert
bodycast_verify_exact_maintenance_route
bodycast_probe_public_maintenance "$maintenance_marker"
bodycast_assert_current_main_sha "$RELEASE_SHA"
[[ "$(docker inspect --format '{{.Id}}' "$DB_CONTAINER")" == "$before_db_id" \
  && "$(docker image inspect --format '{{.Id}}' bodycast-app:latest)" == "$candidate_image_id" \
  && "$(sha256sum "$BODYCAST_MARKER_FILE_PATH" | awk '{print $1}')" == "$marker_digest" ]] || {
  echo "Production target, app image, or marker changed at the pg_dump boundary." >&2; exit 1;
}
pg_dump_invocation_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'BODYCAST_PGDUMP_INVOCATION_AT=%s\n' "$pg_dump_invocation_at" >&2
docker exec "$before_db_id" sh -c 'exec pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" --dbname=bodycast' >&3

after_lines="$(capture_snapshot after)"
mapfile -t after_values <<< "$after_lines"
[[ "${#after_values[@]}" -eq 5 && "${after_values[0]}" == "$before_db_id" \
  && "${after_values[1]}" == "$before_db_image_id" \
  && "${after_values[2]}" == "$before_full_fingerprint" \
  && "${after_values[3]}" == "$before_raw_fingerprint" \
  && "${after_values[4]}" == "$before_replay_stable_state_fingerprint" ]] || {
  echo "Production DB, schema, history, or raw source data changed during pg_dump." >&2; exit 1;
}
node --input-type=module - "$tmp/snapshot-after.json" "$pg_dump_invocation_at" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [snapshotPath, invocationAt] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(invocationAt)) throw new Error("Malformed pg_dump invocation boundary.");
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
snapshot.pgDumpInvocationAt = invocationAt;
writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`, { flag: "w", mode: 0o600 });
NODE
node --input-type=module - "$tmp/snapshot-before.json" "$tmp/snapshot-after.json" <<'NODE'
import { readFileSync } from "node:fs";
import { assertStableV4RecoverySnapshots } from "./scripts/production-v4-recovery.mjs";
assertStableV4RecoverySnapshots(
  JSON.parse(readFileSync(process.argv[2], "utf8")),
  JSON.parse(readFileSync(process.argv[3], "utf8")),
);
NODE

BODYCAST_DEPLOY_SHA="$RELEASE_SHA" compose up -d --no-deps --no-build app >/dev/null
bash "$ROOT_DIR/scripts/production-app-container-health-wait.sh" "$RELEASE_SHA" "$candidate_image_id"
app_stopped=false
bodycast_verify_exact_maintenance_route
bodycast_probe_public_maintenance "$maintenance_marker"
bodycast_assert_current_main_sha "$RELEASE_SHA"
[[ "$(docker inspect --format '{{.Image}}|{{index .Config.Labels \"org.bodycast.release-sha\"}}|{{.State.Health.Status}}' "$APP_CONTAINER")" == "$candidate_image_id|$RELEASE_SHA|healthy" \
  && "$(sha256sum "$BODYCAST_MARKER_FILE_PATH" | awk '{print $1}')" == "$marker_digest" ]] || {
  echo "Exact app, release marker, or maintenance route did not survive backup preparation." >&2; exit 1;
}
printf 'BODYCAST_PGDUMP_INVOCATION_AT=%s\n' "$pg_dump_invocation_at" >&2
printf 'BODYCAST_V4_POST_DDL_SNAPSHOT_B64=%s\n' "$(base64 -w0 "$tmp/snapshot-after.json")" >&2
echo "Post-DDL backup source snapshot is ready; exact app is healthy behind unchanged maintenance." >&2
exit 0
