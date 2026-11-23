import { describe, expect, it } from "vitest";
import manifest from "../fixtures/refactor-comparator/invariants-v1.json";
import {
  aggregateSuiteCases,
  canonicalizeJson,
  deriveDatabaseClockTransitions,
  diffJson,
  parseComparatorArgs,
  sha256,
  sortObservationsByCaseId,
  stableJson,
  validateComparatorDatabaseUrl,
  validateManifest,
  validateResolvedPostgresImage,
  validateRelativePath,
} from "../../scripts/refactor/comparator-core.mjs";

const beforeTarget = {
  host: "127.0.0.1",
  port: 55436,
  database: "bodycast_refactor_before_test",
  role: "bodycast_refactor_before_test_runner",
};
const afterTarget = {
  host: "127.0.0.1",
  port: 55437,
  database: "bodycast_refactor_after_test",
  role: "bodycast_refactor_after_test_runner",
};

describe("refactor comparator core", () => {
  it("requires exact full source SHAs and all explicit arguments", () => {
    expect(parseComparatorArgs([
      "--base-sha", "A".repeat(40),
      "--candidate-sha", "b".repeat(40),
      "--manifest", "tests/fixtures/refactor-comparator/invariants-v1.json",
      "--evidence-dir", "C:/evidence/stage-1a",
    ])).toEqual({
      baseSha: "a".repeat(40),
      candidateSha: "b".repeat(40),
      manifest: "tests/fixtures/refactor-comparator/invariants-v1.json",
      evidenceDir: "C:/evidence/stage-1a",
    });
    expect(() => parseComparatorArgs([
      "--base-sha", "1234",
      "--candidate-sha", "b".repeat(40),
      "--manifest", "tests/fixtures/refactor-comparator/invariants-v1.json",
      "--evidence-dir", "C:/evidence/stage-1a",
    ])).toThrow(/full 40-character/);
    expect(() => parseComparatorArgs(["--base-sha", "a".repeat(40), "--base-sha", "b".repeat(40)] )).toThrow(/Duplicate/);
    expect(() => parseComparatorArgs(["--unknown", "value"])).toThrow(/Unknown/);
    expect(() => parseComparatorArgs([])).toThrow(/Required/);
  });

  it("accepts only repository-relative POSIX paths", () => {
    expect(validateRelativePath("tests/example.test.ts", "path")).toBe("tests/example.test.ts");
    for (const path of ["", "/etc/passwd", "C:/secret/file", "tests/../secret", "tests//file", "tests\\file"]) {
      expect(() => validateRelativePath(path, "path")).toThrow();
    }
  });

  it("validates the frozen manifest and rejects changed database identities, tables, and suite paths", () => {
    expect(validateManifest(manifest)).toBe(manifest);

    const wrongImage = structuredClone(manifest);
    wrongImage.postgres.image = "postgres:latest";
    expect(() => validateManifest(wrongImage)).toThrow(/image digest/);

    const invalidClock = structuredClone(manifest);
    invalidClock.determinism.clock = "2026-11-23T12:00:00Z";
    expect(() => validateManifest(invalidClock)).toThrow(/deterministic clock/);

    const invalidSeed = structuredClone(manifest);
    invalidSeed.determinism.randomSeed = "not a safe seed!";
    expect(() => validateManifest(invalidSeed)).toThrow(/random seed/);

    const wrongEndpoint = structuredClone(manifest);
    wrongEndpoint.postgres.before.port = 5432;
    expect(() => validateManifest(wrongEndpoint)).toThrow(/exact allowlisted/);

    const unsafeTable = structuredClone(manifest);
    unsafeTable.postgres.snapshotTables[0] = "Profile; DROP TABLE Profile";
    expect(() => validateManifest(unsafeTable)).toThrow(/Unsafe PostgreSQL/);

    const untrackedClockTable = structuredClone(manifest);
    untrackedClockTable.postgres.databaseClockFields.MissingTable = ["createdAt"];
    expect(() => validateManifest(untrackedClockTable)).toThrow(/not in snapshotTables/);

    const unsafeClockField = structuredClone(manifest);
    unsafeClockField.postgres.databaseClockFields.PhysiologyV7Lifecycle = { "createdAt; DROP TABLE Profile": "zoned-timestamp" };
    expect(() => validateManifest(unsafeClockField)).toThrow(/Unsafe database clock field/);

    const unsupportedClockKind = structuredClone(manifest);
    unsupportedClockKind.postgres.databaseClockFields.PhysiologyV7Lifecycle.createdAt = "free-text";
    expect(() => validateManifest(unsupportedClockKind)).toThrow(/Unsupported database clock field kind/);

    const incompleteClockPolicy = structuredClone(manifest);
    incompleteClockPolicy.postgres.databaseClockFields.PhysiologyV7Lifecycle = { updatedAt: "zoned-timestamp" };
    expect(() => validateManifest(incompleteClockPolicy)).toThrow(/exact reviewed clock-field policy/);

    const duplicatePath = structuredClone(manifest);
    duplicatePath.unitSuites[0].paths.push(duplicatePath.unitSuites[0].paths[0]);
    expect(() => validateManifest(duplicatePath)).toThrow(/test paths contains duplicates/);

    const invalidObservation = structuredClone(manifest);
    invalidObservation.observations[0].path = "tests/not-in-a-suite.test.ts";
    expect(() => validateManifest(invalidObservation)).toThrow(/not covered by a unit suite/);

  });

  it("accepts only the exact isolated before and after PostgreSQL identities", () => {
    expect(validateComparatorDatabaseUrl(
      "postgresql://bodycast_refactor_before_test_runner:test-only@127.0.0.1:55436/bodycast_refactor_before_test",
      beforeTarget,
      "test",
    )).toEqual({ ...beforeTarget, mode: "test" });
    expect(validateComparatorDatabaseUrl(
      "postgresql://bodycast_refactor_after_test_runner:test-only@127.0.0.1:55437/bodycast_refactor_after_test",
      afterTarget,
      "test",
    )).toEqual({ ...afterTarget, mode: "test" });
    const authTarget = {
      host: "127.0.0.1",
      port: 55435,
      database: "bodycast_training_postcommit_test",
      role: "bodycast_test_runner",
    };
    expect(validateComparatorDatabaseUrl(
      "postgresql://bodycast_test_runner:test-only@127.0.0.1:55435/bodycast_training_postcommit_test",
      authTarget,
      "test",
    )).toEqual({ ...authTarget, mode: "test" });

    const invalidUrls = [
      ["postgresql://role:test@127.0.0.1:55436/bodycast_refactor_before_test", beforeTarget, "test"],
      ["postgresql://bodycast_refactor_before_test_runner:test@localhost:55436/bodycast_refactor_before_test", beforeTarget, "test"],
      ["postgresql://bodycast_refactor_before_test_runner:test@127.0.0.1:5432/bodycast_refactor_before_test", beforeTarget, "test"],
      ["postgresql://bodycast_refactor_before_test_runner:test@127.0.0.1:55436/bodycast_refactor_after_test", beforeTarget, "test"],
      ["postgresql://bodycast_refactor_before_test_runner:test@127.0.0.1:55436/bodycast_refactor_before_test?sslmode=require", beforeTarget, "test"],
      ["postgresql://bodycast_refactor_before_test_runner@127.0.0.1:55436/bodycast_refactor_before_test", beforeTarget, "test"],
      ["postgresql://bodycast_refactor_before_test_runner%:test@127.0.0.1:55436/bodycast_refactor_before_test", beforeTarget, "test"],
      ["postgresql://bodycast_refactor_before_test_runner:test@127.0.0.1:55436/bodycast_refactor_before_test", { ...beforeTarget, port: 5432 }, "test"],
      ["postgresql://bodycast_test_runner:test@127.0.0.1:55436/bodycast_training_postcommit_test", { host: "127.0.0.1", port: 55436, database: "bodycast_training_postcommit_test", role: "bodycast_test_runner" }, "test"],
      ["postgresql://bodycast_refactor_before_test_runner:test@127.0.0.1:55436/bodycast_refactor_before_test", beforeTarget, "production"],
    ] as const;
    for (const [url, expected, mode] of invalidUrls) {
      expect(() => validateComparatorDatabaseUrl(url, expected, mode)).toThrow();
    }
  });

  it("attests the pinned PostgreSQL content digest through Docker canonical aliases", () => {
    const digest = "b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";
    expect(validateResolvedPostgresImage(manifest.postgres.image, [
      `postgres@sha256:${digest}`,
      `public.ecr.aws/docker/library/postgres@sha256:${digest}`,
    ])).toBe(`sha256:${digest}`);
    expect(() => validateResolvedPostgresImage("postgres:latest", [`postgres@sha256:${digest}`])).toThrow(/reference or digest/);
    expect(() => validateResolvedPostgresImage(manifest.postgres.image, ["postgres@sha256:" + "a".repeat(64)])).toThrow(/content digest/);
  });

  it("canonicalizes object key order while preserving numeric, null, and array semantics", () => {
    expect(stableJson({ z: 1, a: { y: 2, x: 3 } })).toBe(stableJson({ a: { x: 3, y: 2 }, z: 1 }));
    expect(canonicalizeJson({ z: 1, a: 2 })).toEqual({ a: 2, z: 1 });
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
    expect(stableJson({ value: 0 })).not.toBe(stableJson({ value: null }));
    expect(stableJson({ value: 0 })).not.toBe(stableJson({ value: "0" }));
    expect(() => stableJson({ value: undefined })).toThrow(/JSON-compatible/);
    expect(() => stableJson(-0)).toThrow(/negative zero/);
    expect(() => stableJson(Number.NaN)).toThrow(/finite/);
    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(() => stableJson(sparse)).toThrow(/holes/);
  });

  it("reports exact API, fingerprint, numeric, reorder, missing, and extra differences", () => {
    expect(diffJson({ status: 200, body: { count: 1 }, fingerprint: "a" }, {
      status: 200, body: { count: 2 }, fingerprint: "a",
    })).toEqual([{
      path: "$.body.count",
      before: { present: true, value: 1 },
      after: { present: true, value: 2 },
    }]);
    expect(diffJson({ value: null }, { value: 0 })[0]).toMatchObject({ path: "$.value" });
    expect(diffJson({ value: 1 }, { value: "1" })[0]).toMatchObject({ path: "$.value" });
    expect(diffJson({ fingerprint: "before" }, { fingerprint: "after" })[0].path).toBe("$.fingerprint");
    expect(diffJson({ status: 200, body: {} }, { status: 201, body: {} })[0].path).toBe("$.status");
    expect(diffJson({ value: null }, {})[0]).toEqual({
      path: "$.value",
      before: { present: true, value: null },
      after: { present: false },
    });
    expect(diffJson({}, { value: null })[0]).toEqual({
      path: "$.value",
      before: { present: false },
      after: { present: true, value: null },
    });
    expect(diffJson([1, 2], [2, 1])).toEqual([
      { path: "$[0]", before: { present: true, value: 1 }, after: { present: true, value: 2 } },
      { path: "$[1]", before: { present: true, value: 2 }, after: { present: true, value: 1 } },
    ]);
    expect(diffJson([1], [1, 2])[0]).toEqual({
      path: "$[1]",
      before: { present: false },
      after: { present: true, value: 2 },
    });
  });

  it("orders captured observations by stable case ID without changing their values", () => {
    const later = { caseId: "TRAIN-02/case", value: [2, 1] };
    const earlier = { caseId: "ENERGY-01/case", value: [1, 2] };
    expect(sortObservationsByCaseId([later, earlier])).toEqual([earlier, later]);
    expect(sortObservationsByCaseId([later, earlier])).toEqual(sortObservationsByCaseId([earlier, later]));
    expect(sortObservationsByCaseId([later, earlier])[1].value).toEqual([2, 1]);
    expect(() => sortObservationsByCaseId([{} as { caseId: string }])).toThrow(/string case IDs/);
  });

  it("compares clock-field update transitions without comparing environment wall time", () => {
    const policy = {
      PhysiologyV7Lifecycle: { createdAt: "zoned-timestamp", updatedAt: "zoned-timestamp" },
      AuthRateLimitBucket: { windowStart: "epoch-seconds" },
    };
    const firstRun = deriveDatabaseClockTransitions(
      [
        { table: "PhysiologyV7Lifecycle", primaryKey: { profileId: 1 }, fields: {
          createdAt: "2026-11-23T12:00:00.000+00:00", updatedAt: "2026-11-23T12:00:00.000+00:00",
        } },
        { table: "AuthRateLimitBucket", primaryKey: { bucketKey: "bucket-a" }, fields: { windowStart: 1_795_449_140 } },
      ],
      [
        { table: "PhysiologyV7Lifecycle", primaryKey: { profileId: 1 }, fields: {
          createdAt: "2026-11-23T12:00:00.000+00:00", updatedAt: "2026-11-23T12:00:00.500+00:00",
        } },
        { table: "AuthRateLimitBucket", primaryKey: { bucketKey: "bucket-a" }, fields: { windowStart: 1_795_449_142 } },
      ],
      policy,
    );
    const sameBehaviorAtDifferentWallTime = deriveDatabaseClockTransitions(
      [
        { table: "PhysiologyV7Lifecycle", primaryKey: { profileId: 1 }, fields: {
          createdAt: "2026-11-23T13:00:00.000+00:00", updatedAt: "2026-11-23T13:00:00.000+00:00",
        } },
        { table: "AuthRateLimitBucket", primaryKey: { bucketKey: "bucket-a" }, fields: { windowStart: 1_795_449_240 } },
      ],
      [
        { table: "PhysiologyV7Lifecycle", primaryKey: { profileId: 1 }, fields: {
          createdAt: "2026-11-23T13:00:00.000+00:00", updatedAt: "2026-11-23T13:00:00.250+00:00",
        } },
        { table: "AuthRateLimitBucket", primaryKey: { bucketKey: "bucket-a" }, fields: { windowStart: 1_795_449_244 } },
      ],
      policy,
    );
    const missingUpdate = deriveDatabaseClockTransitions(
      [
        { table: "PhysiologyV7Lifecycle", primaryKey: { profileId: 1 }, fields: {
          createdAt: "2026-11-23T14:00:00.000+00:00", updatedAt: "2026-11-23T14:00:00.000+00:00",
        } },
        { table: "AuthRateLimitBucket", primaryKey: { bucketKey: "bucket-a" }, fields: { windowStart: 1_795_449_340 } },
      ],
      [
        { table: "PhysiologyV7Lifecycle", primaryKey: { profileId: 1 }, fields: {
          createdAt: "2026-11-23T14:00:00.000+00:00", updatedAt: "2026-11-23T14:00:00.000+00:00",
        } },
        { table: "AuthRateLimitBucket", primaryKey: { bucketKey: "bucket-a" }, fields: { windowStart: 1_795_449_340 } },
      ],
      policy,
    );

    expect(firstRun).toEqual(sameBehaviorAtDifferentWallTime);
    expect(diffJson(firstRun, missingUpdate)).not.toEqual([]);
  });

  it("hashes deterministic UTF-8 evidence bytes", () => {
    expect(sha256("bodycast")).toBe("657591502281d028e9a9fa42440683414a98190f50ad7d4e52a3e674ddc53456");
  });

  it("requires each intentionally filtered shard case to pass in another required suite", () => {
    expect(aggregateSuiteCases([
      { suiteId: "shard-1", cases: [
        { file: "tests/a.test.ts", name: "keeps invariant", status: "passed" },
        { file: "tests/a.test.ts", name: "runs focused case", status: "skipped" },
      ] },
      { suiteId: "shard-2", cases: [
        { file: "tests/a.test.ts", name: "keeps invariant", status: "skipped" },
        { file: "tests/a.test.ts", name: "runs focused case", status: "passed" },
      ] },
    ])).toEqual([
      { file: "tests/a.test.ts", name: "keeps invariant", occurrence: 1, executedIn: ["shard-1"], filteredIn: ["shard-2"] },
      { file: "tests/a.test.ts", name: "runs focused case", occurrence: 1, executedIn: ["shard-2"], filteredIn: ["shard-1"] },
    ]);
    expect(aggregateSuiteCases([
      { suiteId: "parameterized", cases: [
        { file: "tests/a.test.ts", name: "rejects URL [REDACTED_DATABASE_URL]", status: "passed" },
        { file: "tests/a.test.ts", name: "rejects URL [REDACTED_DATABASE_URL]", status: "passed" },
      ] },
    ])).toEqual([
      {
        file: "tests/a.test.ts", name: "rejects URL [REDACTED_DATABASE_URL]", occurrence: 1,
        executedIn: ["parameterized"], filteredIn: [],
      },
      {
        file: "tests/a.test.ts", name: "rejects URL [REDACTED_DATABASE_URL]", occurrence: 2,
        executedIn: ["parameterized"], filteredIn: [],
      },
    ]);
    expect(() => aggregateSuiteCases([
      { suiteId: "all", cases: [{ file: "tests/a.test.ts", name: "skipped sentinel", status: "skipped" }] },
    ])).toThrow(/did not pass/);
    expect(() => aggregateSuiteCases([
      { suiteId: "all", cases: [{ file: "tests/a.test.ts", name: "todo sentinel", status: "todo" }] },
    ])).toThrow(/failure, todo, or unknown status/);
  });
});
