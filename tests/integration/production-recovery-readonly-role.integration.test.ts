import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.BODYCAST_RECOVERY_TEST_DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
const databaseName = parsed ? decodeURIComponent(parsed.pathname.replace(/^\//, "")) : "";
if (!parsed || !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase())
  || !databaseName.endsWith("_test")) {
  throw new Error("Recovery PostgreSQL tests require BODYCAST_RECOVERY_TEST_DATABASE_URL to a loopback *_test database.");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const suffix = `${process.pid}_${Math.floor(Math.random() * 1_000_000)}`;
const role = `bodycast_recovery_readonly_test_${suffix}`;
const schema = `recovery_ro_${suffix}`;

type ExecuteClient = { $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> };

async function expectDenied(tx: ExecuteClient, statement: string): Promise<void> {
  await tx.$executeRawUnsafe("SAVEPOINT bodycast_recovery_write_probe");
  let denied = false;
  try {
    await tx.$executeRawUnsafe(statement);
  } catch (error) {
    const message = String(error);
    denied = message.includes("42501") || message.toLowerCase().includes("permission denied")
      || message.toLowerCase().includes("insufficient privilege");
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT bodycast_recovery_write_probe");
  }
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT bodycast_recovery_write_probe");
  expect(denied, `Expected PostgreSQL to reject: ${statement}`).toBe(true);
}

describe("production recovery PostgreSQL read-only role contract", () => {
  afterAll(async () => prisma.$disconnect());

  it("permits meaningful reads while PostgreSQL rejects DML, DDL, sequence, and function writes", async () => {
    await prisma.$transaction(async (tx) => {
      const capabilities = await tx.$queryRaw<Array<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolbypassrls: boolean }>>`
        SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user
      `;
      expect(capabilities[0]?.rolsuper).toBe(true);

      await tx.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`CREATE TABLE "${schema}"."probe" (id integer PRIMARY KEY, value text NOT NULL)`);
      await tx.$executeRawUnsafe(`CREATE SEQUENCE "${schema}"."probe_seq"`);
      await tx.$executeRawUnsafe(`INSERT INTO "${schema}"."probe" (id, value) VALUES (1, 'existing')`);
      await tx.$executeRawUnsafe(`CREATE FUNCTION "${schema}"."privileged_probe"() RETURNS integer LANGUAGE SQL SECURITY DEFINER AS 'SELECT 1'`);
      await tx.$executeRawUnsafe(`REVOKE ALL ON FUNCTION "${schema}"."privileged_probe"() FROM PUBLIC`);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
      await tx.$executeRawUnsafe(`GRANT SELECT ON TABLE "${schema}"."probe" TO "${role}"`);

      const grants = await tx.$queryRawUnsafe<Array<{ can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean; can_create: boolean; can_sequence: boolean; can_execute: boolean }>>(
        `SELECT has_table_privilege('${role}', '${schema}.probe', 'SELECT') AS can_select, `
        + `has_table_privilege('${role}', '${schema}.probe', 'INSERT') AS can_insert, `
        + `has_table_privilege('${role}', '${schema}.probe', 'UPDATE') AS can_update, `
        + `has_table_privilege('${role}', '${schema}.probe', 'DELETE') AS can_delete, `
        + `has_schema_privilege('${role}', '${schema}', 'CREATE') AS can_create, `
        + `has_sequence_privilege('${role}', '${schema}.probe_seq', 'USAGE') AS can_sequence, `
        + `has_function_privilege('${role}', '${schema}.privileged_probe()', 'EXECUTE') AS can_execute`,
      );
      expect(grants[0]).toEqual({
        can_select: true, can_insert: false, can_update: false, can_delete: false,
        can_create: false, can_sequence: false, can_execute: false,
      });

      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
      const readable = await tx.$queryRawUnsafe<Array<{ id: number; value: string }>>(`SELECT id, value FROM "${schema}"."probe"`);
      expect(readable).toEqual([{ id: 1, value: "existing" }]);
      await expectDenied(tx, `INSERT INTO "${schema}"."probe" (id, value) VALUES (2, 'blocked')`);
      await expectDenied(tx, `UPDATE "${schema}"."probe" SET value = 'blocked' WHERE id = 1`);
      await expectDenied(tx, `DELETE FROM "${schema}"."probe" WHERE id = 1`);
      await expectDenied(tx, `CREATE TABLE "${schema}"."blocked_ddl" (id integer)`);
      await expectDenied(tx, `ALTER TABLE "${schema}"."probe" ADD COLUMN blocked integer`);
      await expectDenied(tx, `SELECT nextval('"${schema}"."probe_seq"')`);
      await expectDenied(tx, `SELECT "${schema}"."privileged_probe"()`);
    }, { timeout: 12_000 });
  }, 15_000);
});
