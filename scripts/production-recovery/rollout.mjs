import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalDigest, sha256Hex, assertGitSha, assertSha256 } from "./canonical.mjs";
import { verifyImmutableReceipt } from "./journal.mjs";

const execFile = promisify(execFileCallback);
const ROLLOUT_RECEIPT_KEYS = Object.freeze([
  "receiptSchemaVersion", "purpose", "repository", "canonicalMainSha", "reviewedManifestDigest",
  "entrypointsDigest", "markerReaderProtocolVersion", "hostTopologyIdentityDigest", "authorityVersion",
  "authorityBinaryDigest", "authorityConfigDigest", "installationReceiptDigest", "evidenceDigest",
  "issuedAt", "expiresAt", "authorityKeyId", "authorityInstanceId",
  "receiptDigest", "authoritySignature",
]);
export const REQUIRED_READER_ROLLOUT_FIXTURES = Object.freeze([
  "markerAbsenceOnly",
  "malformedLegacyMarkerBlocks",
  "unsupportedLegacyMarkerBlocks",
  "malformedV2MarkerBlocks",
  "everyRecoveryV2StateBlocks",
  "unknownV2StateBlocks",
  "futureV2SchemaBlocks",
  "journalProjectionMismatchBlocks",
  "symlinkMarkerBlocks",
  "staleCheckoutRejected",
  "changedEntrypointRejected",
  "callerFlagsCannotBypass",
]);

export const REVIEWED_ENTRYPOINTS = Object.freeze([
  "scripts/production-release-marker.sh",
  "scripts/production-traffic-cutover.sh",
  "scripts/deploy.sh",
  "scripts/deploy-preflight-schema.sh",
  "scripts/deploy-migrate.sh",
  "scripts/production-writer-drain.sh",
  "scripts/production-writer-drain.mjs",
  "scripts/production-db-target.sh",
  "scripts/production-db-preflight.mjs",
  "scripts/production-migration-final-guard.mjs",
  "scripts/run-prisma-migrate-with-lock-timeout.mjs",
  "scripts/production-recovery/authorization.mjs",
  "scripts/production-recovery/authorization-issuer-service.mjs",
  "scripts/production-recovery/authority.mjs",
  "scripts/production-recovery/artifact-identity.mjs",
  "scripts/production-recovery/database-identity.mjs",
  "scripts/production-recovery/host-runtime.mjs",
  "scripts/production-recovery/host-service.mjs",
  "scripts/production-recovery/host-operation-client.mjs",
  "scripts/production-recovery/authority-package-runtime.mjs",
  "scripts/production-recovery/authority-client-runtime.mjs",
  "scripts/production-recovery/build-authority-package.mjs",
  "scripts/production-recovery/install-provenance.mjs",
  "scripts/production-recovery/journal.mjs",
  "scripts/production-recovery/migration-context-store.mjs",
  "scripts/production-recovery/operation-broker.mjs",
  "scripts/production-recovery/operation-contracts.mjs",
  "scripts/production-recovery/policy-nonce-store.mjs",
  "scripts/production-recovery/policy-signer-service.mjs",
  "scripts/production-recovery/request-phase-authorization.mjs",
  "scripts/production-recovery/rollout.mjs",
  "scripts/production-recovery/schema-compatibility.mjs",
  "scripts/production-recovery/schemas.mjs",
  "scripts/production-recovery/signer-http-service.mjs",
  "scripts/production-recovery/writer-drain.mjs",
  "scripts/production-recovery/systemd/bodycast-production-operations.service",
  "scripts/production-recovery/systemd/bodycast-production-operations.socket",
  "scripts/production-recovery/production-authority-launcher.sh",
  "scripts/production-recovery/production-operation-client-launcher.sh",
  "docker-compose.recovery.yml",
  "tests/production-recovery-marker-reader.sh",
]);

function assertRepoRelativeFile(file) {
  if (typeof file !== "string" || !/^[A-Za-z0-9._/-]+$/.test(file) || file.startsWith("/")
    || file.split("/").some((part) => part === ".." || part === "." || part.length === 0)) {
    throw new Error("Reader rollout manifest contains an unsafe path.");
  }
}

