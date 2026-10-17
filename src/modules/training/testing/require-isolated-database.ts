export const STAGE01_TEST_DATABASE_NAME = "bodycast_training_history_stage01_test" as const;
export const STAGE01_TEST_DATABASE_ROLE = "bodycast_stage01_test" as const;
export const POSTCOMMIT_TEST_DATABASE_NAME = "bodycast_training_postcommit_test" as const;
export const POSTCOMMIT_FRESH_TEST_DATABASE_NAME = "bodycast_training_postcommit_fresh_test" as const;
export const REAUDIT_TEST_DATABASE_NAME = "bodycast_training_reaudit_20261017_test" as const;
export const HEALTH_REAUDIT_TEST_DATABASE_NAME = "bodycast_health_reaudit_20261017_test" as const;
export const FULL_INTEGRATION_REAUDIT_DATABASE_NAME = "bodycast_full_integration_reaudit_20261017_test" as const;
export const FULL_INTEGRATION_CLEAN_DATABASE_NAME = "bodycast_full_integration_clean_20261017_test" as const;
export const POSTCOMMIT_TEST_DATABASE_ROLE = "bodycast_test_runner" as const;
export const POSTCOMMIT_TEST_DATABASE_PORT = 55435 as const;
export const COMPLETION_AUDIT_TEST_DATABASE_NAME = "bodycast_training_completion_audit_test" as const;
export const COMPLETION_AUDIT_TEST_DATABASE_ROLE = "bodycast_completion_audit_test" as const;
export type Stage01DatabaseMode = "test" | "seed" | "cleanup";

const ALLOWED_TEST_DATABASES = [
  { databaseName: STAGE01_TEST_DATABASE_NAME, role: STAGE01_TEST_DATABASE_ROLE, port: 5432 },
  {
    databaseName: POSTCOMMIT_TEST_DATABASE_NAME,
    role: POSTCOMMIT_TEST_DATABASE_ROLE,
    port: POSTCOMMIT_TEST_DATABASE_PORT,
  },
  {
    databaseName: POSTCOMMIT_FRESH_TEST_DATABASE_NAME,
    role: POSTCOMMIT_TEST_DATABASE_ROLE,
    port: POSTCOMMIT_TEST_DATABASE_PORT,
  },
  {
    databaseName: REAUDIT_TEST_DATABASE_NAME,
    role: POSTCOMMIT_TEST_DATABASE_ROLE,
    port: POSTCOMMIT_TEST_DATABASE_PORT,
  },
  {
    databaseName: HEALTH_REAUDIT_TEST_DATABASE_NAME,
    role: POSTCOMMIT_TEST_DATABASE_ROLE,
    port: POSTCOMMIT_TEST_DATABASE_PORT,
  },
  {
    databaseName: FULL_INTEGRATION_REAUDIT_DATABASE_NAME,
    role: POSTCOMMIT_TEST_DATABASE_ROLE,
    port: POSTCOMMIT_TEST_DATABASE_PORT,
  },
  {
    databaseName: FULL_INTEGRATION_CLEAN_DATABASE_NAME,
    role: POSTCOMMIT_TEST_DATABASE_ROLE,
    port: POSTCOMMIT_TEST_DATABASE_PORT,
  },
  {
    databaseName: COMPLETION_AUDIT_TEST_DATABASE_NAME,
    role: COMPLETION_AUDIT_TEST_DATABASE_ROLE,
    port: 5432,
  },
] as const;

export type IsolatedStage01Database = {
  databaseName: typeof ALLOWED_TEST_DATABASES[number]["databaseName"];
  role: typeof ALLOWED_TEST_DATABASES[number]["role"];
  host: string;
  port: number;
  mode: Stage01DatabaseMode;
};

const MODES: readonly Stage01DatabaseMode[] = ["test", "seed", "cleanup"];

/**
 * This module is deliberately dependency-free. Call it before importing PrismaClient
 * or any module that constructs a database connection.
 */
export function requireIsolatedStage01Database(
  databaseUrl: string | undefined,
  mode: string | undefined,
  expectedMode: Stage01DatabaseMode,
): IsolatedStage01Database {
  if (!MODES.includes(expectedMode)) throw new Error("Invalid Stage 01 database operation.");
  if (mode !== expectedMode) {
    throw new Error("Stage 01 requires BODYCAST_STAGE01_MODE=" + expectedMode + ".");
  }
  if (!databaseUrl) throw new Error("Stage 01 requires an explicit DATABASE_URL; no fallback is allowed.");

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Stage 01 DATABASE_URL is invalid.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Stage 01 accepts PostgreSQL URLs only.");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("Stage 01 database host must be loopback.");
  }
  const role = decodeURIComponent(parsed.username);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const allowedDatabase = ALLOWED_TEST_DATABASES.find((target) => (
    target.role === role && target.databaseName === databaseName && String(target.port) === parsed.port
  ));
  if (!allowedDatabase) throw new Error("Stage 01 database target is not allowlisted.");
  if (!parsed.password) throw new Error("Stage 01 database credentials are required.");
  if (parsed.search || parsed.hash) {
    throw new Error("Stage 01 DATABASE_URL cannot override schema, SSL, or connection options.");
  }
  return {
    databaseName: allowedDatabase.databaseName,
    role: allowedDatabase.role,
    host,
    port: allowedDatabase.port,
    mode: expectedMode,
  };
}
