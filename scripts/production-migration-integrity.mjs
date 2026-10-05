import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const CANONICAL_REPOSITORY_URL = "https://github.com/krustallik/body-model.git";
export const CANONICAL_MAIN_REF = "refs/remotes/bodycast-canonical/main";

function runGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateRepositoryRelativePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/).some((part) => part === ".." || part === "")) {
    throw new Error("Migration path must be a safe repository-relative path.");
  }
  return relativePath.replaceAll("\\", "/");
}

export function readCommittedGitBlob({ repositoryPath, releaseSha, relativePath }) {
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) throw new Error("Release SHA must be a full lowercase Git commit SHA.");
  const safePath = validateRepositoryRelativePath(relativePath);
  return runGit(["cat-file", "blob", `${releaseSha}:${safePath}`], repositoryPath);
}

export async function verifyManifestBlob({ repositoryPath, releaseSha, migration }) {
  const relativePath = `prisma/migrations/${migration.name}/migration.sql`;
  const blobBytes = readCommittedGitBlob({ repositoryPath, releaseSha, relativePath });
  const actualSha256 = sha256(blobBytes);
  return {
    name: migration.name,
    relativePath,
    bytes: blobBytes.length,
    actualSha256,
    expectedSha256: migration.sha256,
    matchesManifest: actualSha256 === migration.sha256,
    blobBytes,
  };
}

export async function verifyExecutionFileMatchesBlob({ repositoryPath, releaseSha, migration }) {
  const verified = await verifyManifestBlob({ repositoryPath, releaseSha, migration });
  const workingPath = path.join(repositoryPath, ...verified.relativePath.split("/"));
  const workingBytes = await readFile(workingPath);
  const byteMatch = workingBytes.equals(verified.blobBytes);
  const exactMatch = verified.matchesManifest && byteMatch;
  return {
    name: migration.name,
    relativePath: verified.relativePath,
    blobSha256: verified.actualSha256,
    expectedSha256: verified.expectedSha256,
    workingTreeSha256: sha256(workingBytes),
    byteMatch,
    matchesManifest: verified.matchesManifest,
    exactMatch,
    blocker: exactMatch ? null : !verified.matchesManifest
      ? `Committed Git blob ${verified.relativePath} differs from the reviewed manifest checksum.`
      : `Execution file ${verified.relativePath} differs byte-for-byte from the committed Git blob.`,
  };
}

export function assertCanonicalRepositoryUrl(value) {
  const normalized = String(value ?? "").trim().replace(/\/$/, "");
  if (normalized !== CANONICAL_REPOSITORY_URL.replace(/\/$/, "")
    && normalized !== "git@github.com:krustallik/body-model.git") {
    throw new Error("Canonical repository URL does not identify krustallik/body-model.");
  }
  return normalized;
}

export function fetchCanonicalMain({ repositoryPath }) {
  const refspec = `+refs/heads/main:${CANONICAL_MAIN_REF}`;
  runGit([
    "-c", `remote.bodycast-canonical.url=${CANONICAL_REPOSITORY_URL}`,
    "fetch", "--no-tags", "--prune", "bodycast-canonical", refspec,
  ], repositoryPath);
  const sha = runGit(["rev-parse", "--verify", `${CANONICAL_MAIN_REF}^{commit}`], repositoryPath).toString("ascii").trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Canonical main fetch returned an invalid commit SHA.");
  return sha;
}
