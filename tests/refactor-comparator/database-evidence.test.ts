import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import manifest from "../fixtures/refactor-comparator/invariants-v1.json";
import type { ComparatorClockFieldPolicy } from "../../scripts/refactor/comparator-core.mjs";
import {
  compareDatabaseClockOperationWindows,
  diffJson,
  projectPersistedStateForComparison,
  validateDatabaseClockColumnMetadata,
} from "../../scripts/refactor/comparator-core.mjs";
import { waitForLoopbackPort, waitForPostgresConnection } from "../../scripts/refactor/database-evidence.mjs";

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("comparator PostgreSQL TCP readiness", () => {
  it("waits for a published exact loopback endpoint", async () => {
    const server = net.createServer();
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test TCP server did not bind an IP endpoint.");

    await expect(waitForLoopbackPort("127.0.0.1", address.port, { timeoutMs: 1_000 })).resolves.toBeUndefined();
  });

  it("times out rather than accepting a loopback endpoint that never opens", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test TCP server did not bind an IP endpoint.");
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });

    await expect(waitForLoopbackPort("127.0.0.1", address.port, { timeoutMs: 20 }))
      .rejects.toThrow(/did not become reachable/);
  });

  it("rejects non-loopback targets and unbounded timeout values", async () => {
    await expect(waitForLoopbackPort("localhost", 5432)).rejects.toThrow(/exact loopback endpoint/);
    await expect(waitForLoopbackPort("127.0.0.1", 5432, { timeoutMs: 90_001 })).rejects.toThrow(/bounded timeout/);
  });

  it("retries only transient host PostgreSQL readiness and fails closed on identity errors", async () => {
    let attempts = 0;
    const attested = await waitForPostgresConnection(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("Can't reach database server at `127.0.0.1:55436`");
      return "attested";
    }, { host: "127.0.0.1", port: 55_436, timeoutMs: 1_000, retryDelayMs: 1 });
    expect(attested).toBe("attested");
    expect(attempts).toBe(3);

    attempts = 0;
    const startingUp = await waitForPostgresConnection(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("Prisma query failed: FATAL: the database system is starting up");
      return "ready";
    }, { host: "127.0.0.1", port: 55_436, timeoutMs: 1_000, retryDelayMs: 1 });
    expect(startingUp).toBe("ready");
    expect(attempts).toBe(3);

    attempts = 0;
    await expect(waitForPostgresConnection(async () => {
      attempts += 1;
      throw new Error("Comparator PostgreSQL identity attestation failed");
    }, { host: "127.0.0.1", port: 55_436, timeoutMs: 1_000, retryDelayMs: 1 }))
      .rejects.toThrow(/identity attestation failed/);
    expect(attempts).toBe(1);
  });

  it("times out rather than accepting a PostgreSQL endpoint that never becomes query-ready", async () => {
    await expect(waitForPostgresConnection(async () => {
      throw new Error("Can't reach database server at `127.0.0.1:55436`");
    }, { host: "127.0.0.1", port: 55_436, timeoutMs: 10, retryDelayMs: 2 }))
      .rejects.toThrow(/did not become ready.*within 10ms/);
  });
});

interface PersistedStateOptions {
  lifecycleUpdatedAt?: string;
  profileUpdatedAt?: string;
  authWindowStart?: number;
  authHitCount?: number;
  invalidationGeneration?: number;
  leaseUntil?: string | null;
}

interface ComparablePersistedState {
  tables: Record<string, { rows: string[] }>;
}

