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

  try {
    return await request.json();
  } catch {
    return Response.json(
      { error: "validation_error", details: [{ path: [], message: "Invalid JSON body" }] },
      { status: 400 },
    );
  }
}
