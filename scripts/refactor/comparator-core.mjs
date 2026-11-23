import { createHash } from "node:crypto";
import path from "node:path";

const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const REQUIRED_DATABASES = Object.freeze({
  before: {
    host: "127.0.0.1",
    port: 55436,
    database: "bodycast_refactor_before_test",
    role: "bodycast_refactor_before_test_runner",
  },
  after: {
    host: "127.0.0.1",
    port: 55437,
    database: "bodycast_refactor_after_test",
    role: "bodycast_refactor_after_test_runner",
  },
  auth: {
    before: {
      host: "127.0.0.1",
      port: 55435,
      database: "bodycast_training_postcommit_test",
      role: "bodycast_test_runner",
    },
    after: {
      host: "127.0.0.1",
      port: 55435,
      database: "bodycast_training_postcommit_test",
      role: "bodycast_test_runner",
    },
  },
});
const ALLOWLISTED_DATABASES = Object.freeze([
  REQUIRED_DATABASES.before,
  REQUIRED_DATABASES.after,
  REQUIRED_DATABASES.auth.before,
  REQUIRED_DATABASES.auth.after,
]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates.`);
}

export function parseComparatorArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--base-sha", "--candidate-sha", "--manifest", "--evidence-dir"].includes(flag)) {
      throw new Error(`Unknown comparator argument: ${flag}`);
    }
    if (values.has(flag)) throw new Error(`Duplicate comparator argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    values.set(flag, value);
    index += 1;
  }

  const baseSha = values.get("--base-sha");
  const candidateSha = values.get("--candidate-sha");
  const manifest = values.get("--manifest");
  const evidenceDir = values.get("--evidence-dir");
  if (!baseSha || !candidateSha || !manifest || !evidenceDir) {
    throw new Error("Required: --base-sha, --candidate-sha, --manifest, and --evidence-dir.");
  }
  if (!SHA_PATTERN.test(baseSha) || !SHA_PATTERN.test(candidateSha)) {
    throw new Error("Comparator SHA arguments must be full 40-character commit SHAs.");
  }
  return { baseSha: baseSha.toLowerCase(), candidateSha: candidateSha.toLowerCase(), manifest, evidenceDir };
}

export function validateRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) {
    throw new Error(`${label} must be a non-empty repository-relative POSIX path.`);
  }
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes("\0")
    || value.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`${label} must not escape the repository root.`);
  }
  return value;
}

export function validateManifest(value) {
  requireObject(value, "Manifest");
  if (value.schemaVersion !== 1) throw new Error("Unsupported comparator manifest schema.");
  if (!SHA_PATTERN.test(value.bootstrapBaseSha ?? "")) throw new Error("Manifest bootstrap base SHA is invalid.");
  validateRelativePath(value.fixtureTree, "Manifest fixtureTree");

  requireObject(value.postgres, "Manifest postgres");
  const database = value.postgres;
  if (database.image !== "docker.io/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24") {
    throw new Error("Manifest PostgreSQL image is not the repository-pinned image digest.");
  }
  if (database.legacyMigrationBaselineSha !== "0f93f37dd6a4208cfc74331a0fb4c063c542c6bd" || database.legacyMigrationCount !== 74) {
    throw new Error("Manifest legacy migration precondition does not match the audited CI baseline.");
  }
  for (const side of ["before", "after"]) {
    requireObject(database[side], `Manifest postgres.${side}`);
    for (const [key, expected] of Object.entries(REQUIRED_DATABASES[side])) {
      if (database[side][key] !== expected) throw new Error(`Manifest postgres.${side}.${key} must be the exact allowlisted value.`);
    }
  }
  if (!Array.isArray(database.snapshotTables) || database.snapshotTables.length === 0) {
    throw new Error("Manifest must list explicit persisted-state snapshot tables.");
  }
  for (const table of database.snapshotTables) {
    if (!IDENTIFIER_PATTERN.test(table)) throw new Error(`Unsafe PostgreSQL snapshot table name: ${table}`);
  }
  requireObject(database.auth, "Manifest postgres.auth");
  for (const side of ["before", "after"]) {
    requireObject(database.auth[side], "Manifest postgres.auth." + side);
    for (const [key, expected] of Object.entries(REQUIRED_DATABASES.auth[side])) {
      if (database.auth[side][key] !== expected) {
        throw new Error("Manifest postgres.auth." + side + "." + key + " must be the exact allowlisted value.");
      }
    }
  }
  requireUnique(database.snapshotTables, "Manifest snapshotTables");

  if (!Array.isArray(value.unitSuites) || value.unitSuites.length === 0) throw new Error("Manifest unitSuites are required.");
  if (!Array.isArray(value.integrationSuites) || value.integrationSuites.length === 0) throw new Error("Manifest integrationSuites are required.");
  if (!Array.isArray(value.observations) || value.observations.length === 0) throw new Error("Manifest observations are required.");

  const suiteIds = [];
  const unitPaths = [];
  for (const [index, suite] of value.unitSuites.entries()) {
    requireObject(suite, `Manifest unitSuites[${index}]`);
    if (typeof suite.id !== "string" || suite.id.length === 0) throw new Error(`Manifest unitSuites[${index}].id is invalid.`);
    if (!Array.isArray(suite.paths) || suite.paths.length === 0) throw new Error(`Manifest unitSuites[${index}].paths are required.`);
    suiteIds.push(suite.id);
    for (const file of suite.paths) unitPaths.push(validateRelativePath(file, `Manifest unitSuites[${index}] path`));
  }
  requireUnique(suiteIds, "Manifest suite IDs");
  requireUnique(unitPaths, "Manifest unit test paths");

  const observationIds = [];
  for (const [index, observation] of value.observations.entries()) {
    requireObject(observation, `Manifest observations[${index}]`);
    if (typeof observation.id !== "string" || !/^[A-Z0-9][A-Za-z0-9._/-]{1,180}$/.test(observation.id)) {
      throw new Error(`Manifest observations[${index}].id is invalid.`);
    }
    const source = validateRelativePath(observation.path, `Manifest observations[${index}].path`);
    if (!unitPaths.includes(source)) throw new Error(`Observation ${observation.id} is not covered by a unit suite.`);
    if (typeof observation.testName !== "string" || observation.testName.length === 0) {
      throw new Error(`Manifest observations[${index}].testName is invalid.`);
    }
    observationIds.push(observation.id);
  }
  requireUnique(observationIds, "Manifest observation IDs");

  for (const [index, suite] of value.integrationSuites.entries()) {
    requireObject(suite, `Manifest integrationSuites[${index}]`);
    if (typeof suite.id !== "string" || suite.id.length === 0) throw new Error(`Manifest integrationSuites[${index}].id is invalid.`);
    if (!Array.isArray(suite.args) || suite.args.some((arg) => typeof arg !== "string" || arg.length === 0)) {
      throw new Error(`Manifest integrationSuites[${index}].args are invalid.`);
    }
    if (suite.databaseProfile !== undefined && !["primary", "auth"].includes(suite.databaseProfile)) {
      throw new Error("Manifest integrationSuites[" + index + "].databaseProfile is invalid.");
    }
    if (suite.authEnvironment === true && suite.databaseProfile !== "auth") {
      throw new Error("Manifest integrationSuites[" + index + "] Auth suite must use the auth database profile.");
    }
    if (suite.databaseProfile === "auth" && suite.authEnvironment !== true) {
      throw new Error("Manifest integrationSuites[" + index + "] auth profile requires the Auth test environment.");
    }
    suiteIds.push(suite.id);
  }
  requireUnique(suiteIds, "Manifest suite IDs");
  const authSuites = value.integrationSuites.filter((suite) => suite.databaseProfile === "auth" && suite.authEnvironment === true);
  if (authSuites.length !== 1) throw new Error("Manifest must contain exactly one isolated Auth integration suite.");
  return value;
}

