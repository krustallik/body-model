import { getEnv } from "@/lib/env";
import { isValidApiKey } from "@/modules/health/auth";
import { HealthSyncRequestSchema } from "@/modules/health/health.schema";
import { syncHealthData } from "@/modules/health/health.service";
import {
  normalizeShortcutPayload,
  ShortcutNormalizationError,
} from "@/modules/health/normalize-shortcut-payload";
import { normalizeShortcutNumericValues } from "@/modules/health/normalize-shortcut-numeric-values";
import { errorKind, logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Compact, secret-free sync body summary for validation diagnostics. */
function summarizeSyncBody(body: unknown): {
  bodyType: string;
  rootKeys: string;
  daysCount: number;
  day0KeyCount: number;
  day0Keys: string;
  hasDate: boolean;
  hasDateCapital: boolean;
} {
  if (!isObject(body)) {
    return {
      bodyType: Array.isArray(body) ? "array" : typeof body,
      rootKeys: "",
      daysCount: -1,
      day0KeyCount: 0,
      day0Keys: "",
      hasDate: false,
      hasDateCapital: false,
    };
  }

  const daysValue = body.days ?? body.Days ?? body.DAYS;
  const daysCount = Array.isArray(daysValue) ? daysValue.length : -1;
  const day0 = Array.isArray(daysValue) && isObject(daysValue[0]) ? daysValue[0] : null;
  const day0KeysList = day0 ? Object.keys(day0) : [];
  const lower = new Set(day0KeysList.map((key) => key.toLowerCase()));

  return {
    bodyType: "object",
    rootKeys: Object.keys(body).join(",").slice(0, 200),
    daysCount,
    day0KeyCount: day0KeysList.length,
    day0Keys: day0KeysList.join(",").slice(0, 500),
    hasDate: lower.has("date"),
    hasDateCapital: day0KeysList.includes("Date"),
  };
}

function summarizeNormalizedDay(payload: unknown): {
  normalizedDaysCount: number;
  normalizedDay0Keys: string;
  normalizedHasDate: boolean;
} {
  if (!isObject(payload) || !Array.isArray(payload.days)) {
    return { normalizedDaysCount: -1, normalizedDay0Keys: "", normalizedHasDate: false };
  }
  const day0 = isObject(payload.days[0]) ? payload.days[0] : null;
  const keys = day0 ? Object.keys(day0) : [];
  return {
    normalizedDaysCount: payload.days.length,
    normalizedDay0Keys: keys.join(",").slice(0, 500),
    normalizedHasDate: typeof day0?.date === "string",
  };
}

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
      logEvent("warn", "health_sync_normalization_failed", {
        ...summarizeSyncBody(body),
        issueSummary: error.issues
          .slice(0, 8)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")
          .slice(0, 500),
        issueCount: error.issues.length,
      });
      return Response.json(
        { error: "normalization_error", details: error.issues },
        { status: 400 },
      );
    }
    throw error;
  }

  const numericNormalizedPayload = normalizeShortcutNumericValues(normalized.payload);
  const parsed = HealthSyncRequestSchema.safeParse(numericNormalizedPayload);
  if (!parsed.success) {
    logEvent("warn", "health_sync_validation_failed", {
      ...summarizeSyncBody(body),
      ...summarizeNormalizedDay(numericNormalizedPayload),
      issueSummary: parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")
        .slice(0, 500),
      issueCount: parsed.error.issues.length,
    });
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
  } catch (error) {
    logEvent("error", "health_sync_failed", { errorType: errorKind(error) });
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
