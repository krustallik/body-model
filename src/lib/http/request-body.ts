export type BoundedRequestBodyResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "payload-too-large" | "read-error" };

export async function readBoundedRequestBytes(request: Request, maximumBytes: number): Promise<BoundedRequestBodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > maximumBytes) {
    return { ok: false, reason: "payload-too-large" };
  }

  if (!request.body) return { ok: true, bytes: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "payload-too-large" };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason: "read-error" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "payload-too-large" | "invalid-body" };

export async function readBoundedJson(request: Request, maximumBytes: number): Promise<BoundedJsonResult> {
  const body = await readBoundedRequestBytes(request, maximumBytes);
  if (!body.ok) {
    return body.reason === "payload-too-large"
      ? { ok: false, reason: "payload-too-large" }
      : { ok: false, reason: "invalid-body" };
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body.bytes)) as unknown };
  } catch {
    return { ok: false, reason: "invalid-body" };
  }
}