function persistedState({
  lifecycleUpdatedAt = "2026-11-23T12:00:00.100+00:00",
  profileUpdatedAt = "2026-11-23T12:00:00.100",
  authWindowStart = 1_795_449_141,
  authHitCount = 2,
  invalidationGeneration = 4,
  leaseUntil = null,
}: PersistedStateOptions = {}) {
  return {
    tables: {
      PhysiologyV7DailyResult: {
        primaryKey: ["id"],
        count: 1,
        rows: [JSON.stringify({
          id: 4,
          profileId: 1,
          date: "2026-11-22",
          computedAt: "2026-11-23T12:00:00.000+00:00",
          createdAt: "2026-11-23T12:00:00.000+00:00",
          updatedAt: "2026-11-23T12:00:00.100+00:00",
        })],
      },
      PhysiologyV7Lifecycle: {
        primaryKey: ["profileId"],
        count: 1,
        rows: [JSON.stringify({
          profileId: 1,
          createdAt: "2026-11-23T12:00:00.000+00:00",
          updatedAt: lifecycleUpdatedAt,
          invalidationGeneration,
        })],
      },
      PhysiologyV7ShadowDiagnostic: {
        primaryKey: ["id"],
        count: 1,
        rows: [JSON.stringify({
          id: 5,
          profileId: 1,
          date: "2026-11-22",
          createdAt: "2026-11-23T12:00:00.000+00:00",
          updatedAt: "2026-11-23T12:00:00.100+00:00",
        })],
      },
      UnifiedPublicationBlock: {
        primaryKey: ["profileId", "source", "sourceKey"],
        count: 1,
        rows: [JSON.stringify({
          profileId: 1,
          source: "training",
          sourceKey: "session-1",
          ownerLeaseUntil: leaseUntil,
          createdAt: "2026-11-23T12:00:00.000+00:00",
          updatedAt: "2026-11-23T12:00:00.100+00:00",
          revision: 3,
        })],
      },
      Profile: {
        primaryKey: ["id"],
        count: 1,
        rows: [JSON.stringify({
          id: 1,
          createdAt: "2026-01-01T00:00:00.000",
          updatedAt: profileUpdatedAt,
          locale: "uk",
        })],
      },
      AuthRateLimitBucket: {
        primaryKey: ["bucketKey"],
        count: 1,
        rows: [JSON.stringify({ bucketKey: "bucket-a", hitCount: authHitCount, windowStart: authWindowStart })],
      },
    },
    sequences: [{ schema: "public", name: "Profile_id_seq", lastValue: "1", isCalled: true }],
    migrationLedger: [{ name: "init", checksum: "abc", startedAt: "2026-11-23T12:00:00.000Z" }],
    clockColumnMetadata: [
      { table: "PhysiologyV7DailyResult", field: "createdAt", dataType: "timestamp with time zone", datetimePrecision: 3, nullable: false },
      { table: "PhysiologyV7DailyResult", field: "updatedAt", dataType: "timestamp with time zone", datetimePrecision: 3, nullable: false },
      { table: "PhysiologyV7Lifecycle", field: "createdAt", dataType: "timestamp with time zone", datetimePrecision: 3, nullable: false },
      { table: "PhysiologyV7Lifecycle", field: "updatedAt", dataType: "timestamp with time zone", datetimePrecision: 3, nullable: false },
      { table: "PhysiologyV7ShadowDiagnostic", field: "createdAt", dataType: "timestamp with time zone", datetimePrecision: 3, nullable: false },
      { table: "PhysiologyV7ShadowDiagnostic", field: "updatedAt", dataType: "timestamp with time zone", datetimePrecision: 3, nullable: false },
      { table: "Profile", field: "updatedAt", dataType: "timestamp without time zone", datetimePrecision: 3, nullable: false },
      { table: "UnifiedPublicationBlock", field: "createdAt", dataType: "timestamp with time zone", datetimePrecision: 3, nullable: false },
      { table: "UnifiedPublicationBlock", field: "updatedAt", dataType: "timestamp with time zone", datetimePrecision: 3, nullable: false },
    ],
  };
}

