import { describe, expect, it } from "vitest";
import { validateEnv } from "@/lib/env";

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://bodycast:secret@localhost:5432/bodycast_test",
  IOS_SHORTCUT_API_KEY: "a-long-test-secret",
};

describe("environment validation", () => {
  it("returns validated values", () => {
    expect(validateEnv(validEnv)).toMatchObject({
      ...validEnv,
      AUTH_PUBLIC_REGISTRATION_ENABLED: "false",
      AUTH_PROFILE_ONE_BOOTSTRAP_ENABLED: "false",
      LEGACY_IOS_SHORTCUT_ENABLED: "false",
      AUTH_EMAIL_DAILY_LIMIT: 250,
      AUTH_EMAIL_RECIPIENT_DAILY_LIMIT: 10,
    });
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

  it("rejects malformed trusted proxy entries and accepts IPv4/IPv6 CIDRs", () => {
    expect(() => validateEnv({ ...validEnv, AUTH_TRUSTED_PROXIES: "127.0.0.1/32,not-an-address" }))
      .toThrow(/AUTH_TRUSTED_PROXIES.*valid IP addresses or CIDR ranges/);
    expect(() => validateEnv({ ...validEnv, AUTH_TRUSTED_PROXIES: "192.0.2.1/33" }))
      .toThrow(/AUTH_TRUSTED_PROXIES/);
    expect(() => validateEnv({ ...validEnv, AUTH_TRUSTED_PROXIES: "0.0.0.0/0" }))
      .toThrow(/AUTH_TRUSTED_PROXIES/);
    expect(() => validateEnv({ ...validEnv, AUTH_TRUSTED_PROXIES: "::/0" }))
      .toThrow(/AUTH_TRUSTED_PROXIES/);
    expect(validateEnv({ ...validEnv, AUTH_TRUSTED_PROXIES: "127.0.0.1/32,2001:db8::/32" }).AUTH_TRUSTED_PROXIES)
      .toBe("127.0.0.1/32,2001:db8::/32");
  });

  it("rejects production placeholder secrets", () => {
    expect(() => validateEnv({
      ...validEnv,
      NODE_ENV: "production",
      IOS_SHORTCUT_API_KEY: "replace_with_long_random_secret",
    })).toThrow(/placeholder/);
    expect(() => validateEnv({
      ...validEnv,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://bodycast:change_me@localhost:5432/bodycast",
    })).toThrow(/placeholder/);
  });
});
