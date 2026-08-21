import { describe, expect, it } from "vitest";
import { validateEnv } from "@/lib/env";

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://bodycast:secret@localhost:5432/bodycast_test",
  IOS_SHORTCUT_API_KEY: "a-long-test-secret",
};

describe("environment validation", () => {
  it("returns validated values", () => {
    expect(validateEnv(validEnv)).toEqual(validEnv);
  });

  it("reports missing critical variables without exposing secrets", () => {
    expect(() => validateEnv({ NODE_ENV: "test" })).toThrow(
      /DATABASE_URL.*IOS_SHORTCUT_API_KEY/,
    );
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() => validateEnv({ ...validEnv, DATABASE_URL: "mysql://localhost/db" })).toThrow(
      /DATABASE_URL/,
    );
  });
});
