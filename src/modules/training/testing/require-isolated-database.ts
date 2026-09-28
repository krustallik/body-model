export const STAGE01_TEST_DATABASE_NAME = "bodycast_training_history_stage01_test" as const;
export const STAGE01_TEST_DATABASE_ROLE = "bodycast_stage01_test" as const;
export type Stage01DatabaseMode = "test" | "seed" | "cleanup";

export type IsolatedStage01Database = {
  databaseName: typeof STAGE01_TEST_DATABASE_NAME;
  role: typeof STAGE01_TEST_DATABASE_ROLE;
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
  if (role !== STAGE01_TEST_DATABASE_ROLE) {
    throw new Error("Stage 01 database role is not allowlisted.");
  }
  if (decodeURIComponent(parsed.pathname.replace(/^\//, "")) !== STAGE01_TEST_DATABASE_NAME) {
    throw new Error("Stage 01 database name is not allowlisted.");
  }
  if (parsed.port !== "5432") throw new Error("Stage 01 database port must be 5432.");
  if (!parsed.password) throw new Error("Stage 01 database credentials are required.");
  if (parsed.search || parsed.hash) {
    throw new Error("Stage 01 DATABASE_URL cannot override schema, SSL, or connection options.");
  }
  return {
    databaseName: STAGE01_TEST_DATABASE_NAME,
    role: STAGE01_TEST_DATABASE_ROLE,
    host,
    port: 5432,
    mode: expectedMode,
  };
}
