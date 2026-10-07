import { assertExactKeys, assertGitSha, assertNonEmptyString, assertSha256, assertUtcTimestamp, canonicalDigest } from "./canonical.mjs";

const OBSERVATION_KEYS = Object.freeze([
  "containerId", "releaseShaLabel", "imageId", "repositoryDigest", "artifactId", "artifactDigest",
  "composeProjectServiceIdentityDigest", "deployHostTopologyDigest", "capturedAt", "retainedUntil",
]);

/** Build the rollback binding only from a trusted host observation of the serving container. */
export function captureImmutableRollbackArtifact(observation, {
  failedReleaseSha,
  expectedRollbackAppSha,
  recoveryMustRemainAvailableUntil,
}) {
  assertExactKeys(observation, OBSERVATION_KEYS, "Serving rollback artifact observation");
  assertGitSha(failedReleaseSha, "failedReleaseSha");
  assertGitSha(expectedRollbackAppSha, "expectedRollbackAppSha");
  assertUtcTimestamp(recoveryMustRemainAvailableUntil, "recoveryMustRemainAvailableUntil");
  for (const key of ["containerId", "imageId", "repositoryDigest", "artifactId"]) assertNonEmptyString(observation[key], key);
  for (const key of ["artifactDigest", "composeProjectServiceIdentityDigest", "deployHostTopologyDigest"]) assertSha256(observation[key], key);
  assertGitSha(observation.releaseShaLabel, "releaseShaLabel");
  assertUtcTimestamp(observation.capturedAt, "capturedAt");
  assertUtcTimestamp(observation.retainedUntil, "retainedUntil");
  if (observation.releaseShaLabel !== expectedRollbackAppSha) throw new Error("Serving container release label does not match the host-captured pre-maintenance SHA.");
  if (!/^sha256:[a-f0-9]{64}$/.test(observation.imageId)) throw new Error("Serving image ID is not an immutable Docker image ID.");
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(observation.repositoryDigest)
    || observation.artifactId !== "oci://" + observation.repositoryDigest) {
    throw new Error("Rollback artifact reference is not the exact immutable registry digest.");
  }
  const repositoryDigest = observation.repositoryDigest.slice(observation.repositoryDigest.lastIndexOf("sha256:") + 7);
  if (observation.artifactDigest !== repositoryDigest) throw new Error("Captured image artifact digest differs from the immutable registry digest.");
  if (Date.parse(observation.retainedUntil) < Date.parse(recoveryMustRemainAvailableUntil)) {
    throw new Error("Captured rollback artifact retention expires before the reviewed recovery window.");
  }
  const attestation = {
    containerId: observation.containerId,
    servingReleaseSha: observation.releaseShaLabel,
    imageId: observation.imageId,
    repositoryDigest: observation.repositoryDigest,
    artifactId: observation.artifactId,
    artifactDigest: observation.artifactDigest,
    composeProjectServiceIdentityDigest: observation.composeProjectServiceIdentityDigest,
    deployHostTopologyDigest: observation.deployHostTopologyDigest,
    capturedAt: observation.capturedAt,
    retainedUntil: observation.retainedUntil,
  };
  return Object.freeze({
    failedReleaseSha,
    rollbackAppSha: observation.releaseShaLabel,
    rollbackContainerId: observation.containerId,
    rollbackImageId: observation.imageId,
    rollbackImageDigest: observation.artifactDigest,
    rollbackArtifactId: observation.artifactId,
    rollbackArtifactDigest: observation.artifactDigest,
    rollbackCaptureAttestationDigest: canonicalDigest(attestation),
    composeProjectServiceIdentityDigest: observation.composeProjectServiceIdentityDigest,
    deployHostTopologyDigest: observation.deployHostTopologyDigest,
    capturedAt: observation.capturedAt,
    retainedUntil: observation.retainedUntil,
  });
}

export function assertExactRollbackArtifact(expected, actual) {
  if (canonicalDigest(expected) !== canonicalDigest(actual)) {
    throw new Error("Recovery rollback image or artifact differs from the immutable pre-maintenance capture; rebuilt images are not accepted.");
  }
  return true;
}

export { OBSERVATION_KEYS };
