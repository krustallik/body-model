import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
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
  const listing = runGit(["ls-tree", "-z", releaseSha, "--", safePath], repositoryPath).toString("utf8");
  const [header, listedPath] = listing.replace(/\0$/, "").split("\t");
  const match = /^100644 blob ([a-f0-9]{40})$/.exec(header ?? "");
  if (!match || listedPath !== safePath) throw new Error(`Committed migration file is not a regular Git blob: ${safePath}`);
  return runGit(["cat-file", "blob", match[1]], repositoryPath);
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

export async function readCommittedMigrationTree(repositoryPath, releaseSha) {
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) throw new Error("Release SHA must be a full lowercase Git commit SHA.");
  const headSha = runGit(["rev-parse", "--verify", "HEAD^{commit}"], repositoryPath).toString("ascii").trim();
  if (headSha !== releaseSha) throw new Error("Migration repository HEAD differs from the exact release SHA.");
  const status = runGit(["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all", "--ignored=traditional", "--", "prisma/migrations"], repositoryPath).toString("utf8");
  if (status) throw new Error("Prisma migration tree has working-tree, staged, untracked, or ignored files outside the exact release SHA.");

  const entries = runGit(["ls-tree", "-r", "-z", "--full-tree", releaseSha, "--", "prisma/migrations"], repositoryPath)
    .toString("utf8").split("\0").filter(Boolean);
  const files = [];
  const names = new Set();
  let lockFound = false;
  let migrationLockSha256;
  for (const entry of entries) {
    const separator = entry.indexOf("\t");
    const [mode, type, blob] = entry.slice(0, separator).split(" ");
    const relativePath = entry.slice(separator + 1);
    if (type !== "blob" || mode !== "100644" || !/^[a-f0-9]{40}$/.test(blob ?? "")) {
      throw new Error(`Prisma migration tree contains a non-regular Git entry: ${relativePath}`);
    }
    const committedBytes = runGit(["cat-file", "blob", blob], repositoryPath);
    const isLock = relativePath === "prisma/migrations/migration_lock.toml";
    const migration = /^prisma\/migrations\/(\d{14}_[A-Za-z0-9_]+)\/migration\.sql$/.exec(relativePath);
    if (!isLock && !migration) throw new Error(`Unexpected path in Prisma migration tree: ${relativePath}`);
    if (isLock) {
      if (lockFound) throw new Error("Prisma migration tree contains duplicate migration_lock.toml entries.");
      lockFound = true;
      migrationLockSha256 = sha256(committedBytes);
    }

    const filename = path.join(repositoryPath, ...relativePath.split("/"));
    const details = await lstat(filename);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Prisma migration file is not a regular file: ${relativePath}`);
    const workingBytes = await readFile(filename);
    if (!workingBytes.equals(committedBytes)) throw new Error(`Prisma migration file differs from its exact release Git blob: ${relativePath}`);
    if (isLock) continue;

    const name = migration[1];
    if (names.has(name)) throw new Error(`Duplicate Prisma migration directory in release tree: ${name}`);
    if (!committedBytes.length) throw new Error(`Prisma migration is empty: ${relativePath}`);
    names.add(name);
    files.push({ name, relativePath, bytes: committedBytes.length, sha256: sha256(committedBytes) });
  }
  if (!lockFound || !files.length) throw new Error("Exact release SHA has an incomplete or empty Prisma migration tree.");
  return { files: files.sort((left, right) => left.name.localeCompare(right.name)), migrationLockSha256 };
}

export async function readPackagedMigrationFiles(repositoryPath, expectedFiles, expectedMigrationLockSha256) {
  if (!Array.isArray(expectedFiles) || !expectedFiles.length || !/^[a-f0-9]{64}$/.test(String(expectedMigrationLockSha256 ?? ""))) {
    throw new Error("Signed exact-release migration inventory or Prisma migration lock checksum is unavailable.");
  }
  const expected = new Map();
  for (const file of expectedFiles) {
    if (!file || !/^\d{14}_[A-Za-z0-9_]+$/.test(String(file.name ?? ""))
      || file.matches !== true || file.expectedSha256 !== file.actualSha256
      || !/^[a-f0-9]{64}$/.test(String(file.actualSha256 ?? "")) || expected.has(file.name)) {
      throw new Error("Signed exact-release migration inventory is malformed or incomplete.");
    }
    expected.set(file.name, file.actualSha256);
  }

  const migrationRoot = path.join(repositoryPath, "prisma", "migrations");
  const root = await lstat(migrationRoot);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Packaged Prisma migration tree is not a regular directory.");
  const entries = await readdir(migrationRoot, { withFileTypes: true });
  const seen = new Set();
  const files = [];
  let lockFound = false;
  for (const entry of entries) {
    const filename = path.join(migrationRoot, entry.name);
    if (entry.name === "migration_lock.toml") {
      const details = await lstat(filename);
      if (!details.isFile() || details.isSymbolicLink()) throw new Error("Packaged Prisma migration lock is not a regular file.");
      if (sha256(await readFile(filename)) !== expectedMigrationLockSha256) {
        throw new Error("Packaged Prisma migration lock differs from the signed exact-release inventory.");
      }
      lockFound = true;
      continue;
    }
    if (!/^\d{14}_[A-Za-z0-9_]+$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()
      || !expected.has(entry.name)) {
      throw new Error(`Unexpected entry in packaged Prisma migration tree: ${entry.name}`);
    }
    const directory = await readdir(filename, { withFileTypes: true });
    if (directory.length !== 1 || directory[0].name !== "migration.sql" || !directory[0].isFile()) {
      throw new Error(`Packaged Prisma migration directory is incomplete or has unexpected files: ${entry.name}`);
    }
    const relativePath = `prisma/migrations/${entry.name}/migration.sql`;
    const migrationPath = path.join(filename, "migration.sql");
    const details = await lstat(migrationPath);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Packaged Prisma migration is not a regular file: ${relativePath}`);
    const bytes = await readFile(migrationPath);
    const actualSha256 = sha256(bytes);
    if (!bytes.length || actualSha256 !== expected.get(entry.name)) {
      throw new Error(`Packaged Prisma migration differs from signed exact-release inventory: ${relativePath}`);
    }
    seen.add(entry.name);
    files.push({ name: entry.name, relativePath, bytes: bytes.length, sha256: actualSha256 });
  }
  if (!lockFound || seen.size !== expected.size || [...expected.keys()].some((name) => !seen.has(name))) {
    throw new Error("Packaged Prisma migration tree does not match the signed exact-release inventory.");
  }
  return files.sort((left, right) => left.name.localeCompare(right.name));
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
