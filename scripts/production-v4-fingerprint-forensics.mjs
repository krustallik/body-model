import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { isIP } from "node:net";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DERIVED_TABLES = new Set([
  "ExperimentalTransientExerciseWaterShadow",
  "PhysiologyV7Lifecycle",
  "UnifiedExperimentalPhysiologyStateV2",
  "UnifiedPublicationBlock",
]);
const DERIVED_SEQUENCE_OWNERS = new Set([
  "ExperimentalTransientExerciseWaterShadow",
  "PhysiologyV7Lifecycle",
  "UnifiedExperimentalPhysiologyStateV2",
]);
const V4_MIGRATIONS = Object.freeze([
  Object.freeze({ name: "20261011120000_unified_publication_failure_fence", sha256: "b122658704a2ca7dac3d5de6e3e1b196d04027078d899d0b8e6079bf0a4397bc" }),
  Object.freeze({ name: "20261011130000_only_completed_training_invalidates_v7", sha256: "d37185c4d9c681bcf2e387d343cad2501f75c1d33916b5e4822eba8a9635a2b8" }),
]);
const V4_MIGRATION_NAMES = new Set(V4_MIGRATIONS.map(({ name }) => name));
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REPLAY_INPUT_FINGERPRINT_VERSIONS = Object.freeze({
  signedBaseline: "bodycast-v4-replay-source-fingerprint-v2",
  rawParity: "bodycast-v4-replay-source-fingerprint-v3",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function quoteIdentifier(value) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new Error("Public schema contains an unsupported identifier.");
  return `"${value.replaceAll('"', '""')}"`;
}

function readOnlyArgs() {
  return ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=verbose"];
}

function safeCaptureErrorCode(error) {
  const message = error instanceof Error ? error.message : "";
  const known = new Map([
    ["Forensic table boundary is ambiguous.", "ambiguous-table-boundary"],
    ["Forensic table inventory changed during its read-only snapshot.", "table-inventory-changed"],
    ["Forensic sequence boundary is missing.", "sequence-boundary-missing"],
    ["Forensic sequence inventory changed during its read-only snapshot.", "sequence-inventory-changed"],
    ["Forensic sequence phase is ambiguous.", "ambiguous-sequence-phase"],
    ["Forensic sequence inventory is incomplete.", "sequence-inventory-incomplete"],
    ["Forensic PostgreSQL metadata is malformed.", "metadata-malformed"],
    ["Forensic PostgreSQL metadata is duplicated.", "metadata-duplicated"],
    ["Forensic PostgreSQL output contains an unexpected record.", "unexpected-output-record"],
    ["Forensic PostgreSQL snapshot is incomplete.", "snapshot-incomplete"],
    ["Forensic PostgreSQL table or sequence inventory changed before its snapshot.", "inventory-changed"],
    ["Forensic PostgreSQL safety metadata is incomplete.", "safety-metadata-incomplete"],
  ]);
  if (known.has(message)) return known.get(message);
  if (message.startsWith("Sequence state changed during the production forensic snapshot:")) return "sequence-state-changed";
  return "capture-stream-failed";
}

function safePostgresDiagnostic(stderr) {
  const match = /(?:ERROR|FATAL|PANIC):\s+([0-9A-Z]{5}):/.exec(stderr);
  return match ? `sqlstate-${match[1]}` : (stderr.length ? "client-stderr" : "none");
}

const SAFE_CAPTURE_DIAGNOSTIC = /^Read-only PostgreSQL forensic capture failed closed \(parser=(?:ambiguous-table-boundary|table-inventory-changed|sequence-boundary-missing|sequence-inventory-changed|ambiguous-sequence-phase|sequence-inventory-incomplete|metadata-malformed|metadata-duplicated|unexpected-output-record|snapshot-incomplete|inventory-changed|safety-metadata-incomplete|sequence-state-changed|capture-stream-failed); client=(?:sqlstate-[0-9A-Z]{5}|client-stderr|none); exit=(?:[0-9]+|unknown)\)\.$/;
const GENERIC_FAILURE = "Production V4 fingerprint forensics failed closed.";

export function safeCliErrorMessage(error) {
  const message = error instanceof Error ? error.message : "";
  return SAFE_CAPTURE_DIAGNOSTIC.test(message) ? message : GENERIC_FAILURE;
}

function parseInventory(text) {
  let inventory;
  try { inventory = JSON.parse(text.trim()); } catch { throw new Error("PostgreSQL forensic inventory is unavailable."); }
  if (!Array.isArray(inventory?.tables) || !inventory.tables.length || !Array.isArray(inventory?.sequences)) {
    throw new Error("PostgreSQL forensic inventory is incomplete.");
  }
  const tables = inventory.tables.map((row) => row?.tablename);
  const sequences = inventory.sequences.map((row) => row?.name);
  if (tables.some((name) => !IDENTIFIER.test(name)) || sequences.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    || new Set(tables).size !== tables.length || new Set(sequences).size !== sequences.length) {
    throw new Error("PostgreSQL forensic inventory contains ambiguous identifiers.");
  }
  return {
    tables: [...inventory.tables].sort((a, b) => a.tablename.localeCompare(b.tablename)),
    sequences: [...inventory.sequences].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const INVENTORY_SQL = `SELECT json_build_object(
  'tables', COALESCE((SELECT json_agg(json_build_object('tablename', tablename) ORDER BY tablename)
    FROM pg_catalog.pg_tables WHERE schemaname = 'public'), '[]'::json),
  'sequences', COALESCE((SELECT json_agg(json_build_object(
    'name', s.schemaname || '.' || s.sequencename,
    'dataType', s.data_type::text, 'startValue', s.start_value::text,
    'incrementBy', s.increment_by::text, 'minimumValue', s.min_value::text,
    'maximumValue', s.max_value::text, 'cycle', s.cycle,
    'ownerTable', owner_table.relname
  ) ORDER BY s.sequencename)
    FROM pg_catalog.pg_sequences s
    LEFT JOIN pg_catalog.pg_namespace seq_ns ON seq_ns.nspname = s.schemaname
    LEFT JOIN pg_catalog.pg_class seq ON seq.relname = s.sequencename AND seq.relnamespace = seq_ns.oid
    LEFT JOIN pg_catalog.pg_depend dep ON dep.classid = 'pg_class'::regclass AND dep.objid = seq.oid
      AND dep.refclassid = 'pg_class'::regclass AND dep.deptype IN ('a', 'i')
    LEFT JOIN pg_catalog.pg_class owner_table ON owner_table.oid = dep.refobjid
    WHERE s.schemaname = 'public'), '[]'::json)
)::text;`;

function makeConnection(mode, target) {
  if (mode === "test-url") {
    const url = new URL(target);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
      || !url.password || url.search || url.hash
      || !(database === "bodycast_restore" || database.endsWith("_test"))) {
      throw new Error("Forensic source mode accepts only an isolated loopback test database.");
    }
    const run = (sql) => execFileSync("psql", [...readOnlyArgs(), target, "--command", sql], {
      encoding: "utf8", env: { ...process.env, PGAPPNAME: "bodycast-v4-fingerprint-forensics" },
      stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 * 1024 * 1024,
    });
    return {
      inventory: () => parseInventory(run(INVENTORY_SQL)),
      spawn: () => spawn("psql", [...readOnlyArgs(), target], {
        env: { ...process.env, PGAPPNAME: "bodycast-v4-fingerprint-forensics" }, stdio: ["pipe", "pipe", "pipe"],
      }),
      finish: (report) => report,
    };
  }
  if (mode === "production-container" && target === "bodycast-db-prod") {
    const inspect = () => {
      const value = execFileSync("docker", ["inspect", "--format", "{{.Id}}|{{json .NetworkSettings.Networks}}", target], {
        encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024,
      }).trim();
      const separator = value.indexOf("|");
      const id = value.slice(0, separator);
      let networks;
      try { networks = JSON.parse(value.slice(separator + 1)); } catch { throw new Error("Fixed production PostgreSQL container identity is unavailable."); }
      const entries = Object.values(networks ?? {});
      const addresses = entries.map((entry) => entry?.IPAddress).filter((address) => typeof address === "string" && address);
      if (separator < 1 || !/^[a-f0-9]{64}$/.test(id) || addresses.length !== 1 || isIP(addresses[0]) !== 4) {
        throw new Error("Fixed production PostgreSQL container topology is ambiguous.");
      }
      return { id, address: addresses[0] };
    };
    const before = inspect();
    const psqlScript = 'export PGPASSWORD="${POSTGRES_PASSWORD:?}"; exec psql --host="$BODYCAST_FORENSIC_HOST" --username="$POSTGRES_USER" --dbname=bodycast --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1';
    const run = (sql) => execFileSync("docker", ["exec", "--env", "PGAPPNAME=bodycast-v4-fingerprint-forensics", "--env", `BODYCAST_FORENSIC_HOST=${before.address}`, target,
      "sh", "-c", `${psqlScript} --command "$1"`, "_", sql], {
      encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 * 1024 * 1024,
    });
    return {
      inventory: () => parseInventory(run(INVENTORY_SQL)),
      spawn: () => spawn("docker", ["exec", "-i", "--env", "PGAPPNAME=bodycast-v4-fingerprint-forensics",
        "--env", `BODYCAST_FORENSIC_HOST=${before.address}`, target, "sh", "-c", psqlScript], {
        env: process.env, stdio: ["pipe", "pipe", "pipe"],
      }),
      finish: (report) => {
        const after = inspect();
        if (after.id !== before.id || after.address !== before.address) throw new Error("Production PostgreSQL container changed during forensic capture.");
        return { ...report, databaseContainerId: before.id, expectedServerAddress: before.address };
      },
    };
  }
  throw new Error("Unsupported PostgreSQL forensic target.");
}

function buildSnapshotSql(inventory) {
  const tableNames = inventory.tables.map(({ tablename }) => tablename);
  const sequenceNames = inventory.sequences.map(({ name }) => name);
  const tableInventory = `SELECT '__BODYCAST_TABLE_INVENTORY__=' || COALESCE(json_agg(tablename ORDER BY tablename)::text, '[]') FROM pg_catalog.pg_tables WHERE schemaname = 'public';`;
  const sequenceInventory = `SELECT '__BODYCAST_SEQUENCE_INVENTORY__=' || COALESCE(json_agg(json_build_object(
    'name', s.schemaname || '.' || s.sequencename, 'dataType', s.data_type::text,
    'startValue', s.start_value::text, 'incrementBy', s.increment_by::text,
    'minimumValue', s.min_value::text, 'maximumValue', s.max_value::text, 'cycle', s.cycle,
    'ownerTable', owner_table.relname
  ) ORDER BY s.sequencename)::text, '[]') FROM pg_catalog.pg_sequences s
  LEFT JOIN pg_catalog.pg_namespace seq_ns ON seq_ns.nspname = s.schemaname
  LEFT JOIN pg_catalog.pg_class seq ON seq.relname = s.sequencename AND seq.relnamespace = seq_ns.oid
  LEFT JOIN pg_catalog.pg_depend dep ON dep.classid = 'pg_class'::regclass AND dep.objid = seq.oid
    AND dep.refclassid = 'pg_class'::regclass AND dep.deptype IN ('a', 'i')
  LEFT JOIN pg_catalog.pg_class owner_table ON owner_table.oid = dep.refobjid
  WHERE s.schemaname = 'public';`;
  const activity = (label) => `SELECT '${label}=' || json_build_object(
    'otherClientBackends', count(*) FILTER (WHERE backend_type = 'client backend'),
    'activeTransactions', count(*) FILTER (WHERE backend_type = 'client backend' AND xact_start IS NOT NULL),
    'activeStatements', count(*) FILTER (WHERE backend_type = 'client backend' AND state = 'active'),
    'preparedTransactions', (SELECT count(*) FROM pg_prepared_xacts WHERE database = current_database())
  )::text FROM pg_catalog.pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();`;
  const migrations = `SELECT '__BODYCAST_MIGRATIONS__=' || COALESCE(json_agg(json_build_object(
    'name', migration_name, 'checksum', checksum, 'startedAt', started_at,
    'finishedAt', finished_at, 'rolledBackAt', rolled_back_at,
    'logsFingerprint', md5(COALESCE(logs, ''))
  ) ORDER BY migration_name, started_at)::text, '[]') FROM public."_prisma_migrations";`;
  const identity = `SELECT '__BODYCAST_IDENTITY__=' || json_build_object(
    'database', current_database(), 'role', current_user,
    'serverVersion', current_setting('server_version'),
    'serverAddress', host(inet_server_addr()), 'serverPort', inet_server_port(),
    'clusterSystemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
    'transactionReadOnly', current_setting('transaction_read_only')
  )::text;`;
  const lines = [
    "\\set ON_ERROR_STOP on",
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;",
    identity,
    tableInventory,
    sequenceInventory,
    migrations,
    activity("__BODYCAST_ACTIVITY_BEFORE__"),
    "\\echo __BODYCAST_SEQUENCE_PHASE__before",
  ];
  for (const fullName of sequenceNames) {
    const [, sequence] = fullName.split(".");
    const marker = Buffer.from(fullName).toString("base64url");
    lines.push(`SELECT '__BODYCAST_SEQUENCE_STATE__${marker}=' || COALESCE(pg_sequence.last_value::text, 'null') || ':' || sequence_state.last_value::text || ':' || sequence_state.is_called::text FROM public.${quoteIdentifier(sequence)} AS sequence_state CROSS JOIN pg_catalog.pg_sequences AS pg_sequence WHERE pg_sequence.schemaname = 'public' AND pg_sequence.sequencename = '${sequence}';`);
  }
  lines.push("\\echo __BODYCAST_SEQUENCE_PHASE_END__before");
  for (const table of tableNames) {
    const marker = Buffer.from(table).toString("base64url");
    lines.push(`\\echo __BODYCAST_TABLE_BEGIN__${marker}`);
    lines.push(`\\copy (SELECT row_to_json(row_value)::text FROM public.${quoteIdentifier(table)} AS row_value ORDER BY row_to_json(row_value)::text) TO STDOUT`);
    lines.push(`\\echo __BODYCAST_TABLE_END__${marker}`);
  }
  lines.push("\\echo __BODYCAST_SEQUENCE_PHASE__after");
  for (const fullName of sequenceNames) {
    const [, sequence] = fullName.split(".");
    const marker = Buffer.from(fullName).toString("base64url");
    lines.push(`SELECT '__BODYCAST_SEQUENCE_STATE__${marker}=' || COALESCE(pg_sequence.last_value::text, 'null') || ':' || sequence_state.last_value::text || ':' || sequence_state.is_called::text FROM public.${quoteIdentifier(sequence)} AS sequence_state CROSS JOIN pg_catalog.pg_sequences AS pg_sequence WHERE pg_sequence.schemaname = 'public' AND pg_sequence.sequencename = '${sequence}';`);
  }
  lines.push("\\echo __BODYCAST_SEQUENCE_PHASE_END__after", activity("__BODYCAST_ACTIVITY_AFTER__"), "COMMIT;");
  return `${lines.join("\n")}\n`;
}

const V2_HEADER = `${REPLAY_INPUT_FINGERPRINT_VERSIONS.signedBaseline}\nexcluded-derived-tables:ExperimentalTransientExerciseWaterShadow,PhysiologyV7Lifecycle,UnifiedExperimentalPhysiologyStateV2,UnifiedPublicationBlock\n`;
const V3_HEADER = `${REPLAY_INPUT_FINGERPRINT_VERSIONS.rawParity}\nexcluded-derived-tables:ExperimentalTransientExerciseWaterShadow,PhysiologyV7Lifecycle,UnifiedExperimentalPhysiologyStateV2,UnifiedPublicationBlock,_prisma_migrations\n`;

export async function consumeSnapshotOutput(readable, inventory) {
  const tables = [];
  const sequences = [];
  const metadata = {};
  const full = createHash("sha256").update("bodycast-logical-data-fingerprint-v1\n");
  const v2 = createHash("sha256").update(V2_HEADER);
  const v3 = createHash("sha256").update(V3_HEADER);
  let currentTable = null;
  let seenTables = 0;
  let sequenceHeaderAdded = false;
  let sequencePhase = null;
  let sequencePhaseIndex = 0;
  const sequenceBefore = new Map();
  const expectedTables = inventory.tables.map(({ tablename }) => tablename);
  const expectedSequences = inventory.sequences.map(({ name }) => name);
  const readLine = createInterface({ input: readable, crlfDelay: Infinity });
  for await (const line of readLine) {
    if (currentTable) {
      if (line.startsWith("__BODYCAST_TABLE_END__")) {
        const marker = line.slice("__BODYCAST_TABLE_END__".length);
        const ended = Buffer.from(marker, "base64url").toString("utf8");
        if (ended !== currentTable.name) throw new Error("Forensic table boundary is ambiguous.");
        full.update("\n");
        if (!DERIVED_TABLES.has(currentTable.name)) { v2.update("\n"); if (currentTable.name !== "_prisma_migrations") v3.update("\n"); }
        tables.push({ name: currentTable.name, rowCount: currentTable.rowCount, digest: currentTable.hash.digest("hex") });
        currentTable = null;
        continue;
      }
      currentTable.hash.update(`${line}\n`);
      currentTable.rowCount += 1;
      full.update(`${line}\n`);
      if (!DERIVED_TABLES.has(currentTable.name)) {
        v2.update(`${line}\n`);
        if (currentTable.name !== "_prisma_migrations") v3.update(`${line}\n`);
      }
      continue;
    }
    const tableStart = /^__BODYCAST_TABLE_BEGIN__(.+)$/.exec(line);
    if (tableStart) {
      const name = Buffer.from(tableStart[1], "base64url").toString("utf8");
      if (expectedTables[seenTables] !== name) throw new Error("Forensic table inventory changed during its read-only snapshot.");
      seenTables += 1;
      full.update(`table:${name}\n`);
      if (!DERIVED_TABLES.has(name)) {
        v2.update(`table:${name}\n`);
        if (name !== "_prisma_migrations") v3.update(`table:${name}\n`);
      }
      currentTable = { name, rowCount: 0, hash: createHash("sha256") };
      continue;
    }
    const sequence = /^__BODYCAST_SEQUENCE_STATE__(.+?)=(null|[0-9]+):([0-9]+):(true|false)$/.exec(line);
    if (sequence) {
      if (!sequencePhase) throw new Error("Forensic sequence boundary is missing.");
      const name = Buffer.from(sequence[1], "base64url").toString("utf8");
      if (expectedSequences[sequencePhaseIndex] !== name) throw new Error("Forensic sequence inventory changed during its read-only snapshot.");
      sequencePhaseIndex += 1;
      const state = `${sequence[2]}:${sequence[3]}:${sequence[4]}`;
      if (sequencePhase === "before") {
        sequenceBefore.set(name, state);
        continue;
      }
      if (sequenceBefore.get(name) !== state) throw new Error(`Sequence state changed during the production forensic snapshot: ${name}.`);
      if (!sequenceHeaderAdded) {
        full.update("sequence-state\n");
        v2.update("sequence-state\n");
        v3.update("sequence-state\n");
        sequenceHeaderAdded = true;
      }
      const legacyLastValue = sequence[2];
      const lastValue = sequence[3];
      const isCalled = sequence[4] === "true";
      const owner = inventory.sequences.find((item) => item.name === name)?.ownerTable ?? null;
      const legacyLine = `${name}:${legacyLastValue}`;
      const digest = sha256(`${name}:${legacyLastValue}:${lastValue}:${isCalled}`);
      sequences.push({ name, ownerTable: owner, digest, legacyDigest: sha256(legacyLine) });
      full.update(`${legacyLine}\n`);
      if (!DERIVED_SEQUENCE_OWNERS.has(owner)) {
        v2.update(`${legacyLine}\n`);
        v3.update(`${name}:${legacyLastValue}:${lastValue}:${isCalled}\n`);
      }
      continue;
    }
    if (line === "__BODYCAST_SEQUENCE_PHASE__before" || line === "__BODYCAST_SEQUENCE_PHASE__after") {
      if (sequencePhase || currentTable) throw new Error("Forensic sequence phase is ambiguous.");
      sequencePhase = line.endsWith("before") ? "before" : "after";
      sequencePhaseIndex = 0;
      if (sequencePhase === "after" && !sequenceHeaderAdded) {
        full.update("sequence-state\n");
        v2.update("sequence-state\n");
        v3.update("sequence-state\n");
        sequenceHeaderAdded = true;
      }
      continue;
    }
    if (line === "__BODYCAST_SEQUENCE_PHASE_END__before" || line === "__BODYCAST_SEQUENCE_PHASE_END__after") {
      const phase = line.endsWith("before") ? "before" : "after";
      if (sequencePhase !== phase || sequencePhaseIndex !== expectedSequences.length) throw new Error("Forensic sequence inventory is incomplete.");
      sequencePhase = null;
      continue;
    }
    const marker = /^(__BODYCAST_[A-Z_]+__)=([\s\S]*)$/.exec(line);
    if (marker) {
      let value;
      try { value = JSON.parse(marker[2]); } catch { throw new Error("Forensic PostgreSQL metadata is malformed."); }
      if (Object.hasOwn(metadata, marker[1])) throw new Error("Forensic PostgreSQL metadata is duplicated.");
      metadata[marker[1]] = value;
      continue;
    }
    if (line === "BEGIN" || line === "COMMIT" || line === "") continue;
    throw new Error("Forensic PostgreSQL output contains an unexpected record.");
  }
  if (currentTable || sequencePhase || seenTables !== expectedTables.length || sequences.length !== expectedSequences.length) {
    throw new Error("Forensic PostgreSQL snapshot is incomplete.");
  }
  const actualTables = metadata.__BODYCAST_TABLE_INVENTORY__;
  const actualSequences = metadata.__BODYCAST_SEQUENCE_INVENTORY__;
  if (canonicalJson(actualTables) !== canonicalJson(expectedTables)
    || canonicalJson(actualSequences) !== canonicalJson(inventory.sequences)) {
    throw new Error("Forensic PostgreSQL table or sequence inventory changed before its snapshot.");
  }
  const activityBefore = metadata.__BODYCAST_ACTIVITY_BEFORE__;
  const activityAfter = metadata.__BODYCAST_ACTIVITY_AFTER__;
  if (!metadata.__BODYCAST_IDENTITY__ || !Array.isArray(metadata.__BODYCAST_MIGRATIONS__) || !activityBefore || !activityAfter) {
    throw new Error("Forensic PostgreSQL safety metadata is incomplete.");
  }
  return {
    schemaVersion: 1,
    captureMethod: "repeatable-read-read-only-row-json-v1",
    capturedAt: new Date().toISOString(),
    identity: metadata.__BODYCAST_IDENTITY__,
    activity: { before: activityBefore, after: activityAfter },
    tableInventory: actualTables,
    tables,
    sequenceInventory: actualSequences,
    sequences,
    migrations: metadata.__BODYCAST_MIGRATIONS__,
    logicalDataFingerprint: full.digest("hex"),
    v4ReplayInputFingerprintV2: v2.digest("hex"),
    v4ReplayInputFingerprintV3: v3.digest("hex"),
    sequenceInventoryDigest: sha256(canonicalJson(actualSequences)),
    replayInputFingerprintVersions: REPLAY_INPUT_FINGERPRINT_VERSIONS,
  };
}

export async function captureForensicReport(mode, target) {
  const connection = makeConnection(mode, target);
  const inventory = connection.inventory();
  const child = connection.spawn();
  let stderrBytes = 0;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderr.length < 4096) stderr += chunk.toString("utf8").slice(0, 4096 - stderr.length);
  });
  const closed = new Promise((resolve) => child.once("close", (code) => resolve(code)));
  const consume = consumeSnapshotOutput(child.stdout, inventory);
  child.stdin.end(buildSnapshotSql(inventory));
  let report;
  try { report = await consume; } catch (error) {
    child.kill();
    const exitCode = await closed;
    throw new Error(`Read-only PostgreSQL forensic capture failed closed (parser=${safeCaptureErrorCode(error)}; client=${safePostgresDiagnostic(stderr)}; exit=${exitCode ?? "unknown"}).`);
  }
  const exitCode = await closed;
  if (exitCode !== 0 || stderrBytes > 0) {
    throw new Error(`Read-only PostgreSQL forensic capture failed closed (parser=none; client=${safePostgresDiagnostic(stderr)}; exit=${exitCode ?? "unknown"}).`);
  }
  return connection.finish(report);
}

