import { assertExactKeys, assertNonEmptyString, assertSha256, canonicalDigest } from "./canonical.mjs";

const LOGICAL_IDENTITY_KEYS = Object.freeze([
  "deployRootIdentity", "hostTopologyIdentity", "composeProjectIdentity", "composeConfigurationDigest",
  "databaseService", "storageVolumeIdentity", "databaseName", "applicationRoleIdentity",
  "recoveryReadOnlyRoleIdentity", "backendNetworkIdentity", "applicationDatabaseBindingDigest",
]);
const SUPPORTING_OBSERVATION_KEYS = Object.freeze(["databaseOid", "host", "port", "serverVersion"]);

export function createLogicalDatabaseIdentity(identity) {
  assertExactKeys(identity, LOGICAL_IDENTITY_KEYS, "Logical production database identity");
  for (const key of LOGICAL_IDENTITY_KEYS) assertNonEmptyString(identity[key], key);
  for (const key of ["composeConfigurationDigest", "applicationDatabaseBindingDigest"]) assertSha256(identity[key], key);
  return Object.freeze({ identity, identityDigest: canonicalDigest(identity) });
}

export function verifySameLogicalDatabaseIdentity(expected, actual) {
  const expectedIdentity = createLogicalDatabaseIdentity(expected);
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) throw new Error("Observed database identity is malformed.");
  const actualKeys = Object.keys(actual);
  if (LOGICAL_IDENTITY_KEYS.some((key) => !actualKeys.includes(key))
    || actualKeys.some((key) => !LOGICAL_IDENTITY_KEYS.includes(key) && !SUPPORTING_OBSERVATION_KEYS.includes(key))) {
    throw new Error("Observed database identity has missing or unsupported fields.");
  }
  for (const key of SUPPORTING_OBSERVATION_KEYS) {
    if (actual[key] !== undefined && !["string", "number"].includes(typeof actual[key])) {
      throw new Error("Supporting database observation is not a scalar: " + key + ".");
    }
  }
  const actualLogical = Object.fromEntries(LOGICAL_IDENTITY_KEYS.map((key) => [key, actual[key]]));
  const actualIdentity = createLogicalDatabaseIdentity(actualLogical);
  if (expectedIdentity.identityDigest !== actualIdentity.identityDigest) {
    throw new Error("Recovery target is not the same logical in-place production database and topology.");
  }
  return Object.freeze({
    identityDigest: expectedIdentity.identityDigest,
    observationsDigest: canonicalDigest(Object.fromEntries(SUPPORTING_OBSERVATION_KEYS.filter((key) => actual[key] !== undefined)
      .map((key) => [key, actual[key]]))),
  });
}

export { LOGICAL_IDENTITY_KEYS, SUPPORTING_OBSERVATION_KEYS };
