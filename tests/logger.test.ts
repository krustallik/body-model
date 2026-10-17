import { afterEach, describe, expect, it, vi } from "vitest";
import { errorDiagnosticFields, errorKind, logEvent } from "@/lib/logger";

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

  it("logs only the first application frame and a safe error code", () => {
    const error = new Error("private database URL and user data");
    Object.assign(error, { code: "P2034" });
    error.stack = [
      `${error.name}: ${error.message}`,
      "    at recalculate (/srv/bodycast/.next/server/app/api/forecast/action/route.js:12:8)",
      "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ].join("\n");

    const fields = errorDiagnosticFields(error);
    expect(fields).toMatchObject({
      errorType: "Error",
      errorCode: "P2034",
      errorFrame: ".next/server/app/api/forecast/action/route.js:12:8",
    });
    expect(JSON.stringify(fields)).not.toContain("private database URL");
    expect(JSON.stringify(fields)).not.toContain("/srv/bodycast");
  });

  it("classifies Prisma transaction expiration without logging engine text", () => {
    const error = Object.assign(new Error(
      "Transaction already closed: timeout for this transaction was 30000 ms, however 30211 ms passed since the start",
    ), { code: "P2028" });
    const fields = errorDiagnosticFields(error);
    expect(fields).toMatchObject({
      errorType: "Error",
      errorCode: "P2028",
      transactionFailureKind: "transaction-expired-or-closed",
      transactionTimeoutMs: 30_000,
      transactionElapsedMs: 30_211,
    });
    expect(JSON.stringify(fields)).not.toContain("Transaction already closed");
  });

  it("does not emit untrusted error codes or non-application stack frames", () => {
    const error = new Error("secret");
    Object.assign(error, { code: "DATABASE_URL=secret" });
    error.stack = `${error.name}: ${error.message}\n    at query (node:internal/process/task_queues:95:5)`;

    expect(errorDiagnosticFields(error)).toEqual({ errorType: "Error" });
  });

  it("bounds stack frame paths and locations", () => {
    const error = new Error("secret");
    error.stack = `${error.name}: ${error.message}\n    at query (/app/src/${"a".repeat(300)}.ts:999999999:1)`;
    expect(errorDiagnosticFields(error)).toEqual({ errorType: "Error" });
  });
});
