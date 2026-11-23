import { PrismaClient } from "@prisma/client";
import { validateComparatorDatabaseUrl } from "./comparator-core.mjs";

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
             inet_server_addr()::text AS serverAddress,
             inet_server_port() AS serverPort,
             current_setting('server_version') AS serverVersion,
             current_setting('TimeZone') AS timezone,
             pg_is_in_recovery() AS inRecovery
    `);
    const row = rows[0];
    if (!row || row.database !== configured.database || row.role !== configured.role
      || Number(row.serverPort) !== 5432 || row.inRecovery !== false || !["UTC", "Etc/UTC"].includes(row.timezone)) {
      throw new Error(`Comparator PostgreSQL identity attestation failed: ${JSON.stringify({
        expected: { database: configured.database, role: configured.role, serverPort: 5432, timezone: "UTC", inRecovery: false },
        actual: row ? toPlain(row) : null,
      })}`);
    }
    if (!dockerIdentity || dockerIdentity.networkAddress !== row.serverAddress
      || dockerIdentity.containerId.length !== 64 || !/^[a-f0-9]{64}$/.test(dockerIdentity.containerId)) {
      throw new Error(`Comparator PostgreSQL server does not match the inspected isolated Docker container: ${JSON.stringify({
        databaseServerAddress: row.serverAddress,
        inspectedContainerAddress: dockerIdentity?.networkAddress ?? null,
        containerId: dockerIdentity?.containerId ?? null,
      })}`);
    }
    return await action(client, {
      host: configured.host,
      port: configured.port,
      database: row.database,
      role: row.role,
      serverAddress: row.serverAddress,
      serverPort: Number(row.serverPort),
      serverVersion: row.serverVersion,
      timezone: row.timezone,
      inRecovery: row.inRecovery,
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
    const order = primaryKey.map(({ name }) => `record.${quoteIdentifier(name)}`).join(", ");
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
