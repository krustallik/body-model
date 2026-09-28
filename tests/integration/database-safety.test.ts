import { describe, expect, it } from "vitest";
import {
  requireIsolatedStage01Database,
  STAGE01_TEST_DATABASE_NAME,
  STAGE01_TEST_DATABASE_ROLE,
} from "../../src/modules/training/testing/require-isolated-database";

const safeUrl = `postgresql://${STAGE01_TEST_DATABASE_ROLE}:secret@127.0.0.1:5432/${STAGE01_TEST_DATABASE_NAME}`;

describe("Stage 01 isolated database guard", () => {
  it("accepts only the exact local test DB, role, port, and explicit operation mode", () => {
    expect(requireIsolatedStage01Database(safeUrl, "test", "test")).toMatchObject({
      databaseName: STAGE01_TEST_DATABASE_NAME,
      role: STAGE01_TEST_DATABASE_ROLE,
      host: "127.0.0.1",
      port: 5432,
      mode: "test",
    });
    expect(requireIsolatedStage01Database(safeUrl, "seed", "seed").mode).toBe("seed");
    expect(requireIsolatedStage01Database(safeUrl, "cleanup", "cleanup").mode).toBe("cleanup");
  });

  it.each([
    [undefined, "test", "test"],
    [safeUrl, undefined, "test"],
    [safeUrl, "seed", "test"],
    ["postgresql://user:pass@127.0.0.1:5432/production", "test", "test"],
    [`postgresql://${STAGE01_TEST_DATABASE_ROLE}:secret@example.com:5432/${STAGE01_TEST_DATABASE_NAME}`, "test", "test"],
    [`postgresql://wrong:secret@127.0.0.1:5432/${STAGE01_TEST_DATABASE_NAME}`, "test", "test"],
    [`postgresql://${STAGE01_TEST_DATABASE_ROLE}:secret@127.0.0.1:5433/${STAGE01_TEST_DATABASE_NAME}`, "test", "test"],
    [`postgresql://${STAGE01_TEST_DATABASE_ROLE}:secret@127.0.0.1:5432/${STAGE01_TEST_DATABASE_NAME}?schema=public`, "test", "test"],
    [`postgresql://${STAGE01_TEST_DATABASE_ROLE}:secret@127.0.0.1:5432/${STAGE01_TEST_DATABASE_NAME}#fragment`, "test", "test"],
    ["not a url", "test", "test"],
  ])("rejects URL %s under mode %s for operation %s", (url, mode, operation) => {
    expect(() => requireIsolatedStage01Database(url, mode, operation as "test" | "seed" | "cleanup")).toThrow();
  });

  it("does not include credentials in rejection messages", () => {
    const secretUrl = "postgresql://wrong:do-not-print@example.com:5432/private_db";
    try {
      requireIsolatedStage01Database(secretUrl, "test", "test");
      throw new Error("expected the guard to reject");
    } catch (error) {
      expect(String(error)).not.toContain("do-not-print");
      expect(String(error)).not.toContain("private_db");
    }
  });
});
