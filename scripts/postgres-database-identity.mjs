import { isIP } from "node:net";
import { canonicalSha256 } from "./production-migration-authorization.mjs";

export const POSTGRES_DATABASE_IDENTITY_FIELDS = Object.freeze([
  "database",
  "databaseOid",
  "clusterSystemIdentifier",
  "role",
  "serverVersion",
  "serverAddress",
  "serverPort",
]);

const MAX_POSTGRES_OID = 0xffff_ffff;
const MIN_POSTGRES_SYSTEM_IDENTIFIER = -9_223_372_036_854_775_808n;
const MAX_POSTGRES_SYSTEM_IDENTIFIER = 9_223_372_036_854_775_807n;

function parsePositiveInteger(value, maximum) {
  let parsed;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    parsed = Number(value);
  } else {
    return null;
  }
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
}

function postgresAddress(value, { allowLegacyHostMask = false } = {}) {
  if (typeof value !== "string") return null;
  const family = isIP(value);
  if (family === 4 || family === 6) return { address: value, family };
  if (!allowLegacyHostMask) return null;
  const match = /^(.*)\/(32|128)$/.exec(value);
  if (!match) return null;
  const maskedFamily = isIP(match[1]);
  if ((maskedFamily === 4 && match[2] === "32") || (maskedFamily === 6 && match[2] === "128")) {
    return { address: match[1], family: maskedFamily };
  }
  return null;
}

function identityFieldsAreValid(identity, { allowLegacyHostMask = false } = {}) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)
    || Object.keys(identity).sort().join("\0") !== [...POSTGRES_DATABASE_IDENTITY_FIELDS].sort().join("\0")) {
    return false;
  }
  return typeof identity.database === "string" && identity.database.length > 0
    && Number.isSafeInteger(identity.databaseOid) && identity.databaseOid > 0 && identity.databaseOid <= MAX_POSTGRES_OID
    && isValidPostgresSystemIdentifier(identity.clusterSystemIdentifier)
    && typeof identity.role === "string" && identity.role.length > 0
    && typeof identity.serverVersion === "string" && identity.serverVersion.length > 0
    && postgresAddress(identity.serverAddress, { allowLegacyHostMask }) !== null
    && Number.isInteger(identity.serverPort) && identity.serverPort > 0 && identity.serverPort <= 65535;
}

export function isValidPostgresSystemIdentifier(value) {
  if (typeof value !== "string" || !/^-?[1-9][0-9]{0,18}$/.test(value)) return false;
  try {
    const parsed = BigInt(value);
    return parsed >= MIN_POSTGRES_SYSTEM_IDENTIFIER && parsed <= MAX_POSTGRES_SYSTEM_IDENTIFIER;
  } catch {
    return false;
  }
}

// Live SQL rows must use host(inet_server_addr()), which returns a bare IP
// literal. Historical artifacts may contain PostgreSQL's former /32 or /128
// rendering; that exact host mask is accepted only by artifact compatibility
// helpers below, never by the live row normalizer or endpoint binding.
export function isCanonicalPostgresDatabaseIdentity(identity) {
  return identityFieldsAreValid(identity);
}

export function isHistoricalPostgresDatabaseIdentity(identity) {
  return identityFieldsAreValid(identity, { allowLegacyHostMask: true });
}

export function normalizePostgresDatabaseIdentityRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("PostgreSQL identity query returned an invalid row.");
  }
  const identity = {
    database: row.database,
    databaseOid: parsePositiveInteger(row.databaseOid, MAX_POSTGRES_OID),
    clusterSystemIdentifier: row.clusterSystemIdentifier,
    role: row.role,
    serverVersion: row.serverVersion,
    serverAddress: row.serverAddress,
    serverPort: parsePositiveInteger(row.serverPort, 65535),
  };
  if (!isValidPostgresSystemIdentifier(identity.clusterSystemIdentifier)) {
    throw new Error("PostgreSQL identity query returned a missing or invalid clusterSystemIdentifier.");
  }
  if (!isCanonicalPostgresDatabaseIdentity(identity)) {
    throw new Error("PostgreSQL identity query returned an incomplete or invalid endpoint identity.");
  }
  return identity;
}

function hostMaskedIdentity(identity) {
  if (!isHistoricalPostgresDatabaseIdentity(identity)) return null;
  const address = postgresAddress(identity.serverAddress, { allowLegacyHostMask: true });
  return { ...identity, serverAddress: `${address.address}/${address.family === 4 ? 32 : 128}` };
}

export function postgresDatabaseIdentityHostProjection(identity) {
  if (!isHistoricalPostgresDatabaseIdentity(identity)) return null;
  const address = postgresAddress(identity.serverAddress, { allowLegacyHostMask: true });
  return { ...identity, serverAddress: address.address };
}

// The previous-app compatibility v1 digest was created from PostgreSQL's
// inet_server_addr()::text output (IPv4/32 or IPv6/128). Keep that exact digest
// projection for old capture/receipt bindings while new live reports carry the
// unmasked host() value. This does not alter the stored historical artifacts.
export function postgresDatabaseIdentityLegacyDigestProjection(identity) {
  return hostMaskedIdentity(identity);
}

// Live identity must be a validated bare-address identity. This matcher permits
// only the raw digest or the exact legacy host-mask digest for that same identity.
export function matchesPostgresDatabaseIdentityDigest(liveIdentity, digest) {
  if (!isCanonicalPostgresDatabaseIdentity(liveIdentity) || !/^[a-f0-9]{64}$/.test(String(digest ?? ""))) return false;
  return canonicalSha256(liveIdentity) === digest
    || canonicalSha256(hostMaskedIdentity(liveIdentity)) === digest;
}

// Compare identities across the old PostgreSQL text rendering and the current
// unmasked rendering. Callers must still enforce that an actual live identity
// passes isCanonicalPostgresDatabaseIdentity before using this compatibility.
export function samePostgresDatabaseIdentity(expected, actual) {
  if (!isHistoricalPostgresDatabaseIdentity(expected) || !isHistoricalPostgresDatabaseIdentity(actual)) return false;
  return canonicalSha256(postgresDatabaseIdentityHostProjection(expected))
    === canonicalSha256(postgresDatabaseIdentityHostProjection(actual));
}
