import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const PROGRAMLESS_STRENGTH_SESSIONS_CAPABILITY = "programless-strength-sessions-v1";
const CAPABILITY_FILE = "scripts/production-app-capabilities.json";
const RELEASE_SHA = /^[a-f0-9]{40}$/;
const KNOWN_CAPABILITIES = new Set([PROGRAMLESS_STRENGTH_SESSIONS_CAPABILITY]);

export function readProductionAppCapabilitiesAtSha({ repositoryPath, releaseSha }) {
  if (!repositoryPath || !RELEASE_SHA.test(String(releaseSha ?? ""))) {
    throw new Error("Rollback app capability lookup requires an exact source SHA and repository.");
  }
  let bytes;
  try {
    bytes = execFileSync("git", ["cat-file", "blob", `${releaseSha}:${CAPABILITY_FILE}`], {
      cwd: repositoryPath,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Rollback app SHA has no immutable BodyCast capability contract.");
  }
  let contract;
  try { contract = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Rollback app capability contract is malformed."); }
  const keys = contract && typeof contract === "object" && !Array.isArray(contract)
    ? Object.keys(contract).sort() : [];
  const capabilities = contract?.capabilities;
  if (JSON.stringify(keys) !== JSON.stringify(["capabilities", "schemaVersion"])
    || contract.schemaVersion !== 1 || !Array.isArray(capabilities)
    || capabilities.some((value) => typeof value !== "string" || !KNOWN_CAPABILITIES.has(value))
    || new Set(capabilities).size !== capabilities.length
    || JSON.stringify(capabilities) !== JSON.stringify([...capabilities].sort())) {
    throw new Error("Rollback app capability contract is malformed or contains unknown fields.");
  }
  return Object.freeze({
    releaseSha,
    capabilityDigest: createHash("sha256").update(bytes).digest("hex"),
    capabilities: Object.freeze([...capabilities]),
  });
}

export function assertRollbackAppCanReadProgramlessSessions({ repositoryPath, releaseSha, programlessSessionCount }) {
  if (!Number.isSafeInteger(programlessSessionCount) || programlessSessionCount < 0) {
    throw new Error("Rollback compatibility requires a sanitized programless-session count.");
  }
  if (programlessSessionCount === 0) {
    const capabilityDigest = createHash("sha256").update(`${releaseSha}:programless-session-capability-not-required:v1`).digest("hex");
    return Object.freeze({ verified: true, releaseSha, programlessSessionCount, capabilityRequired: false,
      rollbackAppSupportsProgramlessSessions: false, programlessSessionCompatible: true, capabilityDigest });
  }
  const contract = readProductionAppCapabilitiesAtSha({ repositoryPath, releaseSha });
  if (!contract.capabilities.includes(PROGRAMLESS_STRENGTH_SESSIONS_CAPABILITY)) {
    throw new Error("Rollback app is not certified to read existing programless strength sessions.");
  }
  return Object.freeze({ verified: true, releaseSha, programlessSessionCount, capabilityRequired: true,
    rollbackAppSupportsProgramlessSessions: true, programlessSessionCompatible: true,
    capabilityDigest: contract.capabilityDigest });
}
