import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalDigest, canonicalJson, sha256Hex } from "./canonical.mjs";

export const MIGRATION_CONTEXT_FILES = Object.freeze([
  "authorization-envelope.json",
  "preflight-result.json",
  "preflight-evidence.json",
  "restore-result.json",
  "artifact-metadata.json",
]);

function parseContextId(contextId) {
  const match = /^migration-([1-9][0-9]*)-([1-9][0-9]*)-([1-9][0-9]*)$/.exec(contextId);
  if (!match) throw new Error("Migration context ID is not in the fixed workflow/run/attempt format.");
  return { workflowId: match[1], runId: match[2], runAttempt: match[3] };
}

async function fsyncDirectory(directory) {
  const handle = await fs.open(directory, fsConstants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function readSafeFile(filePath, maxBytes) {
  const before = await fs.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error("Migration context file is unsafe or oversized.");
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.ino !== before.ino || after.size > maxBytes) throw new Error("Migration context file changed while it was opened.");
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new Error("Migration context file exceeds its protocol limit.");
    return bytes;
  } finally {
    await handle.close();
  }
}

function assertPrivateRoot(stat, requireRoot) {
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Pinned context store must be a real directory.");
  if (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || requireRoot && stat.uid !== 0)) {
    throw new Error("Pinned context store must be root-owned mode 0700.");
  }
}

/** Copy a user-writable run context into root-private immutable storage before validation/use. */
export function createMigrationContextStore({
  incomingRoot = "/tmp",
  storeDirectory = "/var/lib/bodycast/production-operations/migrations",
  requireRoot = true,
  maxFileBytes = 1024 * 1024,
  syncDirectory = fsyncDirectory,
}) {
  return Object.freeze({
    async pin(contextId) {
      const context = parseContextId(contextId);
      const sourceDirectory = path.join(incomingRoot, `bodycast-migration-context-${context.runId}-${context.runAttempt}`);
      const sourceStat = await fs.lstat(sourceDirectory);
      if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error("Migration context directory is missing or unsafe.");
      const root = path.resolve(storeDirectory);
      const rootStat = await fs.lstat(root);
      assertPrivateRoot(rootStat, requireRoot);
      const copied = [];
      for (const name of MIGRATION_CONTEXT_FILES) {
        const bytes = await readSafeFile(path.join(sourceDirectory, name), maxFileBytes);
        copied.push({ name, bytes, sha256: sha256Hex(bytes) });
      }
      const binding = { schemaVersion: 1, ...context, files: copied.map(({ name, sha256 }) => ({ name, sha256 })) };
      const directoryName = contextId;
      const finalDirectory = path.join(root, directoryName);
      try {
        const existing = await fs.lstat(finalDirectory);
        if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error("Pinned migration context destination is unsafe.");
        const existingManifest = JSON.parse(await fs.readFile(path.join(finalDirectory, "context-manifest.json"), "utf8"));
        if (canonicalDigest(existingManifest) !== canonicalDigest(binding)) throw new Error("Migration context ID is already pinned to different signed inputs.");
        return { contextId, directory: finalDirectory, manifest: existingManifest };
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const staging = path.join(root, ".context-" + randomUUID());
      await fs.mkdir(staging, { mode: 0o700 });
      try {
        for (const file of copied) {
          const handle = await fs.open(path.join(staging, file.name),
            fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
          try { await handle.writeFile(file.bytes); await handle.sync(); } finally { await handle.close(); }
        }
        const manifest = await fs.open(path.join(staging, "context-manifest.json"),
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
        try { await manifest.writeFile(canonicalJson(binding)); await manifest.sync(); } finally { await manifest.close(); }
        await syncDirectory(staging);
        await fs.rename(staging, finalDirectory);
        await syncDirectory(root);
        return { contextId, directory: finalDirectory, manifest: binding };
      } catch (error) {
        await fs.rm(staging, { recursive: true, force: true });
        throw error;
      }
    },
    async read(contextId) {
      parseContextId(contextId);
      const directory = path.join(path.resolve(storeDirectory), contextId);
      const stat = await fs.lstat(directory);
      assertPrivateRoot(stat, requireRoot);
      const manifest = JSON.parse(await fs.readFile(path.join(directory, "context-manifest.json"), "utf8"));
      if (manifest.schemaVersion !== 1 || manifest.workflowId !== parseContextId(contextId).workflowId
        || manifest.runId !== parseContextId(contextId).runId || manifest.runAttempt !== parseContextId(contextId).runAttempt) {
        throw new Error("Pinned migration context manifest does not match its opaque identifier.");
      }
      for (const item of manifest.files) {
        if (!MIGRATION_CONTEXT_FILES.includes(item.name)) throw new Error("Pinned migration context contains an unsupported file.");
        const bytes = await readSafeFile(path.join(directory, item.name), maxFileBytes);
        if (sha256Hex(bytes) !== item.sha256) throw new Error("Pinned migration context file changed after capture.");
      }
      return { contextId, directory, manifest };
    },
  });
}

export { parseContextId, fsyncDirectory };
