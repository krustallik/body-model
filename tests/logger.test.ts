import { afterEach, describe, expect, it, vi } from "vitest";
import { errorKind, logEvent } from "@/lib/logger";

describe("production logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits JSON and removes sensitive fields", () => {
    const sink = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logEvent("error", "forecast_failed", {
      operation: "forecast",
      apiKey: "never-log-this",
      rawPaths: "never-log-this-either",
    });
    const record = JSON.parse(String(sink.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({ level: "error", event: "forecast_failed", operation: "forecast" });
    expect(record).not.toHaveProperty("apiKey");
    expect(record).not.toHaveProperty("rawPaths");
  });

  it("keeps rawBody while still stripping secrets", () => {
    const sink = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const rawBody = JSON.stringify({ Days: [{ Date: "2026-09-16", Steps: "100" }] });
    logEvent("info", "health_sync_received", {
      rawBody,
      apiKey: "never-log-this",
      authorization: "Bearer never-log-this",
    });
    const record = JSON.parse(String(sink.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "info",
      event: "health_sync_received",
      rawBody,
    });
    expect(record).not.toHaveProperty("apiKey");
    expect(record).not.toHaveProperty("authorization");
  });

  it("classifies failures without serializing messages or stacks", () => {
    expect(errorKind(new TypeError("secret"))).toBe("TypeError");
    expect(errorKind("secret")).toBe("UnknownError");
  });
});
