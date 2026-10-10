import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA = "62b6961dde7036100c8af7281e7bfab75bb662db";
export const SCHEMA_DEPLOY_HANDOFF_PROVENANCE = Object.freeze({
  manifestId: "active-energy-unified-v2",
  workflowRunId: "38069108209",
  workflowRunAttempt: 1,
  authorizationId: "123dcfca-64a4-4708-8c3a-3a9f59ed5412",
  lineageDigest: "877d195c9600f760d821eeb8f6f770e307292671a94e549e46dca8c344ee3e2e",
  spawnState: "started",
});

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const V3_STATES = new Set(["schema-applied", "app-ready", "v4-ready", "database-restored", "rollback-app-ready"]);
const DENIED_PATH = /^(?:prisma\/|src\/|public\/|scripts\/unified-v[34]|scripts\/physiology|Dockerfile$|docker-compose(?:\.prod)?\.yml$|package(?:-lock)?\.json$|next\.config\.[^/]+$|tsconfig(?:\.[^/]+)?\.json$)/;
const ALLOWED_PATH = /^(?:\.github\/workflows\/|tests\/|scripts\/deploy\.sh$|scripts\/production-release-marker\.(?:sh|mjs)$|scripts\/production-schema-deploy-handoff\.mjs$|scripts\/production-traffic-cutover\.sh$)/;
const CRITICAL_TREES = ["prisma", "src"];
const CRITICAL_FILES = ["Dockerfile", "docker-compose.prod.yml", "package.json", "package-lock.json"];

