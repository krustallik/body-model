import { describe, expect, it } from "vitest";
import { readJson } from "@/modules/days/day.http";
import { readBoundedJson } from "@/lib/http/request-body";

describe("JSON request limits", () => {
  it("rejects a declared oversized request before parsing", async () => {
    const response = await readJson(new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1048577" },
      body: "{}",
    }));
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(413);
  });

  it("cancels a missing-length stream as soon as the configured byte limit is crossed", async () => {
    let cancelled = false;
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(1_048_577)); },
        cancel() { cancelled = true; },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await readJson(request);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("does not parse partial JSON after a streaming overflow", async () => {
    let cancelled = false;
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode('{"part":"'));
          controller.enqueue(new Uint8Array(1_048_577));
        },
        cancel() { cancelled = true; },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedJson(request, 1_048_576)).resolves.toEqual({ ok: false, reason: "payload-too-large" });
    expect(cancelled).toBe(true);
  });

  it("maps request stream failures to invalid JSON without exposing partial bytes", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'));
          controller.error(new Error("stream failed"));
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedJson(request, 1_048_576)).resolves.toEqual({ ok: false, reason: "invalid-body" });
  });
});