describe("comparator persisted state clock projection", () => {
  const policy = manifest.postgres.databaseClockFields as unknown as ComparatorClockFieldPolicy;

  it("compares stable persisted semantics while retaining exact clock values as evidence", () => {
    const before = persistedState();
    const after = persistedState({
      lifecycleUpdatedAt: "2026-11-23T12:00:06.671+00:00",
      profileUpdatedAt: "2026-11-23T12:00:07.000",
    });
    const beforeProjection = projectPersistedStateForComparison(before, policy);
    const afterProjection = projectPersistedStateForComparison(after, policy);
    const beforeComparable = beforeProjection.comparable as ComparablePersistedState;
    const afterComparable = afterProjection.comparable as ComparablePersistedState;

    expect(diffJson(beforeComparable, afterComparable)).toEqual([]);
    expect(beforeProjection.clockEvidence[0].fields.updatedAt).toBe("2026-11-23T12:00:00.100+00:00");
    expect(afterProjection.clockEvidence[0].fields.updatedAt).toBe("2026-11-23T12:00:06.671+00:00");
    expect(JSON.parse(before.tables.PhysiologyV7Lifecycle.rows[0])).toHaveProperty("updatedAt", "2026-11-23T12:00:00.100+00:00");
    expect(JSON.parse(beforeComparable.tables.AuthRateLimitBucket.rows[0]).windowStart).toBe(1_795_449_141);
    expect(JSON.parse(afterComparable.tables.AuthRateLimitBucket.rows[0]).windowStart).toBe(1_795_449_141);
  });

  it("fails closed on any changed Auth rate-limit window timestamp", () => {
    const before = projectPersistedStateForComparison(persistedState(), policy).comparable;
    const changedWindowStart = projectPersistedStateForComparison(
      persistedState({ authWindowStart: 1_795_449_142 }),
      policy,
    ).comparable;
    expect(diffJson(before, changedWindowStart)).toContainEqual(expect.objectContaining({
      path: expect.stringContaining("AuthRateLimitBucket"),
    }));
  });

  it("still fails on stable lifecycle fields, sequence state, lease semantics, or migration evidence", () => {
    const before = projectPersistedStateForComparison(persistedState(), policy).comparable;
    const changedLifecycle = projectPersistedStateForComparison(persistedState({ invalidationGeneration: 5 }), policy).comparable;
    const changedLease = projectPersistedStateForComparison(persistedState({ leaseUntil: "2026-11-23T12:01:00.000+00:00" }), policy).comparable;
    const changedAuthCounter = projectPersistedStateForComparison(persistedState({ authHitCount: 3 }), policy).comparable;
    const changedSequence = projectPersistedStateForComparison(persistedState(), policy).comparable;
    const changedMigration = projectPersistedStateForComparison(persistedState(), policy).comparable;
    (changedSequence as { sequences: Array<{ lastValue: string }> }).sequences[0].lastValue = "2";
    (changedMigration as { migrationLedger: Array<{ checksum: string }> }).migrationLedger[0].checksum = "different";

    expect(diffJson(before, changedLifecycle)).not.toEqual([]);
    expect(diffJson(before, changedLease)).not.toEqual([]);
    expect(diffJson(before, changedAuthCounter)).not.toEqual([]);
    expect(diffJson(before, changedSequence)).not.toEqual([]);
    expect(diffJson(before, changedMigration)).not.toEqual([]);
  });

  it("fails closed on missing, malformed, or inverted clock fields", () => {
    const missingField = persistedState();
    missingField.tables.PhysiologyV7Lifecycle.rows[0] = JSON.stringify({ profileId: 1, updatedAt: "2026-11-23T12:00:00.100+00:00" });
    expect(() => projectPersistedStateForComparison(missingField, policy)).toThrow(/reviewed UTC timestamp/);

    const malformed = persistedState();
    malformed.tables.PhysiologyV7Lifecycle.rows[0] = JSON.stringify({ profileId: 1, createdAt: "yesterday", updatedAt: "2026-11-23T12:00:00.100+00:00" });
    expect(() => projectPersistedStateForComparison(malformed, policy)).toThrow(/reviewed UTC timestamp/);

    const inverted = persistedState({ lifecycleUpdatedAt: "2026-11-22T12:00:00.000+00:00" });
    expect(() => projectPersistedStateForComparison(inverted, policy)).toThrow(/createdAt must not be after updatedAt/);

    const invalidLocalTimestamp = persistedState({ profileUpdatedAt: "2026-11-23T12:00:00.100Z" });
    expect(() => projectPersistedStateForComparison(invalidLocalTimestamp, policy)).toThrow(/reviewed UTC timestamp/);

    const subMillisecond = persistedState();
    subMillisecond.tables.PhysiologyV7Lifecycle.rows[0] = JSON.stringify({
      profileId: 1,
      createdAt: "2026-11-23T12:00:00.0001+00:00",
      updatedAt: "2026-11-23T12:00:00.100+00:00",
    });
    expect(() => projectPersistedStateForComparison(subMillisecond, policy)).toThrow(/reviewed UTC timestamp/);

    const nonUtcOffset = persistedState();
    nonUtcOffset.tables.PhysiologyV7Lifecycle.rows[0] = JSON.stringify({
      profileId: 1,
      createdAt: "2026-11-23T13:00:00.000+01:00",
      updatedAt: "2026-11-23T13:00:00.100+01:00",
    });
    expect(() => projectPersistedStateForComparison(nonUtcOffset, policy)).toThrow(/reviewed UTC timestamp/);
  });

  it("requires exact PostgreSQL clock column types, precision, and nullability", () => {
    const metadata = persistedState().clockColumnMetadata;
    expect(validateDatabaseClockColumnMetadata(
      metadata.map((column) => ({ ...column, nullable: "NO" })),
      policy,
    )).toEqual(metadata);
    expect(() => validateDatabaseClockColumnMetadata(
      metadata.map((column) => ({ ...column, nullable: column.table === "Profile" ? "UNKNOWN" : "NO" })),
      policy,
    )).toThrow(/exact YES\/NO/);

    const wrongPrecision = persistedState();
    wrongPrecision.clockColumnMetadata[0].datetimePrecision = 6;
    expect(() => projectPersistedStateForComparison(wrongPrecision, policy))
      .toThrow(/type, precision, or nullability/);

    const wrongType = persistedState();
    wrongType.clockColumnMetadata[0].dataType = "timestamp without time zone";
    expect(() => projectPersistedStateForComparison(wrongType, policy))
      .toThrow(/type, precision, or nullability/);

    const nullableColumn = persistedState();
    nullableColumn.clockColumnMetadata[0].nullable = true;
    expect(() => projectPersistedStateForComparison(nullableColumn, policy))
      .toThrow(/type, precision, or nullability/);

    const missingColumn = persistedState();
    missingColumn.clockColumnMetadata.pop();
    expect(() => projectPersistedStateForComparison(missingColumn, policy))
      .toThrow(/type, precision, or nullability/);
  });
});

