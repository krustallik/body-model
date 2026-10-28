import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { errorKind, logEvent } from "@/lib/logger";
import {
  addHealthSyncAuditRetentionRowV1,
  createHealthSyncAuditPruneEvidenceV1,
  createHealthSyncAuditRetentionAccumulatorV1,
  HEALTH_SYNC_AUDIT_PRUNE_EVIDENCE_PREFIX,
  HEALTH_SYNC_AUDIT_RETENTION_DAYS,
} from "./health-sync-audit-retention-integrity";

export { HEALTH_SYNC_AUDIT_RETENTION_DAYS } from "./health-sync-audit-retention-integrity";

const HEALTH_SYNC_AUDIT_PRUNE_BATCH_SIZE = 32;

export type HealthSyncAuditOutcome =
  | "success"
  | "unauthorized"
  | "invalid-content-type"
  | "invalid-json"
  | "normalization-error"
  | "validation-error"
  | "payload-too-large"
  | "internal-error"
  | "body-read-error";

/**
 * Keeps the exact HTTP request body for successful and rejected sync attempts.
 * Audit storage is deliberately best-effort: a logging outage must not hide a
 * valid health sync or change its HTTP outcome.
 */
export async function recordHealthSyncAudit(input: {
  profileId?: number | null;
  outcome: HealthSyncAuditOutcome;
  httpStatus: number;
  rawBody: string | null;
  contentType: string | null;
  errorType?: string | null;
  receivedAt?: Date;
}): Promise<void> {
  const receivedAt = input.receivedAt ?? new Date();
  try {
    await prisma.healthSyncAudit.create({
      data: {
        profileId: input.profileId ?? null,
        outcome: input.outcome,
        httpStatus: input.httpStatus,
        rawBody: input.rawBody,
        contentType: input.contentType,
        errorType: input.errorType ?? null,
        receivedAt,
      },
    });
  } catch (error) {
    logEvent("error", "health_sync_audit_write_failed", {
      outcome: input.outcome,
      httpStatus: input.httpStatus,
      errorType: errorKind(error),
    });
  }
}

/** Retention is periodic maintenance; keep its table sweep off the sync response path. */
export async function pruneExpiredHealthSyncAudits(referenceDate = new Date()): Promise<boolean> {
  const cutoff = new Date(referenceDate.getTime() - HEALTH_SYNC_AUDIT_RETENTION_DAYS * 86_400_000);
  try {
    const evidence = await prisma.$transaction(async (tx) => {
      const deletedRows = createHealthSyncAuditRetentionAccumulatorV1();
      while (true) {
        const batch = await tx.$queryRaw<Array<{
          id: number;
          receivedAt: Date;
          rawRow: string;
        }>>`
          WITH expired AS (
            SELECT audit.id
            FROM public."HealthSyncAudit" AS audit
            WHERE audit."receivedAt" < ${cutoff}
            ORDER BY audit.id
            LIMIT ${HEALTH_SYNC_AUDIT_PRUNE_BATCH_SIZE}
            FOR UPDATE
          )
          DELETE FROM public."HealthSyncAudit" AS audit
          USING expired
          WHERE audit.id = expired.id
          RETURNING audit.id, audit."receivedAt" AS "receivedAt", to_jsonb(audit)::text AS "rawRow"
        `;
        if (batch.length > HEALTH_SYNC_AUDIT_PRUNE_BATCH_SIZE) {
          throw new Error("HealthSyncAudit cleanup exceeded its bounded batch size.");
        }
        for (const row of batch) addHealthSyncAuditRetentionRowV1(deletedRows, row, cutoff);
        if (batch.length < HEALTH_SYNC_AUDIT_PRUNE_BATCH_SIZE) break;
      }
      return createHealthSyncAuditPruneEvidenceV1(referenceDate, deletedRows);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 120_000,
    });
    process.stdout.write(`${HEALTH_SYNC_AUDIT_PRUNE_EVIDENCE_PREFIX}${JSON.stringify(evidence)}\n`);
    return true;
  } catch (error) {
    logEvent("error", "health_sync_audit_retention_prune_failed", {
      errorType: errorKind(error),
    });
    return false;
  }
}
