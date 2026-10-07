import fs from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  assertExactKeys,
  assertGitSha,
  assertNonEmptyString,
  assertSha256,
  assertUtcTimestamp,
  canonicalDigest,
  canonicalJson,
  signCanonical,
  sha256Hex,
  verifyCanonical,
} from "./canonical.mjs";
import { assertSafePath } from "./journal.mjs";

const PROVENANCE_KEYS = Object.freeze([
  "schemaVersion", "purpose", "packageName", "authorityVersion", "authorityKeyId", "binaryDigest",
  "configDigest", "sourceRepository", "sourceMainSha", "buildWorkflowPath", "buildWorkflowId",
  "buildWorkflowRunId", "buildWorkflowRunAttempt", "issuedAt", "expiresAt", "signerKeyId", "signature",
]);
const INSTALL_RECEIPT_KEYS = Object.freeze([
  "receiptSchemaVersion", "purpose", "authorityVersion", "binaryDigest", "configDigest", "authorityKeyId",
  "installationPath", "installedAt", "previousAuthorityVersion", "minimumAllowedVersion", "provenanceDigest",
  "signerKeyId", "signature",
]);

function parseVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) throw new Error("Authority version must be canonical semantic major.minor.patch.");
  return match.slice(1).map(Number);
}

export function compareAuthorityVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  return 0;
}

export function verifyAuthorityInstallArtifact({
  provenance,
  binaryBytes,
  configBytes,
  trustedProvenanceKeys,
  allowedAuthorityVersions,
  minimumAllowedVersion,
  currentInstallation = null,
  now = Date.now(),
}) {
  assertExactKeys(provenance, PROVENANCE_KEYS, "Authority installation provenance");
  if (provenance.schemaVersion !== 1 || provenance.purpose !== "bodycast-production-recovery-authority-package") {
    throw new Error("Authority package provenance schema or purpose is unsupported.");
  }
  for (const key of ["packageName", "authorityVersion", "authorityKeyId", "sourceRepository", "buildWorkflowPath",
    "buildWorkflowId", "buildWorkflowRunId", "buildWorkflowRunAttempt", "signerKeyId", "signature"]) {
    assertNonEmptyString(provenance[key], "provenance." + key);
  }
  assertGitSha(provenance.sourceMainSha, "provenance.sourceMainSha");
  assertSha256(provenance.binaryDigest, "provenance.binaryDigest");
  assertSha256(provenance.configDigest, "provenance.configDigest");
  assertUtcTimestamp(provenance.issuedAt, "provenance.issuedAt");
  assertUtcTimestamp(provenance.expiresAt, "provenance.expiresAt");
  if (Date.parse(provenance.issuedAt) > now || Date.parse(provenance.expiresAt) <= now) {
    throw new Error("Authority package provenance is not currently valid.");
  }
  if (!trustedProvenanceKeys?.[provenance.signerKeyId]
    || !verifyCanonical(Object.fromEntries(Object.entries(provenance).filter(([key]) => key !== "signature")), provenance.signature,
      trustedProvenanceKeys[provenance.signerKeyId])) {
    throw new Error("Authority package provenance signature is not trusted.");
  }
  if (provenance.packageName !== "bodycast-production-recovery-authority") throw new Error("Unexpected authority package name.");
  if (sha256Hex(binaryBytes) !== provenance.binaryDigest || sha256Hex(configBytes) !== provenance.configDigest) {
    throw new Error("Authority package or configuration digest does not match signed provenance.");
  }
  if (!Array.isArray(allowedAuthorityVersions) || !allowedAuthorityVersions.includes(provenance.authorityVersion)) {
    throw new Error("Authority version is not on the reviewed version allowlist.");
  }
  const floor = minimumAllowedVersion;
  if (compareAuthorityVersions(provenance.authorityVersion, floor) < 0) throw new Error("Authority package is below the monotonic minimum version.");
  if (currentInstallation?.authorityVersion
    && compareAuthorityVersions(provenance.authorityVersion, currentInstallation.authorityVersion) < 0) {
    throw new Error("Authority downgrade is prohibited.");
  }
  return Object.freeze({
    authorityVersion: provenance.authorityVersion,
    authorityKeyId: provenance.authorityKeyId,
    binaryDigest: provenance.binaryDigest,
    configDigest: provenance.configDigest,
    provenanceDigest: canonicalDigest(provenance),
    sourceRepository: provenance.sourceRepository,
    sourceMainSha: provenance.sourceMainSha,
  });
}

