import { readBoundedRequestBytes } from "@/lib/http/request-body";

const MAX_AUTH_BODY_BYTES = 16 * 1024;

export async function readBoundedRequestBody(request: Request, maximumBytes = MAX_AUTH_BODY_BYTES): Promise<Uint8Array | Response> {
  const body = await readBoundedRequestBytes(request, maximumBytes);
  if (body.ok) return body.bytes;
  return body.reason === "payload-too-large"
    ? Response.json({ error: "payload_too_large" }, { status: 413 })
    : Response.json({ error: "invalid_request" }, { status: 400 });
}

export async function readAuthJson(request: Request): Promise<unknown | Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = await readBoundedRequestBody(request);
  if (body instanceof Response) return body;
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
}
