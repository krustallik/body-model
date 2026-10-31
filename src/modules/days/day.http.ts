import type { z } from "zod";
import { readBoundedJson } from "@/lib/http/request-body";

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

  const body = await readBoundedJson(request, 1_048_576);
  if (body.ok) return body.value;
  if (body.reason === "payload-too-large") {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  return Response.json(
    { error: "validation_error", details: [{ path: [], message: "Invalid JSON body" }] },
    { status: 400 },
  );
}