export function createAuthorityInstallationReceipt(verifiedArtifact, {
  installationPath,
  previousAuthorityVersion = null,
  minimumAllowedVersion,
  installedAt,
  signerKeyId,
  privateKey,
}) {
  if (!verifiedArtifact?.provenanceDigest || !privateKey) throw new Error("Verified provenance and root installation signer are required.");
  const unsigned = {
    receiptSchemaVersion: 1,
    purpose: "bodycast-production-recovery-authority-installation",
    authorityVersion: verifiedArtifact.authorityVersion,
    binaryDigest: verifiedArtifact.binaryDigest,
    configDigest: verifiedArtifact.configDigest,
    authorityKeyId: verifiedArtifact.authorityKeyId,
    installationPath,
    installedAt,
    previousAuthorityVersion,
    minimumAllowedVersion,
    provenanceDigest: verifiedArtifact.provenanceDigest,
    signerKeyId,
  };
  const receipt = { ...unsigned, signature: signCanonical(unsigned, privateKey) };
  assertExactKeys(receipt, INSTALL_RECEIPT_KEYS, "Authority installation receipt");
  return receipt;
}

export function verifyAuthorityInstallationReceipt(receipt, trustedKeys, {
  minimumAllowedVersion,
  allowedAuthorityVersions,
} = {}) {
  assertExactKeys(receipt, INSTALL_RECEIPT_KEYS, "Authority installation receipt");
  if (receipt.receiptSchemaVersion !== 1 || receipt.purpose !== "bodycast-production-recovery-authority-installation") {
    throw new Error("Authority installation receipt schema or purpose is unsupported.");
  }
  if (!trustedKeys?.[receipt.signerKeyId]
    || !verifyCanonical(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "signature")), receipt.signature,
      trustedKeys[receipt.signerKeyId])) throw new Error("Authority installation receipt signature is invalid.");
  if (!allowedAuthorityVersions?.includes(receipt.authorityVersion)
    || compareAuthorityVersions(receipt.authorityVersion, minimumAllowedVersion) < 0) {
    throw new Error("Installed authority is no longer on the allowed version policy.");
  }
  return true;
}

/**
 * Installs only a package already verified against a separately pinned trust root.
 * The caller must be the later root-owned install checkpoint; this function does
 * not run during ordinary application startup or deploy.
 */
