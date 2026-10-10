import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const RUN_ID = /^[1-9][0-9]*$/;
const MARKER_NAME = "marker";
const STATES = new Set([
  "ddl-starting", "ddl-started", "schema-applied", "app-ready", "v4-ready",
  "database-restored", "rollback-app-ready", "forward-resume-armed",
]);

export function parseProductionReleaseMarker(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 4096) throw new Error("release marker is missing or oversized");
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length === 4 && lines[0] === "schemaVersion=1") {
    const [manifestId, releaseSha, state] = lines.slice(1).map((line, index) => {
      const key = ["manifestId", "releaseSha", "state"][index] + "=";
      if (!line.startsWith(key)) throw new Error("legacy release marker fields are not canonical");
      return line.slice(key.length);
    });
    if (manifestId !== "active-energy-unified-v2" || !SHA.test(releaseSha)
      || !new Set(["ddl-started", "schema-applied", "app-ready", "v4-ready", "database-restored", "rollback-app-ready"]).has(state)) {
      throw new Error("legacy release marker values are invalid");
    }
    return Object.freeze({ schemaVersion: 1, manifestId, releaseSha, state, workflowRunId: null,
      workflowRunAttempt: null, authorizationId: null, lineageDigest: null, spawnState: null });
  }
  const keys = ["schemaVersion", "manifestId", "releaseSha", "state", "workflowRunId", "workflowRunAttempt",
    "authorizationId", "lineageDigest", "spawnState"];
  if (lines.length !== keys.length || lines[0] !== "schemaVersion=2") throw new Error("release marker schema is unsupported");
  const values = {};
  for (let i = 1; i < keys.length; i += 1) {
    const prefix = `${keys[i]}=`;
    if (!lines[i].startsWith(prefix)) throw new Error("release marker fields are not canonical");
    values[keys[i]] = lines[i].slice(prefix.length);
  }
  const marker = {
    schemaVersion: 2,
    manifestId: values.manifestId,
    releaseSha: values.releaseSha,
    state: values.state,
    workflowRunId: values.workflowRunId,
    workflowRunAttempt: Number(values.workflowRunAttempt),
    authorizationId: values.authorizationId,
    lineageDigest: values.lineageDigest,
    spawnState: values.spawnState,
  };
  if (marker.manifestId !== "active-energy-unified-v2" || !SHA.test(marker.releaseSha) || !STATES.has(marker.state)
    || !RUN_ID.test(marker.workflowRunId) || !Number.isSafeInteger(marker.workflowRunAttempt) || marker.workflowRunAttempt < 1
    || !/^[A-Za-z0-9-]{16,80}$/.test(marker.authorizationId) || !DIGEST.test(marker.lineageDigest)
    || !new Set(["not-started", "started"]).has(marker.spawnState)) {
    throw new Error("release marker values are invalid");
  }
  if (marker.state === "ddl-starting" && marker.spawnState !== "not-started") throw new Error("ddl-starting marker has an invalid spawn state");
  if (["ddl-started", "schema-applied", "app-ready", "v4-ready"].includes(marker.state) && marker.spawnState !== "started") {
    throw new Error("post-spawn marker lacks durable spawn acknowledgement");
  }
  return Object.freeze(marker);
}

