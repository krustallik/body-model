import type { z } from "zod";

export function validationResponse(error: z.ZodError): Response {
  return Response.json(
    {
      error: "validation_error",
      details: error.issues.map(({ path, message, code }) => ({ path, message, code })),
    },
    { status: 400 },
  );
}

export async function readJson(request: Request): Promise<unknown | Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json(
      { error: "validation_error", details: [{ path: [], message: "Content-Type must be application/json" }] },
      { status: 400 },
    );
  }

  const maximumBytes = 1_048_576;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
      return Response.json({ error: "payload_too_large" }, { status: 413 });
    }
    return JSON.parse(text) as unknown;
  } catch {
    return Response.json(
      { error: "validation_error", details: [{ path: [], message: "Invalid JSON body" }] },
      { status: 400 },
    );
  }
}
