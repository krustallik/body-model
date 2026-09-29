import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalDemoMode } from "@/modules/demo/local-demo-mode";

afterEach(() => vi.unstubAllEnvs());

describe("local demo mode switch", () => {
  it("requires an explicit flag in development or test", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BODYCAST_DEMO_MODE", "1");
    expect(isLocalDemoMode()).toBe(true);

    vi.stubEnv("BODYCAST_DEMO_MODE", "0");
    expect(isLocalDemoMode()).toBe(false);
  });

  it("cannot activate in production even with the explicit flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BODYCAST_DEMO_MODE", "1");
    expect(isLocalDemoMode()).toBe(false);
  });
});
