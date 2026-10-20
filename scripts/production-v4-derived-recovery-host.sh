#!/usr/bin/env bash
# Fixed host-side transport for the exact legacy V4 one-shot tool. This script
# is invoked only by the owner-gated workflow over pinned SSH.
set -Eeuo pipefail
umask 077

fail() { printf 'V4_RECOVERY_STOP %s\n' "$1" >&2; exit 1; }
mode="${1:-}"
[[ "$mode" == "pretransfer" || "$mode" == "preflight" || "$mode" == "preexecute" || "$mode" == "execute" ]] || fail "invalid-mode"
[[ "${BODYCAST_DEPLOY_PATH:-}" == "/srv/bodycast" ]] || fail "deploy-path"
[[ "${BODYCAST_RECOVERY_SHA:-}" == "ad902e2172d6343061624b35d2350284e0a1c219" ]] || fail "source-sha"
[[ "${BODYCAST_EXPECTED_APP_SHA:-}" == "f910d2a45dfa676fada5fab42c9e8946c97872b1" ]] || fail "expected-app-sha"
[[ "${BODYCAST_OWNER_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]] || fail "owner-run-id"
[[ "${BODYCAST_WORKFLOW_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || fail "workflow-sha"
[[ "${BODYCAST_WORKFLOW_ATTEMPT:-}" == "1" ]] || fail "workflow-attempt"
[[ "${BODYCAST_IMAGE_ID:-}" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "image-id"
[[ "${BODYCAST_IMAGE_DIGEST:-}" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "image-manifest-digest"
[[ "${BODYCAST_IMAGE_ARCHIVE_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] || fail "image-archive-digest"
[[ "${BODYCAST_HOST_SCRIPT_SHA256:-}" =~ ^[a-f0-9]{64}$ && -f "$0" && ! -L "$0" ]] || fail "host-script-identity"
[[ "$(sha256sum "$0" | awk '{print $1}')" == "$BODYCAST_HOST_SCRIPT_SHA256" ]] || fail "host-script-digest"
[[ "$(realpath -e "$0" 2>/dev/null || true)" == "$0" ]] || fail "host-script-path-identity"
artifact_dir="/var/lib/bodycast/recovery/artifacts/${BODYCAST_RECOVERY_SHA}/${BODYCAST_OWNER_RUN_ID}"
[[ "${BODYCAST_IMAGE_ARCHIVE:-}" == "$artifact_dir/image.tar" ]] || fail "image-path"
[[ "${BODYCAST_HEADROOM_SCRIPT:-}" == "$artifact_dir/headroom.mjs" && -f "$BODYCAST_HEADROOM_SCRIPT" \
  && ! -L "$BODYCAST_HEADROOM_SCRIPT" && "$(realpath -e "$BODYCAST_HEADROOM_SCRIPT" 2>/dev/null || true)" == "$BODYCAST_HEADROOM_SCRIPT" ]] \
  || fail "headroom-script-identity"
[[ "${BODYCAST_HEADROOM_SCRIPT_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] || fail "headroom-script-digest"
[[ "$(sha256sum "$BODYCAST_HEADROOM_SCRIPT" | awk '{print $1}')" == "$BODYCAST_HEADROOM_SCRIPT_SHA256" ]] || fail "headroom-script-digest"
[[ "${BODYCAST_SCHEMA_DIGEST_SCRIPT:-}" == "$artifact_dir/schema-digest.mjs" && -f "$BODYCAST_SCHEMA_DIGEST_SCRIPT" \
  && ! -L "$BODYCAST_SCHEMA_DIGEST_SCRIPT" && "$(realpath -e "$BODYCAST_SCHEMA_DIGEST_SCRIPT" 2>/dev/null || true)" == "$BODYCAST_SCHEMA_DIGEST_SCRIPT" ]] \
  || fail "schema-digest-script-identity"
[[ "${BODYCAST_SCHEMA_DIGEST_HELPER_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] || fail "schema-digest-script-digest"
[[ "$(sha256sum "$BODYCAST_SCHEMA_DIGEST_SCRIPT" | awk '{print $1}')" == "$BODYCAST_SCHEMA_DIGEST_HELPER_SHA256" ]] \
  || fail "schema-digest-script-digest"
schema_digest_contract="$(node "$BODYCAST_SCHEMA_DIGEST_SCRIPT" --contract 2>/dev/null)" || fail "schema-digest-contract"
[[ "$schema_digest_contract" == "bodycast-pg-dump-schema-v1" ]] || fail "schema-digest-contract"
[[ "${BODYCAST_RECOVERY_HEADROOM_METRICS_JSON:-}" =~ ^\{.{2,1022}\}$ ]] || fail "headroom-metrics-missing"

git_dir="$(git -C "$BODYCAST_DEPLOY_PATH" rev-parse --absolute-git-dir 2>/dev/null)" || fail "deploy-git-dir"
[[ -d "$git_dir" && ! -L "$git_dir" && "$(git -C "$BODYCAST_DEPLOY_PATH" rev-parse --show-toplevel)" == "$BODYCAST_DEPLOY_PATH" ]] || fail "deploy-checkout-identity"
exec 9>"$git_dir/bodycast-production-release.lock"
flock -n 9 || fail "release-lock-contended"
[[ "$(readlink "/proc/$$/fd/9" 2>/dev/null || true)" == "$git_dir/bodycast-production-release.lock" ]] || fail "release-lock-identity"

db=bodycast-db-prod
app=bodycast-app-prod
recovery_image_id() {
  local expected observed
  for expected in "$BODYCAST_IMAGE_ID" "$BODYCAST_IMAGE_DIGEST"; do
    observed="$(docker image inspect --format '{{.Id}}' "$expected" 2>/dev/null || true)"
    if [[ "$observed" == "$expected" ]]; then
      printf '%s' "$expected"
      return 0
    fi
  done
  return 1
}
db_id="$(docker inspect --format '{{.Id}}' "$db" 2>/dev/null)" || fail "db-container-missing"
db_image="$(docker inspect --format '{{.Image}}' "$db")"
db_status="$(docker inspect --format '{{.State.Status}}' "$db")"
app_id="$(docker inspect --format '{{.Id}}' "$app" 2>/dev/null)" || fail "app-container-missing"
app_image="$(docker inspect --format '{{.Image}}' "$app")"
app_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app")"
app_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$app")"
[[ "$db_id" =~ ^[a-f0-9]{64}$ && "$db_image" =~ ^sha256:[a-f0-9]{64}$ && "$db_status" == running ]] || fail "db-container-identity"
[[ "$app_id" =~ ^[a-f0-9]{64}$ && "$app_image" =~ ^sha256:[a-f0-9]{64}$ && "$app_health" == healthy && "$app_sha" == "$BODYCAST_EXPECTED_APP_SHA" ]] || fail "serving-app-identity"

headroom_check() {
  local phase="$1" docker_root pgdata_container pgwal_container mounts_json host_paths
  docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null)" || fail "docker-root-identity"
  [[ "$docker_root" == /* && -d "$docker_root" && ! -L "$docker_root" ]] || fail "docker-root-identity"
  pgdata_container="$(docker exec "$db" sh -c 'printf "%s" "${PGDATA:-/var/lib/postgresql/data}"' 2>/dev/null)" || fail "postgres-pgdata-identity"
  pgwal_container="$(docker exec "$db" sh -c 'readlink -f "${PGDATA:-/var/lib/postgresql/data}/pg_wal"' 2>/dev/null)" || fail "postgres-wal-identity"
  [[ "$pgdata_container" == /* && "$pgwal_container" == /* ]] || fail "postgres-pgdata-identity"
  mounts_json="$(docker inspect --format '{{json .Mounts}}' "$db" 2>/dev/null)" || fail "postgres-mount-identity"
  host_paths="$(BODYCAST_MOUNTS_JSON="$mounts_json" BODYCAST_PGDATA_CONTAINER="$pgdata_container" \
    BODYCAST_PGWAL_CONTAINER="$pgwal_container" node --input-type=module <<'NODE'
const mounts = JSON.parse(process.env.BODYCAST_MOUNTS_JSON);
const mapPath = (containerPath) => {
  const matches = mounts.filter((mount) => containerPath === mount.Destination
    || containerPath.startsWith(`${mount.Destination.replace(/\/$/, "")}/`))
    .sort((a, b) => b.Destination.length - a.Destination.length);
  const mount = matches[0];
  if (!mount || !mount.Source || !mount.Destination || mount.Type === "tmpfs") throw new Error("PostgreSQL path is not on a verified persistent Docker mount.");
  return `${mount.Source.replace(/\/$/, "")}${containerPath.slice(mount.Destination.replace(/\/$/, "").length)}`;
};
process.stdout.write(`${mapPath(process.env.BODYCAST_PGDATA_CONTAINER)}\n${mapPath(process.env.BODYCAST_PGWAL_CONTAINER)}\n`);
NODE
  )" || fail "postgres-mount-identity"
  mapfile -t pg_host_paths <<< "$host_paths"
  [[ "${#pg_host_paths[@]}" -eq 2 && "${pg_host_paths[0]}" == /* && "${pg_host_paths[1]}" == /* \
    && -d "${pg_host_paths[0]}" && -d "${pg_host_paths[1]}" ]] || fail "postgres-mount-identity"
  HEADROOM_REPORT="$(node "$BODYCAST_HEADROOM_SCRIPT" --check "$phase" "$BODYCAST_RECOVERY_HEADROOM_METRICS_JSON" \
    "$artifact_dir" "$docker_root" "${pg_host_paths[0]}" "${pg_host_paths[1]}" /var/tmp /var/lib/bodycast/recovery \
    "$(recovery_image_id >/dev/null && printf true || printf false)" \
    )" || fail "disk-headroom-${phase}"
}

if [[ "$mode" == "pretransfer" ]]; then
  headroom_check before-transfer
  printf '%s\n' "$HEADROOM_REPORT"
  printf 'V4_RECOVERY_HEADROOM_OK phase=before-transfer\n' >&2
  exit 0
fi
if [[ "$mode" == "preexecute" ]]; then
  headroom_check before-execute
  printf '%s\n' "$HEADROOM_REPORT"
  printf 'V4_RECOVERY_HEADROOM_OK phase=before-execute\n' >&2
  exit 0
fi

if [[ ! -f "$BODYCAST_IMAGE_ARCHIVE" || -L "$BODYCAST_IMAGE_ARCHIVE" ]]; then fail "image-archive-missing"; fi
[[ "$(realpath -e "$BODYCAST_IMAGE_ARCHIVE" 2>/dev/null || true)" == "$BODYCAST_IMAGE_ARCHIVE" ]] || fail "image-path-identity"
[[ "$(sha256sum "$BODYCAST_IMAGE_ARCHIVE" | awk '{print $1}')" == "$BODYCAST_IMAGE_ARCHIVE_SHA256" ]] || fail "image-archive-digest"
if ! recovery_image_id >/dev/null; then
  [[ "$mode" == "preflight" ]] || fail "immutable-recovery-image-not-loaded"
  headroom_check before-load
  load_output="$(docker load --input "$BODYCAST_IMAGE_ARCHIVE" 2>&1)" || { printf '%s\n' "$load_output" >&2; fail "image-load"; }
  printf 'V4_RECOVERY_IMAGE_LOAD %s\n' "$load_output" >&2
fi
recovery_image_ref="$(recovery_image_id)" || fail "loaded-image-id"

mapfile -t app_networks < <(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$app" | sort)
mapfile -t db_networks < <(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$db" | sort)
shared_networks=()
for network in "${app_networks[@]}"; do
  [[ -n "$network" ]] && printf '%s\n' "${db_networks[@]}" | grep -Fxq "$network" && shared_networks+=("$network")
done
[[ "${#shared_networks[@]}" -eq 1 ]] || fail "production-network-identity"
network="${shared_networks[0]}"
database_url="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$app" | sed -n 's/^DATABASE_URL=//p')"
[[ "$database_url" == postgresql://* && "$database_url" != *$'\n'* && "$database_url" != *$'\r'* ]] || fail "app-database-url"
network_json="$(docker inspect --format '{{json .NetworkSettings.Networks}}' "$db")"
db_ip="$(BODYCAST_DATABASE_URL="$database_url" BODYCAST_NETWORK_JSON="$network_json" BODYCAST_NETWORK_NAME="$network" node --input-type=module <<'NODE'
const networks = JSON.parse(process.env.BODYCAST_NETWORK_JSON);
const selected = networks[process.env.BODYCAST_NETWORK_NAME];
const url = new URL(process.env.BODYCAST_DATABASE_URL);
if (!selected || !selected.IPAddress || !selected.Aliases?.includes(url.hostname)
    || url.pathname !== "/bodycast" || (url.port || "5432") !== "5432") {
  throw new Error("The serving app DATABASE_URL does not resolve to the inspected production DB container.");
}
process.stdout.write(selected.IPAddress);
NODE
)" || fail "app-database-endpoint-identity"
database_env_file="$(mktemp /var/tmp/bodycast-v4-database-env.XXXXXX)"
evidence_file="$(mktemp /var/tmp/bodycast-v4-evidence.XXXXXX)"
chmod 600 "$database_env_file" || fail "database-env-file"
printf 'DATABASE_URL=%s\n' "$database_url" > "$database_env_file"
trap 'rm -f -- "$evidence_file" "$database_env_file"' EXIT
docker run --rm --network "$network" --env-file "$database_env_file" "$recovery_image_ref" \
  node /app/dist/production-v4-recovery-evidence.mjs > "$evidence_file" || fail "read-only-db-evidence"
validate_source_evidence() {
  local validation_result
  validation_result="$(docker run --rm --interactive --network "$network" "$recovery_image_ref" \
    node --input-type=module -e 'import { readFileSync } from "node:fs"; import { validatePublicationSourceEvidence } from "/app/dist/production-v4-derived-recovery.mjs"; const report = JSON.parse(readFileSync(0, "utf8")); validatePublicationSourceEvidence({ blocks: report.blocks, sourceEvidence: report.sourceEvidence }); process.stdout.write("source-evidence-valid");' \
    < "$evidence_file")" || fail "source-fence-provenance"
  [[ "$validation_result" == "source-evidence-valid" ]] || fail "source-fence-provenance"
}
validate_source_evidence
schema_digest="$(docker exec "$db" sh -c 'pg_dump --schema-only --no-owner --no-privileges --username="$POSTGRES_USER" --dbname=bodycast' \
  | node "$BODYCAST_SCHEMA_DIGEST_SCRIPT")" || fail "schema-signature"
[[ "$schema_digest" =~ ^[a-f0-9]{64}$ ]] || fail "schema-signature"

if [[ "$mode" == "preflight" ]]; then
  marker="/var/lib/bodycast/recovery/unified-v4-derived-${BODYCAST_RECOVERY_SHA}.json"
  [[ ! -e "$marker" && ! -L "$marker" ]] || fail "recovery-already-started-or-terminal"
  BODYCAST_HEADROOM_BEFORE_LOAD_JSON="$HEADROOM_REPORT" node --input-type=module - "$evidence_file" "$schema_digest" "$db_id" "$db_image" "$app_id" "$app_image" "$db_ip" "$schema_digest_contract" "$BODYCAST_SCHEMA_DIGEST_HELPER_SHA256" <<'NODE'
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const evidence = JSON.parse(readFileSync(process.argv[2], "utf8"));
const headroomBeforeLoad = JSON.parse(process.env.BODYCAST_HEADROOM_BEFORE_LOAD_JSON ?? "");
if (headroomBeforeLoad.phase !== "before-load") throw new Error("Pre-load disk-headroom evidence is malformed.");
const ledgerDigest = createHash("sha256").update(evidence.expectedMigrationRows
  .map((row) => `${row.name}\t${row.checksum}\n`).join("")).digest("hex");
if (evidence.database?.database !== "bodycast" || !evidence.database.version.startsWith("17.")
    || evidence.migrationRows?.length !== 65 || evidence.expectedMigrationRows?.length !== 65
    || ledgerDigest !== "a4153cad028db966759935cb997b15ac3c6f1670dfc9ebd8a114f6b9520746a7"
    || evidence.migrationRows.some((row, index) => row.name !== evidence.expectedMigrationRows[index].name
      || row.checksum !== evidence.expectedMigrationRows[index].checksum || !row.finishedAt || row.rolledBackAt !== null)
    || evidence.lifecycle?.unifiedRolloutEpoch !== 1 || evidence.database?.serverAddress !== process.argv[8]
    || evidence.database?.serverPort !== 5432
    || evidence.lifecycle?.unifiedPublishedGeneration === evidence.lifecycle?.invalidationGeneration
    || !/^[a-f0-9]{64}$/.test(evidence.sourceFingerprint)
    || !Array.isArray(evidence.blocks) || evidence.blocks.length < 1
    || evidence.lifecycle?.unifiedTargetRevision !== "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once") {
  throw new Error("Live database is not the expected stale 65-migration V4 source state.");
}
const output = { sourceSha: "ad902e2172d6343061624b35d2350284e0a1c219",
  schemaSha256: process.argv[3], databaseContainerId: process.argv[4], databaseImageId: process.argv[5],
  appContainerId: process.argv[6], appImageId: process.argv[7], appSha: "f910d2a45dfa676fada5fab42c9e8946c97872b1",
  databaseContainerAddress: process.argv[8], schemaDigestContract: process.argv[9],
  schemaDigestHelperSha256: process.argv[10], headroomBeforeLoad, evidence };
process.stdout.write(`${JSON.stringify(output)}\n`);
NODE
  exit 0
fi

expected_file="${BODYCAST_PREFLIGHT_JSON_FILE:-}"
[[ "$expected_file" == "/var/lib/bodycast/recovery/artifacts/${BODYCAST_RECOVERY_SHA}/${BODYCAST_OWNER_RUN_ID}/execute-preflight.json" \
  && -f "$expected_file" && ! -L "$expected_file" ]] || fail "missing-preflight-evidence"
[[ "$(realpath -e "$expected_file" 2>/dev/null || true)" == "$expected_file" ]] || fail "preflight-path-identity"
marker_dir=/var/lib/bodycast/recovery
marker="$marker_dir/unified-v4-derived-${BODYCAST_RECOVERY_SHA}.json"
[[ ! -e "$marker" && ! -L "$marker" ]] || fail "one-shot-marker-exists"
mkdir -p -m 700 "$marker_dir" || fail "marker-directory"
[[ ! -L "$marker_dir" && -d "$marker_dir" && "$(realpath -e "$marker_dir")" == "$marker_dir" ]] || fail "marker-directory-identity"
node --input-type=module - "$expected_file" "$evidence_file" "$schema_digest" "$db_id" "$db_image" "$app_id" "$app_image" "$db_ip" "$BODYCAST_WORKFLOW_SHA" "$BODYCAST_RECOVERY_SHA" "$schema_digest_contract" "$BODYCAST_SCHEMA_DIGEST_HELPER_SHA256" <<'NODE'
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const expected = JSON.parse(readFileSync(process.argv[2], "utf8"));
const live = JSON.parse(readFileSync(process.argv[3], "utf8"));
const fences = expected.evidence?.blocks ?? [];
const modelDayKeyPattern = /^[1-9][0-9]*\|\d{4}-\d{2}-\d{2}$/;
const normalizeModelDayKeys = (keys) => {
  if (!Array.isArray(keys) || keys.length < 1 || keys.some((key) => {
    if (typeof key !== "string" || !modelDayKeyPattern.test(key)) return true;
    const date = key.slice(key.indexOf("|") + 1);
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date;
  }) || new Set(keys).size !== keys.length) throw new Error("Malformed or duplicate rehearsed model-day coverage.");
  return [...keys].sort();
};
const rehearsalCoveredModelDayKeys = normalizeModelDayKeys(expected.rehearsalCoverage?.coveredModelDayKeys);
const sourceModelDayKeys = normalizeModelDayKeys(expected.evidence?.sourceModelDayKeys);
const rehearsalCoverageSha256 = createHash("sha256").update(`${rehearsalCoveredModelDayKeys.join("\n")}\n`).digest("hex");
const fenceDigest = createHash("sha256").update([...fences].sort((a, b) => `${a.source}\0${a.sourceKey}`.localeCompare(`${b.source}\0${b.sourceKey}`))
  .map((block) => [block.source, block.sourceKey, block.fromDate, block.revision].join("\t") + "\n").join("")).digest("hex");
if (expected.schemaSha256 !== process.argv[4] || expected.databaseContainerId !== process.argv[5]
    || expected.databaseImageId !== process.argv[6] || expected.appContainerId !== process.argv[7]
    || expected.appImageId !== process.argv[8] || expected.evidence?.sourceFingerprint !== live.sourceFingerprint
    || JSON.stringify(expected.evidence?.sourceModelDayKeys) !== JSON.stringify(live.sourceModelDayKeys)
    || JSON.stringify(expected.evidence?.migrationRows) !== JSON.stringify(live.migrationRows)
    || JSON.stringify(expected.evidence?.blocks) !== JSON.stringify(live.blocks)
    || JSON.stringify(expected.evidence?.sourceEvidence) !== JSON.stringify(live.sourceEvidence)
    || JSON.stringify(expected.evidence?.lifecycle) !== JSON.stringify(live.lifecycle)
    || expected.preflightSha !== process.argv[10] || expected.sourceSha !== process.argv[11]
    || expected.schemaDigestContract !== process.argv[12] || expected.schemaDigestHelperSha256 !== process.argv[13]
    || sourceModelDayKeys.some((key) => !rehearsalCoveredModelDayKeys.includes(key))
    || expected.rehearsalCoverage?.sha256 !== rehearsalCoverageSha256
    || expected.databaseContainerAddress !== process.argv[9]
    || live.database?.serverAddress !== process.argv[9] || live.database?.serverPort !== 5432) {
  throw new Error("Production identity, schema, raw data, lifecycle, or fences changed after isolated restore rehearsal.");
}
process.stdout.write(JSON.stringify({ preflightDigest: createHash("sha256").update(readFileSync(process.argv[2])).digest("hex"),
  ledgerDigest: expected.evidence.expectedLedgerDigest, fenceDigest, sourceFingerprint: live.sourceFingerprint }) + "\n");
NODE
binding_json="$(docker run --rm --interactive --network "$network" "$recovery_image_ref" \
  node --input-type=module -e 'import { readFileSync } from "node:fs"; import { recoveryEvidenceBinding } from "/app/dist/production-v4-derived-recovery.mjs"; const report = JSON.parse(readFileSync(0, "utf8")); const binding = recoveryEvidenceBinding({ sourceFingerprint: report.evidence.sourceFingerprint, blocks: report.evidence.blocks, lifecycle: report.evidence.lifecycle }); process.stdout.write(JSON.stringify(binding));' \
  < "$expected_file")" || fail "canonical-recovery-binding"
BODYCAST_BINDING_JSON="$binding_json" BODYCAST_EXPECTED_FILE="$expected_file" node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
const preflight = JSON.parse(readFileSync(process.env.BODYCAST_EXPECTED_FILE, "utf8"));
const binding = JSON.parse(process.env.BODYCAST_BINDING_JSON);
if (!preflight.expectedEntryBinding || JSON.stringify(preflight.expectedEntryBinding) !== JSON.stringify(binding)
    || binding.contract !== "bodycast-v4-recovery-evidence-binding-v1"
    || !/^[a-f0-9]{64}$/.test(binding.rawFingerprint) || !/^[a-f0-9]{64}$/.test(binding.fenceDigest)
    || !/^[a-f0-9]{64}$/.test(binding.lifecycleDigest) || !/^[a-f0-9]{64}$/.test(binding.bindingDigest)) {
  throw new Error("Preflight-to-entrypoint evidence binding is absent or changed.");
}
NODE
printf 'BODYCAST_V4_EXPECTED_EVIDENCE_BINDING=%s\n' "$binding_json" >> "$database_env_file"
[[ "$(docker inspect --format '{{.Id}}' "$db")" == "$db_id" \
  && "$(docker inspect --format '{{.Image}}' "$db")" == "$db_image" \
  && "$(docker inspect --format '{{.Id}}' "$app")" == "$app_id" \
  && "$(docker inspect --format '{{.Image}}' "$app")" == "$app_image" \
  && "$(docker inspect --format '{{.State.Status}}' "$db")" == running \
  && "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app")" == healthy ]] || fail "production-container-identity-changed"

headroom_check before-execute

# Durable one-shot fence is written and synced immediately before the only
# production invocation. Any interrupted/unknown outcome leaves this marker.
node --input-type=module - "$marker" "$BODYCAST_RECOVERY_SHA" "$BODYCAST_OWNER_RUN_ID" "$BODYCAST_IMAGE_ID" "$BODYCAST_IMAGE_ARCHIVE_SHA256" "$BODYCAST_WORKFLOW_SHA" "$BODYCAST_WORKFLOW_ATTEMPT" "$expected_file" "$schema_digest" "$db_id" "$db_image" "$app_id" "$app_image" <<'NODE'
import { open, rename, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const [path, sourceSha, runId, imageId, archiveSha, workflowSha, attempt, preflightPath,
  schemaSha, dbId, dbImage, appId, appImage] = process.argv.slice(2);
const preflight = JSON.parse(await readFile(preflightPath, "utf8"));
const fences = [...preflight.evidence.blocks].sort((a, b) => `${a.source}\0${a.sourceKey}`.localeCompare(`${b.source}\0${b.sourceKey}`));
const rehearsalCoveredModelDayKeys = preflight.rehearsalCoverage?.coveredModelDayKeys;
if (!Array.isArray(rehearsalCoveredModelDayKeys) || rehearsalCoveredModelDayKeys.length < 1
    || rehearsalCoveredModelDayKeys.some((key) => typeof key !== "string" || !/^[1-9][0-9]*\|\d{4}-\d{2}-\d{2}$/.test(key))
    || new Set(rehearsalCoveredModelDayKeys).size !== rehearsalCoveredModelDayKeys.length) {
  throw new Error("Preflight rehearsal coverage is malformed or duplicated.");
}
const normalizedRehearsalCoverage = [...rehearsalCoveredModelDayKeys].sort();
const rehearsalCoverageSha256 = createHash("sha256").update(`${normalizedRehearsalCoverage.join("\n")}\n`).digest("hex");
if (preflight.rehearsalCoverage.sha256 !== rehearsalCoverageSha256
    || preflight.evidence.sourceModelDayKeys.some((key) => !normalizedRehearsalCoverage.includes(key))) {
  throw new Error("Rehearsal coverage digest or persisted-source coverage binding failed.");
}
const fenceDigest = createHash("sha256").update(fences.map((block) => [block.source, block.sourceKey, block.fromDate, block.revision].join("\t") + "\n").join("")).digest("hex");
const preflightDigest = createHash("sha256").update(await readFile(preflightPath)).digest("hex");
const marker = { state: "started", sourceSha, ownerRunId: runId, workflowSha, attempt,
  imageId, archiveSha, preflightDigest, schemaSha,
  schemaDigestContract: preflight.schemaDigestContract, schemaDigestHelperSha256: preflight.schemaDigestHelperSha256,
  ledgerDigest: preflight.evidence.expectedLedgerDigest,
  fenceDigest, sourceFingerprint: preflight.evidence.sourceFingerprint, databaseContainerId: dbId,
  rehearsalCoverageSha256, rehearsalCoveredModelDayKeys: normalizedRehearsalCoverage,
  databaseImageId: dbImage, appContainerId: appId, appImageId: appImage, startedAt: new Date().toISOString() };
const markerContents = `${JSON.stringify(marker)}\n`;
const markerBytes = Buffer.byteLength(markerContents);
const headroomMetrics = JSON.parse(process.env.BODYCAST_RECOVERY_HEADROOM_METRICS_JSON ?? "null");
const { pathToFileURL } = await import("node:url");
const { recoveryTerminalMarkerBudgetTemplate, serializedRecoveryMarkerBytes } = await import(pathToFileURL(process.env.BODYCAST_HEADROOM_SCRIPT));
const terminalMarkerTemplate = recoveryTerminalMarkerBudgetTemplate(marker, {
  sourceModelDayKeys: preflight.evidence.sourceModelDayKeys,
  coveredModelDayKeys: normalizedRehearsalCoverage,
  sourceFingerprint: preflight.evidence.sourceFingerprint,
  schemaSha256: schemaSha,
  rehearsalCoverageSha256,
  unifiedTargetRevision: "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
});
if (!Number.isSafeInteger(headroomMetrics?.recoveryStartMarkerBytes) || headroomMetrics.recoveryStartMarkerBytes < markerBytes) {
  throw new Error("Durable start marker exceeds the measured disk headroom allowance.");
}
if (!Number.isSafeInteger(headroomMetrics?.recoveryTerminalMarkerBytes)
    || headroomMetrics.recoveryTerminalMarkerBytes < serializedRecoveryMarkerBytes(terminalMarkerTemplate)) {
  throw new Error("Durable terminal marker peak exceeds the measured disk headroom allowance.");
}
const tmp = `${path}.tmp-${process.pid}`;
const file = await open(tmp, "wx", 0o600);
await file.writeFile(markerContents);
await file.sync(); await file.close(); await rename(tmp, path);
NODE
sync -f "$marker_dir" || fail "marker-sync"
result_file="$(mktemp /var/tmp/bodycast-v4-result.XXXXXX)"
if docker run --rm --network "$network" --env-file "$database_env_file" "$recovery_image_ref" > "$result_file"; then
  result_status=success
else
  result_status=failed
fi
after_file="$(mktemp /var/tmp/bodycast-v4-after.XXXXXX)"
docker run --rm --network "$network" --env-file "$database_env_file" "$recovery_image_ref" \
  node /app/dist/production-v4-recovery-evidence.mjs > "$after_file" || fail "postflight-evidence-unknown"
if [[ "$result_status" != success ]]; then
  node --input-type=module - "$marker" "$result_status" <<'NODE'
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from "node:fs";
const [path, status] = process.argv.slice(2); const prior = JSON.parse(readFileSync(path, "utf8"));
const terminalContents = `${JSON.stringify({ ...prior, state: "terminal-failed", result: status, finishedAt: new Date().toISOString() })}\n`;
const metrics = JSON.parse(process.env.BODYCAST_RECOVERY_HEADROOM_METRICS_JSON ?? "null");
if (!Number.isSafeInteger(metrics?.recoveryTerminalMarkerBytes) || metrics.recoveryTerminalMarkerBytes < Buffer.byteLength(terminalContents)) {
  throw new Error("Failed terminal marker exceeds the measured disk headroom allowance.");
}
const tmp = `${path}.terminal-${process.pid}`; writeFileSync(tmp, terminalContents, { mode: 0o600, flag: "wx" });
const fd = openSync(tmp, "r+"); fsyncSync(fd); closeSync(fd); renameSync(tmp, path);
NODE
  sync -f "$marker_dir" || true
  fail "recovery-failed-no-retry"
fi
schema_digest_after="$(docker exec "$db" sh -c 'pg_dump --schema-only --no-owner --no-privileges --username="$POSTGRES_USER" --dbname=bodycast' \
  | node "$BODYCAST_SCHEMA_DIGEST_SCRIPT")" || fail "postflight-schema-signature"
[[ "$schema_digest_after" == "$schema_digest" ]] || fail "schema-changed-during-recovery"
[[ "$(docker inspect --format '{{.Id}}' "$db")" == "$db_id" \
  && "$(docker inspect --format '{{.Image}}' "$db")" == "$db_image" \
  && "$(docker inspect --format '{{.State.Status}}' "$db")" == running \
  && "$(docker inspect --format '{{.Id}}' "$app")" == "$app_id" \
  && "$(docker inspect --format '{{.Image}}' "$app")" == "$app_image" \
  && "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app")" == healthy \
  && "$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$app")" == "$BODYCAST_EXPECTED_APP_SHA" ]] \
  || fail "production-container-identity-changed-during-recovery"
node --input-type=module - "$marker" "$evidence_file" "$after_file" "$result_file" "$schema_digest" <<'NODE'
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
const [path, beforePath, afterPath, resultPath, schemaSha256] = process.argv.slice(2);
const before = JSON.parse(readFileSync(beforePath, "utf8")); const after = JSON.parse(readFileSync(afterPath, "utf8"));
const result = JSON.parse(readFileSync(resultPath, "utf8").trim().split(/\r?\n/).at(-1));
const preflight = JSON.parse(readFileSync(process.env.BODYCAST_PREFLIGHT_JSON_FILE, "utf8"));
const modelDayKeyPattern = /^[1-9][0-9]*\|\d{4}-\d{2}-\d{2}$/;
const rehearsedKeys = preflight.rehearsalCoverage?.coveredModelDayKeys;
const rehearsalCoverage = Array.isArray(rehearsedKeys) ? [...rehearsedKeys].sort() : [];
const actualCoverage = Array.isArray(after.coveredModelDayKeys) ? [...after.coveredModelDayKeys].sort() : [];
const rehearsalCoverageSha256 = createHash("sha256").update(`${rehearsalCoverage.join("\n")}\n`).digest("hex");
if (before.sourceFingerprint !== after.sourceFingerprint || before.expectedLedgerDigest !== after.expectedLedgerDigest
    || after.blocks.length !== 0
    || JSON.stringify(before.migrationRows) !== JSON.stringify(after.migrationRows)
    || before.database?.database !== after.database?.database || before.database?.version !== after.database?.version
    || after.lifecycle?.unifiedRolloutEpoch !== 1 || after.lifecycle?.unifiedPublishedRolloutEpoch !== 1
    || after.lifecycle?.unifiedTargetRevision !== "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once"
    || after.lifecycle?.unifiedPublicationBlockedFromDate !== null
    || after.lifecycle?.unifiedPublishedGeneration !== after.lifecycle?.invalidationGeneration
    || after.lifecycle?.productionPublishedGeneration !== after.lifecycle?.invalidationGeneration
    || after.lifecycle?.productionStaleFromDate !== null || after.coveredDayCount < after.sourceModelDayCount
    || after.coveredDayCount < 1
    || !Array.isArray(rehearsedKeys) || rehearsedKeys.length < 1
    || rehearsedKeys.some((key) => typeof key !== "string" || !modelDayKeyPattern.test(key))
    || new Set(rehearsedKeys).size !== rehearsedKeys.length
    || preflight.rehearsalCoverage.sha256 !== rehearsalCoverageSha256
    || rehearsalCoverage.length !== actualCoverage.length
    || rehearsalCoverage.some((key, index) => key !== actualCoverage[index])
    || after.sourceModelDayKeys.some((key) => !rehearsalCoverage.includes(key))
    || after.sourceModelDayCount !== after.sourceModelDayKeys.length || after.coveredDayCount !== after.coveredModelDayKeys.length
    || JSON.stringify(before.sourceModelDayKeys) !== JSON.stringify(after.sourceModelDayKeys)
    || result.command !== "unified-v4-derived-recovery"
    || result.rolloutEpoch !== 1 || result.rawInputFingerprint !== before.sourceFingerprint) {
  throw new Error("Read-only postflight did not prove strict raw parity and V4 CURRENT coverage at epoch 1.");
}
const prior = JSON.parse(readFileSync(path, "utf8")); const tmp = `${path}.terminal-${process.pid}`;
const terminalContents = `${JSON.stringify({ ...prior, state: "completed", result: "current", finishedAt: new Date().toISOString(),
  sourceFingerprint: after.sourceFingerprint, postflightSchemaSha256: schemaSha256,
  schemaDigestContract: preflight.schemaDigestContract, schemaDigestHelperSha256: preflight.schemaDigestHelperSha256,
  sourceModelDayKeys: after.sourceModelDayKeys, coveredModelDayKeys: after.coveredModelDayKeys,
  rehearsalCoverageSha256: preflight.rehearsalCoverage.sha256,
  sourceModelDayCount: after.sourceModelDayCount, coveredDayCount: after.coveredDayCount,
  blocksRemaining: after.blocks.length, unifiedPublishedGeneration: after.lifecycle.unifiedPublishedGeneration,
  productionPublishedGeneration: after.lifecycle.productionPublishedGeneration,
  unifiedTargetRevision: after.lifecycle.unifiedTargetRevision,
  unifiedPublicationBlockedFromDate: after.lifecycle.unifiedPublicationBlockedFromDate,
  rolloutEpoch: after.lifecycle.unifiedRolloutEpoch })}\n`;
const headroomMetrics = JSON.parse(process.env.BODYCAST_RECOVERY_HEADROOM_METRICS_JSON ?? "null");
if (!Number.isSafeInteger(headroomMetrics?.recoveryTerminalMarkerBytes)
    || headroomMetrics.recoveryTerminalMarkerBytes < Buffer.byteLength(terminalContents)) {
  throw new Error("Completed terminal marker exceeds the measured disk headroom allowance.");
}
writeFileSync(tmp, terminalContents, { mode: 0o600, flag: "wx" });
const fd = openSync(tmp, "r+"); fsyncSync(fd); closeSync(fd); renameSync(tmp, path);
NODE
sync -f "$marker_dir" || fail "terminal-marker-sync"
printf 'V4_RECOVERY_CURRENT epoch=1 covered=%s raw_fingerprint=%s\n' \
  "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).coveredDayCount' "$after_file")" \
  "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sourceFingerprint' "$after_file")"
rm -f -- "$result_file" "$after_file"