function summarizeByName(items) {
  return new Map(items.map((item) => [item.name, item]));
}

function stableMigrationRow(row) {
  return {
    name: row.name, checksum: row.checksum, startedAt: row.startedAt,
    finishedAt: row.finishedAt, rolledBackAt: row.rolledBackAt, logsFingerprint: row.logsFingerprint,
  };
}

export function assertRestoredSourceMigrationState(report, migrationDirectories, expectedPendingNames) {
  const fail = () => { throw new Error("Signed backup restore does not have exactly the two reviewed V4 migrations pending."); };
  if (report?.identity?.database !== "bodycast_restore" || report?.identity?.role !== "bodycast_restore"
    || !/^17\.11(?:\D|$)/.test(String(report.identity.serverVersion ?? ""))
    || !Array.isArray(report.migrations) || !Array.isArray(migrationDirectories)
    || !Array.isArray(expectedPendingNames)) fail();
  const directories = [...migrationDirectories].sort();
  if (directories.some((name) => typeof name !== "string" || !name)
    || new Set(directories).size !== directories.length) fail();
  const groups = new Map();
  const validTimestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
  for (const row of report.migrations) {
    if (!row || !directories.includes(row.name) || !/^[a-f0-9]{64}$/.test(String(row.checksum ?? ""))
      || !validTimestamp(row.startedAt) || (row.finishedAt !== null && !validTimestamp(row.finishedAt))
      || (row.rolledBackAt !== null && !validTimestamp(row.rolledBackAt))
      || typeof row.hasLogs !== "boolean" || !/^[a-f0-9]{32}$/.test(String(row.logsFingerprint ?? ""))) fail();
    groups.set(row.name, [...(groups.get(row.name) ?? []), row]);
  }
  if ([...groups.values()].some((rows) => rows.length !== 1)) fail();
  const pending = directories.filter((name) => {
    const rows = groups.get(name) ?? [];
    return rows.length !== 1 || !rows[0].finishedAt || rows[0].rolledBackAt;
  });
  if (pending.some((name) => groups.has(name))
    || canonicalJson(pending) !== canonicalJson([...expectedPendingNames].sort())) fail();
  return pending;
}

