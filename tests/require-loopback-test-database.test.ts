import { describe, expect, it } from "vitest";
import { requireLoopbackTestDatabaseUrl } from "./helpers/require-loopback-test-database";

describe("integration database safety guard", () => {
  it("accepts only explicitly named loopback test databases", () => {
    expect(requireLoopbackTestDatabaseUrl("postgresql://test:secret@127.0.0.1:55434/bodycast_recalc_test"))
      .toBe("postgresql://test:secret@127.0.0.1:55434/bodycast_recalc_test");
    expect(requireLoopbackTestDatabaseUrl("postgres://test:secret@[::1]:5432/bodycast_test"))
      .toBe("postgres://test:secret@[::1]:5432/bodycast_test");
  });

  it.each([
    undefined,
    "not-a-url",
    "mysql://test:secret@localhost/bodycast_test",
    "postgresql://test:secret@db.internal/bodycast_test",
    "postgresql://test:secret@127.0.0.1/bodycast",
    "postgresql://test:secret@127.0.0.1/bodycast_test#production",
  ])("rejects an unsafe or ambiguous integration database URL", (databaseUrl) => {
    expect(() => requireLoopbackTestDatabaseUrl(databaseUrl)).toThrow();
  });
});
