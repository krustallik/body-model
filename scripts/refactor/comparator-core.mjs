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
const PINNED_POSTGRES_IMAGE = "docker.io/library/postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";
const LEGACY_DATABASE_CLOCK_FIELD_POLICY = Object.freeze({
  PhysiologyV7Lifecycle: Object.freeze({ createdAt: "zoned-timestamp", updatedAt: "zoned-timestamp" }),
  UnifiedPublicationBlock: Object.freeze({ createdAt: "zoned-timestamp", updatedAt: "zoned-timestamp" }),
  Profile: Object.freeze({ updatedAt: "local-timestamp" }),
});
const DATABASE_CLOCK_FIELD_POLICY = Object.freeze({
  PhysiologyV7Lifecycle: Object.freeze({ createdAt: "zoned-timestamp", updatedAt: "zoned-timestamp" }),
  UnifiedPublicationBlock: Object.freeze({ createdAt: "zoned-timestamp", updatedAt: "zoned-timestamp" }),
  PhysiologyV7DailyResult: Object.freeze({ createdAt: "zoned-timestamp", updatedAt: "zoned-timestamp" }),
  PhysiologyV7ShadowDiagnostic: Object.freeze({ createdAt: "zoned-timestamp", updatedAt: "zoned-timestamp" }),
  Profile: Object.freeze({ updatedAt: "local-timestamp" }),
});

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates.`);
}

function requireExactKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new Error(`${label} contains unsupported fields: ${unexpected.join(", ")}.`);
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

export function validateResolvedPostgresImage(image, repoDigests) {
  if (image !== PINNED_POSTGRES_IMAGE || !Array.isArray(repoDigests)) {
    throw new Error("Comparator PostgreSQL image reference or digest inventory is invalid.");
  }
  const requestedDigest = image.match(/@sha256:([a-f0-9]{64})$/)?.[1];
  if (!requestedDigest || !repoDigests.some((entry) => typeof entry === "string" && entry.endsWith(`@sha256:${requestedDigest}`))) {
    throw new Error("Comparator PostgreSQL image does not resolve to the pinned content digest.");
  }
  return `sha256:${requestedDigest}`;
}

export function validateManifest(value) {
  requireObject(value, "Manifest");
  if (value.schemaVersion !== 1) throw new Error("Unsupported comparator manifest schema.");
  if (!SHA_PATTERN.test(value.bootstrapBaseSha ?? "")) throw new Error("Manifest bootstrap base SHA is invalid.");
  validateRelativePath(value.fixtureTree, "Manifest fixtureTree");
  requireObject(value.determinism, "Manifest determinism");
  if (typeof value.determinism.clock !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.determinism.clock)
    || !Number.isFinite(Date.parse(value.determinism.clock))
    || new Date(value.determinism.clock).toISOString() !== value.determinism.clock) {
    throw new Error("Manifest deterministic clock must be a canonical UTC ISO timestamp.");
  }
  if (typeof value.determinism.randomSeed !== "string" || value.determinism.randomSeed.length < 8
    || value.determinism.randomSeed.length > 128 || !/^[A-Za-z0-9._-]+$/.test(value.determinism.randomSeed)) {
    throw new Error("Manifest deterministic random seed is invalid.");
  }

  requireObject(value.postgres, "Manifest postgres");
  const database = value.postgres;
  if (database.image !== PINNED_POSTGRES_IMAGE) {
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
  requireObject(database.databaseClockFields, "Manifest postgres.databaseClockFields");
  const clockTables = Object.entries(database.databaseClockFields);
  if (clockTables.length === 0) throw new Error("Manifest databaseClockFields must explicitly identify clock-derived persisted fields.");
  for (const [table, fields] of clockTables) {
    if (!database.snapshotTables.includes(table)) throw new Error(`Database clock field table is not in snapshotTables: ${table}`);
    requireObject(fields, `Database clock fields for ${table}`);
    const entries = Object.entries(fields);
    if (entries.length === 0) throw new Error(`Database clock fields for ${table} must be a non-empty object.`);
    for (const [field, kind] of entries) {
      if (!IDENTIFIER_PATTERN.test(field)) throw new Error(`Unsafe database clock field for ${table}.`);
      if (![
        "zoned-timestamp",
        "local-timestamp",
        "epoch-seconds",
      ].includes(kind)) throw new Error(`Unsupported database clock field kind for ${table}.${field}.`);
    }
  }
  if (stableJson(database.databaseClockFields) !== stableJson(DATABASE_CLOCK_FIELD_POLICY)
    && stableJson(database.databaseClockFields) !== stableJson(LEGACY_DATABASE_CLOCK_FIELD_POLICY)) {
    throw new Error("Manifest databaseClockFields must match an exact reviewed clock-field policy.");
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
    requireExactKeys(suite, ["id", "paths"], `Manifest unitSuites[${index}]`);
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
    requireExactKeys(observation, ["id", "path", "testName", "integrationSuiteId"], `Manifest observations[${index}]`);
    if (typeof observation.id !== "string" || !/^[A-Z0-9][A-Za-z0-9._/-]{1,180}$/.test(observation.id)) {
      throw new Error(`Manifest observations[${index}].id is invalid.`);
    }
    const source = validateRelativePath(observation.path, `Manifest observations[${index}].path`);
    const integrationSuiteId = observation.integrationSuiteId;
    if (integrationSuiteId !== undefined && (typeof integrationSuiteId !== "string" || integrationSuiteId.length === 0)) {
      throw new Error(`Observation ${observation.id} has an invalid integrationSuiteId.`);
    }
    if (integrationSuiteId === undefined && !unitPaths.includes(source)) {
      throw new Error(`Observation ${observation.id} is not covered by a unit suite.`);
    }
    if (typeof observation.testName !== "string" || observation.testName.length === 0) {
      throw new Error(`Manifest observations[${index}].testName is invalid.`);
    }
    observationIds.push(observation.id);
  }
  requireUnique(observationIds, "Manifest observation IDs");

  for (const [index, suite] of value.integrationSuites.entries()) {
    requireObject(suite, `Manifest integrationSuites[${index}]`);
    requireExactKeys(suite, ["id", "args", "databaseProfile", "authEnvironment", "clockMode"], `Manifest integrationSuites[${index}]`);
    if (typeof suite.id !== "string" || suite.id.length === 0) throw new Error(`Manifest integrationSuites[${index}].id is invalid.`);
    if (!Array.isArray(suite.args) || suite.args.some((arg) => typeof arg !== "string" || arg.length === 0)) {
      throw new Error(`Manifest integrationSuites[${index}].args are invalid.`);
    }
    for (const [argIndex, arg] of suite.args.entries()) {
      validateRelativePath(arg, `Manifest integrationSuites[${index}].args[${argIndex}]`);
      if (!arg.startsWith("tests/integration/") || !arg.endsWith(".integration.test.ts")) {
        throw new Error(`Manifest integrationSuites[${index}] may run only explicit integration test files.`);
      }
    }
    if (suite.databaseProfile !== undefined && !["primary", "auth"].includes(suite.databaseProfile)) {
      throw new Error("Manifest integrationSuites[" + index + "].databaseProfile is invalid.");
    }
    if (suite.authEnvironment === true && suite.databaseProfile !== "auth") {
      throw new Error("Manifest integrationSuites[" + index + "] Auth suite must use the auth database profile.");
    }
    if (suite.clockMode !== undefined && !["frozen", "native"].includes(suite.clockMode)) {
      throw new Error("Manifest integrationSuites[" + index + "] clockMode must be frozen or native.");
    }
    if (suite.databaseProfile === "auth" && suite.authEnvironment !== true) {
      throw new Error("Manifest integrationSuites[" + index + "] auth profile requires the Auth test environment.");
    }
    if (suite.databaseProfile === "auth" && suite.clockMode !== "native") {
      throw new Error("Manifest Auth integration suite must retain native endpoint time.");
    }
    suiteIds.push(suite.id);
  }
  requireUnique(suiteIds, "Manifest suite IDs");
  const authSuites = value.integrationSuites.filter((suite) => suite.databaseProfile === "auth" && suite.authEnvironment === true);
  if (authSuites.length !== 1) throw new Error("Manifest must contain exactly one isolated Auth integration suite.");

  const integrationById = new Map(value.integrationSuites.map((suite) => [suite.id, suite]));
  for (const observation of value.observations) {
    if (observation.integrationSuiteId === undefined) continue;
    const suite = integrationById.get(observation.integrationSuiteId);
    if (!suite || !suite.args.includes(observation.path)) {
      throw new Error(`Integration observation ${observation.id} is not covered by its declared suite.`);
    }
  }

  if (value.caseGroups !== undefined) {
    if (!Array.isArray(value.caseGroups) || value.caseGroups.length === 0) {
      throw new Error("Manifest caseGroups must be a non-empty array when present.");
    }
    const groupIds = [];
    for (const [index, group] of value.caseGroups.entries()) {
      requireObject(group, `Manifest caseGroups[${index}]`);
      requireExactKeys(group, ["id", "unitPaths", "integrationSuiteIds", "observationIds", "databaseStateSuiteIds", "inputFiles", "uiEvidence"], `Manifest caseGroups[${index}]`);
      if (typeof group.id !== "string" || !/^[A-Z0-9][A-Za-z0-9._/-]{1,120}$/.test(group.id)) {
        throw new Error(`Manifest caseGroups[${index}].id is invalid.`);
      }
      groupIds.push(group.id);
      for (const key of ["unitPaths", "integrationSuiteIds", "observationIds", "databaseStateSuiteIds", "inputFiles"]) {
        if (!Array.isArray(group[key])) throw new Error(`Manifest case group ${group.id}.${key} must be an array.`);
      }
      if (group.unitPaths.length === 0 && group.integrationSuiteIds.length === 0
        && group.observationIds.length === 0 && group.databaseStateSuiteIds.length === 0
        && group.uiEvidence === undefined) {
        throw new Error(`Manifest case group ${group.id} has no executable or frozen output evidence.`);
      }
      for (const file of group.unitPaths) {
        validateRelativePath(file, `Manifest case group ${group.id} unit path`);
        if (!unitPaths.includes(file)) throw new Error(`Manifest case group ${group.id} references an unfrozen unit path.`);
      }
      for (const suiteId of group.integrationSuiteIds) {
        if (!integrationById.has(suiteId)) throw new Error(`Manifest case group ${group.id} references an unknown integration suite.`);
      }
      for (const suiteId of group.databaseStateSuiteIds) {
        if (!integrationById.has(suiteId) || !group.integrationSuiteIds.includes(suiteId)) {
          throw new Error(`Manifest case group ${group.id} database projection is not backed by an included integration suite.`);
        }
      }
      for (const observationId of group.observationIds) {
        if (!observationIds.includes(observationId)) throw new Error(`Manifest case group ${group.id} references an unknown observation.`);
      }
      if (group.inputFiles.length === 0) throw new Error(`Manifest case group ${group.id} must pin at least one input fixture or frozen evidence file.`);
      for (const [fileIndex, input] of group.inputFiles.entries()) {
        requireObject(input, `Manifest case group ${group.id}.inputFiles[${fileIndex}]`);
        requireExactKeys(input, ["path", "sha256"], `Manifest case group ${group.id}.inputFiles[${fileIndex}]`);
        validateRelativePath(input.path, `Manifest case group ${group.id} input path`);
        if (typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256)) {
          throw new Error(`Manifest case group ${group.id} input SHA-256 is invalid.`);
        }
      }
      if (group.uiEvidence !== undefined) {
        requireObject(group.uiEvidence, `Manifest case group ${group.id}.uiEvidence`);
        requireExactKeys(group.uiEvidence, ["path", "sha256"], `Manifest case group ${group.id}.uiEvidence`);
        validateRelativePath(group.uiEvidence.path, `Manifest case group ${group.id} UI evidence path`);
        if (typeof group.uiEvidence.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(group.uiEvidence.sha256)) {
          throw new Error(`Manifest case group ${group.id} UI evidence SHA-256 is invalid.`);
        }
      }
    }
    requireUnique(groupIds, "Manifest case group IDs");
  }
  return value;
}

function assertPrefixExtension(before, after, label) {
  if (!Array.isArray(before) || !Array.isArray(after) || after.length < before.length
    || stableJson(after.slice(0, before.length)) !== stableJson(before)) {
    throw new Error(`Comparator manifest extension changed or reordered frozen ${label}.`);
  }
}

/**
 * A stage may enlarge the frozen corpus, but may not weaken or rewrite any
 * contract already accepted on its base. The candidate harness is then
 * overlaid byte-for-byte onto both source trees for the comparison.
 */
export function assertAdditiveManifestExtension(baseValue, candidateValue) {
  const base = validateManifest(baseValue);
  const candidate = validateManifest(candidateValue);
  const stableFields = (value) => {
    const { unitSuites: _unitSuites, integrationSuites: _integrationSuites, observations: _observations,
      caseGroups: _caseGroups, ...stable } = value;
    const { databaseClockFields: _databaseClockFields, ...stablePostgres } = stable.postgres;
    return { ...stable, postgres: stablePostgres };
  };
  if (stableJson(stableFields(base)) !== stableJson(stableFields(candidate))) {
    throw new Error("Comparator manifest extension changed a frozen runtime, fixture, database, schema, or safety contract.");
  }
  const baseClockPolicy = stableJson(base.postgres.databaseClockFields);
  const candidateClockPolicy = stableJson(candidate.postgres.databaseClockFields);
  const exactClockPolicyExtension = baseClockPolicy === stableJson(LEGACY_DATABASE_CLOCK_FIELD_POLICY)
    && candidateClockPolicy === stableJson(DATABASE_CLOCK_FIELD_POLICY);
  if (baseClockPolicy !== candidateClockPolicy && !exactClockPolicyExtension) {
    throw new Error("Comparator manifest extension changed the exact reviewed database clock-field policy.");
  }
  assertPrefixExtension(base.unitSuites.map(({ id }) => id), candidate.unitSuites.map(({ id }) => id), "unit suite order");
  assertPrefixExtension(base.integrationSuites.map(({ id }) => id), candidate.integrationSuites.map(({ id }) => id), "integration suite order");
  assertPrefixExtension(base.observations, candidate.observations, "observations");
  const baseGroups = base.caseGroups ?? [];
  const candidateGroups = candidate.caseGroups ?? [];
  assertPrefixExtension(baseGroups, candidateGroups, "case groups");

  const candidateUnits = new Map(candidate.unitSuites.map((suite) => [suite.id, suite]));
  for (const suite of base.unitSuites) {
    const extended = candidateUnits.get(suite.id);
    if (!extended) throw new Error(`Comparator manifest extension removed frozen unit suite ${suite.id}.`);
    const { paths: _paths, ...beforeMetadata } = suite;
    const { paths: _extendedPaths, ...afterMetadata } = extended;
    if (stableJson(beforeMetadata) !== stableJson(afterMetadata)) {
      throw new Error(`Comparator manifest extension changed frozen unit suite metadata for ${suite.id}.`);
    }
    assertPrefixExtension(suite.paths, extended.paths, `unit paths in ${suite.id}`);
  }

  const candidateIntegrations = new Map(candidate.integrationSuites.map((suite) => [suite.id, suite]));
  for (const suite of base.integrationSuites) {
    const extended = candidateIntegrations.get(suite.id);
    if (!extended) throw new Error(`Comparator manifest extension removed frozen integration suite ${suite.id}.`);
    const { args: _args, ...beforeMetadata } = suite;
    const { args: _extendedArgs, ...afterMetadata } = extended;
    if (stableJson(beforeMetadata) !== stableJson(afterMetadata)) {
      throw new Error(`Comparator manifest extension changed frozen integration suite metadata for ${suite.id}.`);
    }
    assertPrefixExtension(suite.args, extended.args, `integration args in ${suite.id}`);
  }

  const baseObservationIds = new Set(base.observations.map(({ id }) => id));
  return {
    additive: stableJson(base) !== stableJson(candidate),
    addedUnitSuites: candidate.unitSuites.filter(({ id }) => !base.unitSuites.some((item) => item.id === id)).map(({ id }) => id),
    addedIntegrationSuites: candidate.integrationSuites.filter(({ id }) => !base.integrationSuites.some((item) => item.id === id)).map(({ id }) => id),
    addedUnitPaths: candidate.unitSuites.flatMap(({ id, paths }) => {
      const old = base.unitSuites.find((item) => item.id === id)?.paths ?? [];
      return paths.filter((item) => !old.includes(item));
    }),
    addedIntegrationArgs: candidate.integrationSuites.flatMap(({ id, args }) => {
      const old = base.integrationSuites.find((item) => item.id === id)?.args ?? [];
      return args.filter((item) => !old.includes(item));
    }),
    addedObservations: candidate.observations.filter(({ id }) => !baseObservationIds.has(id)).map(({ id }) => id),
    addedCaseGroups: candidateGroups.filter(({ id }) => !baseGroups.some((item) => item.id === id)).map(({ id }) => id),
  };
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

const CLOCK_COLUMN_METADATA_KEYS = Object.freeze(["table", "field", "dataType", "datetimePrecision", "nullable"]);

function expectedClockColumnMetadata(table, field, kind) {
  if (kind === "zoned-timestamp") {
    return { table, field, dataType: "timestamp with time zone", datetimePrecision: 3, nullable: false };
  }
  if (kind === "local-timestamp") {
    return { table, field, dataType: "timestamp without time zone", datetimePrecision: 3, nullable: false };
  }
  if (kind === "epoch-seconds") {
    return { table, field, dataType: "integer", datetimePrecision: null, nullable: false };
  }
  throw new Error("Unsupported persisted clock field kind for " + table + "." + field + ".");
}

export function validateDatabaseClockColumnMetadata(metadata, databaseClockFields) {
  if (!Array.isArray(metadata)) throw new Error("Persisted state is missing database clock column metadata.");
  requireObject(databaseClockFields, "Persisted clock field policy");
  const expected = Object.entries(databaseClockFields).flatMap(([table, fields]) =>
    Object.entries(fields).map(([field, kind]) => expectedClockColumnMetadata(table, field, kind)))
    .sort((left, right) => {
      const leftKey = left.table + "\0" + left.field;
      const rightKey = right.table + "\0" + right.field;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  const actual = metadata.map((item, index) => {
    requireObject(item, "Database clock column metadata " + index);
    requireExactKeys(item, CLOCK_COLUMN_METADATA_KEYS, "Database clock column metadata " + index);
    if (item.nullable !== true && item.nullable !== false && item.nullable !== "YES" && item.nullable !== "NO") {
      throw new Error("PostgreSQL clock column nullability must be the exact YES/NO catalog value.");
    }
    return { ...item, nullable: item.nullable === true || item.nullable === "YES" };
  });
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error("PostgreSQL clock column type, precision, or nullability differs from the exact reviewed policy.");
  }
  return actual;
}

function parseUtcTimestampMicroseconds(value, kind, label, { anchor = false } = {}) {
  const match = typeof value === "string"
    ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|\+00:00)?$/)
    : null;
  const validSuffix = anchor ? match?.[8] === "Z"
    : kind === "zoned-timestamp" ? match?.[8] === "Z" || match?.[8] === "+00:00"
      : kind === "local-timestamp" ? match?.[8] === undefined
        : false;
  const fraction = match?.[7] ?? "";
  if (!match || !validSuffix || (anchor ? fraction.length !== 6 : fraction.length > 3)) {
    throw new Error(label + " must have the reviewed UTC timestamp format and precision.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fractionMicros = BigInt(fraction.padEnd(6, "0"));
  const milliseconds = Number(fractionMicros / 1000n);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31
    || hour > 23 || minute > 59 || second > 59
    || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second
    || date.getUTCMilliseconds() !== milliseconds) {
    throw new Error(label + " must be a valid UTC timestamp.");
  }
  return BigInt(date.getTime()) * 1000n + (fractionMicros % 1000n);
}

function clockValueMicroseconds(value, kind, label) {
  if (kind === "epoch-seconds") {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(label + " must be a non-negative integer epoch timestamp.");
    }
    return BigInt(value) * 1_000_000n;
  }
  return parseUtcTimestampMicroseconds(value, kind, label);
}

export function projectPersistedStateForComparison(persisted, databaseClockFields) {
  requireObject(persisted, "Persisted database state");
  requireObject(persisted.tables, "Persisted database tables");
  requireObject(databaseClockFields, "Persisted clock field policy");
  validateDatabaseClockColumnMetadata(persisted.clockColumnMetadata, databaseClockFields);
  const comparable = structuredClone(persisted);
  const clockEvidence = [];

  for (const [tableName, fields] of Object.entries(databaseClockFields)) {
    const table = persisted.tables[tableName];
    if (!table || !Array.isArray(table.primaryKey) || !Array.isArray(table.rows)) {
      throw new Error(`Persisted state is missing the configured database clock table: ${tableName}`);
    }
    comparable.tables[tableName].rows = table.rows.map((rowJson, index) => {
      if (typeof rowJson !== "string") throw new Error(`Persisted ${tableName} row ${index} is not a JSON string.`);
      let row;
      try {
        row = JSON.parse(rowJson);
      } catch {
        throw new Error(`Persisted ${tableName} row ${index} is invalid JSON.`);
      }
      requireObject(row, `Persisted ${tableName} row ${index}`);
      const primaryKey = {};
      for (const key of table.primaryKey) {
        if (!Object.hasOwn(row, key)) throw new Error(`Persisted ${tableName} row ${index} is missing primary key ${key}.`);
        primaryKey[key] = row[key];
      }

      const timestampValues = {};
      const parsedTimestampValues = {};
      for (const [field, kind] of Object.entries(fields)) {
        const value = row[field];
        if (!["zoned-timestamp", "local-timestamp", "epoch-seconds"].includes(kind)) {
          throw new Error(`Unsupported persisted clock field kind for ${tableName}.${field}.`);
        }
        parsedTimestampValues[field] = clockValueMicroseconds(
          value,
          kind,
          "Persisted " + tableName + "." + field,
        );
        timestampValues[field] = value;
        delete row[field];
      }
      if (parsedTimestampValues.createdAt !== undefined && parsedTimestampValues.updatedAt !== undefined
        && parsedTimestampValues.createdAt > parsedTimestampValues.updatedAt) {
        throw new Error(`Persisted ${tableName} createdAt must not be after updatedAt.`);
      }
      clockEvidence.push({ table: tableName, primaryKey, fields: timestampValues });
      return row;
    });
  }

  return { comparable, clockEvidence };
}

export function deriveDatabaseClockTransitions(initialEvidence, finalEvidence, databaseClockFields) {
  if (!Array.isArray(initialEvidence) || !Array.isArray(finalEvidence)) {
    throw new TypeError("Database clock transition evidence must be arrays.");
  }
  requireObject(databaseClockFields, "Persisted clock field policy");
  const toMap = (evidence, label) => {
    const result = new Map();
    for (const entry of evidence) {
      if (!entry || typeof entry.table !== "string" || !entry.primaryKey || typeof entry.primaryKey !== "object"
        || !entry.fields || typeof entry.fields !== "object") {
        throw new Error(`${label} contains malformed database clock evidence.`);
      }
      const key = `${entry.table}\0${stableJson(entry.primaryKey)}`;
      if (result.has(key)) throw new Error(`${label} contains duplicate primary keys.`);
      result.set(key, entry);
    }
    return result;
  };
  const initial = toMap(initialEvidence, "Initial database clock evidence");
  const final = toMap(finalEvidence, "Final database clock evidence");
  const result = [];
  for (const table of Object.keys(databaseClockFields).sort()) {
    const tableKeys = [...new Set([
      ...[...initial.entries()].filter(([, entry]) => entry.table === table).map(([key]) => key),
      ...[...final.entries()].filter(([, entry]) => entry.table === table).map(([key]) => key),
    ])].sort();
    for (const key of tableKeys) {
      const before = initial.get(key);
      const after = final.get(key);
      const fields = {};
      for (const field of Object.keys(databaseClockFields[table])) {
        fields[field] = before === undefined ? "created"
          : after === undefined ? "deleted"
            : before.fields[field] === after.fields[field] ? "unchanged" : "updated";
      }
      result.push({ table, primaryKey: (after ?? before).primaryKey, fields });
    }
  }
  return result;
}

function databaseClockEvidenceMap(evidence, label) {
  if (!Array.isArray(evidence)) throw new TypeError(label + " must be an array.");
  const result = new Map();
  for (const entry of evidence) {
    if (!entry || typeof entry.table !== "string" || !entry.primaryKey
      || typeof entry.primaryKey !== "object" || Array.isArray(entry.primaryKey)
      || !entry.fields || typeof entry.fields !== "object" || Array.isArray(entry.fields)) {
      throw new Error(label + " contains malformed database clock evidence.");
    }
    const key = entry.table + "\0" + stableJson(entry.primaryKey);
    if (result.has(key)) throw new Error(label + " contains duplicate primary keys.");
    result.set(key, entry);
  }
  return result;
}

function unchangedDatabaseClockValues(finalEvidence, transitions) {
  const finalMap = databaseClockEvidenceMap(finalEvidence, "Final database clock evidence");
  const values = [];
  for (const transition of transitions) {
    const rowKey = transition.table + "\0" + stableJson(transition.primaryKey);
    const row = finalMap.get(rowKey);
    for (const [field, status] of Object.entries(transition.fields)) {
      if (status !== "unchanged") continue;
      if (!row || !Object.hasOwn(row.fields, field)) {
        throw new Error("Unchanged database clock field is missing from final evidence.");
      }
      values.push({
        table: transition.table,
        primaryKey: transition.primaryKey,
        field,
        value: row.fields[field],
      });
    }
  }
  return values.sort((left, right) => {
    const leftKey = stableJson([left.table, left.primaryKey, left.field]);
    const rightKey = stableJson([right.table, right.primaryKey, right.field]);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function changedDatabaseClockEvents(side, sideName, databaseClockFields, transitions) {
  const startMicros = parseUtcTimestampMicroseconds(
    side.startAnchor,
    "zoned-timestamp",
    sideName + " operation start anchor",
    { anchor: true },
  );
  const endMicros = parseUtcTimestampMicroseconds(
    side.endAnchor,
    "zoned-timestamp",
    sideName + " operation end anchor",
    { anchor: true },
  );
  if (startMicros > endMicros) throw new Error(sideName + " operation clock window is inverted.");
  const finalMap = databaseClockEvidenceMap(side.finalEvidence, sideName + " final database clock evidence");
  const events = [];

  for (const transition of transitions) {
    const rowKey = transition.table + "\0" + stableJson(transition.primaryKey);
    const finalRow = finalMap.get(rowKey);
    const policy = databaseClockFields[transition.table];
    if (!policy) throw new Error(sideName + " clock transition references an unconfigured table.");
    for (const [field, status] of Object.entries(transition.fields)) {
      if (!Object.hasOwn(policy, field) || !["created", "deleted", "unchanged", "updated"].includes(status)) {
        throw new Error(sideName + " clock transition contains an unconfigured field or status.");
      }
      if (status !== "created" && status !== "updated") continue;
      if (!finalRow || !Object.hasOwn(finalRow.fields, field)) {
        throw new Error(sideName + " changed database clock field is missing from final evidence.");
      }
      const value = finalRow.fields[field];
      const valueMicros = clockValueMicroseconds(
        value,
        policy[field],
        sideName + " persisted " + transition.table + "." + field,
      );
      if (valueMicros < startMicros || valueMicros > endMicros) {
        throw new Error(sideName + " changed database clock field is outside its recorded operation window.");
      }
      events.push({
        eventKey: stableJson([transition.table, transition.primaryKey, field]),
        table: transition.table,
        primaryKey: transition.primaryKey,
        field,
        rawValue: value,
        valueMicros,
      });
    }
  }

  const ordered = [...events].sort((left, right) => {
    if (left.valueMicros !== right.valueMicros) return left.valueMicros < right.valueMicros ? -1 : 1;
    return left.eventKey < right.eventKey ? -1 : left.eventKey > right.eventKey ? 1 : 0;
  });
  let orderGroup = -1;
  let previousValue;
  for (const event of ordered) {
    if (previousValue === undefined || event.valueMicros !== previousValue) orderGroup += 1;
    event.orderGroup = orderGroup;
    previousValue = event.valueMicros;
  }
  return {
    startAnchor: side.startAnchor,
    endAnchor: side.endAnchor,
    anchorPrecision: "microsecond",
    events: events.map((event) => ({
      eventKey: event.eventKey,
      table: event.table,
      primaryKey: event.primaryKey,
      field: event.field,
      rawValue: event.rawValue,
      offsetFromStartMicroseconds: (event.valueMicros - startMicros).toString(),
      offsetFromEndMicroseconds: (event.valueMicros - endMicros).toString(),
      orderGroup: event.orderGroup,
    })).sort((left, right) => left.eventKey < right.eventKey ? -1 : left.eventKey > right.eventKey ? 1 : 0),
  };
}

export function compareDatabaseClockOperationWindows({ before, after, databaseClockFields }) {
  requireObject(before, "Before database clock comparison input");
  requireObject(after, "After database clock comparison input");
  requireObject(databaseClockFields, "Database clock comparison policy");
  const beforeTransitions = deriveDatabaseClockTransitions(
    before.initialEvidence,
    before.finalEvidence,
    databaseClockFields,
  );
  const afterTransitions = deriveDatabaseClockTransitions(
    after.initialEvidence,
    after.finalEvidence,
    databaseClockFields,
  );
  const beforeWindow = changedDatabaseClockEvents(before, "Before", databaseClockFields, beforeTransitions);
  const afterWindow = changedDatabaseClockEvents(after, "After", databaseClockFields, afterTransitions);
  const initialValueDifferences = diffJson(before.initialEvidence, after.initialEvidence, "$.initialClockEvidence");
  const transitionDifferences = diffJson(beforeTransitions, afterTransitions, "$.transitions");
  const unchangedValueDifferences = diffJson(
    unchangedDatabaseClockValues(before.finalEvidence, beforeTransitions),
    unchangedDatabaseClockValues(after.finalEvidence, afterTransitions),
    "$.unchangedClockValues",
  );
  const beforeOrder = beforeWindow.events.map(({ eventKey, orderGroup }) => ({ eventKey, orderGroup }));
  const afterOrder = afterWindow.events.map(({ eventKey, orderGroup }) => ({ eventKey, orderGroup }));
  const eventOrderingDifferences = diffJson(beforeOrder, afterOrder, "$.eventOrderingAndTies");
  const differences = [
    ...initialValueDifferences,
    ...transitionDifferences,
    ...unchangedValueDifferences,
    ...eventOrderingDifferences,
  ];
  return {
    equal: differences.length === 0,
    differences,
    initialValueDifferences,
    transitionDifferences,
    unchangedValueDifferences,
    eventOrderingDifferences,
    transitions: { before: beforeTransitions, after: afterTransitions },
    evidence: { before: beforeWindow, after: afterWindow },
  };
}

export function sortObservationsByCaseId(observations) {
  if (!Array.isArray(observations) || observations.some((observation) => (
    !observation || typeof observation !== "object" || Array.isArray(observation)
    || typeof observation.caseId !== "string"
  ))) {
    throw new TypeError("Comparator observations must be objects with string case IDs.");
  }
  return [...observations].sort((left, right) => (
    left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0
  ));
}

export function aggregateSuiteCases(suiteRuns) {
  if (!Array.isArray(suiteRuns) || suiteRuns.length === 0) throw new Error("Comparator test-case coverage requires suite reports.");
  const cases = new Map();
  for (const run of suiteRuns) {
    if (!run || typeof run.suiteId !== "string" || !run.suiteId || !Array.isArray(run.cases)) {
      throw new Error("Comparator test-case suite report is malformed.");
    }
    const occurrences = new Map();
    for (const testCase of run.cases) {
      if (!testCase || typeof testCase.file !== "string" || !testCase.file
        || typeof testCase.name !== "string" || !testCase.name
        || !["passed", "skipped"].includes(testCase.status)) {
        throw new Error("Comparator test-case report contains a failure, todo, or unknown status.");
      }
      const testKey = `${testCase.file}\0${testCase.name}`;
      const occurrence = (occurrences.get(testKey) ?? 0) + 1;
      occurrences.set(testKey, occurrence);
      const key = `${testKey}\0${occurrence}`;
      const current = cases.get(key) ?? {
        file: testCase.file,
        name: testCase.name,
        occurrence,
        executedIn: [],
        filteredIn: [],
      };
      const destination = testCase.status === "passed" ? current.executedIn : current.filteredIn;
      if (destination.includes(run.suiteId)) throw new Error("Comparator test-case suite report contains a duplicate case.");
      destination.push(run.suiteId);
      cases.set(key, current);
    }
  }
  const result = [...cases.values()].sort((left, right) => (
    `${left.file}\0${left.name}\0${left.occurrence}`.localeCompare(`${right.file}\0${right.name}\0${right.occurrence}`)
  ));
  if (result.length === 0 || result.some(({ executedIn }) => executedIn.length === 0)) {
    throw new Error("Comparator has a skipped test case that did not pass in any required suite.");
  }
  for (const testCase of result) {
    testCase.executedIn.sort();
    testCase.filteredIn.sort();
  }
  return result;
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}
