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

  it("classifies failures without serializing messages or stacks", () => {
    expect(errorKind(new TypeError("secret"))).toBe("TypeError");
    expect(errorKind("secret")).toBe("UnknownError");
  });
});
