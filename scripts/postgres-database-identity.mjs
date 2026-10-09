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

export function isValidPostgresSystemIdentifier(value) {
  if (typeof value !== "string" || !/^-?[1-9][0-9]{0,18}$/.test(value)) return false;
  try {
    const parsed = BigInt(value);
    return parsed >= MIN_POSTGRES_SYSTEM_IDENTIFIER && parsed <= MAX_POSTGRES_SYSTEM_IDENTIFIER;
  } catch {
    return false;
  }
}

export function isCanonicalPostgresDatabaseIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)
    || Object.keys(identity).sort().join("\0") !== [...POSTGRES_DATABASE_IDENTITY_FIELDS].sort().join("\0")) {
    return false;
  }
  return typeof identity.database === "string" && identity.database.length > 0
    && Number.isSafeInteger(identity.databaseOid) && identity.databaseOid > 0 && identity.databaseOid <= MAX_POSTGRES_OID
    && isValidPostgresSystemIdentifier(identity.clusterSystemIdentifier)
    && typeof identity.role === "string" && identity.role.length > 0
    && typeof identity.serverVersion === "string" && identity.serverVersion.length > 0
    && typeof identity.serverAddress === "string" && identity.serverAddress.length > 0
    && Number.isInteger(identity.serverPort) && identity.serverPort > 0 && identity.serverPort <= 65535;
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
