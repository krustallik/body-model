import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OPENSSH_SHA256_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;

export function filterKnownHostRecords(candidateText, expectedFingerprint, fingerprintForKey) {
  if (!OPENSSH_SHA256_FINGERPRINT.test(expectedFingerprint ?? "") || typeof fingerprintForKey !== "function") {
    throw new Error("A valid pinned SSH SHA256 fingerprint is required.");
  }

  const trusted = [];
  for (const line of candidateText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const fields = trimmed.split(/\s+/);
    if (fields.length < 3) continue;
    const fingerprint = fingerprintForKey(fields[1], fields[2]);
    if (fingerprint === expectedFingerprint) trusted.push(trimmed);
  }
  if (trusted.length === 0) throw new Error("No scanned SSH host key matched the pinned fingerprint.");
  return `${trusted.join("\n")}\n`;
}

function fingerprintOpenSshKey(keyType, keyData) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "bodycast-ssh-key-"));
  const publicKeyPath = path.join(temporaryDirectory, "candidate.pub");
  try {
    writeFileSync(publicKeyPath, `${keyType} ${keyData}\n`, { mode: 0o600 });
    const result = spawnSync("ssh-keygen", ["-lf", publicKeyPath, "-E", "sha256"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return null;
    return result.stdout.trim().split(/\s+/)[1] ?? null;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function main() {
  const [candidatePath, trustedPath, ...extra] = process.argv.slice(2);
  if (!candidatePath || !trustedPath || extra.length) throw new Error("Candidate and output known_hosts paths are required.");
  rmSync(trustedPath, { force: true });
  const candidates = readFileSync(candidatePath, "utf8");
  const trusted = filterKnownHostRecords(candidates, process.env.SSH_HOST_FINGERPRINT, fingerprintOpenSshKey);
  writeFileSync(trustedPath, trusted, { mode: 0o600, flag: "wx" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "SSH host key verification failed."}\n`);
    process.exitCode = 1;
  }
}
