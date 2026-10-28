import { randomUUID } from "node:crypto";
import { getProfilePrincipal } from "@/modules/auth/access";
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
import { healthSyncRepositoryForProfile } from "@/modules/health/health.repository";
import { enforceAuthRequestLimit } from "@/modules/auth/access";

export const dynamic = "force-dynamic";
const MAX_HEALTH_SYNC_BODY_BYTES = 5 * 1024 * 1024;

async function readBoundedBody(request: Request): Promise<{ rawBody: string; tooLarge: false } | { rawBody: null; tooLarge: true }> {
  if (!request.body) return { rawBody: "", tooLarge: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    totalBytes += next.value.byteLength;
    if (totalBytes > MAX_HEALTH_SYNC_BODY_BYTES) {
      await reader.cancel();
      return { rawBody: null, tooLarge: true };
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { rawBody: new TextDecoder().decode(body), tooLarge: false };
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const requestStartedAt = performance.now();
  const bodyReadStartedAt = performance.now();
  const contentType = request.headers.get("content-type");
  let auditProfileId: number | null = null;
  let rawBody: string | null = null;
  let bodyReadMs: number;
  const audit = async (outcome: HealthSyncAuditOutcome, httpStatus: number, errorType?: string) => {
    await recordHealthSyncAudit({ profileId: auditProfileId, outcome, httpStatus, rawBody, contentType, errorType: errorType ?? null });
  };
  const ipLimit = await enforceAuthRequestLimit(request, "health-sync", { ipMax: 10 });
  if (ipLimit) {
    await audit("unauthorized", 429, "RateLimited");
    return ipLimit;
  }
  const declaredBytes = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_HEALTH_SYNC_BODY_BYTES) {
    await audit("payload-too-large", 413, "BodyTooLarge");
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  try {
    // Read text once so malformed JSON and rejected requests retain their exact body.
    const body = await readBoundedBody(request);
    if (body.tooLarge) {
      await audit("payload-too-large", 413, "BodyTooLarge");
      return Response.json({ error: "payload_too_large" }, { status: 413 });
    }
    rawBody = body.rawBody;
    bodyReadMs = Math.round(performance.now() - bodyReadStartedAt);
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

  const principal = await getProfilePrincipal(request);
  if (!principal || principal.method === "session") {
    await audit("unauthorized", 401);
    logEvent("warn", "health_sync_unauthorized", { contentType });
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  auditProfileId = principal.profileId;

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
    requestId,
    bodyReadMs,
  });

  let normalized;
  let rangeNormalized;
  const normalizationStartedAt = performance.now();
  try {
    rangeNormalized = normalizeShortcutRangePayload(body);
    normalized = normalizeShortcutPayload(rangeNormalized?.payload ?? body);
  } catch (error) {
    if (error instanceof ShortcutRangeNormalizationError) {
      logEvent("warn", "health_sync_range_normalization_failed", {
        ...requestSummary,
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
  };
  const normalizationMs = Math.round(performance.now() - normalizationStartedAt);

  try {
    const persistenceStartedAt = performance.now();
    const result = rangeNormalized
      ? await syncHealthData(parsed.data, healthSyncRepositoryForProfile(principal.profileId), normalized.originalDays, undefined, rangeNormalized.metricSamplesByDate, {
        deferDependentRefresh: true,
      })
      : await syncHealthData(parsed.data, healthSyncRepositoryForProfile(principal.profileId), normalized.originalDays, undefined, undefined, {
        deferDependentRefresh: true,
      });
    const persistenceMs = Math.round(performance.now() - persistenceStartedAt);
    logEvent("info", "health_sync_success", {
      ...requestSummary,
      requestId,
      normalizationMs,
      persistenceMs,
      ...normalizedSummary,
      created: result.created,
      updated: result.updated,
      modelPublicationStatus: result.modelPublicationStatus,
      refreshDeferred: true,
      prunedDays: result.prunedDays,
      prunedSnapshots: result.prunedSnapshots,
      retentionCutoffDate: result.retentionCutoffDate,
    });
    const auditStartedAt = performance.now();
    await audit("success", 200);
    logEvent("info", "health_sync_http_response", {
      requestId,
      status: 200,
      bodyReadMs,
      normalizationMs,
      persistenceMs,
      auditMs: Math.round(performance.now() - auditStartedAt),
      totalMs: Math.round(performance.now() - requestStartedAt),
      modelPublicationStatus: result.modelPublicationStatus,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    logEvent("error", "health_sync_failed", {
      ...requestSummary,
      requestId,
      totalMs: Math.round(performance.now() - requestStartedAt),
      ...normalizedSummary,
      errorType: errorKind(error),
    });
    await audit("internal-error", 500, errorKind(error));
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
