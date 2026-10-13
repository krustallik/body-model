import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { assertTrustedOwnerWorkflowRun, BODYCAST_OWNER_ID } from "./github-owner-identity.mjs";

const PREFLIGHT_PATH = ".github/workflows/production-migration-preflight.yml";
const AUTH_GATE_MUTATION_CAPABILITY_PATTERNS = Object.freeze([
  // Historical authorization jobs may run only the checked-in Node helpers
  // and read-only GitHub/Git commands. Do not admit alternate interpreters or
  // shell wrappers that can hide network or subprocess behavior from review.
  /\b(?:python(?:[0-9]+(?:\.[0-9]+)?)?|perl|ruby|php|pwsh|powershell|deno|bun|awk|java|jshell|groovy|scala|Rscript|lua|tclsh|make|cmake|gcc|clang|npx|npm|pip|uv|dotnet|mono|socat|busybox|telnet|ftp|tftp|ncat|openssl\s+s_client|ssh|scp|sftp|docker|podman|psql|pg_dump|pg_restore|systemctl|caddy|curl|wget|nc|netcat)\b/i,
  /\b(?:bash|sh|dash|zsh)\b/i,
  /(?:^|[;&|({])\s*(?:eval|exec|source|xargs)\b/im,
  /\/dev\/(?:tcp|udp)\b/i,
  // Node's inline script is permitted for bounded JSON extraction, but code
  // execution, subprocess, worker, and network escape hatches are not.
  /\b(?:node|nodejs)\s+(?:-[A-Za-z]*[ep]|--eval|--print)\b/i,
  /\b(?:child_process|subprocess|urllib(?:\.[A-Za-z_]+)*|socket|httpx|requests\.(?:get|post|put|patch|delete)|https?\.request|createConnection|createRequire|createServer|XMLHttpRequest|WebSocket|WebTransport|EventSource|sendBeacon|Worker|Deno\.|Bun\.|globalThis)\b/i,
  /\b(?:fetch|require|eval|Function|spawn|execFile|execSync|fork|process\.binding|process\.getBuiltinModule|process\.mainModule|getBuiltinModule)\s*(?:\(|\.|\[)/i,
  /\bprocess\s*\[\s*["'`]\s*getBuiltinModule\s*["'`]\s*\]/i,
  /\bimport\s*\(\s*["'](?:node:)?(?:http|https|http2|net|tls|dgram|dns|worker_threads|child_process|vm|module|process)(?:["'/])/i,
  /\bnode:(?:http|https|http2|net|tls|dgram|dns|worker_threads|child_process|vm|module|process)\b/i,
]);
const SAFE_AUTH_GATE_JSON_EXTRACTOR = /\bnode\s+-e\s+'process\.stdout\.write\((?:String\()?JSON\.parse\(process\.argv\[1\]\)\.[A-Za-z][A-Za-z0-9]*(?:\))?\)'/g;
const AUTH_GATE_NODE_HEREDOC = /\bnode\s+--input-type=module\s+-[^\n]*(?:\\\r?\n[^\n]*)*<<'NODE'\r?\n([\s\S]*?)^\s*NODE\s*$/gm;
const AUTH_GATE_NODE_IMPORTS = new Set([
  "node:fs",
  "./scripts/github-owner-identity.mjs",
  "./scripts/production-forward-resume.mjs",
  "./scripts/production-migration-authorization.mjs",
  "./scripts/production-preflight-resume.mjs",
]);
// Content fingerprints of the inline Node fragments present in the observed
// historical auth-only workflows. This is code-level execution evidence, not
// a run/SHA allowlist: runs with these reviewed fragments are accepted even
// when harmless surrounding workflow controls differ. Unknown executable
// JavaScript fails closed because regex cannot prove arbitrary JS harmless.
const REVIEWED_AUTH_GATE_NODE_CODE_DIGESTS = new Set([
  "140d1d2bff22f3e69a3377ff9aa32f8a0d910209749a41ecb8d6c0f9dfde8236",
  "4d341603ab804354eeac2a292880e73a2e28fc85c038dc437d5eb3b740884e16",
  "4f175c6540ca4a4f0e49316e92ec1eba6f380c54183ff0de72c3f4d890b5c0a3",
  "537ff61bb1cc52d6724b5dcf4dcdaec4a2d2faf6df1d0eeb824779c918a18274",
  "640a0ba5c30d1c32d5df48e06cdda0580c46268ed29542e0e8a94c44ea017e88",
  "74ad45a56551c175c384fc97c6b55e51d20c3836ce7fcc779c3290503a6e508e",
  "81a8661ea024db6f485c3733e7f3a09cfe5d9753d1f3e84208dc1aae61a58ffc",
  "be455fbf7ba710bd85268ca108e86df402d461c4847d85b733b3983b9b20143b",
  "d408e8a32ea3c20f3165d318adba43df179f54aa2e7a34c547d47a336e559348",
  "ee1eb3a0713755cd32255bc6e6e8b3308d2bdd99bde2f71424cb98c9de51ec77",
  "f46f4433f77b48d30cbc4c5fd141dc92b88781f16787d4c801b1b8a968b30b5f",
  "f8fc9db71100b215a16da0b2ca43f42ca754a7b40f0b06acb5541dc388e664c6",
  "f2e2913f911c36aaa97859e854ad740ac99b02942df4999bc3504b0f0980ccee",
  "f45d0222b5d595473fd94456f796fd238d506f3a980e4f97fccef9ee404273e1",
]);

function authGateUsesOnlyReviewedNodeEntrypoints(runBody) {
  let scanBody = runBody.replace(AUTH_GATE_NODE_HEREDOC, (_match, source) => {
    const canonicalSource = source.replace(/\r\n/g, "\n").split("\n")
      .map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
    const sourceDigest = createHash("sha256").update(canonicalSource).digest("hex");
    if (!REVIEWED_AUTH_GATE_NODE_CODE_DIGESTS.has(sourceDigest)) return "node UNREVIEWED_NODE_HEREDOC";
    // Import declarations may legally span lines. Scan through the complete
    // declaration so a line break before `from` cannot hide its module.
    const staticImports = [...source.matchAll(/\bimport\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g)]
      .map((match) => match[1]);
    const reExports = [...source.matchAll(/\bexport\s+(?:[^;]*?\s+from\s+)["']([^"']+)["']/g)]
      .map((match) => match[1]);
    const hasUnreviewedImport = [...staticImports, ...reExports].some((specifier) => !AUTH_GATE_NODE_IMPORTS.has(specifier));
    const hasEscape = hasUnreviewedImport
      || /\b(?:child_process|subprocess|urllib(?:\.[A-Za-z_]+)*|socket|httpx|requests\.(?:get|post|put|patch|delete)|https?\.request|createConnection|createRequire|createServer|XMLHttpRequest|WebSocket|WebTransport|EventSource|sendBeacon|Worker|Deno\.|Bun\.|globalThis|fetch|require|eval|Function|spawn|execFile|execSync|fork|process\.binding|process\.getBuiltinModule|process\.mainModule|getBuiltinModule)\b/i.test(source)
      || /\bprocess\s*\[\s*["'`]\s*getBuiltinModule\s*["'`]\s*\]/i.test(source)
      || /\bimport\s*\(/i.test(source)
      || /\bnode:(?:http|https|http2|net|tls|dgram|dns|worker_threads|child_process|vm|module|process)\b/i.test(source);
    return hasEscape ? "node UNSAFE_NODE_HEREDOC" : "SAFE_NODE_HEREDOC";
  });
  scanBody = scanBody
    .replace(SAFE_AUTH_GATE_JSON_EXTRACTOR, "SAFE_NODE_JSON_EXTRACTOR")
    .replace(/\bnode\s+scripts\/github-forward-resume-evidence\.mjs\b[^\n]*/g, "SAFE_NODE_FORWARD_EVIDENCE")
    .replace(/\bnode\s+scripts\/production-preflight-resume\.mjs\s+--verify-(?:source|pre-ddl-migration-failure)\b[^\n]*/g, "SAFE_NODE_PREFLIGHT_EVIDENCE");
  return !/\bnode(?:js)?\s+\S+/i.test(scanBody);
}
const DEPLOY_PATH = ".github/workflows/deploy-production.yml";
const NO_APP_PATH = ".github/workflows/production-no-app-preflight.yml";
const CI_PATH = ".github/workflows/ci.yml";
const MUTATION_WORKFLOW_PATHS = new Set([
  PREFLIGHT_PATH,
  ".github/workflows/production-migrate.yml",
  ".github/workflows/production-database-cutback.yml",
  ".github/workflows/activate-unified-v4-production.yml",
  ".github/workflows/production-full-history-recalculate.yml",
  ".github/workflows/deploy-production.yml",
  ".github/workflows/production-no-app-preflight.yml",
]);
export const DEPLOY_CONTROL_FILES = Object.freeze([
  ".github/workflows/deploy-production.yml",
  ".github/workflows/ci.yml",
  "scripts/ci/production-deploy-gate.ts",
  "docker-compose.prod.yml",
  ".dockerignore",
  "Dockerfile",
  "package.json",
  "package-lock.json",
  "prisma",
  "scripts/deploy-main-freshness.sh",
  "scripts/deploy-preflight-schema.sh",
  "scripts/deploy.sh",
  "scripts/filter-ssh-known-hosts.mjs",
  "scripts/production-app-container-health-wait.sh",
  "scripts/production-release-lock.sh",
  "scripts/production-release-marker.sh",
  "scripts/production-route-path.sh",
  "scripts/production-route-primitives.sh",
  "scripts/production-schema-deploy-handoff.mjs",
]);
const DEPLOY_PRE_MAINTENANCE_CONTROL_FILES = Object.freeze(DEPLOY_CONTROL_FILES.filter((file) =>
  file !== ".github/workflows/ci.yml" && file !== "scripts/production-release-marker.sh"));
const REVIEWED_MARKER_CLEANUP_SUFFIX_DIGESTS = new Set([
  "810bf5a2b2c74cb1193ba1319462373d1dcc9424c4a178efc31b9e36a7b7411c",
  "f9f837fd1ad0faade077d81f437c2180a6f628f676dd79bd31b5cf7a4f9374a4",
]);
const REVIEWED_PREVIOUS_APP_COMPATIBILITY_FUNCTION_DIGESTS = new Set([
  "1a450802333a1de3c04fb4e2c3e351dfb93551861cfc719ddff898416b1b14ae",
  "5afa9bbaaf68c7a06bd9999dfaae7a2e9fbc00ea11952989b4f6017a9e078b8d",
]);
export const PREFLIGHT_CAPTURE_RESUME_CONTROL_FILES = Object.freeze([
  "docker-compose.prod.yml",
  "scripts/deploy-main-freshness.sh",
  "scripts/production-capture-resume-receipt.mjs",
  "scripts/production-no-app-preflight.mjs",
  "scripts/production-previous-app-provenance.mjs",
  "scripts/production-release-lock.sh",
  "scripts/production-release-marker.sh",
  "scripts/production-route-path.sh",
  "scripts/production-route-primitives.sh",
  "scripts/production-traffic-cutover.sh",
  "scripts/production-writer-drain.sh",
]);
export const NO_APP_PREPARATION_CONTROL_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  NO_APP_PATH,
  "scripts/production-no-app-preflight-host.sh",
  "scripts/production-no-app-preflight.mjs",
  "scripts/github-no-app-preflight-evidence.mjs",
  "scripts/github-owner-identity.mjs",
  "scripts/filter-ssh-known-hosts.mjs",
  "scripts/postgres-client-versions.mjs",
  "scripts/production-migration-restore-check.mjs",
  "scripts/production-migration-preflight.mjs",
  "scripts/production-migration-manifests.mjs",
  "scripts/production-migration-authorization.mjs",
  "scripts/production-migration-integrity.mjs",
  "scripts/production-backup-envelope.mjs",
  "scripts/restore-encrypted-postgres-backup.mjs",
  "scripts/production-db-preflight.mjs",
  "scripts/production-db-preflight.sql",
  "scripts/production-db-data-fingerprint.sh",
  "scripts/verify-restored-backup.sql",
  "prisma/schema.prisma",
  "prisma/migrations",
  "scripts/postgres-database-identity.mjs",
  "scripts/production-writer-drain.sh",
  "scripts/production-writer-drain.mjs",
  "scripts/production-release-lock.sh",
  "scripts/production-release-marker.sh",
  "scripts/production-route-primitives.sh",
  "scripts/production-previous-app-provenance.mjs",
  "scripts/production-capture-resume-receipt.mjs",
]);
// Content-addressed profiles for the exact no-app control trees used by the
// historical owner runs in this release chain. These bind execution to the
// immutable code that ran, without requiring that old preparation code remain
// byte-identical to today's implementation or trusting a run-ID allowlist.
const REVIEWED_NO_APP_CONTROL_PROFILE_DIGESTS = new Set([
  "d59d86de04bd298eab7a39b4c2801bb6d13cecbde5c406584e45cd4160bb1d6a",
  "308530ca51dbcb682bd64a10d7522d97ef04b3d0dcd98f451c24ded67646391b",
  "7e10754123b2a1d1635fbf6c24b66b1e671efa9e1dc26fbbe2fbfccea517bc79",
  "485a606fb8dcf3d6305301930508207fc317838749f46f0c927c75845891add6",
  "95df4ed99379493cc15b641a594098870aa8753007da515c8f4e2f71bab12d13",
  "c9b779e1184aa1d1efa2c525b959b6568cafc7403a3d184cdc31e91ff6ff2599",
  "d96a56c011eb9f787a72976ef3a19573beca61432efb12def5de71163c0a83f9",
  "19481cebee6f242fe3cff7b0f4d228dbfc90cf85e9cd3f65ca51ce96e14ef31f",
  "620e282707e9618beda7f4d29163d955928f971d939479d15903f7782f47626e",
  "bea2ae68fa3a946779011c3c43b249ddaecfdd3c7646b6b46f180fc1ee80b5db",
]);
const PREFLIGHT_READ_ONLY_CHECKOUT_ACTION = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const PREFLIGHT_READ_ONLY_AUTH_ENVIRONMENT = new Map([
  ["GH_TOKEN", "${{ github.token }}"],
  ["DISPATCH_SHA", "${{ inputs.release_sha }}"],
  ["MANIFEST_ID", "${{ inputs.manifest_id }}"],
  ["CONFIRMATION", "${{ inputs.confirm_production_preflight }}"],
  ["DISPATCH_ACTOR_ID", "${{ github.actor_id }}"],
  ["RESUME_SOURCE_RUN_ID", "${{ inputs.resume_previous_preflight_run_id }}"],
  ["RESUME_MIGRATION_FAILURE_RUN_ID", "${{ inputs.resume_pre_ddl_migration_failure_run_id }}"],
  ["RESUME_BLOCKED_CAPTURE_RUN_ID", "${{ inputs.resume_blocked_capture_preflight_run_id }}"],
  ["FORWARD_RESUME_FAILED_RUN_ID", "${{ inputs.forward_resume_failed_migration_run_id }}"],
  ["REFRESH_CAPTURE_CONFIRMATION", "${{ inputs.refresh_existing_capture_confirmation }}"],
]);
const DEPLOY_AUTHORIZE_STEPS = Object.freeze([
  ["Set up job", "success"],
  ["Checkout main gate helpers", "success"],
  ["Verify triggering CI or owner dispatch and current main", "success"],
  ["Post Checkout main gate helpers", "success"],
  ["Complete job", "success"],
]);
const DEPLOY_STEPS = Object.freeze([
  ["Set up job", "success"],
  ["Checkout exact current main tooling", "success"],
  ["Recheck run identity and main tip before production credentials", "success"],
  ["Validate SSH inputs and pin the production host", "success"],
  ["Deploy exact SHA through the fixed production script", "failure"],
  ["Remove temporary SSH credentials", "success"],
  ["Post Checkout exact current main tooling", "success"],
  ["Complete job", "success"],
]);
const DEPLOY_PRE_MAINTENANCE_LOG_MARKERS = Object.freeze([
  "BLOCKED: production schema is not compatible with this application revision.",
  "Ordinary automatic deployment does not run prisma migrate deploy.",
  "Pending migration identifiers appear in the status output above.",
  "Authorize a separate production migration procedure before releasing this commit.",
  "Deploy failed before maintenance was confirmed; the previous app was not stopped or replaced.",
]);
const EXPECTED_V4_PENDING_MIGRATIONS = Object.freeze([
  "20261011120000_unified_publication_failure_fence",
  "20261011130000_only_completed_training_invalidates_v7",
]);

const REQUIRED_SOURCE_STEPS = Object.freeze({
  "Enter maintenance and drain the old app before backup": "success",
  "Verify production container and PostgreSQL client versions": "success",
  "Read-only production identity, full migration set, schema signatures, and locks": "success",
  "Capture pg_dump start on production host and create encrypted backup": "success",
  "Restore snapshot, compare source state, and rehearse exact migrations": "failure",
  "Create preflight evidence bundle": "skipped",
  "Upload encrypted production backup artifact": "skipped",
  "Upload immutable preflight and restore evidence artifact": "skipped",
  "Report read-only completion": "skipped",
});
const SUCCESSFUL_PREFLIGHT_STEPS = Object.freeze({
  "Enter maintenance and drain the old app before backup": "success",
  "Verify production container and PostgreSQL client versions": "success",
  "Read-only production identity, full migration set, schema signatures, and locks": "success",
  "Capture pg_dump start on production host and create encrypted backup": "success",
  "Restore snapshot, compare source state, and rehearse exact migrations": "success",
  "Create preflight evidence bundle": "success",
  "Upload encrypted production backup artifact": "success",
  "Upload immutable preflight and restore evidence artifact": "success",
  "Report read-only completion": "success",
});

export function serializePreflightRetryRunIds(runIds) {
  if (!Array.isArray(runIds)) throw new TypeError("Preflight retry run IDs must be an array.");
  const ids = runIds.map((id) => String(id));
  if (ids.some((id) => !/^[1-9][0-9]*$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Preflight retry run IDs must be unique positive integers.");
  }
  return ids.length === 0 ? "" : `${ids.join("\n")}\n`;
}
const BLOCKED_CAPTURE_PREFLIGHT_STEPS = Object.freeze({
  "Enter maintenance and drain the old app before backup": "failure",
  "Verify production container and PostgreSQL client versions": "skipped",
  "Read-only production identity, full migration set, schema signatures, and locks": "skipped",
  "Capture pg_dump start on production host and create encrypted backup": "skipped",
  "Restore snapshot, compare source state, and rehearse exact migrations": "skipped",
  "Create preflight evidence bundle": "skipped",
  "Upload encrypted production backup artifact": "skipped",
  "Upload immutable preflight and restore evidence artifact": "skipped",
  "Report read-only completion": "skipped",
});
const BLOCKED_CAPTURE_RETRY_JOB_STEPS = Object.freeze([
  ["Set up job", "success"],
  ["Initialize containers", "success"],
  ["Checkout exact release SHA", "success"],
  ["Set up pinned Node runtime", "success"],
  ["Install locked Prisma and project tooling", "success"],
  ["Recheck owner identity for this job attempt before production secrets", "success"],
  ["Recheck canonical main before production access", "success"],
  ["Validate production-only SSH and backup secrets", "success"],
  ["Pin production SSH host key", "success"],
  ["Enter maintenance and drain the old app before backup", "failure"],
  ["Verify production container and PostgreSQL client versions", "skipped"],
  ["Read-only production identity, full migration set, schema signatures, and locks", "skipped"],
  ["Capture pg_dump start on production host and create encrypted backup", "skipped"],
  ["Restore snapshot, compare source state, and rehearse exact migrations", "skipped"],
  ["Bind forward-resume authorization to the fresh live snapshot and rehearsal", "skipped"],
  ["Create preflight evidence bundle", "skipped"],
  ["Upload encrypted production backup artifact", "skipped"],
  ["Upload immutable preflight and restore evidence artifact", "skipped"],
  ["Report read-only completion", "skipped"],
  ["Remove temporary SSH credentials", "success"],
  ["Post Set up pinned Node runtime", "skipped"],
  ["Post Checkout exact release SHA", "success"],
  ["Stop containers", "success"],
  ["Complete job", "success"],
]);
const NO_APP_AUTHORIZATION_JOB_STEPS = Object.freeze([
  ["Set up job", "success"],
  ["Checkout current main tooling", "success"],
  ["Verify owner, confirmation, exact current main, and successful CI", "success"],
  ["Post Checkout current main tooling", "success"],
  ["Complete job", "success"],
]);
const NO_APP_AUTHORIZATION_JOB_STEP_PROFILES = Object.freeze([
  NO_APP_AUTHORIZATION_JOB_STEPS,
  Object.freeze([
    ["Set up job", "success"],
    ["Checkout exact current main tooling", "success"],
    ["Verify owner, confirmation, exact current main, and successful CI", "success"],
    ["Post Checkout exact current main tooling", "success"],
    ["Complete job", "success"],
  ]),
]);
const NO_APP_INSPECT_REQUIRED_STEPS = Object.freeze([
  "Set up job", "Initialize containers", "Checkout exact current-main release SHA", "Set up pinned Node runtime",
  "Install locked tooling", "Recheck trusted owner workflow attempt before production credentials", null,
  "Validate production SSH and backup credentials", "Pin production SSH host key",
  "Recheck exact main, capture history, and competing runs immediately before read-only snapshot",
  "Create fresh encrypted backup under the host release lock",
  "Restore backup and verify identity, schema, history, and data on isolated PostgreSQL",
  "Rehearse exact V4 migrations only on isolated PostgreSQL",
  "Recheck exact main and create preparation-only evidence", "Upload encrypted production backup",
  "Upload immutable database-only preparation evidence", "Remove temporary SSH credentials",
]);
const NO_APP_INSPECT_HISTORY_STEPS = new Set([
  "Verify exact current main and reconcile all capture/intervening workflow evidence",
  "Verify exact main, source run identity, and active production workflows",
]);
const NO_APP_INSPECT_CLEANUP_STEPS = Object.freeze([
  "Post Set up pinned Node runtime", "Post Checkout current-main release SHA",
  "Post Checkout exact current-main release SHA", "Stop containers", "Complete job",
]);
const MIGRATION_PRE_DDL_FAILURE = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/scripts/github-owner-identity.mjs' imported from /app/scripts/production-migration-authorization.mjs";
const MIGRATION_FAILURE_STEP = "Run the fixed guarded migration script over SSH";
const MIGRATION_FAILURE_JOB = "Final live guard and authorized migration";
const WRITER_DRAIN_READY_MARKER = '"contract":"bodycast-compose-internal-db-single-writer-v1","ready":true';
const PRIOR_CAPTURE_FAILURE = "An earlier pre-DDL release capture exists; operator review is required before another migration attempt.";
const MIGRATION_PATH = ".github/workflows/production-migrate.yml";
const MIGRATION_PRE_DDL_STEPS = Object.freeze({
  "Checkout exact authorized release SHA": "success",
  "Set up Node runtime": "success",
  "Recheck current canonical main before production SSH": "success",
  "Download only the signed context artifact": "success",
  "Validate protected production SSH and pin host key": "success",
  "Trust only the SSH key matching the pinned fingerprint": "success",
  "Stream signed evidence files to private remote temporary context": "success",
  "Run the fixed guarded migration script over SSH": "failure",
  "Remove temporary runner credentials": "success",
  "Post Set up Node runtime": "skipped",
  "Post Checkout exact authorized release SHA": "success",
});

function reject(message) {
  throw new Error(`Previous production preflight cannot be safely resumed: ${message}`);
}

function normalizeActionLog(text) {
  return String(text ?? "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeActionLogLabel(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9 .:/_()'-]/g, "?").slice(0, 120);
}

function parseActionLogRecords(text) {
  const records = [];
  const lines = String(text ?? "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const recordPrefix = /^([^\t]+)\t([^\t]+)\t(\d{4}-\d{2}-\d{2}T\S+Z)\s?(.*)$/;
  for (const line of lines) {
    const match = line.match(recordPrefix);
    if (match) {
      records.push({ job: match[1], step: match[2], timestamp: match[3], text: match[4] });
    } else if (records.length > 0) {
      records.at(-1).text += `\n${line}`;
    } else if (line.trim()) {
      records.push({ job: "", step: "", text: line });
    }
  }
  return records;
}

function isExpectedMigrationEvidenceRecord(record, migrationExecution, importFailure, writerDrainMarker) {
  if (record.job !== MIGRATION_FAILURE_JOB) return false;
  if (record.step === MIGRATION_FAILURE_STEP) return true;
  if (record.step !== "UNKNOWN STEP") return false;

  const steps = migrationExecution.steps ?? [];
  const migrationStepIndex = steps.findIndex((step) => step.name === MIGRATION_FAILURE_STEP);
  const migrationStep = steps[migrationStepIndex];
  const nextStep = steps[migrationStepIndex + 1];
  const logAt = Date.parse(record.timestamp);
  const startedAt = Date.parse(migrationStep?.started_at);
  const completedAt = Date.parse(migrationStep?.completed_at);
  if (![logAt, startedAt, completedAt].every(Number.isFinite) || logAt < startedAt) return false;
  const logSecond = Math.floor(logAt / 1_000);
  const startedSecond = Math.floor(startedAt / 1_000);
  const completedSecond = Math.floor(completedAt / 1_000);
  if (logSecond > startedSecond && logAt < completedAt) return true;

  const normalizedRecord = normalizeActionLog(record.text);
  const containsKnownMarker = normalizedRecord.includes(importFailure) || normalizedRecord.includes(writerDrainMarker);
  const nextStepStartedAt = Date.parse(nextStep?.started_at);
  // Jobs API step times are whole seconds. Accept a known marker in the completion second
  // only when the next step is the reviewed runner-credential cleanup and both boundaries
  // share that second; otherwise an UNKNOWN STEP record stays outside the evidence boundary.
  return containsKnownMarker
    && logSecond === completedSecond
    && nextStep?.name === "Remove temporary runner credentials"
    && nextStep.conclusion === "success"
    && Number.isFinite(nextStepStartedAt)
    && Math.floor(nextStepStartedAt / 1_000) === completedSecond;
}

function findAllOccurrences(text, needle) {
  const positions = [];
  for (let from = 0; (from = text.indexOf(needle, from)) !== -1; from += needle.length) positions.push(from);
  return positions;
}

function orderedSafeLogTokens(text, fixedTokens, pattern = null) {
  const tokens = fixedTokens.flatMap((token) => findAllOccurrences(text, token).map((index) => ({ index, text: token })));
  if (pattern) for (const match of String(text).matchAll(pattern)) tokens.push({ index: match.index, text: match[0] });
  return tokens.sort((a, b) => a.index - b.index).map(({ text: token }) => token);
}

export function extractPreMaintenanceDeployLogEvidence(rawLog) {
  const evidence = [];
  const fixed = [...DEPLOY_PRE_MAINTENANCE_LOG_MARKERS, "Database schema is up to date"];
  const migrationId = /\b20\d{12}_[A-Za-z0-9_]+\b/g;
  for (const record of parseActionLogRecords(rawLog)) {
    if (record.job !== "Deploy exact current-main SHA"
      || record.step !== "Deploy exact SHA through the fixed production script") continue;
    evidence.push(...orderedSafeLogTokens(record.text, fixed, migrationId));
  }
  return evidence.join("\n");
}

export function extractCaptureRetryLogEvidence(rawLog) {
  const evidence = [];
  const stepName = "Enter maintenance and drain the old app before backup";
  const markers = [PRIOR_CAPTURE_FAILURE, "Capture refresh requires exactly one existing BodyCast app container.",
    "Traffic is in maintenance mode; the old app container is removed", "BODYCAST_BACKUP_STARTED_AT", "BODYCAST_PGDUMP_INVOCATION_AT"];
  const records = parseActionLogRecords(rawLog);
  if (records.some((record) => record.job || record.step)) {
    for (const record of records) {
      if (record.job !== "Inspect, back up, restore, and rehearse on disposable PostgreSQL" || record.step !== stepName) continue;
      for (const token of orderedSafeLogTokens(record.text, markers)) evidence.push(`${stepName}\t${record.timestamp}\t${token}`);
    }
    return evidence.join("\n");
  }

  // The Actions job-logs API returns timestamped job text without gh's job/step tab columns.
  // The caller binds this payload to the exact failed inspection job via the Actions API;
  // accept only exact emitted stop lines so echoed shell source cannot impersonate output.
  const rawLinePrefix = /^(\d{4}-\d{2}-\d{2}(?:T| )\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?) (.*)$/;
  for (const line of String(rawLog ?? "").replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").replace(/\uFEFF/g, "").split(/\r?\n/)) {
    const match = rawLinePrefix.exec(line);
    if (!match) continue;
    const [, timestamp, output] = match;
    const exactMarker = markers.find((marker) => output === marker);
    const variableMarker = markers.find((marker) => marker.startsWith("BODYCAST_") && output.startsWith(marker));
    const token = exactMarker ?? variableMarker;
    if (token) evidence.push(`${stepName}\t${timestamp}\t${token}`);
  }
  return evidence.join("\n");
}

function workflowPath(run) {
  return typeof run?.path === "string" ? run.path.split("@")[0] : "";
}

function parseNdjson(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function normalizePinnedPostgresRegistry(source) {
  const refs = [
    "public.ecr.aws/docker/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24",
    "public.ecr.aws/docker/library/postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24",
    "docker.io/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24",
  ];
  return refs.reduce((text, ref) => text.replaceAll(ref, "<reviewed-postgres-17.11-pinned-image>"), String(source));
}

function normalizeReviewedMarkerCleanup(source) {
  const marker = source.includes("assert_bodycast_release_marker_matches() {")
    ? "assert_bodycast_release_marker_matches() {"
    : "clear_bodycast_release_marker() {";
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const suffix = source.slice(start).trimEnd();
  if (!REVIEWED_MARKER_CLEANUP_SUFFIX_DIGESTS.has(createHash("sha256").update(suffix).digest("hex"))) return null;
  const functionEnd = source.lastIndexOf("\n}");
  if (functionEnd < start || source.slice(functionEnd + 2).trim() !== "") return null;
  // deploy.sh sources this helper but does not call cleanup before the schema gate.
  return source.slice(0, start) + "<reviewed-unreached-marker-cleanup>\n";
}

export function deployControlFilesMatch(runSha, currentMainSha, cwd = process.cwd()) {
  try {
    execFileSync("git", ["diff", "--quiet", runSha, currentMainSha, "--", ...DEPLOY_PRE_MAINTENANCE_CONTROL_FILES], { cwd, stdio: "ignore" });
    const priorCi = gitTextAt(runSha, CI_PATH, cwd);
    const currentCi = gitTextAt(currentMainSha, CI_PATH, cwd);
    if (normalizePinnedPostgresRegistry(priorCi) !== normalizePinnedPostgresRegistry(currentCi)) return false;
    const priorMarker = normalizeReviewedMarkerCleanup(gitTextAt(runSha, "scripts/production-release-marker.sh", cwd));
    const currentMarker = normalizeReviewedMarkerCleanup(gitTextAt(currentMainSha, "scripts/production-release-marker.sh", cwd));
    return priorMarker !== null && priorMarker === currentMarker;
  } catch {
    return false;
  }
}

function workflowJobBlock(source, jobName) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const start = lines.indexOf(`  ${jobName}:`);
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function workflowJobPrefixThroughStep(source, jobName, stepName) {
  const block = workflowJobBlock(source, jobName);
  if (block === null) return null;
  const marker = `      - name: ${stepName}`;
  const start = block.indexOf(marker);
  if (start < 0) return null;
  const next = block.indexOf("\n      - name:", start + marker.length);
  return block.slice(0, next < 0 ? undefined : next);
}

function normalizePreviousAppVerifyRecordControls(source) {
  let normalized = String(source).replace(/\r\n?/g, "\n");
  const imports = [
    'import { isCanonicalPostgresDatabaseIdentity } from "./postgres-database-identity.mjs";',
    'import { isHistoricalPostgresDatabaseIdentity, postgresDatabaseIdentityLegacyDigestProjection } from "./postgres-database-identity.mjs";',
  ];
  const foundImports = imports.filter((line) => normalized.includes(line));
  if (foundImports.length !== 1) return null;
  normalized = normalized.replace(foundImports[0], "<reviewed-postgres-identity-import>");
  const start = normalized.indexOf("export function previousAppDatabaseCompatibilityDigests(report) {");
  const endMarker = "\n}\n\nexport function assertPreviousAppCompatibilitySnapshot";
  const end = normalized.indexOf(endMarker, start);
  if (start < 0 || end < 0) return null;
  const body = normalized.slice(start, end + 2);
  if (!REVIEWED_PREVIOUS_APP_COMPATIBILITY_FUNCTION_DIGESTS.has(createHash("sha256").update(body).digest("hex"))) return null;
  // This compatibility producer is not called by --verify-record; parsing, validation, digest, and CLI code stay exact.
  return normalized.slice(0, start) + "<reviewed-unreached-compatibility-producer>" + normalized.slice(end + 2);
}

function workflowTopLevelBlock(source, blockName) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${blockName}:`));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z0-9_-]+:\s*/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const PREFLIGHT_CAPTURE_SHELL_FUNCTIONS = Object.freeze([
  "publish_maintenance_route",
  "capture_pre_ddl_previous_release",
  "refresh_pre_ddl_previous_release",
  "stop_old_app",
  "enter_maintenance",
]);

function shellFunctionBlock(source, name) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line === `${name}() {`);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && line === "}");
  return end < 0 ? null : lines.slice(start, end + 1).join("\n");
}

function gitTextAt(sha, file, cwd) {
  return execFileSync("git", ["show", `${sha}:${file}`], { cwd, encoding: "utf8" });
}

function yamlScalar(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch { return null; }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed.replace(/\s+#.*$/, "").trim();
}

function workflowJobIds(source) {
  const block = workflowTopLevelBlock(source, "jobs");
  if (block === null) return null;
  return block.split("\n").slice(1)
    .filter((line) => /^  [A-Za-z0-9_-]+:\s*$/.test(line))
    .map((line) => line.trim().replace(/:$/, ""));
}

function workflowJobField(block, field) {
  const match = String(block).match(new RegExp(`^ {4}${field}:\\s*(.*?)\\s*$`, "m"));
  return match ? yamlScalar(match[1]) : null;
}

function workflowJobStepBlocks(block) {
  const lines = String(block).replace(/\r\n?/g, "\n").split("\n");
  const stepsHeader = lines.indexOf("    steps:");
  if (stepsHeader < 0) return null;
  const starts = [];
  for (let index = stepsHeader + 1; index < lines.length; index += 1) {
    if (/^      - /.test(lines[index])) starts.push(index);
    else if (/^    [A-Za-z0-9_-]+:\s*/.test(lines[index])) break;
  }
  if (starts.length === 0 || starts.some((index) => !/^      - name:\s*\S/.test(lines[index]))) return null;
  return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length).join("\n"));
}

function workflowStepField(block, field) {
  const match = String(block).match(new RegExp(`^        ${field}:\\s*(.*?)\\s*$`, "m"));
  return match ? yamlScalar(match[1]) : null;
}

function workflowNestedMap(block, section) {
  const lines = String(block).replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line === `        ${section}:`);
  if (start < 0) return {};
  const values = {};
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^        \S/.test(lines[index])) break;
    const match = lines[index].match(/^          ([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!match) {
      if (lines[index].trim()) return null;
      continue;
    }
    if (Object.hasOwn(values, match[1])) return null;
    values[match[1]] = yamlScalar(match[2]);
  }
  return values;
}

function workflowPermissionsAreReadOnly(source) {
  const block = workflowTopLevelBlock(source, "permissions");
  if (block === null) return false;
  const entries = block.split("\n").slice(1).filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (entries.length === 0) return false;
  const permissions = new Map();
  for (const line of entries) {
    const match = line.match(/^  ([A-Za-z0-9_-]+):\s*(read|none)\s*$/);
    if (!match || permissions.has(match[1])) return false;
    permissions.set(match[1], match[2]);
  }
  return permissions.get("contents") === "read";
}

/**
 * Derive the execution boundary from the workflow file at the run's immutable
 * SHA. A changed historical workflow is accepted only when its authorize job
 * still has a read-only token, no production credentials, and one pinned
 * checkout plus one non-mutating gate step; the GitHub job inventory is then
 * checked against this exact workflow's step names and order.
 */
export function preflightAuthorizationWorkflowContractAtSha(runSha, cwd = process.cwd()) {
  if (!/^[a-f0-9]{40}$/.test(String(runSha ?? ""))) return null;
  try {
    const source = gitTextAt(runSha, PREFLIGHT_PATH, cwd);
    const jobIds = workflowJobIds(source);
    const authorizeJob = workflowJobBlock(source, "authorize");
    const inspectJob = workflowJobBlock(source, "inspect_backup_restore");
    if (!workflowPermissionsAreReadOnly(source) || workflowTopLevelBlock(source, "env") !== null
      || JSON.stringify(jobIds) !== JSON.stringify(["authorize", "inspect_backup_restore"])
      || authorizeJob === null || inspectJob === null
      || /\$\{\{\s*(?:secrets|vars)\./i.test(authorizeJob)) return null;

    const authorizeFields = [...authorizeJob.matchAll(/^    ([A-Za-z0-9_-]+):/gm)].map((match) => match[1]);
    if (authorizeFields.some((field) => !new Set(["name", "runs-on", "timeout-minutes", "outputs", "steps", "needs", "if"]).has(field))) return null;
    if (workflowJobField(authorizeJob, "runs-on") !== "ubuntu-latest") return null;
    const authorizeName = workflowJobField(authorizeJob, "name");
    const inspectName = workflowJobField(inspectJob, "name");
    const workflowSteps = workflowJobStepBlocks(authorizeJob);
    if (!authorizeName || !inspectName || !workflowSteps || workflowSteps.length !== 2) return null;

    const expectedSteps = [["Set up job", "success"]];
    const postStepNames = [];
    let checkoutName = null;
    let gateFailureName = null;
    for (const step of workflowSteps) {
      const nameMatch = step.match(/^      - name:\s*(.*?)\s*$/m);
      const name = nameMatch ? yamlScalar(nameMatch[1]) : null;
      const uses = workflowStepField(step, "uses");
      const runHeader = /^        run:\s*\|[+-]?\s*$/m.test(step);
      const stepEnv = workflowNestedMap(step, "env");
      if (!name || stepEnv === null || /\$\{\{\s*(?:secrets|vars)\./i.test(step)
        || Object.entries(stepEnv).some(([key, value]) => PREFLIGHT_READ_ONLY_AUTH_ENVIRONMENT.get(key) !== value)) return null;
      for (const [key, value] of Object.entries(stepEnv)) {
        if (/(?:SECRET|PASSWORD|DATABASE|DB_URL|SSH|BACKUP|PRIVATE_KEY|DEPLOY|PRODUCTION)/i.test(key)) return null;
        if (key === "GH_TOKEN" && value !== "${{ github.token }}") return null;
      }
      if (uses !== null) {
        if (uses !== PREFLIGHT_READ_ONLY_CHECKOUT_ACTION || runHeader || checkoutName !== null) return null;
        const inputs = workflowNestedMap(step, "with");
        if (!inputs || Object.keys(inputs).sort().join(",") !== "fetch-depth,persist-credentials,ref"
          || inputs.ref !== "main" || inputs["fetch-depth"] !== "0" || inputs["persist-credentials"] !== "false") return null;
        checkoutName = name;
        expectedSteps.push([name, "success"]);
        postStepNames.push(`Post ${name}`);
        continue;
      }
      if (!runHeader || gateFailureName !== null || checkoutName === null) return null;
      const runLines = step.split("\n");
      const runIndex = runLines.findIndex((line) => /^        run:\s*\|[+-]?\s*$/.test(line));
      const runBody = runLines.slice(runIndex + 1).join("\n");
      const capabilityScanBody = runBody.replace(SAFE_AUTH_GATE_JSON_EXTRACTOR, "node SAFE_JSON_EXTRACTOR");
      if (AUTH_GATE_MUTATION_CAPABILITY_PATTERNS.some((pattern) => pattern.test(capabilityScanBody))) return null;
      if (!authGateUsesOnlyReviewedNodeEntrypoints(runBody)) return null;
      if (/\bgit\s+(?:push|commit|reset|update-ref|config|checkout|clean|rm|mv|branch|tag|notes|worktree)\b/i.test(runBody)
        || /\bgh\s+(?:workflow\s+(?:run|enable|disable)|run\s+(?:cancel|rerun|delete))\b/i.test(runBody)
        || /\bgh\s+api\b[^\n]*(?:--method(?:=|\s+)|-X\s*)(?:POST|PUT|PATCH|DELETE)\b/i.test(runBody)
        || /\bgh\s+api\b[^\n]*(?:\s-f\s|\s--field\b|\s-F\s)/i.test(runBody)
        || /\bgh\s+api\s+graphql\b/i.test(runBody)
        || /\b(?:fetch\s*\(|https?\.request\s*\(|createConnection\s*\()/i.test(runBody)
        || /(?:echo|printf)\s+[^\n]*(?:\$GH_TOKEN|\$\{GH_TOKEN\})/i.test(runBody)) return null;
      gateFailureName = name;
      expectedSteps.push([name, "failure"]);
    }
    if (checkoutName === null || gateFailureName === null
      || !workflowSteps.some((step) => /\bGH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/.test(step))) return null;
    expectedSteps.push(...postStepNames.map((name) => [name, "success"]), ["Complete job", "success"]);

    return Object.freeze({
      sha: runSha,
      authorizeJobName: authorizeName,
      inspectJobName: inspectName,
      authorizeSteps: Object.freeze(expectedSteps.map(([name, conclusion]) => Object.freeze({ name, conclusion }))),
    });
  } catch {
    return null;
  }
}

export function preflightAuthorizationWorkflowIsReadOnlyAtSha(runSha, cwd = process.cwd()) {
  return preflightAuthorizationWorkflowContractAtSha(runSha, cwd) !== null;
}

function gitTreeProfileDigest(sha, files, cwd) {
  const tree = execFileSync("git", ["ls-tree", "-r", "--full-tree", sha, "--", ...files], { cwd, encoding: "utf8" });
  return createHash("sha256").update(tree).digest("hex");
}

export function preflightCaptureResumeControlsMatch(runSha, currentMainSha, cwd = process.cwd()) {
  try {
    const stableFiles = PREFLIGHT_CAPTURE_RESUME_CONTROL_FILES.filter((file) => ![
      "scripts/production-traffic-cutover.sh",
      "scripts/production-previous-app-provenance.mjs",
      "scripts/production-release-marker.sh",
      "scripts/production-no-app-preflight.mjs",
    ].includes(file));
    execFileSync("git", ["diff", "--quiet", runSha, currentMainSha, "--", ...stableFiles], { cwd, stdio: "ignore" });
    const priorWorkflow = gitTextAt(runSha, PREFLIGHT_PATH, cwd);
    const currentWorkflow = gitTextAt(currentMainSha, PREFLIGHT_PATH, cwd);
    const stepName = "Enter maintenance and drain the old app before backup";
    const priorPrefix = workflowJobPrefixThroughStep(priorWorkflow, "inspect_backup_restore", stepName);
    const currentPrefix = workflowJobPrefixThroughStep(currentWorkflow, "inspect_backup_restore", stepName);
    if (priorPrefix === null || normalizePinnedPostgresRegistry(priorPrefix) !== normalizePinnedPostgresRegistry(currentPrefix)) return false;
    if (["permissions", "env", "defaults", "concurrency"].some((blockName) =>
      workflowTopLevelBlock(priorWorkflow, blockName) !== workflowTopLevelBlock(currentWorkflow, blockName))) return false;

    const priorCutover = gitTextAt(runSha, "scripts/production-traffic-cutover.sh", cwd);
    const currentCutover = gitTextAt(currentMainSha, "scripts/production-traffic-cutover.sh", cwd);
    if (PREFLIGHT_CAPTURE_SHELL_FUNCTIONS.some((name) => {
      const prior = shellFunctionBlock(priorCutover, name);
      return prior === null || prior !== shellFunctionBlock(currentCutover, name);
    })) return false;

    const priorMarker = normalizeReviewedMarkerCleanup(gitTextAt(runSha, "scripts/production-release-marker.sh", cwd));
    const currentMarker = normalizeReviewedMarkerCleanup(gitTextAt(currentMainSha, "scripts/production-release-marker.sh", cwd));
    if (priorMarker === null || priorMarker !== currentMarker) return false;
    const priorProvenance = normalizePreviousAppVerifyRecordControls(gitTextAt(runSha, "scripts/production-previous-app-provenance.mjs", cwd));
    const currentProvenance = normalizePreviousAppVerifyRecordControls(gitTextAt(currentMainSha, "scripts/production-previous-app-provenance.mjs", cwd));
    return priorProvenance !== null && priorProvenance === currentProvenance;
  } catch {
    return false;
  }
}

export function noAppPreparationControlsMatch(runSha, currentMainSha, cwd = process.cwd()) {
  if (!/^[a-f0-9]{40}$/.test(String(runSha ?? "")) || !/^[a-f0-9]{40}$/.test(String(currentMainSha ?? ""))) return false;
  try {
    return REVIEWED_NO_APP_CONTROL_PROFILE_DIGESTS.has(gitTreeProfileDigest(runSha, NO_APP_PREPARATION_CONTROL_FILES, cwd));
  } catch {
    return false;
  }
}

function commitIsAncestorOfCurrentMain(runSha, currentMainSha, cwd = process.cwd()) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", runSha, currentMainSha], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function assertRunSummaryMatches(historyRun, run) {
  for (const key of ["id", "workflow_id", "path", "head_sha", "head_branch", "event", "status", "conclusion", "run_attempt"]) {
    if (String(historyRun?.[key] ?? "") !== String(run?.[key] ?? "")) {
      reject(`a later deploy run summary differs from its complete history record (${key}).`);
    }
  }
}

function assertExactSteps(job, expected, description) {
  const steps = job?.steps;
  if (!Array.isArray(steps) || steps.length !== expected.length
    || expected.some(([name, conclusion], index) => steps[index]?.name !== name || steps[index]?.conclusion !== conclusion)) {
    reject(`${description} does not match the reviewed exact step sequence.`);
  }
}

function assertSafeFailedPreMaintenanceDeploy(evidence, { historyRun, currentMainSha, deployWorkflowId, controlFilesMatch }) {
  const run = evidence?.run;
  const runId = String(run?.id ?? "");
  if (!/^[1-9][0-9]*$/.test(runId)
    || String(run?.workflow_id) !== String(deployWorkflowId)
    || workflowPath(run) !== DEPLOY_PATH
    || run.status !== "completed" || run.conclusion !== "failure"
    || run.run_attempt !== 1 || run.head_branch !== "main" || run.event !== "workflow_run"
    || !/^[a-f0-9]{40}$/.test(String(run.head_sha ?? ""))
    || evidence.shaIsAncestorOfCurrentMain !== true) {
    reject("a later deploy is not an original completed failed automatic deploy on current-main ancestry.");
  }
  assertRunSummaryMatches(historyRun, run);
  if (run.repository?.full_name !== "krustallik/body-model"
    || String(run.repository?.owner?.id ?? "") !== BODYCAST_OWNER_ID) {
    reject("a later deploy run is not from the canonical BodyCast repository.");
  }

  const jobsPayload = evidence.jobs;
  if (jobsPayload?.total_count !== 2 || !Array.isArray(jobsPayload.jobs) || jobsPayload.jobs.length !== 2) {
    reject("a later deploy job inventory is incomplete or unexpected.");
  }
  const authorize = jobsPayload.jobs.find((job) => job.name === "Authorize exact current-main app deploy");
  const deploy = jobsPayload.jobs.find((job) => job.name === "Deploy exact current-main SHA");
  if (!authorize || !deploy || jobsPayload.jobs.some((job) => job.head_sha !== run.head_sha || job.run_attempt !== 1)) {
    reject("a later deploy job identity is incomplete or unexpected.");
  }
  if (authorize.conclusion !== "success" || deploy.conclusion !== "failure") {
    reject("a later deploy did not pass authorization and fail only in the deploy job.");
  }
  assertExactSteps(authorize, DEPLOY_AUTHORIZE_STEPS, "the deploy authorization job");
  assertExactSteps(deploy, DEPLOY_STEPS, "the deploy job");
  const deployLogText = String(evidence.deployLogText ?? "");
  const observedMigrationIds = [...deployLogText.matchAll(/\b20\d{12}_[A-Za-z0-9_]+\b/g)].map(([migrationId]) => migrationId);
  const firstBlockMarker = deployLogText.indexOf(DEPLOY_PRE_MAINTENANCE_LOG_MARKERS[0]);
  if (deployLogText.includes("Database schema is up to date")
    || observedMigrationIds.length !== EXPECTED_V4_PENDING_MIGRATIONS.length
    || observedMigrationIds.some((migrationId, index) => migrationId !== EXPECTED_V4_PENDING_MIGRATIONS[index])
    || firstBlockMarker < 0
    || deployLogText.slice(firstBlockMarker).match(/\b20\d{12}_[A-Za-z0-9_]+\b/)) {
    reject("a later deploy log does not prove the exact pending V4 migration set before the schema block.");
  }
  let markerOffset = -1;
  for (const marker of DEPLOY_PRE_MAINTENANCE_LOG_MARKERS) {
    const first = deployLogText.indexOf(marker);
    if (first < 0 || first <= markerOffset || deployLogText.indexOf(marker, first + marker.length) !== -1) {
      reject("a later deploy log does not prove the exact ordered pre-maintenance migration block.");
    }
    markerOffset = first;
  }
  const ciRuns = evidence.ciRuns;
  if (!Array.isArray(ciRuns)) reject("the exact-SHA main CI evidence for a later deploy is missing.");
  const matchingCiRuns = ciRuns.filter((ciRun) => ciRun?.head_sha === run.head_sha
    && ciRun.head_branch === "main" && ciRun.event === "push" && workflowPath(ciRun) === CI_PATH
    && ciRun.status === "completed" && ciRun.conclusion === "success");
  if (matchingCiRuns.length !== 1 || matchingCiRuns[0].run_attempt !== 1) {
    reject("a later deploy does not have one successful original main CI run for its exact SHA.");
  }

  if (typeof controlFilesMatch !== "function" || !controlFilesMatch(run.head_sha, currentMainSha)) {
    reject("deploy control files changed after the failed run, so its history cannot be reconciled.");
  }
  return Object.freeze({ runId, sha: run.head_sha, historicalEffects: "UNVERIFIED" });
}

export function verifyResumablePreflightAttempt({
  sourceRun,
  sourceJobs,
  sourceArtifacts,
  laterRuns,
  sourceRunId,
  currentRunId,
  currentMainSha,
  workflowId,
  manifestId,
  sourceIsAncestor,
  safeFailedDeployRuns = [],
  safeFailedPreflightRetries = [],
  safeHistoricalNoAppRuns = [],
  deployWorkflowId,
  controlFilesMatch = deployControlFilesMatch,
  preflightCaptureControlsMatch = preflightCaptureResumeControlsMatch,
  noAppControlsMatch = noAppPreparationControlsMatch,
  noAppWorkflowId,
  isAncestorOfCurrentMain = commitIsAncestorOfCurrentMain,
}) {
  if (!/^[1-9][0-9]*$/.test(String(sourceRunId ?? ""))
    || !/^[1-9][0-9]*$/.test(String(currentRunId ?? ""))
    || !/^[a-f0-9]{40}$/.test(String(currentMainSha ?? ""))) {
    reject("run identifiers or current main SHA are malformed.");
  }
  if (String(sourceRun?.id) !== String(sourceRunId)
    || String(sourceRun?.workflow_id) !== String(workflowId)
    || workflowPath(sourceRun) !== PREFLIGHT_PATH
    || sourceRun.status !== "completed"
    || sourceRun.conclusion !== "failure"
    || sourceRun.run_attempt !== 1
    || sourceRun.head_branch !== "main"
    || sourceRun.event !== "workflow_dispatch"
    || !/^[a-f0-9]{40}$/.test(String(sourceRun.head_sha ?? ""))) {
    reject("source must be the original completed owner-dispatched preflight failure on main.");
  }
  try {
    assertTrustedOwnerWorkflowRun(sourceRun, {
      actorId: BODYCAST_OWNER_ID,
      workflowPath: PREFLIGHT_PATH,
      workflowRunId: sourceRunId,
      workflowRunAttempt: 1,
      ref: "refs/heads/main",
      sha: sourceRun.head_sha,
    });
  } catch (error) {
    reject(error.message);
  }
  if (!new Set(["active-energy-unified-v2", "unified-v4-republication-v1"]).has(manifestId)
    || (sourceRun.display_title ?? sourceRun.name) !== `Preflight ${sourceRun.head_sha} ${manifestId}`) {
    reject("the source preflight manifest does not match the exact current request.");
  }
  if (sourceIsAncestor !== true) reject("the failed preflight SHA is not an ancestor of current main.");

  const jobs = sourceJobs?.jobs;
  if (!Array.isArray(jobs) || sourceJobs.total_count !== 2 || jobs.length !== 2) {
    reject("the failed preflight job inventory is incomplete or unexpected.");
  }
  const authorize = jobs.find((job) => job.name === "Authorize read-only preflight");
  const inspect = jobs.find((job) => job.name === "Inspect, back up, restore, and rehearse on disposable PostgreSQL");
  if (!authorize || authorize.conclusion !== "success" || !inspect || inspect.conclusion !== "failure"
    || jobs.some((job) => job.head_sha !== sourceRun.head_sha || job.run_attempt !== 1)) {
    reject("the owner gate or the expected inspection job result does not match.");
  }
  const steps = new Map((inspect.steps ?? []).map((step) => [step.name, step.conclusion]));
  for (const [name, conclusion] of Object.entries(REQUIRED_SOURCE_STEPS)) {
    if (steps.get(name) !== conclusion) reject(`step result differs from the verified pre-DDL restore failure (${name}).`);
  }
  if (manifestId === "unified-v4-republication-v1") {
    const failedSourceSteps = (inspect.steps ?? []).filter((step) => step.conclusion === "failure").map((step) => step.name);
    if (steps.get("Bind forward-resume authorization to the fresh live snapshot and rehearsal") !== "skipped"
      || failedSourceSteps.length !== 1 || failedSourceSteps[0] !== "Restore snapshot, compare source state, and rehearse exact migrations") {
      reject("the V4 source preflight did not stop exclusively at the isolated restore gate before any later operation.");
    }
  }
  if ((sourceArtifacts?.total_count ?? sourceArtifacts?.artifacts?.length) !== 0
    || (sourceArtifacts?.artifacts ?? []).length !== 0) {
    reject("the failed preflight unexpectedly published an artifact.");
  }

  const sourceId = BigInt(sourceRunId);
  const currentId = BigInt(currentRunId);
  const laterRunById = new Map();
  for (const run of laterRuns ?? []) {
    const runId = String(run?.id ?? "");
    if (!/^[1-9][0-9]*$/.test(runId)) reject("later production workflow history contains a malformed run identifier.");
    if (laterRunById.has(runId)) reject("later production workflow history contains a duplicate run.");
    laterRunById.set(runId, run);
  }
  const safeDeployById = new Map();
  for (const evidence of safeFailedDeployRuns ?? []) {
    const id = String(evidence?.run?.id ?? "");
    if (!/^[1-9][0-9]*$/.test(id) || safeDeployById.has(id)) {
      reject("safe failed-deploy evidence contains a malformed or duplicate run.");
    }
    safeDeployById.set(id, evidence);
  }
  const safePreflightRetryById = new Map();
  for (const evidence of safeFailedPreflightRetries ?? []) {
    const id = String(evidence?.run?.id ?? "");
    if (!/^[1-9][0-9]*$/.test(id) || safePreflightRetryById.has(id)) {
      reject("safe failed-preflight evidence contains a malformed or duplicate run.");
    }
    safePreflightRetryById.set(id, evidence);
  }
  const safeNoAppById = new Map();
  for (const evidence of safeHistoricalNoAppRuns ?? []) {
    const id = String(evidence?.run?.id ?? "");
    if (!/^[1-9][0-9]*$/.test(id) || safeNoAppById.has(id)) {
      reject("historical no-app evidence contains a malformed or duplicate run.");
    }
    safeNoAppById.set(id, evidence);
  }
  const verifiedDeployIds = new Set();
  const verifiedPreflightRetryIds = new Set();
  const verifiedAuthorizationOnlyPreflightRetryIds = new Set();
  const verifiedNoAppIds = new Set();
  const verifiedCaptureGuardEffects = [];
  const unverifiedHistoricalRunIds = [];
  for (const run of laterRuns ?? []) {
    const id = BigInt(String(run.id));
    if (!MUTATION_WORKFLOW_PATHS.has(workflowPath(run))) continue;
    if (id === currentId) continue;
    if (id <= sourceId && run.status !== "in_progress") continue;
    if (id >= currentId) reject(`another release or preflight workflow is concurrent with resume run ${currentRunId}.`);
    if (workflowPath(run) === DEPLOY_PATH && id > sourceId) {
      const evidence = safeDeployById.get(String(run.id));
      if (!evidence) reject(`a later deploy has no complete evidence proving a pre-maintenance schema block.`);
      const verified = assertSafeFailedPreMaintenanceDeploy(evidence, {
        historyRun: run, currentMainSha, deployWorkflowId, controlFilesMatch,
      });
      verifiedDeployIds.add(verified.runId);
      continue;
    }
    if (workflowPath(run) === PREFLIGHT_PATH && id > sourceId) {
      const evidence = safePreflightRetryById.get(String(run.id));
      if (!evidence) reject(`a later preflight has no complete evidence proving the maintenance capture guard stopped before DB inspection.`);
      const authorize = evidence.jobs?.jobs?.find((job) => job.name === "Authorize read-only preflight");
      if (authorize?.conclusion === "failure") {
        if (evidence.sourceShaIsAncestor !== true) {
          reject("an authorization-only preflight retry is not descended from the resumed source.");
        }
        if (evidence.artifacts?.total_count !== 0 || !Array.isArray(evidence.artifacts.artifacts)
          || evidence.artifacts.artifacts.length !== 0) {
          reject("an authorization-only preflight retry unexpectedly published an artifact.");
        }
        assertSafeAuthorizationOnlyPreflightRetry(evidence, {
          preflightWorkflowId: workflowId,
          historyRun: run,
        });
        verifiedPreflightRetryIds.add(String(run.id));
        verifiedAuthorizationOnlyPreflightRetryIds.add(String(run.id));
        continue;
      }
      const verified = assertSafeCaptureBlockedPreflightRetry(evidence, {
        historyRun: run,
        preflightWorkflowId: workflowId,
        currentMainSha,
        manifestId,
        preflightCaptureControlsMatch,
      });
      verifiedPreflightRetryIds.add(String(run.id));
      verifiedCaptureGuardEffects.push(verified);
      continue;
    }
    if (workflowPath(run) === NO_APP_PATH && id > sourceId) {
      const evidence = safeNoAppById.get(String(run.id));
      if (!evidence) reject(`no-app preparation run ${run.id} has no complete job and artifact inventory.`);
      assertSafeHistoricalNoAppRun(evidence, {
        historyRun: run,
        noAppWorkflowId,
        currentMainSha,
        isAncestorOfCurrentMain,
        noAppControlsMatch,
      });
      verifiedNoAppIds.add(String(run.id));
      unverifiedHistoricalRunIds.push(String(run.id));
      continue;
    }
    reject(`another release or preflight workflow exists after source run ${sourceRunId}.`);
  }
  if (verifiedDeployIds.size !== safeDeployById.size) reject("failed-deploy evidence does not match the complete production workflow history.");
  if (verifiedPreflightRetryIds.size !== safePreflightRetryById.size) {
    reject("failed-preflight evidence does not match the complete production workflow history.");
  }
  if (verifiedNoAppIds.size !== safeNoAppById.size) reject("no-app evidence does not match the complete production workflow history.");

  return Object.freeze({
    schemaVersion: 2,
    sourceRunId: String(sourceRun.id),
    sourceRunAttempt: 1,
    sourceSha: sourceRun.head_sha,
    targetSha: currentMainSha,
    unverifiedHistoricalDeployRunIds: Object.freeze([...verifiedDeployIds].sort()),
    unverifiedHistoricalPreflightRunIds: Object.freeze(verifiedCaptureGuardEffects.map((effect) => effect.runId).sort()),
    authorizationOnlyPreflightRetryRunIds: Object.freeze([...verifiedAuthorizationOnlyPreflightRetryIds].sort()),
    historicalPreflightEffects: Object.freeze(verifiedCaptureGuardEffects.sort((left, right) => left.runId.localeCompare(right.runId))),
    unverifiedHistoricalRunIds: Object.freeze(unverifiedHistoricalRunIds.sort()),
  });
}

function jobByName(jobsPayload, name, { conclusion, headSha, attempt }) {
  const job = jobsPayload?.jobs?.find((item) => item.name === name);
  if (!job || job.conclusion !== conclusion || job.head_sha !== headSha || job.run_attempt !== attempt) {
    reject(`the expected job result does not match (${name}).`);
  }
  return job;
}

function assertStepResults(job, expected, description) {
  const steps = new Map((job.steps ?? []).map((step) => [step.name, step.conclusion]));
  for (const [name, conclusion] of Object.entries(expected)) {
    if (steps.get(name) !== conclusion) reject(`${description} step result differs (${name}).`);
  }
}

function assertPreflightRun(run, { runId, workflowId, sha, conclusion }) {
  if (String(run?.id) !== String(runId) || String(run?.workflow_id) !== String(workflowId)
    || workflowPath(run) !== PREFLIGHT_PATH || run.status !== "completed" || run.conclusion !== conclusion
    || run.run_attempt !== 1 || run.head_branch !== "main" || run.event !== "workflow_dispatch"
    || run.head_sha !== sha) {
    reject("a preflight run identity, result, SHA, or original attempt does not match.");
  }
  try {
    assertTrustedOwnerWorkflowRun(run, {
      actorId: BODYCAST_OWNER_ID, workflowPath: PREFLIGHT_PATH, workflowRunId: runId,
      workflowRunAttempt: 1, ref: "refs/heads/main", sha,
    });
  } catch (error) {
    reject(error.message);
  }
}

function assertSafeAuthorizationOnlyPreflightRetry(evidence, { preflightWorkflowId, historyRun }) {
  const run = evidence?.run;
  const runId = String(run?.id ?? "");
  if (!/^[1-9][0-9]*$/.test(runId)
    || String(run?.workflow_id) !== String(preflightWorkflowId)
    || workflowPath(run) !== PREFLIGHT_PATH
    || run.status !== "completed" || run.conclusion !== "failure"
    || run.run_attempt !== 1 || run.head_branch !== "main" || run.event !== "workflow_dispatch"
    || String(run.actor?.id) !== BODYCAST_OWNER_ID || String(run.triggering_actor?.id) !== BODYCAST_OWNER_ID
    || !/^[a-f0-9]{40}$/.test(String(run.head_sha ?? ""))
    || evidence.shaIsAncestorOfCurrentMain !== true
    || !historyRun || String(historyRun.id) !== runId
    || historyRun.head_sha !== run.head_sha || historyRun.workflow_id !== run.workflow_id
    || historyRun.path !== run.path || historyRun.event !== run.event
    || historyRun.status !== run.status || historyRun.conclusion !== run.conclusion
    || historyRun.run_attempt !== run.run_attempt || historyRun.head_branch !== run.head_branch) {
    reject("a later failed preflight retry is not a verified owner authorization-only failure on current-main ancestry.");
  }
  if (evidence.shaIsAncestorOfCurrentMain !== true || evidence.sourceShaIsAncestor !== true) {
    reject("a failed preflight retry is outside the verified source-to-current-main commit ancestry.");
  }
  try {
    assertTrustedOwnerWorkflowRun(run, {
      actorId: BODYCAST_OWNER_ID, workflowPath: PREFLIGHT_PATH, workflowRunId: runId,
      workflowRunAttempt: 1, ref: "refs/heads/main", sha: run.head_sha,
    });
  } catch (error) {
    reject(error.message);
  }
  const jobs = evidence.jobs;
  if (jobs?.total_count !== 2 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 2) {
    reject("a failed preflight retry job inventory is incomplete or unexpected.");
  }
  const contract = evidence.authorizationWorkflowContract;
  if (!contract || contract.sha !== run.head_sha
    || typeof contract.authorizeJobName !== "string" || typeof contract.inspectJobName !== "string"
    || !Array.isArray(contract.authorizeSteps) || contract.authorizeSteps.length < 5) {
    reject("the exact historical preflight workflow does not provide a verified read-only authorization contract.");
  }
  const expectedJobNames = [contract.authorizeJobName, contract.inspectJobName];
  if (new Set(expectedJobNames).size !== expectedJobNames.length
    || jobs.jobs.map((job) => job.name).join("\n") !== expectedJobNames.join("\n")
    || jobs.jobs.some((job) => job.status !== "completed" || job.head_sha !== run.head_sha || job.run_attempt !== 1)) {
    reject("the failed preflight retry jobs do not match the complete historical workflow inventory.");
  }
  const authorize = jobByName(jobs, contract.authorizeJobName, {
    conclusion: "failure", headSha: run.head_sha, attempt: 1,
  });
  const authorizeSteps = authorize.steps ?? [];
  if (authorizeSteps.length !== contract.authorizeSteps.length
    || authorizeSteps.some((step, index) => step.status !== "completed"
      || step.name !== contract.authorizeSteps[index].name
      || step.conclusion !== contract.authorizeSteps[index].conclusion)) {
    reject("a failed preflight retry did not match the complete authorization-job step inventory from its exact workflow SHA.");
  }
  const inspect = jobByName(jobs, contract.inspectJobName, {
    conclusion: "skipped", headSha: run.head_sha, attempt: 1,
  });
  if (!Array.isArray(inspect.steps) || inspect.steps.length !== 0) {
    reject("a failed preflight retry entered the production inspection job.");
  }
  if (evidence.artifacts?.total_count !== 0 || !Array.isArray(evidence.artifacts.artifacts)
    || evidence.artifacts.artifacts.length !== 0) {
    reject("a failed preflight retry unexpectedly published an artifact.");
  }
}

function assertSafeHistoricalNoAppRun(evidence, {
  historyRun, noAppWorkflowId, currentMainSha, isAncestorOfCurrentMain, noAppControlsMatch,
}) {
  const run = evidence?.run;
  const runId = String(run?.id ?? "");
  if (!/^[1-9][0-9]*$/.test(runId)
    || String(run?.workflow_id) !== String(noAppWorkflowId)
    || workflowPath(run) !== NO_APP_PATH
    || run.status !== "completed" || !["success", "failure"].includes(run.conclusion)
    || run.run_attempt !== 1 || run.head_branch !== "main" || run.event !== "workflow_dispatch"
    || !/^[a-f0-9]{40}$/.test(String(run.head_sha ?? ""))
    || (run.display_title ?? run.name) !== `No-app prep ${run.head_sha} unified-v4-republication-v1`
    || String(run.actor?.id) !== BODYCAST_OWNER_ID || String(run.triggering_actor?.id) !== BODYCAST_OWNER_ID
    || run.repository?.full_name !== "krustallik/body-model"
    || String(run.repository?.owner?.id ?? "") !== BODYCAST_OWNER_ID
    || typeof isAncestorOfCurrentMain !== "function" || !isAncestorOfCurrentMain(run.head_sha, currentMainSha)
    || typeof noAppControlsMatch !== "function" || !noAppControlsMatch(run.head_sha, currentMainSha)) {
    reject(`historical no-app run ${runId} is not a pinned-owner run of a reviewed immutable preparation control profile.`);
  }
  assertRunSummaryMatches(historyRun, run);
  try {
    assertTrustedOwnerWorkflowRun(run, {
      actorId: BODYCAST_OWNER_ID, workflowPath: NO_APP_PATH,
      workflowRunId: runId, workflowRunAttempt: 1, ref: "refs/heads/main", sha: run.head_sha,
    });
  } catch (error) {
    reject(error.message);
  }

  const jobs = evidence.jobs;
  if (jobs?.total_count !== 2 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 2
    || jobs.jobs.some((job) => job.head_sha !== run.head_sha || job.run_attempt !== 1)) {
    reject(`historical no-app run ${runId} has an incomplete or substituted job inventory.`);
  }
  const authorize = jobs.jobs.find((job) => job.name === "Authorize exact-main no-app preparation");
  const inspect = jobs.jobs.find((job) => job.name === "Read-only snapshot and isolated backup rehearsal");
  if (!authorize || authorize.conclusion !== "success" || !inspect || inspect.conclusion !== run.conclusion) {
    reject(`historical no-app run ${runId} did not pass its owner gate and expected preparation job.`);
  }
  const authorizationSteps = authorize.steps;
  if (!NO_APP_AUTHORIZATION_JOB_STEP_PROFILES.some((profile) => Array.isArray(authorizationSteps)
    && authorizationSteps.length === profile.length
    && profile.every(([name, conclusion], index) => authorizationSteps[index]?.name === name
      && authorizationSteps[index]?.conclusion === conclusion))) {
    reject(`the no-app authorization job for run ${runId} does not match a reviewed exact step sequence.`);
  }

  const steps = inspect.steps;
  const historyGate = Array.isArray(steps) && NO_APP_INSPECT_HISTORY_STEPS.has(steps[6]?.name) ? steps[6].name : null;
  const requiredStepNames = NO_APP_INSPECT_REQUIRED_STEPS.map((name, index) => index === 6 ? historyGate : name);
  const names = Array.isArray(steps) ? steps.map((step) => step.name) : [];
  const cleanupNames = names.slice(requiredStepNames.length);
  if (!historyGate || names.length < requiredStepNames.length + 1
    || names.slice(0, requiredStepNames.length).some((name, index) => name !== requiredStepNames[index])
    || new Set(names).size !== names.length || names.at(-1) !== "Complete job"
    || cleanupNames.some((name) => !NO_APP_INSPECT_CLEANUP_STEPS.includes(name))
    || cleanupNames.some((name, index) => NO_APP_INSPECT_CLEANUP_STEPS.indexOf(name)
      <= (index === 0 ? -1 : NO_APP_INSPECT_CLEANUP_STEPS.indexOf(cleanupNames[index - 1])))) {
    reject(`historical no-app run ${runId} has an unknown, duplicated, or incomplete preparation step inventory.`);
  }
  const stepByName = new Map(steps.map((step) => [step.name, step.conclusion]));
  const cleanupConclusionAllowed = new Map([
    ["Post Set up pinned Node runtime", new Set(["success", "skipped"])],
    ["Post Checkout current-main release SHA", new Set(["success", "skipped"])],
    ["Post Checkout exact current-main release SHA", new Set(["success", "skipped"])],
    ["Stop containers", new Set(["success", "skipped"])],
    ["Complete job", new Set(["success"])],
  ]);
  for (const step of steps.slice(requiredStepNames.length)) {
    if (!cleanupConclusionAllowed.get(step.name)?.has(step.conclusion)) reject(`historical no-app run ${runId} has an invalid cleanup step result.`);
  }
  const failedSteps = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.conclusion === "failure");
  if (run.conclusion === "success") {
    if (failedSteps.length !== 0 || steps.some((step) => step.conclusion !== "success")) reject(`successful historical no-app run ${runId} has incomplete step results.`);
  } else {
    const allowedFailureNames = new Set([
      "Initialize containers",
      "Verify exact current main and reconcile all capture/intervening workflow evidence",
      "Verify exact main, source run identity, and active production workflows",
      "Create fresh encrypted backup under the host release lock",
      "Recheck exact main and create preparation-only evidence",
    ]);
    if (failedSteps.length !== 1 || !allowedFailureNames.has(failedSteps[0].step.name)) reject(`failed historical no-app run ${runId} has an unknown operation boundary.`);
    for (const { step, index } of steps.map((step, index) => ({ step, index }))) {
      if (index < failedSteps[0].index && step.conclusion !== "success") reject(`failed historical no-app run ${runId} has an incomplete pre-failure gate result.`);
      if (index > failedSteps[0].index
        && !NO_APP_INSPECT_CLEANUP_STEPS.includes(step.name)
        && step.name !== "Remove temporary SSH credentials"
        && step.conclusion !== "skipped") {
        reject(`failed historical no-app run ${runId} continued a preparation operation after failure.`);
      }
    }
  }
  const backupStep = "Create fresh encrypted backup under the host release lock";
  const restoreStep = "Restore backup and verify identity, schema, history, and data on isolated PostgreSQL";
  const rehearsalStep = "Rehearse exact V4 migrations only on isolated PostgreSQL";
  const evidenceStep = "Recheck exact main and create preparation-only evidence";
  const backupIndex = steps.findIndex((step) => step.name === backupStep);
  const restoreIndex = steps.findIndex((step) => step.name === restoreStep);
  const rehearsalIndex = steps.findIndex((step) => step.name === rehearsalStep);
  const evidenceIndex = steps.findIndex((step) => step.name === evidenceStep);
  if (!(backupIndex >= 0 && restoreIndex > backupIndex && rehearsalIndex > restoreIndex && evidenceIndex > rehearsalIndex)) {
    reject(`historical no-app run ${runId} does not preserve the ordered backup/restore/rehearsal/evidence boundary.`);
  }

  const artifacts = evidence.artifacts;
  if (!artifacts || !Array.isArray(artifacts.artifacts) || artifacts.total_count !== artifacts.artifacts.length) {
    reject(`historical no-app run ${runId} has incomplete artifact metadata.`);
  }
  if (run.conclusion === "success") {
    const expectedNames = [
      `bodycast-no-app-backup-${run.head_sha}-unified-v4-republication-v1-${runId}-1`,
      `bodycast-no-app-preparation-${run.head_sha}-unified-v4-republication-v1-${runId}-1`,
    ];
    const actualNames = artifacts.artifacts.map((artifact) => artifact.name);
    if (inspect.conclusion !== "success"
      || artifacts.total_count !== 2 || expectedNames.some((name) => !actualNames.includes(name))
      || artifacts.artifacts.some((artifact) => !Number.isSafeInteger(artifact.id) || artifact.expired !== false
        || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0
        || !/^sha256:[a-f0-9]{64}$/.test(String(artifact.digest ?? "")))) {
      reject(`successful historical no-app run ${runId} lacks its exact immutable preparation artifacts.`);
    }
  } else {
    const failedSteps = steps.filter((step) => step.conclusion === "failure");
    if (inspect.conclusion !== "failure" || failedSteps.length !== 1 || artifacts.total_count !== 0
      || artifacts.artifacts.length !== 0) {
      reject(`failed historical no-app run ${runId} has ambiguous execution or published artifacts.`);
    }
    const failedName = failedSteps[0].name;
    const allowedFailures = new Set([
      "Initialize containers",
      "Verify exact current main and reconcile all capture/intervening workflow evidence",
      "Verify exact main, source run identity, and active production workflows",
      backupStep,
      evidenceStep,
    ]);
    if (!allowedFailures.has(failedName)) reject(`historical no-app run ${runId} failed at an unknown operation boundary.`);
    if (stepByName.get("Remove temporary SSH credentials") !== "success") {
      reject(`historical no-app run ${runId} did not successfully remove temporary SSH credentials.`);
    }
    if (steps.slice(steps.indexOf(failedSteps[0]) + 1).some((step) =>
      step.conclusion === "success" && !["Remove temporary SSH credentials", "Post Set up pinned Node runtime",
        "Post Checkout current-main release SHA", "Post Checkout exact current-main release SHA",
        "Stop containers", "Complete job"].includes(step.name))) {
      reject(`historical no-app run ${runId} continued an operation after its failed boundary.`);
    }
    if (failedName === backupStep && (stepByName.get(restoreStep) !== "skipped"
      || stepByName.get(rehearsalStep) !== "skipped" || stepByName.get(evidenceStep) !== "skipped")) {
      reject(`historical no-app run ${runId} has inconsistent backup failure follow-up steps.`);
    }
    if (failedName === evidenceStep && (stepByName.get(backupStep) !== "success"
      || stepByName.get(restoreStep) !== "success" || stepByName.get(rehearsalStep) !== "success")) {
      reject(`historical no-app run ${runId} has inconsistent post-rehearsal evidence failure steps.`);
    }
  }
}

function assertSafeCaptureBlockedPreflightRetry(evidence, {
  historyRun, preflightWorkflowId, currentMainSha, manifestId, preflightCaptureControlsMatch,
}) {
  const run = evidence?.run;
  const runId = String(run?.id ?? "");
  if (manifestId !== "unified-v4-republication-v1"
    || !/^[1-9][0-9]*$/.test(runId)
    || String(run?.workflow_id) !== String(preflightWorkflowId)
    || workflowPath(run) !== PREFLIGHT_PATH
    || run.status !== "completed" || run.conclusion !== "failure"
    || run.run_attempt !== 1 || run.head_branch !== "main" || run.event !== "workflow_dispatch"
    || String(run.actor?.id) !== BODYCAST_OWNER_ID || String(run.triggering_actor?.id) !== BODYCAST_OWNER_ID
    || !/^[a-f0-9]{40}$/.test(String(run.head_sha ?? ""))
    || (run.display_title ?? run.name) !== `Preflight ${run.head_sha} ${manifestId}`
    || evidence.shaIsAncestorOfCurrentMain !== true || evidence.sourceShaIsAncestor !== true
    || evidence.captureControlsMatch !== true
    || !historyRun || String(historyRun.id) !== runId
    || historyRun.head_sha !== run.head_sha || String(historyRun.workflow_id) !== String(run.workflow_id)
    || historyRun.path !== run.path || (historyRun.display_title ?? historyRun.name) !== (run.display_title ?? run.name) || historyRun.event !== run.event
    || historyRun.status !== run.status || historyRun.conclusion !== run.conclusion
    || historyRun.run_attempt !== run.run_attempt || historyRun.head_branch !== run.head_branch) {
    reject("a later capture-blocked preflight is not a verified owner-only V4 retry on unchanged capture controls.");
  }
  try {
    assertTrustedOwnerWorkflowRun(run, {
      actorId: BODYCAST_OWNER_ID, workflowPath: PREFLIGHT_PATH, workflowRunId: runId,
      workflowRunAttempt: 1, ref: "refs/heads/main", sha: run.head_sha,
    });
  } catch (error) {
    reject(error.message);
  }

  const jobs = evidence.jobs;
  if (jobs?.total_count !== 2 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 2) {
    reject("a capture-blocked preflight job inventory is incomplete or unexpected.");
  }
  jobByName(jobs, "Authorize read-only preflight", { conclusion: "success", headSha: run.head_sha, attempt: 1 });
  const inspect = jobByName(jobs, "Inspect, back up, restore, and rehearse on disposable PostgreSQL", {
    conclusion: "failure", headSha: run.head_sha, attempt: 1,
  });
  const steps = inspect.steps ?? [];
  if (steps.length !== BLOCKED_CAPTURE_RETRY_JOB_STEPS.length
    || steps.some((step, index) => step.name !== BLOCKED_CAPTURE_RETRY_JOB_STEPS[index][0]
      || step.conclusion !== BLOCKED_CAPTURE_RETRY_JOB_STEPS[index][1])) {
    reject("the capture-blocked preflight did not stop at its only reviewed maintenance/capture step.");
  }
  const artifacts = evidence.artifacts;
  if (artifacts?.total_count !== 0 || !Array.isArray(artifacts.artifacts) || artifacts.artifacts.length !== 0) {
    reject("the capture-blocked preflight unexpectedly published an artifact.");
  }

  if (typeof preflightCaptureControlsMatch !== "function"
    || !preflightCaptureControlsMatch(run.head_sha, currentMainSha)) {
    reject("the historical maintenance/capture execution boundary has an unknown control profile.");
  }
  const failedCaptureStep = steps.find((step) => step.name === "Enter maintenance and drain the old app before backup");
  const captureStepStartedAt = Date.parse(failedCaptureStep?.started_at);
  const captureStepCompletedAt = Date.parse(failedCaptureStep?.completed_at);
  const captureLogRecords = String(evidence.failureLogText ?? "").split(/\r?\n/).filter(Boolean).map((line) => line.split("\t"));
  const captureLogTokens = captureLogRecords.map(([, , token]) => token);
  const knownCaptureStops = captureLogTokens.filter((token) => [
    PRIOR_CAPTURE_FAILURE, "Capture refresh requires exactly one existing BodyCast app container.",
  ].includes(token));
  const forbiddenCaptureEvidence = new Set([
    "Traffic is in maintenance mode; the old app container is removed", "BODYCAST_BACKUP_STARTED_AT", "BODYCAST_PGDUMP_INVOCATION_AT",
  ]);
  if (captureLogRecords.length === 0
    || !Number.isFinite(captureStepStartedAt) || !Number.isFinite(captureStepCompletedAt)
    || captureLogRecords.some(([stepName, timestamp, token, extra]) => {
      const logAt = Date.parse(timestamp);
      const logSecond = Math.floor(logAt / 1_000);
      return stepName !== "Enter maintenance and drain the old app before backup" || !token || extra !== undefined
        || !Number.isFinite(logAt) || logSecond < Math.floor(captureStepStartedAt / 1_000)
        || logSecond > Math.floor(captureStepCompletedAt / 1_000);
    })
    || knownCaptureStops.length !== 1 || captureLogTokens.at(-1) !== knownCaptureStops[0]
    || captureLogTokens.some((token) => forbiddenCaptureEvidence.has(token))) {
    reject("the capture retry log does not prove a unique terminal stop in the failed maintenance step.");
  }
  return Object.freeze({ runId, sha: run.head_sha, historicalEffects: "UNVERIFIED" });
}

function assertMigrationRun(run, { runId, workflowId, sha }) {
  if (String(run?.id) !== String(runId) || String(run?.workflow_id) !== String(workflowId)
    || workflowPath(run) !== MIGRATION_PATH || run.status !== "completed" || run.conclusion !== "failure"
    || run.run_attempt !== 1 || run.head_branch !== "main" || run.event !== "workflow_dispatch"
    || run.head_sha !== sha) {
    reject("the migration attempt identity, failed result, SHA, or original attempt does not match.");
  }
  try {
    assertTrustedOwnerWorkflowRun(run, {
      actorId: BODYCAST_OWNER_ID, workflowPath: MIGRATION_PATH, workflowRunId: runId,
      workflowRunAttempt: 1, ref: "refs/heads/main", sha,
    });
  } catch (error) {
    reject(error.message);
  }
}

function assertSuccessfulPreflightArtifacts(artifacts, sha, runId) {
  const expected = new Set([
    `bodycast-backup-${sha}-active-energy-unified-v2-${runId}-1`,
    `bodycast-preflight-evidence-${sha}-active-energy-unified-v2-${runId}-1`,
  ]);
  const actual = artifacts?.artifacts ?? [];
  if (artifacts?.total_count !== expected.size || actual.length !== expected.size
    || actual.some((artifact) => !expected.delete(artifact.name)
      || artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0
      || !/^sha256:[a-f0-9]{64}$/.test(String(artifact.digest ?? ""))) || expected.size !== 0) {
    reject("the successful source preflight backup/evidence artifacts are missing, expired, or malformed.");
  }
}

/**
 * Resume a durable previous-app capture only for the narrowly verified incident
 * where a successful owner preflight was followed by the known final-guard
 * import failure before the DDL marker, then a retry republished and publicly
 * confirmed maintenance before stopping at the existing capture guard. No
 * old-app stop or DB inspection follows that capture failure. The host still performs fresh marker, maintenance, app,
 * writer-drain, DB identity/history/schema, and immutable-image checks before
 * rebinding. This proof does not reuse the old backup; the current preflight
 * must create a new backup and pass a new isolated restore rehearsal.
 */
export function verifyPreDdlMigrationFailureResume({
  sourceRun, sourceJobs, sourceArtifacts,
  migrationRun, migrationJobs, migrationLogText,
  blockedCaptureRun, blockedCaptureJobs, blockedCaptureArtifacts, blockedCaptureLogText,
  laterRuns, safeFailedPreflightRetries, sourceRunId, migrationRunId, blockedCaptureRunId, currentRunId, currentMainSha,
  preflightWorkflowId, migrationWorkflowId, sourceIsAncestor, sourceIsAncestorOfBlockedCapture,
  blockedCaptureIsAncestorOfCurrentMain,
}) {
  if (!/^[1-9][0-9]*$/.test(String(currentRunId ?? ""))
    || !/^[a-f0-9]{40}$/.test(String(currentMainSha ?? ""))) {
    reject("run identifiers or current main SHA are malformed.");
  }
  const sourceSha = sourceRun?.head_sha;
  assertPreflightRun(sourceRun, { runId: sourceRunId, workflowId: preflightWorkflowId, sha: sourceSha, conclusion: "success" });
  if (!/^[a-f0-9]{40}$/.test(String(sourceSha ?? "")) || sourceIsAncestor !== true) {
    reject("the successful source preflight SHA is malformed or is not an ancestor of current main.");
  }
  const sourceJobInventory = sourceJobs?.jobs;
  if (sourceJobs?.total_count !== 2 || !Array.isArray(sourceJobInventory) || sourceJobInventory.length !== 2) {
    reject("the successful source preflight job inventory is incomplete or unexpected.");
  }
  jobByName(sourceJobs, "Authorize read-only preflight", { conclusion: "success", headSha: sourceSha, attempt: 1 });
  const sourceInspect = jobByName(sourceJobs,
    "Inspect, back up, restore, and rehearse on disposable PostgreSQL", { conclusion: "success", headSha: sourceSha, attempt: 1 });
  assertStepResults(sourceInspect, SUCCESSFUL_PREFLIGHT_STEPS, "source preflight");
  assertSuccessfulPreflightArtifacts(sourceArtifacts, sourceSha, String(sourceRunId));

  assertMigrationRun(migrationRun, { runId: migrationRunId, workflowId: migrationWorkflowId, sha: sourceSha });
  if (!Number.isSafeInteger(migrationRun?.run_attempt) || migrationRun.run_attempt !== 1) reject("migration attempt reruns cannot support capture resumption.");
  if (migrationJobs?.total_count !== 3 || !Array.isArray(migrationJobs.jobs) || migrationJobs.jobs.length !== 3) {
    reject("the failed migration job inventory is incomplete or unexpected.");
  }
  jobByName(migrationJobs, "Select latest exact preflight evidence", { conclusion: "success", headSha: sourceSha, attempt: 1 });
  jobByName(migrationJobs, "Sign migration authorization envelope", { conclusion: "success", headSha: sourceSha, attempt: 1 });
  const migrationExecution = jobByName(migrationJobs, "Final live guard and authorized migration", {
    conclusion: "failure", headSha: sourceSha, attempt: 1,
  });
  assertStepResults(migrationExecution, MIGRATION_PRE_DDL_STEPS, "migration execution");
  const logRecords = parseActionLogRecords(migrationLogText);
  const importFailure = normalizeActionLog(MIGRATION_PRE_DDL_FAILURE);
  const writerDrainMarker = normalizeActionLog(WRITER_DRAIN_READY_MARKER);
  const evidenceRecords = logRecords.filter((record) =>
    isExpectedMigrationEvidenceRecord(record, migrationExecution, importFailure, writerDrainMarker));
  const otherRecords = logRecords.filter((record) => !evidenceRecords.includes(record));
  const normalizedEvidenceLog = normalizeActionLog(evidenceRecords.map((record) => record.text).join("\n"));
  const normalizedOtherLogs = normalizeActionLog(otherRecords.map((record) => record.text).join("\n"));
  const failurePositions = findAllOccurrences(normalizedEvidenceLog, importFailure);
  const writerDrainReadyPosition = normalizedEvidenceLog.indexOf(writerDrainMarker);
  const failuresOutsideMigrationStep = findAllOccurrences(normalizedOtherLogs, importFailure).length;
  const writerDrainOutsideMigrationStep = findAllOccurrences(normalizedOtherLogs, writerDrainMarker).length;
  const failedSteps = (migrationExecution.steps ?? []).filter((step) => step.conclusion === "failure").map((step) => step.name);
  if (failurePositions.length !== 3 || failuresOutsideMigrationStep !== 0 || writerDrainOutsideMigrationStep !== 0
    || findAllOccurrences(normalizedEvidenceLog, writerDrainMarker).length !== 1
    || failedSteps.length !== 1 || failedSteps[0] !== MIGRATION_FAILURE_STEP) {
    const observedMarkerRecordLabels = logRecords.flatMap((record) => {
      const normalizedRecord = normalizeActionLog(record.text);
      const importFailureOccurrences = findAllOccurrences(normalizedRecord, importFailure).length;
      const writerDrainOccurrences = findAllOccurrences(normalizedRecord, writerDrainMarker).length;
      if (importFailureOccurrences === 0 && writerDrainOccurrences === 0) return [];
      return [{
        job: sanitizeActionLogLabel(record.job),
        step: sanitizeActionLogLabel(record.step),
        importFailureOccurrences,
        writerDrainOccurrences,
      }];
    }).slice(0, 8);
    const diagnostics = {
      parsedLogRecords: logRecords.length,
      fixedMigrationStepRecords: evidenceRecords.length,
      knownImportFailuresInFixedStep: failurePositions.length,
      knownImportFailuresOutsideFixedStep: failuresOutsideMigrationStep,
      writerDrainMarkersInFixedStep: findAllOccurrences(normalizedEvidenceLog, writerDrainMarker).length,
      writerDrainMarkersOutsideFixedStep: writerDrainOutsideMigrationStep,
      failedMigrationSteps: failedSteps.length,
      onlyExpectedMigrationStepFailed: failedSteps.length === 1 && failedSteps[0] === MIGRATION_FAILURE_STEP,
      observedMarkerRecordLabels,
    };
    reject(`the migration log does not show exactly three known import failures in the fixed migration step (sanitized evidence counts: ${JSON.stringify(diagnostics)}).`);
  }
  if (!(failurePositions[0] < failurePositions[1]
    && failurePositions[1] < writerDrainReadyPosition && writerDrainReadyPosition < failurePositions[2])) {
    reject("the two failed live probes, successful writer-drain observation, and final-guard import failure are not in the reviewed order.");
  }

  const blockedCaptureSha = blockedCaptureRun?.head_sha;
  assertPreflightRun(blockedCaptureRun, {
    runId: blockedCaptureRunId, workflowId: preflightWorkflowId, sha: blockedCaptureSha, conclusion: "failure",
  });
  if (!/^[a-f0-9]{40}$/.test(String(blockedCaptureSha ?? ""))
    || sourceIsAncestorOfBlockedCapture !== true || blockedCaptureIsAncestorOfCurrentMain !== true) {
    reject("the blocked capture retry SHA is not on the verified source-to-current-main ancestry chain.");
  }
  if (blockedCaptureJobs?.total_count !== 2 || !Array.isArray(blockedCaptureJobs.jobs) || blockedCaptureJobs.jobs.length !== 2) {
    reject("the capture-blocked preflight job inventory is incomplete or unexpected.");
  }
  jobByName(blockedCaptureJobs, "Authorize read-only preflight", { conclusion: "success", headSha: blockedCaptureSha, attempt: 1 });
  const blockedInspect = jobByName(blockedCaptureJobs,
    "Inspect, back up, restore, and rehearse on disposable PostgreSQL", { conclusion: "failure", headSha: blockedCaptureSha, attempt: 1 });
  assertStepResults(blockedInspect, BLOCKED_CAPTURE_PREFLIGHT_STEPS, "capture-blocked preflight");
  if (blockedCaptureArtifacts?.total_count !== 0 || (blockedCaptureArtifacts?.artifacts ?? []).length !== 0
    || !String(blockedCaptureLogText ?? "").includes(PRIOR_CAPTURE_FAILURE)) {
    reject("the later preflight did not stop at the existing capture guard without publishing artifacts.");
  }

  const sourceId = BigInt(String(sourceRunId));
  const migrationId = BigInt(String(migrationRunId));
  const blockedId = BigInt(String(blockedCaptureRunId));
  const currentId = BigInt(String(currentRunId));
  if (!(sourceId < migrationId && migrationId < blockedId && blockedId < currentId)) {
    reject("the verified workflow runs are not in the expected source → failed migration → blocked retry order.");
  }
  const laterRunById = new Map();
  for (const run of laterRuns ?? []) {
    const id = String(run?.id ?? "");
    if (!/^[1-9][0-9]*$/.test(id)) reject("later production workflow history contains a malformed run identifier.");
    if (laterRunById.has(id)) reject("later production workflow history contains a duplicate run.");
    laterRunById.set(id, run);
  }
  const safeRetryById = new Map();
  for (const evidence of safeFailedPreflightRetries ?? []) {
    const id = String(evidence?.run?.id ?? "");
    if (safeRetryById.has(id)) reject("failed preflight retry evidence contains a duplicate run.");
    safeRetryById.set(id, evidence);
  }
  const allowedIds = new Set([String(migrationRunId), String(blockedCaptureRunId)]);
  const verifiedRetryIds = new Set();
  for (const run of laterRuns ?? []) {
    const id = BigInt(String(run.id));
    if (!MUTATION_WORKFLOW_PATHS.has(workflowPath(run)) || id <= sourceId || id === currentId) continue;
    if (allowedIds.delete(String(run.id))) continue;
    if (workflowPath(run) === PREFLIGHT_PATH) {
      const retryEvidence = safeRetryById.get(String(run.id));
      if (!retryEvidence) reject(`an unexpected production mutation workflow exists after source preflight ${sourceRunId}.`);
      assertSafeAuthorizationOnlyPreflightRetry(retryEvidence, {
        preflightWorkflowId, historyRun: laterRunById.get(String(run.id)),
      });
      verifiedRetryIds.add(String(run.id));
      continue;
    }
    reject(`an unexpected production mutation workflow exists after source preflight ${sourceRunId}.`);
  }
  if (allowedIds.size !== 0) reject("one or more verified production workflow runs are absent from the complete history.");
  if (verifiedRetryIds.size !== safeRetryById.size) reject("failed preflight retry evidence does not match the complete workflow history.");

  return Object.freeze({
    schemaVersion: 2,
    resumeKind: "verified-pre-ddl-migration-failure",
    sourceRunId: String(sourceRun.id),
    sourceRunAttempt: 1,
    sourceSha,
    targetSha: currentMainSha,
    migrationFailureRunId: String(migrationRun.id),
    blockedCaptureRunId: String(blockedCaptureRun.id),
  });
}

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const isAncestor = (ancestor, descendant) => {
    try { execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { stdio: "ignore" }); return true; } catch { return false; }
  };
  if (mode === "--verify-pre-ddl-migration-failure" && args.length === 19) {
    const [sourceRunPath, sourceJobsPath, sourceArtifactsPath, migrationRunPath, migrationJobsPath, migrationLogPath,
      blockedRunPath, blockedJobsPath, blockedArtifactsPath, blockedLogPath, laterRunsPath, safeRetriesPath, sourceRunId,
      migrationRunId, blockedCaptureRunId, currentRunId, currentMainSha, preflightWorkflowId, migrationWorkflowId] = args;
    const [sourceRun, sourceJobs, sourceArtifacts, migrationRun, migrationJobs, migrationLogText, blockedCaptureRun,
      blockedCaptureJobs, blockedCaptureArtifacts, blockedCaptureLogText, laterRunsText, safeRetriesText] = await Promise.all([
      readJson(sourceRunPath), readJson(sourceJobsPath), readJson(sourceArtifactsPath), readJson(migrationRunPath),
      readJson(migrationJobsPath), readFile(migrationLogPath, "utf8"), readJson(blockedRunPath), readJson(blockedJobsPath),
      readJson(blockedArtifactsPath), readFile(blockedLogPath, "utf8"), readFile(path.resolve(laterRunsPath), "utf8"),
      readFile(path.resolve(safeRetriesPath), "utf8"),
    ]);
    const sourceIsAncestor = isAncestor(sourceRun.head_sha, currentMainSha);
    const sourceIsAncestorOfBlockedCapture = isAncestor(sourceRun.head_sha, blockedCaptureRun.head_sha);
    const blockedCaptureIsAncestorOfCurrentMain = isAncestor(blockedCaptureRun.head_sha, currentMainSha);
    const safeFailedPreflightRetries = parseNdjson(safeRetriesText).map((evidence) => ({
      ...evidence,
      shaIsAncestorOfCurrentMain: isAncestor(evidence?.run?.head_sha, currentMainSha),
      sourceShaIsAncestor: isAncestor(sourceRun.head_sha, evidence?.run?.head_sha),
      authorizationWorkflowContract: preflightAuthorizationWorkflowContractAtSha(evidence?.run?.head_sha),
    }));
    const proof = verifyPreDdlMigrationFailureResume({ sourceRun, sourceJobs, sourceArtifacts, migrationRun, migrationJobs,
      migrationLogText, blockedCaptureRun, blockedCaptureJobs, blockedCaptureArtifacts, blockedCaptureLogText,
      laterRuns: parseNdjson(laterRunsText), safeFailedPreflightRetries, sourceRunId, migrationRunId, blockedCaptureRunId, currentRunId,
      currentMainSha, preflightWorkflowId, migrationWorkflowId, sourceIsAncestor,
      sourceIsAncestorOfBlockedCapture, blockedCaptureIsAncestorOfCurrentMain });
    process.stdout.write(`${JSON.stringify(proof)}\n`);
    return;
  }
  if (mode !== "--verify-source" || args.length !== 14) {
    throw new Error("Usage: production-preflight-resume.mjs --verify-source <run.json> <jobs.json> <artifacts.json> <later-runs.ndjson> <safe-failed-deploy-runs.ndjson> <safe-failed-preflight-retries.ndjson> <safe-historical-no-app-runs.ndjson> <source-run-id> <current-run-id> <current-main-sha> <manifest-id> <preflight-workflow-id> <deploy-workflow-id> <no-app-workflow-id>");
  }
  const [runPath, jobsPath, artifactsPath, laterRunsPath, safeDeployRunsPath, safePreflightRetriesPath,
    safeNoAppRunsPath, sourceRunId, currentRunId, currentMainSha, manifestId, workflowId, deployWorkflowId, noAppWorkflowId] = args;
  const [sourceRun, sourceJobs, sourceArtifacts, laterRunsText, safeDeployRunsText, safePreflightRetriesText, safeNoAppRunsText] = await Promise.all([
    readJson(runPath), readJson(jobsPath), readJson(artifactsPath), readFile(path.resolve(laterRunsPath), "utf8"),
    readFile(path.resolve(safeDeployRunsPath), "utf8"), readFile(path.resolve(safePreflightRetriesPath), "utf8"),
    readFile(path.resolve(safeNoAppRunsPath), "utf8"),
  ]);
  let sourceIsAncestor = false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sourceRun.head_sha, currentMainSha], { stdio: "ignore" });
    sourceIsAncestor = true;
  } catch {}
  const proof = verifyResumablePreflightAttempt({
    sourceRun, sourceJobs, sourceArtifacts, laterRuns: parseNdjson(laterRunsText),
    safeFailedDeployRuns: parseNdjson(safeDeployRunsText).map((evidence) => ({
      ...evidence,
      shaIsAncestorOfCurrentMain: isAncestor(evidence?.run?.head_sha, currentMainSha),
    })),
    safeHistoricalNoAppRuns: parseNdjson(safeNoAppRunsText).map((evidence) => ({
      ...evidence,
      shaIsAncestorOfCurrentMain: isAncestor(evidence?.run?.head_sha, currentMainSha),
    })),
    safeFailedPreflightRetries: parseNdjson(safePreflightRetriesText).map((evidence) => ({
      ...evidence,
      shaIsAncestorOfCurrentMain: isAncestor(evidence?.run?.head_sha, currentMainSha),
      sourceShaIsAncestor: isAncestor(sourceRun.head_sha, evidence?.run?.head_sha),
      authorizationWorkflowContract: preflightAuthorizationWorkflowContractAtSha(evidence?.run?.head_sha),
      captureControlsMatch: preflightCaptureResumeControlsMatch(evidence?.run?.head_sha, currentMainSha),
    })),
    sourceRunId, currentRunId, currentMainSha, manifestId, workflowId, deployWorkflowId, noAppWorkflowId, sourceIsAncestor,
  });
  process.stdout.write(`${JSON.stringify(proof)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
