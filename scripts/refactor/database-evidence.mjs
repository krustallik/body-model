import { PrismaClient } from "@prisma/client";
import net from "node:net";
import { validateComparatorDatabaseUrl } from "./comparator-core.mjs";

export async function waitForLoopbackPort(host, port, { timeoutMs = 30_000 } = {}) {
  if (host !== "127.0.0.1" || !Number.isSafeInteger(port) || port < 1 || port > 65_535
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90_000) {
    throw new Error("Comparator PostgreSQL readiness requires an exact loopback endpoint and bounded timeout.");
  }

  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error("Comparator PostgreSQL loopback connection attempt timed out."));
        }, Math.min(1_000, timeoutMs));
        socket.once("connect", () => {
          clearTimeout(timer);
          socket.destroy();
          resolve(undefined);
        });
        socket.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Comparator PostgreSQL loopback endpoint ${host}:${port} did not become reachable: ${lastError?.message ?? "timeout"}`);
}

export async function waitForPostgresConnection(check, {
  host,
  port,
  timeoutMs = 30_000,
  retryDelayMs = 200,
} = {}) {
  if (typeof check !== "function" || host !== "127.0.0.1"
    || !Number.isSafeInteger(port) || port < 1 || port > 65_535
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90_000
    || !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1 || retryDelayMs > 1_000) {
    throw new Error("Comparator PostgreSQL identity readiness requires an exact loopback endpoint and bounded retry policy.");
  }

  const expected = `Can't reach database server at \`${host}:${port}\``;
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      return await check();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes(expected)) throw error;
      lastError = error;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(retryDelayMs, remaining)));
    }
  } while (Date.now() < deadline);

  throw new Error(`Comparator PostgreSQL host identity query did not become ready at ${host}:${port} within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : "timeout"}`);
}

function quoteIdentifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error("Comparator SQL identifier is not allowlisted.");
  }
  return `"${value.replaceAll('"', '""')}"`;
}
function toPlain(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = toPlain(item);
    return result;
  }
  return value;
}

export async function withAttestedDatabase({ databaseUrl, expected, mode = "test", dockerIdentity }, action) {
  const configured = validateComparatorDatabaseUrl(databaseUrl, expected, mode);
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const rows = await client.$queryRawUnsafe(`
      SELECT current_database() AS database,
             current_user AS role,
             host(inet_server_addr()) AS server_address,
             inet_server_port() AS server_port,
             current_setting('server_version') AS server_version,
             current_setting('TimeZone') AS timezone,
             pg_is_in_recovery() AS in_recovery
    `);
    const row = rows[0];
    if (!row || row.database !== configured.database || row.role !== configured.role
      || Number(row.server_port) !== 5432 || row.in_recovery !== false || !["UTC", "Etc/UTC"].includes(row.timezone)) {
      throw new Error(`Comparator PostgreSQL identity attestation failed: ${JSON.stringify({
        expected: { database: configured.database, role: configured.role, serverPort: 5432, timezone: "UTC", inRecovery: false },
        actual: row ? toPlain(row) : null,
      })}`);
    }
    if (!dockerIdentity || dockerIdentity.networkAddress !== row.server_address
      || dockerIdentity.containerId.length !== 64 || !/^[a-f0-9]{64}$/.test(dockerIdentity.containerId)) {
      throw new Error(`Comparator PostgreSQL server does not match the inspected isolated Docker container: ${JSON.stringify({
        databaseServerAddress: row.server_address,
        inspectedContainerAddress: dockerIdentity?.networkAddress ?? null,
        containerId: dockerIdentity?.containerId ?? null,
      })}`);
    }
    return await action(client, {
      host: configured.host,
      port: configured.port,
      database: row.database,
      role: row.role,
      serverAddress: row.server_address,
      serverPort: Number(row.server_port),
      serverVersion: row.server_version,
      timezone: row.timezone,
      inRecovery: row.in_recovery,
      containerId: dockerIdentity.containerId,
      imageId: dockerIdentity.imageId,
      imageDigest: dockerIdentity.imageDigest,
      mappedHost: dockerIdentity.mappedHost,
      mappedPort: dockerIdentity.mappedPort,
    });
  } finally {
    await client.$disconnect();
  }
}

export async function capturePersistedState(client, tableNames) {
  const tables = {};
  for (const tableName of tableNames) {
    const table = quoteIdentifier(tableName);
    const existence = await client.$queryRawUnsafe(`SELECT to_regclass('public."${tableName}"')::text AS name`);
    if (!existence[0]?.name) throw new Error(`Comparator required table is missing: ${tableName}`);
    const primaryKey = await client.$queryRawUnsafe(`
      SELECT attribute.attname AS name
      FROM pg_index AS index_info
      CROSS JOIN LATERAL unnest(index_info.indkey) WITH ORDINALITY AS key_column(attnum, ordinal)
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = index_info.indrelid AND attribute.attnum = key_column.attnum
      WHERE index_info.indrelid = to_regclass('public."${tableName}"')
        AND index_info.indisprimary
      ORDER BY key_column.ordinal
    `);
    if (primaryKey.length === 0) throw new Error(`Comparator required table has no primary key: ${tableName}`);
    const order = primaryKey.map(({ name }) => `r.${quoteIdentifier(name)}`).join(", ");
    const rows = await client.$queryRawUnsafe(`
      SELECT row_to_json(r)::text AS row_json
      FROM public.${table} AS r
      ORDER BY ${order}
    `);
    tables[tableName] = {
      primaryKey: primaryKey.map(({ name }) => name),
      count: rows.length,
      rows: rows.map(({ row_json }) => row_json),
    };
  }

  const sequenceRows = await client.$queryRawUnsafe(`
    SELECT schemaname AS schema_name, sequencename AS sequence_name
    FROM pg_sequences
    WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema'
    ORDER BY schemaname, sequencename
  `);
  const sequences = [];
  for (const sequence of sequenceRows) {
    const schema = quoteIdentifier(sequence.schema_name);
    const name = quoteIdentifier(sequence.sequence_name);
    const state = await client.$queryRawUnsafe(`SELECT last_value::text AS last_value, is_called FROM ${schema}.${name}`);
    if (!state[0]) throw new Error(`Comparator sequence state is missing: ${sequence.schema_name}.${sequence.sequence_name}`);
    sequences.push({
      schema: sequence.schema_name,
      name: sequence.sequence_name,
      lastValue: state[0].last_value,
      isCalled: state[0].is_called,
    });
  }

  const migrations = await client.$queryRawUnsafe(`
    SELECT migration_name AS name, checksum, started_at AS started_at,
           finished_at AS finished_at, rolled_back_at AS rolled_back_at,
           applied_steps_count AS applied_steps_count
    FROM public."_prisma_migrations"
    ORDER BY migration_name
  `);

  return {
    tables,
    sequences,
    migrationLedger: toPlain(migrations),
  };
}
