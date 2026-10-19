#!/usr/bin/env bash
# Fixed host-side transport for the exact legacy V4 one-shot tool. This script
# is invoked only by the owner-gated workflow over pinned SSH.
set -Eeuo pipefail
umask 077

fail() { printf 'V4_RECOVERY_STOP %s\n' "$1" >&2; exit 1; }
mode="${1:-}"
[[ "$mode" == "preflight" || "$mode" == "execute" ]] || fail "invalid-mode"
[[ "${BODYCAST_DEPLOY_PATH:-}" == "/srv/bodycast" ]] || fail "deploy-path"
[[ "${BODYCAST_RECOVERY_SHA:-}" == "57f2124e9a97c5d3bf12d7968d11341b8e28258f" ]] || fail "source-sha"
[[ "${BODYCAST_EXPECTED_APP_SHA:-}" == "f910d2a45dfa676fada5fab42c9e8946c97872b1" ]] || fail "expected-app-sha"
[[ "${BODYCAST_OWNER_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]] || fail "owner-run-id"
[[ "${BODYCAST_WORKFLOW_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || fail "workflow-sha"
[[ "${BODYCAST_WORKFLOW_ATTEMPT:-}" == "1" ]] || fail "workflow-attempt"
[[ "${BODYCAST_IMAGE_ID:-}" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "image-id"
[[ "${BODYCAST_IMAGE_ARCHIVE_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] || fail "image-archive-digest"
[[ "${BODYCAST_HOST_SCRIPT_SHA256:-}" =~ ^[a-f0-9]{64}$ && -f "$0" && ! -L "$0" ]] || fail "host-script-identity"
[[ "$(sha256sum "$0" | awk '{print $1}')" == "$BODYCAST_HOST_SCRIPT_SHA256" ]] || fail "host-script-digest"
[[ "$(realpath -e "$0" 2>/dev/null || true)" == "$0" ]] || fail "host-script-path-identity"
[[ "${BODYCAST_IMAGE_ARCHIVE:-}" == "/var/lib/bodycast/recovery/artifacts/${BODYCAST_RECOVERY_SHA}/${BODYCAST_OWNER_RUN_ID}/image.tar" ]] || fail "image-path"

git_dir="$(git -C "$BODYCAST_DEPLOY_PATH" rev-parse --absolute-git-dir 2>/dev/null)" || fail "deploy-git-dir"
[[ -d "$git_dir" && ! -L "$git_dir" && "$(git -C "$BODYCAST_DEPLOY_PATH" rev-parse --show-toplevel)" == "$BODYCAST_DEPLOY_PATH" ]] || fail "deploy-checkout-identity"
exec 9>"$git_dir/bodycast-production-release.lock"
flock -n 9 || fail "release-lock-contended"
[[ "$(readlink "/proc/$$/fd/9" 2>/dev/null || true)" == "$git_dir/bodycast-production-release.lock" ]] || fail "release-lock-identity"

db=bodycast-db-prod
app=bodycast-app-prod
db_id="$(docker inspect --format '{{.Id}}' "$db" 2>/dev/null)" || fail "db-container-missing"
db_image="$(docker inspect --format '{{.Image}}' "$db")"
db_status="$(docker inspect --format '{{.State.Status}}' "$db")"
app_id="$(docker inspect --format '{{.Id}}' "$app" 2>/dev/null)" || fail "app-container-missing"
app_image="$(docker inspect --format '{{.Image}}' "$app")"
app_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app")"
app_sha="$(docker inspect --format '{{index .Config.Labels "org.bodycast.release-sha"}}' "$app")"
[[ "$db_id" =~ ^[a-f0-9]{64}$ && "$db_image" =~ ^sha256:[a-f0-9]{64}$ && "$db_status" == running ]] || fail "db-container-identity"
[[ "$app_id" =~ ^[a-f0-9]{64}$ && "$app_image" =~ ^sha256:[a-f0-9]{64}$ && "$app_health" == healthy && "$app_sha" == "$BODYCAST_EXPECTED_APP_SHA" ]] || fail "serving-app-identity"

if [[ ! -f "$BODYCAST_IMAGE_ARCHIVE" || -L "$BODYCAST_IMAGE_ARCHIVE" ]]; then fail "image-archive-missing"; fi
[[ "$(realpath -e "$BODYCAST_IMAGE_ARCHIVE" 2>/dev/null || true)" == "$BODYCAST_IMAGE_ARCHIVE" ]] || fail "image-path-identity"
[[ "$(sha256sum "$BODYCAST_IMAGE_ARCHIVE" | awk '{print $1}')" == "$BODYCAST_IMAGE_ARCHIVE_SHA256" ]] || fail "image-archive-digest"
if ! docker image inspect "$BODYCAST_IMAGE_ID" >/dev/null 2>&1; then
  docker load --input "$BODYCAST_IMAGE_ARCHIVE" >/dev/null || fail "image-load"
fi
[[ "$(docker image inspect --format '{{.Id}}' "$BODYCAST_IMAGE_ID" 2>/dev/null)" == "$BODYCAST_IMAGE_ID" ]] || fail "loaded-image-id"

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
docker run --rm --network "$network" --env-file "$database_env_file" "$BODYCAST_IMAGE_ID" \
  node /app/dist/production-v4-recovery-evidence.mjs > "$evidence_file" || fail "read-only-db-evidence"
validate_source_evidence() {
  local validation_result
  validation_result="$(docker run --rm --interactive --network "$network" "$BODYCAST_IMAGE_ID" \
    node --input-type=module -e 'import { readFileSync } from "node:fs"; import { validatePublicationSourceEvidence } from "/app/dist/production-v4-derived-recovery.mjs"; const report = JSON.parse(readFileSync(0, "utf8")); validatePublicationSourceEvidence({ blocks: report.blocks, sourceEvidence: report.sourceEvidence }); process.stdout.write("source-evidence-valid");' \
    < "$evidence_file")" || fail "source-fence-provenance"
  [[ "$validation_result" == "source-evidence-valid" ]] || fail "source-fence-provenance"
}
validate_source_evidence
schema_digest="$(docker exec "$db" sh -c 'pg_dump --schema-only --no-owner --no-privileges --username="$POSTGRES_USER" --dbname=bodycast' \
  | sed -E '/^-- Dumped (from database|by pg_dump) version /d' | sha256sum | awk '{print $1}')" || fail "schema-signature"
[[ "$schema_digest" =~ ^[a-f0-9]{64}$ ]] || fail "schema-signature"

if [[ "$mode" == "preflight" ]]; then
  marker="/var/lib/bodycast/recovery/unified-v4-derived-${BODYCAST_RECOVERY_SHA}.json"
  [[ ! -e "$marker" && ! -L "$marker" ]] || fail "recovery-already-started-or-terminal"
  node --input-type=module - "$evidence_file" "$schema_digest" "$db_id" "$db_image" "$app_id" "$app_image" "$db_ip" <<'NODE'
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const evidence = JSON.parse(readFileSync(process.argv[2], "utf8"));
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
const output = { sourceSha: "57f2124e9a97c5d3bf12d7968d11341b8e28258f",
  schemaSha256: process.argv[3], databaseContainerId: process.argv[4], databaseImageId: process.argv[5],
  appContainerId: process.argv[6], appImageId: process.argv[7], appSha: "f910d2a45dfa676fada5fab42c9e8946c97872b1",
  databaseContainerAddress: process.argv[8], evidence };
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
node --input-type=module - "$expected_file" "$evidence_file" "$schema_digest" "$db_id" "$db_image" "$app_id" "$app_image" "$db_ip" "$BODYCAST_WORKFLOW_SHA" "$BODYCAST_RECOVERY_SHA" <<'NODE'
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const expected = JSON.parse(readFileSync(process.argv[2], "utf8"));
const live = JSON.parse(readFileSync(process.argv[3], "utf8"));
const fences = expected.evidence?.blocks ?? [];
const fenceDigest = createHash("sha256").update([...fences].sort((a, b) => `${a.source}\0${a.sourceKey}`.localeCompare(`${b.source}\0${b.sourceKey}`))
  .map((block) => [block.source, block.sourceKey, block.fromDate, block.revision].join("\t") + "\n").join("")).digest("hex");
if (expected.schemaSha256 !== process.argv[4] || expected.databaseContainerId !== process.argv[5]
    || expected.databaseImageId !== process.argv[6] || expected.appContainerId !== process.argv[7]
    || expected.appImageId !== process.argv[8] || expected.evidence?.sourceFingerprint !== live.sourceFingerprint
    || JSON.stringify(expected.evidence?.migrationRows) !== JSON.stringify(live.migrationRows)
    || JSON.stringify(expected.evidence?.blocks) !== JSON.stringify(live.blocks)
    || JSON.stringify(expected.evidence?.sourceEvidence) !== JSON.stringify(live.sourceEvidence)
    || JSON.stringify(expected.evidence?.lifecycle) !== JSON.stringify(live.lifecycle)
    || expected.preflightSha !== process.argv[10] || expected.sourceSha !== process.argv[11]
    || expected.databaseContainerAddress !== process.argv[9]
    || live.database?.serverAddress !== process.argv[9] || live.database?.serverPort !== 5432) {
  throw new Error("Production identity, schema, raw data, lifecycle, or fences changed after isolated restore rehearsal.");
}
process.stdout.write(JSON.stringify({ preflightDigest: createHash("sha256").update(readFileSync(process.argv[2])).digest("hex"),
  ledgerDigest: expected.evidence.expectedLedgerDigest, fenceDigest, sourceFingerprint: live.sourceFingerprint }) + "\n");
NODE
[[ "$(docker inspect --format '{{.Id}}' "$db")" == "$db_id" \
  && "$(docker inspect --format '{{.Image}}' "$db")" == "$db_image" \
  && "$(docker inspect --format '{{.Id}}' "$app")" == "$app_id" \
  && "$(docker inspect --format '{{.Image}}' "$app")" == "$app_image" \
  && "$(docker inspect --format '{{.State.Status}}' "$db")" == running \
  && "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app")" == healthy ]] || fail "production-container-identity-changed"

# Durable one-shot fence is written and synced immediately before the only
# production invocation. Any interrupted/unknown outcome leaves this marker.
node --input-type=module - "$marker" "$BODYCAST_RECOVERY_SHA" "$BODYCAST_OWNER_RUN_ID" "$BODYCAST_IMAGE_ID" "$BODYCAST_IMAGE_ARCHIVE_SHA256" "$BODYCAST_WORKFLOW_SHA" "$BODYCAST_WORKFLOW_ATTEMPT" "$expected_file" "$schema_digest" "$db_id" "$db_image" "$app_id" "$app_image" <<'NODE'
import { open, rename, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const [path, sourceSha, runId, imageId, archiveSha, workflowSha, attempt, preflightPath,
  schemaSha, dbId, dbImage, appId, appImage] = process.argv.slice(2);
const preflight = JSON.parse(await readFile(preflightPath, "utf8"));
const fences = [...preflight.evidence.blocks].sort((a, b) => `${a.source}\0${a.sourceKey}`.localeCompare(`${b.source}\0${b.sourceKey}`));
const fenceDigest = createHash("sha256").update(fences.map((block) => [block.source, block.sourceKey, block.fromDate, block.revision].join("\t") + "\n").join("")).digest("hex");
const preflightDigest = createHash("sha256").update(await readFile(preflightPath)).digest("hex");
const tmp = `${path}.tmp-${process.pid}`;
const file = await open(tmp, "wx", 0o600);
await file.writeFile(`${JSON.stringify({ state: "started", sourceSha, ownerRunId: runId, workflowSha, attempt,
  imageId, archiveSha, preflightDigest, schemaSha, ledgerDigest: preflight.evidence.expectedLedgerDigest,
  fenceDigest, sourceFingerprint: preflight.evidence.sourceFingerprint, databaseContainerId: dbId,
  databaseImageId: dbImage, appContainerId: appId, appImageId: appImage, startedAt: new Date().toISOString() })}\n`);
await file.sync(); await file.close(); await rename(tmp, path);
NODE
sync -f "$marker_dir" || fail "marker-sync"
result_file="$(mktemp /var/tmp/bodycast-v4-result.XXXXXX)"
if docker run --rm --network "$network" --env-file "$database_env_file" "$BODYCAST_IMAGE_ID" > "$result_file"; then
  result_status=success
else
  result_status=failed
fi
after_file="$(mktemp /var/tmp/bodycast-v4-after.XXXXXX)"
docker run --rm --network "$network" --env-file "$database_env_file" "$BODYCAST_IMAGE_ID" \
  node /app/dist/production-v4-recovery-evidence.mjs > "$after_file" || fail "postflight-evidence-unknown"
if [[ "$result_status" != success ]]; then
  node --input-type=module - "$marker" "$result_status" <<'NODE'
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from "node:fs";
const [path, status] = process.argv.slice(2); const prior = JSON.parse(readFileSync(path, "utf8"));
const tmp = `${path}.terminal-${process.pid}`; writeFileSync(tmp, `${JSON.stringify({ ...prior, state: "terminal-failed", result: status, finishedAt: new Date().toISOString() })}\n`, { mode: 0o600, flag: "wx" });
const fd = openSync(tmp, "r+"); fsyncSync(fd); closeSync(fd); renameSync(tmp, path);
NODE
  sync -f "$marker_dir" || true
  fail "recovery-failed-no-retry"
fi
schema_digest_after="$(docker exec "$db" sh -c 'pg_dump --schema-only --no-owner --no-privileges --username="$POSTGRES_USER" --dbname=bodycast' \
  | sed -E '/^-- Dumped (from database|by pg_dump) version /d' | sha256sum | awk '{print $1}')" || fail "postflight-schema-signature"
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
const [path, beforePath, afterPath, resultPath, schemaSha256] = process.argv.slice(2);
const before = JSON.parse(readFileSync(beforePath, "utf8")); const after = JSON.parse(readFileSync(afterPath, "utf8"));
const result = JSON.parse(readFileSync(resultPath, "utf8").trim().split(/\r?\n/).at(-1));
if (before.sourceFingerprint !== after.sourceFingerprint || before.expectedLedgerDigest !== after.expectedLedgerDigest
    || after.blocks.length !== 0
    || JSON.stringify(before.migrationRows) !== JSON.stringify(after.migrationRows)
    || before.database?.database !== after.database?.database || before.database?.version !== after.database?.version
    || after.lifecycle?.unifiedRolloutEpoch !== 1 || after.lifecycle?.unifiedPublishedRolloutEpoch !== 1
    || after.lifecycle?.unifiedTargetRevision !== "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once"
    || after.lifecycle?.unifiedPublicationBlockedFromDate !== null
    || after.lifecycle?.unifiedPublishedGeneration !== after.lifecycle?.invalidationGeneration
    || after.lifecycle?.productionPublishedGeneration !== after.lifecycle?.invalidationGeneration
    || after.lifecycle?.productionStaleFromDate !== null || after.coveredDayCount !== after.persistedDayCount
    || after.coveredDayCount < 1
    || JSON.stringify([...after.persistedDayDates].sort()) !== JSON.stringify([...after.coveredDayDates].sort())
    || after.persistedDayDates.length !== after.persistedDayCount || after.coveredDayDates.length !== after.coveredDayCount
    || result.command !== "unified-v4-derived-recovery"
    || result.rolloutEpoch !== 1 || result.rawInputFingerprint !== before.sourceFingerprint) {
  throw new Error("Read-only postflight did not prove strict raw parity and V4 CURRENT coverage at epoch 1.");
}
const prior = JSON.parse(readFileSync(path, "utf8")); const tmp = `${path}.terminal-${process.pid}`;
writeFileSync(tmp, `${JSON.stringify({ ...prior, state: "completed", result: "current", finishedAt: new Date().toISOString(),
  sourceFingerprint: after.sourceFingerprint, postflightSchemaSha256: schemaSha256,
  persistedDayDates: after.persistedDayDates, coveredDayDates: after.coveredDayDates,
  coveredDayCount: after.coveredDayCount, persistedDayCount: after.persistedDayCount,
  blocksRemaining: after.blocks.length, unifiedPublishedGeneration: after.lifecycle.unifiedPublishedGeneration,
  productionPublishedGeneration: after.lifecycle.productionPublishedGeneration,
  unifiedTargetRevision: after.lifecycle.unifiedTargetRevision,
  unifiedPublicationBlockedFromDate: after.lifecycle.unifiedPublicationBlockedFromDate,
  rolloutEpoch: after.lifecycle.unifiedRolloutEpoch })}\n`, { mode: 0o600, flag: "wx" });
const fd = openSync(tmp, "r+"); fsyncSync(fd); closeSync(fd); renameSync(tmp, path);
NODE
sync -f "$marker_dir" || fail "terminal-marker-sync"
printf 'V4_RECOVERY_CURRENT epoch=1 covered=%s raw_fingerprint=%s\n' \
  "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).coveredDayCount' "$after_file")" \
  "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sourceFingerprint' "$after_file")"
rm -f -- "$result_file" "$after_file"