export async function installVerifiedAuthorityPackage({
  verifiedArtifact,
  binaryBytes,
  configBytes,
  installationRoot,
  currentInstallation,
  minimumAllowedVersion,
  receiptSigner,
  trustedInstallationKeys = null,
  allowedAuthorityVersions = null,
  requireRoot = true,
  syncDirectory = async (directoryPath) => {
    const handle = await fs.open(directoryPath, fsConstants.O_RDONLY);
    try { await handle.sync(); } finally { await handle.close(); }
  },
}) {
  if (process.platform !== "win32" && requireRoot && process.getuid?.() !== 0) throw new Error("Authority package installation requires root.");
  if (!verifiedArtifact?.authorityVersion || !receiptSigner?.privateKey || !receiptSigner?.publicKey || !receiptSigner?.keyId) {
    throw new Error("Trusted installation inputs are incomplete.");
  }
  if (currentInstallation?.authorityVersion
    && compareAuthorityVersions(verifiedArtifact.authorityVersion, currentInstallation.authorityVersion) < 0) {
    throw new Error("Authority downgrade is prohibited.");
  }
  const root = path.resolve(installationRoot);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await assertSafePath(root, { requireRoot, privateMode: true });
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (process.platform !== "win32" && (rootStat.uid !== 0 || (rootStat.mode & 0o077) !== 0))) {
    throw new Error("Authority installation root must be root-owned mode 0700.");
  }
  const installationKeys = trustedInstallationKeys ?? { [receiptSigner.keyId]: receiptSigner.publicKey };
  const versionAllowlist = allowedAuthorityVersions ?? [verifiedArtifact.authorityVersion];
  const currentPointerPath = path.join(root, "current-version");
  let actualCurrentInstallation = null;
  try {
    await fs.lstat(currentPointerPath);
    const installedCurrent = await verifyInstalledAuthorityPackage({
      installationRoot: root,
      trustedInstallationKeys: installationKeys,
      allowedAuthorityVersions: versionAllowlist,
      minimumAllowedVersion,
      requireRoot,
    });
    actualCurrentInstallation = { authorityVersion: installedCurrent.authorityVersion };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (currentInstallation?.authorityVersion !== undefined
    && currentInstallation.authorityVersion !== actualCurrentInstallation?.authorityVersion) {
    throw new Error("Caller-provided current authority version differs from the authenticated installed version.");
  }
  if (actualCurrentInstallation
    && compareAuthorityVersions(verifiedArtifact.authorityVersion, actualCurrentInstallation.authorityVersion) < 0) {
    throw new Error("Authority downgrade is prohibited by the installed version pointer and receipt.");
  }
  const versionPath = path.join(root, "v" + verifiedArtifact.authorityVersion);
  try {
    await fs.lstat(versionPath);
    throw new Error("Authority version installation path already exists; versions are immutable.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const staging = path.join(root, ".install-" + randomUUID());
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    const binaryPath = path.join(staging, "bodycast-recovery-authority");
    const configPath = path.join(staging, "authority-config.json");
    const binary = await fs.open(binaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o755);
    try { await binary.writeFile(binaryBytes); await binary.sync(); } finally { await binary.close(); }
    const config = await fs.open(configPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    try { await config.writeFile(configBytes); await config.sync(); } finally { await config.close(); }
    if (sha256Hex(await fs.readFile(binaryPath)) !== verifiedArtifact.binaryDigest
      || sha256Hex(await fs.readFile(configPath)) !== verifiedArtifact.configDigest) {
      throw new Error("Staged authority installation bytes do not match verified provenance.");
    }
    await fs.rename(staging, versionPath);
    await syncDirectory(root);
    const receipt = createAuthorityInstallationReceipt(verifiedArtifact, {
      installationPath: versionPath,
      previousAuthorityVersion: actualCurrentInstallation?.authorityVersion ?? null,
      minimumAllowedVersion,
      installedAt: new Date().toISOString(),
      signerKeyId: receiptSigner.keyId,
      privateKey: receiptSigner.privateKey,
    });
    const receiptPath = path.join(versionPath, "installation-receipt.json");
    const receiptTempPath = path.join(versionPath, ".installation-receipt-" + randomUUID() + ".tmp");
    const receiptHandle = await fs.open(receiptTempPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    try { await receiptHandle.writeFile(canonicalJson(receipt)); await receiptHandle.sync(); } finally { await receiptHandle.close(); }
    await fs.link(receiptTempPath, receiptPath);
    await fs.rm(receiptTempPath, { force: true });
    await syncDirectory(versionPath);
    const pointerTemp = path.join(root, ".current-version-" + randomUUID() + ".tmp");
    const pointer = await fs.open(pointerTemp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    try { await pointer.writeFile("v" + verifiedArtifact.authorityVersion + "\n"); await pointer.sync(); } finally { await pointer.close(); }
    await fs.rename(pointerTemp, path.join(root, "current-version"));
    await syncDirectory(root);
    const installed = await verifyInstalledAuthorityPackage({
      installationRoot: root,
      trustedInstallationKeys: { [receiptSigner.keyId]: receiptSigner.publicKey },
      allowedAuthorityVersions: [verifiedArtifact.authorityVersion],
      minimumAllowedVersion,
      requireRoot,
    });
    if (installed.binaryDigest !== verifiedArtifact.binaryDigest || installed.configDigest !== verifiedArtifact.configDigest) {
      throw new Error("Installed authority package verification did not match the verified artifact.");
    }
    return receipt;
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Install the public, non-privileged socket client separately from mode-0700 authority state. */
export async function installVerifiedAuthorityClient({
  clientBytes,
  installationPath = "/usr/local/lib/bodycast/production-recovery-client.mjs",
  requireRoot = true,
  syncDirectory = async (directoryPath) => {
    const directoryHandle = await fs.open(directoryPath, fsConstants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  },
}) {
  if (!Buffer.isBuffer(clientBytes) || clientBytes.length === 0 || clientBytes.length > 16 * 1024 * 1024) {
    throw new Error("Production operation client bundle is empty or exceeds its package limit.");
  }
  if (process.platform !== "win32" && requireRoot && process.getuid?.() !== 0) {
    throw new Error("Production operation client installation requires root.");
  }
  const target = path.resolve(installationPath);
  const parent = path.dirname(target);
  await assertSafePath(parent, { requireRoot });
  const parentStat = await fs.lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()
    || process.platform !== "win32" && requireRoot && (parentStat.uid !== 0 || (parentStat.mode & 0o022) !== 0)) {
    throw new Error("Public production operation client directory must be root-owned and not group/other writable.");
  }
  try {
    const existing = await fs.lstat(target);
    if (!existing.isFile() || existing.isSymbolicLink()
      || process.platform !== "win32" && requireRoot && existing.uid !== 0) {
      throw new Error("Existing production operation client is not a root-owned regular file.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = path.join(parent, ".production-operation-client-" + randomUUID() + ".tmp");
  const handle = await fs.open(temporary,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o755);
  try { await handle.writeFile(clientBytes); await handle.sync(); } finally { await handle.close(); }
  try {
    await fs.rename(temporary, target);
    await syncDirectory(parent);
    const installed = await fs.lstat(target);
    if (!installed.isFile() || installed.isSymbolicLink()
      || process.platform !== "win32" && (installed.mode & 0o022) !== 0) {
      throw new Error("Installed public production operation client permissions are unsafe.");
    }
    return Object.freeze({ installationPath: target, clientDigest: sha256Hex(clientBytes) });
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function readInstalledFile(filePath, maxBytes) {
  const before = await fs.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error("Installed authority file is unsafe or oversized.");
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.ino !== before.ino || after.size > maxBytes) throw new Error("Installed authority file changed while it was opened.");
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new Error("Installed authority file exceeds its limit.");
    return { bytes, stat: after };
  } finally {
    await handle.close();
  }
}

/** Verify the currently selected immutable package from disk before service startup. */
export async function verifyInstalledAuthorityPackage({
  installationRoot,
  trustedInstallationKeys,
  allowedAuthorityVersions,
  minimumAllowedVersion,
  requireRoot = true,
}) {
  const root = await assertSafePath(installationRoot, { requireRoot, privateMode: true });
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Authority install root is not a private directory.");
  if (process.platform !== "win32" && (rootStat.mode & 0o077) !== 0) throw new Error("Authority install root grants group/other access.");
  const pointer = await readInstalledFile(path.join(root, "current-version"), 64);
  if (process.platform !== "win32" && (pointer.stat.mode & 0o077) !== 0) throw new Error("Authority version pointer is not private.");
  const pointerText = pointer.bytes.toString("utf8");
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\n$/.exec(pointerText);
  if (!match) throw new Error("Authority version pointer is malformed.");
  const authorityVersion = match[1] + "." + match[2] + "." + match[3];
  const versionDirectory = path.join(root, "v" + authorityVersion);
  const directory = await fs.lstat(versionDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()
    || process.platform !== "win32" && ((directory.mode & 0o077) !== 0 || requireRoot && directory.uid !== 0)) {
    throw new Error("Selected authority package directory is not root-owned and private.");
  }
  const binary = await readInstalledFile(path.join(versionDirectory, "bodycast-recovery-authority"), 64 * 1024 * 1024);
  const config = await readInstalledFile(path.join(versionDirectory, "authority-config.json"), 1024 * 1024);
  const receiptFile = await readInstalledFile(path.join(versionDirectory, "installation-receipt.json"), 64 * 1024);
  if (process.platform !== "win32" && ((binary.stat.mode & 0o022) !== 0 || (config.stat.mode & 0o077) !== 0
    || (receiptFile.stat.mode & 0o077) !== 0)) throw new Error("Installed authority package permissions are unsafe.");
  const receiptText = receiptFile.bytes.toString("utf8");
  const receipt = JSON.parse(receiptText);
  if (canonicalJson(receipt) !== receiptText) throw new Error("Installation receipt is not canonically encoded.");
  verifyAuthorityInstallationReceipt(receipt, trustedInstallationKeys, { minimumAllowedVersion, allowedAuthorityVersions });
  const binaryDigest = sha256Hex(binary.bytes);
  const configDigest = sha256Hex(config.bytes);
  if (receipt.authorityVersion !== authorityVersion || receipt.installationPath !== versionDirectory
    || receipt.binaryDigest !== binaryDigest || receipt.configDigest !== configDigest) {
    throw new Error("Installed authority bytes or version pointer do not match the authenticated receipt.");
  }
  return Object.freeze({ authorityVersion, binaryDigest, configDigest, receipt, configBytes: config.bytes });
}

export { PROVENANCE_KEYS, INSTALL_RECEIPT_KEYS };
