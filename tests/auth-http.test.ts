import { describe, expect, it } from "vitest";
import { readAuthJson, readBoundedRequestBody } from "@/modules/auth/http";

describe("bounded auth request bodies", () => {
  it("rejects chunked JSON over the limit without a content-length header", async () => {
    let cancelled = false;
    const request = new Request("http://localhost/api/registration/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(10 * 1024));
        },
        cancel() { cancelled = true; },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await readAuthJson(request);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("parses small JSON and enforces the limit on direct Better Auth requests", async () => {
    const small = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "person@example.invalid" }),
    });
    await expect(readAuthJson(small)).resolves.toEqual({ email: "person@example.invalid" });

    const oversized = new Request("http://localhost/api/auth/email-otp/verify-email", {
      method: "POST",
      body: "x".repeat(17 * 1024),
    });
    const body = await readBoundedRequestBody(oversized);
    expect(body).toBeInstanceOf(Response);
    expect((body as Response).status).toBe(413);
  });
});
