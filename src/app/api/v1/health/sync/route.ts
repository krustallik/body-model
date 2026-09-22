import { getEnv } from "@/lib/env";
import { isValidApiKey } from "@/modules/health/auth";
import { HealthSyncRequestSchema } from "@/modules/health/health.schema";
import { syncHealthData } from "@/modules/health/health.service";
import { recordHealthSyncAudit, type HealthSyncAuditOutcome } from "@/modules/health/health-sync-audit";
import {
  summarizeNormalizedDay,
  summarizeSyncBody,
} from "@/modules/health/health-sync-log";
import {
  normalizeShortcutPayload,
  ShortcutNormalizationError,
} from "@/modules/health/normalize-shortcut-payload";
import { normalizeShortcutNumericValues } from "@/modules/health/normalize-shortcut-numeric-values";
import {
  normalizeShortcutRangePayload,
  ShortcutRangeNormalizationError,
} from "@/modules/health/normalize-shortcut-range-payload";
import { errorKind, logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type");
  let rawBody: string | null;
  try {
    // Read text once so malformed JSON and rejected requests retain their exact body.
    rawBody = await request.text();
  } catch (error) {
    await recordHealthSyncAudit({
      outcome: "body-read-error",
      httpStatus: 400,
      rawBody: null,
      contentType,
      errorType: errorKind(error),
    });
    logEvent("warn", "health_sync_body_read_failed", { errorType: errorKind(error) });
    return Response.json({ error: "validation_error", details: [{ path: [], message: "Unable to read request body" }] }, { status: 400 });
  }
  const audit = async (outcome: HealthSyncAuditOutcome, httpStatus: number, errorType?: string) => {
    await recordHealthSyncAudit({ outcome, httpStatus, rawBody, contentType, errorType: errorType ?? null });
  };

  if (!isValidApiKey(request.headers.get("x-api-key"), getEnv().IOS_SHORTCUT_API_KEY)) {
    await audit("unauthorized", 401);
    logEvent("warn", "health_sync_unauthorized", { contentType });
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!contentType?.toLowerCase().startsWith("application/json")) {
    await audit("invalid-content-type", 400);
    logEvent("warn", "health_sync_invalid_content_type", { contentType });
    return Response.json(
      { error: "validation_error", details: [{ path: [], message: "Content-Type must be application/json" }] },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch (error) {
    await audit("invalid-json", 400, errorKind(error));
    logEvent("warn", "health_sync_invalid_json", { contentType, errorType: errorKind(error) });
    return Response.json(
      { error: "validation_error", details: [{ path: [], message: "Invalid JSON body" }] },
      { status: 400 },
    );
  }

  const requestSummary = summarizeSyncBody(body);
  logEvent("info", "health_sync_received", {
    ...requestSummary,
  });

  let normalized;
  let rangeNormalized;
  try {
    rangeNormalized = normalizeShortcutRangePayload(body);
    normalized = normalizeShortcutPayload(rangeNormalized?.payload ?? body);
  } catch (error) {
    if (error instanceof ShortcutRangeNormalizationError) {
      logEvent("warn", "health_sync_range_normalization_failed", {
        ...requestSummary,
        issueSummary: error.issues
          .slice(0, 8)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")
          .slice(0, 500),
        issueCount: error.issues.length,
      });
      await audit("normalization-error", 400, errorKind(error));
      return Response.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
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
      await audit("normalization-error", 400, errorKind(error));
      return Response.json(
        { error: "normalization_error", details: error.issues },
        { status: 400 },
      );
    }
    await audit("internal-error", 500, errorKind(error));
    logEvent("error", "health_sync_normalization_unexpected_failed", {
      ...requestSummary,
      errorType: errorKind(error),
    });
    return Response.json({ error: "internal_error" }, { status: 500 });
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
    await audit("validation-error", 400, "ZodError");
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
    const result = rangeNormalized
      ? await syncHealthData(parsed.data, undefined, normalized.originalDays, undefined, rangeNormalized.metricSamplesByDate)
      : await syncHealthData(parsed.data, undefined, normalized.originalDays);
    logEvent("info", "health_sync_success", {
      ...requestSummary,
      ...normalizedSummary,
      created: result.created,
      updated: result.updated,
      prunedDays: result.prunedDays,
      prunedSnapshots: result.prunedSnapshots,
      retentionCutoffDate: result.retentionCutoffDate,
    });
    await audit("success", 200);
    return Response.json(result, { status: 200 });
  } catch (error) {
    logEvent("error", "health_sync_failed", {
      ...requestSummary,
      ...normalizedSummary,
      errorType: errorKind(error),
    });
    await audit("internal-error", 500, errorKind(error));
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
