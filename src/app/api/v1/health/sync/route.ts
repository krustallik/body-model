import { getEnv } from "@/lib/env";
import { isValidApiKey } from "@/modules/health/auth";
import { HealthSyncRequestSchema } from "@/modules/health/health.schema";
import { syncHealthData } from "@/modules/health/health.service";
import {
  serializeRawSyncBody,
  summarizeNormalizedDay,
  summarizeSyncBody,
} from "@/modules/health/health-sync-log";
import {
  normalizeShortcutPayload,
  ShortcutNormalizationError,
} from "@/modules/health/normalize-shortcut-payload";
import { normalizeShortcutNumericValues } from "@/modules/health/normalize-shortcut-numeric-values";
import { errorKind, logEvent } from "@/lib/logger";

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

  const requestSummary = summarizeSyncBody(body);
  logEvent("info", "health_sync_received", {
    ...requestSummary,
    rawBody: serializeRawSyncBody(body),
  });

  let normalized;
  try {
    normalized = normalizeShortcutPayload(body);
  } catch (error) {
    if (error instanceof ShortcutNormalizationError) {
      logEvent("warn", "health_sync_normalization_failed", {
        ...requestSummary,
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
      ...requestSummary,
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

  const day = parsed.data.days[0];
  const normalizedSummary = {
    derivedWorkoutCount: day.workouts?.length ?? 0,
    strengthTrainingMinutes: day.strengthTrainingMinutes ?? null,
    dayDate: day.date,
  };

  try {
    const result = await syncHealthData(parsed.data, undefined, normalized.originalDays);
    logEvent("info", "health_sync_success", {
      ...requestSummary,
      ...normalizedSummary,
      created: result.created,
      updated: result.updated,
      prunedDays: result.prunedDays,
      prunedSnapshots: result.prunedSnapshots,
      retentionCutoffDate: result.retentionCutoffDate,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    logEvent("error", "health_sync_failed", {
      ...requestSummary,
      ...normalizedSummary,
      errorType: errorKind(error),
    });
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
