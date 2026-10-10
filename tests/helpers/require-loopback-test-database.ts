/**
 * Integration suites can write broad derived state, so accept only an explicit
 * loopback PostgreSQL database whose name is visibly reserved for tests.
 */
export function requireLoopbackTestDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error("Integration tests require an explicit loopback *_test database URL.");

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Integration test database URL is invalid.");
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase();
  } catch {
    throw new Error("Integration test database URL is invalid.");
  }
  if ((parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:")
      || !["127.0.0.1", "localhost", "::1"].includes(host)
      || !databaseName.endsWith("_test")
      || parsed.search
      || parsed.hash) {
    throw new Error("Integration tests require an explicit loopback *_test database URL.");
  }

  return databaseUrl;
}
