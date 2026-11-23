import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../fixtures/refactor-comparator/invariants-v1.json";

describe("frozen refactor comparator manifest", () => {
  it("pins one exact deterministic clock and random seed", () => {
    expect(manifest.determinism).toEqual({
      clock: "2026-11-23T12:00:00.000Z",
      randomSeed: "bodycast-refactor-comparator-v1",
    });
  });

  it("contains unique suites, paths, tables, and observation IDs", () => {
    const suiteIds = [
      ...manifest.unitSuites.map(({ id }) => id),
      ...manifest.integrationSuites.map(({ id }) => id),
    ];
    expect(new Set(suiteIds).size).toBe(suiteIds.length);

    const unitPaths = manifest.unitSuites.flatMap(({ paths }) => paths);
    expect(new Set(unitPaths).size).toBe(unitPaths.length);
    expect(new Set(manifest.postgres.snapshotTables).size).toBe(manifest.postgres.snapshotTables.length);
    expect(new Set(manifest.observations.map(({ id }) => id)).size).toBe(manifest.observations.length);
  });

  it("points every frozen test and fixture to an existing repository path", () => {
    expect(existsSync(resolve(process.cwd(), manifest.fixtureTree))).toBe(true);
    for (const path of manifest.unitSuites.flatMap(({ paths }) => paths)) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
    }
    for (const observation of manifest.observations) {
      expect(existsSync(resolve(process.cwd(), observation.path)), observation.path).toBe(true);
      expect(manifest.unitSuites.some(({ paths }) => paths.includes(observation.path))).toBe(true);
    }
  });

  it("pins separate exact loopback PostgreSQL endpoints and an immutable image digest", () => {
    expect(manifest.postgres.before.host).toBe("127.0.0.1");
    expect(manifest.postgres.after.host).toBe("127.0.0.1");
    expect(manifest.postgres.before.port).not.toBe(manifest.postgres.after.port);
    expect(manifest.postgres.before.database).not.toBe(manifest.postgres.after.database);
    expect(manifest.postgres.before.role).not.toBe(manifest.postgres.after.role);
    expect(manifest.postgres.before.port).toBe(55436);
    expect(manifest.postgres.after.port).toBe(55437);
    expect(manifest.postgres.image).toMatch(/^docker\.io\/library\/postgres@sha256:[a-f0-9]{64}$/);
    expect(manifest.postgres.legacyMigrationCount).toBe(74);
    expect(manifest.postgres.auth.before).toEqual(manifest.postgres.auth.after);
    expect(manifest.postgres.auth.before).toEqual({
      host: "127.0.0.1",
      port: 55435,
      database: "bodycast_training_postcommit_test",
      role: "bodycast_test_runner",
    });
    expect(manifest.integrationSuites.find(({ id }) => id === "postgres-auth-multiuser")).toMatchObject({
      databaseProfile: "auth",
      authEnvironment: true,
    });
    expect(manifest.integrationSuites.some(({ args }) => args.includes("tests/integration/database-safety.test.ts"))).toBe(false);
  });
});
