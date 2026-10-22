import { createHash } from "node:crypto";

export const HEALTH_SYNC_AUDIT_RETENTION_DAYS = 30;
export const HEALTH_SYNC_AUDIT_PRUNE_EVIDENCE_PREFIX = "BODYCAST_HEALTH_SYNC_AUDIT_PRUNE_V1 ";
export const HEALTH_SYNC_AUDIT_EMPTY_XOR = "0".repeat(64);

export type HealthSyncAuditRetentionRowV1 = {
  id: number;
  rawRow: string;
  receivedAt: Date | string;
};

export type HealthSyncAuditRetentionBaselineV1 = {
  schemaVersion: 1;
  capturedAt: string;
  rowCount: number;
  maxId: number;
  rowXor: string;
};

export type HealthSyncAuditPruneEvidenceV1 = {
  schemaVersion: 1;
  referenceAt: string;
  cutoffAt: string;
  deletedRowCount: number;
  deletedRowXor: string;
  newestDeletedReceivedAt: string | null;
};

export type HealthSyncAuditRetentionCurrentStateV1 = {
  existingRowCount: number;
  existingRowXor: string;
  newRowCount: number;
};

export type HealthSyncAuditRetentionAccumulatorV1 = {
  rowCount: number;
  maxId: number;
  rowXor: string;
  newestReceivedAt: string | null;
};

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function xorDigest(left: string, right: string): string {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  const result = Buffer.alloc(32);
  for (let index = 0; index < result.length; index += 1) result[index] = leftBytes[index]! ^ rightBytes[index]!;
  return result.toString("hex");
}

export function createHealthSyncAuditRetentionAccumulatorV1(): HealthSyncAuditRetentionAccumulatorV1 {
  return {
    rowCount: 0,
    maxId: 0,
    rowXor: HEALTH_SYNC_AUDIT_EMPTY_XOR,
    newestReceivedAt: null,
  };
}

/** Update the count, ID ceiling, and row digest without retaining raw audit bodies. */
export function addHealthSyncAuditRetentionRowV1(
  accumulator: HealthSyncAuditRetentionAccumulatorV1,
  row: HealthSyncAuditRetentionRowV1,
  requiredReceivedBefore?: Date,
): void {
  if (!Number.isSafeInteger(row.id) || row.id < 1 || typeof row.rawRow !== "string") {
    throw new Error("HealthSyncAudit retention fingerprint received an invalid row.");
  }
  const receivedAt = row.receivedAt instanceof Date ? row.receivedAt : new Date(row.receivedAt);
  if (!Number.isFinite(receivedAt.getTime())) {
    throw new Error("HealthSyncAudit retention fingerprint received a malformed timestamp.");
  }
  if (requiredReceivedBefore
    && (!Number.isFinite(requiredReceivedBefore.getTime()) || receivedAt.getTime() >= requiredReceivedBefore.getTime())) {
    throw new Error("HealthSyncAudit cleanup returned a row outside the 30-day retention cutoff.");
  }
  const nextCount = accumulator.rowCount + 1;
  if (!Number.isSafeInteger(nextCount)) throw new Error("HealthSyncAudit retention row count overflowed.");
  const leaf = createHash("sha256")
    .update(`${row.id}:${Buffer.byteLength(row.rawRow, "utf8")}:${row.rawRow}\n`)
    .digest("hex");
  accumulator.rowCount = nextCount;
  accumulator.maxId = Math.max(accumulator.maxId, row.id);
  accumulator.rowXor = xorDigest(accumulator.rowXor, leaf);
  const receivedAtIso = receivedAt.toISOString();
  if (accumulator.newestReceivedAt === null
    || Date.parse(receivedAtIso) > Date.parse(accumulator.newestReceivedAt)) {
    accumulator.newestReceivedAt = receivedAtIso;
  }
}

