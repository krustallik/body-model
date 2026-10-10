import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClaimsFromPreflight, createAuthorizationEnvelope, canonicalSha256 } from "./production-migration-authorization.mjs";
import { verifyPreflightArtifactMetadata } from "./production-migration-release.mjs";
import { assertPinnedOwnerId } from "./github-owner-identity.mjs";
import { verifyForwardResumeContext, FORWARD_RESUME_FAILED_RUN_ID } from "./production-forward-resume.mjs";

async function json(file) { return JSON.parse(await readFile(file, "utf8")); }

export async function createSignedAuthorization({ evidence, report, restore, run, artifact, allowlist, keyId, privateKeyPem,
  executionMode = "standard", forwardResumeFailedRunId = "", now = Date.now() }) {
  const repository = "krustallik/body-model";
  if (evidence?.verified !== true || evidence?.repository !== repository) throw new Error("Preflight evidence is not verified for the canonical repository.");
  if (evidence.workflowPath !== ".github/workflows/production-migration-preflight.yml"
    || String(evidence.workflowRunId) !== String(run.id)
    || Number(evidence.workflowRunAttempt) !== Number(run.runAttempt)
    || evidence.releaseSha !== run.headSha || evidence.manifestId !== run.manifestId) {
    throw new Error("Preflight evidence does not match trusted GitHub workflow run metadata.");
  }
  if (run.status !== "completed" || run.conclusion !== "success" || run.event !== "workflow_dispatch" || run.headBranch !== "main"
    || run.workflowPath !== ".github/workflows/production-migration-preflight.yml"
    || run.repository !== repository || String(run.headSha) !== String(evidence.releaseSha)
    || String(run.displayTitle) !== "Preflight " + evidence.releaseSha + " " + evidence.manifestId) {
    throw new Error("Selected preflight run is not the latest successful exact-SHA workflow attempt.");
  }
  assertPinnedOwnerId(run.actorId, "Migration workflow actor ID");
  if (typeof run.runStartedAt !== "string" || !Number.isFinite(Date.parse(run.runStartedAt))
    || Date.parse(run.runStartedAt) > now + 60_000) {
    throw new Error("Selected preflight run lacks trusted admission metadata.");
  }
  if (canonicalSha256(report) !== evidence.preflightResultDigest) throw new Error("Preflight report digest differs from the attested digest.");
  if (canonicalSha256(restore) !== evidence.restoreResultDigest || restore?.verified !== true) throw new Error("Restore result digest or verified status is invalid.");
  if (canonicalSha256(report.identity) !== evidence.productionIdentityDigest) throw new Error("Production identity digest differs from the verified preflight report.");
  if (!/^[a-f0-9]{64}$/.test(String(report.logicalDataFingerprint ?? ""))
    || report.logicalDataFingerprint !== evidence.logicalDataFingerprint
    || restore?.logicalDataFingerprint !== report.logicalDataFingerprint) {
    throw new Error("Full logical data fingerprint does not match the current database and encrypted-backup restore.");
  }
  if (canonicalSha256(report.writerDrain) !== evidence.writerDrainDigest
    || canonicalSha256(report.writerDrain?.topology) !== evidence.writerTopologyDigest) {
    throw new Error("Writer-drain or topology digest differs from the verified preflight report.");
  }
  if (canonicalSha256([...report.pending].sort()) !== report.pendingSetDigest) throw new Error("Preflight pending-set digest is invalid.");
  if (report.readyForOwnerAuthorization !== true || report.manifestId !== evidence.manifestId) throw new Error("Preflight did not produce an owner-authorization-ready result.");
  let forwardResume;
  if (executionMode === "forward-resume") {
    if (String(forwardResumeFailedRunId) !== FORWARD_RESUME_FAILED_RUN_ID) {
      throw new Error("Forward-resume requires the exact explicitly owner-selected failed migration run.");
    }
    forwardResume = verifyForwardResumeContext(report.forwardResume, {
      targetSha: evidence.releaseSha, preflightRunId: String(run.id), preflightRunAttempt: Number(run.runAttempt),
    });
    if (forwardResume.sourceRunId !== String(forwardResumeFailedRunId)) {
      throw new Error("Forward-resume preflight is bound to a different failed migration run.");
    }
  } else if (executionMode === "standard") {
    if (forwardResumeFailedRunId || report.forwardResume) {
      throw new Error("A forward-resume preflight requires the separate explicit owner-authorized forward-resume mode.");
    }
  } else {
    throw new Error("Unsupported production migration execution mode.");
  }
  verifyPreflightArtifactMetadata(artifact, run);
  if (!/^[1-9][0-9]*$/.test(String(artifact.id)) || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest)) throw new Error("Backup artifact metadata is incomplete.");
  const snapshotMs = Date.parse(evidence.backupSnapshotAt);
  const issuedMs = now;
  const expiresMs = Math.min(issuedMs + 60 * 60 * 1000, snapshotMs + 60 * 60 * 1000);
  if (!Number.isFinite(snapshotMs) || expiresMs <= issuedMs) throw new Error("Preflight snapshot is already outside its authorization freshness window.");
  const claims = createClaimsFromPreflight({
    repository,
    workflowId: String(run.authorizationWorkflowId),
    workflowPath: ".github/workflows/production-migrate.yml",
    workflowRunId: String(run.authorizationRunId),
    workflowRunAttempt: Number(run.authorizationRunAttempt),
    actorId: String(run.actorId),
    releaseSha: evidence.releaseSha,
    currentMainSha: run.canonicalMainSha,
    manifestId: evidence.manifestId,
    pendingMigrationNames: report.pending,
    preflightRunId: String(run.id),
    preflightRunAttempt: Number(run.runAttempt),
    preflightRunStartedAt: run.runStartedAt,
    preflightResultDigest: evidence.preflightResultDigest,
    backupArtifactId: String(artifact.id),
    backupArtifactDigest: artifact.digest.replace(/^sha256:/, ""),
    backupSnapshotAt: evidence.backupSnapshotAt,
    restoreResultDigest: evidence.restoreResultDigest,
    productionIdentityDigest: evidence.productionIdentityDigest,
    writerDrainDigest: evidence.writerDrainDigest,
    writerTopologyDigest: evidence.writerTopologyDigest,
    snapshotDataFingerprint: report.logicalDataFingerprint,
    forwardResume,
    issuedAt: new Date(issuedMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    authorizationId: randomUUID(),
    nonce: randomUUID(),
  });
  const serialized = createAuthorizationEnvelope(claims, { keyId, privateKeyPem, allowlist });
  return { serialized, claims, digest: canonicalSha256(JSON.parse(serialized)) };
}