describe("comparator database clock operation windows", () => {
  const policy: ComparatorClockFieldPolicy = {
    ClockRow: { createdAt: "zoned-timestamp", updatedAt: "zoned-timestamp" },
  };
  const initialEvidence = [{
    table: "ClockRow",
    primaryKey: { id: 1 },
    fields: { createdAt: "2026-11-23T11:00:00.000+00:00", updatedAt: "2026-11-23T11:00:00.000+00:00" },
  }];

  it("accepts equal clock transitions across different run times and retains signed anchor offsets", () => {
    const result = compareDatabaseClockOperationWindows({
      before: {
        initialEvidence,
        finalEvidence: [{
          table: "ClockRow",
          primaryKey: { id: 1 },
          fields: { createdAt: "2026-11-23T11:00:00.000+00:00", updatedAt: "2026-11-23T12:00:01.250+00:00" },
        }],
        startAnchor: "2026-11-23T12:00:00.000000Z",
        endAnchor: "2026-11-23T12:00:03.000000Z",
      },
      after: {
        initialEvidence,
        finalEvidence: [{
          table: "ClockRow",
          primaryKey: { id: 1 },
          fields: { createdAt: "2026-11-23T11:00:00.000+00:00", updatedAt: "2026-11-23T13:00:01.250+00:00" },
        }],
        startAnchor: "2026-11-23T13:00:00.000000Z",
        endAnchor: "2026-11-23T13:00:03.000000Z",
      },
      databaseClockFields: policy,
    });

    expect(result.equal).toBe(true);
    expect(result.evidence.before.events[0]).toMatchObject({
      rawValue: "2026-11-23T12:00:01.250+00:00",
      offsetFromStartMicroseconds: "1250000",
      offsetFromEndMicroseconds: "-1750000",
      orderGroup: 0,
    });
    expect(result.evidence.after.events[0]).toMatchObject({
      rawValue: "2026-11-23T13:00:01.250+00:00",
      offsetFromStartMicroseconds: "1250000",
      offsetFromEndMicroseconds: "-1750000",
      orderGroup: 0,
    });
  });

  it("fails closed on missing, malformed, or inverted anchors and out-of-window writes", () => {
    const side = {
      initialEvidence,
      finalEvidence: [{
        table: "ClockRow",
        primaryKey: { id: 1 },
        fields: { createdAt: "2026-11-23T11:00:00.000+00:00", updatedAt: "2026-11-23T12:00:01.000+00:00" },
      }],
      startAnchor: "2026-11-23T12:00:00.000000Z",
      endAnchor: "2026-11-23T12:00:02.000000Z",
    };
    const compare = (before: typeof side, after: typeof side) => compareDatabaseClockOperationWindows({
      before,
      after,
      databaseClockFields: policy,
    });

    expect(() => compare({ ...side, startAnchor: "" }, side)).toThrow(/reviewed UTC timestamp/);
    expect(() => compare({ ...side, startAnchor: "2026-11-23T12:00:00.000Z" }, side)).toThrow(/reviewed UTC timestamp/);
    expect(() => compare({ ...side, startAnchor: "2026-11-23T12:00:03.000000Z" }, side)).toThrow(/window is inverted/);

    const outsideWindow = {
      ...side,
      finalEvidence: [{
        table: "ClockRow",
        primaryKey: { id: 1 },
        fields: { createdAt: "2026-11-23T11:00:00.000+00:00", updatedAt: "2026-11-23T12:00:03.000+00:00" },
      }],
    };
    expect(() => compare(outsideWindow, side)).toThrow(/outside its recorded operation window/);
  });

  it("detects changed clock transitions, cross-row order changes, and altered ties", () => {
    const twoRows = [1, 2].map((id) => ({
      table: "ClockRow",
      primaryKey: { id },
      fields: { createdAt: "2026-11-23T11:00:00.000+00:00", updatedAt: "2026-11-23T11:00:00.000+00:00" },
    }));
    const finalRows = (first: string, second: string) => [first, second].map((updatedAt, index) => ({
      table: "ClockRow",
      primaryKey: { id: index + 1 },
      fields: { createdAt: "2026-11-23T11:00:00.000+00:00", updatedAt },
    }));
    const run = (initial: typeof twoRows, final: ReturnType<typeof finalRows>, startHour: string) => ({
      initialEvidence: initial,
      finalEvidence: final,
      startAnchor: `2026-11-23T${startHour}:00:00.000000Z`,
      endAnchor: `2026-11-23T${startHour}:01:00.000000Z`,
    });
    const before = run(twoRows, finalRows("2026-11-23T12:00:00.200+00:00", "2026-11-23T12:00:00.400+00:00"), "12");
    const reverseOrder = run(twoRows, finalRows("2026-11-23T13:00:00.400+00:00", "2026-11-23T13:00:00.200+00:00"), "13");
    const orderDiff = compareDatabaseClockOperationWindows({ before, after: reverseOrder, databaseClockFields: policy });
    expect(orderDiff.equal).toBe(false);
    expect(orderDiff.eventOrderingDifferences.length).toBeGreaterThan(0);

    const tied = run(twoRows, finalRows("2026-11-23T12:00:00.200+00:00", "2026-11-23T12:00:00.200+00:00"), "12");
    const untied = run(twoRows, finalRows("2026-11-23T13:00:00.200+00:00", "2026-11-23T13:00:00.400+00:00"), "13");
    const tieDiff = compareDatabaseClockOperationWindows({ before: tied, after: untied, databaseClockFields: policy });
    expect(tieDiff.equal).toBe(false);
    expect(tieDiff.eventOrderingDifferences.length).toBeGreaterThan(0);

    const unchanged = run(twoRows, twoRows, "13");
    const transitionDiff = compareDatabaseClockOperationWindows({ before, after: unchanged, databaseClockFields: policy });
    expect(transitionDiff.equal).toBe(false);
    expect(transitionDiff.transitionDifferences.length).toBeGreaterThan(0);
  });
});
