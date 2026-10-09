import { assertExactKeys, assertNonEmptyString, assertSha256, assertUtcTimestamp, canonicalDigest } from "./canonical.mjs";

const DRAIN_KEYS = Object.freeze([
  "schemaVersion", "purpose", "logicalProductionDbIdentityDigest", "topologyDigest", "observedAt",
  "appContainerStopped", "readOnlyRecoveryAppStopped", "restartDisabled", "activeAppWriterSessions",
  "readOnlyRecoveryAppSessions", "otherDatabaseWriters", "writerRoleIdentity", "observationSequence",
]);

export function verifyWriterDrainEvidence(evidence, {
  logicalProductionDbIdentityDigest,
  topologyDigest,
  expectedWriterRoleIdentity,
  now = Date.now(),
  maxAgeMs = 60_000,
}) {
  assertExactKeys(evidence, DRAIN_KEYS, "Writer drain evidence");
  if (evidence.schemaVersion !== 1 || evidence.purpose !== "recovery-writer-drain") throw new Error("Writer drain evidence schema or purpose is invalid.");
  for (const key of ["logicalProductionDbIdentityDigest", "topologyDigest"]) assertSha256(evidence[key], key);
  assertUtcTimestamp(evidence.observedAt, "writerDrain.observedAt");
  assertNonEmptyString(evidence.writerRoleIdentity, "writerDrain.writerRoleIdentity");
  if (evidence.logicalProductionDbIdentityDigest !== logicalProductionDbIdentityDigest || evidence.topologyDigest !== topologyDigest
    || evidence.writerRoleIdentity !== expectedWriterRoleIdentity) throw new Error("Writer drain evidence is bound to a different database, topology, or canonical writer role.");
  if (Date.parse(evidence.observedAt) > now || now - Date.parse(evidence.observedAt) > maxAgeMs) throw new Error("Writer drain evidence is stale or future-dated.");
  for (const key of ["appContainerStopped", "readOnlyRecoveryAppStopped", "restartDisabled"]) {
    if (evidence[key] !== true) throw new Error("Writer drain gate is incomplete: " + key + ".");
  }
  for (const key of ["activeAppWriterSessions", "readOnlyRecoveryAppSessions", "otherDatabaseWriters"]) {
    if (!Number.isSafeInteger(evidence[key]) || evidence[key] !== 0) throw new Error("Writer drain found an active database writer/session: " + key + ".");
  }
  if (!Number.isSafeInteger(evidence.observationSequence) || evidence.observationSequence < 2) {
    throw new Error("Writer drain requires at least two ordered PostgreSQL observations.");
  }
  return Object.freeze({ evidenceDigest: canonicalDigest(evidence), observedAt: evidence.observedAt, observationSequence: evidence.observationSequence });
}

/** Stop, observe twice, and require the final snapshot to remain writer-free. */
export function createWriterDrainVerifier({ stopReadOnlyApp, observePostgres, recheckTopology, waitForStableSample }) {
  for (const [name, fn] of Object.entries({ stopReadOnlyApp, observePostgres, recheckTopology, waitForStableSample })) {
    if (typeof fn !== "function") throw new Error("Trusted writer drain dependency is required: " + name + ".");
  }
  return async function drainAndVerify(expected) {
    await stopReadOnlyApp({ expectedContainerId: expected.rollbackContainerId, restartDisabled: true });
    const first = await observePostgres();
    await waitForStableSample();
    const second = await observePostgres();
    const topology = await recheckTopology();
    if (canonicalDigest(first.logicalIdentity) !== canonicalDigest(second.logicalIdentity)) throw new Error("Logical database identity changed during writer drain.");
    if (canonicalDigest(first.topology) !== canonicalDigest(second.topology)
      || canonicalDigest(second.topology) !== canonicalDigest(topology)) throw new Error("Host topology changed during writer drain.");
    const evidence = { ...second };
    delete evidence.logicalIdentity;
    delete evidence.topology;
    evidence.observationSequence = Math.max(first.observationSequence, second.observationSequence);
    return verifyWriterDrainEvidence(evidence, expected);
  };
}

export { DRAIN_KEYS };
