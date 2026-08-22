import { getEnv } from "@/lib/env";
import { isValidApiKey } from "@/modules/health/auth";
import { HealthSyncRequestSchema } from "@/modules/health/health.schema";
import { syncHealthData } from "@/modules/health/health.service";
import {
  normalizeShortcutPayload,
  ShortcutNormalizationError,
} from "@/modules/health/normalize-shortcut-payload";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isValidApiKey(request.headers.get("x-api-key"), getEnv().IOS_SHORTCUT_API_KEY)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json(
      { error: "validation_error", details: [{ path: [], message: "Content-Type must be application/json" }] },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "validation_error", details: [{ path: [], message: "Invalid JSON body" }] },
      { status: 400 },
    );
  }

  let normalized;
  try {
    normalized = normalizeShortcutPayload(body);
  } catch (error) {
    if (error instanceof ShortcutNormalizationError) {
      return Response.json(
        { error: "normalization_error", details: error.issues },
        { status: 400 },
      );
    }
    throw error;
  }

  const parsed = HealthSyncRequestSchema.safeParse(normalized.payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "validation_error",
        details: parsed.error.issues.map(({ path, message, code }) => ({ path, message, code })),
      },
      { status: 400 },
    );
  }

  try {
    return Response.json(await syncHealthData(parsed.data, undefined, normalized.originalDays), { status: 200 });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
