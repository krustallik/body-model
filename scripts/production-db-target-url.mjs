import { pathToFileURL } from "node:url";
import path from "node:path";

const PRISMA_ONLY_QUERY_PARAMETERS = ["schema", "connection_limit", "pool_timeout", "pgbouncer"];
const UNSUPPORTED_TLS_QUERY_PARAMETERS = ["sslaccept", "sslidentity"];
const TARGET_OVERRIDE_QUERY_PARAMETERS = ["host", "hostaddr", "port", "dbname", "user", "password", "service"];

export function psqlCompatibleDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || !databaseUrl) throw new Error("The effective Prisma DATABASE_URL is required.");
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === "/") {
    throw new Error("The effective Prisma DATABASE_URL is not a complete PostgreSQL target.");
  }
  if (url.hash || TARGET_OVERRIDE_QUERY_PARAMETERS.some((key) => url.searchParams.has(key))) {
    throw new Error("The effective Prisma DATABASE_URL contains target overrides that cannot be safely normalized for psql.");
  }
  const prismaSchema = url.searchParams.get("schema");
  if (prismaSchema && prismaSchema !== "public") throw new Error("Production migration tooling only supports the reviewed public Prisma schema target.");
  if (UNSUPPORTED_TLS_QUERY_PARAMETERS.some((key) => url.searchParams.has(key))) {
    throw new Error("The effective Prisma DATABASE_URL uses TLS options that psql cannot faithfully preserve.");
  }
  for (const key of PRISMA_ONLY_QUERY_PARAMETERS) url.searchParams.delete(key);
  return url.toString();
}

export function psqlUrlFromRenderedComposeConfig(compose) {
  const databaseUrl = compose?.services?.migrate?.environment?.DATABASE_URL;
  if (typeof databaseUrl !== "string" || !databaseUrl) {
    throw new Error("The rendered production migrator has no effective DATABASE_URL.");
  }
  return psqlCompatibleDatabaseUrl(databaseUrl);
}

async function main() {
  let databaseUrl = process.env.DATABASE_URL;
  if (process.argv[2] === "--compose-json") {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    process.stdout.write(psqlUrlFromRenderedComposeConfig(JSON.parse(input)));
    return;
  } else if (process.argv.length > 2) {
    throw new Error("Usage: production-db-target-url.mjs [--compose-json]");
  }
  process.stdout.write(psqlCompatibleDatabaseUrl(databaseUrl));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
