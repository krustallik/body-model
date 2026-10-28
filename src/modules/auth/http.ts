const MAX_AUTH_BODY_BYTES = 16 * 1024;

export async function readBoundedRequestBody(request: Request, maximumBytes = MAX_AUTH_BODY_BYTES): Promise<Uint8Array | Response> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return Response.json({ error: "payload_too_large" }, { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
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