function serializeMarker(marker) {
  const normalized = {
    schemaVersion: 2,
    manifestId: "active-energy-unified-v2",
    releaseSha: marker.releaseSha,
    state: marker.state,
    workflowRunId: String(marker.workflowRunId),
    workflowRunAttempt: Number(marker.workflowRunAttempt),
    authorizationId: String(marker.authorizationId),
    lineageDigest: marker.lineageDigest,
    spawnState: marker.spawnState,
  };
  if (!SHA.test(normalized.releaseSha) || !STATES.has(normalized.state) || !RUN_ID.test(normalized.workflowRunId)
    || !Number.isSafeInteger(normalized.workflowRunAttempt) || normalized.workflowRunAttempt < 1
    || !/^[A-Za-z0-9-]{16,80}$/.test(normalized.authorizationId) || !DIGEST.test(normalized.lineageDigest)
    || !new Set(["not-started", "started"]).has(normalized.spawnState)) throw new Error("refusing malformed release marker values");
  const text = [
    "schemaVersion=2", `manifestId=${normalized.manifestId}`, `releaseSha=${normalized.releaseSha}`,
    `state=${normalized.state}`, `workflowRunId=${normalized.workflowRunId}`,
    `workflowRunAttempt=${normalized.workflowRunAttempt}`, `authorizationId=${normalized.authorizationId}`,
    `lineageDigest=${normalized.lineageDigest}`, `spawnState=${normalized.spawnState}`,
  ].join("\n") + "\n";
  parseProductionReleaseMarker(text);
  return text;
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function readProductionReleaseMarker(markerPath) {
  const details = await lstat(markerPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!details) return null;
  if (!details.isFile() || details.isSymbolicLink()) throw new Error("release marker path is not a regular file");
  const bytes = await readFile(markerPath, "utf8");
  return { marker: parseProductionReleaseMarker(bytes), digest: createHash("sha256").update(bytes).digest("hex"), bytes };
}

export async function writeDdlStartingMarker({ markerDirectory, releaseSha, workflowRunId, workflowRunAttempt,
  authorizationId, lineageDigest, expectedPriorDigest = null }) {
  const directory = path.resolve(markerDirectory);
  const details = await lstat(directory).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!details || !details.isDirectory() || details.isSymbolicLink()) throw new Error("durable release marker directory is unavailable or unsafe");
  const markerPath = path.join(directory, MARKER_NAME);
  const lockPath = `${markerPath}.lock`;
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error?.code === "EEXIST") throw new Error("another DDL marker handoff is already active or interrupted");
    throw error;
  });
  try {
    const existing = await readProductionReleaseMarker(markerPath);
    if (expectedPriorDigest === null) {
      if (existing) throw new Error("release marker appeared before DDL handoff");
    } else {
      if (!existing || existing.digest !== expectedPriorDigest || existing.marker.releaseSha !== releaseSha
        || existing.marker.state !== "forward-resume-armed" || existing.marker.workflowRunId !== String(workflowRunId)
        || existing.marker.workflowRunAttempt !== Number(workflowRunAttempt)
        || existing.marker.authorizationId !== authorizationId || existing.marker.lineageDigest !== lineageDigest) {
        throw new Error("forward-resume marker lineage changed before DDL handoff");
      }
    }
    const marker = { releaseSha, state: "ddl-starting", workflowRunId, workflowRunAttempt, authorizationId, lineageDigest, spawnState: "not-started" };
    const bytes = serializeMarker(marker);
    const temporary = path.join(directory, `.marker.new.${process.pid}.${randomUUID()}`);
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes, "utf8"); await handle.sync(); } finally { await handle.close(); }
    try {
      if (expectedPriorDigest === null) await link(temporary, markerPath);
      else {
        const latest = await readProductionReleaseMarker(markerPath);
        if (!latest || latest.digest !== expectedPriorDigest) throw new Error("release marker changed during DDL handoff");
        await rename(temporary, markerPath);
      }
      await fsyncDirectory(directory);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return { marker, digest: createHash("sha256").update(bytes).digest("hex"), markerPath };
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

export async function acknowledgePrismaSpawn({ markerPath, expectedDigest }) {
  const lockPath = `${markerPath}.lock`;
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error?.code === "EEXIST") throw new Error("another release-marker transition is already active or interrupted");
    throw error;
  });
  try {
    const current = await readProductionReleaseMarker(markerPath);
    if (!current || current.digest !== expectedDigest || current.marker.state !== "ddl-starting"
      || current.marker.spawnState !== "not-started") throw new Error("durable pre-spawn marker changed before spawn acknowledgement");
    const marker = { ...current.marker, state: "ddl-started", spawnState: "started" };
    const bytes = serializeMarker(marker);
    const temporary = `${markerPath}.new.${process.pid}.${randomUUID()}`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes, "utf8"); await handle.sync(); } finally { await handle.close(); }
    try {
      const latest = await readProductionReleaseMarker(markerPath);
      if (!latest || latest.digest !== expectedDigest) throw new Error("release marker changed while acknowledging Prisma spawn");
      await rename(temporary, markerPath);
      await fsyncDirectory(path.dirname(markerPath));
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return { marker, digest: createHash("sha256").update(bytes).digest("hex") };
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

export function releaseMarkerDigest(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

\n