export function compareForensicReports(source, current, {
  signedSourceBinding,
  currentPostflight,
  sourcePreflight,
  currentPreflight,
  expectedDatabaseSystemIdentifier = "7676573064192299040",
  currentReleaseSha = null,
  workflowRunId = null,
  workflowRunAttempt = null,
} = {}) {
  const blockers = [];
  const add = (message) => blockers.push(message);
  for (const [label, report] of [["source", source], ["current", current]]) {
    if (report?.schemaVersion !== 1 || report.captureMethod !== "repeatable-read-read-only-row-json-v1"
      || !Array.isArray(report.tables) || !Array.isArray(report.sequences) || !Array.isArray(report.migrations)
      || !Array.isArray(report.sequenceInventory)
      || canonicalJson(report.replayInputFingerprintVersions) !== canonicalJson(REPLAY_INPUT_FINGERPRINT_VERSIONS)
      || !/^[a-f0-9]{64}$/.test(String(report.logicalDataFingerprint ?? ""))
      || !/^[a-f0-9]{64}$/.test(String(report.v4ReplayInputFingerprintV2 ?? ""))
      || !/^[a-f0-9]{64}$/.test(String(report.v4ReplayInputFingerprintV3 ?? ""))) add(`${label} fingerprint report is incomplete.`);
    if (report?.identity?.database !== (label === "current" ? "bodycast" : "bodycast_restore")
      || report?.identity?.role !== (label === "current" ? "bodycast" : "bodycast_restore") || !/^17\.11(?:\D|$)/.test(String(report?.identity?.serverVersion ?? ""))
      || report?.identity?.transactionReadOnly !== "on") add(`${label} PostgreSQL identity or read-only transaction is invalid.`);
    if (label === "current" && (report?.identity?.clusterSystemIdentifier !== expectedDatabaseSystemIdentifier
      || report?.identity?.serverPort !== 5432 || typeof report?.identity?.serverAddress !== "string"
      || report?.identity?.serverAddress !== report?.expectedServerAddress
      || !/^[a-f0-9]{64}$/.test(report?.databaseContainerId ?? ""))) add("Current production database identity differs from the pinned cluster endpoint.");
    for (const side of [report?.activity?.before, report?.activity?.after]) {
      if (!side || side.otherClientBackends !== 0 || side.activeTransactions !== 0 || side.activeStatements !== 0 || side.preparedTransactions !== 0) {
        add(`${label} database had an active transaction, statement, prepared transaction, or other active client backend at a snapshot boundary.`);
        break;
      }
    }
  }
  if (!signedSourceBinding || signedSourceBinding.ddlAuthorization !== false
    || source?.logicalDataFingerprint !== signedSourceBinding.preDdlLogicalDataFingerprint
    || source?.v4ReplayInputFingerprintV2 !== signedSourceBinding.preDdlReplayInputFingerprint) {
    add("Restored source fingerprint does not match the signed pre-DDL binding.");
  }
  if (!/^[a-f0-9]{40}$/.test(String(currentReleaseSha ?? ""))
    || !/^[1-9][0-9]*$/.test(String(workflowRunId ?? ""))
    || !/^[1-9][0-9]*$/.test(String(workflowRunAttempt ?? ""))) add("Current workflow run or exact release SHA binding is missing.");
  if (currentPostflight?.ready !== true || !Array.isArray(currentPostflight.pending) || currentPostflight.pending.length !== 0) {
    add("Current production schema or migration postflight is not ready.");
  }
  const matchingIdentityFields = ["database", "role", "serverVersion", "serverAddress", "serverPort", "clusterSystemIdentifier"];
  if (!sourcePreflight?.identity || matchingIdentityFields.some((field) => sourcePreflight.identity[field] !== source?.identity?.[field])
    || !Array.isArray(sourcePreflight?.migrations)
    || canonicalJson(sourcePreflight.migrations.map(stableMigrationRow)) !== canonicalJson((source?.migrations ?? []).map(stableMigrationRow))) {
    add("Signed restore fingerprint capture and its pre-migration schema/history inspection do not share the same source identity and migration history.");
  }
  const liveIdentity = currentPreflight?.identity;
  if (liveIdentity?.database !== "bodycast" || liveIdentity?.role !== "bodycast"
    || liveIdentity?.clusterSystemIdentifier !== expectedDatabaseSystemIdentifier
    || liveIdentity?.serverAddress !== current?.expectedServerAddress || liveIdentity?.serverPort !== 5432
    || !String(liveIdentity?.serverVersion ?? "").startsWith("17.")) add("Current read-only preflight identity differs from the pinned production cluster.");
  if (!Array.isArray(currentPreflight?.conflictingLocks) || currentPreflight.conflictingLocks.length !== 0
    || !Array.isArray(currentPreflight?.preparedTransactions) || currentPreflight.preparedTransactions.length !== 0
    || !Array.isArray(currentPreflight?.diagnostics?.longTransactions) || currentPreflight.diagnostics.longTransactions.length !== 0) {
    add("Current production locks, prepared transactions, or long transactions are not clear.");
  }
  if (!Array.isArray(currentPreflight?.writerDrain?.activeClientBackends)
    || currentPreflight.writerDrain.activeClientBackends.length !== 0) {
    add("Current production writer drain found other client backends or its inventory is unknown.");
  }

  const sourceTables = summarizeByName(source?.tables ?? []);
  const currentTables = summarizeByName(current?.tables ?? []);
  const sourceRawNames = [...sourceTables.keys()].filter((name) => name !== "_prisma_migrations" && !DERIVED_TABLES.has(name)).sort();
  const currentRawNames = [...currentTables.keys()].filter((name) => name !== "_prisma_migrations" && !DERIVED_TABLES.has(name)).sort();
  if (canonicalJson(sourceRawNames) !== canonicalJson(currentRawNames)) add("Raw public table inventory changed outside reviewed V4 derived tables.");
  const rawTableComparisons = [...new Set([...sourceRawNames, ...currentRawNames])].sort().map((name) => {
    const before = sourceTables.get(name);
    const after = currentTables.get(name);
    const matches = Boolean(before && after && before.digest === after.digest && before.rowCount === after.rowCount);
    if (!matches) add(`Raw table digest differs: ${name}.`);
    return { name, sourceDigest: before?.digest ?? null, currentDigest: after?.digest ?? null,
      sourceRowCount: before?.rowCount ?? null, currentRowCount: after?.rowCount ?? null, matches };
  });
  for (const required of ["PhysiologyV7Lifecycle", "UnifiedExperimentalPhysiologyStateV2", "ExperimentalTransientExerciseWaterShadow", "_prisma_migrations"]) {
    if (!sourceTables.has(required) || !currentTables.has(required)) add(`Required forensic table is missing: ${required}.`);
  }
  const tableNameDifference = [...new Set([...sourceTables.keys(), ...currentTables.keys()])]
    .filter((name) => sourceTables.has(name) !== currentTables.has(name));
  if (canonicalJson(tableNameDifference) !== canonicalJson(["UnifiedPublicationBlock"])) add("Public table inventory differs outside the one table created by the reviewed V4 DDL.");

  const sourceMigrationRows = source.migrations.map(stableMigrationRow);
  const currentMigrationRows = current.migrations.map(stableMigrationRow);
  const sourceBaseline = sourceMigrationRows.filter((row) => !V4_MIGRATION_NAMES.has(row.name));
  const currentBaseline = currentMigrationRows.filter((row) => !V4_MIGRATION_NAMES.has(row.name));
  if (canonicalJson(sourceBaseline) !== canonicalJson(currentBaseline)) add("Migration history differs outside the two expected V4 ledger rows.");
  const sourceV4 = sourceMigrationRows.filter((row) => V4_MIGRATION_NAMES.has(row.name));
  const currentV4 = currentMigrationRows.filter((row) => V4_MIGRATION_NAMES.has(row.name));
  if (sourceV4.length !== 0 || currentV4.length !== V4_MIGRATIONS.length
    || V4_MIGRATIONS.some((migration) => {
      const rows = currentV4.filter((row) => row.name === migration.name);
      return rows.length !== 1 || rows[0].checksum !== migration.sha256 || !rows[0].finishedAt || rows[0].rolledBackAt;
    })) add("The migration ledger does not show exactly the two reviewed successful V4 migrations.");
  const includeSequence = (item) => !DERIVED_SEQUENCE_OWNERS.has(item.ownerTable);
  const sourceSequences = summarizeByName((source?.sequences ?? []).filter(includeSequence));
  const currentSequences = summarizeByName((current?.sequences ?? []).filter(includeSequence));
  if (canonicalJson([...sourceSequences.keys()].sort()) !== canonicalJson([...currentSequences.keys()].sort())) add("Raw sequence inventory differs.");
  const rawSequenceInventory = (report, label) => {
    const all = report?.sequenceInventory;
    if (!Array.isArray(all)) {
      add(`${label} sequence definition inventory is unavailable.`);
      return [];
    }
    const names = all.map((entry) => entry?.name);
    if (names.some((name) => typeof name !== "string") || new Set(names).size !== names.length) {
      add(`${label} sequence definition inventory is ambiguous.`);
      return [];
    }
    const filtered = all.filter((entry) => !DERIVED_SEQUENCE_OWNERS.has(entry.ownerTable));
    if (filtered.some((entry) => !/^public\.[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name)
      || typeof entry.dataType !== "string" || !entry.dataType
      || !/^-?[0-9]+$/.test(String(entry.startValue)) || !/^-?[0-9]+$/.test(String(entry.incrementBy))
      || String(entry.incrementBy) === "0" || !/^-?[0-9]+$/.test(String(entry.minimumValue))
      || !/^-?[0-9]+$/.test(String(entry.maximumValue)) || typeof entry.cycle !== "boolean"
      || (entry.ownerTable !== null && typeof entry.ownerTable !== "string"))) {
      add(`${label} sequence definition inventory is malformed.`);
    }
    const stateNames = (report.sequences ?? []).filter(includeSequence).map((entry) => entry?.name).sort();
    if (canonicalJson(filtered.map((entry) => entry.name).sort()) !== canonicalJson(stateNames)) {
      add(`${label} sequence definition and state inventories do not match.`);
    }
    return filtered.sort((left, right) => left.name.localeCompare(right.name));
  };
  const sourceRawSequenceInventory = rawSequenceInventory(source, "Source");
  const currentRawSequenceInventory = rawSequenceInventory(current, "Current");
  if (canonicalJson(sourceRawSequenceInventory) !== canonicalJson(currentRawSequenceInventory)) {
    add("Raw sequence definitions differ (type, bounds, increment, cycle, or ownership).");
  }

  const rawSequenceComparisons = [...new Set([...sourceSequences.keys(), ...currentSequences.keys()])].sort().map((name) => {
    const before = sourceSequences.get(name);
    const after = currentSequences.get(name);
    const sourceDefinition = sourceRawSequenceInventory.find((entry) => entry.name === name);
    const currentDefinition = currentRawSequenceInventory.find((entry) => entry.name === name);
    const matches = Boolean(before && after && sourceDefinition && currentDefinition
      && before.digest === after.digest && before.legacyDigest === after.legacyDigest
      && canonicalJson(sourceDefinition) === canonicalJson(currentDefinition));
    if (!matches) add(`Raw sequence state or definition differs: ${name}.`);
    return { name, sourceStateDigest: before?.digest ?? null, currentStateDigest: after?.digest ?? null,
      sourceDefinitionDigest: sourceDefinition ? sha256(canonicalJson(sourceDefinition)) : null,
      currentDefinitionDigest: currentDefinition ? sha256(canonicalJson(currentDefinition)) : null, matches };
  });

  const v3Matches = source?.v4ReplayInputFingerprintV3 === current?.v4ReplayInputFingerprintV3;
  const v2Matches = source?.v4ReplayInputFingerprintV2 === current?.v4ReplayInputFingerprintV2;
  if (!v3Matches || v2Matches) add("V3 replay-input parity is absent or the signed V2 mismatch is not isolated to the migration ledger.");
  const verified = blockers.length === 0;
  return {
    schemaVersion: 1,
    verified,
    classification: verified ? "BOOKKEEPING_ONLY" : "BLOCKED",
    ddlAuthorization: false,
    releaseSha: currentReleaseSha,
    workflowRunId: String(workflowRunId ?? ""),
    workflowRunAttempt: Number(workflowRunAttempt),
    migrationOriginSha: signedSourceBinding?.migrationOriginSha ?? null,
    migrationRunId: signedSourceBinding?.migrationRunId ?? null,
    preflightRunId: signedSourceBinding?.preflightRunId ?? null,
    tableInventoryAdded: [...currentTables.keys()].filter((name) => !sourceTables.has(name)).sort(),
    tableInventoryRemoved: [...sourceTables.keys()].filter((name) => !currentTables.has(name)).sort(),
    sourceRunHistory: "UNVERIFIED",
    currentState: verified ? "VERIFIED_READ_ONLY" : "INCOMPLETE_OR_MISMATCHED",
    sourceLogicalFingerprint: source?.logicalDataFingerprint ?? null,
    currentLogicalFingerprint: current?.logicalDataFingerprint ?? null,
    sourceReplayInputFingerprintV2: source?.v4ReplayInputFingerprintV2 ?? null,
    currentReplayInputFingerprintV2: current?.v4ReplayInputFingerprintV2 ?? null,
    sourceReplayInputFingerprintV3: source?.v4ReplayInputFingerprintV3 ?? null,
    currentReplayInputFingerprintV3: current?.v4ReplayInputFingerprintV3 ?? null,
    replayInputFingerprintVersions: REPLAY_INPUT_FINGERPRINT_VERSIONS,
    sourceMigrationLedgerDigest: sourceTables.get("_prisma_migrations")?.digest ?? null,
    currentMigrationLedgerDigest: currentTables.get("_prisma_migrations")?.digest ?? null,
    rawTableComparisons,
    rawSequenceComparisons,
    v4MigrationLedgerRows: currentV4.map(({ name, checksum, finishedAt, rolledBackAt }) => ({ name, checksum, finishedAt, rolledBackAt })),
    currentPostflightReady: currentPostflight?.ready === true,
    productionWriterDrain: {
      activeClientBackends: Array.isArray(currentPreflight?.writerDrain?.activeClientBackends)
        ? currentPreflight.writerDrain.activeClientBackends.length : null,
      activeTransactionsBefore: current?.activity?.before?.activeTransactions ?? null,
      activeTransactionsAfter: current?.activity?.after?.activeTransactions ?? null,
      activeStatementsBefore: current?.activity?.before?.activeStatements ?? null,
      activeStatementsAfter: current?.activity?.after?.activeStatements ?? null,
      conflictingLocks: Array.isArray(currentPreflight?.conflictingLocks) ? currentPreflight.conflictingLocks.length : null,
      preparedTransactions: Array.isArray(currentPreflight?.preparedTransactions) ? currentPreflight.preparedTransactions.length : null,
      longTransactions: Array.isArray(currentPreflight?.diagnostics?.longTransactions) ? currentPreflight.diagnostics.longTransactions.length : null,
    },
    blockers,
  };
}

