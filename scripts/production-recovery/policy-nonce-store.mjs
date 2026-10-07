import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJson, canonicalDigest, sha256Hex } from "./canonical.mjs";

async function syncDirectory(directory) {
  const handle = await fs.open(directory, fsConstants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

function assertPrivateDirectory(stat, requireRoot) {
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Policy nonce store must be a real directory.");
  if (process.platform !== "win32") {
    if ((stat.mode & 0o077) !== 0) throw new Error("Policy nonce store must be private (mode 0700).");
    if (requireRoot && stat.uid !== 0) throw new Error("Policy nonce store must be root-owned.");
  }
}

/**
 * Durable, single-use request consumption for the separate policy signer.
 * An abandoned lock deliberately blocks future issuance; no workflow may reap it.
 */
export function createFileBackedPolicyNonceConsumer(directory, { requireRoot = false, syncDirectory: sync = syncDirectory } = {}) {
  const absolute = path.resolve(directory);
  return async function consumeSingleUseRequest(binding) {
    const directoryStat = await fs.lstat(absolute);
    assertPrivateDirectory(directoryStat, requireRoot);
    const lockPath = path.join(absolute, ".policy-signer.lock");
    let lock;
    try {
      lock = await fs.open(lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("Policy signer nonce store is locked; manual reviewed recovery is required.");
      throw error;
    }
    const token = randomUUID();
    const tempPath = path.join(absolute, ".policy-request-" + token + ".tmp");
    let temp;
    try {
      await lock.writeFile(canonicalJson({ pid: process.pid, token }));
      await lock.sync();
      await sync(absolute);
      const files = await fs.readdir(absolute);
      for (const name of files.filter((entry) => /^request-[a-f0-9]{64}\.json$/.test(entry))) {
        const existing = JSON.parse(await fs.readFile(path.join(absolute, name), "utf8"));
        if (existing.requestIdDigest === sha256Hex(binding.requestId)
          || existing.nonceDigest === sha256Hex(binding.nonce)) return false;
      }
      const record = {
        schemaVersion: 1,
        recoveryCaseId: binding.recoveryCaseId,
        phase: binding.phase,
        requestIdDigest: sha256Hex(binding.requestId),
        nonceDigest: sha256Hex(binding.nonce),
        policyDigest: binding.policyDigest,
      };
      const name = "request-" + record.requestIdDigest + ".json";
      temp = await fs.open(tempPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
      await temp.writeFile(canonicalJson(record));
      await temp.sync();
      await temp.close();
      temp = null;
      try {
        await fs.link(tempPath, path.join(absolute, name));
      } catch (error) {
        if (error?.code === "EEXIST") return false;
        throw error;
      }
      await sync(absolute);
      return true;
    } finally {
      await temp?.close();
      await fs.rm(tempPath, { force: true });
      await lock.close();
      const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
      if (current.token !== token) throw new Error("Policy nonce lock ownership changed.");
      await fs.unlink(lockPath);
      await sync(absolute);
    }
  };
}

export function policyRequestDigest(policy) {
  return canonicalDigest(policy);
}