export async function inspectInstalledEntrypoints(repositoryRoot, canonicalMainSha, entrypoints = REVIEWED_ENTRYPOINTS) {
  assertGitSha(canonicalMainSha, "canonicalMainSha");
  const root = path.resolve(repositoryRoot);
  const { stdout: headOutput } = await execFile("git", ["-C", root, "rev-parse", "HEAD"]);
  if (headOutput.trim() !== canonicalMainSha) throw new Error("Installed repository checkout is stale or not the approved main SHA.");
  const { stdout: statusOutput } = await execFile("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"]);
  if (statusOutput.trim() !== "") throw new Error("Installed repository checkout has local changes; reader rollout is invalid.");
  const inspected = [];
  for (const relativePath of entrypoints) {
    assertRepoRelativeFile(relativePath);
    const { stdout: blobOutput } = await execFile("git", ["-C", root, "rev-parse", canonicalMainSha + ":" + relativePath]);
    const blobSha = blobOutput.trim();
    const bytes = await fs.readFile(path.join(root, relativePath));
    const { stdout: committed } = await execFile("git", ["-C", root, "cat-file", "blob", canonicalMainSha + ":" + relativePath], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
    const committedBytes = Buffer.isBuffer(committed) ? committed : Buffer.from(committed);
    if (!bytes.equals(committedBytes)) throw new Error("Installed reader entrypoint differs from its reviewed Git blob: " + relativePath + ".");
    inspected.push({ path: relativePath, gitBlobSha: blobSha, contentSha256: sha256Hex(bytes) });
  }
  return inspected;
}

export function createReaderRolloutVerifier({ publicKeys, expected, loadInstalledEntrypoints, now = () => Date.now() }) {
  if (!publicKeys || !expected || typeof loadInstalledEntrypoints !== "function") {
    throw new Error("Reader rollout verifier needs trusted keys, fixed host identity, and installed-entrypoint inspection.");
  }
  return async function verifyReaderRolloutReceipt(receipt, evidence) {
    verifyImmutableReceipt(receipt, publicKeys);
    const fields = { ...receipt };
    delete fields.receiptDigest;
    delete fields.authoritySignature;
    const keys = Object.keys(receipt).sort();
    const supported = [...ROLLOUT_RECEIPT_KEYS].sort();
    if (keys.length !== supported.length || keys.some((key, index) => key !== supported[index])) {
      throw new Error("Reader rollout receipt has an unsupported closed schema.");
    }
    if (receipt.receiptSchemaVersion !== 1 || receipt.purpose !== "marker-reader-rollout" || receipt.markerReaderProtocolVersion !== 2) {
      throw new Error("Reader rollout receipt protocol is unsupported.");
    }
    if (Date.parse(receipt.expiresAt) <= now() || Date.parse(receipt.issuedAt) > now()) {
      throw new Error("Reader rollout receipt is expired or from the future.");
    }
    for (const key of ["repository", "canonicalMainSha", "reviewedManifestDigest", "entrypointsDigest",
      "hostTopologyIdentityDigest", "authorityVersion", "authorityBinaryDigest", "authorityConfigDigest",
      "installationReceiptDigest", "evidenceDigest"]) {
      if (receipt[key] !== expected[key]) throw new Error("Reader rollout receipt is stale or mismatched: " + key + ".");
    }
    assertGitSha(receipt.canonicalMainSha, "rollout.canonicalMainSha");
    for (const key of ["reviewedManifestDigest", "entrypointsDigest", "hostTopologyIdentityDigest", "authorityBinaryDigest",
      "authorityConfigDigest", "installationReceiptDigest", "evidenceDigest"]) assertSha256(receipt[key], "rollout." + key);
    const installed = await loadInstalledEntrypoints();
    if (canonicalDigest(installed) !== receipt.entrypointsDigest) throw new Error("Installed marker-reader/tooling manifest drifted after rollout.");
    if (evidence && evidence.markerReaderRolloutReceiptDigest
      && evidence.markerReaderRolloutReceiptDigest !== receipt.receiptDigest) {
      throw new Error("Recovery evidence binds a different marker-reader rollout receipt.");
    }
    return receipt;
  };
}

