import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runProductionRecoveryFlowFixture } from "../production-recovery-flow-fixture.mjs";
import { canonicalDigest } from "../../scripts/production-recovery/canonical.mjs";
import { createLogicalDatabaseIdentity } from "../../scripts/production-recovery/database-identity.mjs";
import { normalizeColumns, verifyReadOnlySchemaCompatibility } from "../../scripts/production-recovery/schema-compatibility.mjs";

const databaseUrl = process.env.BODYCAST_RECOVERY_TEST_DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
const databaseName = parsed ? decodeURIComponent(parsed.pathname.replace(/^\//, "")) : "";
if (!parsed || !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase())
  || !databaseName.endsWith("_test")) {
  throw new Error("Recovery PostgreSQL tests require BODYCAST_RECOVERY_TEST_DATABASE_URL to a loopback *_test database.");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const suffix = `${process.pid}_${Math.floor(Math.random() * 1_000_000)}`;
const schema = `recovery_flow_${suffix}`;
const table = "rollback_contract";
const logicalIdentity = createLogicalDatabaseIdentity({
  deployRootIdentity: "isolated-ci-deploy-root",
  hostTopologyIdentity: "isolated-ci-host-topology",
  composeProjectIdentity: "bodycast-recovery-test",
  composeConfigurationDigest: "1".repeat(64),
  databaseService: "postgres-test-service",
  storageVolumeIdentity: "ephemeral-test-volume",
  databaseName,
  applicationRoleIdentity: "bodycast-ci-test-role",
  recoveryReadOnlyRoleIdentity: "bodycast-recovery-readonly-fixture",
  backendNetworkIdentity: "isolated-test-network",
  applicationDatabaseBindingDigest: "2".repeat(64),
});

async function query(tx: { $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>; $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number> }, sql: string, values: unknown[] = []): Promise<unknown[]> {
  if (/^\s*SET\s+TRANSACTION\s+READ\s+ONLY/i.test(sql)) {
    await tx.$executeRawUnsafe(sql, ...values);
    return [];
  }
  return await tx.$queryRawUnsafe<unknown[]>(sql, ...values);
}

describe("isolated PostgreSQL positive two-phase production recovery flow", () => {
  beforeAll(async () => {
    const roles = await prisma.$queryRaw<Array<{ rolsuper: boolean }>>`
      SELECT rolsuper FROM pg_roles WHERE rolname = current_user
    `;
    if (roles[0]?.rolsuper !== true) throw new Error("Recovery integration fixture requires a disposable PostgreSQL superuser on *_test only.");
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await prisma.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (id integer NOT NULL, value text NOT NULL)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "${schema}"."${table}" (id, value) VALUES (1, 'pre-restore')`);
    await prisma.$executeRawUnsafe(`CREATE TABLE "${schema}"."migration_history" (migration_name text PRIMARY KEY, checksum text NOT NULL, finished_at timestamptz, rolled_back_at timestamptz)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "${schema}"."migration_history" VALUES ('pre-ddl-baseline', '${"a".repeat(64)}', now(), NULL)`);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await prisma.$disconnect();
  });

  it("requires real read-only schema, migration-history, and logical-database verification at the restore-verified boundary", async () => {
    const schemaColumns = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT column_name, data_type, udt_name, is_nullable, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = ${table}
      ORDER BY ordinal_position
    `;
    const normalizedColumns = normalizeColumns(schemaColumns);
    const schemaDigest = canonicalDigest([{ schema, table, columns: normalizedColumns }]);
    const migrationRows = await prisma.$queryRawUnsafe<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>(
      `SELECT migration_name, checksum, finished_at, rolled_back_at FROM "${schema}"."migration_history" `
        + "WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name",
    );
    const migrations = migrationRows.map((row) => ({
      migrationName: row.migration_name,
      checksum: row.checksum,
      finishedAt: row.finished_at instanceof Date ? row.finished_at.toISOString() : row.finished_at,
      rolledBackAt: row.rolled_back_at instanceof Date ? row.rolled_back_at.toISOString() : row.rolled_back_at,
    }));
    const migrationHistoryDigest = canonicalDigest(migrations);
    let compatibilityVerified = false;

    await runProductionRecoveryFlowFixture({
      logicalDatabaseIdentityDigest: logicalIdentity.identityDigest,
      restoredSchemaDigest: schemaDigest,
      migrationHistoryDigest,
      afterRestoreBegins: async (boundary) => {
        expect(boundary.authorityState.state).toBe("restore-in-progress");
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`ALTER TABLE "${schema}"."${table}" ADD COLUMN migration_added text`);
          await tx.$executeRawUnsafe(`UPDATE "${schema}"."${table}" SET value = 'post-ddl' WHERE id = 1`);
          await tx.$executeRawUnsafe(`INSERT INTO "${schema}"."migration_history" VALUES ('simulated-post-ddl', '${"b".repeat(64)}', now(), NULL)`);
          const postDdl = await tx.$queryRawUnsafe<Array<{ column_name: string }>>(`SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${table}'`);
          expect(postDdl.some((column) => column.column_name === "migration_added")).toBe(true);
          const history = await tx.$queryRawUnsafe<Array<{ migration_name: string }>>(`SELECT migration_name FROM "${schema}"."migration_history"`);
          expect(history.some((row) => row.migration_name === "simulated-post-ddl")).toBe(true);
        });
      },
      beforeRestoreVerified: async (boundary) => {
        expect(boundary.authorityState.state).toBe("restore-in-progress");
        await prisma.$executeRawUnsafe(`ALTER TABLE "${schema}"."${table}" DROP COLUMN migration_added`);
        await prisma.$executeRawUnsafe(`DELETE FROM "${schema}"."migration_history" WHERE migration_name = 'simulated-post-ddl'`);
        await prisma.$executeRawUnsafe(`UPDATE "${schema}"."${table}" SET value = 'pre-restore' WHERE id = 1`);
        const verify = (expectedSchemaDigest: string) => verifyReadOnlySchemaCompatibility({
          withReadOnlyTransaction: (work) => prisma.$transaction(async (tx) => {
            const result = await work((sql, values) => query(tx, sql, values));
            await tx.$executeRawUnsafe("SAVEPOINT bodycast_recovery_read_only_probe");
            let writeWasRejected = false;
            try {
              await tx.$executeRawUnsafe(`INSERT INTO "${schema}"."${table}" (id, value) VALUES (2, 'must-not-write')`);
            } catch (error) {
              writeWasRejected = String(error).includes("25006") || String(error).toLowerCase().includes("read-only transaction");
              await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT bodycast_recovery_read_only_probe");
            }
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT bodycast_recovery_read_only_probe");
            expect(writeWasRejected).toBe(true);
            return result;
          }),
          resolveLogicalDatabaseIdentity: async (readQuery) => {
            const rows = await readQuery("SELECT current_database() AS database_name, inet_server_port() AS port, current_setting('server_version') AS server_version", []);
            const observed = rows[0] as Record<string, unknown>;
            expect(observed.database_name).toBe(databaseName);
            return {
              identityDigest: logicalIdentity.identityDigest,
              observationsDigest: canonicalDigest({ database: observed.database_name, port: observed.port, serverVersion: observed.server_version }),
            };
          },
          migrationHistoryRelation: { schema, table: "migration_history" },
          expected: {
            schemaVersion: 1,
            logicalProductionDbIdentityDigest: logicalIdentity.identityDigest,
            requiredRelations: [{ schema, table, columns: normalizedColumns }],
            expectedSchemaDigest,
            migrationNames: migrations.map((row) => row.migrationName),
            expectedMigrationHistoryDigest: migrationHistoryDigest,
          },
        });
        await expect(verify("f".repeat(64))).rejects.toThrow(/schema digest/);
        expect(boundary.authorityState.state).toBe("restore-in-progress");
        const actual = await verify(schemaDigest);
        expect(actual.schemaCompatible).toBe(true);
        expect(actual.logicalProductionDbIdentityDigest).toBe(boundary.logicalDatabaseIdentityDigest);
        expect(actual.actualSchemaDigest).toBe(schemaDigest);
        expect(actual.actualMigrationHistoryDigest).toBe(migrationHistoryDigest);
        expect(actual.requiredRelationsChecked).toBe(1);
        compatibilityVerified = true;
        return {
          schemaCompatible: actual.schemaCompatible,
          readOnly: true,
          logicalProductionDbIdentityDigest: actual.logicalProductionDbIdentityDigest,
          actualSchemaDigest: actual.actualSchemaDigest,
          actualMigrationHistoryDigest: actual.actualMigrationHistoryDigest,
        };
      },
      afterRestoreVerified: async (boundary) => {
        expect(boundary.authorityState.state).toBe("restore-verified");
        const row = await prisma.$queryRawUnsafe<Array<{ value: string }>>(`SELECT value FROM "${schema}"."${table}" WHERE id = 1`);
        expect(row).toEqual([{ value: "pre-restore" }]);
      },
    });

    expect(compatibilityVerified).toBe(true);
  }, 30_000);
});