async function main() {
  const [evidencePath, reportPath, restorePath, runPath, artifactPath, outputPath] = process.argv.slice(2);
  if (![evidencePath, reportPath, restorePath, runPath, artifactPath, outputPath].every(Boolean)) {
    throw new Error("Usage: production-migration-sign.mjs <evidence.json> <preflight-report.json> <restore-result.json> <trusted-run.json> <trusted-artifact.json> <output-envelope.json>");
  }
  const [evidence, report, restore, run, artifact, allowlist] = await Promise.all([
    json(evidencePath), json(reportPath), json(restorePath), json(runPath), json(artifactPath),
    json(new URL("./production-migration-verification-keys.json", import.meta.url)),
  ]);
  const result = await createSignedAuthorization({
    evidence, report, restore, run, artifact, allowlist,
    keyId: process.env.PRODUCTION_MIGRATION_SIGNING_KEY_ID,
    privateKeyPem: process.env.PRODUCTION_MIGRATION_ED25519_PRIVATE_KEY,
    executionMode: process.env.BODYCAST_MIGRATION_EXECUTION_MODE ?? "standard",
    forwardResumeFailedRunId: process.env.BODYCAST_FORWARD_RESUME_FAILED_RUN_ID ?? "",
  });
  await writeFile(path.resolve(outputPath), `${result.serialized}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(JSON.stringify({ authorizationId: result.claims.authorizationId, digest: result.digest }) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