function validateAccumulator(accumulator: HealthSyncAuditRetentionAccumulatorV1): void {
  if (!Number.isSafeInteger(accumulator.rowCount) || accumulator.rowCount < 0
    || !Number.isSafeInteger(accumulator.maxId) || accumulator.maxId < 0
    || !validDigest(accumulator.rowXor)
    || (accumulator.rowCount === 0 && (accumulator.maxId !== 0
      || accumulator.rowXor !== HEALTH_SYNC_AUDIT_EMPTY_XOR || accumulator.newestReceivedAt !== null))
    || (accumulator.rowCount > 0 && (accumulator.maxId < accumulator.rowCount
      || !validDate(accumulator.newestReceivedAt)))) {
    throw new Error("HealthSyncAudit retention accumulator is malformed.");
  }
}

export function healthSyncAuditRetentionCurrentStateV1(
  accumulator: HealthSyncAuditRetentionAccumulatorV1,
  newRowCount: number,
): HealthSyncAuditRetentionCurrentStateV1 {
  validateAccumulator(accumulator);
  if (!Number.isSafeInteger(newRowCount) || newRowCount < 0) {
    throw new Error("HealthSyncAudit retention inventory contains an invalid new-row count.");
  }
  return {
    existingRowCount: accumulator.rowCount,
    existingRowXor: accumulator.rowXor,
    newRowCount,
  };
}

export function createHealthSyncAuditRetentionBaselineV1(
  capturedAt: Date | string,
  accumulator: HealthSyncAuditRetentionAccumulatorV1,
): HealthSyncAuditRetentionBaselineV1 {
  const capturedAtIso = capturedAt instanceof Date ? capturedAt.toISOString() : capturedAt;
  if (!validDate(capturedAtIso)) throw new Error("HealthSyncAudit retention baseline timestamp is malformed.");
  validateAccumulator(accumulator);
  return {
    schemaVersion: 1,
    capturedAt: capturedAtIso,
    rowCount: accumulator.rowCount,
    maxId: accumulator.maxId,
    rowXor: accumulator.rowXor,
  };
}

export function createHealthSyncAuditPruneEvidenceV1(
  referenceAt: Date,
  accumulator: HealthSyncAuditRetentionAccumulatorV1,
): HealthSyncAuditPruneEvidenceV1 {
  if (!(referenceAt instanceof Date) || !Number.isFinite(referenceAt.getTime())) {
    throw new Error("HealthSyncAudit prune reference time is malformed.");
  }
  const cutoffAt = new Date(referenceAt.getTime() - HEALTH_SYNC_AUDIT_RETENTION_DAYS * 86_400_000);
  validateAccumulator(accumulator);
  if (accumulator.newestReceivedAt !== null
    && Date.parse(accumulator.newestReceivedAt) >= cutoffAt.getTime()) {
    throw new Error("HealthSyncAudit cleanup returned a row outside the 30-day retention cutoff.");
  }
  return {
    schemaVersion: 1,
    referenceAt: referenceAt.toISOString(),
    cutoffAt: cutoffAt.toISOString(),
    deletedRowCount: accumulator.rowCount,
    deletedRowXor: accumulator.rowXor,
    newestDeletedReceivedAt: accumulator.newestReceivedAt,
  };
}