/** Only the installed host authority calls this after all compatibility checks pass. */
export function createReaderRolloutReceipt({
  repository,
  canonicalMainSha,
  reviewedManifest,
  installedEntrypoints,
  hostTopologyIdentityDigest,
  authorityInstallation,
  evidence,
  issuedAt,
  expiresAt,
}) {
  assertGitSha(canonicalMainSha, "canonicalMainSha");
  assertSha256(hostTopologyIdentityDigest, "hostTopologyIdentityDigest");
  if (!authorityInstallation?.authorityBinaryDigest || !authorityInstallation?.authorityConfigDigest
    || !authorityInstallation?.installationReceiptDigest) throw new Error("Verified authority installation provenance is required for rollout.");
  assertExactRolloutEvidence(evidence);
  return {
    receiptSchemaVersion: 1,
    purpose: "marker-reader-rollout",
    repository,
    canonicalMainSha,
    reviewedManifestDigest: canonicalDigest(reviewedManifest),
    entrypointsDigest: canonicalDigest(installedEntrypoints),
    markerReaderProtocolVersion: 2,
    hostTopologyIdentityDigest,
    authorityVersion: authorityInstallation.authorityVersion,
    authorityBinaryDigest: authorityInstallation.authorityBinaryDigest,
    authorityConfigDigest: authorityInstallation.authorityConfigDigest,
    installationReceiptDigest: authorityInstallation.installationReceiptDigest,
    evidenceDigest: canonicalDigest(evidence),
    issuedAt,
    expiresAt,
    authorityKeyId: authorityInstallation.authorityKeyId,
    authorityInstanceId: authorityInstallation.authorityInstanceId,
  };
}

export function assertExactRolloutEvidence(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) throw new Error("Reader rollout verification evidence is required.");
  const expectedKeys = ["compatibilityFixtures", "entrypointManifestVerified", "staleCheckoutRejected", "hostTopologyVerified", "authorityInstallVerified"];
  const actualKeys = Object.keys(evidence).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== [...expectedKeys].sort()[index])) {
    throw new Error("Reader rollout evidence has a missing or unsupported field.");
  }
  for (const key of ["entrypointManifestVerified", "staleCheckoutRejected", "hostTopologyVerified", "authorityInstallVerified"]) {
    if (evidence[key] !== true) throw new Error("Reader rollout evidence failed: " + key + ".");
  }
  const fixtures = evidence.compatibilityFixtures;
  const fixtureKeys = fixtures && typeof fixtures === "object" && !Array.isArray(fixtures) ? Object.keys(fixtures).sort() : [];
  const required = [...REQUIRED_READER_ROLLOUT_FIXTURES].sort();
  if (fixtureKeys.length !== required.length || fixtureKeys.some((key, index) => key !== required[index])
    || required.some((key) => fixtures[key] !== true)) {
    throw new Error("Reader compatibility fixtures are incomplete or did not fail closed.");
  }
  return true;
}

export async function collectReaderRolloutEvidence({ runCompatibilityFixture, verifyEntrypointManifest, verifyStaleCheckoutGate,
  verifyHostTopology, verifyAuthorityInstallation }) {
  for (const [name, fn] of Object.entries({ runCompatibilityFixture, verifyEntrypointManifest, verifyStaleCheckoutGate,
    verifyHostTopology, verifyAuthorityInstallation })) if (typeof fn !== "function") {
    throw new Error("Reader rollout evidence provider is missing: " + name + ".");
  }
  const compatibilityFixtures = {};
  for (const fixture of REQUIRED_READER_ROLLOUT_FIXTURES.filter((name) => !["staleCheckoutRejected", "changedEntrypointRejected", "callerFlagsCannotBypass"].includes(name))) {
    compatibilityFixtures[fixture] = await runCompatibilityFixture(fixture) === true;
  }
  const evidence = {
    compatibilityFixtures,
    entrypointManifestVerified: await verifyEntrypointManifest() === true,
    staleCheckoutRejected: await verifyStaleCheckoutGate() === true,
    hostTopologyVerified: await verifyHostTopology() === true,
    authorityInstallVerified: await verifyAuthorityInstallation() === true,
  };
  // These three cases are produced by the corresponding independently checked gates.
  compatibilityFixtures.staleCheckoutRejected = evidence.staleCheckoutRejected;
  compatibilityFixtures.changedEntrypointRejected = evidence.entrypointManifestVerified;
  compatibilityFixtures.callerFlagsCannotBypass = await runCompatibilityFixture("callerFlagsCannotBypass") === true;
  return Object.freeze({ ...evidence, compatibilityFixtures: Object.freeze(compatibilityFixtures) });
}

export { ROLLOUT_RECEIPT_KEYS };