export function validateComparatorDatabaseUrl(databaseUrl, expected, mode) {
  if (mode !== "test") throw new Error("Comparator database mode must be test.");
  const isAllowlistedTarget = ALLOWLISTED_DATABASES.some((target) =>
    Object.keys(target).every((key) => expected?.[key] === target[key]),
  );
  if (!isAllowlistedTarget) throw new Error("Expected comparator database identity is not allowlisted.");
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Comparator database URL is invalid.");
  }
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== expected.host || parsed.port !== String(expected.port)) {
    throw new Error("Comparator database URL host or port is not the exact allowlisted target.");
  }
  let username;
  let database;
  try {
    username = decodeURIComponent(parsed.username);
    database = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error("Comparator database URL identity is malformed.");
  }
  if (username !== expected.role || database !== expected.database) {
    throw new Error("Comparator database URL role or database is not the exact allowlisted target.");
  }
  if (!parsed.password) throw new Error("Comparator database URL requires a test-only password.");
  if (parsed.search || parsed.hash) throw new Error("Comparator database URL cannot contain query options or fragments.");
  return { host: parsed.hostname, port: Number(parsed.port), database: decodeURIComponent(parsed.pathname.slice(1)), role: decodeURIComponent(parsed.username), mode };
}

export function canonicalizeJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("Comparator JSON numbers must be finite and cannot be negative zero.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError("Comparator JSON arrays cannot contain holes.");
      result.push(canonicalizeJson(value[index]));
    }
    return result;
  }
  if (typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError("Comparator evidence must contain only JSON-compatible values.");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Comparator JSON objects cannot contain symbol keys.");
  }
  const canonical = Object.create(null);
  for (const key of Object.keys(value).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("Comparator JSON objects cannot contain getters or non-enumerable fields.");
    }
    canonical[key] = canonicalizeJson(descriptor.value);
  }
  return canonical;
}

export function stableJson(value) {
  const serialized = JSON.stringify(canonicalizeJson(value));
  if (typeof serialized !== "string") throw new TypeError("Comparator value cannot be serialized as JSON.");
  return serialized;
}

function present(value) {
  return { present: true, value };
}

function missing() {
  return { present: false };
}

export function diffJson(before, after, currentPath = "$") {
  if (stableJson(before) === stableJson(after)) return [];
  const beforeObject = before !== null && typeof before === "object";
  const afterObject = after !== null && typeof after === "object";
  if (!beforeObject || !afterObject || Array.isArray(before) !== Array.isArray(after)) {
    return [{ path: currentPath, before: present(before), after: present(after) }];
  }
  if (Array.isArray(before)) {
    const differences = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= before.length || index >= after.length) {
        differences.push({
          path: currentPath + "[" + index + "]",
          before: index < before.length ? present(before[index]) : missing(),
          after: index < after.length ? present(after[index]) : missing(),
        });
      } else {
        differences.push(...diffJson(before[index], after[index], currentPath + "[" + index + "]"));
      }
    }
    return differences;
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const differences = [];
  for (const key of keys) {
    const beforeHasKey = Object.hasOwn(before, key);
    const afterHasKey = Object.hasOwn(after, key);
    if (!beforeHasKey || !afterHasKey) {
      differences.push({
        path: currentPath + "." + key,
        before: beforeHasKey ? present(before[key]) : missing(),
        after: afterHasKey ? present(after[key]) : missing(),
      });
    } else {
      differences.push(...diffJson(before[key], after[key], currentPath + "." + key));
    }
  }
  return differences;
}
export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}
