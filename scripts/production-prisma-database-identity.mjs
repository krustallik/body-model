import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    const rows = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
      return transaction.$queryRaw`
        SELECT current_database() AS database,
          (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid",
          (SELECT system_identifier::text FROM pg_control_system()) AS "clusterSystemIdentifier",
          current_user AS role,
          current_setting('server_version') AS "serverVersion",
          host(inet_server_addr()) AS "serverAddress",
          inet_server_port() AS "serverPort" WHERE pg_is_in_recovery() = false
      `;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 15_000 });
    const row = rows[0];
    const databaseOid = Number(row?.databaseOid);
    const serverPort = Number(row?.serverPort);
    if (rows.length !== 1 || row?.database !== "bodycast" || !Number.isSafeInteger(databaseOid) || databaseOid < 1
      || typeof row.clusterSystemIdentifier !== "string" || !/^[1-9][0-9]*$/.test(row.clusterSystemIdentifier)
      || row.role !== "bodycast" || typeof row.serverVersion !== "string" || !row.serverVersion.startsWith("17.")
      || typeof row.serverAddress !== "string" || !row.serverAddress || !Number.isInteger(serverPort) || serverPort !== 5432) {
      throw new Error("Prisma DATABASE_URL did not reach the expected BodyCast PostgreSQL primary.");
    }
    process.stdout.write(`BODYCAST_PRISMA_DB_IDENTITY=${[
      row.database, String(databaseOid), row.clusterSystemIdentifier, row.role,
      row.serverVersion, row.serverAddress, String(serverPort),
    ].join("|")}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`Prisma database identity check failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
