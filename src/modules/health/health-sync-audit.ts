import { prisma } from "@/lib/db/prisma";
import { errorKind, logEvent } from "@/lib/logger";

export const HEALTH_SYNC_AUDIT_RETENTION_DAYS = 30;

export type HealthSyncAuditOutcome =
  | "success"
  | "unauthorized"
  | "invalid-content-type"
  | "invalid-json"
  | "normalization-error"
  | "validation-error"
  | "internal-error"
  | "body-read-error";

/**
 * Keeps the exact HTTP request body for successful and rejected sync attempts.
 * Audit storage is deliberately best-effort: a logging outage must not hide a
 * valid health sync or change its HTTP outcome.
 */
export async function recordHealthSyncAudit(input: {
  outcome: HealthSyncAuditOutcome;
  httpStatus: number;
  rawBody: string | null;
  contentType: string | null;
  errorType?: string | null;
  receivedAt?: Date;
}): Promise<void> {
  const receivedAt = input.receivedAt ?? new Date();
  const cutoff = new Date(receivedAt.getTime() - HEALTH_SYNC_AUDIT_RETENTION_DAYS * 86_400_000);
  try {
    await prisma.healthSyncAudit.create({
      data: {
        outcome: input.outcome,
        httpStatus: input.httpStatus,
        rawBody: input.rawBody,
        contentType: input.contentType,
        errorType: input.errorType ?? null,
        receivedAt,
      },
    });
    await prisma.healthSyncAudit.deleteMany({ where: { receivedAt: { lt: cutoff } } });
  } catch (error) {
    logEvent("error", "health_sync_audit_write_failed", {
      outcome: input.outcome,
      httpStatus: input.httpStatus,
      errorType: errorKind(error),
    });
  }
}
