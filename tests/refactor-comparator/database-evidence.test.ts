import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import manifest from "../fixtures/refactor-comparator/invariants-v1.json";
import type { ComparatorClockFieldPolicy } from "../../scripts/refactor/comparator-core.mjs";
import { diffJson, projectPersistedStateForComparison } from "../../scripts/refactor/comparator-core.mjs";
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
    expect(() => projectPersistedStateForComparison(missingField, policy)).toThrow(/createdAt must be a valid zoned timestamp/);

    const malformed = persistedState();
    malformed.tables.PhysiologyV7Lifecycle.rows[0] = JSON.stringify({ profileId: 1, createdAt: "yesterday", updatedAt: "2026-11-23T12:00:00.100+00:00" });
    expect(() => projectPersistedStateForComparison(malformed, policy)).toThrow(/valid zoned timestamp/);

    const inverted = persistedState({ lifecycleUpdatedAt: "2026-11-22T12:00:00.000+00:00" });
    expect(() => projectPersistedStateForComparison(inverted, policy)).toThrow(/createdAt must not be after updatedAt/);

    const invalidLocalTimestamp = persistedState({ profileUpdatedAt: "2026-11-23T12:00:00.100Z" });
    expect(() => projectPersistedStateForComparison(invalidLocalTimestamp, policy)).toThrow(/valid local timestamp/);
  });
});