function reject(message) {
  throw new Error(`Schema deploy handoff blocked: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function field(line, key) {
  const prefix = `${key}=`;
  if (!line.startsWith(prefix)) reject(`marker field ${key} is not canonical`);
  return line.slice(prefix.length);
}

export function parseSchemaDeployMarker(text) {
  const bytes = Buffer.from(String(text ?? ""), "utf8");
  if (bytes.length === 0 || bytes.length > 4096) reject("marker is missing or oversized");
  const lines = bytes.toString("utf8").replace(/\n$/, "").split("\n");
  if (lines.length === 9 && lines[0] === "schemaVersion=2") {
    const marker = {
      schemaVersion: 2,
      manifestId: field(lines[1], "manifestId"),
      releaseSha: field(lines[2], "releaseSha"),
      state: field(lines[3], "state"),
      workflowRunId: field(lines[4], "workflowRunId"),
      workflowRunAttempt: Number(field(lines[5], "workflowRunAttempt")),
      authorizationId: field(lines[6], "authorizationId"),
      lineageDigest: field(lines[7], "lineageDigest"),
      spawnState: field(lines[8], "spawnState"),
    };
    return { marker, digest: sha256(bytes), bytes };
  }
  if (lines.length === 12 && lines[0] === "schemaVersion=3") {
    const marker = {
      schemaVersion: 3,
      manifestId: field(lines[1], "manifestId"),
      migrationOriginSha: field(lines[2], "migrationOriginSha"),
      deploySha: field(lines[3], "deploySha"),
      state: field(lines[4], "state"),
      workflowRunId: field(lines[5], "workflowRunId"),
      workflowRunAttempt: Number(field(lines[6], "workflowRunAttempt")),
      authorizationId: field(lines[7], "authorizationId"),
      lineageDigest: field(lines[8], "lineageDigest"),
      spawnState: field(lines[9], "spawnState"),
      sourceMarkerDigest: field(lines[10], "sourceMarkerDigest"),
      compatibilityDigest: field(lines[11], "compatibilityDigest"),
    };
    return { marker, digest: sha256(bytes), bytes };
  }
  reject("marker schema is not an admitted migration or deploy handoff");
}

function provenanceMatches(marker) {
  const pinned = SCHEMA_DEPLOY_HANDOFF_PROVENANCE;
  return marker.manifestId === pinned.manifestId
    && marker.workflowRunId === pinned.workflowRunId
    && marker.workflowRunAttempt === pinned.workflowRunAttempt
    && marker.authorizationId === pinned.authorizationId
    && marker.lineageDigest === pinned.lineageDigest
    && marker.spawnState === pinned.spawnState;
}

export function compatibilityDigest(input) {
  return sha256(Buffer.from(JSON.stringify({
    migrationOriginSha: input.migrationOriginSha,
    deploySha: input.deploySha,
    changedPaths: [...input.changedPaths].sort(),
    criticalObjects: input.criticalObjects,
  }), "utf8"));
}

export function serializeSchemaDeployHandoff(marker) {
  const text = [
    "schemaVersion=3",
    `manifestId=${marker.manifestId}`,
    `migrationOriginSha=${marker.migrationOriginSha}`,
    `deploySha=${marker.deploySha}`,
    `state=${marker.state}`,
    `workflowRunId=${marker.workflowRunId}`,
    `workflowRunAttempt=${marker.workflowRunAttempt}`,
    `authorizationId=${marker.authorizationId}`,
    `lineageDigest=${marker.lineageDigest}`,
    `spawnState=${marker.spawnState}`,
    `sourceMarkerDigest=${marker.sourceMarkerDigest}`,
    `compatibilityDigest=${marker.compatibilityDigest}`,
  ].join("\n") + "\n";
  const parsed = parseSchemaDeployMarker(text);
  if (parsed.marker.schemaVersion !== 3 || parsed.marker.migrationOriginSha !== marker.migrationOriginSha
    || parsed.marker.deploySha !== marker.deploySha || parsed.marker.state !== marker.state) {
    reject("serialized handoff did not round-trip");
  }
  return Buffer.from(text, "utf8");
}

export function evaluateSchemaDeployHandoff({ markerText, deploySha, changedPaths, isAncestor, criticalObjects }) {
  if (!SHA.test(String(deploySha ?? ""))) reject("deploy candidate SHA is malformed");
  const observed = parseSchemaDeployMarker(markerText);
  const marker = observed.marker;
  if (!provenanceMatches(marker)) reject("marker authorization, lineage, or migration provenance does not match the admitted release");
  if (marker.schemaVersion === 3) {
    if (marker.migrationOriginSha !== SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA || !V3_STATES.has(marker.state)
      || marker.spawnState !== "started" || !DIGEST.test(marker.sourceMarkerDigest) || !DIGEST.test(marker.compatibilityDigest)) {
      reject("existing handoff provenance is malformed");
    }
    const recomputed = compatibilityDigest({
      migrationOriginSha: marker.migrationOriginSha,
      deploySha: marker.deploySha,
      changedPaths,
      criticalObjects,
    });
    if (marker.deploySha !== deploySha || marker.compatibilityDigest !== recomputed || isAncestor !== true) {
      reject("existing handoff does not match this deploy candidate");
    }
    return { action: "replay", marker, sourceDigest: observed.digest, compatibilityDigest: recomputed };
  }
  if (marker.schemaVersion !== 2 || marker.state !== "schema-applied" || marker.releaseSha !== SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA) {
    reject("only the admitted schema-applied migration origin can be handed off");
  }
  if (deploySha === marker.releaseSha) return { action: "not-needed", marker, sourceDigest: observed.digest };
  if (isAncestor !== true) reject("deploy candidate is not a descendant of the migration origin");
  if (!Array.isArray(changedPaths) || !criticalObjects || typeof criticalObjects !== "object" || Array.isArray(criticalObjects)) {
    reject("compatibility evidence is incomplete");
  }
  for (const changed of changedPaths) {
    if (typeof changed !== "string" || changed.length === 0 || DENIED_PATH.test(changed) || !ALLOWED_PATH.test(changed)) {
      reject(`path ${changed} is outside the reviewed deploy compatibility allowlist`);
    }
  }
  const digest = compatibilityDigest({
    migrationOriginSha: marker.releaseSha,
    deploySha,
    changedPaths,
    criticalObjects,
  });
  const next = {
    manifestId: marker.manifestId,
    migrationOriginSha: marker.releaseSha,
    deploySha,
    state: "schema-applied",
    workflowRunId: marker.workflowRunId,
    workflowRunAttempt: marker.workflowRunAttempt,
    authorizationId: marker.authorizationId,
    lineageDigest: marker.lineageDigest,
    spawnState: marker.spawnState,
    sourceMarkerDigest: observed.digest,
    compatibilityDigest: digest,
  };
  return { action: "write", marker: next, sourceDigest: observed.digest, compatibilityDigest: digest, bytes: serializeSchemaDeployHandoff(next) };
}

export function renderSchemaDeployTransition(markerText, state) {
  const observed = parseSchemaDeployMarker(markerText);
  if (observed.marker.schemaVersion !== 3 || !V3_STATES.has(state)) reject("transition is not a schema-deploy handoff state");
  return serializeSchemaDeployHandoff({ ...observed.marker, state });
}

function git(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function objectId(repo, sha, objectPath) {
  try {
    return git(repo, ["rev-parse", `${sha}:${objectPath}`]);
  } catch {
    reject(`required object ${objectPath} is absent at ${sha}`);
  }
}

export function readGitCompatibility(repo, deploySha) {
  if (!SHA.test(deploySha)) reject("deploy candidate SHA is malformed");
  const origin = SCHEMA_DEPLOY_MIGRATION_ORIGIN_SHA;
  try {
    git(repo, ["cat-file", "-e", `${origin}^{commit}`]);
    git(repo, ["cat-file", "-e", `${deploySha}^{commit}`]);
  } catch {
    reject("migration origin or deploy candidate commit is unavailable");
  }
  let isAncestor = false;
  try {
    git(repo, ["merge-base", "--is-ancestor", origin, deploySha]);
    isAncestor = true;
  } catch {
    isAncestor = false;
  }
  const changedPaths = git(repo, ["diff", "--name-only", "--no-renames", origin, deploySha])
    .split("\n").filter(Boolean);
  const criticalObjects = {};
  for (const objectPath of [...CRITICAL_TREES, ...CRITICAL_FILES]) {
    const originId = objectId(repo, origin, objectPath);
    const deployId = objectId(repo, deploySha, objectPath);
    if (originId !== deployId) reject(`${objectPath} differs from the migration origin`);
    criticalObjects[objectPath] = originId;
  }
  return { changedPaths, isAncestor, criticalObjects };
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function applySchemaDeployHandoff({ markerPath, deploySha, repo, beforeRename }) {
  const directory = path.dirname(path.resolve(markerPath));
  const details = await lstat(markerPath);
  if (!details.isFile() || details.isSymbolicLink()) reject("marker path is not a regular file");
  const compatibility = readGitCompatibility(repo, deploySha);
  const current = parseSchemaDeployMarker(await readFile(markerPath));
  const plan = evaluateSchemaDeployHandoff({ markerText: current.bytes, deploySha, ...compatibility });
  if (plan.action !== "write") return plan;
  const lockPath = `${markerPath}.lock`;
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error?.code === "EEXIST") reject("another schema deploy handoff is already active or interrupted");
    throw error;
  });
  const temporary = path.join(directory, `.marker.handoff.${process.pid}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(plan.bytes);
      await handle.sync();
    } finally { await handle.close(); }
    if (beforeRename) await beforeRename();
    const latest = parseSchemaDeployMarker(await readFile(markerPath));
    if (latest.digest !== plan.sourceDigest) reject("marker changed during compatibility handoff");
    await rename(temporary, markerPath);
    await fsyncDirectory(directory);
    return { ...plan, digest: sha256(plan.bytes) };
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

async function main() {
  const [mode, markerPath, second, third] = process.argv.slice(2);
  if (mode === "--check" || mode === "--apply") {
    const deploySha = second;
    const repo = third || process.cwd();
    if (mode === "--check") {
      const compatibility = readGitCompatibility(repo, deploySha);
      evaluateSchemaDeployHandoff({ markerText: await readFile(markerPath), deploySha, ...compatibility });
      return;
    }
    await applySchemaDeployHandoff({ markerPath, deploySha, repo });
    return;
  }
  if (mode === "--render-transition") {
    process.stdout.write(renderSchemaDeployTransition(await readFile(markerPath), second));
    return;
  }
  reject(`unknown mode ${mode ?? ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