async function captureMain(args) {
  const [mode, target] = args;
  if (!mode || !target) throw new Error("Usage: production-v4-fingerprint-forensics.mjs --test-url <loopback-url> | --production-container bodycast-db-prod");
  const normalized = mode === "--test-url" ? "test-url" : mode === "--production-container" ? "production-container" : null;
  if (!normalized) throw new Error("Unsupported forensic mode.");
  const report = await captureForensicReport(normalized, target);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

async function compareMain(args) {
  const [sourcePath, currentPath, bindingPath, sourcePreflightPath, currentPreflightPath, postflightPath, outputPath] = args;
  if ([sourcePath, currentPath, bindingPath, sourcePreflightPath, currentPreflightPath, postflightPath, outputPath].some((value) => !value)) {
    throw new Error("Usage: production-v4-fingerprint-forensics.mjs --compare source.json current.json signed-binding.json source-preflight.json current-preflight.json postflight.json output.json");
  }
  const read = async (file) => JSON.parse(await readFile(file, "utf8"));
  const [source, current, binding, sourcePreflight, currentPreflight, postflight] = await Promise.all([
    read(sourcePath), read(currentPath), read(bindingPath), read(sourcePreflightPath), read(currentPreflightPath), read(postflightPath),
  ]);
  const result = compareForensicReports(source, current, {
    signedSourceBinding: binding,
    sourcePreflight,
    currentPreflight,
    currentPostflight: postflight,
    currentReleaseSha: process.env.RELEASE_SHA,
    workflowRunId: process.env.GITHUB_RUN_ID,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  if (!result.verified) throw new Error(`Fingerprint forensics blocked (${result.blockers.length} evidence predicates).`);
  process.stdout.write("Verified: signed-source and production V3 replay-input fingerprints match; V4 migration postflight passed.\n");
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--compare") return compareMain(args);
  return captureMain([mode, ...args]);
}

if (process.argv[1] && (process.argv[1] === "-" || import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main().catch((error) => {
    process.stderr.write(`${safeCliErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
