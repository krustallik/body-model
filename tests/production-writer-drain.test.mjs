import { describe, expect, it } from "vitest";
import { canonicalSha256 } from "../scripts/production-migration-authorization.mjs";
import {
  PRODUCTION_WRITER_TOPOLOGY_CONTRACT,
  assertFreshWriterDrain,
  evaluateProductionWriterDrain,
  evaluateProductionWriterTopology,
} from "../scripts/production-writer-drain.mjs";

const now = Date.parse("2026-10-07T12:00:00.000Z");

function topology(overrides = {}) {
  return {
    schemaVersion: 1,
    contract: PRODUCTION_WRITER_TOPOLOGY_CONTRACT,
    ready: true,
    blockers: [],
    observedAt: new Date(now).toISOString(),
    app: { name: "bodycast-app-prod", state: "absent", restartPolicy: null },
    database: { name: "bodycast-db-prod", state: "running", health: "healthy", publishedPostgresPort: false, networks: ["bodycast-backend-prod"] },
    backendNetwork: { name: "bodycast-backend-prod", containers: ["bodycast-db-prod"] },
    caddy: { name: "gymbeam-caddy", state: "running", configValidated: true },
    routeFile: { verified: true, maintenanceResponse: true, containsReverseProxy: false, sha256: "a".repeat(64) },
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    writerDrain: {
      schemaVersion: 1,
      observerPid: 123,
      observerApplicationName: "bodycast-production-preflight",
      observedAt: new Date(now).toISOString(),
      identityPolicy: "no-other-client-backends",
      activeClientBackends: [],
      topology: topology(),
      ...overrides,
    },
  };
}

describe("production writer drain and topology gate", () => {
  it("allows only the explicitly identified preflight connection after the old app container is removed", () => {
    const evaluated = evaluateProductionWriterDrain(report());
    expect(evaluated.ready).toBe(true);
    expect(evaluated.activeClientBackendCount).toBe(0);
    expect(evaluated.checks.every((entry) => entry.passed)).toBe(true);
    expect(assertFreshWriterDrain(report(), { now })).toMatchObject({ ready: true, ageMs: 0, topologyAgeMs: 0 });
    expect(evaluateProductionWriterTopology({
      ...topology(),
      app: { name: "bodycast-app-prod", state: "exited", restartPolicy: "no" },
    }).ready).toBe(false);
  });

  it("blocks an active old writer and unknown or proxied client identity", () => {
    const activeWriter = report({ activeClientBackends: [
      { present: true, pid: 700, applicationName: "PII_CANARY_USER_APP", clientAddress: "PII_CANARY_ADDRESS", backendType: "client backend", state: "active" },
    ] });
    expect(evaluateProductionWriterDrain(activeWriter).blockers.join(" ")).toContain("found 1 other client backend(s)");
    const activeEvaluation = evaluateProductionWriterDrain(activeWriter);
    expect(activeEvaluation.checks.find((entry) => entry.id === "zero-other-client-backends").passed).toBe(false);
    expect(JSON.stringify(activeEvaluation)).not.toContain("PII_CANARY_USER_APP");
    expect(JSON.stringify(activeEvaluation)).not.toContain("PII_CANARY_ADDRESS");

    const unknownClient = report({ activeClientBackends: [
      { present: true, pid: 701, applicationName: null, clientAddress: null, backendType: "client backend", state: "idle" },
    ] });
    expect(evaluateProductionWriterDrain(unknownClient).ready).toBe(false);
    const unknownEvaluation = evaluateProductionWriterDrain(unknownClient);
    expect(unknownEvaluation.ready).toBe(false);
    expect(JSON.stringify(unknownEvaluation)).not.toContain("unknown application");
    expect(JSON.stringify(unknownEvaluation)).not.toContain("<local-or-proxied identity>");
  });

  it("fails closed when Docker publication or network membership makes client identity ambiguous", () => {
    const published = evaluateProductionWriterTopology({
      observedAt: new Date(now).toISOString(),
      app: { name: "bodycast-app-prod", state: "absent", restartPolicy: null },
      database: { name: "bodycast-db-prod", state: "running", health: "healthy", publishedPostgresPort: true, networks: ["bodycast-backend-prod"] },
      backendNetwork: { name: "bodycast-backend-prod", containers: ["bodycast-db-prod"] },
      caddy: { name: "gymbeam-caddy", state: "running", configValidated: true },
      routeFile: { verified: true, maintenanceResponse: true, containsReverseProxy: false, sha256: "a".repeat(64) },
    });
    expect(published.ready).toBe(false);
    expect(published.blockers.join(" ")).toContain("published outside the internal Docker network");

    const unknownNetworkClient = evaluateProductionWriterTopology({
      observedAt: new Date(now).toISOString(),
      app: { name: "bodycast-app-prod", state: "absent", restartPolicy: null },
      database: { name: "bodycast-db-prod", state: "running", health: "healthy", publishedPostgresPort: false, networks: ["bodycast-backend-prod"] },
      backendNetwork: { name: "bodycast-backend-prod", containers: ["bodycast-db-prod", "unknown-proxy"] },
      caddy: { name: "gymbeam-caddy", state: "running", configValidated: true },
      routeFile: { verified: true, maintenanceResponse: true, containsReverseProxy: false, sha256: "a".repeat(64) },
    });
    expect(unknownNetworkClient.ready).toBe(false);
    expect(unknownNetworkClient.blockers.join(" ")).toContain("unknown or unapproved client container");
  });

  it("rejects a writer that reconnects between signed preflight and final guard", () => {
    const signedPreflight = report();
    const finalGuard = report({
      observedAt: new Date(now + 1_000).toISOString(),
      activeClientBackends: [{ present: true, pid: 702, applicationName: "PII_CANARY_RECONNECTED", clientAddress: null, backendType: "client backend" }],
      topology: topology({ observedAt: new Date(now + 1_000).toISOString() }),
    });
    expect(evaluateProductionWriterDrain(signedPreflight).ready).toBe(true);
    expect(canonicalSha256(signedPreflight.writerDrain)).not.toBe(canonicalSha256(finalGuard.writerDrain));
    expect(evaluateProductionWriterDrain(finalGuard).ready).toBe(false);
    expect(() => assertFreshWriterDrain(finalGuard, { now: now + 1_000 })).toThrow('"id":"zero-other-client-backends","passed":false');
    expect(() => assertFreshWriterDrain(finalGuard, { now: now + 1_000 })).toThrow(/checks=/);
    try {
      assertFreshWriterDrain(finalGuard, { now: now + 1_000 });
    } catch (error) {
      expect(error.message).not.toContain("PII_CANARY_RECONNECTED");
      expect(error.message).not.toContain("applicationName");
      expect(error.message).not.toContain("clientAddress");
    }
  });

  it("rejects stale, future, and unapproved observer evidence", () => {
    expect(() => assertFreshWriterDrain(report({ observedAt: new Date(now - 31_000).toISOString() }), { now })).toThrow("stale or from the future");
    expect(() => assertFreshWriterDrain(report({ observedAt: new Date(now + 61_000).toISOString() }), { now })).toThrow("stale or from the future");
    expect(evaluateProductionWriterDrain(report({ observerApplicationName: "psql" })).ready).toBe(false);
  });
});