/** Fail closed unless only rows returned by the app's 30-day DELETE disappeared. */
export function assertHealthSyncAuditRetentionTransitionV1(input: {
  baseline: unknown;
  current: unknown;
  pruneEvents: unknown;
  now?: Date;
}): true {
  const baseline = input.baseline as Partial<HealthSyncAuditRetentionBaselineV1> | null;
  const current = input.current as Partial<HealthSyncAuditRetentionCurrentStateV1> | null;
  const events = input.pruneEvents;
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)
    || !exactKeys(baseline as Record<string, unknown>, ["schemaVersion", "capturedAt", "rowCount", "maxId", "rowXor"])
    || baseline.schemaVersion !== 1 || !validDate(baseline.capturedAt)
    || !Number.isSafeInteger(baseline.rowCount) || baseline.rowCount! < 0
    || !Number.isSafeInteger(baseline.maxId) || baseline.maxId! < 0
    || !validDigest(baseline.rowXor)
    || (baseline.rowCount === 0 && (baseline.maxId !== 0 || baseline.rowXor !== HEALTH_SYNC_AUDIT_EMPTY_XOR))
    || (baseline.rowCount! > 0 && baseline.maxId! < baseline.rowCount!)) {
    throw new Error("HealthSyncAudit retention baseline is malformed.");
  }
  if (!current || typeof current !== "object" || Array.isArray(current)
    || !exactKeys(current as Record<string, unknown>, ["existingRowCount", "existingRowXor", "newRowCount"])
    || !Number.isSafeInteger(current.existingRowCount) || current.existingRowCount! < 0
    || !validDigest(current.existingRowXor)
    || !Number.isSafeInteger(current.newRowCount) || current.newRowCount! < 0) {
    throw new Error("HealthSyncAudit retention post-deploy state is malformed.");
  }
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("Candidate app did not provide its 30-day HealthSyncAudit cleanup evidence.");
  }

  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("HealthSyncAudit retention verification time is malformed.");
  const retentionMs = HEALTH_SYNC_AUDIT_RETENTION_DAYS * 86_400_000;
  let deletedRowCount = 0;
  let deletedRowXor = HEALTH_SYNC_AUDIT_EMPTY_XOR;
  for (const rawEvent of events) {
    const event = rawEvent as Partial<HealthSyncAuditPruneEvidenceV1> | null;
    if (!event || typeof event !== "object" || Array.isArray(event)
      || !exactKeys(event as Record<string, unknown>, ["schemaVersion", "referenceAt", "cutoffAt", "deletedRowCount", "deletedRowXor", "newestDeletedReceivedAt"])
      || event.schemaVersion !== 1 || !validDate(event.referenceAt) || !validDate(event.cutoffAt)
      || !Number.isSafeInteger(event.deletedRowCount) || event.deletedRowCount! < 0
      || !validDigest(event.deletedRowXor)) {
      throw new Error("HealthSyncAudit cleanup event is malformed.");
    }
    const referenceMs = Date.parse(event.referenceAt!);
    const expectedCutoff = new Date(referenceMs - retentionMs).toISOString();
    if (event.cutoffAt !== expectedCutoff || referenceMs < Date.parse(baseline.capturedAt!)
      || referenceMs > now.getTime() + 5 * 60_000) {
      throw new Error("HealthSyncAudit cleanup evidence does not prove the unchanged 30-day cutoff within this release window.");
    }
    if (event.deletedRowCount === 0) {
      if (event.newestDeletedReceivedAt !== null || event.deletedRowXor !== HEALTH_SYNC_AUDIT_EMPTY_XOR) {
        throw new Error("Empty HealthSyncAudit cleanup evidence contains deleted-row data.");
      }
    } else if (!validDate(event.newestDeletedReceivedAt)
      || Date.parse(event.newestDeletedReceivedAt!) >= Date.parse(event.cutoffAt!)) {
      throw new Error("HealthSyncAudit cleanup evidence includes a row that was not older than 30 days at deletion time.");
    }
    deletedRowCount += event.deletedRowCount!;
    if (!Number.isSafeInteger(deletedRowCount)) throw new Error("HealthSyncAudit cleanup evidence count overflowed.");
    deletedRowXor = xorDigest(deletedRowXor, event.deletedRowXor!);
  }

  if (current.newRowCount !== 0) {
    throw new Error("HealthSyncAudit rows were inserted while BodyCast remained in release maintenance.");
  }
  if (deletedRowCount > baseline.rowCount!
    || current.existingRowCount !== baseline.rowCount! - deletedRowCount
    || current.existingRowXor !== xorDigest(baseline.rowXor!, deletedRowXor)) {
    throw new Error("HealthSyncAudit rows changed beyond the candidate's evidenced 30-day retention cleanup.");
  }
  return true;
}
