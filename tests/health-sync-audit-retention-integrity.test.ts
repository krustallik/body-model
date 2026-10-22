import { describe, expect, it } from "vitest";
import {
  addHealthSyncAuditRetentionRowV1,
  assertHealthSyncAuditRetentionTransitionV1,
  createHealthSyncAuditPruneEvidenceV1,
  createHealthSyncAuditRetentionAccumulatorV1,
  createHealthSyncAuditRetentionBaselineV1,
  type HealthSyncAuditRetentionRowV1,
} from "@/modules/health/health-sync-audit-retention-integrity";

const capturedAt = new Date("2026-10-22T20:00:00.000Z");
const cleanupAt = new Date("2026-10-22T20:00:02.000Z");
const now = new Date("2026-10-22T20:01:00.000Z");

function auditRow(id: number, receivedAt: string, rawBody: string): HealthSyncAuditRetentionRowV1 {
  return {
    id,
    receivedAt: new Date(receivedAt),
    rawRow: JSON.stringify({ id, receivedAt, outcome: "success", httpStatus: 200, rawBody,
      contentType: "application/json", errorType: null }),
  };
}

function accumulate(rows: readonly HealthSyncAuditRetentionRowV1[], cutoff?: Date) {
  const accumulator = createHealthSyncAuditRetentionAccumulatorV1();
  for (const row of rows) addHealthSyncAuditRetentionRowV1(accumulator, row, cutoff);
  return accumulator;
}

function baseline(rows: readonly HealthSyncAuditRetentionRowV1[]) {
  return createHealthSyncAuditRetentionBaselineV1(capturedAt, accumulate(rows));
}

function prune(rows: readonly HealthSyncAuditRetentionRowV1[]) {
  return createHealthSyncAuditPruneEvidenceV1(
    cleanupAt,
    accumulate(rows, new Date(cleanupAt.getTime() - 30 * 86_400_000)),
  );
}

function rowsXor(rows: readonly HealthSyncAuditRetentionRowV1[]) {
  return accumulate(rows).rowXor;
}

function cleanEvent() {
  return prune([]);
}

describe("HealthSyncAudit retention-aware release integrity", () => {
  it("accepts only the exact 30-day cleanup, including a row that crosses the cutoff during deployment", () => {
    const expired = auditRow(1, "2026-09-01T00:00:00.000Z", "old");
    const crossing = auditRow(2, "2026-09-22T20:00:01.000Z", "crosses-at-startup");
    const retained = auditRow(3, "2026-10-21T20:00:00.000Z", "young");
    const baselineEvidence = baseline([expired, crossing, retained]);
    const pruneEvent = prune([expired, crossing]);

    expect((crossing.receivedAt as Date).getTime() > cleanupAt.getTime() - 30 * 86_400_000).toBe(false);
    expect(assertHealthSyncAuditRetentionTransitionV1({
      baseline: baselineEvidence,
      current: { existingRowCount: 1, existingRowXor: rowsXor([retained]), newRowCount: 0 },
      pruneEvents: [pruneEvent],
      now,
    })).toBe(true);
  });

  it("accepts an empty cleanup receipt without blocking a release that has no expired rows", () => {
    const retained = auditRow(9, "2026-10-21T20:00:00.000Z", "recent");
    const baselineEvidence = baseline([retained]);
    expect(assertHealthSyncAuditRetentionTransitionV1({
      baseline: baselineEvidence,
      current: { existingRowCount: 1, existingRowXor: rowsXor([retained]), newRowCount: 0 },
      pruneEvents: [cleanEvent()],
      now,
    })).toBe(true);
  });

  it("blocks a missing cleanup receipt or any unrelated deletion", () => {
    const expired = auditRow(1, "2026-09-01T00:00:00.000Z", "old");
    const baselineEvidence = baseline([expired]);
    const current = { existingRowCount: 0, existingRowXor: "0".repeat(64), newRowCount: 0 };
    expect(() => assertHealthSyncAuditRetentionTransitionV1({ baseline: baselineEvidence, current, pruneEvents: [], now }))
      .toThrow("did not provide its 30-day HealthSyncAudit cleanup evidence");
    expect(() => assertHealthSyncAuditRetentionTransitionV1({ baseline: baselineEvidence, current, pruneEvents: [cleanEvent()], now }))
      .toThrow("changed beyond the candidate's evidenced 30-day retention cleanup");
  });

  it("blocks deletion of an audit row that had not reached the 30-day cutoff", () => {
    const retained = auditRow(1, "2026-10-01T00:00:00.000Z", "must-remain");
    const baselineEvidence = baseline([retained]);
    const forgedEvent = {
      ...cleanEvent(), deletedRowCount: 1, deletedRowXor: rowsXor([retained]),
      newestDeletedReceivedAt: retained.receivedAt instanceof Date ? retained.receivedAt.toISOString() : retained.receivedAt,
    };
    expect(() => assertHealthSyncAuditRetentionTransitionV1({
      baseline: baselineEvidence,
      current: { existingRowCount: 0, existingRowXor: "0".repeat(64), newRowCount: 0 },
      pruneEvents: [forgedEvent],
      now,
    })).toThrow("not older than 30 days at deletion time");
  });

  it("blocks edits to rawBody or timestamps on retained rows and blocks rows inserted during maintenance", () => {
    const original = auditRow(1, "2026-10-21T20:00:00.000Z", "original-body");
    const baselineEvidence = baseline([original]);
    const edited = auditRow(1, "2026-10-21T20:00:01.000Z", "edited-body");
    expect(() => assertHealthSyncAuditRetentionTransitionV1({
      baseline: baselineEvidence,
      current: { existingRowCount: 1, existingRowXor: rowsXor([edited]), newRowCount: 0 },
      pruneEvents: [cleanEvent()],
      now,
    })).toThrow("changed beyond the candidate's evidenced 30-day retention cleanup");

    expect(() => assertHealthSyncAuditRetentionTransitionV1({
      baseline: baseline([]),
      current: { existingRowCount: 0, existingRowXor: "0".repeat(64), newRowCount: 1 },
      pruneEvents: [cleanEvent()],
      now,
    })).toThrow("inserted while BodyCast remained in release maintenance");
  });

  it("rejects altered retention periods and malformed event windows", () => {
    const baselineEvidence = baseline([]);
    const event = cleanEvent();
    expect(() => assertHealthSyncAuditRetentionTransitionV1({
      baseline: baselineEvidence,
      current: { existingRowCount: 0, existingRowXor: "0".repeat(64), newRowCount: 0 },
      pruneEvents: [{ ...event, cutoffAt: "2026-09-23T20:00:02.000Z" }],
      now,
    })).toThrow("unchanged 30-day cutoff");
  });

  it("aggregates bounded delete batches independent of RETURNING row order", () => {
    const deleted = [
      auditRow(9, "2026-09-01T00:00:00.000Z", "higher-id"),
      auditRow(2, "2026-09-02T00:00:00.000Z", "lower-id"),
    ];
    const aggregate = accumulate(deleted, new Date(cleanupAt.getTime() - 30 * 86_400_000));
    expect(aggregate.rowCount).toBe(2);
    expect(aggregate.maxId).toBe(9);
    expect(prune([deleted[1]!, deleted[0]!]).deletedRowXor).toBe(aggregate.rowXor);
  });
});
