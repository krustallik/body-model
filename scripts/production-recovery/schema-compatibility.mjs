import { canonicalDigest } from "./canonical.mjs";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new Error(label + " is not a safe PostgreSQL identifier.");
  return '"' + value + '"';
}

function normalizeColumns(columns) {
  return columns.map((column) => ({
    name: column.column_name ?? column.name,
    dataType: column.data_type ?? column.dataType,
    udtName: column.udt_name ?? column.udtName,
    isNullable: (column.is_nullable ?? column.isNullable) === "YES" || (column.isNullable === true),
    ordinalPosition: Number(column.ordinal_position ?? column.ordinalPosition),
  })).sort((left, right) => left.ordinalPosition - right.ordinalPosition);
}

/**
 * Checks the exact immutable rollback release's read contract without writes.
 * The caller must supply an adapter that starts a PostgreSQL READ ONLY transaction.
 */
export async function verifyReadOnlySchemaCompatibility({
  withReadOnlyTransaction,
  resolveLogicalDatabaseIdentity,
  expected,
  migrationHistoryRelation = { schema: "public", table: "_prisma_migrations" },
}) {
  if (typeof withReadOnlyTransaction !== "function" || typeof resolveLogicalDatabaseIdentity !== "function") {
    throw new Error("Read-only PostgreSQL transaction and logical database identity adapters are required.");
  }
  if (!expected || expected.schemaVersion !== 1 || !Array.isArray(expected.requiredRelations)
    || !Array.isArray(expected.migrationNames) || expected.requiredRelations.length === 0) {
    throw new Error("Immutable rollback compatibility manifest is incomplete.");
  }
  return withReadOnlyTransaction(async (query) => {
    if (typeof query !== "function") throw new Error("Read-only transaction adapter did not provide a query function.");
    await query("SET TRANSACTION READ ONLY", []);
    const identity = await resolveLogicalDatabaseIdentity(query);
    if (!identity || identity.identityDigest !== expected.logicalProductionDbIdentityDigest) {
      throw new Error("Recovery database is not the captured logical production database.");
    }

    const schemaSnapshot = [];
    for (const relation of expected.requiredRelations) {
      const schema = quoteIdentifier(relation.schema, "schema");
      const table = quoteIdentifier(relation.table, "table");
      if (!Array.isArray(relation.columns) || relation.columns.length === 0) throw new Error("Compatibility relation has no reviewed columns.");
      const rows = await query(
        "SELECT column_name, data_type, udt_name, is_nullable, ordinal_position "
          + "FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        [relation.schema, relation.table],
      );
      const actualColumns = normalizeColumns(rows);
      const expectedColumns = relation.columns.map((column, index) => ({
        name: column.name,
        dataType: column.dataType,
        udtName: column.udtName,
        isNullable: column.isNullable,
        ordinalPosition: column.ordinalPosition ?? index + 1,
      }));
      if (canonicalDigest(actualColumns) !== canonicalDigest(expectedColumns)) {
        throw new Error("Rollback schema is incompatible at " + relation.schema + "." + relation.table + ".");
      }
      const selectList = expectedColumns.map((column) => quoteIdentifier(column.name, "column")).join(", ");
      await query("SELECT " + selectList + " FROM " + schema + "." + table + " LIMIT 0", []);
      schemaSnapshot.push({ schema: relation.schema, table: relation.table, columns: actualColumns });
    }
    const actualSchemaDigest = canonicalDigest(schemaSnapshot);
    if (actualSchemaDigest !== expected.expectedSchemaDigest) throw new Error("Rollback schema digest does not match the captured compatibility manifest.");

    const historySchema = quoteIdentifier(migrationHistoryRelation.schema, "migration history schema");
    const historyTable = quoteIdentifier(migrationHistoryRelation.table, "migration history table");
    const migrations = await query(
      "SELECT migration_name, checksum, finished_at, rolled_back_at FROM " + historySchema + "." + historyTable + " "
        + "WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name",
      [],
    );
    const normalizedMigrations = migrations.map((row) => ({
      migrationName: row.migration_name,
      checksum: row.checksum,
      finishedAt: row.finished_at instanceof Date ? row.finished_at.toISOString() : row.finished_at,
      rolledBackAt: row.rolled_back_at instanceof Date ? row.rolled_back_at.toISOString() : row.rolled_back_at,
    }));
    const actualMigrationHistoryDigest = canonicalDigest(normalizedMigrations);
    if (actualMigrationHistoryDigest !== expected.expectedMigrationHistoryDigest) {
      throw new Error("Rollback migration history digest does not match the captured compatibility manifest.");
    }
    const expectedNames = [...expected.migrationNames].sort();
    const actualNames = normalizedMigrations.map((row) => row.migrationName).sort();
    if (canonicalDigest(actualNames) !== canonicalDigest(expectedNames)) {
      throw new Error("Rollback migration history does not match the exact reviewed migration set.");
    }
    return {
      schemaCompatible: true,
      logicalProductionDbIdentityDigest: identity.identityDigest,
      liveDbObservationsDigest: identity.observationsDigest,
      actualSchemaDigest,
      actualMigrationHistoryDigest,
      requiredRelationsChecked: schemaSnapshot.length,
      migrationCount: normalizedMigrations.length,
    };
  });
}

export { quoteIdentifier, normalizeColumns };
